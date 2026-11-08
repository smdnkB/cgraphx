/**
 * 补录管线(spec F1 的落库侧:plan T-3;D3、D4、D9):查时间线之前,把各家 agent 会话文件里新增的
 * 部分解析成事件写进这个项目的项目库。全量重建(F6)在 rebuild.ts,由同一入口在增量之前执行(T-4);
 * 归属判定、事实映射、K11 计数与 ingest.lock 在这里导出,重建复用同一套函数。
 *
 * 流程:
 *   1. 开关关闭 → skipped-disabled;这个目录的旧数据还没并过(K25)→ skipped-legacy,都不碰库;
 *      这个项目还没重建过(timeline_meta 无 rebuilt_at)→ 先全量重建(F6,见 rebuild.ts)再增量;
 *      重建之后、增量之前,老会话标题回填一次(D9,见 backfillSessionTitles),再把 DeepSeek 已有
 *      标题按新规则重算一次(D10,见 refreshDeepSeekSessionTitles)
 *   2. 经 agents 门面的 listSessionSources() 列出各来源会话根目录下的全部会话文件(claude-code、
 *      codebuddy、deepseek;读不了的来源跳过并提示一次,D12);路径升序:同一会话的主文件排在它的
 *      subagents/ 文件前面,先到先写的 session_head 才保得住「会话开始取本会话第一条消息」;大小和
 *      mtime 都没变的直接跳过(实测 3,221 个文件几十毫秒),一个都没变就不开库、不拿锁
 *   3. 有要处理的先拿项目数据目录的 ingest.lock(写法沿用 project/merge-files.ts:wx 独占创建、
 *      pid 不活或超 2 小时算陈旧;最多等 3 秒,等不到 → busy,查询照常执行)
 *   4. 逐文件:认 start_cwd(新文件读会话头;subagents/ 下的文件跟主会话)。开始目录还在就现认
 *      ——同一趟按目录记住,git 按根只跑一次;不在了才用 start_dirs 缓存,再退到本项目库的
 *      timeline_roots 与副本登记(K1)。归当前项目的文件从上次偏移增量读到最后一个完整行,事实映射
 *      成事件按 source_key 去重(D5)写库,顺手 upsert timeline_roots(hook 退役后这里是它的写入方,
 *      不然删掉目录的会话再认不回来)
 *   5. 项目库提交之后才更新 sessions.db 的偏移(D4:反过来的话中断会丢事件);别的项目的文件不代
 *      推进偏移——它的项目自己补
 *
 * 读路径从只读变可能写库:本模块任何失败都只变成 status / notices,不抛出;提示由 describeSyncOutcome
 * 渲染、调用方写 stderr,查询的退出码与 stdout 不受影响(--json 的结果不混提示)。
 */

import * as fs from 'node:fs';
import * as path from 'node:path';

import { listSessionSources, type SessionSource } from '../../agents';
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
import { TimelineStore, upsertSessionTitle, type SessionTitleUpsert } from '../store';
import type { TimelineEventInput } from '../types';
import { rebuildTimeline } from './rebuild';
import { sessionFactsReader } from './reader';
import type { SessionFact, SessionFactTs, SessionFactsReader, SessionFileReadResult } from './types';

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

