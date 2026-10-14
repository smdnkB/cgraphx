/**
 * B-1 (timeline-data-quality) — turn_id generation + cross-hook correlation.
 *
 * Six test cases from the plan:
 *   1. user_prompt → pre → post → stop in ONE turn share the same turn_id
 *   2. A second user_prompt in the same session mints a NEW turn_id; the
 *      following events use the new one (not the stale first)
 *   3. Cross-session isolation: two parallel sessions on the same project
 *      do not bleed turn_id into each other (file's session_id gates reads)
 *   4. If the host payload already carries turn_id, the user_prompt hook
 *      honors it (no overwrite) and downstream hooks read it back
 *   5. readCurrentTurnId tolerates a missing or corrupt file (null, no throw)
 *   6. If the turn-state file can't be written (permission error), the
 *      user_prompt event still records with a non-null turn_id (either the
 *      payload-supplied one or the freshly-minted UUID fallback)
 *
 * All tests use temp dirs (fs.mkdtempSync). The real .cgraphx/ is NEVER
 * touched — we explicitly avoid process.cwd() by passing `cwd: <tmpdir>` in
 * every payload so writeCurrentTurn/readCurrentTurnId resolve to the temp dir.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { Readable } from 'node:stream';

import { DatabaseConnection } from '../../../src/core/db';
import { ensureTimelineSchema } from '../../../src/core/timeline/schema-bootstrap';
import { TimelineStore } from '../../../src/core/timeline/store';
import {
  userPromptHook,
  preToolUseHook,
  postToolUseHook,
  stopHook,
} from '../../../src/core/timeline/hooks';

// ─── Helpers ────────────────────────────────────────────────────────────────

function makeTmpProject(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'cg-turn-'));
}

/** UUID v4 shape regex — validates that randomUUID() output is well-formed. */
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * Drive a hook function with a synthetic stdin payload, mirroring how Claude
 * Code invokes hooks. Returns captured stderr so error-path tests can assert
 * on it. The payload's `cwd` is the temp project dir — this is how
 * readCurrentTurnId/writeCurrentTurn resolve to the temp dir instead of the
 * real repo root.
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

/** Read all rows from the temp DB by opening a fresh connection. */
function readAllRows(dbPath: string) {
  const conn = DatabaseConnection.open(dbPath);
  try {
    return new TimelineStore(conn.getDb()).query({});
  } finally {
    conn.close();
  }
}

/** 读取 <dir>/.cgraphx/turns/<会话>.json(按会话隔离的 turn 状态文件)。 */
function readTurnFile(dir: string, sessionId: string): { turn_id?: string; session_id?: string | null; ts?: string } | null {
  const filePath = path.join(dir, '.cgraphx', 'turns', `${sessionId}.json`);
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return null;
  }
}

// ─── Test suite ─────────────────────────────────────────────────────────────

