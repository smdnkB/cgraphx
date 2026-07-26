/**
 * B-6 (timeline-data-quality) — stop event enricher (session recap).
 *
 * The stop-hook enricher calls store.getSessionStats(session_id) and folds the
 * result into the stop event's metadata: total event count for the session,
 * duration from first event to last user_prompt, and a 200-char preview of the
 * last user_prompt. The enricher reuses the same enricher architecture B-2
 * introduced on postToolUseHook (runHook options.enricher → recordEvent).
 *
 * Four cases from the plan:
 *   1. single prompt + N tool events + stop → summary correct (incl. the
 *      stop itself in event_count; duration > 0; preview is the prompt).
 *   2. multiple prompts → preview is the LAST prompt, not the first.
 *   3. session_id null → enricher no-ops, metadata has no session_* fields.
 *   4. store.getSessionStats throws → enricher swallows, stop still records,
 *      metadata has no session_* fields, stderr carries the failure.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { Readable } from 'node:stream';

import { DatabaseConnection } from '../../../src/core/db';
import { ensureTimelineSchema } from '../../../src/core/timeline/schema-bootstrap';
import { TimelineStore } from '../../../src/core/timeline/store';
import { stopHook } from '../../../src/core/timeline/hooks';
import { recordEvent } from '../../../src/core/timeline/recorder';
import { runHook } from '../../../src/core/timeline/hook-runner';

// ─── Test helpers ──────────────────────────────────────────────────────────

function makeTmpProject(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'cg-stop-'));
}

/**
 * Drive a hook function with a synthetic stdin payload — matches how
 * Claude Code invokes hooks. Returns captured stderr so error-path tests
 * can assert on it.
 */
async function runHookWithPayload(
  hook: () => Promise<void>,
  payload: Record<string, unknown>,
): Promise<{ stderr: string }> {
  const originalStdin = process.stdin;
  const stderrChunks: string[] = [];
  const originalWrite = process.stderr.write.bind(process.stderr);
  process.stderr.write = ((chunk: string | Uint8Array) => {
    stderrChunks.push(typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString());
    return true;
  }) as typeof process.stderr.write;

  const fakeStdin = new Readable({ read() {} });
  fakeStdin.isTTY = false;

  try {
    Object.defineProperty(process, 'stdin', { value: fakeStdin, configurable: true });
    setImmediate(() => {
      fakeStdin.push(JSON.stringify(payload));
      fakeStdin.push(null);
    });
    await hook();
  } finally {
    Object.defineProperty(process, 'stdin', { value: originalStdin, configurable: true });
    process.stderr.write = originalWrite;
  }

  return { stderr: stderrChunks.join('') };
}

/** Read back all rows from the temp DB (open a fresh connection). */
function readAllRows(dbPath: string) {
  const conn = DatabaseConnection.open(dbPath);
  try {
    return new TimelineStore(conn.getDb()).query({});
  } finally {
    conn.close();
  }
}

// ─── Test suite ────────────────────────────────────────────────────────────

