/**
 * 清理已下掉功能的数据(spec:2026-11-05-下掉web与平台同步 F3 D6)
 *
 * 平台同步、开发任务子系统下掉后,已装过旧版的项目数据里还留着它们的表和运行文件;install 在认项目、
 * 并旧数据之后调这里清掉(并旧数据先并走 timeline 的表、删掉旧库里的 sync/task 表,剩下的在这里收尾):
 *
 * - 表:数据位置(`data-location.ts`,与并旧数据同口径)的库里 13 张 `sync_*` / `task_*` 表,
 *   `DROP TABLE IF EXISTS`,子表先删(排序规则同 `merge.ts` 删旧表);库不在就跳过该项
 * - 文件:`sync.lock`、`sync-trigger`、`sync-worker.pid`、`task-source.json`,数据位置目录与本地 `.cgraphx/`
 *   两处都删;文件不在就算了
 *
 * 只清不打印(输出由 install 按 spec 的原文打);幂等(第二次跑什么都没有 → nothing);不另做备份——
 * 并旧数据之前的备份里有旧库整份。任何异常不抛:返回 failed(reason),由调用方打警告、安装继续。
 */

import * as fs from 'node:fs';
import * as path from 'node:path';

import { locateData } from '../data-location';
import { DATABASE_FILENAME, DatabaseConnection, type SqliteDatabase } from '../db';
import { getCodeGraphDir } from '../directory';

/** 要删的 13 张表(五张 `sync_*`、八张 `task_*`;顺序无关,删时按外键子表先删)。 */
const REMOVED_FEATURE_TABLES = [
  'sync_schema_versions',
  'sync_state',
  'sync_sessions',
  'sync_reference_records',
  'sync_unreported_artifacts',
  'task_schema_versions',
  'task_items',
  'task_sessions',
  'task_reminders',
  'task_feature_tasks',
  'task_auto_sessions',
  'task_superseded_bindings',
  'task_auto_meta',
] as const;

/** 要删的 4 个运行文件,数据位置目录与本地 `.cgraphx/` 两处都删。 */
const REMOVED_FEATURE_FILENAMES = [
  'sync.lock',
  'sync-trigger',
  'sync-worker.pid',
  'task-source.json',
] as const;

/** 清理结果:cleaned 删了东西;nothing 本来就没有;failed 没清成(reason 为原因)。 */
export type RemovedFeatureCleanup =
  | { kind: 'cleaned'; droppedTables: string[]; removedFiles: string[] }
  | { kind: 'nothing' }
  | { kind: 'failed'; reason: string };

function quoteIdent(name: string): string {
  return `"${name.replace(/"/g, '""')}"`;
}

/**
 * 按外键从子表到父表排(与 `merge.ts` 删旧表同一规则):还被没删的表引用着的往后放;有环时剩下的按名字
 * 顺序兜底(调用方先按名字排好)。逐表 `PRAGMA foreign_key_list`,连接开着 `foreign_keys = ON`,父表先删
 * 会碰子表行的外键约束。
 */
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

/** 13 张表里这个库实际有的,按名字排(有环兜底时顺序稳定);查不出按没有处理。 */
function existingRemovedFeatureTables(db: SqliteDatabase): string[] {
  const placeholders = REMOVED_FEATURE_TABLES.map(() => '?').join(', ');
  const rows = db
    .prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name IN (${placeholders})`)
    .all(...REMOVED_FEATURE_TABLES) as Array<{ name: string }>;
  return rows.map((r) => r.name).sort();
}

/** 数据位置的库里删 13 张表,返回删掉的表名(库里没有一张 → 空数组)。不开不存在的库(open 会建文件)。 */
function dropRemovedFeatureTables(dataDir: string | null): string[] {
  if (dataDir === null) return [];
  const dbPath = path.join(dataDir, DATABASE_FILENAME);
  if (!fs.existsSync(dbPath)) return [];
  let conn: DatabaseConnection | null = null;
  try {
    conn = DatabaseConnection.open(dbPath);
    const db = conn.getDb();
    const tables = existingRemovedFeatureTables(db);
    for (const table of childFirstOrder(db, tables)) {
      db.exec(`DROP TABLE IF EXISTS ${quoteIdent(table)}`);
    }
    return tables;
  } finally {
    try {
      conn?.close();
    } catch {
      // 关不上不影响清理结果
    }
  }
}

function cleanup(start: string): RemovedFeatureCleanup {
  const loc = locateData(start);
  // 本地 `.cgraphx/` 认根(与并旧数据同口径);认不出根时按起点兜底,删不到就算了
  const localDir = getCodeGraphDir(loc.root ?? path.resolve(start));
  const dirs = [...new Set(loc.dataDir === null ? [localDir] : [loc.dataDir, localDir])];

  const droppedTables = dropRemovedFeatureTables(loc.dataDir);
  const removedFiles: string[] = [];
  for (const dir of dirs) {
    for (const name of REMOVED_FEATURE_FILENAMES) {
      const file = path.join(dir, name);
      if (!fs.existsSync(file)) continue;
      fs.rmSync(file, { force: true });
      removedFiles.push(file);
    }
  }
  return droppedTables.length > 0 || removedFiles.length > 0
    ? { kind: 'cleaned', droppedTables, removedFiles }
    : { kind: 'nothing' };
}

/**
 * 清掉这个起点所在项目里已下掉功能的数据(表 + 运行文件,见文件头)。幂等;不打印;不抛——任何异常返回
 * failed(reason),调用方打警告后继续。
 */
export function cleanupRemovedFeatureData(start: string): RemovedFeatureCleanup {
  try {
    return cleanup(start);
  } catch (err) {
    return { kind: 'failed', reason: err instanceof Error ? err.message : String(err) };
  }
}
