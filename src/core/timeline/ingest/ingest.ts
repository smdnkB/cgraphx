/**
 * 补录管线(spec F1 的落库侧:plan T-3;D3、D4、D9):查时间线之前,把各家 agent 会话文件里新增的
 * 部分解析成事件写进这个项目的项目库。只做增量——全量重建(F6)在 T-4,入口里留了接缝。
 *
 * 流程:
 *   1. 开关关闭 → skipped-disabled;这个目录的旧数据还没并过(K25)→ skipped-legacy,都不碰库
 *   2. 列出各家 agent 会话根目录下的全部会话文件(路径升序:同一会话的主文件排在它的 subagents/
 *      文件前面,先到先写的 session_head 才保得住「会话开始取本会话第一条消息」);大小和 mtime 都
 *      没变的直接跳过(实测 3,221 个文件几十毫秒),一个都没变就不开库、不拿锁
 *   3. 有要处理的先拿项目数据目录的 ingest.lock(写法沿用 project/merge-files.ts:wx 独占创建、
 *      pid 不活或超 2 小时算陈旧;最多等 3 秒,等不到 → busy,查询照常执行)
 *   4. 逐文件:认 start_cwd(新文件读会话头;subagents/ 下的文件跟主会话),按 start_dirs 认归属
 *      ——没认过的开始目录跑一次 findProjectRoot + identityOfRoot(不在补录里反复跑 git,结果缓存
 *      进 start_dirs);目录不在了按本项目库的 timeline_roots 和副本登记匹配(K1);归当前项目的
 *      文件从上次偏移增量读到最后一个完整行,事实映射成事件按 source_key 去重(D5)写库,顺手
 *      upsert timeline_roots(hook 退役后这里是它的写入方,不然删掉目录的会话再认不回来)
 *   5. 项目库提交之后才更新 sessions.db 的偏移(D4:反过来的话中断会丢事件);别的项目的文件不代
 *      推进偏移——它的项目自己补
 *
 * 读路径从只读变可能写库:本模块任何失败都只变成 status / notices,不抛出;提示由 describeSyncOutcome
 * 渲染、调用方写 stderr,查询的退出码与 stdout 不受影响(--json 的结果不混提示)。
 */

import * as fs from 'node:fs';
import * as path from 'node:path';

import { agentSessionsRoot, listAgentProfiles, type AgentProfile } from '../../agents';
import { findProjectRoot, locateDataAtRoot } from '../../data-location';
import { DatabaseConnection, DATABASE_FILENAME, type SqliteDatabase } from '../../db';
import { identityOfRoot } from '../../project-identity';
import { hasUnmergedLegacyData } from '../../project';
import { listReplicas } from '../../replica';
import { createRootMatcher, type RootMatcher } from '../../root-match';
import { openSessionIndex, type SessionFileRow, type SessionIndex } from '../../session-index';
import { findProjectDir } from '../../user-data-dir';
import { isKillSwitchOn } from '../kill-switch';
import { readRootRows } from '../roots';
import { ensureTimelineSchema } from '../schema-bootstrap';
import { summarizeToolResponse } from '../post-tool-summary';
import { sanitizeToolArgs } from '../tool-args';
import { TimelineStore } from '../store';
import type { TimelineEventInput } from '../types';
import { listSessionFiles, sessionFactsReader } from './reader';
import type { SessionFact, SessionFactTs, SessionFileReadResult } from './types';

// ─── 结果形状(plan C-4)──────────────────────────────────────────────────────

export type TimelineSyncStatus =
  | 'synced'
  | 'rebuilt'
  | 'busy'
  | 'failed'
  | 'skipped-disabled'
  | 'skipped-legacy';

export interface TimelineSyncOutcome {
  status: TimelineSyncStatus;
  /** 本次涉及的会话数(重建:全部会话) */
  sessions?: number;
  /** 本次新写进库的事件数 */
  events?: number;
  /** 动态的人读提示(如 K11 解析不出的文件);固定文案(status 决定的)由 describeSyncOutcome 出 */
  notices: string[];
  /** status 为 failed 时的原因 */
  reason?: string;
}

