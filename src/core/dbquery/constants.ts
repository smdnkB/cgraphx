/**
 * Constants for the db-query subsystem.
 *
 * All tunable knobs live here. See spec §3.4 / §3.5 / §2.6 for the values
 * behind each.
 */

/**
 * SQL keywords that mutate state. If any of these appear in the SQL (after
 * comment stripping — see safety.ts), the query is rejected.
 *
 * Case-insensitive, word-boundary matched (so `INSERTED` is NOT mistaken for
 * `INSERT`). MySQL backtick-quoted identifiers are NOT exempted (defensive —
 * a `\`INSERT\`` table reference still triggers rejection).
 */
export const FORBIDDEN_KEYWORDS: readonly string[] = [
  'DELETE',
  'UPDATE',
  'INSERT',
  'DROP',
  'CREATE',
  'ALTER',
  'TRUNCATE',
  'GRANT',
  'REVOKE',
  'MERGE',
  'REPLACE',
  'CALL',
  'EXEC',
  'EXECUTE',
  'RENAME',
  'ATTACH',
  'DETACH',
  'VACUUM',
  'REINDEX',
  'LOAD',
  'COPY',
];

/** Default LIMIT applied to SELECT without an explicit LIMIT. */
export const DEFAULT_LIMIT = 100;

/** Hard ceiling on LIMIT — anything higher is rewritten down to this. */
export const MAX_LIMIT = 1000;

/** Per-field byte limit before truncation (BLOB / large text → base64 + truncated). */
export const MAX_FIELD_BYTES = 8 * 1024;

/** Query timeout (milliseconds). Applied per query via driver-level timeout. */
export const QUERY_TIMEOUT_MS = 30_000;

/** Connect timeout (milliseconds). TCP / auth must complete within this. */
export const CONNECT_TIMEOUT_MS = 5_000;

/** Config file name (placed under .cgraphx/ or ~/.cgraphx/). */
export const PROFILES_FILENAME = 'db-profiles.json';

/** Environment variable to override the config file path entirely. */
export const PROFILES_PATH_ENV = 'CGRAPHX_DB_PROFILES_PATH';

/** Environment variable that disables the entire db-query subsystem. */
export const DISABLED_ENV = 'CGRAPHX_DB_QUERY_DISABLED';

/** Log file name (placed under .cgraphx/). */
export const LOG_FILENAME = 'db-query.log';

/** Log file size threshold that triggers rotation, in bytes. */
export const LOG_MAX_BYTES = 10 * 1024 * 1024;

/** Number of rotated log files to keep (.log, .log.1, ..., .log.<N-1>). */
export const LOG_KEEP_FILES = 5;

/** Fixed response text when the subsystem is disabled. See spec §2.5. */
export const DISABLED_RESPONSE_TEXT = '数据库无法连接,请以代码中查询为准';
