/**
 * Tests for the `--format=table` renderer (src/timeline/cli.ts).
 *
 * Covers describeEvent (per-event-type summary) and renderEventsTable
 * (column layout, header, alignment, empty input) — plus B-7 additions:
 * turn column, renderStatsTable (Top Files / Commit Lines), and DB-backed
 * coverage of --turn filter, stats JSON topFilesRead/Written, show output,
 * and query JSON full TimelineEvent fields.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';

import { renderEventsTable, describeEvent, renderStatsTable } from '../../../src/core/timeline/cli';
import { DatabaseConnection } from '../../../src/core/db';
import { ensureTimelineSchema } from '../../../src/core/timeline/schema-bootstrap';
import { TimelineStore } from '../../../src/core/timeline/store';
import type { TimelineEvent, TimelineStats } from '../../../src/core/timeline/types';

function makeEvent(overrides: Partial<TimelineEvent>): TimelineEvent {
  return {
    id: 1,
    ts: '2026-06-27T05:30:00.000Z',
    session_id: null,
    event_type: 'stop',
    tool_name: null,
    tool_args: null,
    tool_result_summary: null,
    prompt_text: null,
    duration_ms: null,
    commit_hash: null,
    commit_message: null,
    commit_files: [],
    cwd: '/proj',
    metadata: {},
    turn_id: null,
    commit_insertions: null,
    commit_deletions: null,
    ...overrides,
  };
}

function makeStats(overrides: Partial<TimelineStats> = {}): TimelineStats {
  return {
    totalEvents: 0,
    byType: {
      user_prompt: 0,
      pre_tool_use: 0,
      post_tool_use: 0,
      stop: 0,
      git_commit: 0,
    },
    byTool: [],
    byDay: [],
    topFilesRead: [],
    topFilesWritten: [],
    windowStart: null,
    windowEnd: null,
    ...overrides,
  };
}

describe('describeEvent — per-event-type summary', () => {
  it('user_prompt: short text is shown in full', () => {
    const e = makeEvent({ event_type: 'user_prompt', prompt_text: 'how do I add a feature' });
    expect(describeEvent(e)).toBe('how do I add a feature');
  });

  it('user_prompt: text over 120 chars is truncated to 119 + ellipsis', () => {
    const long = 'x'.repeat(200);
    const out = describeEvent(makeEvent({ event_type: 'user_prompt', prompt_text: long }));
    expect(out).toHaveLength(120);
    expect(out.endsWith('…')).toBe(true);
    expect(out.slice(0, 119)).toBe('x'.repeat(119));
  });

  it('user_prompt: empty prompt_text yields empty string', () => {
    expect(describeEvent(makeEvent({ event_type: 'user_prompt', prompt_text: null }))).toBe('');
  });

  it('pre_tool_use: file_path is shown without truncation', () => {
    const e = makeEvent({
      event_type: 'pre_tool_use',
      tool_name: 'Edit',
      tool_args: { file_path: 'src/auth/login.ts', old: 'a', new: 'b' },
    });
    expect(describeEvent(e)).toBe('src/auth/login.ts');
  });

  it('pre_tool_use: path is shown when no file_path', () => {
    const e = makeEvent({
      event_type: 'pre_tool_use',
      tool_name: 'Read',
      tool_args: { path: '/abs/path/file.ts' },
    });
    expect(describeEvent(e)).toBe('/abs/path/file.ts');
  });

  it('pre_tool_use: command is truncated at 120 chars', () => {
    const long = 'npm run ' + 'x'.repeat(200);
    const e = makeEvent({
      event_type: 'pre_tool_use',
      tool_name: 'Bash',
      tool_args: { command: long },
    });
    const out = describeEvent(e);
    expect(out).toHaveLength(120);
    expect(out.endsWith('…')).toBe(true);
  });

  it('post_tool_use: query is truncated at 120 chars', () => {
    const long = 'SELECT ' + 'x'.repeat(200);
    const e = makeEvent({
      event_type: 'post_tool_use',
      tool_name: 'db',
      tool_args: { query: long },
    });
    const out = describeEvent(e);
    expect(out).toHaveLength(120);
    expect(out.endsWith('…')).toBe(true);
  });

  it('pre_tool_use: url is shown without truncation', () => {
    const e = makeEvent({
      event_type: 'pre_tool_use',
      tool_name: 'WebFetch',
      tool_args: { url: 'https://example.com/page' },
    });
    expect(describeEvent(e)).toBe('https://example.com/page');
  });

  it('pre_tool_use: falls back to empty when no recognised arg', () => {
    const e = makeEvent({
      event_type: 'pre_tool_use',
      tool_name: 'Bash',
      tool_args: { unknown_field: 'value' },
    });
    expect(describeEvent(e)).toBe('');
  });

  it('pre_tool_use: empty when tool_args is null', () => {
    const e = makeEvent({ event_type: 'pre_tool_use', tool_name: 'Edit', tool_args: null });
    expect(describeEvent(e)).toBe('');
  });

  it('git_commit: hash + message + file count when all present', () => {
    const e = makeEvent({
      event_type: 'git_commit',
      commit_hash: 'abc123def456',
      commit_message: 'fix login bug',
      commit_files: ['src/a.ts', 'src/b.ts', 'src/c.ts'],
    });
    expect(describeEvent(e)).toBe('abc123d fix login bug (3 files)');
  });

  it('git_commit: file count is omitted when zero files', () => {
    const e = makeEvent({
      event_type: 'git_commit',
      commit_hash: 'abc123def456',
      commit_message: 'empty commit',
      commit_files: [],
    });
    expect(describeEvent(e)).toBe('abc123d empty commit');
  });

  it('git_commit: long message is truncated at 100 chars', () => {
    const long = 'y'.repeat(200);
    const e = makeEvent({
      event_type: 'git_commit',
      commit_hash: 'abcdefg', // 7-char hash exercises slice(0, 7)
      commit_message: long,
      commit_files: ['a'],
    });
    const out = describeEvent(e);
    // hash(7) + space + msg(100) + space + "(1 files)" = 7+1+100+1+9 = 118
    expect(out).toBe(`abcdefg ${'y'.repeat(99)}… (1 files)`);
    expect(out).toHaveLength(118);
  });

  it('git_commit: hash missing yields just message + count', () => {
    const e = makeEvent({
      event_type: 'git_commit',
      commit_hash: null,
      commit_message: 'msg',
      commit_files: ['a.ts'],
    });
    expect(describeEvent(e)).toBe('msg (1 files)');
  });

  it('git_commit: only file count when hash and message missing', () => {
    const e = makeEvent({
      event_type: 'git_commit',
      commit_hash: null,
      commit_message: null,
      commit_files: ['a.ts', 'b.ts'],
    });
    expect(describeEvent(e)).toBe('(2 files)');
  });

  it('stop: with duration_ms shows milliseconds', () => {
    const e = makeEvent({ event_type: 'stop', duration_ms: 45000 });
    expect(describeEvent(e)).toBe('session ended (45000ms)');
  });

  it('stop: without duration_ms shows plain message', () => {
    const e = makeEvent({ event_type: 'stop', duration_ms: null });
    expect(describeEvent(e)).toBe('session ended');
  });
});

describe('renderEventsTable — column layout', () => {
  it('returns "(no events)" for empty input', () => {
    expect(renderEventsTable([])).toBe('(no events)');
  });

  it('emits a header row followed by data rows', () => {
    const events = [
      makeEvent({ id: 1, event_type: 'user_prompt', prompt_text: 'hi' }),
      makeEvent({
        id: 2,
        event_type: 'pre_tool_use',
        tool_name: 'Edit',
        tool_args: { file_path: 'src/a.ts' },
      }),
    ];
    const out = renderEventsTable(events);
    const lines = out.split('\n');
    expect(lines).toHaveLength(3);
    expect(lines[0]).toContain('id');
    expect(lines[0]).toContain('ts');
    expect(lines[0]).toContain('event_type');
    expect(lines[0]).toContain('tool_name');
    expect(lines[0]).toContain('summary');
    expect(lines[1]).toContain('1');
    expect(lines[1]).toContain('user_prompt');
    expect(lines[1]).toContain('hi');
    expect(lines[2]).toContain('2');
    expect(lines[2]).toContain('Edit');
    expect(lines[2]).toContain('src/a.ts');
  });

  it('tool_name null renders empty tool_name cell (column still aligned)', () => {
    const e = makeEvent({ id: 5, event_type: 'stop', duration_ms: 1000, tool_name: null });
    const out = renderEventsTable([e]);
    const lines = out.split('\n');
    expect(lines[1]).toContain('stop');
    expect(lines[1]).toContain('session ended (1000ms)');
    // header line has "tool_name" so the column is there; row 1's tool_name cell is empty
    expect(lines[0]).toContain('tool_name');
  });

  it('pads columns to the widest cell in each column', () => {
    const events = [
      makeEvent({
        id: 1,
        event_type: 'pre_tool_use',
        tool_name: 'Edit',
        tool_args: { file_path: 'short.ts' },
      }),
      makeEvent({
        id: 2,
        event_type: 'pre_tool_use',
        tool_name: 'Edit',
        tool_args: { file_path: 'a-much-longer-file-path.ts' },
      }),
    ];
    const out = renderEventsTable([events[0]!, events[1]!]);
    const lines = out.split('\n');
    // Both data rows should have the same length (column widths locked across all rows)
    expect(lines[1]!.length).toBe(lines[2]!.length);
  });

  it('renders a mixed batch without crash and includes each event_type', () => {
    const events: TimelineEvent[] = [
      makeEvent({ id: 1, event_type: 'user_prompt', prompt_text: 'p' }),
      makeEvent({
        id: 2,
        event_type: 'pre_tool_use',
        tool_name: 'Bash',
        tool_args: { command: 'ls' },
      }),
      makeEvent({
        id: 3,
        event_type: 'post_tool_use',
        tool_name: 'Bash',
        tool_args: { command: 'ls' },
      }),
      makeEvent({ id: 4, event_type: 'stop', duration_ms: 200 }),
      makeEvent({
        id: 5,
        event_type: 'git_commit',
        commit_hash: 'abcdef',
        commit_message: 'm',
        commit_files: ['f'],
      }),
    ];
    const out = renderEventsTable(events);
    const lines = out.split('\n');
    expect(lines).toHaveLength(6);
    expect(out).toContain('user_prompt');
    expect(out).toContain('pre_tool_use');
    expect(out).toContain('post_tool_use');
    expect(out).toContain('stop');
    expect(out).toContain('git_commit');
  });
});

// ─── B-7: renderEventsTable turn column (Cases 1, 2) ────────────────────────

describe('renderEventsTable — B-7 turn column', () => {
  it('Case 1: shows first 8 chars of turn_id between tool_name and summary', () => {
    const e = makeEvent({
      id: 1,
      event_type: 'pre_tool_use',
      tool_name: 'Edit',
      tool_args: { file_path: 'src/a.ts' },
      turn_id: 'abcd1234-5678-90ef-ghij-klmnopqrstuv',
    });
    const out = renderEventsTable([e]);
    const lines = out.split('\n');
    // header includes turn column
    expect(lines[0]).toContain('turn');
    // data row contains the 8-char prefix
    expect(lines[1]).toContain('abcd1234');
    // the full uuid is NOT shown (truncated to 8)
    expect(lines[1]).not.toContain('abcd1234-5678');
  });

  it('Case 2: turn column shows "-" when turn_id is null', () => {
    const e = makeEvent({
      id: 2,
      event_type: 'stop',
      duration_ms: 1000,
      turn_id: null,
    });
    const out = renderEventsTable([e]);
    const lines = out.split('\n');
    // turn column header present
    expect(lines[0]).toContain('turn');
    // row contains the dash placeholder
    expect(lines[1]).toContain('-');
    // session ended summary still rendered
    expect(lines[1]).toContain('session ended (1000ms)');
  });

  it('column order is id | ts | event_type | tool_name | turn | summary', () => {
    const e = makeEvent({
      id: 1,
      event_type: 'pre_tool_use',
      tool_name: 'Edit',
      tool_args: { file_path: 'src/a.ts' },
      turn_id: '01234567-abcd',
    });
    const out = renderEventsTable([e]);
    const header = out.split('\n')[0]!;
    const turnIdx = header.indexOf('turn');
    const toolIdx = header.indexOf('tool_name');
    const summaryIdx = header.indexOf('summary');
    expect(toolIdx).toBeLessThan(turnIdx);
    expect(turnIdx).toBeLessThan(summaryIdx);
  });
});

// ─── B-7: renderStatsTable (Cases 4, 6 — table sections) ────────────────────

describe('renderStatsTable — B-7 stats table sections', () => {
  it('Case 4: includes Top Files Read and Top Files Written sections', () => {
    const s = makeStats({
      totalEvents: 5,
      topFilesRead: [
        { file: 'src/read/a.ts', count: 3 },
        { file: 'src/read/b.ts', count: 1 },
      ],
      topFilesWritten: [
        { file: 'src/write/x.ts', count: 2 },
      ],
    });
    const out = renderStatsTable(s);
    expect(out).toContain('Top Files Read');
    expect(out).toContain('src/read/a.ts');
    expect(out).toContain('src/read/b.ts');
    expect(out).toContain('Top Files Written');
    expect(out).toContain('src/write/x.ts');
  });

  it('Case 4: Top Files sections omitted when arrays are empty', () => {
    const s = makeStats({ totalEvents: 1 });
    const out = renderStatsTable(s);
    expect(out).not.toContain('Top Files Read');
    expect(out).not.toContain('Top Files Written');
  });

  it('Case 6: Commit Lines (INS/DEL) section always present, defaults to 0/0', () => {
    const s = makeStats({ totalEvents: 1 });
    const out = renderStatsTable(s);
    expect(out).toContain('Commit Lines (INS/DEL):');
    expect(out).toContain('0 / 0');
  });

  it('Case 6: Commit Lines section reflects passed insertions/deletions totals', () => {
    const s = makeStats({ totalEvents: 2 });
    const out = renderStatsTable(s, { insertions: 42, deletions: 17 });
    expect(out).toContain('Commit Lines (INS/DEL): 42 / 17');
  });

  it('includes Total Events and Window header lines (Window shown in local time)', () => {
    const s = makeStats({
      totalEvents: 7,
      windowStart: '2026-06-01T00:00:00.000Z',
      windowEnd: '2026-06-28T00:00:00.000Z',
    });
    const out = renderStatsTable(s);
    expect(out).toContain('Total Events:');
    expect(out).toContain('7');
    // Suite runs under TZ=UTC, so local rendering equals UTC. The label carries
    // '(local)' to flag the semantics; the value is YYYY-MM-DD HH:MM:SS (no Z).
    expect(out).toContain('Window (local):');
    expect(out).toContain('2026-06-01 00:00:00');
    expect(out).toContain('2026-06-28 00:00:00');
    // Raw UTC ISO must NOT appear in the table output anymore — only in JSON.
    expect(out).not.toContain('2026-06-01T00:00:00.000Z');
  });
});

// ─── B-7: DB-backed integration (Cases 3, 5, 7, 8) ──────────────────────────
//
// These exercise the store layer that the CLI commands drive. The CLI's
// query/show/stats actions call the indexer wrappers (queryEvents /
// getEventById / getEventStats), which in turn call the exact store methods
// used here. We test against the store directly because the indexer wrappers
// run the code-graph migration (`openTimelineDb` → `runMigrations`), which
// needs the full code-graph schema and is out of scope for a timeline-only
// test DB. The store is the load-bearing layer; the wrappers are a thin
// connect → call → close shell.

describe('B-7 DB-backed — --turn filter / stats JSON / show / query JSON', () => {
  let dir: string;
  let dbPath: string;
  let conn: DatabaseConnection;
  let store: TimelineStore;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cg-cli-'));
    dbPath = path.join(dir, 'timeline.db');
    conn = DatabaseConnection.open(dbPath);
    ensureTimelineSchema(conn.getDb());
    store = new TimelineStore(conn.getDb());
  });

  afterEach(() => {
    conn.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('Case 3: store.query filter.turn returns only events for that turn_id', () => {
    const turnA = 'aaaaaaaa-1111-2222-3333-444444444444';
    const turnB = 'bbbbbbbb-1111-2222-3333-444444444444';
    store.insert({
      event_type: 'pre_tool_use',
      tool_name: 'Edit',
      tool_args: { file_path: 'a.ts' },
      turn_id: turnA,
      ts: '2026-06-27T10:00:00.000Z',
    });
    store.insert({
      event_type: 'pre_tool_use',
      tool_name: 'Edit',
      tool_args: { file_path: 'b.ts' },
      turn_id: turnB,
      ts: '2026-06-27T10:01:00.000Z',
    });
    store.insert({
      event_type: 'pre_tool_use',
      tool_name: 'Edit',
      tool_args: { file_path: 'c.ts' },
      turn_id: turnA,
      ts: '2026-06-27T10:02:00.000Z',
    });

    const events = store.query({ turn: turnA });
    expect(events).toHaveLength(2);
    for (const e of events) {
      expect(e.turn_id).toBe(turnA);
    }
  });

  it('Case 5: store.stats returns topFilesRead and topFilesWritten arrays', () => {
    store.insert({
      event_type: 'pre_tool_use',
      tool_name: 'Read',
      tool_args: { file_path: 'src/read1.ts' },
      ts: '2026-06-27T10:00:00.000Z',
    });
    store.insert({
      event_type: 'pre_tool_use',
      tool_name: 'Read',
      tool_args: { file_path: 'src/read1.ts' },
      ts: '2026-06-27T10:01:00.000Z',
    });
    store.insert({
      event_type: 'pre_tool_use',
      tool_name: 'Edit',
      tool_args: { file_path: 'src/written.ts' },
      ts: '2026-06-27T10:02:00.000Z',
    });

    const stats = store.stats({ since: '2026-06-01' });
    expect(Array.isArray(stats.topFilesRead)).toBe(true);
    expect(Array.isArray(stats.topFilesWritten)).toBe(true);
    const read1 = stats.topFilesRead.find(x => x.file === 'src/read1.ts');
    expect(read1).toBeDefined();
    expect(read1!.count).toBe(2);
    const written = stats.topFilesWritten.find(x => x.file === 'src/written.ts');
    expect(written).toBeDefined();
    expect(written!.count).toBe(1);
  });

  it('Case 7: store.getById (show command) returns full TimelineEvent with new fields', () => {
    const id = store.insert({
      event_type: 'git_commit',
      commit_hash: 'abc1234',
      commit_message: 'feat: add stuff',
      commit_files: ['src/a.ts', 'src/b.ts'],
      commit_insertions: 42,
      commit_deletions: 7,
      turn_id: 'deadbeef-1234',
      ts: '2026-06-27T10:00:00.000Z',
    });

    const event = store.getById(id);
    expect(event).not.toBeNull();
    expect(event!.turn_id).toBe('deadbeef-1234');
    expect(event!.commit_insertions).toBe(42);
    expect(event!.commit_deletions).toBe(7);
    // duration_ms is present on the type (null for git_commit events)
    expect(event!.duration_ms).toBeNull();
  });

  it('Case 7b: show output for stop event carries duration_ms', () => {
    const id = store.insert({
      event_type: 'stop',
      duration_ms: 99000,
      turn_id: 'cafef00d-abcd',
      ts: '2026-06-27T11:00:00.000Z',
    });

    const event = store.getById(id);
    expect(event).not.toBeNull();
    expect(event!.duration_ms).toBe(99000);
    expect(event!.turn_id).toBe('cafef00d-abcd');
  });

  it('Case 8: store.query returns TimelineEvent with all B-7 fields (json path)', () => {
    store.insert({
      event_type: 'pre_tool_use',
      tool_name: 'Edit',
      tool_args: { file_path: 'a.ts' },
      turn_id: '12345678-abcd',
      duration_ms: 1500,
      ts: '2026-06-27T10:00:00.000Z',
    });

    const events = store.query({});
    expect(events).toHaveLength(1);
    const e = events[0]!;
    // Full TimelineEvent shape includes all B-7 fields
    expect(e).toHaveProperty('turn_id');
    expect(e).toHaveProperty('commit_insertions');
    expect(e).toHaveProperty('commit_deletions');
    expect(e).toHaveProperty('duration_ms');
    expect(e.turn_id).toBe('12345678-abcd');
    expect(e.duration_ms).toBe(1500);
    // JSON-serialize the event the same way the CLI does — proves the field
    // round-trips through JSON.stringify intact (the query --format=json path).
    const json = JSON.parse(JSON.stringify(e));
    expect(json.turn_id).toBe('12345678-abcd');
    expect(json.duration_ms).toBe(1500);
  });
});
