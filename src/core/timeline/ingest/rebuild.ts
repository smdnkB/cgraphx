/**
 * 时间线全量重建(spec F6、D19;plan T-4):升级后第一次 install 或这个项目第一次查时间线时,清掉
 * hook 记的旧事件、按会话文件解析全量重建——提交记录是 git 钩子记的,保留(K23、K24);一个项目只重建
 * 一次(记号:项目库 timeline_meta 的 rebuilt_at,跟着项目数据走,worktree / 副本再触发也不重来)。
 *
 * 流程(D19,顺序钉死):
 *   1. 拿项目数据目录的 ingest.lock(拿不到 → busy,下次重来);开关(CGRAPHX_NO_TIMELINE)在入口
 *      (ingest.ts 的 ensureTimelineUpToDate)判,这里不再判
 *   2. 项目库 timeline_meta 已有 rebuilt_at(等锁期间别的进程刚重建完)→ 不再重建
 *   3. removed_projects 有这个项目(K3 删过数据)→ 只写 rebuilt_at、不全量解析——旧会话不补回,
 *      之后的增量只收删除之后的事实
 *   4. 全量解析这个项目的会话文件(经 agents 门面的 listSessionSources() 枚举各来源——claude-code、
 *      codebuddy、deepseek,读不了的来源跳过、提示由随后的增量补一趟;归属判定与事实映射复用
 *      ingest.ts 同一套函数,路径升序:主文件先于
 *      subagents/,session_head 先到先得),事件写进项目数据目录下的临时库 rebuild.tmp.db(先删残留再建,
 *      应用 timeline schema)。sessions.db 里已记到别的项目、偏移又大于 0 的文件不从头读(交给增量,
 *      免得改名后新项目把旧历史再解析一遍)。解析期间不碰项目库——「整个解析放一个事务」是 spec 明确
 *      没选的方案:持写锁十几秒,这期间的提交记录会写失败,而提交记录补不回来
 *   5. 项目库一个短事务(秒级)里:ATTACH 临时库 → 删非提交事件(K24,不备份)→ INSERT SELECT 临时库
 *      事件 → 并 timeline_roots 与标题表(同命运:清旧、并新)→ 写 rebuilt_at 与 session_titles_at、
 *      session_titles_refresh_at(重建从头读过全部文件,标题已齐,回填与 DeepSeek 标题重算都不必再来)
 *      → 提交。记号必须写在这个事务里:写在事务外,
 *      中断后会误判「重建过」。失败即回滚,清和写一起撤销,时间线还是旧的;重建中途杀进程同理
 *   6. 提交之后才收尾(单项失败不再报 failed——重建已经成立,顶多留残渣下次再清):推进 sessions.db 里
 *      这个项目全部文件的偏移(读到哪推进到哪,不取文件当前大小:重建期间又被追加的,下一趟增量接着
 *      读,不丢行)、删数据目录下 turns/、删 ~/.cgraphx/sessions/(旧会话登记目录,和 sessions.db 是
 *      两回事)、删临时库(含 -wal/-shm)、项目库 VACUUM
 *
 * 任何失败返回 failed(不抛),由调用方决定怎么提示;锁在 finally 里放。
 */

import * as fs from 'node:fs';
import * as path from 'node:path';

import { listSessionSources, type SessionSource } from '../../agents';
import { findProjectRoot, locateDataAtRoot } from '../../data-location';
import { DatabaseConnection, DATABASE_FILENAME, type SqliteDatabase } from '../../db';
import { listReplicas } from '../../replica';
import { createRootMatcher, type RootMatcher } from '../../root-match';
import { openSessionIndex, type SessionFileRow, type SessionIndex } from '../../session-index';
import { sessionsRoot } from '../../user-data-dir';
import { readRootRows } from '../roots';
import { ensureTimelineSchema } from '../schema-bootstrap';
import { TimelineStore, upsertSessionTitle } from '../store';
import {
  acquireIngestLock,
  classifyStartDir,
  mapFacts,
  noteReadFailed,
  noteUnparsed,
  readFailedNotices,
  releaseIngestLock,
  rowSessionId,
  SESSION_TITLES_AT_KEY,
  SESSION_TITLES_REFRESH_AT_KEY,
  statOrNull,
  titleUpserts,
  unparsedNotices,
  upsertRoot,
  writeMetaNow,
  type ClassificationContext,
  type DirClassification,
  type FactMappingContext,
  type ReadFailedMap,
  type FileStat,
  type UnparsedMap,
} from './ingest';
import { sessionFactsReader } from './reader';
import { sessionAdapterContext, sessionAdapterFor } from './adapters';
import type { SessionFact, SessionFileReadResult } from './types';

