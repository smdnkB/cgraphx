/**
 * 并旧库的 sync 表与平台连接(spec:2026-11-05-数据按项目放用户目录 D29 的 sync 与平台连接两行)。
 *
 * 由 project 子系统在并旧数据第 ② 段调用:旧库的写事务由调用方持有,这里只读旧库;项目库的写入包在一个
 * `BEGIN IMMEDIATE` 事务里,出错回滚后抛出。旧库没有哪张表就跳过那部分。
 *
 * - 平台连接:旧 = 本地 `task-source.json` + 旧库 `sync_state` 的 connection,新 = 项目目录里的同两样。旧的都没有
 *   → 什么都不做;项目里都没有 → 整份搬过去(`task-source.json` 原样复制、0600,`sync_state` 的键全部复制,
 *   connection 没有上报地址的补上并的那个目录的 origin);一样 → 什么都不做;其余 → 留项目里的,提示一句(M2)。
 * - 上报进度 `sync_sessions`:接的是同一个平台(两边都有 connection,平台地址、上报地址都相同;只换过 token 不算
 *   换平台)或刚整份搬过去时才并,进度按事件 id 对照换算;否则整张表不并,这些会话按项目库的连接重报。
 * - 精确参考、未上报产出:按唯一键 `INSERT OR IGNORE`。
 *
 * 上报地址比的是 origin 原样(平台按原样认项目),不规整。
 */

import fs from 'node:fs';
import path from 'node:path';

import type { SqliteDatabase } from '../db';
import { TASK_SOURCE_CONFIG_FILENAME } from '../task';
import type { EventIdMapping } from '../timeline';
import { getOriginUrl } from './git';
import { ensureSyncSchema } from './schema-bootstrap';
import { getConnection, setConnection } from './store';
import type { SyncConnection } from './types';

export interface SyncMergeInput {
  oldDb: SqliteDatabase;
  projectDb: SqliteDatabase;
  mapping: EventIdMapping;
  /** 并的那个目录(连接里没有 remoteUrl 时取它的 origin 补上、比较) */
  mergingRoot: string;
  /** 本地 .cgraphx/(旧的 task-source.json 在这里) */
  oldDataDir: string;
  /** 项目目录 */
  projectDataDir: string;
  /** 提示里的 <目录名>:并的那个目录的 basename */
  dirName: string;
}

const STATE_TABLE = 'sync_state';
const SESSIONS_TABLE = 'sync_sessions';
const REFERENCES_TABLE = 'sync_reference_records';
const UNREPORTED_TABLE = 'sync_unreported_artifacts';

/** 复制过去的 task-source.json 的权限:里面有凭据,只给自己看。 */
const SOURCE_FILE_MODE = 0o600;

const UPSERT_STATE_SQL =
  'INSERT INTO sync_state (key, value, updated_at) VALUES (?, ?, ?) ' +
  'ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at';

/** 平台连接这一部分怎么办(D29 平台连接行的四种情形,按顺序判断)。 */
type PlatformAction = 'none' | 'copy' | 'same' | 'differs';

interface StateRow {
  key: string;
  value: string; // JSON
  updated_at: string;
}

interface SessionRow {
  client_session_id: string;
  last_event_id: number | bigint;
  bindings_hash: string | null;
  extras_hash: string | null;
  pending_push: number | bigint;
  uploaded_at: string | null;
  isolated_reason: string | null;
  isolated_client_version: string | null;
}

interface ReferenceRow {
  session_id: string;
  kind: string;
  value: string;
  ts: string;
}

interface UnreportedRow {
  client_session_id: string;
  type: string;
  path: string;
}

function hasTable(db: SqliteDatabase, name: string): boolean {
  return db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(name) !== undefined;
}

/** 读文件原文;不在 → null。其余读不了的错误照抛:判断不了就不并,由调用方按并失败处理。 */
function readFileOrNull(file: string): Buffer | null {
  try {
    return fs.readFileSync(file);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw err;
  }
}

/** 两份文件「都不在,或都在且逐字相同」。 */
function sameFile(a: Buffer | null, b: Buffer | null): boolean {
  return a === null || b === null ? a === b : a.equals(b);
}

function removeQuietly(file: string): void {
  try {
    fs.rmSync(file, { force: true });
  } catch {
    // 临时文件删不掉不盖住原来的结果
  }
}

/**
 * 并旧库的 sync 表与平台连接(规则见文件头)。返回给人看的提示(M2 的平台连接那句)。
 *
 * @throws 读旧库、写项目库、复制 task-source.json 出错(项目库已回滚,临时文件已删)。
 */
