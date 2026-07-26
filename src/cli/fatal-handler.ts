/**
 * Last-resort handlers for uncaught exceptions and unhandled rejections.
 *
 * Reaching one of these means a fault escaped every boundary (per-request
 * try/catch in command actions, schema-bootstrap's own error types, the
 * timeline hook layer's fail-silent contract) — i.e. the process is in an
 * undefined state. Node's default in that case is to print and exit
 * non-zero; this module restores that safe default after logging a
 * BOUNDED, hang-proof line.
 *
 * Two properties are load-bearing and covered by tests:
 *   1. {@link describeFatal} never reads `error.stack` and never hands the
 *      raw Error to `console.*`. The lazy stack getter can loop forever
 *      inside this handler; touching it could block the very `exit()`
 *      below. Name + message are plain string properties and are always
 *      safe.
 *   2. We write synchronously to fd 2 and then exit, so the message is
 *      flushed even though `process.exit()` doesn't drain async streams.
 *
 * Migrated from cgraphx 1.x (src/bin/fatal-handler.ts) — the handler is
 * generic process-level infrastructure, independent of the code-graph
 * layer that 2.0 removes.
 */
import * as fs from 'fs';

/**
 * Render an uncaught value for the last-resort log WITHOUT triggering
 * stack formatting. Pure and total — never throws, never touches `.stack`.
 */
export function describeFatal(value: unknown): string {
  if (value instanceof Error) {
    const name = typeof value.name === 'string' && value.name ? value.name : 'Error';
    // `message` is a plain own/proto string property — reading it does NOT
    // format the stack.
    const message = typeof value.message === 'string' ? value.message : '';
    return message ? `${name}: ${message}` : name;
  }
  try {
    return String(value);
  } catch {
    // e.g. an object with a throwing `toString` / `Symbol.toPrimitive`.
    return '<unstringifiable value>';
  }
}

/** Best-effort synchronous stderr write that can never keep a doomed process alive. */
function writeStderr(line: string): void {
  try {
    fs.writeSync(2, line);
  } catch {
    /* stderr closed/gone — nothing more we can safely do */
  }
}

/** Injectable seams so the wiring is testable without registering real handlers. */
export interface FatalHandlerDeps {
  /** Event target to attach to. Defaults to `process`. */
  target?: NodeJS.EventEmitter;
  /** How to terminate. Defaults to `process.exit`. */
  exit?: (code: number) => void;
  /** How to emit the bounded line. Defaults to a synchronous fd-2 write. */
  write?: (line: string) => void;
}

/**
 * Install the uncaught-exception / unhandled-rejection handlers. Both
 * log a bounded line and then exit non-zero (Node's default fatal
 * semantics).
 */
export function installFatalHandlers(deps: FatalHandlerDeps = {}): void {
  const target = deps.target ?? process;
  const exit = deps.exit ?? ((code: number) => process.exit(code));
  const write = deps.write ?? writeStderr;

  target.on('uncaughtException', (error: unknown) => {
    write(`[cgraphx] Uncaught exception: ${describeFatal(error)}\n`);
    exit(1);
  });

  target.on('unhandledRejection', (reason: unknown) => {
    write(`[cgraphx] Unhandled rejection: ${describeFatal(reason)}\n`);
    exit(1);
  });
}
