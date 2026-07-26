/**
 * Error types for the db-query subsystem.
 *
 * Independent from cgraphx's main error types so the subsystem can be
 * removed without touching the rest of the project. All errors here are
 * expected/operational and the MCP/CLI surfaces convert them to
 * success-shaped responses (spec §6.2).
 */

export type DbQueryErrorCode =
  | 'CONFIG_NOT_FOUND'
  | 'PROFILE_NOT_FOUND'
  | 'SAFETY_REJECTED'
  | 'CONNECTION_FAILED'
  | 'QUERY_TIMEOUT'
  | 'DRIVER_ERROR'
  | 'SUBSYSTEM_DISABLED';

export class DbQueryError extends Error {
  constructor(
    message: string,
    public readonly code: DbQueryErrorCode,
    public readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'DbQueryError';
  }
}

export class ConfigNotFoundError extends DbQueryError {
  constructor(message: string, details?: Record<string, unknown>) {
    super(message, 'CONFIG_NOT_FOUND', details);
    this.name = 'ConfigNotFoundError';
  }
}

export class ProfileNotFoundError extends DbQueryError {
  constructor(
    public readonly queriedProfile: string | null,
    available: string[],
  ) {
    const list = available.length > 0 ? available.join(', ') : '(none)';
    super(
      queriedProfile
        ? `Profile not found: ${queriedProfile}. Available profiles: ${list}`
        : `No profile specified and no default configured. Available profiles: ${list}`,
      'PROFILE_NOT_FOUND',
      { queriedProfile, available },
    );
    this.name = 'ProfileNotFoundError';
  }
}

export class SafetyRejectionError extends DbQueryError {
  constructor(
    public readonly matchedKeywords: string[],
    public readonly normalizedSql: string,
  ) {
    super(
      `Query rejected: SQL contains forbidden keyword(s): ${matchedKeywords.join(', ')}. ` +
        `Only read-only SELECT queries are allowed.`,
      'SAFETY_REJECTED',
      { matchedKeywords },
    );
    this.name = 'SafetyRejectionError';
  }
}

export class ConnectionFailedError extends DbQueryError {
  constructor(message: string, details?: Record<string, unknown>) {
    super(message, 'CONNECTION_FAILED', details);
    this.name = 'ConnectionFailedError';
  }
}

export class QueryTimeoutError extends DbQueryError {
  constructor(public readonly timeoutMs: number) {
    super(
      `Query timed out after ${timeoutMs}ms. The query may be too expensive; ` +
        `narrow the scope or add a tighter LIMIT.`,
      'QUERY_TIMEOUT',
      { timeoutMs },
    );
    this.name = 'QueryTimeoutError';
  }
}

export class DriverError extends DbQueryError {
  constructor(message: string, details?: Record<string, unknown>) {
    super(message, 'DRIVER_ERROR', details);
    this.name = 'DriverError';
  }
}

export class SubsystemDisabledError extends DbQueryError {
  constructor() {
    super('db-query subsystem is disabled.', 'SUBSYSTEM_DISABLED');
    this.name = 'SubsystemDisabledError';
  }
}
