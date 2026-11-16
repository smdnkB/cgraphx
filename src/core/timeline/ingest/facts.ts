/**
 * 会话事实的处理管线(从 ingest.ts 拆出,plan T-1):开始目录归属判定(D3、K1、K3)、事实 → 事件映射
 * (F1 K4–K10 落库侧)、单文件读取与落库。增量(ingest.ts 的 ingestIncremental)与全量重建(rebuild.ts)
 * 共用这里的同一套函数——归属口径、source_key 去重、K11 计数与删除时间过滤都只有一份。
 *
 * 结果形状与覆盖判定在 coverage.ts;本文件只管「一个文件怎么处理」,不碰锁、不管进度推进的时机
 * (增量在 writeFacts 里推进 sessions.db 的偏移,重建攒着等项目库提交后统一写)。
 */

import * as fs from 'node:fs';
import * as path from 'node:path';

import type { SessionSource } from '../../agents';
import { findProjectRoot } from '../../data-location';
import type { SqliteDatabase } from '../../db';
import { identityOfRoot } from '../../project-identity';
import type { RootMatcher } from '../../root-match';
import type { SessionFileRow, SessionIndex } from '../../session-index';
import { findProjectDir } from '../../user-data-dir';
import { summarizeToolResponse } from '../post-tool-summary';
import { sanitizeToolArgs } from '../tool-args';
import { TimelineStore, upsertSessionTitle, type SessionTitleUpsert } from '../store';
import type { TimelineEventInput } from '../types';
import { noteUnattributed, type ReadFailedMap, type UnattributedMap } from './coverage';
import { sessionFactsReader } from './reader';
import { sessionAdapterFor } from './adapters';
import type { SessionFact, SessionFactTs, SessionFileReadResult } from './types';

// ─── 共享形状(增量与重建)────────────────────────────────────────────────────

/** 开始目录认到的归属;dirName 为 null 表示这次没认出来(项目可能后来才装,文件变了再认)。 */
export interface DirClassification {
  /** 认到的项目目录名(归当前项目 ⇔ 等于 ctx.currentDirName) */
  dirName: string | null;
  /** 认定用的根(start_dirs 存一份,timeline_roots 的 upsert 也用它) */
  root: string | null;
  /** 认到的项目名字(项目按名字认);没认出来为 null */
  name: string | null;
}

/** 一个待处理文件的 stat 结果(比较用,size 与 mtimeMs 都已取整存同一种写法)。 */
export interface FileStat {
  readonly size: number;
  readonly mtimeMs: number;
}

export function statOrNull(file: string): FileStat | null {
  try {
    const st = fs.statSync(file);
    return { size: st.size, mtimeMs: Math.round(st.mtimeMs) };
  } catch {
    return null;
  }
}

/** K11:整份读出内容却一条事实都没有的文件,按 agent 显示名 + 行内 version 计数(增量与重建共用)。 */
export interface UnparsedTally {
  display: string;
  version: string | null;
  count: number;
}

export type UnparsedMap = Map<string, UnparsedTally>;

/** 归属判定要用的上下文(增量与重建共用;重建的 fallbackMatcher 读项目库记过的根)。 */
export interface ClassificationContext {
  /** 当前项目(查询所在)的项目目录名 */
  readonly currentDirName: string;
  readonly sessionIndex: SessionIndex;
  /** 目录不在时的根匹配:本项目库 timeline_roots + 副本登记(在用、已删都算) */
  readonly fallbackMatcher: () => RootMatcher;
  /**
   * 本趟已认过的开始目录(键 = 传入的 cwd 原值):每个文件都会调 classifyStartDir,不记住的话
   * 同一趟会为同一个开始目录反复扫 projects/ + 读 identity.json。只管这一趟,与 start_dirs 缓存无关。
   */
  readonly classified: Map<string, DirClassification>;
}

/** 事实 → 事件映射要用的上下文(增量与重建共用;重建的 projectDb 指向临时库)。 */
export interface FactMappingContext {
  /** 事件写入目标库,第一次要用时才打开(增量:没文件要处理就不开;重建:临时库,直接给) */
  readonly projectDb: () => SqliteDatabase;
  /** 项目删过数据 → 只收这之后的事实(K3);没删过 → null */
  readonly removedAtMs: number | null;
  /** 本趟写过事件的会话 */
  readonly sessionsWritten: Set<string>;
}