export function mergeSyncTables(input: SyncMergeInput): { notices: string[] } {
  const { oldDb, projectDb } = input;
  const notices: string[] = [];

  const oldHas = {
    state: hasTable(oldDb, STATE_TABLE),
    sessions: hasTable(oldDb, SESSIONS_TABLE),
    references: hasTable(oldDb, REFERENCES_TABLE),
    unreported: hasTable(oldDb, UNREPORTED_TABLE),
  };
  const oldSource = readFileOrNull(path.join(input.oldDataDir, TASK_SOURCE_CONFIG_FILENAME));
  // 旧目录本来就没有 sync 的东西:什么都不做、不提示
  if (!oldHas.state && !oldHas.sessions && !oldHas.references && !oldHas.unreported && oldSource === null) {
    return { notices };
  }
  const oldConnection = oldHas.state ? getConnection(oldDb) : null;

  let mergingOrigin: string | null | undefined;
  /** 旧连接的上报地址:旧值为 null 时拿并的那个目录的 origin(取一次)。 */
  const oldRemoteUrl = (connection: SyncConnection): string | null => {
    if (connection.remoteUrl !== null) return connection.remoteUrl;
    if (mergingOrigin === undefined) mergingOrigin = getOriginUrl(input.mergingRoot);
    return mergingOrigin;
  };

  const projectSourceFile = path.join(input.projectDataDir, TASK_SOURCE_CONFIG_FILENAME);
  let stagedSource: string | null = null;
  projectDb.exec('BEGIN IMMEDIATE');
  try {
    ensureSyncSchema(projectDb);
    const projectSource = readFileOrNull(projectSourceFile);
    const projectConnection = getConnection(projectDb);

    const action = decidePlatform(oldSource, oldConnection, projectSource, projectConnection, oldRemoteUrl);
    if (action === 'copy') {
      // task-source.json 先写到同目录的临时文件,项目库提交后再改名到位:库没写成就不留凭据
      if (oldSource !== null) stagedSource = stageSourceFile(projectSourceFile, oldSource);
      if (oldHas.state) copyState(oldDb, projectDb, oldConnection, oldRemoteUrl);
    } else if (action === 'differs') {
      notices.push(`${input.dirName} 的平台连接和项目里已有的不一样,没并,在备份里`);
    }

    if (oldHas.sessions && (action === 'copy' || samePlatform(oldConnection, projectConnection, oldRemoteUrl))) {
      mergeSessions(oldDb, projectDb, input.mapping);
    }
    if (oldHas.references) mergeReferences(oldDb, projectDb);
    if (oldHas.unreported) mergeUnreported(oldDb, projectDb);

    projectDb.exec('COMMIT');
  } catch (err) {
    try {
      projectDb.exec('ROLLBACK');
    } catch {
      // 事务可能已结束
    }
    if (stagedSource !== null) removeQuietly(stagedSource);
    throw err;
  }

  if (stagedSource !== null) {
    try {
      fs.renameSync(stagedSource, projectSourceFile);
    } catch (err) {
      removeQuietly(stagedSource);
      throw err;
    }
  }
  return { notices };
}

// ─── 平台连接 ───────────────────────────────────────────────────────────────

function decidePlatform(
  oldSource: Buffer | null,
  oldConnection: SyncConnection | null,
  projectSource: Buffer | null,
  projectConnection: SyncConnection | null,
  oldRemoteUrl: (connection: SyncConnection) => string | null,
): PlatformAction {
  if (oldSource === null && oldConnection === null) return 'none';
  if (projectSource === null && projectConnection === null) return 'copy';
  // 两边都没有 connection(都只有 task-source.json)时只比文件
  const sameConnection =
    oldConnection === null || projectConnection === null
      ? oldConnection === projectConnection
      : samePlatform(oldConnection, projectConnection, oldRemoteUrl);
  return sameFile(oldSource, projectSource) && sameConnection ? 'same' : 'differs';
}

/**
 * 接的是同一个平台(index C-11):两边都有 connection,平台地址相同,上报地址相同(旧的为 null 时拿并的那个目录的
 * origin 比)。只换过 token(task-source.json 内容不同)不算换平台。
 */
function samePlatform(
  oldConnection: SyncConnection | null,
  projectConnection: SyncConnection | null,
  oldRemoteUrl: (connection: SyncConnection) => string | null,
): boolean {
  if (oldConnection === null || projectConnection === null) return false;
  return (
    oldConnection.serverUrl === projectConnection.serverUrl &&
    oldRemoteUrl(oldConnection) === projectConnection.remoteUrl
  );
}

