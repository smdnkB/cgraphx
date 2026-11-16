/**
 * 补录管线入口(spec F1;plan T-1、C-1):查时间线之前,把各家 agent 会话文件里新增的部分解析成事件
 * 写进这个项目的项目库。单文件处理管线(归属判定、事实 → 事件映射、单文件落库)拆在 facts.ts,结果
 * 形状与覆盖判定(D4:complete / partial / blocked)在 coverage.ts,全量重建(F6)在 rebuild.ts、由
 * 同一入口在增量之前执行(T-4)。
 *
 * 流程:开关关闭 → skipped-disabled、旧数据没并过(K25)→ skipped-legacy,都不碰库;没重建过
 * (timeline_meta 无 rebuilt_at)→ 先全量重建再增量;重建之后、增量之前,老会话标题回填(D9)、
 * DeepSeek 标题重算(D10)、Codex 提问回填各做一次(都只一次)。增量(ingestIncremental)经
 * listSessionSources() 枚举来源,读不了的来源跳过并提示一次(D12);大小和 mtime 都没变的直接跳过,
 * 一个都没变就不开库、不拿锁;有要处理的拿 ingest.lock(等不到 → busy,查询照常),逐文件走
 * facts.ts 的 processFile。
 *
 * 覆盖(D4):blocked = 没补成(锁竞争、关闭、旧库未合并、项目数据不可用、全局失败);partial = 补过
 * 但有缺口(单文件读取失败、解析不出、认不出归属、来源读不了、全部来源无文件);其余 complete。
 * 重建 + 增量合并取更差的一档;缺口的人读提示随 notices 出。
 *
 * 读路径从只读变可能写库:本模块任何失败都只变成 status / notices,不抛出;提示由 describeSyncOutcome
 * 渲染、调用方写 stderr,查询的退出码与 stdout 不受影响(--json 的结果不混提示)。
 */

import * as fs from 'node:fs';
import * as path from 'node:path';

import { listSessionSources, type SessionSource } from '../../agents';
import { findProjectRoot, locateDataAtRoot } from '../../data-location';
import { DatabaseConnection, DATABASE_FILENAME, type SqliteDatabase } from '../../db';
import { hasUnmergedLegacyData } from '../../project';
import { listReplicas } from '../../replica';
import { createRootMatcher, type RootMatcher } from '../../root-match';
import { openSessionIndex, type SessionFileRow } from '../../session-index';
import { isKillSwitchOn } from '../kill-switch';
import { readRootRows } from '../roots';
import { ensureTimelineSchema } from '../schema-bootstrap';
import { TimelineStore, upsertSessionTitle, type SessionTitleUpsert } from '../store';
import { rebuildTimeline } from './rebuild';
import {
  mapFacts,
  processFile,
  statOrNull,
  titleUpserts,
  unparsedNotices,
  type FactMappingContext,
  type FileStat,
  type IngestContext,
} from './facts';
import { sessionFactsReader } from './reader';
import { sessionAdapterContext, sessionAdapterFor } from './adapters';
import type { SessionFactsReader } from './types';
import {
  errorMessage,
  noteReadFailed,
  NO_SESSION_FILES_NOTICE,
  readFailedNotices,
  shortReason,
  unattributedNotices,
  worseCoverage,
  type TimelineSyncOutcome,
} from './coverage';

// 拆分兼容再导出(T-1):结果形状、覆盖判定与人读渲染挪进 coverage.ts,单文件管线挪进 facts.ts——
// 这里按原路径再导出 ingest.ts 原有的全部导出,既有引用(git 提交钩子、重建、门面)不用改
export {
  describeSyncOutcome, noteReadFailed, readFailedNotices, shortReason,
  type ReadFailedMap, type ReadFailedTally, type TimelineCoverage, type TimelineSyncOutcome, type TimelineSyncStatus,
} from './coverage';
export {
  classifyStartDir, mapFacts, noteUnparsed, rowSessionId, sessionFileId, statOrNull, subagentMainPath,
  titleUpserts, unparsedNotices, upsertRoot,
  type ClassificationContext, type DirClassification, type FactMappingContext, type FileStat,
  type UnparsedMap, type UnparsedTally,
} from './facts';

