/**
 * Type definitions for the db-query subsystem.
 *
 * Isolated from cgraphx 1.x's main `src/types.ts` (NodeKind / EdgeKind) — the
 * db-query subsystem never touches the code graph. See
 * `docs/features/2026-06-26-db-query-integration/spec.md` §0.1.
 */

export type DriverKind = 'mysql' | 'postgres';

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
  host: string;
  port: number;
  user: string;
  password: string;
  database: string;
  /** PostgreSQL only; defaults to 'public'. */
  schema?: string;
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
  host: string;
  port?: number;
  user: string;
  password: string;
  database: string;
  schema?: string;
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
  execute(sql: string, timeoutMs: number, params?: unknown[]): Promise<RawResult>;
  close(): Promise<void>;
}
