/**
 * Tests for TimelineStore — spec §9.1 #9 #10 (schema + insert/query cycle).
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';

import { DatabaseConnection } from '../../../src/core/db';
import { ensureTimelineSchema } from '../../../src/core/timeline/schema-bootstrap';
import { TimelineStore, resolveTimeBound } from '../../../src/core/timeline/store';
import { ARGS_MAX_BYTES, TRUNCATED_SUFFIX } from '../../../src/core/timeline/constants';

function makeTmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'cg-tl-'));
}

describe('TimelineStore.insert + query', () => {
  let dir: string;
  let dbPath: string;
  let conn: DatabaseConnection;
  let store: TimelineStore;

  beforeEach(() => {
    dir = makeTmpDir();
    dbPath = path.join(dir, 'timeline.db');
    conn = DatabaseConnection.open(dbPath);
    ensureTimelineSchema(conn.getDb());
    store = new TimelineStore(conn.getDb());
  });

  afterEach(() => {
    conn.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('inserts a user_prompt event and reads it back', () => {
    const id = store.insert({
      event_type: 'user_prompt',
      prompt_text: 'how do I add a feature',
      session_id: 's1',
      cwd: '/proj',
    });
    expect(id).toBeGreaterThan(0);

    const events = store.query({});
    expect(events).toHaveLength(1);
    expect(events[0]!.event_type).toBe('user_prompt');
    expect(events[0]!.prompt_text).toBe('how do I add a feature');
    expect(events[0]!.session_id).toBe('s1');
  });

  it('inserts pre_tool_use with full tool_args', () => {
    store.insert({
      event_type: 'pre_tool_use',
      tool_name: 'Edit',
      tool_args: { file_path: 'src/main.ts', old_string: 'a', new_string: 'b' },
    });
    const events = store.query({ type: 'pre_tool_use' });
    expect(events[0]!.tool_args).toEqual({
      file_path: 'src/main.ts',
      old_string: 'a',
      new_string: 'b',
    });
  });

  it('inserts git_commit with files array', () => {
    store.insert({
      event_type: 'git_commit',
      commit_hash: 'abc123',
      commit_message: 'fix bug',
      commit_files: ['src/a.ts', 'src/b.ts'],
    });
    const events = store.query({ type: 'git_commit' });
    expect(events[0]!.commit_files).toEqual(['src/a.ts', 'src/b.ts']);
  });

  it('stores oversized tool_args without truncation (MVP: no field-size cap on JSON args)', () => {
    // Spec §2.3 originally capped tool_args at 64KB, but truncating mid-JSON
    // corrupts it past JSON.parse. MVP stores full payload.
    const hugeArg = 'x'.repeat(ARGS_MAX_BYTES + 1000);
    store.insert({
      event_type: 'pre_tool_use',
      tool_name: 'Bash',
      tool_args: { command: hugeArg },
    });
    const events = store.query({});
    const args = events[0]!.tool_args as { command: string };
    expect(args.command).toBe(hugeArg);
    expect(args.command.length).toBeGreaterThan(ARGS_MAX_BYTES);
  });

  it('handles unserializable (cyclic) tool_args without crash', () => {
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    store.insert({
      event_type: 'pre_tool_use',
      tool_name: 'X',
      tool_args: cyclic,
    });
    const events = store.query({});
    expect(events[0]!.tool_args).toEqual({ _error: 'unserializable payload' });
  });

  it('filters by time window (since/until)', () => {
    store.insert({ event_type: 'stop', ts: '2026-06-01T00:00:00.000Z' });
    store.insert({ event_type: 'stop', ts: '2026-06-15T00:00:00.000Z' });
    store.insert({ event_type: 'stop', ts: '2026-06-25T00:00:00.000Z' });

    const mid = store.query({ since: '2026-06-10', until: '2026-06-20' });
    expect(mid).toHaveLength(1);
    expect(mid[0]!.ts).toBe('2026-06-15T00:00:00.000Z');
  });

  it('filters by file substring (tool_args file_path OR commit_files)', () => {
    store.insert({
      event_type: 'pre_tool_use',
      tool_name: 'Edit',
      tool_args: { file_path: 'src/auth/login.ts' },
    });
    store.insert({
      event_type: 'git_commit',
      commit_files: ['src/auth/session.ts'],
    });
    store.insert({
      event_type: 'pre_tool_use',
      tool_name: 'Edit',
      tool_args: { file_path: 'src/utils/math.ts' },
    });

    const authEvents = store.query({ file: 'auth/' });
    expect(authEvents).toHaveLength(2);
  });

  it('filters by tool_name and session_id', () => {
    store.insert({ event_type: 'pre_tool_use', tool_name: 'Edit', session_id: 'A' });
    store.insert({ event_type: 'pre_tool_use', tool_name: 'Bash', session_id: 'A' });
    store.insert({ event_type: 'pre_tool_use', tool_name: 'Edit', session_id: 'B' });

    expect(store.query({ tool: 'Edit' })).toHaveLength(2);
    expect(store.query({ session: 'A' })).toHaveLength(2);
    expect(store.query({ tool: 'Edit', session: 'A' })).toHaveLength(1);
  });

  it('honors --limit (default 100)', () => {
    for (let i = 0; i < 5; i++) {
      store.insert({ event_type: 'stop' });
    }
    expect(store.query({ limit: 3 })).toHaveLength(3);
    expect(store.query({})).toHaveLength(5);
  });

  it('clamps limit to MAX_QUERY_LIMIT', () => {
    for (let i = 0; i < 5; i++) {
      store.insert({ event_type: 'stop' });
    }
    expect(store.query({ limit: 100_000 })).toHaveLength(5);
  });

  it('getById returns null for unknown id', () => {
    expect(store.getById(99999)).toBeNull();
  });

  it('round-trips turn_id / commit_insertions / commit_deletions (S-1)', () => {
    const id = store.insert({
      event_type: 'git_commit',
      commit_hash: 'deadbeef',
      commit_message: 'feat: add turn tracking',
      commit_files: ['src/a.ts'],
      turn_id: 'turn-42',
      commit_insertions: 137,
      commit_deletions: 9,
    });
    expect(id).toBeGreaterThan(0);

    const all = store.query({});
    expect(all).toHaveLength(1);
    const ev = all[0]!;
    expect(ev.turn_id).toBe('turn-42');
    expect(ev.commit_insertions).toBe(137);
    expect(ev.commit_deletions).toBe(9);

    // null round-trip: events without these fields must read back as null.
    store.insert({ event_type: 'user_prompt', prompt_text: 'hello' });
    const prompts = store.query({ type: 'user_prompt' });
    expect(prompts[0]!.turn_id).toBeNull();
    expect(prompts[0]!.commit_insertions).toBeNull();
    expect(prompts[0]!.commit_deletions).toBeNull();
  });

  it('filters by turn_id (exact match)', () => {
    store.insert({ event_type: 'user_prompt', turn_id: 't-A' });
    store.insert({ event_type: 'pre_tool_use', tool_name: 'Edit', turn_id: 't-A' });
    store.insert({ event_type: 'user_prompt', turn_id: 't-B' });

    expect(store.query({ turn: 't-A' })).toHaveLength(2);
    expect(store.query({ turn: 't-B' })).toHaveLength(1);
    expect(store.query({ turn: 't-C' })).toHaveLength(0);
  });

  it('stats aggregates by type / tool / day', () => {
    store.insert({ event_type: 'user_prompt', ts: '2026-06-01T10:00:00.000Z' });
    store.insert({ event_type: 'user_prompt', ts: '2026-06-01T11:00:00.000Z' });
    store.insert({
      event_type: 'pre_tool_use',
      tool_name: 'Edit',
      tool_args: { file_path: 'src/main.ts' },
      ts: '2026-06-02T10:00:00.000Z',
    });
    store.insert({
      event_type: 'git_commit',
      commit_files: ['src/main.ts', 'src/util.ts'],
      ts: '2026-06-02T11:00:00.000Z',
    });

    const stats = store.stats({});
    expect(stats.totalEvents).toBe(4);
    expect(stats.byType.user_prompt).toBe(2);
    expect(stats.byType.pre_tool_use).toBe(1);
    expect(stats.byType.git_commit).toBe(1);
    expect(stats.byTool.find(t => t.tool === 'Edit')?.count).toBe(1);
    expect(stats.byDay.find(d => d.day === '2026-06-01')?.count).toBe(2);
  });

  // ─── B-5: topFilesRead / topFilesWritten split ─────────────────────────────

  it('topFilesRead: pure Read events populate read list, written list stays empty', () => {
    store.insert({
      event_type: 'pre_tool_use',
      tool_name: 'Read',
      tool_args: { file_path: 'src/a.ts' },
    });
    store.insert({
      event_type: 'post_tool_use',
      tool_name: 'Read',
      tool_args: { file_path: 'src/a.ts' },
    });
    store.insert({
      event_type: 'pre_tool_use',
      tool_name: 'Read',
      tool_args: { file_path: 'src/b.ts' },
    });

    const stats = store.stats({});
    expect(stats.topFilesRead).toContainEqual({ file: 'src/a.ts', count: 2 });
    expect(stats.topFilesRead).toContainEqual({ file: 'src/b.ts', count: 1 });
    expect(stats.topFilesWritten).toEqual([]);
  });

  it('topFilesWritten: pure Edit events populate written list, read list stays empty', () => {
    store.insert({
      event_type: 'pre_tool_use',
      tool_name: 'Edit',
      tool_args: { file_path: 'src/a.ts', old_string: 'x', new_string: 'y' },
    });
    store.insert({
      event_type: 'post_tool_use',
      tool_name: 'Write',
      tool_args: { file_path: 'src/b.ts', content: '...' },
    });

    const stats = store.stats({});
    expect(stats.topFilesWritten).toContainEqual({ file: 'src/a.ts', count: 1 });
    expect(stats.topFilesWritten).toContainEqual({ file: 'src/b.ts', count: 1 });
    expect(stats.topFilesRead).toEqual([]);
  });

  it('topFiles split: mixed Read + Edit + git_commit classifies per file', () => {
    // 5x Read fileA.ts
    for (let i = 0; i < 5; i++) {
      store.insert({
        event_type: 'pre_tool_use',
        tool_name: 'Read',
        tool_args: { file_path: 'fileA.ts' },
      });
    }
    // 2x Edit fileA.ts
    for (let i = 0; i < 2; i++) {
      store.insert({
        event_type: 'pre_tool_use',
        tool_name: 'Edit',
        tool_args: { file_path: 'fileA.ts', old_string: 'a', new_string: 'b' },
      });
    }
    // 3x Read fileB.ts
    for (let i = 0; i < 3; i++) {
      store.insert({
        event_type: 'pre_tool_use',
        tool_name: 'Read',
        tool_args: { file_path: 'fileB.ts' },
      });
    }
    // 1x git_commit with fileC.ts
    store.insert({
      event_type: 'git_commit',
      commit_files: ['fileC.ts'],
    });

    const stats = store.stats({});
    expect(stats.topFilesRead).toEqual([
      { file: 'fileA.ts', count: 5 },
      { file: 'fileB.ts', count: 3 },
    ]);
    expect(stats.topFilesWritten).toEqual([
      { file: 'fileA.ts', count: 2 },
      { file: 'fileC.ts', count: 1 },
    ]);
  });

  it('topFilesRead: Grep is in READ_FILE_TOOLS but contributes no file (path is a dir, not a file)', () => {
    store.insert({
      event_type: 'pre_tool_use',
      tool_name: 'Grep',
      tool_args: { pattern: 'foo', path: 'src/', output_mode: 'content' },
    });
    store.insert({
      event_type: 'post_tool_use',
      tool_name: 'Grep',
      tool_args: { pattern: 'bar', path: 'src/sub' },
    });

    const stats = store.stats({});
    expect(stats.topFilesRead).toEqual([]);
    expect(stats.topFilesWritten).toEqual([]);
  });

  it('topFilesRead: Glob is in READ_FILE_TOOLS but contributes no file (pattern is a glob)', () => {
    store.insert({
      event_type: 'pre_tool_use',
      tool_name: 'Glob',
      tool_args: { pattern: 'src/**/*.ts' },
    });

    const stats = store.stats({});
    expect(stats.topFilesRead).toEqual([]);
    expect(stats.topFilesWritten).toEqual([]);
  });

  it('topFilesRead: repeated reads of the same file accumulate the count', () => {
    store.insert({
      event_type: 'pre_tool_use',
      tool_name: 'Read',
      tool_args: { file_path: 'repeat.ts' },
    });
    store.insert({
      event_type: 'pre_tool_use',
      tool_name: 'Read',
      tool_args: { file_path: 'repeat.ts' },
    });
    store.insert({
      event_type: 'post_tool_use',
      tool_name: 'Read',
      tool_args: { file_path: 'repeat.ts' },
    });

    const stats = store.stats({});
    expect(stats.topFilesRead).toEqual([{ file: 'repeat.ts', count: 3 }]);
  });

  it('topFilesWritten: Edit counts only file_path, ignores old_string/new_string', () => {
    store.insert({
      event_type: 'pre_tool_use',
      tool_name: 'Edit',
      tool_args: {
        file_path: 'src/target.ts',
        old_string: 'long body of code',
        new_string: 'longer body of code',
      },
    });

    const stats = store.stats({});
    expect(stats.topFilesWritten).toEqual([{ file: 'src/target.ts', count: 1 }]);
  });

  it('topFilesWritten: MultiEdit counts top-level file_path once', () => {
    store.insert({
      event_type: 'pre_tool_use',
      tool_name: 'MultiEdit',
      tool_args: {
        file_path: 'src/multi.ts',
        edits: [
          { old_string: 'a', new_string: 'b' },
          { old_string: 'c', new_string: 'd' },
        ],
      },
    });

    const stats = store.stats({});
    expect(stats.topFilesWritten).toEqual([{ file: 'src/multi.ts', count: 1 }]);
  });
});