/** 重建结果;rebuildTimeline 返回 null 表示不用重建(已重建过 / 这个目录没有项目库)。 */
export interface RebuildOutcome {
  status: 'rebuilt' | 'mark-only' | 'busy' | 'failed';
  /** 重建写进项目库的会话数 */
  sessions?: number;
  /** 重建写进项目库的事件数 */
  events?: number;
  /** K11 的人读提示 */
  notices: string[];
  /** failed 的原因 */
  reason?: string;
}

/** timeline_meta 里「这个项目重建过了」的键(K23);值 = 写入时间(ISO)。 */
const REBUILT_AT_KEY = 'rebuilt_at';

/** 临时库文件名(项目数据目录下;-wal/-shm 一并清)。 */
const REBUILD_TMP_FILENAME = 'rebuild.tmp.db';

/** ATTACH 用的临时库别名。 */
const TMP_ALIAS = 'rebuild_tmp';

/** 临时库并进项目库的事件列(id 除外;两边库都应用过 timeline schema,列已对齐)。 */
const EVENT_COLUMNS =
  'ts, session_id, event_type, tool_name, tool_args, tool_result_summary, prompt_text, duration_ms, ' +
  'commit_hash, commit_message, commit_files, cwd, metadata, turn_id, commit_insertions, ' +
  'commit_deletions, agent, source_key';

/** 轮次记录目录名(相对数据目录;hook 时代的 turns/,重建后没人读写,顺手删掉)。 */
const TURNS_DIRNAME = 'turns';

