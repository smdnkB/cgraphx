/**
 * Type definitions for the db-query subsystem.
 *
 * Isolated from cgraphx 1.x's main `src/types.ts` (NodeKind / EdgeKind) — the
 * db-query subsystem never touches the code graph. See
 * `docs/features/2026-06-26-db-query-integration/spec.md` §0.1.
 */

export type DriverKind = 'mysql' | 'postgres' | 'http';

export type QueryMode = 'query' | 'tables' | 'ddl' | 'indexes' | 'table-comment' | 'profiles';

export type QueryStatus =
  | 'ok'
  | 'safety-rejected'
  | 'config-error'
  | 'connection-failed'
  | 'timeout'
  | 'driver-error'
  | 'disabled';

export interface DBProfile {
  name: string;
  description?: string;
  type: DriverKind;
  /** mysql/postgres: DB host. http: unused. */
  host: string;
  /** mysql/postgres: DB port. http: unused. */
  port: number;
  /** mysql/postgres: DB user. http: unused. */
  user: string;
  /** mysql/postgres: DB password. http: unused. */
  password: string;
  /** mysql/postgres: DB name. http: unused. */
  database: string;
  /** PostgreSQL schema (defaults to 'public'); http: default schema for query/schema calls. */
  schema?: string;
  /** http only: full URL of the read-only query endpoint (e.g. http://host/workflow/dbquery). */
  url?: string;
  /** http only: request headers (e.g. { Authorization: 'Bearer <token>' }). */
  headers?: Record<string, string>;
}

export type ConfigSource = 'env' | 'project-local' | 'user-global';

export interface ProfilesConfig {
  profiles: DBProfile[];
  defaultProfile: string | null;
  sources: ConfigSource[];
  enabled: boolean;
}

export interface ProfileEntry {
  description?: string;
  type: DriverKind;
  host?: string;
  port?: number;
  user?: string;
  password?: string;
  database?: string;
  schema?: string;
  /** http only. */
  url?: string;
  /** http only. */
  headers?: Record<string, string>;
}

export type ProfilesFile = {
  default?: string;
  enabled?: boolean;
  [profile: string]: ProfileEntry | string | boolean | undefined;
};

export interface QueryInput {
  sql: string;
  profile?: string;
  limit?: number;
}

export interface QueryColumn {
  name: string;
  dataType?: string;
}

export interface QueryResult {
  columns: QueryColumn[];
  rows: Record<string, unknown>[];
  rowCount: number;
  truncated: boolean;
  profile: string;
  durationMs: number;
}

export interface SchemaInput {
  mode: 'tables' | 'ddl' | 'indexes' | 'table-comment';
  table?: string;
  profile?: string;
}

export interface TableSummary {
  name: string;
  comment?: string;
}

export interface DdlResult {
  table: string;
  /** The `CREATE TABLE ...` DDL text, rendered per dialect. */
  ddl: string;
  profile: string;
  durationMs: number;
}

export interface IndexDefinition {
  name: string;
  columns: string[];
  unique: boolean;
  type?: string;
}

export interface IndexesResult {
  table: string;
  indexes: IndexDefinition[];
  profile: string;
  durationMs: number;
}

export interface TableCommentResult {
  table: string;
  comment: string | null;
  profile: string;
  durationMs: number;
}

export interface TablesResult {
  tables: TableSummary[];
  profile: string;
  durationMs: number;
}

export type SchemaResult = TablesResult | DdlResult | IndexesResult | TableCommentResult;

export interface ProfilesResult {
  profiles: Array<{
    name: string;
    description?: string;
    type: DriverKind;
    host: string;
    port: number;
    database: string;
    /** http only: endpoint URL (shown instead of host/port for http profiles). */
    url?: string;
    hasCredentials: boolean;
  }>;
  defaultProfile: string | null;
  configSources: ConfigSource[];
  enabled: boolean;
}

export interface ProfilesInput {
  /** Force a specific project root; otherwise resolved by config layer. */
  projectRoot?: string;
}

export interface QueryLogRecord {
  timestamp: string;
  profile: string;
  mode: QueryMode;
  sql?: string;
  durationMs: number;
  rowCount?: number;
  truncated?: boolean;
  status: QueryStatus;
  errorMessage?: string;
}

export interface RawResult {
  columns: QueryColumn[];
  rows: Record<string, unknown>[];
}

export interface DriverConnection {
  execute(sql: string, timeoutMs: number, params?: unknown[], limit?: number): Promise<RawResult>;
  close(): Promise<void>;
  /**
   * Optional schema-introspection path. Implemented by drivers that delegate
   * schema queries to a remote endpoint (http); mysql/postgres leave this
   * undefined and the executor falls back to its own dialect-SQL path.
   * Returns the structured SchemaResult fields (minus profile/durationMs,
   * which the executor fills in).
   */
  executeSchema?(input: {
    mode: 'tables' | 'ddl' | 'indexes' | 'table-comment';
    table?: string;
    schema?: string;
    timeoutMs: number;
  }): Promise<SchemaPayload>;
}

/**
 * Structured schema payload returned by `executeSchema`. Mirrors the data
 * fields of SchemaResult variants; the executor wraps it with profile/durationMs.
 */
export type SchemaPayload =
  | { kind: 'tables'; tables: TableSummary[] }
  | { kind: 'ddl'; table: string; ddl: string }
  | { kind: 'indexes'; table: string; indexes: IndexDefinition[] }
  | { kind: 'table-comment'; table: string; comment: string | null };