/** 一趟增量的共享上下文。 */
export interface IngestContext extends ClassificationContext, FactMappingContext {
  /** sessions.db 里的会话文件进度(处理过程中随手更新,subagents/ 文件跟主会话时读得到新值) */
  readonly rows: Map<string, SessionFileRow>;
  /** K11:整份读不出事实的文件,按 agent 显示名 + 行内 version 计数 */
  readonly unparsed: UnparsedMap;
  /** 读取器抛错的文件(坏帧、读不出会话头等),按来源显示名 + 原因计数;偏移不推进,下一趟重试 */
  readonly readFailed: ReadFailedMap;
  /** 认不出项目归属的文件(K2),按来源显示名计数;已记空行不重试,只作 K4 的覆盖提示 */
  readonly unattributed: UnattributedMap;
}

// ─── 单文件处理 ──────────────────────────────────────────────────────────────

/**
 * 处理一个大小或 mtime 变了的文件:start_cwd 已知的直接认归属增量读;未知的从头读出会话头再认
 * (读出的事实归本项目时顺手落库,不重读)。
 */
export async function processFile(
  file: string,
  source: SessionSource,
  stat: FileStat,
  row: SessionFileRow | null,
  ctx: IngestContext,
): Promise<void> {
  let startCwd: string | null = row?.start_cwd ?? null;

  // subagents/ 下的文件跟主会话(spec D2 表注,claude/codebuddy 布局;deepseek 路径没有这一段,
  // subagentMainPath 自然返回 null,会话头读自己文件里的开始目录):主会话文件的 start_cwd 已认出
  // 就用它的(本轮先处理主文件,rows 里是最新值);主文件不在 / 没认出时退回自己读头
  const mainPath = sessionAdapterFor(source.sessionReader).parentSessionFile(file);
  if (startCwd === null && mainPath !== null) {
    const mainRow = ctx.rows.get(mainPath) ?? ctx.sessionIndex.getSessionFile(mainPath);
    if (mainRow !== null) {
      ctx.rows.set(mainPath, mainRow);
      startCwd = mainRow.start_cwd;
    }
  }

  if (startCwd !== null) {
    const cls = classifyStartDir(startCwd, ctx);
    if (cls.dirName !== ctx.currentDirName) {
      // 别的项目的:不动,别家自己补;没认出来的(K2「不强行归入」)记一笔缺口(K4),可能丢的是本项目的
      if (cls.dirName === null) noteUnattributed(ctx.unattributed, source);
      return;
    }
    const fromOffset = row?.byte_offset ?? 0;
    // 从头(新文件、上次没认出来、文件截断重写)读的整份没有事实才算 K11
    const fullRead = fromOffset === 0 || stat.size < fromOffset;
    const result = await sessionFactsReader(source.sessionReader)(file, fromOffset);
    writeFacts(file, source, stat, result, startCwd, cls, ctx, fullRead, row?.session_id ?? null);
    return;
  }

  // start_cwd 未知:从头读,拿会话头认归属
  const result = await sessionFactsReader(source.sessionReader)(file, 0);
  const head = result.facts.find((f): f is Extract<SessionFact, { kind: 'session_head' }> => f.kind === 'session_head');
  if (head === undefined) {
    // 一条带 cwd 的行都没有(spec D3「再不行」):留空不处理;记一行免得每趟重读,也算无法归属(K4)
    noteUnattributed(ctx.unattributed, source);
    saveRow(ctx, file, source, stat, { start_cwd: null, project_dir: null, byte_offset: 0, session_id: null });
    return;
  }
  const cls = classifyStartDir(head.startCwd, ctx);
  if (cls.dirName !== ctx.currentDirName) {
    // 认出来了但不是本项目:记下归属,偏移不代推进(它的项目自己补);没认出来的记一笔缺口(K4)
    if (cls.dirName === null) noteUnattributed(ctx.unattributed, source);
    saveRow(ctx, file, source, stat, {
      start_cwd: head.startCwd,
      project_dir: cls.dirName,
      byte_offset: 0,
      session_id: rowSessionId(source, file, result.facts, null),
    });
    return;
  }
  writeFacts(file, source, stat, result, head.startCwd, cls, ctx, true, null);
}

