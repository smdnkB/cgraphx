/**
 * db-query executor — main entry point.
 *
 * Routes by mode, runs safety checks, dispatches to the right driver,
 * normalizes results, and writes one log record per call (spec §4 / §2.6).
 *
 * All errors thrown here are subclasses of DbQueryError (spec §6.1) —
 * callers (MCP handler, CLI) catch and convert to success-shaped responses.
 */

import { QUERY_TIMEOUT_MS, MAX_LIMIT } from './constants';
import { loadProfiles, resolveProfile } from './config';
import { checkSafety } from './safety';
import { logQuery } from './logging';
import { formatQueryResult, formatProfilesResult, formatTablesResult, extractMysqlDdl, renderPostgresDdl, formatIndexesResult, formatTableCommentResult } from './format';
import { mysqlSchemaQuery, postgresSchemaQuery, postgresConstraintDefsSql, postgresIndexDefsSql, postgresTableCommentSql } from './queries';
import { createMysqlConnection } from './drivers/mysql';
import { createPostgresConnection } from './drivers/postgres';
import { createHttpConnection } from './drivers/http';
import {
  ConfigNotFoundError,
  SubsystemDisabledError,
  SafetyRejectionError,
  DbQueryError,
} from './errors';
import type {
  QueryInput,
  QueryResult,
  SchemaInput,
  SchemaResult,
  DdlResult,
  ProfilesInput,
  ProfilesResult,
  QueryLogRecord,
  QueryStatus,
  DriverConnection,
  DBProfile,
  SchemaPayload,
} from './types';

function nowIso(): string {
  return new Date().toISOString();
}

/** Resolve a driver connection by profile type. */
function selectDriver(profile: DBProfile): Promise<DriverConnection> {
  if (profile.type === 'mysql') return createMysqlConnection(profile);
  if (profile.type === 'postgres') return createPostgresConnection(profile);
  return createHttpConnection(profile);
}

/** Wrap a structured SchemaPayload (from http executeSchema) into a SchemaResult. */
function wrapSchemaPayload(payload: SchemaPayload, profileName: string, durationMs: number): SchemaResult {
  switch (payload.kind) {
    case 'tables': return { tables: payload.tables, profile: profileName, durationMs };
    case 'ddl': return { table: payload.table, ddl: payload.ddl, profile: profileName, durationMs };
    case 'indexes': return { table: payload.table, indexes: payload.indexes, profile: profileName, durationMs };
    case 'table-comment': return { table: payload.table, comment: payload.comment, profile: profileName, durationMs };
  }
}

function elapsedMs(start: number): number {
  return Date.now() - start;
}

function statusForError(err: unknown): QueryStatus {
  if (err instanceof DbQueryError) {
    switch (err.code) {
      case 'CONFIG_NOT_FOUND':
      case 'PROFILE_NOT_FOUND':
        return 'config-error';
      case 'SAFETY_REJECTED':
        return 'safety-rejected';
      case 'CONNECTION_FAILED':
        return 'connection-failed';
      case 'QUERY_TIMEOUT':
        return 'timeout';
      case 'DRIVER_ERROR':
        return 'driver-error';
      case 'SUBSYSTEM_DISABLED':
        return 'disabled';
    }
  }
  return 'driver-error';
}

function recordAndRethrow(
  projectRoot: string,
  start: number,
  mode: QueryLogRecord['mode'],
  profileName: string,
  sql: string | undefined,
  err: unknown,
): never {
  const status = statusForError(err);
  const errorMessage = err instanceof Error ? err.message : String(err);
  logQuery(projectRoot, {
    timestamp: nowIso(),
    profile: profileName,
    mode,
    sql,
    durationMs: elapsedMs(start),
    status,
    errorMessage,
  });
  throw err;
}

/**
 * Execute a read-only SQL query (spec §4.2 mode=query).
 *
 * Throws: SubsystemDisabledError / ConfigNotFoundError / ProfileNotFoundError
 *        / SafetyRejectionError / ConnectionFailedError / QueryTimeoutError
 *        / DriverError.
 */
export async function runQuery(input: QueryInput, projectRoot: string): Promise<QueryResult> {
  const start = Date.now();
  const mode = 'query' as const;

  // 1. Load config (may throw ConfigNotFoundError).
  const cfg = loadProfiles(projectRoot);

  // 2. Disabled short-circuit (still logs).
  if (!cfg.enabled) {
    recordAndRethrow(projectRoot, start, mode, '(disabled)', input.sql, new SubsystemDisabledError());
  }

  // 3. Resolve profile.
  let profile: DBProfile;
  try {
    profile = resolveProfile(cfg, input.profile);
  } catch (err) {
    recordAndRethrow(projectRoot, start, mode, input.profile ?? '(default)', input.sql, err);
  }

  // 4. Safety check.
  const safety = checkSafety(input.sql, input.limit);
  if (!safety.ok) {
    recordAndRethrow(projectRoot, start, mode, profile.name, input.sql, safety.error);
  }

  // 5. Execute via driver.
  const driver: DriverConnection = await selectDriver(profile);

  try {
    const raw = await driver.execute(safety.normalizedSql, QUERY_TIMEOUT_MS, undefined, safety.effectiveLimit);
    const truncated = safety.effectiveLimit > 0 && raw.rows.length >= safety.effectiveLimit;
    const result = formatQueryResult(raw, profile.name, elapsedMs(start), truncated);
    logQuery(projectRoot, {
      timestamp: nowIso(),
      profile: profile.name,
      mode,
      sql: safety.normalizedSql,
      durationMs: elapsedMs(start),
      rowCount: result.rowCount,
      truncated: result.truncated,
      status: 'ok',
    });
    return result;
  } catch (err) {
    recordAndRethrow(projectRoot, start, mode, profile.name, safety.normalizedSql, err);
  } finally {
    await driver.close();
  }
}

