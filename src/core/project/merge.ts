/**
 * 并旧数据进用户目录(spec:2026-11-05-数据按项目放用户目录 D25~D30;F4)
 *
 * 升级前装过的目录,timeline、task、sync 的数据在本地 `.cgraphx/cgraphx.db`(旧库)。install 时把它并进用户目录里这个
 * 项目的项目库,只并一次(并过记号:本地 `.cgraphx/project.json` 的 mergedAt),并之前先备份。顺序固定:
 *
 * 1. 认根(装过的才并)、认标识;已经并过 → already;没有旧表 → 写记号,nothing。这两种都补齐项目目录和三套 schema
 *    (项目数据被 project remove 删过的,重装时建回来)
 * 2. 拿项目目录的 merge.lock(同一项目同一时间只有一个目录在并),拿到后再看一次记号
 * 3. 备份:旧库写事务里复制本地文件(备份失败就不并)
 * 4. 第 ① 段:不加锁,把旧库现有的事件分批并进项目库(绝大多数事件在这一段并完)
 * 5. 第 ② 段:旧库写事务里并尾巴、task 表、sync 表与平台连接、文件,写记号,删旧表,提交。记号在提交之前写好:等写锁的
 *    hook 拿到锁后在写事务里看到记号,改写项目库。任何一步失败:撤掉记号、回滚旧库;项目库里已写进去的保留,再装一次
 *    靠事件去重、task 与 sync 按键对上,结果和一次并完相同
 * 6. 提交之后删本地的平台连接、db-query 配置与日志、轮次记录(备份里有),旧库试一次 VACUUM
 *
 * mergeLegacyData 不抛:任何失败返回 failed(reason 为原因),由 install 打 M3。
 */

import * as path from 'node:path';

import {
  findProjectRoot,
  hasLegacyTables,
  missingDataMessage,
  readLocalProjectJson,
  updateLocalProjectJson,
  type DataUnavailable,
} from '../data-location';
import { DATABASE_FILENAME, DatabaseConnection, getLocalDatabasePath, type SqliteDatabase } from '../db';
import { getCodeGraphDir, isInitialized } from '../directory';
import { identityOfRoot, projectDisplayName } from '../project-identity';
import { listReplicas } from '../replica';
import { ensureSyncSchema, mergeSyncTables } from '../sync';
import { ensureTaskSchema, mergeTaskTables } from '../task';
import { createTimelineMerger, ensureTimelineSchema, maxTimelineEventId, type TimelineMerger } from '../timeline';
import { ensureProjectDir } from '../user-data-dir';
import {
  acquireMergeLock,
  backupLegacyData,
  mergeLegacyFiles,
  releaseMergeLock,
  removeMergedLocalFiles,
} from './merge-files';
import type { MergeOutcome } from './types';

/** 等不到 merge.lock 时的原因。 */
const LOCK_BUSY_REASON = '另一个目录正在往这个项目并旧数据,稍后再装一次';

/** 旧库里 timeline、task、sync 的全部表(`_` 转义,不当通配符)。 */
const LEGACY_TABLES_SQL =
  "SELECT name FROM sqlite_master WHERE type = 'table' AND (name LIKE 'timeline\\_%' ESCAPE '\\' " +
  "OR name LIKE 'task\\_%' ESCAPE '\\' OR name LIKE 'sync\\_%' ESCAPE '\\') ORDER BY name";

type OutcomeExtra = Partial<Pick<MergeOutcome, 'events' | 'sessions' | 'duplicates' | 'notices' | 'mergedAt' | 'reason'>>;