/** 门面入口(C-4)。内部顺序:开关关闭 → 旧数据没并过 → 增量补录(重建的检查在 T-4 接进来)。 */
export async function ensureTimelineUpToDate(start: string): Promise<TimelineSyncOutcome> {
  try {
    // F1 ④:开关关了不补录、不碰库,也不提示
    if (isKillSwitchOn()) return { status: 'skipped-disabled', notices: [] };
    // F1 ③ / K25:旧数据还没并过的目录,时间线停在升级前,提示先 install(经 project 门面取,
    // timeline⇄project 双向引用是 spec D3 定的复用,运行期函数调用无碍)
    if (hasUnmergedLegacyData(start)) return { status: 'skipped-legacy', notices: [] };
    // F6 重建的检查(T-4):timeline_meta 无 rebuilt_at 时先全量重建再增量。重建落地前的过渡期直接
    // 增量——重建上线时会清掉这段期间与旧 hook 事件并存的数据(提交记录除外),结果仍以解析为准。
    return await ingestIncremental(start);
  } catch (err) {
    return { status: 'failed', reason: errorMessage(err), notices: [] };
  }
}

/** 人读提示(F1/F6 图的原文):固定文案按 status 出,rebuilt 的汇总在最前,动态的(notices)跟在后面。 */
export function describeSyncOutcome(outcome: TimelineSyncOutcome): string[] {
  switch (outcome.status) {
    case 'skipped-disabled':
      return [];
    case 'skipped-legacy':
      return ['这个目录还没装新版,时间线停在升级前;运行 cgraphx install 补齐'];
    case 'busy':
      return ['时间线正在补录,结果可能缺最近的'];
    case 'failed':
      return [`时间线补录失败:${outcome.reason ?? '未知原因'},结果可能缺最近的`];
    case 'rebuilt':
      return [
        `时间线已重建:${outcome.sessions ?? 0} 个会话,${outcome.events ?? 0} 条事件`,
        ...outcome.notices,
      ];
    case 'synced':
      return outcome.notices;
  }
}

// ─── 补录主体 ────────────────────────────────────────────────────────────────

/** 开始目录认到的归属;dirName 为 null 表示这次没认出来(项目可能后来才装,文件变了再认)。 */
interface DirClassification {
  /** 认到的项目目录名(归当前项目 ⇔ 等于 ctx.currentDirName) */
  dirName: string | null;
  /** 认定用的根(start_dirs 存一份,timeline_roots 的 upsert 也用它) */
  root: string | null;
  origin: string | null;
  name: string | null;
}

/** 一个待处理文件的 stat 结果(比较用,size 与 mtimeMs 都已取整存同一种写法)。 */
interface FileStat {
  readonly size: number;
  readonly mtimeMs: number;
}

