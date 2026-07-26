/**
 * B-2 (timeline-data-quality) — pre_tool_use whitelist + duration_ms enricher.
 *
 * Six behavior cases from the plan + an enricher-fault path + a perf assertion.
 *
 * Two test surfaces:
 *   A) Hook-driven (Cases 1, 4) — pipe JSON into the actual hook functions,
 *      verify whitelist drops at pre and that post events still record.
 *   B) Enricher-driven (Cases 2, 3, 5, 6, 7, 8) — call recordEvent / runHook
 *      directly with the enricher the production post-hook uses.
 *
 * Why split: readCurrentTurnId is a B-1 placeholder returning null, so the
 * production post-hook path can't compute duration_ms yet (turn_id === null
 * short-circuits the enricher). To exercise the duration_ms logic before B-1
 * lands, we drive recordEvent directly with explicit turn_id / ts values.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { Readable } from 'node:stream';

import { DatabaseConnection } from '../../../src/core/db';
import { ensureTimelineSchema } from '../../../src/core/timeline/schema-bootstrap';
import { TimelineStore } from '../../../src/core/timeline/store';
import { postToolUseHook, preToolUseHook } from '../../../src/core/timeline/hooks';
import { recordEvent, type EventEnricher } from '../../../src/core/timeline/recorder';
import { runHook } from '../../../src/core/timeline/hook-runner';
import { WRITE_TOOLS_WHITELIST } from '../../../src/core/timeline/constants';

// ─── Test helpers ──────────────────────────────────────────────────────────

function makeTmpProject(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'cg-dur-'));
}

/**
 * The duration_ms enricher the production postToolUseHook uses (B-2).
 * Factored out so tests can drive recordEvent with the same logic, with
 * deterministic ts / turn_id values.
 */
const durationEnricher: EventEnricher = (store, event) => {
  const toolName = event.tool_name;
  if (!toolName) return;
  if (!WRITE_TOOLS_WHITELIST.has(toolName)) return;
  if (!event.turn_id) return;
  const recentPre = store.getMostRecentPre({
    turn_id: event.turn_id,
    tool_name: toolName,
    session_id: event.session_id ?? null,
  });
  if (!recentPre) return;
  const postTs = new Date(event.ts ?? new Date().toISOString()).getTime();
  const preTs = new Date(recentPre.ts).getTime();
  event.duration_ms = Math.max(0, postTs - preTs);
};

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