/**
 * 把一文件本趟读到的事实落库(D4):项目库一个事务写完提交,之后才更新 sessions.db 的偏移。
 * prevSessionId 是上一行的会话编号(本趟一条事实都没读到时进度行沿用,C-4)。
 * 标题事实不是事件,不进 mapFacts:单独按 C-2 优先级写标题表,和事件同一个事务(D8);只有
 * 标题的批次(如 claude 只追加标题行)也要开库写。
 */
function writeFacts(
  file: string,
  source: SessionSource,
  stat: FileStat,
  result: SessionFileReadResult,
  startCwd: string,
  cls: DirClassification,
  ctx: IngestContext,
  fullRead: boolean,
  prevSessionId: string | null,
): void {
  const events = mapFacts(result.facts, source, startCwd, ctx);
  const titles = titleUpserts(result.facts);
  if (events.length > 0 || titles.length > 0) {
    const db = ctx.projectDb();
    const store = new TimelineStore(db);
    db.transaction(() => {
      for (const event of events) store.insert(event);
      upsertRoot(db, cls.root, events);
      for (const title of titles) upsertSessionTitle(db, title);
    })();
  }
  saveRow(ctx, file, source, stat, {
    start_cwd: startCwd,
    project_dir: ctx.currentDirName,
    byte_offset: result.consumedBytes,
    session_id: rowSessionId(source, file, result.facts, prevSessionId),
  });
  noteUnparsed(ctx.unparsed, file, source, stat, result, fullRead);
}

/** 项目库记下项目在本机出现过的根(spec K1、K10 的写法同 recorder;重建写进临时库,并库时再并)。 */
const UPSERT_ROOT_SQL =
  'INSERT INTO timeline_roots (root, first_ts, last_ts) VALUES (?, ?, ?) ' +
  'ON CONFLICT(root) DO UPDATE SET first_ts = min(first_ts, excluded.first_ts), last_ts = max(last_ts, excluded.last_ts)';

export function upsertRoot(db: SqliteDatabase, root: string | null, events: readonly TimelineEventInput[]): void {
  if (root === null || events.length === 0) return;
  let first: string | null = null;
  let last: string | null = null;
  for (const e of events) {
    const ts = e.ts ?? '';
    if (first === null || ts < first) first = ts;
    if (last === null || ts > last) last = ts;
  }
  if (first === null || last === null) return;
  let realRoot: string;
  try {
    realRoot = fs.realpathSync(root);
  } catch {
    realRoot = path.resolve(root);
  }
  db.prepare(UPSERT_ROOT_SQL).run(realRoot, first, last);
}

/** 写一行会话文件进度(sessions.db;项目库提交之后才调,见 writeFacts)。session_id 由调用方按来源算好。 */
function saveRow(
  ctx: IngestContext,
  file: string,
  source: SessionSource,
  stat: FileStat,
  fields: { start_cwd: string | null; project_dir: string | null; byte_offset: number; session_id: string | null },
): void {
  const row: Omit<SessionFileRow, 'updated_at'> = {
    path: file,
    agent: source.id,
    session_id: fields.session_id,
    start_cwd: fields.start_cwd,
    project_dir: fields.project_dir,
    byte_offset: fields.byte_offset,
    size: stat.size,
    mtime_ms: stat.mtimeMs,
  };
  ctx.sessionIndex.saveSessionFile(row);
  ctx.rows.set(file, { ...row, updated_at: new Date().toISOString() });
}

/** 会话文件对应的会话编号:主文件是文件名;subagents/ 下的子 agent 文件是主会话目录名(读取器同款认法)。 */
export function sessionFileId(file: string): string {
  const main = subagentMainPath(file);
  return path.basename(main ?? file, '.jsonl');
}