/** 一趟补录的共享上下文。 */
interface IngestContext {
  /** 当前项目(查询所在)的项目目录名 */
  readonly currentDirName: string;
  readonly sessionIndex: SessionIndex;
  /** sessions.db 里的会话文件进度(处理过程中随手更新,subagents/ 文件跟主会话时读得到新值) */
  readonly rows: Map<string, SessionFileRow>;
  /** 项目删过数据 → 只收这之后的事实(K3);没删过 → null */
  readonly removedAtMs: number | null;
  /** K11:整份读不出事实的文件,按 agent 显示名 + 行内 version 计数 */
  readonly unparsed: Map<string, { display: string; version: string | null; count: number }>;
  /** 本趟写过事件的会话 */
  readonly sessionsWritten: Set<string>;
  /** 项目库,第一次要用时才打开(没文件要处理就不开) */
  readonly projectDb: () => SqliteDatabase;
  /** 目录不在时的根匹配:本项目库 timeline_roots + 副本登记(在用、已删都算) */
  readonly fallbackMatcher: () => RootMatcher;
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function statOrNull(file: string): FileStat | null {
  try {
    const st = fs.statSync(file);
    return { size: st.size, mtimeMs: Math.round(st.mtimeMs) };
  } catch {
    return null;
  }
}

async function ingestIncremental(start: string): Promise<TimelineSyncOutcome> {
  const root = findProjectRoot(start);
  if (root === null) return { status: 'synced', notices: [] };
  const loc = locateDataAtRoot(root);
  // 项目目录不在(没装过也从没记过数据)就没有落库的地方:查询会报自己的错,这里静默不补
  if (loc.mode !== 'project' || loc.dataDir === null || loc.projectDirName === null || loc.identity === null) {
    return { status: 'synced', notices: [] };
  }
  const dataDir = loc.dataDir;

  const sessionIndex = openSessionIndex();
  let conn: DatabaseConnection | null = null;
  let countBefore: number | null = null;
  try {
    // 候选文件与快速筛选:大小和 mtime 都没变的跳过(含别的项目的——进度一行一份,别家文件
    // 变了归别家的运行补,这里只看要不要重新认)
    const rows = new Map<string, SessionFileRow>();
    const pending: Array<{ profile: AgentProfile; file: string; stat: FileStat }> = [];
    for (const profile of listAgentProfiles()) {
      const sessionsRoot = agentSessionsRoot(profile);
      if (sessionsRoot === null) continue;
      for (const row of sessionIndex.listSessionFiles(profile.id)) rows.set(row.path, row);
      for (const file of listSessionFiles(sessionsRoot)) {
        const stat = statOrNull(file);
        if (stat === null) continue; // 文件没了(F1 ⑤):已记进时间线的留着,这里跳过
        const known = rows.get(file);
        if (known !== undefined && known.size === stat.size && known.mtime_ms === stat.mtimeMs) continue;
        pending.push({ profile, file, stat });
      }
    }
    if (pending.length === 0) return { status: 'synced', notices: [] };

    if (!acquireIngestLock(dataDir)) return { status: 'busy', notices: [] };
    try {
      const removedAtMs = (() => {
        const removedAt = sessionIndex.removedProjectAt(loc.identity);
        const ms = removedAt === null ? NaN : Date.parse(removedAt);
        return Number.isFinite(ms) ? ms : null;
      })();
      // 项目库第一次要用时才打开(没文件要写就不开);目录不在时匹配用的根匹配器同样惰性建
      const projectDb = (): SqliteDatabase => {
        if (conn === null) {
          conn = DatabaseConnection.open(path.join(dataDir, DATABASE_FILENAME));
          const db = conn.getDb();
          ensureTimelineSchema(db);
          countBefore = countEvents(db);
        }
        return conn.getDb();
      };
      let matcher: RootMatcher | null = null;
      const ctx: IngestContext = {
        currentDirName: loc.projectDirName,
        sessionIndex,
        rows,
        removedAtMs,
        unparsed: new Map(),
        sessionsWritten: new Set(),
        projectDb,
        fallbackMatcher: () => {
          if (matcher === null) {
            const recorded = readRootRows(projectDb()).map((r) => r.root);
            const replicas = listReplicas(root, { includeRemoved: true }).map((e) => e.path);
            matcher = createRootMatcher([...recorded, ...replicas]);
          }
          return matcher;
        },
      };

      for (const item of pending) {
        // 等锁期间可能已被别的进程补过:重取这一行再比一次
        const fresh = sessionIndex.getSessionFile(item.file);
        if (fresh !== null) {
          rows.set(item.file, fresh);
          if (fresh.size === item.stat.size && fresh.mtime_ms === item.stat.mtimeMs) continue;
        }
        await processFile(item.file, item.profile, item.stat, fresh ?? null, ctx);
      }

      const events = conn !== null ? Math.max(0, countEvents(conn.getDb()) - (countBefore ?? 0)) : 0;
      const notices = [...ctx.unparsed.values()].map(
        (u) =>
          `${u.display}${u.version !== null ? ` ${u.version}` : ''} 的会话文件有 ${u.count} 个解析不出,` +
          '时间线可能不全;升级 cgraphx 或反馈',
      );
      return { status: 'synced', sessions: ctx.sessionsWritten.size, events, notices };
    } finally {
      releaseIngestLock(dataDir);
    }
  } finally {
    try {
      conn?.close();
    } catch {
      // 关不上不影响结果
    }
    sessionIndex.close();
  }
}

function countEvents(db: SqliteDatabase): number {
  const row = db.prepare('SELECT COUNT(*) AS n FROM timeline_events').get() as { n: number | bigint };
  return Number(row.n);
}

// ─── 单文件处理 ──────────────────────────────────────────────────────────────

/**
 * 处理一个大小或 mtime 变了的文件:start_cwd 已知的直接认归属增量读;未知的从头读出会话头再认
 * (读出的事实归本项目时顺手落库,不重读)。
 */
async function processFile(
  file: string,
  profile: AgentProfile,
  stat: FileStat,
  row: SessionFileRow | null,
  ctx: IngestContext,
): Promise<void> {
  let startCwd: string | null = row?.start_cwd ?? null;

  // subagents/ 下的文件跟主会话(spec D2 表注):主会话文件的 start_cwd 已认出就用它的
  // (本轮先处理主文件,rows 里是最新值);主文件不在 / 没认出时退回自己读头
  const mainPath = subagentMainPath(file);
  if (startCwd === null && mainPath !== null) {
    const mainRow = ctx.rows.get(mainPath) ?? ctx.sessionIndex.getSessionFile(mainPath);
    if (mainRow !== null) {
      ctx.rows.set(mainPath, mainRow);
      startCwd = mainRow.start_cwd;
    }
  }

  if (startCwd !== null) {
    const cls = classifyStartDir(startCwd, ctx);
    if (cls.dirName !== ctx.currentDirName) return; // 别的项目的 / 没认出来的:不动,别家自己补
    const fromOffset = row?.byte_offset ?? 0;
    // 从头(新文件、上次没认出来、文件截断重写)读的整份没有事实才算 K11
    const fullRead = fromOffset === 0 || stat.size < fromOffset;
    const result = await sessionFactsReader(profile.sessionReader)(file, fromOffset);
    writeFacts(file, profile, stat, result, startCwd, cls, ctx, fullRead);
    return;
  }

  // start_cwd 未知:从头读,拿会话头认归属
  const result = await sessionFactsReader(profile.sessionReader)(file, 0);
  const head = result.facts.find((f): f is Extract<SessionFact, { kind: 'session_head' }> => f.kind === 'session_head');
  if (head === undefined) {
    // 一条带 cwd 的行都没有(spec D3「再不行」):留空不处理;记一行免得每趟重读
    saveRow(ctx, file, profile, stat, { start_cwd: null, project_dir: null, byte_offset: 0 });
    return;
  }
  const cls = classifyStartDir(head.startCwd, ctx);
  if (cls.dirName !== ctx.currentDirName) {
    // 认出来了但不是本项目:记下归属,偏移不代推进(它的项目自己补)
    saveRow(ctx, file, profile, stat, { start_cwd: head.startCwd, project_dir: cls.dirName, byte_offset: 0 });
    return;
  }
  writeFacts(file, profile, stat, result, head.startCwd, cls, ctx, true);
}

/**
 * 把一文件本趟读到的事实落库(D4):项目库一个事务写完提交,之后才更新 sessions.db 的偏移。
 */
function writeFacts(
  file: string,
  profile: AgentProfile,
  stat: FileStat,
  result: SessionFileReadResult,
  startCwd: string,
  cls: DirClassification,
  ctx: IngestContext,
  fullRead: boolean,
): void {
  const events = mapFacts(result.facts, profile, startCwd, ctx);
  if (events.length > 0) {
    const db = ctx.projectDb();
    const store = new TimelineStore(db);
    db.transaction(() => {
      for (const event of events) store.insert(event);
      upsertRoot(db, cls.root, events);
    })();
  }
  saveRow(ctx, file, profile, stat, {
    start_cwd: startCwd,
    project_dir: ctx.currentDirName,
    byte_offset: result.consumedBytes,
  });
  if (fullRead && stat.size > 0 && result.facts.length === 0) {
    // K11:整份读出内容却一条事实都没有(agent 升级改了格式),提示带行内 version
    const version = readLineVersion(file);
    const key = `${profile.displayName} ${version ?? ''}`;
    const cur = ctx.unparsed.get(key);
    if (cur === undefined) ctx.unparsed.set(key, { display: profile.displayName, version, count: 1 });
    else cur.count += 1;
  }
}

/** 项目库记下项目在本机出现过的根(spec K1、K10 的写法同 recorder)。 */
const UPSERT_ROOT_SQL =
  'INSERT INTO timeline_roots (root, first_ts, last_ts) VALUES (?, ?, ?) ' +
  'ON CONFLICT(root) DO UPDATE SET first_ts = min(first_ts, excluded.first_ts), last_ts = max(last_ts, excluded.last_ts)';

function upsertRoot(db: SqliteDatabase, root: string | null, events: readonly TimelineEventInput[]): void {
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

/** 写一行会话文件进度(sessions.db;项目库提交之后才调,见 writeFacts)。 */
function saveRow(
  ctx: IngestContext,
  file: string,
  profile: AgentProfile,
  stat: FileStat,
  fields: { start_cwd: string | null; project_dir: string | null; byte_offset: number },
): void {
  const row: Omit<SessionFileRow, 'updated_at'> = {
    path: file,
    agent: profile.id,
    session_id: sessionFileId(file),
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
function sessionFileId(file: string): string {
  const main = subagentMainPath(file);
  return path.basename(main ?? file, '.jsonl');
}

/** 子 agent 文件 → 同目录(项目子目录)下不带 subagents/ 段的主会话文件路径;主文件 → null。 */
function subagentMainPath(file: string): string | null {
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

// ─── 开始目录归属(D3、K1、K3)───────────────────────────────────────────────

function classifyStartDir(cwd: string, ctx: IngestContext): DirClassification {
  const cached = ctx.sessionIndex.getStartDir(cwd);
  // 认到过项目的直接用缓存(改名会清掉受影响根的行,下次重认);没认出来过的现认:
  // 项目可能后来才装、才记名字、才建项目目录(K3 补历史的依据)
  if (cached !== null && cached.project_dir !== null) {
    return { dirName: cached.project_dir, root: cached.root, origin: cached.origin, name: cached.name };
  }
  const root = findProjectRoot(cwd);
  let out: DirClassification;
  if (root !== null) {
    const info = identityOfRoot(root);
    if (info === 'git-error') {
      // git 瞬时跑不起来:不缓存,下次文件变了再认
      return { dirName: null, root: null, origin: null, name: null };
    }
    const identity = info.identity;
    // K3:项目目录已在(findProjectDir 非空)才记;没有 → null,项目建了目录后重认
    const dirName = identity !== null ? findProjectDir(identity)?.name ?? null : null;
    out = { dirName, root, origin: identity?.origin ?? null, name: identity?.name ?? null };
  } else {
    // 目录不在了:按本项目库记过的根(timeline_roots)和副本登记匹配(K1;都不中 → 留空)
    const hit = ctx.fallbackMatcher().match(cwd, { allowSelf: true });
    out = hit !== null
      ? { dirName: ctx.currentDirName, root: hit.root, origin: null, name: null }
      : { dirName: null, root: null, origin: null, name: null };
  }
  try {
    ctx.sessionIndex.saveStartDir({ cwd, root: out.root, origin: out.origin, name: out.name, project_dir: out.dirName });
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

function mapFacts(
  facts: readonly SessionFact[],
  profile: AgentProfile,
  startCwd: string,
  ctx: IngestContext,
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
          agent: profile.id,
          source_key: `${profile.id}:start:${fact.sessionId}`,
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
          agent: profile.id,
          metadata: isUser ? undefined : { source: fact.source },
          source_key: `${profile.id}:prompt:${fact.uuid}`,
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
          duration_ms: duration !== null && duration >= 0 ? duration : null,
          turn_id: turnIdOf(fact.sessionId, ts),
          cwd: fact.cwd ?? startCwd,
          agent: profile.id,
          metadata: meta,
          source_key: `${profile.id}:tool:${fact.toolUseId}`,
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
          agent: profile.id,
          source_key: `${profile.id}:stop:${fact.messageId}`,
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

// ─── ingest.lock(D9:写法沿用 project/merge-files.ts 的 merge.lock)──────────

/** 补录的锁:项目数据目录下 `ingest.lock`,同一项目同一时间只有一个进程在补录。 */
const INGEST_LOCK_FILENAME = 'ingest.lock';
/** 锁的 mtime 超过这么久算陈旧,删掉后接管(pid 不存活同样算陈旧)。 */
const INGEST_LOCK_STALE_MS = 2 * 3600_000;
/** 拿锁最多等多久;等不到 → busy,查询照常。 */
const INGEST_LOCK_WAIT_MS = 3_000;
/** 拿不到锁时隔多久再试一次。 */
const INGEST_LOCK_RETRY_MS = 200;
/** 锁文件只给自己看(项目目录本身已是 0700)。 */
const PRIVATE_FILE_MODE = 0o600;

function errnoOf(err: unknown): string | undefined {
  return (err as NodeJS.ErrnoException).code;
}

/** 锁里的 pid;读不到、内容不对 → null。 */
function readLockPid(file: string): number | null {
  try {
    const raw = JSON.parse(fs.readFileSync(file, 'utf8')) as { pid?: unknown };
    return typeof raw.pid === 'number' && Number.isInteger(raw.pid) && raw.pid > 0 ? raw.pid : null;
  } catch {
    return null;
  }
}

/** pid 是否存活(EPERM 表示进程在、只是没权限发信号,算存活)。 */
function isPidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return errnoOf(err) !== 'ESRCH';
  }
}

/** 已在的锁是否陈旧:mtime 超时,或 pid 不存活;pid 读不到时只看 mtime(可能正被别的进程写入)。 */
function isStaleLock(file: string): boolean {
  let mtimeMs: number;
  try {
    mtimeMs = fs.statSync(file).mtimeMs;
  } catch {
    return true;
  }
  if (Date.now() - mtimeMs > INGEST_LOCK_STALE_MS) return true;
  const pid = readLockPid(file);
  return pid !== null && !isPidAlive(pid);
}

function tryCreateLock(file: string): boolean {
  try {
    const fd = fs.openSync(file, 'wx', PRIVATE_FILE_MODE);
    try {
      fs.writeSync(fd, JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() }));
    } finally {
      fs.closeSync(fd);
    }
    return true;
  } catch (err) {
    if (errnoOf(err) === 'EEXIST') return false;
    throw err;
  }
}

/** 独占创建一次;已在且陈旧 → 删掉后再试一次。 */
function claimOnce(file: string): boolean {
  if (tryCreateLock(file)) return true;
  if (!isStaleLock(file)) return false;
  try {
    fs.unlinkSync(file);
  } catch {
    // 被别的进程抢先删掉、接管:按再试的结果为准
  }
  return tryCreateLock(file);
}

function sleepSync(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

/** 拿项目数据目录的 ingest.lock:拿不到每隔 200ms 再试,最多等 3 秒;等不到 → false。 */
export function acquireIngestLock(dataDir: string): boolean {
  const file = path.join(dataDir, INGEST_LOCK_FILENAME);
  const deadline = Date.now() + INGEST_LOCK_WAIT_MS;
  for (;;) {
    if (claimOnce(file)) return true;
    const left = deadline - Date.now();
    if (left <= 0) return false;
    sleepSync(Math.min(INGEST_LOCK_RETRY_MS, left));
  }
}

/** 放锁:只删本进程拿的;删不掉由陈旧判定兜底。 */
export function releaseIngestLock(dataDir: string): void {
  const file = path.join(dataDir, INGEST_LOCK_FILENAME);
  try {
    if (readLockPid(file) === process.pid) fs.unlinkSync(file);
  } catch {
    // 放锁失败不影响结果
  }
}
