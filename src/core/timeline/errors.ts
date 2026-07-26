/**
 * Error types for the Developer Timeline subsystem.
 *
 * Independent from cgraphx's main error types so the subsystem can be
 * removed without touching the rest of the project. All errors are
 * operational and the hook layer swallows them (writes stderr + exit 0)
 * so they never block Claude.
 */

export type TimelineErrorCode =
  | 'PAYLOAD_INVALID'
  | 'SCHEMA_ERROR'
  | 'STORE_INSERT_FAILED'
  | 'STORE_QUERY_FAILED';

export class TimelineError extends Error {
  constructor(
    message: string,
    public readonly code: TimelineErrorCode,
    public readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'TimelineError';
  }
}

export class HookPayloadError extends TimelineError {
  constructor(message: string, details?: Record<string, unknown>) {
    super(message, 'PAYLOAD_INVALID', details);
    this.name = 'HookPayloadError';
  }
}

export class TimelineSchemaError extends TimelineError {
  constructor(message: string, details?: Record<string, unknown>) {
    super(message, 'SCHEMA_ERROR', details);
    this.name = 'TimelineSchemaError';
  }
}

export class StoreInsertError extends TimelineError {
  constructor(message: string, details?: Record<string, unknown>) {
    super(message, 'STORE_INSERT_FAILED', details);
    this.name = 'StoreInsertError';
  }
}

export class StoreQueryError extends TimelineError {
  constructor(message: string, details?: Record<string, unknown>) {
    super(message, 'STORE_QUERY_FAILED', details);
    this.name = 'StoreQueryError';
  }
}