/** 把旧的 task-source.json 原样写到项目目录里的临时文件(0600),返回临时文件路径。 */
function stageSourceFile(target: string, content: Buffer): string {
  const tmp = path.join(
    path.dirname(target),
    `.${path.basename(target)}.${process.pid}.${Math.random().toString(36).slice(2)}.tmp`,
  );
  try {
    fs.writeFileSync(tmp, content, { mode: SOURCE_FILE_MODE, flag: 'wx' });
    // 文件权限受 umask 影响,显式收紧
    fs.chmodSync(tmp, SOURCE_FILE_MODE);
  } catch (err) {
    removeQuietly(tmp);
    throw err;
  }
  return tmp;
}

/** 旧库 sync_state 的键全部复制过去(连同更新时间);connection 没有上报地址的补上并的那个目录的 origin。 */
function copyState(
  oldDb: SqliteDatabase,
  projectDb: SqliteDatabase,
  oldConnection: SyncConnection | null,
  oldRemoteUrl: (connection: SyncConnection) => string | null,
): void {
  const rows = oldDb.prepare('SELECT key, value, updated_at FROM sync_state ORDER BY key').all() as StateRow[];
  const upsert = projectDb.prepare(UPSERT_STATE_SQL);
  for (const row of rows) upsert.run(row.key, row.value, row.updated_at);

  if (oldConnection === null || oldConnection.remoteUrl !== null) return;
  const remoteUrl = oldRemoteUrl(oldConnection);
  if (remoteUrl === null) return;
  const updatedAt = rows.find((row) => row.key === 'connection')?.updated_at ?? new Date().toISOString();
  setConnection(projectDb, { ...oldConnection, remoteUrl }, updatedAt);
}

// ─── 上报进度、精确参考、未上报产出 ─────────────────────────────────────────

/**
 * 逐行并上报进度:旧进度按事件 id 对照换算成 newLast;项目库没有这一行 → 插入(其余列照旧库);有 → 这一行的进度
 * 正好是并之前项目库里这个会话的最大事件 id(之前的都报完了)时取 max(项目库值, newLast),否则不动。
 */
function mergeSessions(oldDb: SqliteDatabase, projectDb: SqliteDatabase, mapping: EventIdMapping): void {
  const select = oldDb.prepare(
    `SELECT client_session_id, last_event_id, bindings_hash, extras_hash, pending_push, uploaded_at,
            isolated_reason, isolated_client_version
       FROM sync_sessions
      ORDER BY client_session_id`,
  );
  const current = projectDb.prepare('SELECT last_event_id FROM sync_sessions WHERE client_session_id = ?');
  const insert = projectDb.prepare(
    `INSERT INTO sync_sessions
       (client_session_id, last_event_id, bindings_hash, extras_hash, pending_push, uploaded_at,
        isolated_reason, isolated_client_version)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  const advance = projectDb.prepare(
    'UPDATE sync_sessions SET last_event_id = max(last_event_id, ?) WHERE client_session_id = ?',
  );

  for (const row of select.iterate() as IterableIterator<SessionRow>) {
    const sessionId = row.client_session_id;
    const newLast = mapping.mapProgress(sessionId, Number(row.last_event_id));
    const existing = current.get(sessionId) as { last_event_id: number | bigint } | undefined;
    if (existing === undefined) {
      insert.run(
        sessionId,
        newLast,
        row.bindings_hash,
        row.extras_hash,
        row.pending_push,
        row.uploaded_at,
        row.isolated_reason,
        row.isolated_client_version,
      );
      continue;
    }
    const before = mapping.projectMaxIdBefore(sessionId);
    if (before !== null && Number(existing.last_event_id) === before) advance.run(newLast, sessionId);
  }
}

/** 精确参考按 (session_id, kind, value) 唯一键 INSERT OR IGNORE,不带旧 id;按旧 id 顺序插入。 */
function mergeReferences(oldDb: SqliteDatabase, projectDb: SqliteDatabase): void {
  const select = oldDb.prepare('SELECT session_id, kind, value, ts FROM sync_reference_records ORDER BY id');
  const insert = projectDb.prepare(
    'INSERT OR IGNORE INTO sync_reference_records (session_id, kind, value, ts) VALUES (?, ?, ?, ?)',
  );
  for (const row of select.iterate() as IterableIterator<ReferenceRow>) {
    insert.run(row.session_id, row.kind, row.value, row.ts);
  }
}

/** 未上报产出按主键 (client_session_id, type, path) INSERT OR IGNORE。 */
function mergeUnreported(oldDb: SqliteDatabase, projectDb: SqliteDatabase): void {
  const select = oldDb.prepare('SELECT client_session_id, type, path FROM sync_unreported_artifacts');
  const insert = projectDb.prepare(
    'INSERT OR IGNORE INTO sync_unreported_artifacts (client_session_id, type, path) VALUES (?, ?, ?)',
  );
  for (const row of select.iterate() as IterableIterator<UnreportedRow>) {
    insert.run(row.client_session_id, row.type, row.path);
  }
}
