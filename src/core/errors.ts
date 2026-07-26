/**
 * cgraphx Error Classes & Logger
 *
 * Custom error types and a swappable logger for cgraphx operations. Only the
 * generic, non-graph error subclasses live here (FileError, DatabaseError,
 * ConfigError); graph-specific errors (ParseError, SearchError, VectorError)
 * were removed with the graph subsystem.
 *
 * @module errors
 */

/**
 * Base error class for all cgraphx errors.
 *
 * All cgraphx-specific errors extend this class, allowing you to catch all
 * cgraphx errors with a single catch block.
 */
export class CodeGraphError extends Error {
  /** Error code for categorization (e.g., 'FILE_ERROR', 'DATABASE_ERROR') */
  readonly code: string;
  /** Additional context about the error */
  readonly context?: Record<string, unknown>;

  constructor(message: string, code: string, context?: Record<string, unknown>) {
    super(message);
    this.name = 'CodeGraphError';
    this.code = code;
    this.context = context;

    // Maintain proper stack trace for V8
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, this.constructor);
    }
  }
}

/**
 * Error reading or accessing files
 */
export class FileError extends CodeGraphError {
  readonly filePath: string;

  constructor(message: string, filePath: string, cause?: Error) {
    super(message, 'FILE_ERROR', { filePath, cause: cause?.message });
    this.name = 'FileError';
    this.filePath = filePath;
    if (cause) {
      this.cause = cause;
    }
  }
}

/**
 * Error with database operations
 */
export class DatabaseError extends CodeGraphError {
  readonly operation: string;

  constructor(message: string, operation: string, cause?: Error) {
    super(message, 'DATABASE_ERROR', { operation, cause: cause?.message });
    this.name = 'DatabaseError';
    this.operation = operation;
    if (cause) {
      this.cause = cause;
    }
  }
}

/**
 * Error with configuration
 */
export class ConfigError extends CodeGraphError {
  constructor(message: string, details?: Record<string, unknown>) {
    super(message, 'CONFIG_ERROR', details);
    this.name = 'ConfigError';
  }
}

/**
 * Simple logger for cgraphx operations
 *
 * By default, logs to console.warn for warnings and console.error for errors.
 * Can be configured to use custom logging.
 */
export interface Logger {
  debug(message: string, context?: Record<string, unknown>): void;
  warn(message: string, context?: Record<string, unknown>): void;
  error(message: string, context?: Record<string, unknown>): void;
}

/**
 * Default console-based logger
 */
export const defaultLogger: Logger = {
  debug(message: string, context?: Record<string, unknown>): void {
    if (process.env.CGRAPHX_DEBUG) {
      console.debug(`[cgraphx] ${message}`, context ?? '');
    }
  },
  warn(message: string, context?: Record<string, unknown>): void {
    console.warn(`[cgraphx] ${message}`, context ?? '');
  },
  error(message: string, context?: Record<string, unknown>): void {
    console.error(`[cgraphx] ${message}`, context ?? '');
  },
};

/**
 * Silent logger (no output) - useful for tests
 */
export const silentLogger: Logger = {
  debug(): void {},
  warn(): void {},
  error(): void {},
};

/**
 * Current logger instance (can be replaced)
 */
let currentLogger: Logger = defaultLogger;

/**
 * Set the global logger
 */
export function setLogger(logger: Logger): void {
  currentLogger = logger;
}

/**
 * Get the current logger
 */
export function getLogger(): Logger {
  return currentLogger;
}

/**
 * Log a warning message
 */
export function logWarn(message: string, context?: Record<string, unknown>): void {
  currentLogger.warn(message, context);
}

/**
 * Log an error message
 */
export function logError(message: string, context?: Record<string, unknown>): void {
  currentLogger.error(message, context);
}
