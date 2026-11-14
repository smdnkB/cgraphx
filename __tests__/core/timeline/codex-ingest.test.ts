import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { ensureDataDirAtRoot } from '../../../src/core/data-location';
import { DatabaseConnection, DATABASE_FILENAME } from '../../../src/core/db';
import { ensureTimelineSchema, ensureTimelineUpToDate } from '../../../src/core/timeline';

const tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'cgx-codex-e2e-')));
afterEach(() => fs.rmSync(tmp, { recursive: true, force: true }));
it('ingests Codex files into the project exactly once', async () => {
  const root = path.join(tmp, 'project'); fs.mkdirSync(root);
  execFileSync('git', ['init', '-q'], { cwd: root });
  fs.mkdirSync(path.join(root, '.cgraphx'));
  DatabaseConnection.open(path.join(root, '.cgraphx', DATABASE_FILENAME)).close();
  const dataDir = ensureDataDirAtRoot(root)!;
  const conn = DatabaseConnection.open(path.join(dataDir, DATABASE_FILENAME));
  const db = conn.getDb(); ensureTimelineSchema(db);
  db.prepare('INSERT INTO timeline_roots (root, first_ts, last_ts) VALUES (?, ?, ?)').run(root, '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z');
  db.prepare('INSERT INTO timeline_meta (key, value) VALUES (?, ?)').run('rebuilt_at', '2026-01-01T00:00:00.000Z');
  conn.close();
  const dir = path.join(os.homedir(), '.codex/sessions/2026/11/14'); fs.mkdirSync(dir, { recursive: true });
  const entry = (type: string, payload: unknown): string => JSON.stringify({ timestamp: '2026-11-14T00:00:00.000Z', type, payload }) + '\n';
  fs.writeFileSync(path.join(dir, 'rollout-2026-11-14T00-00-00-session.jsonl'),
    entry('session_meta', { id: 'session', cwd: root, source: 'cli' }) +
    entry('response_item', { type: 'message', role: 'user', content: [{ type: 'input_text', text: '$dev-impl test' }] }) +
    entry('response_item', { type: 'function_call', call_id: 'call', name: 'exec_command', arguments: '{"cmd":"pwd"}' }) +
    entry('response_item', { type: 'function_call_output', call_id: 'call', output: 'ok' }) +
    entry('event_msg', { type: 'task_complete', turn_id: 'turn' }));
  await ensureTimelineUpToDate(root);
  await ensureTimelineUpToDate(root);
  const result = DatabaseConnection.open(path.join(dataDir, DATABASE_FILENAME));
  const events = result.getDb().prepare("SELECT event_type, agent, session_id FROM timeline_events WHERE agent = 'codex' ORDER BY id").all();
  result.close();
  expect(events).toEqual(['session_start', 'user_prompt', 'post_tool_use', 'stop'].map(event_type => expect.objectContaining({ event_type, agent: 'codex', session_id: 'session' })));
  const old = DatabaseConnection.open(path.join(dataDir, DATABASE_FILENAME));
  old.getDb().prepare("DELETE FROM timeline_events WHERE agent = 'codex' AND event_type = 'user_prompt'").run();
  old.getDb().prepare("DELETE FROM timeline_meta WHERE key = 'codex_prompt_backfill_v1'").run();
  old.close();
  await ensureTimelineUpToDate(root);
  await ensureTimelineUpToDate(root);
  const restored = DatabaseConnection.open(path.join(dataDir, DATABASE_FILENAME));
  const prompts = restored.getDb().prepare("SELECT prompt_text FROM timeline_events WHERE agent = 'codex' AND event_type = 'user_prompt'").all();
  restored.close();
  expect(prompts).toEqual([expect.objectContaining({ prompt_text: '$dev-impl test' })]);
});
