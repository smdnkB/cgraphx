/**
 * task 子系统 schema 应用。
 *
 * 与 timeline 同一模式:读取与编译产物同目录的 `schema.sql` 幂等应用,
 * 在 `task_schema_versions` 记录版本;库里记录的版本比本构建新时拒绝继续。
 * 共用 `.cgraphx/cgraphx.db`,只碰 `task_*` 表。
 */

import fs from 'node:fs';
import path from 'node:path';

import { DatabaseConnection, getDatabasePath, type SqliteDatabase } from '../db';
import { TASK_SCHEMA_VERSION } from './constants';
import { TaskConfigError } from './errors';

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
 */
export function ensureTaskSchema(db: SqliteDatabase): void {
  const sql = fs.readFileSync(resolveSchemaPath(), 'utf-8');
  db.exec(sql);

  const current = getCurrentTaskSchemaVersion(db);
  if (current > TASK_SCHEMA_VERSION) {
    throw new TaskConfigError(
      `task schema 版本 ${current} 比当前 cgraphx 支持的版本 ${TASK_SCHEMA_VERSION} 新,` +
        '请运行 `cgraphx upgrade` 升级',
    );
  }
}

/**
 * 打开项目共享库并确保 task schema 已应用。调用方负责 `close()`。
 *
 * @throws TaskConfigError 项目未初始化(`.cgraphx/cgraphx.db` 不存在)。
 */
export function openTaskDb(projectRoot: string): DatabaseConnection {
  const resolved = path.resolve(projectRoot);
  const dbPath = getDatabasePath(resolved);

  if (!fs.existsSync(dbPath)) {
    throw new TaskConfigError(`cgraphx 未在 ${resolved} 初始化,请先运行 \`cgraphx install\``);
  }

  const connection = DatabaseConnection.open(dbPath);
  try {
    ensureTaskSchema(connection.getDb());
  } catch (err) {
    connection.close();
    throw err;
  }
  return connection;
}
