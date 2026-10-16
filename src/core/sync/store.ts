/**
 * sync 本地状态存取(`sync_*` 表)。
 *
 * 原始行类型 `XxxRow` 保留 snake_case,行 → 领域类型在本模块内映射,不外泄。
 * `sync_state` 只允许 `connection` / `status` 两个键;不存 token。
 */

import type { SqliteDatabase } from '../db';
import { PAUSE_REASONS, type PauseReason, type SyncConnection, type SyncRunResult, type SyncStatusState } from './types';

/** `sync_state` 行。 */
interface SyncStateRow {
  key: string;
  value: string; // JSON
  updated_at: string;
}

type StateKey = 'connection' | 'status';

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
      lastResult: status.lastResult,
    },
    now,
  );
}

/** 删除 connection 与 status 两键(断开时用)。 */
export function clearConnectionState(db: SqliteDatabase): void {
  db.prepare(`DELETE FROM sync_state WHERE key IN ('connection', 'status')`).run();
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