describe('B-2: pre_tool_use whitelist + duration_ms enricher', () => {
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

  // ─── Case 1: Read tool — only post recorded (pre dropped) ───────────────

  it('case 1: Read tool records only post_tool_use (pre dropped by whitelist)', async () => {
    const sessionId = 'sess-1';

    // Pre event for a read-only tool is dropped at the whitelist gate.
    const preResult = await runHookWithPayload(preToolUseHook, {
      session_id: sessionId,
      cwd: dir,
      tool_name: 'Read',
      tool_input: { file_path: 'src/foo.ts' },
    });
    expect(preResult.stderr).toBe(''); // no error

    await runHookWithPayload(postToolUseHook, {
      session_id: sessionId,
      cwd: dir,
      tool_name: 'Read',
      tool_input: { file_path: 'src/foo.ts' },
      tool_response: { file_path: 'src/foo.ts', content: 'x' },
    });

    const rows = readAllRows(dbPath);
    expect(rows.filter(r => r.event_type === 'pre_tool_use')).toHaveLength(0);
    const posts = rows.filter(r => r.event_type === 'post_tool_use');
    expect(posts).toHaveLength(1);
    // Read has no pre to diff against → duration_ms null.
    expect(posts[0]!.duration_ms).toBeNull();
  });

  // ─── Case 2: Edit tool — pre + post, duration_ms computed ───────────────

  it('case 2: Edit tool records pre + post, post carries duration_ms >= 0', async () => {
    const sessionId = 'sess-2';
    const turnId = 'turn-edit-1';
    const preTs = '2026-06-28T10:00:00.000Z';
    const postTs = '2026-06-28T10:00:00.500Z'; // +500ms

    store.insert({
      event_type: 'pre_tool_use',
      session_id: sessionId,
      tool_name: 'Edit',
      tool_args: { file_path: 'src/a.ts' },
      turn_id: turnId,
      ts: preTs,
      cwd: dir,
    });

    await recordEvent(dir, {
      event_type: 'post_tool_use',
      session_id: sessionId,
      tool_name: 'Edit',
      tool_args: { file_path: 'src/a.ts' },
      tool_result_summary: '{}',
      turn_id: turnId,
      ts: postTs,
      cwd: dir,
    }, durationEnricher);

    const posts = readAllRows(dbPath).filter(r => r.event_type === 'post_tool_use');
    expect(posts).toHaveLength(1);
    expect(posts[0]!.duration_ms).toBe(500);
  });

  // ─── Case 3: Bash tool — same path as Edit (whitelisted) ────────────────

  it('case 3: Bash tool records pre + post, duration_ms computed', async () => {
    const sessionId = 'sess-3';
    const turnId = 'turn-bash-1';
    const preTs = '2026-06-28T11:00:00.000Z';
    const postTs = '2026-06-28T11:00:00.050Z'; // +50ms

    store.insert({
      event_type: 'pre_tool_use',
      session_id: sessionId,
      tool_name: 'Bash',
      tool_args: { command: 'npm test' },
      turn_id: turnId,
      ts: preTs,
      cwd: dir,
    });

    await recordEvent(dir, {
      event_type: 'post_tool_use',
      session_id: sessionId,
      tool_name: 'Bash',
      tool_args: { command: 'npm test' },
      tool_result_summary: '{}',
      turn_id: turnId,
      ts: postTs,
      cwd: dir,
    }, durationEnricher);

    const posts = readAllRows(dbPath).filter(r => r.event_type === 'post_tool_use');
    expect(posts).toHaveLength(1);
    expect(posts[0]!.duration_ms).toBe(50);
  });

  // ─── Case 4: TaskUpdate — post only, no pre, duration_ms null ───────────

  it('case 4: TaskUpdate records only post_tool_use (not in whitelist)', async () => {
    const sessionId = 'sess-4';

    await runHookWithPayload(preToolUseHook, {
      session_id: sessionId,
      cwd: dir,
      tool_name: 'TaskUpdate',
      tool_input: { taskId: '5', status: 'in_progress' },
    });
    await runHookWithPayload(postToolUseHook, {
      session_id: sessionId,
      cwd: dir,
      tool_name: 'TaskUpdate',
      tool_input: { taskId: '5', status: 'in_progress' },
      tool_response: {},
    });

    const rows = readAllRows(dbPath);
    expect(rows.filter(r => r.event_type === 'pre_tool_use')).toHaveLength(0);
    const posts = rows.filter(r => r.event_type === 'post_tool_use');
    expect(posts).toHaveLength(1);
    // TaskUpdate isn't whitelisted → enricher is a no-op → duration_ms null.
    expect(posts[0]!.duration_ms).toBeNull();
  });

  // ─── Case 5: Same-turn consecutive Edits — 2nd uses its OWN pre ────────

  it('case 5: consecutive Edits in same turn — post uses most-recent pre', async () => {
    const sessionId = 'sess-5';
    const turnId = 'turn-edit-multi';
    const pre1Ts = '2026-06-28T12:00:00.000Z';
    const pre2Ts = '2026-06-28T12:00:01.000Z'; // 1s later
    const post2Ts = '2026-06-28T12:00:01.500Z'; // +500ms after pre2

    store.insert({
      event_type: 'pre_tool_use',
      session_id: sessionId,
      tool_name: 'Edit',
      tool_args: { file_path: 'a.ts' },
      turn_id: turnId,
      ts: pre1Ts,
      cwd: dir,
    });
    store.insert({
      event_type: 'pre_tool_use',
      session_id: sessionId,
      tool_name: 'Edit',
      tool_args: { file_path: 'b.ts' },
      turn_id: turnId,
      ts: pre2Ts,
      cwd: dir,
    });

    // Both pres exist when post2 fires. ORDER BY ts DESC LIMIT 1 must pick
    // pre2 (the newer one), so duration_ms = post2Ts - pre2Ts = 500ms.
    // A regression that picked pre1 would give 1500ms instead.
    await recordEvent(dir, {
      event_type: 'post_tool_use',
      session_id: sessionId,
      tool_name: 'Edit',
      tool_args: { file_path: 'b.ts' },
      tool_result_summary: '{}',
      turn_id: turnId,
      ts: post2Ts,
      cwd: dir,
    }, durationEnricher);

    const posts = readAllRows(dbPath).filter(r => r.event_type === 'post_tool_use');
    expect(posts).toHaveLength(1);
    expect(posts[0]!.duration_ms).toBe(500);
  });

  // ─── Case 6: Orphan post (no matching pre) — duration_ms null ───────────

  it('case 6: post with no matching pre (e.g. restart) → duration_ms = null, no throw', async () => {
    const sessionId = 'sess-6';
    const turnId = 'turn-orphan';

    // No pre inserted. Enricher should gracefully no-op (getMostRecentPre
    // returns null → return early → duration_ms stays undefined → store
    // writes NULL).
    await expect(recordEvent(dir, {
      event_type: 'post_tool_use',
      session_id: sessionId,
      tool_name: 'Edit',
      tool_args: { file_path: 'x.ts' },
      tool_result_summary: '{}',
      turn_id: turnId,
      cwd: dir,
    }, durationEnricher)).resolves.toBeGreaterThan(0);

    const posts = readAllRows(dbPath).filter(r => r.event_type === 'post_tool_use');
    expect(posts).toHaveLength(1);
    expect(posts[0]!.duration_ms).toBeNull();
  });

  // ─── Case 7: Enricher throws → runHook catches, no crash ────────────────

  it('case 7: enricher throws inside runHook → caught, post lost but hook exits cleanly', async () => {
    const boomEnricher: EventEnricher = () => {
      throw new Error('simulated store fault');
    };

    // runHook wraps recordEvent in try/catch; a throwing enricher propagates
    // out of recordEvent and is caught — the hook exits 0 (we just verify
    // it resolves without rejecting), and stderr carries the failure.
    // Note: this tests the runHook-level safety net for an arbitrary
    // caller-supplied enricher. The production postToolUseHook enricher
    // has its own inner try/catch (see case 9) so its lookup failures
    // don't lose the post event.
    const result = await runHookWithPayload(
      () => runHook(async (payload) => ({
        event_type: 'post_tool_use',
        session_id: payload.session_id ?? null,
        tool_name: 'Edit',
        tool_args: { file_path: 'x.ts' },
        tool_result_summary: '{}',
        turn_id: 'turn-boom',
        cwd: payload.cwd,
      }), { enricher: boomEnricher }),
      {
        session_id: 'sess-7',
        cwd: dir,
        tool_name: 'Edit',
        tool_input: { file_path: 'x.ts' },
        tool_response: {},
      },
    );

    // The hook must not have thrown — stderr carries the record-failed msg.
    expect(result.stderr).toContain('record failed');
    expect(result.stderr).toContain('simulated store fault');

    // No row recorded (the throw aborted before insert). This is the
    // runHook-level safety net behavior — caller-supplied enrichers that
    // throw bypass insert. The production postToolUseHook's inner try/catch
    // (case 9) prevents this from happening on real lookup failures.
    expect(readAllRows(dbPath)).toHaveLength(0);
  });

  // ─── Case 9: Real postToolUseHook enricher + getMostRecentPre throws ────
  // Validates the plan §B-2 completion condition 4: "duration_ms 计算失败时
  // → post 事件仍记录,duration_ms 为 null,stderr 有错误信息". The production
  // enricher's inner try/catch (added by C-1 fix) is what makes this work —
  // a faulty store lookup degrades gracefully without losing the event.

  it('case 9: postToolUseHook enricher — getMostRecentPre throws → post still records, duration_ms null, stderr logged', async () => {
    const sessionId = 'sess-9';
    const turnId = 'turn-9';

    // Seed a pre so the enricher actually reaches the throwing getMostRecentPre
    // call (enricher short-circuits to no-op when no pre exists).
    store.insert({
      event_type: 'pre_tool_use',
      session_id: sessionId,
      tool_name: 'Edit',
      tool_args: { file_path: 'x.ts' },
      turn_id: turnId,
      cwd: dir,
    });

    // Make getMostRecentPre throw — simulates DB fault during the post-hook
    // enrichment lookup.
    const spy = vi.spyOn(TimelineStore.prototype, 'getMostRecentPre').mockImplementation(() => {
      throw new Error('simulated DB fault in getMostRecentPre');
    });

    // We also need the post-hook to find a turn_id — without B-1's file-based
    // turn-state, postToolUseHook reads null and short-circuits the enricher
    // before reaching getMostRecentPre. Write the turn file manually so the
    // enricher path is exercised.
    fs.mkdirSync(path.join(dir, '.cgraphx'), { recursive: true });
    fs.writeFileSync(
      path.join(dir, '.cgraphx', 'timeline-current-turn.json'),
      JSON.stringify({ turn_id: turnId, session_id: sessionId, ts: new Date().toISOString() }),
    );

    process.chdir(dir);
    try {
      const result = await runHookWithPayload(postToolUseHook, {
        session_id: sessionId,
        cwd: dir,
        tool_name: 'Edit',
        tool_input: { file_path: 'x.ts' },
        tool_response: { file_path: 'x.ts' },
      });

      // stderr carries the enricher-failed message (inner try/catch).
      expect(result.stderr).toContain('duration enrich failed');
      expect(result.stderr).toContain('simulated DB fault in getMostRecentPre');

      // Critical contract: the post event STILL recorded (inner try/catch
      // prevented the throw from skipping insert). duration_ms is null
      // because the enricher failed before computing it.
      const rows = readAllRows(dbPath);
      const posts = rows.filter(r => r.event_type === 'post_tool_use');
      expect(posts).toHaveLength(1);
      expect(posts[0]!.duration_ms).toBeNull();
    } finally {
      spy.mockRestore();
    }
  });

  // ─── Case 8: Performance — 100 sequential post-hooks avg < 30ms ─────────

  it('case 8: 100 sequential Edit post-hooks average < 30ms each', async () => {
    const sessionId = 'sess-perf';
    const turnId = 'turn-perf';

    store.insert({
      event_type: 'pre_tool_use',
      session_id: sessionId,
      tool_name: 'Edit',
      tool_args: { file_path: 'p.ts' },
      turn_id: turnId,
      cwd: dir,
    });

    const N = 100;
    const start = Date.now();
    for (let i = 0; i < N; i++) {
      await recordEvent(dir, {
        event_type: 'post_tool_use',
        session_id: sessionId,
        tool_name: 'Edit',
        tool_args: { file_path: `p${i}.ts` },
        tool_result_summary: '{}',
        turn_id: turnId,
        cwd: dir,
      }, durationEnricher);
    }
    const totalMs = Date.now() - start;
    const avgMs = totalMs / N;

    // Spec budget: <30ms per hook, leaving 20ms buffer inside the 50ms total.
    // node:sqlite opens+closes per call here (matches hook lifecycle), so
    // this is a strict upper bound on the post-tool path.
    process.stderr.write(`[perf] avg post-hook duration over ${N} runs: ${avgMs.toFixed(2)}ms\n`);
    expect(avgMs).toBeLessThan(30);
  });
});