describe('resolveTimeBound', () => {
  it('returns ISO for ISO input', () => {
    expect(resolveTimeBound('2026-06-01')).toMatch(/^2026-06-01T.*Z$/);
  });

  it('returns ISO for relative Nd / Nh / Nm', () => {
    const now = Date.now();
    const day = resolveTimeBound('1d');
    const hour = resolveTimeBound('1h');
    const min = resolveTimeBound('1m');
    expect(day && now - new Date(day).getTime()).toBeGreaterThan(86_399_000);
    expect(hour && now - new Date(hour).getTime()).toBeGreaterThan(3_599_000);
    expect(min && now - new Date(min).getTime()).toBeGreaterThan(59_000);
  });

  it('returns near-now for "now"', () => {
    const before = Date.now();
    const result = resolveTimeBound('now');
    const after = Date.now();
    const t = result ? new Date(result).getTime() : 0;
    expect(t).toBeGreaterThanOrEqual(before);
    expect(t).toBeLessThanOrEqual(after);
  });

  it('returns null for empty input (no default)', () => {
    expect(resolveTimeBound(undefined)).toBeNull();
    expect(resolveTimeBound('')).toBeNull();
  });

  it('returns null for invalid input', () => {
    expect(resolveTimeBound('not-a-date')).toBeNull();
  });
});
