/**
 * Hook entry-point runner — shared logic for all 5 hook CLI subcommands.
 *
 * Spec §3.1 / §4.5: ALWAYS exit 0, ALWAYS empty stdout. Failures go to stderr
 * only. This is the "never block Claude" contract.
 */

import { NO_TIMELINE_ENV, PERF_WARN_MS } from './constants';
import { recordEvent, type EventEnricher } from './recorder';
import { readStdinJson, extractHookPayload } from './payload';
import { resolveTimelineProjectRoot } from './project-root';
import type { TimelineEventInput } from './types';

export interface HookRunResult {
  payloadPresent: boolean;
  recorded: boolean;
  durationMs: number;
  error?: string;
}

/** Options bag passed to runHook. */
export interface RunHookOptions {
  /**
   * Optional enricher forwarded to recordEvent. Runs inside recordEvent
   * before insert, with a live store handle so it can query prior events.
   * Any exception is caught by runHook's try/catch — the hook never throws.
   */
  enricher?: EventEnricher;
}

/**
 * Run a hook handler. Reads Claude Code payload from stdin, records a single
 * event, exits 0 regardless of outcome.
 *
 * @param buildEvent  Maps the parsed payload to a TimelineEventInput. Return
 *   `null` to skip recording (e.g. kill-switch, missing payload). May be
 *   async — e.g. postToolUseHook's turn-id lookup may read from disk.
 * @param options     Optional enricher forwarded to recordEvent.
 */
export async function runHook(
  buildEvent: (
    payload: ReturnType<typeof extractHookPayload>,
  ) => Promise<TimelineEventInput | null> | TimelineEventInput | null,
  options?: RunHookOptions,
): Promise<void> {
  const start = Date.now();

  // Kill-switch — never read stdin, never touch DB.
  if (isKillSwitchOn()) {
    return;
  }

  const raw = await readStdinJson();
  if (!raw) {
    // No payload (manual invocation or stdin EOF) — silent exit.
    return;
  }

  const payload = extractHookPayload(raw);
  // 项目根向上回溯(spec 2026-08-13):子目录 cwd 下事件仍写进根库。
  const projectRoot = resolveTimelineProjectRoot(payload.cwd ?? process.cwd());

  const event = await buildEvent(payload);
  if (!event) return;

  try {
    await recordEvent(projectRoot, event, options?.enricher);
  } catch (err) {
    // Log to stderr only — never block Claude. Also catches enricher
    // exceptions — a broken enricher degrades to "post still recorded,
    // duration_ms null" instead of aborting the hook.
    const msg = err instanceof Error ? err.message : String(err);
    process.stderr.write(`[timeline] record failed: ${msg}\n`);
  }

  const durationMs = Date.now() - start;
  if (durationMs > PERF_WARN_MS) {
    process.stderr.write(`[timeline] hook took ${durationMs}ms (>${PERF_WARN_MS} budget)\n`);
  }
}

export function isKillSwitchOn(): boolean {
  const v = process.env[NO_TIMELINE_ENV];
  if (!v) return false;
  const trimmed = v.trim().toLowerCase();
  return trimmed !== '' && trimmed !== '0' && trimmed !== 'false';
}
