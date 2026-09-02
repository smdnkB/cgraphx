/**
 * HTTP driver adapter (generic read-only query transport).
 *
 * Delegates SQL execution to a remote HTTP endpoint (e.g. /workflow/dbquery)
 * instead of connecting to a database directly. Used when the target DB is
 * only reachable through an app-tier API (e.g. production behind a service).
 *
 * Contract (the remote endpoint MUST implement):
 *   POST <url>
 *     headers: profile.headers + Content-Type: application/json
 *     body (query):    { mode:"query", sql, args?, limit?, schema? }
 *     body (schema):   { mode:"tables"|"ddl"|"indexes"|"table-comment", table?, schema? }
 *   resp 200: { code:200, data: <result> }   (R-style wrapper)
 *        OR   <result>                        (bare)
 *   resp non-2xx / code!=200 → DriverError / ConnectionFailedError
 *
 * query result shape: { columns:[{name}], rows:[{...}] }
 * schema result shape: depends on mode (tables/ddl/indexes/table-comment) —
 *   the endpoint assembles these; this driver just forwards the payload.
 */

import { CONNECT_TIMEOUT_MS } from '../constants';
import { ConnectionFailedError, DriverError, QueryTimeoutError } from '../errors';
import type { DBProfile, DriverConnection, RawResult, QueryColumn, SchemaPayload } from '../types';

interface HttpQueryResponse {
  code?: number;
  msg?: string;
  data?: HttpQueryResult;
  // bare form (no wrapper)
  columns?: Array<{ name: string; dataType?: string } | string>;
  rows?: Array<Record<string, unknown>>;
}

interface HttpQueryResult {
  columns?: Array<{ name: string; dataType?: string } | string>;
  rows?: Array<Record<string, unknown>>;
}

interface HttpSchemaResponse {
  code?: number;
  msg?: string;
  data?: SchemaPayload;
}

/** Merge endpoint response (wrapper or bare) into a normalized RawResult. */
function toRawResult(body: HttpQueryResponse): RawResult {
  const payload: HttpQueryResult | undefined = body.data ?? body;
  const colsRaw = payload?.columns ?? [];
  const columns: QueryColumn[] = colsRaw.map(c =>
    typeof c === 'string' ? { name: c } : { name: String(c?.name ?? ''), dataType: c?.dataType },
  );
  const rows = (payload?.rows ?? []) as Array<Record<string, unknown>>;
  return { columns, rows };
}

function classifyHttpError(resp: Response, bodyText: string): never {
  const msg = bodyText || resp.statusText || `HTTP ${resp.status}`;
  if (resp.status === 401 || resp.status === 403) {
    throw new ConnectionFailedError(`HTTP auth failed (${resp.status}): ${abbreviate(msg)}`);
  }
  throw new DriverError(`HTTP query failed (${resp.status}): ${abbreviate(msg)}`);
}

function abbreviate(s: string): string {
  return s.length > 500 ? s.slice(0, 500) + '...(truncated)' : s;
}

export async function createHttpConnection(profile: DBProfile): Promise<DriverConnection> {
  if (!profile.url) {
    throw new DriverError(`HTTP profile "${profile.name}" missing url`);
  }
  const baseUrl = profile.url;
  const baseHeaders: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(profile.headers ?? {}),
  };

  async function postJson(body: unknown, timeoutMs: number): Promise<Response> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const resp = await fetch(baseUrl, {
        method: 'POST',
        headers: baseHeaders,
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      return resp;
    } catch (err: unknown) {
      const e = err as NodeJS.ErrnoException;
      if (e?.name === 'AbortError') {
        throw new QueryTimeoutError(timeoutMs);
      }
      throw new ConnectionFailedError(
        `HTTP request failed: ${e?.message ?? String(err)}`,
      );
    } finally {
      clearTimeout(timer);
    }
  }

  return {
    async execute(sql: string, timeoutMs: number, params?: unknown[], limit?: number): Promise<RawResult> {
      const totalTimeout = CONNECT_TIMEOUT_MS + timeoutMs;
      const resp = await postJson(
        { mode: 'query', sql, args: params ?? [], limit, schema: undefined },
        totalTimeout,
      );
      const text = await resp.text();
      if (!resp.ok) classifyHttpError(resp, text);
      let body: HttpQueryResponse;
      try {
        body = JSON.parse(text) as HttpQueryResponse;
      } catch {
        throw new DriverError(`HTTP response not JSON: ${abbreviate(text)}`);
      }
      // R-style wrapper with code field: code != 200 → error
      if (typeof body.code === 'number' && body.code !== 200) {
        const msg = body.msg || `code=${body.code}`;
        throw new DriverError(`HTTP query rejected: ${abbreviate(msg)}`);
      }
      return toRawResult(body);
    },

    async executeSchema(input): Promise<SchemaPayload> {
      const totalTimeout = CONNECT_TIMEOUT_MS + input.timeoutMs;
      const resp = await postJson(
        { mode: input.mode, table: input.table, schema: input.schema },
        totalTimeout,
      );
      const text = await resp.text();
      if (!resp.ok) classifyHttpError(resp, text);
      let body: HttpSchemaResponse;
      try {
        body = JSON.parse(text) as HttpSchemaResponse;
      } catch {
        throw new DriverError(`HTTP schema response not JSON: ${abbreviate(text)}`);
      }
      if (typeof body.code === 'number' && body.code !== 200) {
        const msg = body.msg || `code=${body.code}`;
        throw new DriverError(`HTTP schema rejected: ${abbreviate(msg)}`);
      }
      const payload = body.data;
      if (!payload || typeof payload !== 'object' || !('kind' in payload)) {
        throw new DriverError(`HTTP schema response missing structured payload`);
      }
      return payload;
    },

    async close(): Promise<void> {
      // stateless — nothing to close
    },
  };
}