/** 门面入口(C-4)。内部顺序:开关关闭 → 旧数据没并过 → F6 重建(T-4,只一次)→ 老会话标题回填(D9,只一次)→ DeepSeek 已有标题重算(D10,只一次)→ Codex 提问回填 → 增量补录。coverage 按 D4 判,重建 + 增量取更差的一档。 */
export async function ensureTimelineUpToDate(start: string): Promise<TimelineSyncOutcome> {
  try {
    // F1 ④:开关关了不补录、不碰库,也不提示;D4:采集关闭 → blocked
    if (isKillSwitchOn()) return { status: 'skipped-disabled', coverage: 'blocked', notices: [] };
    // F1 ③ / K25:旧数据还没并过的目录,时间线停在升级前,提示先 install(经 project 门面取,
    // timeline⇄project 双向引用是 spec D3 定的复用,运行期函数调用无碍);D4:旧库未合并 → blocked
    if (hasUnmergedLegacyData(start)) return { status: 'skipped-legacy', coverage: 'blocked', notices: [] };
    // F6(T-4):timeline_meta 无 rebuilt_at → 先全量重建再增量;重建过 → null,直接增量
    const rebuilt = await rebuildTimeline(start);
    if (rebuilt !== null && rebuilt.status === 'busy') return { status: 'busy', coverage: 'blocked', notices: [] };
    if (rebuilt !== null && rebuilt.status === 'failed') {
      return { status: 'failed', coverage: 'blocked', reason: rebuilt.reason, notices: [] };
    }
    // D9 老会话标题回填:装上这版之前的补录只写过事件、没写过标题,补一次;拿不到锁静默下次再来,
    // 不影响随后的增量与查询。重建自己从头读过全部文件(commitRebuild 已写记号),这里自然跳过;
    // 失败的提示随本次结果一起出
    const backfillNotices = await backfillSessionTitles(start);
    // D10 已有标题重算:老补录把 DeepSeek 子会话标题也归给了主会话,读取器改完后按新规则重算一次;
    // 同样拿不到锁静默下次再来,失败的提示随本次结果一起出
    const refreshNotices = await refreshDeepSeekSessionTitles(start);
    const codexNotices = await backfillCodexPrompts(start);
    const outcome = await ingestIncremental(start);
    const merged = { ...outcome, notices: [...backfillNotices, ...refreshNotices, ...codexNotices, ...outcome.notices] };
    if (rebuilt === null || rebuilt.status === 'mark-only') return merged;
    // 重建的汇总在前(F6 图「记下重建过了、输出重建了多少」);增量紧随其后几乎总是空趟(偏移刚推进
    // 到位),就算有也是重建期间新追加的内容,数字直接相加;覆盖取更差的一档(重建的缺口 + 增量的缺口)
    return {
      status: 'rebuilt',
      coverage: worseCoverage(rebuilt.coverage, merged.coverage),
      sessions: (rebuilt.sessions ?? 0) + (merged.sessions ?? 0),
      events: (rebuilt.events ?? 0) + (merged.events ?? 0),
      notices: [...rebuilt.notices, ...merged.notices],
    };
  } catch (err) {
    // D4:全局失败 → blocked
    return { status: 'failed', coverage: 'blocked', reason: errorMessage(err), notices: [] };
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

/** 回填旧读取器遗漏的 Codex 用户消息,不改会话文件的增量偏移。 */
async function backfillCodexPrompts(start: string): Promise<string[]> {
  const root = findProjectRoot(start);
  if (root === null) return [];
  const loc = locateDataAtRoot(root);
  if (loc.mode !== 'project' || loc.dataDir === null || loc.projectDirName === null || loc.identity === null) return [];
  const dataDir = loc.dataDir;
  const dbPath = path.join(dataDir, DATABASE_FILENAME);
  if (!fs.existsSync(dbPath)) return [];
  const source = listSessionSources().find(item => item.id === 'codex');
  if (!source) return [];
  const index = openSessionIndex();
  let conn: DatabaseConnection | null = null;
  try {
    if (!acquireIngestLock(dataDir)) return [];
    conn = DatabaseConnection.open(dbPath);
    const db = conn.getDb();
    ensureTimelineSchema(db);
    const marker = 'codex_prompt_backfill_v1';
    if (readMetaValue(db, marker) !== null) return [];
    const removedAt = index.removedProjectAt(loc.identity);
    const removedMs = removedAt === null ? NaN : Date.parse(removedAt);
    const ctx: FactMappingContext = { projectDb: () => db, removedAtMs: Number.isFinite(removedMs) ? removedMs : null, sessionsWritten: new Set() };
    const hasPrompts = db.prepare("SELECT 1 FROM timeline_events WHERE agent = 'codex' AND event_type = 'user_prompt' AND session_id = ? LIMIT 1");
    const eligible = new Map<string, boolean>();
    const store = new TimelineStore(db);
    for (const row of index.listSessionFiles('codex')) {
      if (row.project_dir !== loc.projectDirName || !row.start_cwd || !fs.existsSync(row.path)) continue;
      const result = await sessionFactsReader(source.sessionReader)(row.path, 0);
      const prompts = result.facts.filter(fact => {
        if (fact.kind !== 'prompt') return false;
        if (!eligible.has(fact.sessionId)) eligible.set(fact.sessionId, hasPrompts.get(fact.sessionId) === undefined);
        return eligible.get(fact.sessionId) === true;
      });
      const events = mapFacts(prompts, source, row.start_cwd, ctx);
      db.transaction(() => { for (const event of events) store.insert(event); })();
    }
    writeMetaNow(db, marker);
    return [];
  } catch (err) {
    return [`Codex 会话提问回填失败:${shortReason(err)},下一趟会重试`];
  } finally {
    try { conn?.close(); } catch { /* 尽力关闭 */ }
    releaseIngestLock(dataDir);
    index.close();
  }
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

// ─── 增量补录 ────────────────────────────────────────────────────────────────

async function ingestIncremental(start: string): Promise<TimelineSyncOutcome> {
  const root = findProjectRoot(start);
  // D4:没有可落库的项目数据(没认出根、项目目录不在)→ blocked;查询自己会报错,这里仍静默
  if (root === null) return { status: 'synced', coverage: 'blocked', notices: [] };
  const loc = locateDataAtRoot(root);
  // 项目目录不在(没装过也从没记过数据)就没有落库的地方:查询会报自己的错,这里静默不补
  if (loc.mode !== 'project' || loc.dataDir === null || loc.projectDirName === null || loc.identity === null) {
    return { status: 'synced', coverage: 'blocked', notices: [] };
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
    let filesListed = 0;
    for (const source of listSessionSources()) {
      const adapter = sessionAdapterFor(source.sessionReader);
      const context = sessionAdapterContext(root);
      const reason = adapter.unavailableReason(context);
      if (reason !== null) {
        unavailableNotice ??= reason;
        continue;
      }
      for (const row of sessionIndex.listSessionFiles(source.id)) rows.set(row.path, row);
      const files = await adapter.listSessionFiles(context);
      filesListed += files.length;
      for (const file of files) {
        const stat = statOrNull(file);
        if (stat === null) continue; // 文件没了(F1 ⑤):已记进时间线的留着,这里跳过
        const known = rows.get(file);
        if (known !== undefined && known.project_dir !== null && known.size === stat.size && known.mtime_ms === stat.mtimeMs) continue;
        pending.push({ source, file, stat });
      }
    }
    const notices = unavailableNotice !== null ? [unavailableNotice] : [];
    if (pending.length === 0) {
      // D4:可用来源一个文件都没有 → partial 并说明无来源;有文件但读不了的来源在 → partial;
      // 其余(全部处理到位、没有要处理的)→ complete。没装的来源(目录不在)不算失败,不单独报错
      const noSources = filesListed === 0;
      return {
        status: 'synced',
        coverage: unavailableNotice !== null || noSources ? 'partial' : 'complete',
        notices: noSources ? [...notices, NO_SESSION_FILES_NOTICE] : notices,
      };
    }

    // busy 也带上来源不可用提示(如「DeepSeek 会话要 Node 22.15 以上」):别让它只在无锁竞争的趟出现;
    // D4:锁竞争 → blocked
    if (!acquireIngestLock(dataDir)) return { status: 'busy', coverage: 'blocked', notices };
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
        unattributed: new Map(),
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
          if (fresh.project_dir !== null && fresh.size === item.stat.size && fresh.mtime_ms === item.stat.mtimeMs) continue;
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
      // D4:处理过但有缺口(来源读不了 / 读取失败 / 解析不出 / 认不出归属)→ partial,不称完整
      const gaps =
        unavailableNotice !== null ||
        ctx.readFailed.size > 0 ||
        ctx.unparsed.size > 0 ||
        ctx.unattributed.size > 0;
      return {
        status: 'synced',
        coverage: gaps ? 'partial' : 'complete',
        sessions: ctx.sessionsWritten.size,
        events,
        notices: [
          ...notices,
          ...unparsedNotices(ctx.unparsed),
          ...readFailedNotices(ctx.readFailed),
          ...unattributedNotices(ctx.unattributed),
        ],
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
