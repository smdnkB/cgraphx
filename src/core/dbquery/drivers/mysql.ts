/**
 * MySQL driver adapter (mysql2/promise).
 *
 * Spec §4.3 connection lifecycle: short-lived, no pool. Each execute() opens
 * a fresh connection and closes it in finally. Connect timeout 5s, query
 * timeout 30s (constants).
 *
 * Error mapping (spec §6.1):
 *   - auth / network / unknown-db  → ConnectionFailedError
 *   - timeout                       → QueryTimeoutError
 *   - everything else (syntax etc.) → DriverError
 */

import type mysql from 'mysql2/promise';

import { CONNECT_TIMEOUT_MS, QUERY_TIMEOUT_MS } from '../constants';
import { ConnectionFailedError, DriverError, QueryTimeoutError } from '../errors';
import type { DBProfile, DriverConnection, RawResult, QueryColumn } from '../types';

interface MysqlOptions {
  host: string;
  port: number;
  user: string;
  password: string;
  database: string;
  connectTimeout: number;
}

function classifyError(err: unknown): never {
  const code = (err as { code?: string })?.code ?? '';
  const message = err instanceof Error ? err.message : String(err);
  const lowered = message.toLowerCase();

  // Connection / auth errors
  if (
    code === 'ECONNREFUSED' ||
    code === 'ENOTFOUND' ||
    code === 'EHOSTUNREACH' ||
    code === 'ETIMEDOUT' ||
    code === 'ER_ACCESS_DENIED_ERROR' ||
    code === 'ER_BAD_DB_ERROR' ||
    code === 'PROTOCOL_CONNECTION_LOST' ||
    code === 'ER_CON_COUNT_ERROR' ||
    lowered.includes('connect etimedout') ||
    lowered.includes('access denied')
  ) {
    throw new ConnectionFailedError(
      `MySQL connection failed (${code || 'unknown'}): ${redact(message)}`,
      { code },
    );
  }

  // Query timeout (mysql2 reports as ER_QUERY_INTERRUPTED)
  if (code === 'ER_QUERY_INTERRUPTED' || lowered.includes('timeout')) {
    throw new QueryTimeoutError(QUERY_TIMEOUT_MS);
  }

  // Everything else is a driver-level error (syntax, missing table, etc.)
  throw new DriverError(`MySQL error (${code || 'unknown'}): ${message}`, { code });
}

function redact(message: string): string {
  // mysql2 doesn't echo password in error text, but defensively strip any
  // "(using password: YES)" detail that could leak presence/absence.
  return message.replace(/using password: (yes|no)/i, 'using password: [redacted]');
}

export async function createMysqlConnection(profile: DBProfile): Promise<DriverConnection> {
  const opts: MysqlOptions = {
    host: profile.host,
    port: profile.port,
    user: profile.user,
    password: profile.password,
    database: profile.database,
    connectTimeout: CONNECT_TIMEOUT_MS,
  };

  // Lazy require so test environments without mysql2 installed (none expected
  // now that it's in dependencies) still load this module file.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const mysqlModule: typeof mysql = require('mysql2/promise');

  let conn: mysql.Connection | null = null;
  try {
    conn = await mysqlModule.createConnection(opts);
  } catch (err) {
    classifyError(err);
  }

  return {
    async execute(sql: string, timeoutMs: number, params?: unknown[], _limit?: number): Promise<RawResult> {
      if (!conn) throw new DriverError('MySQL connection not initialized');
      try {
        const [rows, fields] = params && params.length > 0
          ? await conn.query({ sql, timeout: timeoutMs }, params)
          : await conn.query({ sql, timeout: timeoutMs });
        const columns: QueryColumn[] = (fields ?? []).map(f => ({
          name: f.name,
          dataType: f.columnType !== undefined ? String(f.columnType) : undefined,
        }));
        // mysql2 returns RowDataPacket[] for SELECT, OkPacket for non-SELECT.
        const rowArray = Array.isArray(rows) ? rows as Array<Record<string, unknown>> : [];
        return { columns, rows: rowArray };
      } catch (err) {
        classifyError(err);
      }
    },
    async close(): Promise<void> {
      if (!conn) return;
      try {
        await conn.end();
      } catch {
        /* ignore close errors */
      } finally {
        conn = null;
      }
    },
  };
}
