/**
 * sync 子系统 schema 应用与库的打开。
 *
 * 与 task / timeline 同一模式:读取与编译产物同目录的 `schema.sql` 幂等应用,
 * 在 `sync_schema_versions` 记录版本;库里记录的版本比本构建新时拒绝继续。
 *
 * 库在数据位置(基础层 data-location.ts):并过的目录在用户目录的项目目录里(`~/.cgraphx/projects/<目录名>/cgraphx.db`),
 * 同一项目的各个目录共用一个库、一把锁、一个 worker;还没并过的旧库是本地 `.cgraphx/cgraphx.db`。和 timeline、task
 * 共用一个库文件,只碰 `sync_*` 表。写的一方(openSyncDb)经 ensureDataDir 定位置,要建就建;读的一方
 * (openSyncDbForRead)只读,库或 sync 的表不在就报错,不建目录、不应用 schema。
 */

import fs from 'node:fs';
import path from 'node:path';

import { DatabaseConnection, DATABASE_FILENAME, getDatabasePath, type SqliteDatabase } from '../db';
import { ensureDataDir, locateData, missingDataMessage } from '../data-location';
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

function newerSchemaError(current: number): SyncSchemaError {
  return new SyncSchemaError(
    `sync schema 版本 ${current} 比当前 cgraphx 支持的版本 ${SYNC_SCHEMA_VERSION} 新,` +
      '请运行 `cgraphx upgrade` 升级 cgraphx',
  );
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
      `sync schema 应用失败:${msg}。检查数据目录里的 cgraphx.db 是否可写、未损坏,` +
        '或运行 `cgraphx install` 重新初始化',
      { cause: err },
    );
  }

  if (current > SYNC_SCHEMA_VERSION) throw newerSchemaError(current);
}

/**
 * 拿不到库时的错误:原因和修法取自数据位置(missingDataMessage)。数据目录在而库文件或 sync 的表还没建(项目目录
 * 建好、还没记过数据)时数据位置不报原因,按「还没有数据」说。
 */
function notInitializedError(start: string): SyncNotInitializedError {
  const loc = locateData(start);
  return new SyncNotInitializedError(
    missingDataMessage(loc.unavailable === null ? { ...loc, unavailable: 'not-created' as const } : loc),
  );
}

/**
 * 写的一方打开 sync 库并确保 schema 已应用:按起点经 ensureDataDir 定数据位置(要建就建),打开那里的
 * `cgraphx.db`(库文件不在就建)。调用方负责 `close()`。
 *
 * @throws SyncNotInitializedError 拿不到数据位置(没有根、认不出项目、git 跑不起来、没装过而项目库不在)。
 * @throws SyncSchemaError schema 应用失败或版本过新。
 */
export function openSyncDb(start: string): DatabaseConnection {
  const dir = ensureDataDir(start);
  if (dir === null) throw notInitializedError(start);

  const connection = DatabaseConnection.open(path.join(dir, DATABASE_FILENAME));
  try {
    ensureSyncSchema(connection.getDb());
  } catch (err) {
    connection.close();
    throw err;
  }
  return connection;
}

function hasSyncSchemaTable(db: SqliteDatabase): boolean {
  return (
    db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'sync_schema_versions'").get() !==
    undefined
  );
}

/**
 * 读的一方打开 sync 库(全局约束 3「读的一方不建」):按起点取数据位置的库(getDatabasePath)。只读:不建目录、
 * 不应用 schema、不写表。调用方负责 `close()`。
 *
 * @throws SyncNotInitializedError 数据位置拿不到、库文件不在,或库里还没有 sync 的表。
 * @throws SyncSchemaError 库里记录的版本比本构建支持的新。
 */
export function openSyncDbForRead(start: string): DatabaseConnection {
  const dbPath = getDatabasePath(start);
  if (dbPath === null || !fs.existsSync(dbPath)) throw notInitializedError(start);

  const connection = DatabaseConnection.open(dbPath);
  try {
    const db = connection.getDb();
    if (!hasSyncSchemaTable(db)) throw notInitializedError(start);
    const current = getCurrentSyncSchemaVersion(db);
    if (current > SYNC_SCHEMA_VERSION) throw newerSchemaError(current);
  } catch (err) {
    connection.close();
    throw err;
  }
  return connection;
}
