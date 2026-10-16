/**
 * sync 子系统 schema 应用。
 *
 * 与 task / timeline 同一模式:读取与编译产物同目录的 `schema.sql` 幂等应用,
 * 在 `sync_schema_versions` 记录版本;库里记录的版本比本构建新时拒绝继续。
 * 共用 `.cgraphx/cgraphx.db`,只碰 `sync_*` 表。
 */

import fs from 'node:fs';
import path from 'node:path';

import { DatabaseConnection, getDatabasePath, type SqliteDatabase } from '../db';
import { SYNC_SCHEMA_VERSION } from './constants';
import { SyncError, SyncNotInitializedError, SyncSchemaError } from './errors';

/** schema.sql 与编译后的模块同目录(dist 镜像 src)。 */
function resolveSchemaPath(): string {
  return path.join(__dirname, 'schema.sql');
}

/** 读库中已记录的 sync schema 版本,没有记录为 0。 */
function getCurrentSyncSchemaVersion(db: SqliteDatabase): number {
  const row = db
    .prepare('SELECT version FROM sync_schema_versions ORDER BY version DESC LIMIT 1')
    .get() as { version: number } | undefined;
  return row?.version ?? 0;
}

/**
 * 在已打开的连接上应用 sync schema(幂等,可每次打开都调用)。
 *
 * @throws SyncSchemaError schema 应用失败,或库里记录的版本比本构建支持的新。
 */
export function ensureSyncSchema(db: SqliteDatabase): void {
  let current: number;
  try {
    const sql = fs.readFileSync(resolveSchemaPath(), 'utf-8');
    db.exec(sql);
    current = getCurrentSyncSchemaVersion(db);
  } catch (err) {
    if (err instanceof SyncError) throw err;
    const msg = err instanceof Error ? err.message : String(err);
    throw new SyncSchemaError(
      `sync schema 应用失败:${msg}。检查 .cgraphx/cgraphx.db 是否可写、未损坏,` +
        '或运行 `cgraphx install` 重新初始化',
      { cause: err },
    );
  }

  if (current > SYNC_SCHEMA_VERSION) {
    throw new SyncSchemaError(
      `sync schema 版本 ${current} 比当前 cgraphx 支持的版本 ${SYNC_SCHEMA_VERSION} 新,` +
        '请运行 `cgraphx upgrade` 升级 cgraphx',
    );
  }
}

/**
 * 打开项目共享库并确保 sync schema 已应用。调用方负责 `close()`。
 *
 * 存在性检查先于 `DatabaseConnection.open`——open 会在 DB 不存在时创建文件。
 *
 * @throws SyncNotInitializedError 项目未初始化(`.cgraphx/cgraphx.db` 不存在)。
 * @throws SyncSchemaError schema 应用失败或版本过新。
 */
export function openSyncDb(projectRoot: string): DatabaseConnection {
  const resolved = path.resolve(projectRoot);
  const dbPath = getDatabasePath(resolved);

  if (!fs.existsSync(dbPath)) {
    throw new SyncNotInitializedError(`cgraphx 未在 ${resolved} 初始化,请先运行 \`cgraphx install\``);
  }

  const connection = DatabaseConnection.open(dbPath);
  try {
    ensureSyncSchema(connection.getDb());
  } catch (err) {
    connection.close();
    throw err;
  }
  return connection;
}