/** 全量解析进临时库后要推进的进度(项目库提交之后才写 sessions.db,D4)。 */
interface ParsedFileRow {
  file: string;
  source: SessionSource;
  stat: FileStat;
  /** 会话编号(claude/codebuddy 按路径规则;deepseek 记事实所属的主会话,ingest.ts 同款认法)。 */
  sessionId: string | null;
  startCwd: string;
  consumedBytes: number;
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function removeQuietly(p: string): void {
  try {
    fs.rmSync(p, { recursive: true, force: true });
  } catch {
    // 收尾性质的删除,删不掉不影响重建结果
  }
}

/** 删临时库残留(主文件 + -wal + -shm)。 */
function removeTmpFiles(tmpPath: string): void {
  removeQuietly(tmpPath);
  removeQuietly(`${tmpPath}-wal`);
  removeQuietly(`${tmpPath}-shm`);
}

function closeQuietly(conn: DatabaseConnection | null): void {
  try {
    conn?.close();
  } catch {
    // 关不上不影响结果(句柄随进程退出释放)
  }
}

/** 项目库 timeline_meta 里的重建记号;没有 → null(视为没重建)。 */
function readRebuiltAt(db: SqliteDatabase): string | null {
  const row = db.prepare('SELECT value FROM timeline_meta WHERE key = ?').get(REBUILT_AT_KEY) as
    | { value: string }
    | undefined;
  return row === undefined ? null : row.value;
}

function writeRebuiltAt(db: SqliteDatabase): void {
  db.prepare('INSERT OR REPLACE INTO timeline_meta (key, value) VALUES (?, ?)').run(
    REBUILT_AT_KEY,
    new Date().toISOString(),
  );
}

/** 文件里第一个会话头;一条带 cwd 的行都没有 → null(spec D3「再不行」)。 */
function firstSessionHead(facts: readonly SessionFact[]): Extract<SessionFact, { kind: 'session_head' }> | null {
  const head = facts.find((f): f is Extract<SessionFact, { kind: 'session_head' }> => f.kind === 'session_head');
  return head ?? null;
}

/**
 * 文件的 start_cwd:sessions.db 已认过的直接用(recorded 是调用方取到的那一行,不再重查);subagents/
 * 下的文件跟主会话(spec D2 表注)——本轮先解析主文件,自己刚认出的结果优先,没有再查 sessions.db 里
 * 主文件的行。
 */
function knownStartCwd(
  file: string,
  source: SessionSource,
  recorded: SessionFileRow | null,
  sessionIndex: SessionIndex,
  parsedStartCwd: Map<string, string>,
): string | null {
  if (recorded !== null && recorded.start_cwd !== null) return recorded.start_cwd;
  const main = sessionAdapterFor(source.sessionReader).parentSessionFile(file);
  if (main !== null) {
    const own = parsedStartCwd.get(main);
    if (own !== undefined) return own;
    const mainRow = sessionIndex.getSessionFile(main);
    if (mainRow !== null && mainRow.start_cwd !== null) return mainRow.start_cwd;
  }
  return null;
}

/** 一文件的事实写进临时库(同增量 writeFacts 的落库部分——事件与标题同事务,但不推进进度——进度等项目库提交之后统一写)。 */
function writeParsedFacts(
  file: string,
  source: SessionSource,
  stat: FileStat,
  result: SessionFileReadResult,
  startCwd: string,
  cls: DirClassification,
  tmpDb: SqliteDatabase,
  mapCtx: FactMappingContext,
  unparsed: UnparsedMap,
): void {
  const events = mapFacts(result.facts, source, startCwd, mapCtx);
  // 标题不是事件:单独按 C-2 优先级写临时库的标题表,并库时与事件表同命运(commitRebuild,D8)
  const titles = titleUpserts(result.facts);
  if (events.length > 0 || titles.length > 0) {
    const store = new TimelineStore(tmpDb);
    tmpDb.transaction(() => {
      for (const event of events) store.insert(event);
      upsertRoot(tmpDb, cls.root, events);
      for (const title of titles) upsertSessionTitle(tmpDb, title);
    })();
  }
  noteUnparsed(unparsed, file, source, stat, result, true); // 全量读,fullRead 恒真
}

/** 推进这个项目一个文件的进度(偏移到本次读到的地方,不取文件当前大小,见头注释第 6 步)。 */
function saveParsedRow(sessionIndex: SessionIndex, row: ParsedFileRow, projectDirName: string): void {
  sessionIndex.saveSessionFile({
    path: row.file,
    agent: row.source.id,
    session_id: row.sessionId,
    start_cwd: row.startCwd,
    project_dir: projectDirName,
    byte_offset: row.consumedBytes,
    size: row.stat.size,
    mtime_ms: row.stat.mtimeMs,
  });
}

/** SQL 字符串字面量(单引号转义)。 */
function quoteLiteral(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

/**
 * ⑤ 短事务并库(D19):ATTACH 临时库,一个 BEGIN IMMEDIATE 事务里删非提交事件(K24)、INSERT SELECT
 * 临时库事件、并 timeline_roots 与标题表(D8:同命运)、写 rebuilt_at 与 session_titles_at,
 * session_titles_refresh_at,提交后
 * DETACH(ATTACH / DETACH 都不能在事务里)。
 * 事务只有秒级,持锁期间别的进程写提交记录排队等(busy_timeout 5 秒),等不到的下一趟补录再写。
 * 返回重建写进项目库的会话数与事件数(取自临时库)。
 */
function commitRebuild(
  projectDb: SqliteDatabase,
  tmpDb: SqliteDatabase,
  tmpPath: string,
): { sessions: number; events: number } {
  const count = (sql: string): number => {
    const row = tmpDb.prepare(sql).get() as { n: number | bigint };
    return Number(row.n);
  };
  const sessions = count('SELECT COUNT(DISTINCT session_id) AS n FROM timeline_events');
  const events = count('SELECT COUNT(*) AS n FROM timeline_events');

  projectDb.exec(`ATTACH ${quoteLiteral(tmpPath)} AS ${TMP_ALIAS}`);
  try {
    projectDb.exec('BEGIN IMMEDIATE');
    try {
      // K24:除提交记录外全部删掉,不备份(提交记录是 git 钩子记的,补不回来);timeline_roots 留着
      projectDb.exec("DELETE FROM timeline_events WHERE event_type != 'git_commit'");
      // 提交记录不带 source_key(部分唯一索引不盖空键行),清完非提交事件后不可能撞键
      projectDb.exec(
        `INSERT INTO timeline_events (${EVENT_COLUMNS}) SELECT ${EVENT_COLUMNS} FROM ${TMP_ALIAS}.timeline_events`,
      );
      // WHERE 1:INSERT … SELECT … ON CONFLICT 的语法消歧(SQLite 文档的写法)
      projectDb.exec(
        `INSERT INTO timeline_roots (root, first_ts, last_ts) ` +
          `SELECT root, first_ts, last_ts FROM ${TMP_ALIAS}.timeline_roots WHERE 1 ` +
          `ON CONFLICT(root) DO UPDATE SET first_ts = min(first_ts, excluded.first_ts), ` +
          `last_ts = max(last_ts, excluded.last_ts)`,
      );
      // 标题表与事件表同命运(D8):删掉旧的、并临时库的(临时库写入时已按优先级收敛,直接搬)
      projectDb.exec('DELETE FROM timeline_session_titles');
      projectDb.exec(
        `INSERT INTO timeline_session_titles (session_id, title, kind, ts) ` +
          `SELECT session_id, title, kind, ts FROM ${TMP_ALIAS}.timeline_session_titles`,
      );
      writeRebuiltAt(projectDb);
      // 重建从头读过全部文件,标题已齐:同事务写「回填过了」与「DeepSeek 标题重算过了」,不让随后的
      // 回填 / 重算再读一遍(D9、D10)
      writeMetaNow(projectDb, SESSION_TITLES_AT_KEY);
      writeMetaNow(projectDb, SESSION_TITLES_REFRESH_AT_KEY);
      projectDb.exec('COMMIT');
    } catch (err) {
      try {
        projectDb.exec('ROLLBACK');
      } catch {
        // 事务可能已结束
      }
      throw err;
    }
  } finally {
    try {
      projectDb.exec(`DETACH DATABASE ${TMP_ALIAS}`);
    } catch {
      // 摘不掉随连接关闭释放;临时库文件在调用方的收尾里删
    }
  }
  return { sessions, events };
}

/**
 * 全量重建的入口(T-4 接进 ensureTimelineUpToDate,plan C-4)。返回:
 *   rebuilt   重建完成(sessions / events 是本次写进项目库的数量)
 *   mark-only 删过数据的项目只写了记号(K23),不解析;之后的增量只收删除之后的
 *   busy      拿不到 ingest.lock;下次重来
 *   failed    任何一步失败(时间线还是旧的,下次能重来)
 *   null      不用重建:已重建过(含等锁期间别的进程刚重建完),或这个目录没有项目库(同增量的静默分支)
 */
export async function rebuildTimeline(start: string): Promise<RebuildOutcome | null> {
  const root = findProjectRoot(start);
  if (root === null) return null;
  const loc = locateDataAtRoot(root);
  // 同增量的静默分支:项目目录不在(没装过也从没记过数据)就没有可清、可重建的,查询会报自己的错
  if (loc.mode !== 'project' || loc.dataDir === null || loc.projectDirName === null || loc.identity === null) {
    return null;
  }
  const dataDir = loc.dataDir;
  if (!acquireIngestLock(dataDir)) return { status: 'busy', notices: [] };

  const sessionIndex = openSessionIndex();
  let projectConn: DatabaseConnection | null = null;
  let tmpConn: DatabaseConnection | null = null;
  const tmpPath = path.join(dataDir, REBUILD_TMP_FILENAME);
  try {
    projectConn = DatabaseConnection.open(path.join(dataDir, DATABASE_FILENAME));
    const projectDb = projectConn.getDb();
    ensureTimelineSchema(projectDb);
    // 等锁期间可能已被别的进程重建过(K23 只重建一次):重查一次记号
    if (readRebuiltAt(projectDb) !== null) return null;

    // K23:删过数据的项目不全量解析,只写记号——旧会话不补回,之后的增量只收删除之后的(K3);
    // 标题记号一并写:不让随后的老会话回填 / DeepSeek 标题重算把这个分支刻意省掉的全量重读又做一遍
    // (标题跟着事件走)
    if (sessionIndex.removedProjectAt(loc.identity) !== null) {
      writeRebuiltAt(projectDb);
      writeMetaNow(projectDb, SESSION_TITLES_AT_KEY);
      writeMetaNow(projectDb, SESSION_TITLES_REFRESH_AT_KEY);
      return { status: 'mark-only', notices: [] };
    }

    // ④ 全量解析写临时库:先删残留再建(上一次重建中途死掉的);解析期间不碰项目库
    removeTmpFiles(tmpPath);
    tmpConn = DatabaseConnection.open(tmpPath);
    const tmpDb = tmpConn.getDb();
    ensureTimelineSchema(tmpDb);

    let matcher: RootMatcher | null = null;
    const classifyCtx: ClassificationContext = {
      currentDirName: loc.projectDirName,
      sessionIndex,
      classified: new Map(),
      fallbackMatcher: () => {
        if (matcher === null) {
          const recorded = readRootRows(projectDb).map((r) => r.root);
          const replicas = listReplicas(root, { includeRemoved: true }).map((e) => e.path);
          matcher = createRootMatcher([...recorded, ...replicas]);
        }
        return matcher;
      },
    };
    const mapCtx: FactMappingContext = {
      projectDb: () => tmpDb, // 事实映射(轮次回查)只碰临时库
      removedAtMs: null, // 走到这里的项目没删过数据(删过的在上面只写记号)
      sessionsWritten: new Set<string>(),
    };
    const unparsed: UnparsedMap = new Map();
    const readFailed: ReadFailedMap = new Map();
    const parsedRows: ParsedFileRow[] = [];
    const parsedStartCwd = new Map<string, string>();

    for (const source of listSessionSources()) {
      const adapter = sessionAdapterFor(source.sessionReader);
      const context = sessionAdapterContext(root);
      // 读不了的来源(如 Node 没有 zstd API 的 deepseek)不解析;提示由紧随其后的增量那一趟加(D12)
      if (adapter.unavailableReason(context) !== null) continue;
      const files = await adapter.listSessionFiles(context);
      for (const file of files) {
        const stat = statOrNull(file);
        if (stat === null) continue; // 文件没了(F1 ⑤):已记进时间线的留着
        // 单文件隔离:读取器抛错(坏帧、读不出会话头等)只丢这一个文件,不卡住排序在后的文件、
        // 不让整个重建永久 failed(rebuilt_at 不写,别的进程下次又从头来一遍还是死在同一个文件上)
        try {
          // 循环开头取一次,后面判断跳过与 knownStartCwd 共用(同一个文件不查两遍 sessions.db)
          const recorded = sessionIndex.getSessionFile(file);
          // D5:已记到别的项目、内容也读过的文件不在重建里从头读——偏移留着交给增量,否则改名后
          // 新项目会把旧历史再解析一遍。没记过 / 归本项目 / 偏移还是 0 的照旧从头读
          if (
            recorded !== null &&
            recorded.project_dir !== null &&
            recorded.project_dir !== loc.projectDirName &&
            recorded.byte_offset > 0
          ) {
            continue;
          }
          let startCwd = knownStartCwd(file, source, recorded, sessionIndex, parsedStartCwd);
          let result: SessionFileReadResult | null = null;
          if (startCwd === null) {
            result = await sessionFactsReader(source.sessionReader)(file, 0);
            const head = firstSessionHead(result.facts);
            if (head === null) continue; // 一条带 cwd 的行都没有:留给增量按它的口径记空行
            startCwd = head.startCwd;
          }
          parsedStartCwd.set(file, startCwd);
          const cls = classifyStartDir(startCwd, classifyCtx);
          if (cls.dirName !== classifyCtx.currentDirName) continue; // 别的项目的 / 没认出来的:不动,别家自己补
          if (result === null) result = await sessionFactsReader(source.sessionReader)(file, 0); // 全量:一律从头读
          writeParsedFacts(file, source, stat, result, startCwd, cls, tmpDb, mapCtx, unparsed);
          parsedRows.push({
            file,
            source,
            stat,
            sessionId: rowSessionId(source, file, result.facts, recorded?.session_id ?? null),
            startCwd,
            consumedBytes: result.consumedBytes,
          });
        } catch (err) {
          noteReadFailed(readFailed, source, err);
        }
      }
    }

    // ⑤ 短事务:清 + 写 + 记号同生共死
    const counts = commitRebuild(projectDb, tmpDb, tmpPath);

    // ⑥ 收尾(重建已成立,单项失败只留残渣,不再报 failed)
    try {
      for (const row of parsedRows) saveParsedRow(sessionIndex, row, loc.projectDirName);
    } catch {
      // 偏移没推进:下一趟增量重读这些文件,靠 source_key 去重,只是慢一遍
    }
    removeQuietly(path.join(dataDir, TURNS_DIRNAME));
    removeQuietly(sessionsRoot());
    try {
      projectDb.exec('VACUUM');
    } catch {
      // 压不了不影响结果
    }
    return {
      status: 'rebuilt',
      sessions: counts.sessions,
      events: counts.events,
      notices: [...unparsedNotices(unparsed), ...readFailedNotices(readFailed)],
    };
  } catch (err) {
    // 清和写在短事务里一起撤销过,时间线还是旧的;临时库在 finally 里删
    return { status: 'failed', reason: errorMessage(err), notices: [] };
  } finally {
    closeQuietly(tmpConn); // 先关再删(Windows 上开着的文件删不掉)
    removeTmpFiles(tmpPath);
    closeQuietly(projectConn);
    releaseIngestLock(dataDir);
    sessionIndex.close();
  }
}