/** 门面入口(C-4)。内部顺序:开关关闭 → 旧数据没并过 → F6 重建(T-4,只一次)→ 老会话标题回填(D9,只一次)→ DeepSeek 已有标题重算(D10,只一次)→ 增量补录。 */
export async function ensureTimelineUpToDate(start: string): Promise<TimelineSyncOutcome> {
  try {
    // F1 ④:开关关了不补录、不碰库,也不提示
    if (isKillSwitchOn()) return { status: 'skipped-disabled', notices: [] };
    // F1 ③ / K25:旧数据还没并过的目录,时间线停在升级前,提示先 install(经 project 门面取,
    // timeline⇄project 双向引用是 spec D3 定的复用,运行期函数调用无碍)
    if (hasUnmergedLegacyData(start)) return { status: 'skipped-legacy', notices: [] };
    // F6(T-4):timeline_meta 无 rebuilt_at → 先全量重建再增量;重建过 → null,直接增量
    const rebuilt = await rebuildTimeline(start);
    if (rebuilt !== null && rebuilt.status === 'busy') return { status: 'busy', notices: [] };
    if (rebuilt !== null && rebuilt.status === 'failed') {
      return { status: 'failed', reason: rebuilt.reason, notices: [] };
    }
    // D9 老会话标题回填:装上这版之前的补录只写过事件、没写过标题,补一次;拿不到锁静默下次再来,
    // 不影响随后的增量与查询。重建自己从头读过全部文件(commitRebuild 已写记号),这里自然跳过;
    // 失败的提示随本次结果一起出
    const backfillNotices = await backfillSessionTitles(start);
    // D10 已有标题重算:老补录把 DeepSeek 子会话标题也归给了主会话,读取器改完后按新规则重算一次;
    // 同样拿不到锁静默下次再来,失败的提示随本次结果一起出
    const refreshNotices = await refreshDeepSeekSessionTitles(start);
    const outcome = await ingestIncremental(start);
    const merged = { ...outcome, notices: [...backfillNotices, ...refreshNotices, ...outcome.notices] };
    if (rebuilt === null || rebuilt.status === 'mark-only') return merged;
    // 重建的汇总在前(F6 图「记下重建过了、输出重建了多少」);增量紧随其后几乎总是空趟(偏移刚推进
    // 到位),就算有也是重建期间新追加的内容,数字直接相加
    return {
      status: 'rebuilt',
      sessions: (rebuilt.sessions ?? 0) + (merged.sessions ?? 0),
      events: (rebuilt.events ?? 0) + (merged.events ?? 0),
      notices: [...rebuilt.notices, ...merged.notices],
    };
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
      return ['时间线正在补录,结果可能缺最近的', ...outcome.notices];
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

// ─── 老会话标题回填(D9,plan C-2)────────────────────────────────────────────

/** timeline_meta 里「老会话标题回填过了」的键(D9);值 = 写入时间(ISO)。重建在 commitRebuild 的
 *  并库短事务里写(重建从头读过全部文件,不再回填),回填在 backfillSessionTitles 写。 */
export const SESSION_TITLES_AT_KEY = 'session_titles_at';

/** timeline_meta 里「DeepSeek 已有标题按新规则重算过了」的键(D10);值 = 写入时间(ISO)。重建的并库
 *  短事务与回填都会顺手写上(它们已按新规则写过标题),重算自己在 refreshDeepSeekSessionTitles 写。 */
export const SESSION_TITLES_REFRESH_AT_KEY = 'session_titles_refresh_at';

/** 标题重算只跑这一个来源(D10):「子会话不产标题」的判据只在 deepseek 读取器里。 */
const TITLE_REFRESH_SOURCE_ID = 'deepseek';

/** timeline_meta 读一个键;没有 → null。 */
export function readMetaValue(db: SqliteDatabase, key: string): string | null {
  const row = db.prepare('SELECT value FROM timeline_meta WHERE key = ?').get(key) as
    | { value: string }
    | undefined;
  return row === undefined ? null : row.value;
}

/** timeline_meta 写一个键(值取当前时间;键已在我们这条链上定义)。 */
export function writeMetaNow(db: SqliteDatabase, key: string): void {
  db.prepare('INSERT OR REPLACE INTO timeline_meta (key, value) VALUES (?, ?)').run(key, new Date().toISOString());
}

/**
 * 老会话标题回填(D9):装上这版之前的补录只写事件、没写标题——项目库 timeline_meta 无
 * session_titles_at 时,把 sessions.db 里 `project_dir` 等于本项目目录的全部文件从偏移 0 重读
 * 一遍,只取 session_title 事实写标题表;不写事件、不推进偏移、不改 size/mtime 行(否则下次
 * 增量会整段重读)。一个项目只回填一次;和全量重建同一把 ingest.lock,拿不到(别的进程在补录)
 * 就静默跳过、下次再来。失败提示一次返回给调用方(记号没写,下一趟会重试)——不静默吞掉:
 * 标题可能已写进、唯独记号写不进的持续故障下,每次查询都会重做整套回填,得让人看得见。
 */
async function backfillSessionTitles(start: string): Promise<string[]> {
  const root = findProjectRoot(start);
  if (root === null) return [];
  const loc = locateDataAtRoot(root);
  // 同增量的静默分支:项目目录不在就没有可回填的库;库文件不在 = 还没记过任何数据,也不建库
  if (loc.mode !== 'project' || loc.dataDir === null || loc.projectDirName === null) return [];
  const dataDir = loc.dataDir;
  const dbPath = path.join(dataDir, DATABASE_FILENAME);
  if (!fs.existsSync(dbPath)) return [];
  const sessionIndex = openSessionIndex();
  let conn: DatabaseConnection | null = null;
  try {
    // 同全量重建一把锁(D9):拿不到(别的进程在补录)就下次再来
    if (!acquireIngestLock(dataDir)) return [];
    conn = DatabaseConnection.open(dbPath);
    const db = conn.getDb();
    ensureTimelineSchema(db); // 旧库补上标题表(幂等)
    // 等锁期间可能已被别的进程回填过:重查一次记号
    if (readMetaValue(db, SESSION_TITLES_AT_KEY) !== null) return [];
    // 逐来源读本项目已归属的文件(sessions.db 按 agent 列,全部来源并起来就是全部行)
    for (const source of listSessionSources()) {
      // 读不了的来源(如 Node 没有 zstd API 的 deepseek)解析不出标题,跳过
      if (source.unavailableReason() !== null) continue;
      const reader = sessionFactsReader(source.sessionReader);
      for (const row of sessionIndex.listSessionFiles(source.id)) {
        if (row.project_dir !== loc.projectDirName) continue;
        const titles = await readTitleFacts(reader, row.path);
        if (titles.length === 0) continue;
        db.transaction(() => {
          for (const title of titles) upsertSessionTitle(db, title);
        })();
      }
    }
    writeMetaNow(db, SESSION_TITLES_AT_KEY);
    // 回填已按新规则读过一遍标题(deepseek 子会话的标题本来就不算),顺手写 D10 的重算记号,
    // 免得随后的重算把同一批文件再读一遍
    writeMetaNow(db, SESSION_TITLES_REFRESH_AT_KEY);
    return [];
  } catch (err) {
    // 回填失败不影响查询:记号没写,下一趟重试;提示一次让人看得见
    return [`老会话标题回填失败:${shortReason(err)},下一趟会重试`];
  } finally {
    try {
      conn?.close();
    } catch {
      // 关不上不影响结果
    }
    releaseIngestLock(dataDir); // 只删本进程拿的锁,没拿到时是 no-op
    sessionIndex.close();
  }
}

/** 从偏移 0 读一个会话文件,只取标题事实;文件没了 / 读失败只丢这一个文件,不拖垮整个回填。 */
async function readTitleFacts(reader: SessionFactsReader, file: string): Promise<SessionTitleUpsert[]> {
  try {
    const result = await reader(file, 0);
    return titleUpserts(result.facts);
  } catch {
    return [];
  }
}

/** 重算时一次 DELETE 带几个会话编号(低于 SQLite 的参数上限;covered 可能上千)。 */
const TITLE_DELETE_BATCH = 500;

/**
 * DeepSeek 已有标题一次性重算(D10):装上这版之前的补录把子会话标题也归给了主会话,子会话标题
 * 可能盖掉了主会话自己的标题。读取器改完后,把 sessions.db 里本项目已归属的 deepseek 文件从偏移 0
 * 重读一遍,只取标题事实:先删这些文件覆盖到的会话(covered,按会话头算)的标题行,再按新规则
 * 重写——没有文件的旧会话一行不动,读不出的文件跳过、旧行保留。一个项目只算一次(记号
 * session_titles_refresh_at);和回填 / 重建同一把 ingest.lock,拿不到就静默下次再来。
 * deepseek 来源读不了(旧 Node 没有 zstd)时不写记号,等能读时再算(D12)。
 * 失败提示一次返回给调用方(记号没写,下一趟会重试),不静默吞掉。
 */
async function refreshDeepSeekSessionTitles(start: string): Promise<string[]> {
  const root = findProjectRoot(start);
  if (root === null) return [];
  const loc = locateDataAtRoot(root);
  // 同回填的静默分支:项目目录不在就没有可重算的库;库文件不在 = 还没记过任何数据,也不建库
  if (loc.mode !== 'project' || loc.dataDir === null || loc.projectDirName === null) return [];
  const dataDir = loc.dataDir;
  const dbPath = path.join(dataDir, DATABASE_FILENAME);
  if (!fs.existsSync(dbPath)) return [];
  const sessionIndex = openSessionIndex();
  let conn: DatabaseConnection | null = null;
  try {
    // 同回填 / 重建一把锁:拿不到(别的进程在补录)就下次再来
    if (!acquireIngestLock(dataDir)) return [];
    conn = DatabaseConnection.open(dbPath);
    const db = conn.getDb();
    ensureTimelineSchema(db); // 旧库补上标题表(幂等)
    // 等锁期间可能已被别的进程算过:重查一次记号
    if (readMetaValue(db, SESSION_TITLES_REFRESH_AT_KEY) !== null) return [];
    // 只算 deepseek:别家读取器的标题规则没变;来源读不了就不写记号,等能读时再算
    const source = listSessionSources().find((s) => s.id === TITLE_REFRESH_SOURCE_ID);
    if (source === undefined || source.unavailableReason() !== null) return [];
    const reader = sessionFactsReader(source.sessionReader);
    // 收集阶段只读不写:全部读完再一个事务里删 + 写,中途失败不留半套标题
    const covered = new Set<string>();
    const titles: SessionTitleUpsert[] = [];
    for (const row of sessionIndex.listSessionFiles(source.id)) {
      if (row.project_dir !== loc.projectDirName) continue;
      try {
        const result = await reader(row.path, 0);
        for (const fact of result.facts) {
          if (fact.kind === 'session_head') covered.add(fact.sessionId);
        }
        titles.push(...titleUpserts(result.facts));
      } catch {
        // 单文件读失败只跳过它:这个会话的旧标题行保留(D10)
      }
    }
    const ids = [...covered];
    // 这个项目没有 deepseek 会话(最常见)时不开写事务,只写记号
    if (ids.length > 0 || titles.length > 0) {
      db.transaction(() => {
        // 只删读得到的会话(covered),不删全表:文件已不在的旧会话标题保留
        for (let i = 0; i < ids.length; i += TITLE_DELETE_BATCH) {
          const batch = ids.slice(i, i + TITLE_DELETE_BATCH);
          const marks = batch.map(() => '?').join(', ');
          db.prepare(`DELETE FROM timeline_session_titles WHERE session_id IN (${marks})`).run(...batch);
        }
        for (const title of titles) upsertSessionTitle(db, title);
      })();
    }
    writeMetaNow(db, SESSION_TITLES_REFRESH_AT_KEY);
    return [];
  } catch (err) {
    // 重算失败不影响查询:记号没写,下一趟重试;提示一次让人看得见
    return [`会话标题重算失败:${shortReason(err)},下一趟会重试`];
  } finally {
    try {
      conn?.close();
    } catch {
      // 关不上不影响结果
    }
    releaseIngestLock(dataDir); // 只删本进程拿的锁,没拿到时是 no-op
    sessionIndex.close();
  }
}

// ─── 补录主体 ────────────────────────────────────────────────────────────────

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

/** K11:整份读出内容却一条事实都没有的文件,按 agent 显示名 + 行内 version 计数(增量与重建共用)。 */
export interface UnparsedTally {
  display: string;
  version: string | null;
  count: number;
}

export type UnparsedMap = Map<string, UnparsedTally>;

/** 读取器抛错的文件(增量与重建共用):按来源显示名 + 原因首行计数,单文件隔离不拖垮整趟。 */
export interface ReadFailedTally {
  display: string;
  reason: string;
  count: number;
}

export type ReadFailedMap = Map<string, ReadFailedTally>;

/** 原因取错误消息的第一行、截到 80 字,提示不被长堆栈撑爆。 */
function shortReason(err: unknown): string {
  const first = errorMessage(err).split('\n')[0] ?? '';
  return [...first].slice(0, 80).join('');
}

/** 记一个读取失败的文件(按显示名 + 原因聚合)。 */
export function noteReadFailed(map: ReadFailedMap, source: SessionSource, err: unknown): void {
  const reason = shortReason(err);
  const key = `${source.displayName}\0${reason}`;
  const cur = map.get(key);
  if (cur === undefined) map.set(key, { display: source.displayName, reason, count: 1 });
  else cur.count += 1;
}

/** 读取失败的人读提示:偏移没推进,文件修复 / 删除后下一趟自动重试。 */
export function readFailedNotices(map: ReadFailedMap): string[] {
  return [...map.values()].map(
    (f) => `${f.display} 的会话文件有 ${f.count} 个读取失败(${f.reason}),时间线可能不全;文件修复或删除后会自动重试`,
  );
}

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

/** 一趟补录的共享上下文。 */
interface IngestContext extends ClassificationContext, FactMappingContext {
  /** sessions.db 里的会话文件进度(处理过程中随手更新,subagents/ 文件跟主会话时读得到新值) */
  readonly rows: Map<string, SessionFileRow>;
  /** K11:整份读不出事实的文件,按 agent 显示名 + 行内 version 计数 */
  readonly unparsed: UnparsedMap;
  /** 读取器抛错的文件(坏帧、读不出会话头等),按来源显示名 + 原因计数;偏移不推进,下一趟重试 */
  readonly readFailed: ReadFailedMap;
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export function statOrNull(file: string): FileStat | null {
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
  // conn / countBefore 在 projectDb 闭包里赋值,闭包外的判空要按声明类型取值(下面取了一次别名)
  let conn: DatabaseConnection | null = null;
  let countBefore: number | null = null;
  const openConn = (): DatabaseConnection | null => conn;
  try {
    // 候选文件与快速筛选:大小和 mtime 都没变的跳过(含别的项目的——进度一行一份,别家文件
    // 变了归别家的运行补,这里只看要不要重新认)。读不了的来源(如 Node 没有 zstd API 的
    // deepseek)跳过列举、提示一次(D12)
    const rows = new Map<string, SessionFileRow>();
    const pending: Array<{ source: SessionSource; file: string; stat: FileStat }> = [];
    let unavailableNotice: string | null = null;
    for (const source of listSessionSources()) {
      const sessionsRoot = source.sessionsRoot();
      if (sessionsRoot === null) continue;
      const reason = source.unavailableReason();
      if (reason !== null) {
        unavailableNotice ??= reason;
        continue;
      }
      for (const row of sessionIndex.listSessionFiles(source.id)) rows.set(row.path, row);
      for (const file of source.listFiles(sessionsRoot)) {
        const stat = statOrNull(file);
        if (stat === null) continue; // 文件没了(F1 ⑤):已记进时间线的留着,这里跳过
        const known = rows.get(file);
        if (known !== undefined && known.size === stat.size && known.mtime_ms === stat.mtimeMs) continue;
        pending.push({ source, file, stat });
      }
    }
    const notices = unavailableNotice !== null ? [unavailableNotice] : [];
    if (pending.length === 0) return { status: 'synced', notices };

    // busy 也带上来源不可用提示(如「DeepSeek 会话要 Node 22.15 以上」):别让它只在无锁竞争的趟出现
    if (!acquireIngestLock(dataDir)) return { status: 'busy', notices };
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
        readFailed: new Map(),
        sessionsWritten: new Set(),
        classified: new Map(),
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
        // 单文件隔离:读取器抛错(坏帧、读不出会话头等)只丢这一个文件,不卡住排序在后的文件、
        // 不拖垮整趟;偏移不推进(saveRow 没执行),文件修复或删除后下一趟自动重试
        try {
          await processFile(item.file, item.source, item.stat, fresh ?? null, ctx);
        } catch (err) {
          noteReadFailed(ctx.readFailed, item.source, err);
        }
      }

      const dbConn = openConn();
      const events = dbConn !== null ? Math.max(0, countEvents(dbConn.getDb()) - (countBefore ?? 0)) : 0;
      return {
        status: 'synced',
        sessions: ctx.sessionsWritten.size,
        events,
        notices: [...notices, ...unparsedNotices(ctx.unparsed), ...readFailedNotices(ctx.readFailed)],
      };
    } finally {
      releaseIngestLock(dataDir);
    }
  } finally {
    try {
      openConn()?.close();
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
  source: SessionSource,
  stat: FileStat,
  row: SessionFileRow | null,
  ctx: IngestContext,
): Promise<void> {
  let startCwd: string | null = row?.start_cwd ?? null;

  // subagents/ 下的文件跟主会话(spec D2 表注,claude/codebuddy 布局;deepseek 路径没有这一段,
  // subagentMainPath 自然返回 null,会话头读自己文件里的开始目录):主会话文件的 start_cwd 已认出
  // 就用它的(本轮先处理主文件,rows 里是最新值);主文件不在 / 没认出时退回自己读头
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
    const result = await sessionFactsReader(source.sessionReader)(file, fromOffset);
    writeFacts(file, source, stat, result, startCwd, cls, ctx, fullRead, row?.session_id ?? null);
    return;
  }

  // start_cwd 未知:从头读,拿会话头认归属
  const result = await sessionFactsReader(source.sessionReader)(file, 0);
  const head = result.facts.find((f): f is Extract<SessionFact, { kind: 'session_head' }> => f.kind === 'session_head');
  if (head === undefined) {
    // 一条带 cwd 的行都没有(spec D3「再不行」):留空不处理;记一行免得每趟重读
    saveRow(ctx, file, source, stat, { start_cwd: null, project_dir: null, byte_offset: 0, session_id: null });
    return;
  }
  const cls = classifyStartDir(head.startCwd, ctx);
  if (cls.dirName !== ctx.currentDirName) {
    // 认出来了但不是本项目:记下归属,偏移不代推进(它的项目自己补)
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
  if (source.sessionReader !== 'deepseek-session') return sessionFileId(file);
  return facts[0]?.sessionId ?? fallback;
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