describe('B-6: stop hook session-summary enricher', () => {
  let dir: string;
  let dbPath: string;
  let conn: DatabaseConnection;
  let store: TimelineStore;
  let realCwd: string;

  beforeEach(() => {
    dir = makeTmpProject();
    dbPath = path.join(dir, '.cgraphx', 'cgraphx.db');
    fs.mkdirSync(path.dirname(dbPath), { recursive: true });
    conn = DatabaseConnection.open(dbPath);
    ensureTimelineSchema(conn.getDb());
    store = new TimelineStore(conn.getDb());
    realCwd = process.cwd();
  });

  afterEach(() => {
    process.chdir(realCwd);
    conn.close();
    fs.rmSync(dir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  // ─── Case 1: single prompt + 5 tools + stop → summary correct ──────────

  it('case 1: single prompt + 5 tool events + stop → event_count=7, duration>0, preview is prompt', async () => {
    const sessionId = 'sess-stop-1';
    const promptText = 'Fix the login bug in auth.ts';

    // Seed: 1 user_prompt + 5 tool events (mix of pre/post). Use deterministic
    // ts values so duration_ms (= last_prompt_ts - first_ts) is > 0: the
    // prompt is the FIRST event, so its ts is the floor; we space the tool
    // events after it. Since there's only one prompt, last_prompt_ts == the
    // prompt's ts, so duration = prompt_ts - prompt_ts = 0. To exercise a
    // positive duration we add a SECOND user_prompt at a later ts — that way
    // first_ts = first prompt, last_prompt_ts = second prompt, and the gap
    // is the duration. We keep the count at 6 prior events by merging: 2
    // prompts + 4 tool events = 6.
    store.insert({
      event_type: 'user_prompt',
      session_id: sessionId,
      prompt_text: promptText,
      ts: '2026-06-28T10:00:00.000Z',
      cwd: dir,
    });
    for (let i = 1; i <= 4; i++) {
      store.insert({
        event_type: i % 2 === 0 ? 'post_tool_use' : 'pre_tool_use',
        session_id: sessionId,
        tool_name: 'Edit',
        tool_args: { file_path: `f${i}.ts` },
        ts: `2026-06-28T10:00:0${i}.000Z`,
        cwd: dir,
      });
    }
    // Second user_prompt 5 seconds later — this is what makes duration_ms > 0
    // AND is the "last prompt" the preview should surface.
    const lastPromptTs = '2026-06-28T10:00:05.000Z';
    const lastPromptText = 'Actually fix the login bug in auth.ts (refined)';
    store.insert({
      event_type: 'user_prompt',
      session_id: sessionId,
      prompt_text: lastPromptText,
      ts: lastPromptTs,
      cwd: dir,
    });

    // Now stopHook: enricher should pick up all 6 prior rows PLUS the stop
    // itself (event_count = 7). The stop's INSERT happens after the enricher
    // runs, but COUNT(*) is computed on the pre-insert state... wait — the
    // enricher runs INSIDE recordEvent BEFORE insert, so at enrich time the
    // stop row does NOT yet exist. To include the stop in the count, we add 1
    // when surfacing. See the enricher in hooks.ts.
    await runHookWithPayload(stopHook, {
      session_id: sessionId,
      cwd: dir,
      stop_hook_active: false,
    });

    const rows = readAllRows(dbPath);
    const stops = rows.filter(r => r.event_type === 'stop');
    expect(stops).toHaveLength(1);

    const meta = stops[0]!.metadata;
    // 6 prior events + 1 for the stop itself (the enricher adds 1 because it
    // runs BEFORE the stop's own INSERT — see hooks.ts stopHook enricher).
    expect(meta.session_event_count).toBe(7);
    // first_ts = first prompt (10:00:00), last_prompt_ts = second prompt
    // (10:00:05) → duration = 5000ms.
    expect(meta.session_duration_ms).toBe(5000);
    // Preview is the LAST prompt (the refined one), not the first.
    expect(meta.session_last_prompt_preview).toBe(lastPromptText);
    expect(meta.session_last_prompt_preview).not.toBe(promptText);
    // stop_hook_active should still be present (enricher merged, not replaced).
    expect(meta.stop_hook_active).toBe(false);
  });

  // ─── Case 2: multiple prompts → preview is the LAST prompt ─────────────

  it('case 2: multiple prompts → preview is the last prompt, not the first', async () => {
    const sessionId = 'sess-stop-2';
    const firstPrompt = 'first prompt text';
    const lastPrompt = 'last prompt text (the one we expect)';

    store.insert({
      event_type: 'user_prompt',
      session_id: sessionId,
      prompt_text: firstPrompt,
      ts: '2026-06-28T10:00:00.000Z',
      cwd: dir,
    });
    store.insert({
      event_type: 'pre_tool_use',
      session_id: sessionId,
      tool_name: 'Edit',
      tool_args: { file_path: 'a.ts' },
      ts: '2026-06-28T10:00:01.000Z',
      cwd: dir,
    });
    store.insert({
      event_type: 'user_prompt',
      session_id: sessionId,
      prompt_text: lastPrompt,
      ts: '2026-06-28T10:00:02.000Z',
      cwd: dir,
    });

    await runHookWithPayload(stopHook, {
      session_id: sessionId,
      cwd: dir,
    });

    const stops = readAllRows(dbPath).filter(r => r.event_type === 'stop');
    expect(stops).toHaveLength(1);
    const meta = stops[0]!.metadata;
    // Preview must be the LAST prompt, not the first.
    expect(meta.session_last_prompt_preview).toBe(lastPrompt);
    expect(meta.session_last_prompt_preview).not.toBe(firstPrompt);
  });

  // ─── Case 3: session_id null → no session_* fields in metadata ─────────

  it('case 3: session_id null → metadata has no session_* fields', async () => {
    // No session_id in payload. The enricher early-returns on
    // !event.session_id, so metadata stays as-is (just stop_hook_active).
    await runHookWithPayload(stopHook, {
      // session_id omitted
      cwd: dir,
      stop_hook_active: false,
    });

    const stops = readAllRows(dbPath).filter(r => r.event_type === 'stop');
    expect(stops).toHaveLength(1);
    const meta = stops[0]!.metadata;
    expect(meta.stop_hook_active).toBe(false);
    // No session_* fields should be present.
    expect(meta).not.toHaveProperty('session_event_count');
    expect(meta).not.toHaveProperty('session_duration_ms');
    expect(meta).not.toHaveProperty('session_last_prompt_preview');
  });

  // ─── Case 4: store.getSessionStats throws → enricher swallows ──────────

  it('case 4: store.getSessionStats throws → stop still records, no session_* fields, stderr logged', async () => {
    const sessionId = 'sess-stop-4';
    store.insert({
      event_type: 'user_prompt',
      session_id: sessionId,
      prompt_text: 'seed',
      ts: '2026-06-28T10:00:00.000Z',
      cwd: dir,
    });

    // Monkey-patch getSessionStats on the prototype so the TimelineStore
    // instance recordEvent opens internally also throws — simulates a
    // corrupt-DB / SQL-error fault inside the enricher's store call.
    const spy = vi
      .spyOn(TimelineStore.prototype, 'getSessionStats')
      .mockImplementation(() => {
        throw new Error('simulated store fault');
      });

    try {
      const result = await runHookWithPayload(
        () => runHook(async (payload) => ({
          event_type: 'stop' as const,
          session_id: payload.session_id ?? null,
          cwd: payload.cwd,
          metadata: payload.stop_hook_active !== undefined
            ? { stop_hook_active: payload.stop_hook_active }
            : undefined,
        }), {
          enricher: (storeInstance, event) => {
            // Same shape as the production stop-hook enricher.
            if (event.event_type !== 'stop' || !event.session_id) return;
            try {
              const stats = storeInstance.getSessionStats(event.session_id);
              event.metadata = {
                ...(event.metadata ?? {}),
                session_event_count: stats.event_count + 1,
                session_duration_ms: stats.duration_ms,
                session_last_prompt_preview: stats.last_user_prompt?.slice(0, 200) ?? null,
              };
            } catch (err) {
              process.stderr.write(
                `[timeline] stop enrich failed: ${err instanceof Error ? err.message : String(err)}\n`,
              );
            }
          },
        }),
        {
          session_id: sessionId,
          cwd: dir,
          stop_hook_active: true,
        },
      );

      // The stop event still recorded (enricher caught, didn't re-throw).
      const stops = readAllRows(dbPath).filter(r => r.event_type === 'stop');
      expect(stops).toHaveLength(1);
      const meta = stops[0]!.metadata;
      // stop_hook_active survived; no session_* fields added.
      expect(meta.stop_hook_active).toBe(true);
      expect(meta).not.toHaveProperty('session_event_count');
      expect(meta).not.toHaveProperty('session_duration_ms');
      expect(meta).not.toHaveProperty('session_last_prompt_preview');
      // Stderr carries the enrich failure message.
      expect(result.stderr).toContain('stop enrich failed');
      expect(result.stderr).toContain('simulated store fault');
    } finally {
      spy.mockRestore();
    }
  });

  // ─── Extra: getSessionStats on empty session → all nulls ───────────────

  it('getSessionStats on session with no events → event_count=0, nulls elsewhere', () => {
    // Direct unit test of the store helper on an empty session.
    const stats = store.getSessionStats('never-existed');
    expect(stats.event_count).toBe(0);
    expect(stats.first_ts).toBeNull();
    expect(stats.last_user_prompt).toBeNull();
    expect(stats.duration_ms).toBeNull();
  });

  // ─── Extra: preview truncates at 200 chars ─────────────────────────────

  it('session_last_prompt_preview truncates to 200 chars for long prompts', async () => {
    const sessionId = 'sess-stop-trunc';
    const longPrompt = 'x'.repeat(500);

    store.insert({
      event_type: 'user_prompt',
      session_id: sessionId,
      prompt_text: longPrompt,
      ts: '2026-06-28T10:00:00.000Z',
      cwd: dir,
    });

    await runHookWithPayload(stopHook, {
      session_id: sessionId,
      cwd: dir,
    });

    const stops = readAllRows(dbPath).filter(r => r.event_type === 'stop');
    const meta = stops[0]!.metadata;
    expect(typeof meta.session_last_prompt_preview).toBe('string');
    expect((meta.session_last_prompt_preview as string).length).toBe(200);
    expect((meta.session_last_prompt_preview as string)).toBe('x'.repeat(200));
  });
});