describe('B-1: turn_id generation + cross-hook correlation', () => {
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

  // ─── Case 1: full turn shares turn_id ─────────────────────────────────────

  it('case 1: user_prompt → pre → post → stop in one turn share the same turn_id', async () => {
    const sessionId = 'sess-case1';

    // 1. user_prompt mints the turn_id and writes the per-turn file.
    await runHookWithPayload(userPromptHook, {
      session_id: sessionId,
      cwd: dir,
      prompt: 'add a turn_id test',
    });

    // Verify the per-turn state file was created with a v4 UUID.
    const turnFile = readTurnFile(dir, sessionId);
    expect(turnFile).not.toBeNull();
    const turn1 = turnFile!.turn_id!;
    expect(turn1).toMatch(UUID_V4);
    expect(turnFile!.session_id).toBe(sessionId);

    // 2-4. Pre / post / stop must all read the same turn_id from the file.
    await runHookWithPayload(preToolUseHook, {
      session_id: sessionId,
      cwd: dir,
      tool_name: 'Edit',
      tool_input: { file_path: 'src/a.ts' },
    });
    await runHookWithPayload(postToolUseHook, {
      session_id: sessionId,
      cwd: dir,
      tool_name: 'Edit',
      tool_input: { file_path: 'src/a.ts' },
      tool_response: {},
    });
    await runHookWithPayload(stopHook, {
      session_id: sessionId,
      cwd: dir,
    });

    const rows = readAllRows(dbPath);
    const turnIds = new Set(rows.map(r => r.turn_id));
    // Every event in this turn must carry the SAME non-null turn_id.
    expect(turnIds.size).toBe(1);
    expect(turnIds.has(turn1)).toBe(true);

    // The user_prompt, pre, post, stop events all carry the turn_id forward.
    const userPrompt = rows.find(r => r.event_type === 'user_prompt');
    const pre = rows.find(r => r.event_type === 'pre_tool_use');
    const post = rows.find(r => r.event_type === 'post_tool_use');
    const stop = rows.find(r => r.event_type === 'stop');
    expect(userPrompt?.turn_id).toBe(turn1);
    expect(pre?.turn_id).toBe(turn1);
    expect(post?.turn_id).toBe(turn1);
    expect(stop?.turn_id).toBe(turn1);
  });

  // ─── Case 2: second user_prompt mints a new turn_id ───────────────────────

  it('case 2: second user_prompt in the same session mints a new turn_id', async () => {
    const sessionId = 'sess-case2';

    await runHookWithPayload(userPromptHook, {
      session_id: sessionId,
      cwd: dir,
      prompt: 'first prompt',
    });
    const turn1 = readTurnFile(dir, sessionId)!.turn_id!;
    expect(turn1).toMatch(UUID_V4);

    // Tiny delay so the ts in the per-turn file differs (not asserted, just
    // avoids same-ms collisions in case the implementation later compares ts).
    await new Promise(r => setTimeout(r, 5));

    await runHookWithPayload(userPromptHook, {
      session_id: sessionId,
      cwd: dir,
      prompt: 'second prompt',
    });
    const turn2 = readTurnFile(dir, sessionId)!.turn_id!;
    expect(turn2).toMatch(UUID_V4);
    expect(turn2).not.toBe(turn1); // minted fresh, not reused

    // A post event AFTER the second prompt must use turn2, not turn1.
    await runHookWithPayload(postToolUseHook, {
      session_id: sessionId,
      cwd: dir,
      tool_name: 'Edit',
      tool_input: { file_path: 'b.ts' },
      tool_response: {},
    });

    const rows = readAllRows(dbPath);
    const posts = rows.filter(r => r.event_type === 'post_tool_use');
    expect(posts).toHaveLength(1);
    expect(posts[0]!.turn_id).toBe(turn2);

    // query order isn't guaranteed by id/ts, so compare as a SET rather than
    // asserting prompts[0]===turn1 / prompts[1]===turn2 positionally.
    const prompts = rows.filter(r => r.event_type === 'user_prompt');
    expect(prompts).toHaveLength(2);
    const promptTurnIds = new Set(prompts.map(r => r.turn_id));
    expect(promptTurnIds).toEqual(new Set([turn1, turn2]));
  });

  // ─── Case 3: cross-session isolation ──────────────────────────────────────

  it('case 3: cross-session isolation — session B does not see session A turn_id', async () => {
    // Session A writes its turn file.
    await runHookWithPayload(userPromptHook, {
      session_id: 'sess-A',
      cwd: dir,
      prompt: 'from session A',
    });
    const turnA = readTurnFile(dir, 'sess-A')!.turn_id!;
    expect(turnA).toMatch(UUID_V4);

    // Session B fires a post_tool_use WITHOUT first writing a user_prompt of
    // its own — so the file still carries session A's turn. readCurrentTurnId
    // must return null because the stored session_id ('sess-A') ≠ the caller's
    // session_id ('sess-B').
    await runHookWithPayload(postToolUseHook, {
      session_id: 'sess-B',
      cwd: dir,
      tool_name: 'Edit',
      tool_input: { file_path: 'x.ts' },
      tool_response: {},
    });

    const rows = readAllRows(dbPath);
    const posts = rows.filter(r => r.event_type === 'post_tool_use');
    expect(posts).toHaveLength(1);
    // turn_id must be NULL — the cross-session gate fired, not turnA.
    expect(posts[0]!.turn_id).toBeNull();
    expect(posts[0]!.turn_id).not.toBe(turnA);
  });

  // ─── Case 4: host-supplied turn_id honored ────────────────────────────────

  it('case 4: payload-supplied turn_id is honored verbatim (not overwritten)', async () => {
    const sessionId = 'sess-case4';
    const hostTurnId = 'host-supplied-turn-1234';

    await runHookWithPayload(userPromptHook, {
      session_id: sessionId,
      cwd: dir,
      prompt: 'host carries turn_id',
      turn_id: hostTurnId, // forward-compat path: a future Claude Code sends this
    });

    // The per-turn file stores the HOST value (no fresh UUID minted).
    expect(readTurnFile(dir, sessionId)!.turn_id).toBe(hostTurnId);

    // Downstream hooks read back the same host-supplied value.
    await runHookWithPayload(postToolUseHook, {
      session_id: sessionId,
      cwd: dir,
      tool_name: 'Edit',
      tool_input: { file_path: 'h.ts' },
      tool_response: {},
    });

    const rows = readAllRows(dbPath);
    const userPrompt = rows.find(r => r.event_type === 'user_prompt');
    const post = rows.find(r => r.event_type === 'post_tool_use');
    expect(userPrompt?.turn_id).toBe(hostTurnId);
    expect(post?.turn_id).toBe(hostTurnId);
  });

  // ─── Case 5: missing / corrupt turn file → null, no throw ─────────────────

  it('case 5a: turn file does not exist → readCurrentTurnId returns null, no throw', async () => {
    // No user_prompt has fired yet — turn file absent.
    // A stray post_tool_use must still record, with turn_id null.
    await runHookWithPayload(postToolUseHook, {
      session_id: 'sess-case5a',
      cwd: dir,
      tool_name: 'Edit',
      tool_input: { file_path: 'y.ts' },
      tool_response: {},
    });

    const rows = readAllRows(dbPath);
    const posts = rows.filter(r => r.event_type === 'post_tool_use');
    expect(posts).toHaveLength(1);
    expect(posts[0]!.turn_id).toBeNull();
  });

  it('case 5b: corrupt turn JSON → readCurrentTurnId returns null, no throw', async () => {
    const sessionId = 'sess-case5b';
    fs.mkdirSync(path.join(dir, '.cgraphx', 'turns'), { recursive: true });
    fs.writeFileSync(
      path.join(dir, '.cgraphx', 'turns', `${sessionId}.json`),
      'this is { not valid json',
      { flag: 'w' },
    );

    const result = await runHookWithPayload(postToolUseHook, {
      session_id: sessionId,
      cwd: dir,
      tool_name: 'Edit',
      tool_input: { file_path: 'z.ts' },
      tool_response: {},
    });

    // No stderr noise — corrupt-file path returns null silently.
    expect(result.stderr).toBe('');

    const rows = readAllRows(dbPath);
    const posts = rows.filter(r => r.event_type === 'post_tool_use');
    expect(posts).toHaveLength(1);
    expect(posts[0]!.turn_id).toBeNull();
  });

  // ─── Case 6: turn file write failure still records the user_prompt ────────

  it('case 6: turn file write fails → user_prompt event still records with a non-null turn_id', async () => {
    const sessionId = 'sess-case6';

    // Force writeCurrentTurn to throw without monkey-patching node:fs (which
    // has non-configurable namespace properties under vitest). We pre-create
    // the turn-state path as a DIRECTORY — writeFileSync with flag:'w' on a
    // directory throws EISDIR, exercising the same try/catch path a real disk
    // fault would. After the test, afterEach's rmSync cleans everything.
    const turnsDir = path.join(dir, '.cgraphx', 'turns');
    fs.mkdirSync(turnsDir, { recursive: true });
    fs.mkdirSync(path.join(turnsDir, `${sessionId}.json`));

    const result = await runHookWithPayload(userPromptHook, {
      session_id: sessionId,
      cwd: dir,
      prompt: 'turn write will fail',
    });

    // stderr carries the failure notice but the hook did not throw.
    expect(result.stderr).toContain('turn-state write failed');

    const rows = readAllRows(dbPath);
    const prompts = rows.filter(r => r.event_type === 'user_prompt');
    expect(prompts).toHaveLength(1);
    // The user_prompt event still carries a fresh UUID v4 even though the
    // file write failed. Downstream hooks will read null (file is a dir /
    // unparseable), but the user_prompt itself is anchored to its own turn id.
    expect(prompts[0]!.turn_id).toMatch(UUID_V4);
  });
});
