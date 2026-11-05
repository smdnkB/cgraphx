/**
 * task 子系统 schema 应用与开库。
 *
 * 与 timeline 同一模式:读取与编译产物同目录的 `schema.sql` 幂等应用,
 * 在 `task_schema_versions` 记录版本;库里记录的版本比本构建新时拒绝继续。
 * 库在数据位置(data-location.ts):旧库模式是本地 `.cgraphx/cgraphx.db`,其余是用户目录里这个项目的
 * `cgraphx.db`;和 timeline、sync 共用一份,只碰 `task_*` 表。
 */

import fs from 'node:fs';
import path from 'node:path';

import { ensureDataDir, locateData, missingDataMessage } from '../data-location';
import { DATABASE_FILENAME, DatabaseConnection, getDatabasePath, type SqliteDatabase } from '../db';
import { TASK_SCHEMA_VERSION } from './constants';
import { TaskConfigError, TaskError, TaskNotEnabledError, TaskStoreError } from './errors';

/**
 * 拿不到库时的提示:数据位置拿不到(没有根、认不出项目、git 跑不起来、项目在本机还没有数据)→ 按
 * missingDataMessage 说原因和修法;数据目录在、库文件不在时照旧:起点不在了 → 说不在了,其余提示先 install。
 */
function missingDbMessage(start: string): string {
  const loc = locateData(start);
  if (loc.unavailable !== null) return missingDataMessage(loc);
  if (!fs.existsSync(loc.start)) return `项目目录 ${loc.start} 不在了`;
  return `cgraphx 未在 ${loc.root ?? loc.start} 初始化,请先运行 \`cgraphx install\``;
}

/** schema.sql 与编译后的模块同目录(dist 镜像 src)。 */
function resolveSchemaPath(): string {
  return path.join(__dirname, 'schema.sql');
}

/** 读库中已记录的 task schema 版本,没有记录为 0。 */
function getCurrentTaskSchemaVersion(db: SqliteDatabase): number {
  const row = db
    .prepare('SELECT version FROM task_schema_versions ORDER BY version DESC LIMIT 1')
    .get() as { version: number } | undefined;
  return row?.version ?? 0;
}

/**
 * 在已打开的连接上应用 task schema(幂等,可每次打开都调用)。
 *
 * @throws TaskConfigError 库里记录的版本比本构建支持的新(需要升级 cgraphx)。
 * @throws TaskStoreError 读取 schema.sql 或应用 schema 时的 DB 异常。
 */
export function ensureTaskSchema(db: SqliteDatabase): void {
  let current: number;
  try {
    const sql = fs.readFileSync(resolveSchemaPath(), 'utf-8');
    db.exec(sql);
    current = getCurrentTaskSchemaVersion(db);
  } catch (err) {
    if (err instanceof TaskError) throw err;
    const msg = err instanceof Error ? err.message : String(err);
    throw new TaskStoreError(
      `task schema 应用失败:${msg}。检查库文件是否可写、未损坏,` +
        '或运行 `cgraphx install` 重新初始化',
      { cause: err },
    );
  }

  if (current > TASK_SCHEMA_VERSION) {
    throw new TaskConfigError(
      `task schema 版本 ${current} 比当前 cgraphx 支持的版本 ${TASK_SCHEMA_VERSION} 新,` +
        '请运行 `cgraphx upgrade` 升级',
    );
  }
}

/**
 * 打开数据位置那份库(写数据的入口:ensureDataDir,根装过的项目库模式下项目目录不在就建)并确保 task schema
 * 已应用。start 是起点,当前目录、项目根都行。调用方负责 `close()`。
 *
 * @throws TaskConfigError 拿不到数据位置(没有根、认不出项目、git 跑不起来、没装过的目录项目在本机还没有数据)。
 */
export function openTaskDb(start: string): DatabaseConnection {
  const dir = ensureDataDir(start);
  if (dir === null) {
    throw new TaskConfigError(missingDbMessage(start));
  }

  const connection = DatabaseConnection.open(path.join(dir, DATABASE_FILENAME));
  try {
    ensureTaskSchema(connection.getDb());
  } catch (err) {
    connection.close();
    throw err;
  }
  return connection;
}

/**
 * 只读打开数据位置那份库:不应用 schema、不建表、不建目录(供 web 等只读调用方使用)。调用方负责 `close()`。
 *
 * 存在性检查必须先于 `DatabaseConnection.open`——open 会在 DB 不存在时创建文件。
 *
 * @throws TaskConfigError 拿不到数据位置,或那里没有库文件。
 * @throws TaskNotEnabledError 库中没有 `task_schema_versions` 表。
 * @throws TaskStoreError 查询 sqlite_master 失败。
 */
export function openTaskDbReadOnly(start: string): DatabaseConnection {
  const dbPath = getDatabasePath(start);

  if (dbPath === null || !fs.existsSync(dbPath)) {
    throw new TaskConfigError(missingDbMessage(start));
  }

  const connection = DatabaseConnection.open(dbPath);
  let present: boolean;
  try {
    const row = connection
      .getDb()
      .prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='task_schema_versions'`)
      .get();
    present = row !== undefined;
  } catch (err) {
    connection.close();
    const msg = err instanceof Error ? err.message : String(err);
    throw new TaskStoreError(`读取 task 表信息失败:${msg}。检查 ${dbPath} 是否损坏`, { cause: err });
  }
  if (!present) {
    connection.close();
    throw new TaskNotEnabledError();
  }
  return connection;
}