/**
 * 进度行的会话编号(claude/codebuddy 布局按路径规则——分叉文件开头拷来的旧会话行归原会话,
 * 所以不能用行内 sessionId;deepseek 行内不带编号,记本文件事实所属的主会话:读到事实取事实的
 * sessionId,只读到会话头取头事实的,什么都没读到沿用上一行的值,plan C-4)。
 */
export function rowSessionId(
  source: SessionSource,
  file: string,
  facts: readonly SessionFact[],
  fallback: string | null,
): string | null {
  return sessionAdapterFor(source.sessionReader).sessionIdForFile(file, facts, fallback);
}

/** 子 agent 文件 → 同目录(项目子目录)下不带 subagents/ 段的主会话文件路径;主文件 → null。 */
export function subagentMainPath(file: string): string | null {
  const parts = file.split(path.sep);
  const idx = parts.lastIndexOf('subagents');
  if (idx < 1) return null;
  const session = parts[idx - 1];
  if (session === undefined || session === '') return null;
  return path.join(...parts.slice(0, idx - 1), `${session}.jsonl`);
}

/** 读文件第一行里的 version 字段(K11 提示带行内版本;读不出 → null)。 */
function readLineVersion(file: string): string | null {
  let fd: number;
  try {
    fd = fs.openSync(file, 'r');
  } catch {
    return null;
  }
  try {
    const buf = Buffer.alloc(64 * 1024);
    const n = fs.readSync(fd, buf, 0, buf.length, 0);
    const nl = buf.subarray(0, n).indexOf(0x0a);
    const line = (nl === -1 ? buf.subarray(0, n) : buf.subarray(0, nl)).toString('utf8');
    const parsed: unknown = JSON.parse(line);
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
    const v = (parsed as Record<string, unknown>)['version'];
    return typeof v === 'string' && v.length > 0 ? v : null;
  } catch {
    return null;
  } finally {
    try {
      fs.closeSync(fd);
    } catch {
      // 关不上不影响结果
    }
  }
}

/** K11 判定与计数(增量与重建共用):从头读的整份没有事实才算(agent 升级改了格式),提示带行内 version。 */
export function noteUnparsed(
  unparsed: UnparsedMap,
  file: string,
  source: SessionSource,
  stat: FileStat,
  result: SessionFileReadResult,
  fullRead: boolean,
): void {
  if (!fullRead || stat.size === 0 || result.facts.length > 0) return;
  const version = readLineVersion(file);
  const key = `${source.displayName} ${version ?? ''}`;
  const cur = unparsed.get(key);
  if (cur === undefined) unparsed.set(key, { display: source.displayName, version, count: 1 });
  else cur.count += 1;
}

/** K11 的人读提示(F1 ② 的原文)。 */
export function unparsedNotices(unparsed: UnparsedMap): string[] {
  return [...unparsed.values()].map(
    (u) =>
      `${u.display}${u.version !== null ? ` ${u.version}` : ''} 的会话文件有 ${u.count} 个解析不出,` +
      '时间线可能不全;升级 cgraphx 或反馈',
  );
}

// ─── 开始目录归属(D3、K1、K3)───────────────────────────────────────────────

/** 目录还在不在(start 目录可能早被删/改名了);抛错(权限等)按不在。 */
function startDirExists(cwd: string): boolean {
  try {
    return fs.statSync(cwd, { throwIfNoEntry: false })?.isDirectory() ?? false;
  } catch {
    return false;
  }
}

/** 开始目录还在:现认。返回 null 表示 git 瞬时跑不起来(这一趟别写 start_dirs,下次再认)。 */
function recognizeExistingDir(cwd: string): DirClassification | null {
  const root = findProjectRoot(cwd);
  if (root === null) return { dirName: null, root: null, name: null };
  const info = identityOfRoot(root);
  if (info === 'git-error') return null;
  const identity = info.identity;
  // K3:项目目录已在(findProjectDir 非空)才记;没有 → null,项目建了目录后重认
  const dirName = identity !== null ? findProjectDir(identity)?.name ?? null : null;
  return { dirName, root, name: identity?.name ?? null };
}

