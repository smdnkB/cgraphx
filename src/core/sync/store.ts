/**
 * sync 本地状态存取(`sync_*` 表)。
 *
 * 原始行类型 `XxxRow` 保留 snake_case,行 → 领域类型在本模块内映射,不外泄。
 * `sync_state` 只允许 `connection` / `status` / `platform_spec` / `warnings` / `basis` 五个键;不存 token。
 */

import type { SqliteDatabase } from '../db';
import {
  PAUSE_REASONS,
  type PauseReason,
  type PlatformSpecCache,
  type SyncConnection,
  type SyncRunResult,
  type SyncStatusState,
  type UnreportedArtifact,
  type WarningsRecord,
} from './types';

/** `sync_state` 行。 */
interface SyncStateRow {
  key: string;
  value: string; // JSON
  updated_at: string;
}

type StateKey = 'connection' | 'status' | 'platform_spec' | 'warnings' | 'basis';

function readState(db: SqliteDatabase, key: StateKey): unknown {
  const row = db.prepare('SELECT key, value, updated_at FROM sync_state WHERE key = ?').get(key) as
    | SyncStateRow
    | undefined;
  if (row === undefined) return null;
  try {
    return JSON.parse(row.value);
  } catch {
    return null;
  }
}

function writeState(db: SqliteDatabase, key: StateKey, value: unknown, now: string): void {
  db.prepare(
    `INSERT INTO sync_state (key, value, updated_at) VALUES (?, ?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
  ).run(key, JSON.stringify(value), now);
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function stringOrNull(v: unknown): string | null {
  return typeof v === 'string' ? v : null;
}

// ─── connection ─────────────────────────────────────────────────────────────

/** 读连接信息;缺失或损坏返回 null。 */
export function getConnection(db: SqliteDatabase): SyncConnection | null {
  const raw = readState(db, 'connection');
  if (!isRecord(raw) || typeof raw.serverUrl !== 'string') return null;
  return {
    serverUrl: raw.serverUrl,
    username: stringOrNull(raw.username),
    projectName: stringOrNull(raw.projectName),
    connectedAt: stringOrNull(raw.connectedAt),
  };
}

/** 写连接信息(逐字段赋值,保证不夹带其它字段)。 */
export function setConnection(db: SqliteDatabase, connection: SyncConnection, now: string): void {
  writeState(
    db,
    'connection',
    {
      serverUrl: connection.serverUrl,
      username: connection.username,
      projectName: connection.projectName,
      connectedAt: connection.connectedAt,
    },
    now,
  );
}

// ─── status ─────────────────────────────────────────────────────────────────

/** 全 null 的同步状态。 */
export function emptyStatus(): SyncStatusState {
  return {
    lastSuccessAt: null,
    lastAttemptAt: null,
    failingSince: null,
    lastError: null,
    pausedReason: null,
    pausedAt: null,
    lastProbeAt: null,
    serverProtocolVersion: null,
    lastResult: null,
  };
}

function toPauseReason(v: unknown): PauseReason | null {
  return typeof v === 'string' && (PAUSE_REASONS as readonly string[]).includes(v) ? (v as PauseReason) : null;
}

function toRunResult(v: unknown): SyncRunResult | null {
  if (!isRecord(v) || typeof v.at !== 'string' || typeof v.ok !== 'boolean') return null;
  const num = (x: unknown): number => (typeof x === 'number' && Number.isFinite(x) ? x : 0);
  const stoppedBy =
    v.stoppedBy === 'paused' || v.stoppedBy === 'failing' || v.stoppedBy === 'not_connected' || v.stoppedBy === 'busy'
      ? v.stoppedBy
      : null;
  return {
    at: v.at,
    ok: v.ok,
    sessionsSent: num(v.sessionsSent),
    recordsSent: num(v.recordsSent),
    isolatedNew: num(v.isolatedNew),
    warnings: num(v.warnings),
    // 持久化的结果摘要不含告警明细(spec §11.4:明细单独存 'warnings' 键)
    warningItems: [],
    stoppedBy,
    error: stringOrNull(v.error),
  };
}

/** 读同步状态;缺失或损坏返回全 null。 */
export function getStatus(db: SqliteDatabase): SyncStatusState {
  const raw = readState(db, 'status');
  if (!isRecord(raw)) return emptyStatus();
  return {
    lastSuccessAt: stringOrNull(raw.lastSuccessAt),
    lastAttemptAt: stringOrNull(raw.lastAttemptAt),
    failingSince: stringOrNull(raw.failingSince),
    lastError: stringOrNull(raw.lastError),
    pausedReason: toPauseReason(raw.pausedReason),
    pausedAt: stringOrNull(raw.pausedAt),
    lastProbeAt: stringOrNull(raw.lastProbeAt),
    serverProtocolVersion: stringOrNull(raw.serverProtocolVersion),
    lastResult: toRunResult(raw.lastResult),
  };
}

/** 写同步状态(逐字段赋值)。 */
export function setStatus(db: SqliteDatabase, status: SyncStatusState, now: string): void {
  writeState(
    db,
    'status',
    {
      lastSuccessAt: status.lastSuccessAt,
      lastAttemptAt: status.lastAttemptAt,
      failingSince: status.failingSince,
      lastError: status.lastError,
      pausedReason: status.pausedReason,
      pausedAt: status.pausedAt,
      lastProbeAt: status.lastProbeAt,
      serverProtocolVersion: status.serverProtocolVersion,
      // 告警明细单独存 'warnings' 键;结果摘要里不写 warningItems
      lastResult:
        status.lastResult === null
          ? null
          : {
              at: status.lastResult.at,
              ok: status.lastResult.ok,
              sessionsSent: status.lastResult.sessionsSent,
              recordsSent: status.lastResult.recordsSent,
              isolatedNew: status.lastResult.isolatedNew,
              warnings: status.lastResult.warnings,
              stoppedBy: status.lastResult.stoppedBy,
              error: status.lastResult.error,
            },
    },
    now,
  );
}

// ─── platform_spec ──────────────────────────────────────────────────────────

/** 读本项目类型表缓存;缺失或损坏返回 null。缺 `key` 的条目丢弃。 */
export function getPlatformSpec(db: SqliteDatabase): PlatformSpecCache | null {
  const raw = readState(db, 'platform_spec');
  if (!isRecord(raw) || !Array.isArray(raw.artifactTypes)) return null;
  const artifactTypes: PlatformSpecCache['artifactTypes'] = [];
  for (const item of raw.artifactTypes) {
    if (!isRecord(item) || typeof item.key !== 'string') continue;
    artifactTypes.push({
      key: item.key,
      name: typeof item.name === 'string' ? item.name : '',
      phase: typeof item.phase === 'string' ? item.phase : '',
    });
  }
  return {
    fetchedAt: typeof raw.fetchedAt === 'string' ? raw.fetchedAt : '',
    artifactTypes,
  };
}

/** 写本项目类型表缓存(逐字段赋值)。 */
export function setPlatformSpec(db: SqliteDatabase, cache: PlatformSpecCache, now: string): void {
  writeState(
    db,
    'platform_spec',
    {
      fetchedAt: cache.fetchedAt,
      artifactTypes: cache.artifactTypes.map((type) => ({
        key: type.key,
        name: type.name,
        phase: type.phase,
      })),
    },
    now,
  );
}

// ─── warnings / basis ───────────────────────────────────────────────────────

/** 读最近一次平台告警;缺失或结构不合法返回 null。 */
export function getLastWarnings(db: SqliteDatabase): WarningsRecord | null {
  const raw = readState(db, 'warnings');
  if (!isRecord(raw) || typeof raw.at !== 'string' || !Array.isArray(raw.items)) return null;
  const items = raw.items.filter(
    (item): item is WarningsRecord['items'][number] =>
      isRecord(item) && typeof item.kind === 'string',
  );
  return { at: raw.at, items };
}

/** 写最近一次平台告警(逐字段赋值)。 */
export function setLastWarnings(db: SqliteDatabase, record: WarningsRecord, now: string): void {
  writeState(db, 'warnings', { at: record.at, items: record.items }, now);
}

/** 读最近一次成功同步时的重新评估基准;缺失返回 null。 */
export function getBasis(db: SqliteDatabase): string | null {
  const raw = readState(db, 'basis');
  return typeof raw === 'string' ? raw : null;
}

/** 写重新评估基准。 */
export function setBasis(db: SqliteDatabase, basis: string, now: string): void {
  writeState(db, 'basis', basis, now);
}

/** 删除 platform_spec / warnings / basis 三键(接入时清空上一轮平台状态)。 */
export function clearPlatformState(db: SqliteDatabase): void {
  db.prepare(`DELETE FROM sync_state WHERE key IN ('platform_spec', 'warnings', 'basis')`).run();
}

/** 删除 connection 与 status 两键(断开时用)。 */
export function clearConnectionState(db: SqliteDatabase): void {
  db.prepare(`DELETE FROM sync_state WHERE key IN ('connection', 'status')`).run();
}

// ─── unreported artifacts ───────────────────────────────────────────────────

/** 用本轮构造结果替换某会话的未上报产出(先删该会话全部行再插入)。 */
export function replaceUnreported(db: SqliteDatabase, sessionId: string, items: UnreportedArtifact[]): void {
  db.transaction(() => {
    db.prepare('DELETE FROM sync_unreported_artifacts WHERE client_session_id = ?').run(sessionId);
    const insert = db.prepare(
      'INSERT INTO sync_unreported_artifacts (client_session_id, type, path) VALUES (?, ?, ?)',
    );
    for (const item of items) insert.run(sessionId, item.type, item.path);
  })();
}

/** 当前未上报产出按类型汇总:条数为行数,示例路径取 MIN(path),按类型升序。 */
export function summarizeUnreported(
  db: SqliteDatabase,
): Array<{ type: string; count: number; samplePath: string }> {
  const rows = db
    .prepare(
      `SELECT type, count(*) AS n, MIN(path) AS sample_path
         FROM sync_unreported_artifacts
        GROUP BY type
        ORDER BY type ASC`,
    )
    .all() as unknown as Array<{ type: string; n: number; sample_path: string }>;
  return rows.map((row) => ({ type: row.type, count: Number(row.n), samplePath: row.sample_path }));
}

/** 清空全部未上报产出(接入时用)。 */
export function clearUnreported(db: SqliteDatabase): void {
  db.prepare('DELETE FROM sync_unreported_artifacts').run();
}

// ─── sessions ───────────────────────────────────────────────────────────────

/** 清空全部会话进度(接入后重新回传全部历史)。 */
export function clearSessions(db: SqliteDatabase): void {
  db.prepare('DELETE FROM sync_sessions').run();
}

// ─── reference records ──────────────────────────────────────────────────────

/** 记录一条精确参考;同 (session_id, kind, value) 已存在则忽略(保留首次时间)。 */
export function insertReferenceRecord(
  db: SqliteDatabase,
  record: { sessionId: string; kind: 'concept' | 'file'; value: string; ts: string },
): void {
  db.prepare(
    'INSERT OR IGNORE INTO sync_reference_records (session_id, kind, value, ts) VALUES (?, ?, ?, ?)',
  ).run(record.sessionId, record.kind, record.value, record.ts);
}

/** 全部参考精确记录(含 session_id),按 id 升序;一轮同步开始时一次性预载用。 */
export function listAllReferenceRecords(
  db: SqliteDatabase,
): Array<{ sessionId: string; kind: 'concept' | 'file'; value: string; ts: string }> {
  const rows = db
    .prepare('SELECT session_id, kind, value, ts FROM sync_reference_records ORDER BY id ASC')
    .all() as Array<{ session_id: string; kind: string; value: string; ts: string }>;
  const result: Array<{ sessionId: string; kind: 'concept' | 'file'; value: string; ts: string }> = [];
  for (const row of rows) {
    if (row.kind !== 'concept' && row.kind !== 'file') continue;
    result.push({ sessionId: row.session_id, kind: row.kind, value: row.value, ts: row.ts });
  }
  return result;
}

// ─── session progress ───────────────────────────────────────────────────────

/** `sync_sessions` 行(snake_case 原样,供 runner / status 判定增量)。 */
export interface SyncSessionRow {
  client_session_id: string;
  last_event_id: number;
  bindings_hash: string | null;
  extras_hash: string | null;
  pending_push: number;
  uploaded_at: string | null;
  isolated_reason: string | null;
  isolated_client_version: string | null;
}

/** 全部会话进度,按 client_session_id 建 Map。 */
export function listSessions(db: SqliteDatabase): Map<string, SyncSessionRow> {
  const rows = db
    .prepare(
      `SELECT client_session_id, last_event_id, bindings_hash, extras_hash, pending_push, uploaded_at,
              isolated_reason, isolated_client_version
         FROM sync_sessions`,
    )
    .all() as unknown as SyncSessionRow[];
  const map = new Map<string, SyncSessionRow>();
  for (const row of rows) {
    map.set(row.client_session_id, { ...row, last_event_id: Number(row.last_event_id), pending_push: Number(row.pending_push) });
  }
  return map;
}

/** 非最后一块确认后:只推进事件水位(不动哈希与隔离标记)。 */
export function advanceSessionEvents(db: SqliteDatabase, sessionId: string, lastEventId: number): void {
  db.prepare(
    `INSERT INTO sync_sessions (client_session_id, last_event_id) VALUES (?, ?)
     ON CONFLICT(client_session_id) DO UPDATE SET last_event_id = max(sync_sessions.last_event_id, excluded.last_event_id)`,
  ).run(sessionId, lastEventId);
}

/** 会话最后一块确认后:写满进度并清隔离标记。 */
export function ackSession(
  db: SqliteDatabase,
  ack: {
    sessionId: string;
    lastEventId: number;
    bindingsHash: string;
    extrasHash: string;
    pendingPush: boolean;
    uploadedAt: string;
  },
): void {
  db.prepare(
    `INSERT INTO sync_sessions
       (client_session_id, last_event_id, bindings_hash, extras_hash, pending_push, uploaded_at,
        isolated_reason, isolated_client_version)
     VALUES (?, ?, ?, ?, ?, ?, NULL, NULL)
     ON CONFLICT(client_session_id) DO UPDATE SET
       last_event_id = excluded.last_event_id,
       bindings_hash = excluded.bindings_hash,
       extras_hash = excluded.extras_hash,
       pending_push = excluded.pending_push,
       uploaded_at = excluded.uploaded_at,
       isolated_reason = NULL,
       isolated_client_version = NULL`,
  ).run(ack.sessionId, ack.lastEventId, ack.bindingsHash, ack.extrasHash, ack.pendingPush ? 1 : 0, ack.uploadedAt);
}

/** 只更新 pending_push(行不存在时不建行)。 */
export function updatePendingPush(db: SqliteDatabase, sessionId: string, pendingPush: boolean): void {
  db.prepare('UPDATE sync_sessions SET pending_push = ? WHERE client_session_id = ?').run(pendingPush ? 1 : 0, sessionId);
}

/** 标记会话被平台拒收(数据不删,记录拒收原因与当时的客户端版本;升级后自动重试)。 */
export function isolateSession(db: SqliteDatabase, sessionId: string, reason: string, clientVersion: string): void {
  db.prepare(
    `INSERT INTO sync_sessions (client_session_id, isolated_reason, isolated_client_version) VALUES (?, ?, ?)
     ON CONFLICT(client_session_id) DO UPDATE SET
       isolated_reason = excluded.isolated_reason,
       isolated_client_version = excluded.isolated_client_version`,
  ).run(sessionId, reason, clientVersion);
}

/** 被隔离的会话数。 */
export function countIsolatedSessions(db: SqliteDatabase): number {
  const row = db.prepare('SELECT count(*) AS n FROM sync_sessions WHERE isolated_reason IS NOT NULL').get() as
    | { n: number }
    | undefined;
  return Number(row?.n ?? 0);
}
