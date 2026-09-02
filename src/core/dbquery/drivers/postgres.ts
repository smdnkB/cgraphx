/**
 * PostgreSQL driver adapter (pg).
 *
 * Spec §4.3: short-lived Client per execute, no pool. Connect timeout 5s
 * (pg reads this from the connection URI's `connect_timeout` query param),
 * query timeout 30s (we SET statement_timeout after connect).
 *
 * Error mapping (spec §6.1):
 *   - 28P01 / 28000 (auth)         → ConnectionFailedError
 *   - ECONNREFUSED / ENOTFOUND     → ConnectionFailedError
 *   - 57014 (query_canceled)       → QueryTimeoutError
 *   - everything else              → DriverError
 */

import { Client, type QueryResult, type QueryResultRow } from 'pg';

import { CONNECT_TIMEOUT_MS, QUERY_TIMEOUT_MS } from '../constants';
import { ConnectionFailedError, DriverError, QueryTimeoutError } from '../errors';
import type { DBProfile, DriverConnection, RawResult, QueryColumn } from '../types';

interface PgConnectError extends Error {
  code?: string;
  errno?: string;
}

function classifyError(err: unknown): never {
  const e = err as PgConnectError;
  const code = e.code ?? e.errno ?? '';
  const message = e instanceof Error ? e.message : String(err);
  const lowered = message.toLowerCase();

  // Auth / connection errors
  if (
    code === '28P01' ||         // password auth failed
    code === '28000' ||         // authorization denied
    code === '3D000' ||         // database does not exist
    code === 'ECONNREFUSED' ||
    code === 'ENOTFOUND' ||
    code === 'EHOSTUNREACH' ||
    code === 'ETIMEDOUT' ||
    lowered.includes('password authentication failed') ||
    lowered.includes('connect etimedout')
  ) {
    throw new ConnectionFailedError(
      `PostgreSQL connection failed (${code || 'unknown'}): ${redact(message)}`,
      { code },
    );
  }

  // Cancellation — pg returns code 57014 for statement_timeout cancel
  if (code === '57014' || lowered.includes('canceling statement due to statement timeout')) {
    throw new QueryTimeoutError(QUERY_TIMEOUT_MS);
  }

  throw new DriverError(`PostgreSQL error (${code || 'unknown'}): ${message}`, { code });
}

function redact(message: string): string {
  return message.replace(/password:[^)\s]+/gi, 'password:[redacted]');
}

export async function createPostgresConnection(profile: DBProfile): Promise<DriverConnection> {
  const schema = profile.schema ?? 'public';
  const connectionString =
    `postgresql://${encodeURIComponent(profile.user)}:${encodeURIComponent(profile.password)}` +
    `@${profile.host}:${profile.port}/${encodeURIComponent(profile.database)}` +
    `?connect_timeout=${Math.ceil(CONNECT_TIMEOUT_MS / 1000)}`;

  let client: Client | null = null;
  try {
    client = new Client({ connectionString });
    await client.connect();
    // Apply statement_timeout so runaway queries cancel automatically.
    await client.query(`SET statement_timeout = ${QUERY_TIMEOUT_MS}`);
    // Set search_path so unqualified table names resolve correctly.
    await client.query(`SET search_path TO ${schema}, public`);
  } catch (err) {
    if (client) {
      try {
        await client.end();
      } catch {
        /* ignore */
      }
    }
    classifyError(err);
  }

  return {
    async execute(sql: string, _timeoutMs: number, params?: unknown[], _limit?: number): Promise<RawResult> {
      if (!client) throw new DriverError('PostgreSQL client not initialized');
      try {
        const result: QueryResult<QueryResultRow> = params
          ? await client.query(sql, params)
          : await client.query(sql);
        const columns: QueryColumn[] = (result.fields ?? []).map(f => ({
          name: f.name,
          dataType: f.dataTypeID !== undefined ? String(f.dataTypeID) : undefined,
        }));
        const rows = (result.rows ?? []) as Array<Record<string, unknown>>;
        return { columns, rows };
      } catch (err) {
        classifyError(err);
      }
    },
    async close(): Promise<void> {
      if (!client) return;
      try {
        await client.end();
      } catch {
        /* ignore */
      } finally {
        client = null;
      }
    },
  };
}