/** 开始目录不在了:只有这时才用 start_dirs 缓存,没认过的退到 timeline_roots 与副本登记(K1;都不中 → 留空)。 */
function classifyGoneDir(cwd: string, ctx: ClassificationContext): DirClassification {
  const cached = ctx.sessionIndex.getStartDir(cwd);
  if (cached !== null && cached.project_dir !== null) {
    return { dirName: cached.project_dir, root: cached.root, name: cached.name };
  }
  const hit = ctx.fallbackMatcher().match(cwd, { allowSelf: true });
  return hit !== null
    ? { dirName: ctx.currentDirName, root: hit.root, name: null }
    : { dirName: null, root: null, name: null };
}

/**
 * 开始目录归属(D3、K1、K3):开始目录还在就现认(改名、换项目目录后这里才对得上),只有目录不在了
 * 才用 start_dirs 缓存。结果按 cwd 记进本趟记忆,并写一行 start_dirs(目录将来被删时靠它兜底)。
 * 不是本机绝对路径的开始目录(如会话文件里的 `D:\...`)不归任何项目:不现认、不读也不写 start_dirs。
 */
export function classifyStartDir(cwd: string, ctx: ClassificationContext): DirClassification {
  if (!path.isAbsolute(cwd)) return { dirName: null, root: null, name: null };
  const remembered = ctx.classified.get(cwd);
  if (remembered !== undefined) return remembered;

  let out: DirClassification;
  if (startDirExists(cwd)) {
    const recognized = recognizeExistingDir(cwd);
    if (recognized === null) {
      // git 跑不起来:不写 start_dirs(下次再认),但记进本趟记忆,别为每个文件反复跑失败的 git
      const empty: DirClassification = { dirName: null, root: null, name: null };
      ctx.classified.set(cwd, empty);
      return empty;
    }
    out = recognized;
  } else {
    out = classifyGoneDir(cwd, ctx);
  }

  ctx.classified.set(cwd, out);
  try {
    ctx.sessionIndex.saveStartDir({ cwd, root: out.root, name: out.name, project_dir: out.dirName });
  } catch {
    // 认定结果记不下只影响下次还要现认,不影响本次归属
  }
  return out;
}

// ─── 事实 → 事件(F1 K4–K10 的落库侧;source_key 按 C-2)───────────────────

/** 事实时间戳 → 毫秒:codebuddy 是 epoch 毫秒数,claude 是 ISO 字符串(T-2 备注③,统一在这里归一)。 */
function factMs(ts: SessionFactTs): number | null {
  if (typeof ts === 'number') return Number.isFinite(ts) ? ts : null;
  const t = Date.parse(ts);
  return Number.isNaN(t) ? null : t;
}

function factIso(ts: SessionFactTs): string | null {
  const ms = factMs(ts);
  return ms === null ? null : new Date(ms).toISOString();
}