function outcome(kind: MergeOutcome['kind'], display: string, extra: OutcomeExtra = {}): MergeOutcome {
  return {
    kind,
    display,
    events: extra.events ?? 0,
    sessions: extra.sessions ?? 0,
    duplicates: extra.duplicates ?? 0,
    notices: extra.notices ?? [],
    mergedAt: extra.mergedAt ?? null,
    reason: extra.reason ?? null,
  };
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** 装过(`.cgraphx/cgraphx.db` 在);判断出错按没装过。 */
function isInstalled(dir: string): boolean {
  try {
    return isInitialized(dir);
  } catch {
    return false;
  }
}

/** 并过记号的时间;没有 → null。每次现读。 */
function readMergedAt(root: string): string | null {
  return readLocalProjectJson(root)?.mergedAt ?? null;
}

/** 认不出项目时的原因(同数据位置的提示)。 */
function unavailableMessage(root: string, unavailable: DataUnavailable): string {
  return missingDataMessage({
    start: root,
    root,
    installed: true,
    identity: null,
    mode: 'project',
    dataDir: null,
    projectDirName: null,
    unavailable,
  });
}

/** 项目库的三套 schema:timeline、task、sync。 */
function applyProjectSchemas(db: SqliteDatabase): void {
  ensureTimelineSchema(db);
  ensureTaskSchema(db);
  ensureSyncSchema(db);
}

/** 打开项目目录里的库,补齐三套 schema,关库。 */
function ensureProjectSchemas(dir: string): void {
  const conn = DatabaseConnection.open(path.join(dir, DATABASE_FILENAME));
  try {
    applyProjectSchemas(conn.getDb());
  } finally {
    conn.close();
  }
}

function quoteIdent(name: string): string {
  return `"${name.replace(/"/g, '""')}"`;
}

/** 按外键从子表到父表排:还被别的没删的表引用着的往后放;有环时剩下的按名字顺序。 */
function childFirstOrder(db: SqliteDatabase, tables: readonly string[]): string[] {
  const names = new Set(tables);
  const parents = new Map<string, Set<string>>();
  for (const table of tables) {
    const refs = db.prepare(`PRAGMA foreign_key_list(${quoteIdent(table)})`).all() as Array<{ table: string }>;
    parents.set(table, new Set(refs.map((r) => r.table).filter((p) => p !== table && names.has(p))));
  }
  const remaining = [...tables];
  const order: string[] = [];
  while (remaining.length > 0) {
    const free = remaining.findIndex((t) => !remaining.some((other) => other !== t && parents.get(other)?.has(t) === true));
    const [next] = remaining.splice(free === -1 ? 0 : free, 1);
    if (next !== undefined) order.push(next);
  }
  return order;
}

/** 删旧库里全部 timeline_*、task_*、sync_* 表,子表先于父表(task_superseded_bindings → task_sessions → task_items)。 */
function dropLegacyTables(db: SqliteDatabase): void {
  const tables = (db.prepare(LEGACY_TABLES_SQL).all() as Array<{ name: string }>).map((r) => r.name);
  for (const table of childFirstOrder(db, tables)) db.exec(`DROP TABLE IF EXISTS ${quoteIdent(table)}`);
}

function rollbackQuietly(db: SqliteDatabase): void {
  try {
    db.exec('ROLLBACK');
  } catch {
    // 事务可能已结束
  }
}

function closeQuietly(conn: DatabaseConnection | null): void {
  try {
    conn?.close();
  } catch {
    // 关不上不影响结果
  }
}

/** 撤掉并过记号;撤不掉不盖住原来的错误。 */
function undoMergedMark(root: string): void {
  try {
    updateLocalProjectJson(root, { mergedAt: null, mergedInto: null });
  } catch {
    // 记号留着时项目库里已有并过去的数据,判定按项目库走
  }
}

interface MergeTarget {
  root: string;
  /** 本地 `.cgraphx/` */
  localDir: string;
  projectDir: string;
  projectDirName: string;
  display: string;
}

interface TailInput extends MergeTarget {
  oldDb: SqliteDatabase;
  projectDb: SqliteDatabase;
  merger: TimelineMerger;
  /** 第 ① 段并到的事件 id */
  upTo: number;
  /** 归根候选:并的那个目录和它登记过的副本(在用、已删都算) */
  attributionRoots: readonly string[];
}

/**
 * 第 ② 段(D27):旧库写事务里并尾巴与 timeline_roots、task 表、sync 表与平台连接、文件,写记号,删旧表,提交。
 * 返回 M2 提示。失败时先撤记号再回滚(回滚后等写锁的 hook 看到的是没有记号),再抛出。
 */
function mergeTailLocked(input: TailInput): string[] {
  const { root, oldDb, projectDb, merger } = input;
  const dirName = path.basename(root);
  let marked = false;
  oldDb.exec('BEGIN IMMEDIATE');
  try {
    merger.mergeTail(input.upTo, input.attributionRoots);
    mergeTaskTables(oldDb, projectDb, merger.mapping);
    const notices = [
      ...mergeSyncTables({
        oldDb,
        projectDb,
        mapping: merger.mapping,
        mergingRoot: root,
        oldDataDir: input.localDir,
        projectDataDir: input.projectDir,
        dirName,
      }).notices,
    ];
    notices.push(...mergeLegacyFiles(input.localDir, input.projectDir, dirName));
    updateLocalProjectJson(root, { mergedAt: new Date().toISOString(), mergedInto: input.projectDirName });
    marked = true;
    dropLegacyTables(oldDb);
    oldDb.exec('COMMIT');
    return notices;
  } catch (err) {
    if (marked) undoMergedMark(root);
    rollbackQuietly(oldDb);
    throw err;
  }
}

/** 拿到锁以后的第 7~13 步:备份、两边 schema、第 ① 段、第 ② 段、删本地文件、VACUUM。两个库在这里关。 */
function mergeLocked(target: MergeTarget): MergeOutcome {
  const { root, localDir, projectDir } = target;
  let oldConn: DatabaseConnection | null = null;
  let projectConn: DatabaseConnection | null = null;
  try {
    oldConn = DatabaseConnection.open(getLocalDatabasePath(root));
    const oldDb = oldConn.getDb();
    backupLegacyData(oldDb, localDir, projectDir, path.basename(root));

    // 旧库补 agent 列、自动消息改记;项目库补齐三套 schema
    ensureTimelineSchema(oldDb);
    projectConn = DatabaseConnection.open(path.join(projectDir, DATABASE_FILENAME));
    const projectDb = projectConn.getDb();
    applyProjectSchemas(projectDb);

    const merger = createTimelineMerger(oldDb, projectDb);
    const upTo = maxTimelineEventId(oldDb);
    merger.mergeEventsUpTo(upTo);

    // 归根候选在进写事务之前取好,第 ② 段持锁的时间只含合并本身
    const attributionRoots = [root, ...listReplicas(root, { includeRemoved: true }).map((e) => e.path)];
    const notices = mergeTailLocked({ ...target, oldDb, projectDb, merger, upTo, attributionRoots });

    removeMergedLocalFiles(localDir);
    try {
      oldDb.exec('VACUUM');
    } catch {
      // 旧库只剩知识库的表;压不了不影响结果
    }
    const stats = merger.stats();
    return outcome('merged', target.display, {
      events: stats.events,
      sessions: stats.sessions,
      duplicates: stats.duplicates,
      notices,
    });
  } finally {
    closeQuietly(projectConn);
    closeQuietly(oldConn);
  }
}

/** mergeLegacyData 的主体;display 认出标识后填进 known,失败时 failed 也带上显示名。 */
function mergeFrom(start: string, known: { display: string }): MergeOutcome {
  const root = findProjectRoot(start);
  if (root === null || !isInstalled(root)) return outcome('nothing', '');

  const info = identityOfRoot(root);
  const mergedAt = readMergedAt(root);
  if (info === 'git-error' || info.identity === null) {
    if (mergedAt !== null) return outcome('already', '', { mergedAt });
    return outcome('failed', '', {
      reason: unavailableMessage(root, info === 'git-error' ? 'git-error' : 'no-identity'),
    });
  }
  const identity = info.identity;
  known.display = projectDisplayName(identity);

  if (mergedAt !== null) {
    ensureProjectSchemas(ensureProjectDir(identity).dir);
    return outcome('already', known.display, { mergedAt });
  }

  const project = ensureProjectDir(identity);
  if (!hasLegacyTables(root)) {
    ensureProjectSchemas(project.dir);
    updateLocalProjectJson(root, { mergedAt: new Date().toISOString(), mergedInto: project.name });
    return outcome('nothing', known.display);
  }

  if (!acquireMergeLock(project.dir)) return outcome('failed', known.display, { reason: LOCK_BUSY_REASON });
  try {
    // 等锁期间别的进程可能刚并完(同一目录同时跑了两个 install)
    const mergedMeanwhile = readMergedAt(root);
    if (mergedMeanwhile !== null) {
      ensureProjectSchemas(project.dir);
      return outcome('already', known.display, { mergedAt: mergedMeanwhile });
    }
    return mergeLocked({
      root,
      localDir: getCodeGraphDir(root),
      projectDir: project.dir,
      projectDirName: project.name,
      display: known.display,
    });
  } finally {
    releaseMergeLock(project.dir);
  }
}

/**
 * 把起点所在目录(按 D2 认根,装过的才并)的本地旧库并进用户目录里这个项目的项目库(spec D25~D30)。
 * 结果:merged 并好了(events、sessions、duplicates、notices);already 已经并过(mergedAt);nothing 没有要并的;
 * failed 没并成(reason)。不抛:任何异常都返回 failed。
 */
export function mergeLegacyData(start: string): MergeOutcome {
  const known = { display: '' };
  try {
    return mergeFrom(start, known);
  } catch (err) {
    return outcome('failed', known.display, { reason: errorMessage(err) });
  }
}

/** 这个目录还有没并过去的旧数据:根装过、没有并过记号、本地库有 timeline_*、task_*、sync_* 任一张表。 */
export function hasUnmergedLegacyData(start: string): boolean {
  const root = findProjectRoot(start);
  if (root === null || !isInstalled(root)) return false;
  return readMergedAt(root) === null && hasLegacyTables(root);
}