/**
 * Run a schema-introspection query (spec §4.2 mode=tables|ddl|indexes|table-comment).
 */
export async function runSchema(input: SchemaInput, projectRoot: string): Promise<SchemaResult> {
  const start = Date.now();
  const mode = input.mode;

  const cfg = loadProfiles(projectRoot);

  if (!cfg.enabled) {
    recordAndRethrow(projectRoot, start, mode, '(disabled)', undefined, new SubsystemDisabledError());
  }

  let profile: DBProfile;
  try {
    profile = resolveProfile(cfg, input.profile);
  } catch (err) {
    recordAndRethrow(projectRoot, start, mode, input.profile ?? '(default)', undefined, err);
  }

  if ((mode === 'ddl' || mode === 'indexes' || mode === 'table-comment') && !input.table) {
    recordAndRethrow(
      projectRoot,
      start,
      mode,
      profile.name,
      undefined,
      new ConfigNotFoundError(`Table name required for mode=${mode}`),
    );
  }

  const table = input.table ?? '';

  const driver: DriverConnection = await selectDriver(profile);

  try {
    // HTTP driver delegates schema introspection to the remote endpoint.
    if (driver.executeSchema) {
      const payload = await driver.executeSchema({
        mode,
        table: input.table,
        schema: profile.schema,
        timeoutMs: QUERY_TIMEOUT_MS,
      });
      const result = wrapSchemaPayload(payload, profile.name, elapsedMs(start));
      logQuery(projectRoot, {
        timestamp: nowIso(),
        profile: profile.name,
        mode,
        sql: undefined,
        durationMs: elapsedMs(start),
        rowCount: 'tables' in result ? result.tables.length : 0,
        status: 'ok',
      });
      return result;
    }

    // DB drivers (mysql/postgres) — pick dialect SQL template and run locally.
    const parametrized =
      profile.type === 'mysql'
        ? mysqlSchemaQuery(mode, table, profile.database)
        : postgresSchemaQuery(mode, table, profile.schema ?? 'public');

    // ddl: MySQL uses SHOW CREATE TABLE (single query, server-rendered DDL);
    // PG assembles from column query + pg_get_constraintdef + table comment.
    if (mode === 'ddl') {
      let result: DdlResult;
      if (profile.type === 'mysql') {
        const showQ = mysqlSchemaQuery('ddl', table, profile.database);
        const raw = await driver.execute(showQ.sql, QUERY_TIMEOUT_MS, showQ.params);
        result = extractMysqlDdl(raw, table, profile.name, elapsedMs(start));
      } else {
        const schema = profile.schema ?? 'public';
        const colsRaw = await driver.execute(parametrized.sql, QUERY_TIMEOUT_MS, parametrized.params);
        const consQ = postgresConstraintDefsSql(table, schema);
        const consRaw = await driver.execute(consQ.sql, QUERY_TIMEOUT_MS, consQ.params);
        const idxQ = postgresIndexDefsSql(table, schema);
        const idxRaw = await driver.execute(idxQ.sql, QUERY_TIMEOUT_MS, idxQ.params);
        const tcQ = postgresTableCommentSql(table, schema);
        const tcRaw = await driver.execute(tcQ.sql, QUERY_TIMEOUT_MS, tcQ.params);
        result = renderPostgresDdl(
          colsRaw, consRaw, idxRaw, tcRaw, table, schema, profile.name, elapsedMs(start),
        );
      }
      logQuery(projectRoot, {
        timestamp: nowIso(),
        profile: profile.name,
        mode,
        sql: parametrized.sql,
        durationMs: elapsedMs(start),
        status: 'ok',
      });
      return result;
    }

    // Single-query modes (tables / indexes / table-comment)
    const raw = await driver.execute(parametrized.sql, QUERY_TIMEOUT_MS, parametrized.params);
    let result: SchemaResult;
    if (mode === 'tables') {
      result = formatTablesResult(raw, profile.name, elapsedMs(start));
    } else if (mode === 'indexes') {
      result = formatIndexesResult(raw, table, profile.name, elapsedMs(start));
    } else {
      result = formatTableCommentResult(raw, table, profile.name, elapsedMs(start));
    }
    logQuery(projectRoot, {
      timestamp: nowIso(),
      profile: profile.name,
      mode,
      sql: parametrized.sql,
      durationMs: elapsedMs(start),
      rowCount: 'tables' in result ? result.tables.length : 0,
      status: 'ok',
    });
    return result;
  } catch (err) {
    recordAndRethrow(projectRoot, start, mode, profile.name, undefined, err);
  } finally {
    await driver.close();
  }
}

/**
 * List configured profiles (spec §4.2 mode=profiles). Does NOT connect to DB.
 */
export async function listProfiles(input: ProfilesInput, projectRoot: string): Promise<ProfilesResult> {
  const start = Date.now();
  const mode = 'profiles' as const;

  const cfg = loadProfiles(projectRoot);

  if (!cfg.enabled) {
    // Per spec §2.5: even listProfiles short-circuits when disabled.
    recordAndRethrow(projectRoot, start, mode, '(disabled)', undefined, new SubsystemDisabledError());
  }

  const result = formatProfilesResult(cfg);
  logQuery(projectRoot, {
    timestamp: nowIso(),
    profile: '(none)',
    mode,
    durationMs: elapsedMs(start),
    rowCount: result.profiles.length,
    status: 'ok',
  });
  void input;
  void MAX_LIMIT;
  return result;
}

// Re-export types used by callers (index.ts re-exports further).
export type { QueryInput, QueryResult, SchemaInput, SchemaResult, ProfilesInput, ProfilesResult };
export { SafetyRejectionError };