export function mapFacts(
  facts: readonly SessionFact[],
  source: SessionSource,
  startCwd: string,
  ctx: FactMappingContext,
): TimelineEventInput[] {
  const events: TimelineEventInput[] = [];
  // 本趟见到的每个会话最新一条提问的 uuid(D6:轮次编号取提问消息的 uuid,重新解析不变)
  const lastPrompt = new Map<string, string>();
  const turnIdOf = (sessionId: string, ts: string): string | null => {
    const inRun = lastPrompt.get(sessionId);
    if (inRun !== undefined) return inRun;
    // 本趟没见到这个会话的提问(增量跨趟):查项目库里这条之前最近的提问
    try {
      const row = ctx
        .projectDb()
        .prepare(
          `SELECT turn_id FROM timeline_events
           WHERE session_id = ? AND event_type IN ('user_prompt', 'auto_message')
             AND turn_id IS NOT NULL AND ts <= ?
           ORDER BY ts DESC, id DESC LIMIT 1`,
        )
        .get(sessionId, ts) as { turn_id: string } | undefined;
      return row?.turn_id ?? null;
    } catch {
      return null;
    }
  };

  for (const fact of facts) {
    // K3:删过数据的项目只收删除之后的事实(旧会话不补回)。工具事实的时间以结果行计
    const cutoffTs = fact.kind === 'tool' ? fact.resultTs : fact.ts;
    if (ctx.removedAtMs !== null) {
      const ms = factMs(cutoffTs);
      if (ms === null || ms <= ctx.removedAtMs) continue;
    }
    switch (fact.kind) {
      case 'session_head': {
        // K9:一个会话只一条(source_key 保证),cwd 取 start_cwd,turn_id 恒 null
        const ts = factIso(fact.ts);
        if (ts === null) continue;
        events.push({
          event_type: 'session_start',
          ts,
          session_id: fact.sessionId,
          turn_id: null,
          cwd: fact.startCwd,
          agent: source.id,
          source_key: `${source.id}:start:${fact.sessionId}`,
        });
        break;
      }
      case 'prompt': {
        // K5:人发的记 user_prompt,自动消息记 auto_message(metadata.source 沿用 classifyAutoMessage
        // 的来源,由读取器给出);turn_id 取本条提问的 uuid
        const ts = factIso(fact.ts);
        if (ts === null) continue;
        const isUser = fact.source === 'user';
        events.push({
          event_type: isUser ? 'user_prompt' : 'auto_message',
          ts,
          session_id: fact.sessionId,
          prompt_text: fact.text,
          turn_id: fact.uuid,
          cwd: startCwd,
          agent: source.id,
          metadata: isUser ? undefined : { source: fact.source },
          source_key: `${source.id}:prompt:${fact.uuid}`,
        });
        lastPrompt.set(fact.sessionId, fact.uuid);
        break;
      }
      case 'tool': {
        // K7、K8:一条 post_tool_use,ts 取结果行、cwd 取调用行、耗时取两行时间差;
        // 不再记 pre_tool_use(C-10)
        const ts = factIso(fact.resultTs);
        if (ts === null) continue;
        const issuedMs = factMs(fact.issuedTs);
        const resultMs = factMs(fact.resultTs);
        const duration = issuedMs !== null && resultMs !== null ? resultMs - issuedMs : null;
        const meta: Record<string, unknown> = {
          tool_use_id: fact.toolUseId,
          duration_source: 'transcript',
        };
        if (fact.subagent !== undefined) {
          meta.subagent = { id: fact.subagent.id ?? null, type: fact.subagent.type ?? null };
        }
        events.push({
          event_type: 'post_tool_use',
          ts,
          session_id: fact.sessionId,
          tool_name: fact.toolName,
          tool_args: sanitizeToolArgs(fact.toolName, fact.args),
          tool_result_summary: summarizeToolResponse(
            fact.toolName,
            fact.resultPayload,
            fact.args,
            fact.isError ? {} : undefined, // is_error 走失败分支:空 failure 也让摘要的 success 置 false
          ),
          duration_ms: duration !== null && duration >= 0 ? duration : undefined,
          turn_id: turnIdOf(fact.sessionId, ts),
          cwd: fact.cwd ?? startCwd,
          agent: source.id,
          metadata: meta,
          source_key: `${source.id}:tool:${fact.toolUseId}`,
        });
        break;
      }
      case 'turn_end': {
        // K6:ts 取回复时间,turn_id 取本轮提问的 uuid
        const ts = factIso(fact.ts);
        if (ts === null) continue;
        events.push({
          event_type: 'stop',
          ts,
          session_id: fact.sessionId,
          turn_id: turnIdOf(fact.sessionId, ts),
          cwd: startCwd,
          agent: source.id,
          source_key: `${source.id}:stop:${fact.messageId}`,
        });
        break;
      }
    }
  }
  for (const event of events) {
    if (event.session_id !== null && event.session_id !== undefined) ctx.sessionsWritten.add(event.session_id);
  }
  return events;
}

/**
 * 标题事实 → 标题表写入行(C-2):标题不是事件,不走 mapFacts;ts 统一在这里归一成 ISO
 * (deepseek 的 epoch 毫秒换算,claude 标题行「前面最近一条带时间行」的兜底 0 同理)。
 */
export function titleUpserts(facts: readonly SessionFact[]): SessionTitleUpsert[] {
  const out: SessionTitleUpsert[] = [];
  for (const fact of facts) {
    if (fact.kind !== 'session_title') continue;
    const ts = factIso(fact.ts);
    if (ts === null) continue;
    out.push({ sessionId: fact.sessionId, title: fact.title, kind: fact.titleKind, ts });
  }
  return out;
}
