import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { codexRootSessionId, readCodexSessionFacts } from '../../../src/core/timeline/ingest/codex-session';
import { getAgentProfile, agentInstructionsPath, listSessionSources, resolveSessionIdFromEnv } from '../../../src/core/agents';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-sessions-'));
afterEach(() => fs.rmSync(root, { recursive: true, force: true }));
const time = '2026-11-14T00:00:00.000Z';
function row(type: string, payload: unknown): string { return JSON.stringify({ timestamp: time, type, payload }) + '\n'; }
function file(id: string, meta: Record<string, unknown>, body = ''): string {
  const dir = path.join(root, 'sessions/2026/11/14'); fs.mkdirSync(dir, { recursive: true });
  const result = path.join(dir, `rollout-2026-11-14T00-00-00-${id}.jsonl`);
  fs.writeFileSync(result, row('session_meta', { id, cwd: '/project', ...meta }) + body); return result;
}

describe('Codex sessions', () => {
  it('registers the project instructions, source and environment variable', () => {
    const profile = getAgentProfile('codex');
    expect(profile).toBeDefined();
    expect(agentInstructionsPath('/project', profile!)).toBe('/project/AGENTS.md');
    expect(listSessionSources().find(s => s.id === 'codex')?.sessionReader).toBe('codex-session');
    expect(resolveSessionIdFromEnv({ CODEX_THREAD_ID: 'thread' })).toMatchObject({ agent: 'codex', sessionId: 'thread' });
  });
  it('pairs calls across incremental reads and leaves partial lines for later', async () => {
    const f = file('one', { source: 'cli' }, row('event_msg', { type: 'user_message', message: 'hello' }) + row('response_item', { type: 'function_call', name: 'exec_command', call_id: 'call', arguments: '{"cmd":"pwd"}' }));
    const first = await readCodexSessionFacts(f, 0);
    expect(first.facts.map(fact => fact.kind)).toEqual(['session_head', 'prompt']);
    fs.appendFileSync(f, row('response_item', { type: 'function_call_output', call_id: 'call', output: 'ok' }) + row('event_msg', { type: 'task_complete', turn_id: 'turn' }) + '{');
    const next = await readCodexSessionFacts(f, first.consumedBytes);
    expect(next.facts).toContainEqual(expect.objectContaining({ kind: 'tool', sessionId: 'one', toolName: 'Bash', toolUseId: 'call', args: expect.objectContaining({ command: 'pwd' }) }));
    expect(next.facts).toContainEqual(expect.objectContaining({ kind: 'turn_end', messageId: 'turn' }));
    expect(next.consumedBytes).toBe(fs.statSync(f).size - 1);
  });
  it('reads desktop user messages and deduplicates paired event messages', async () => {
    const f = file('desktop', { source: 'vscode' },
      row('response_item', { type: 'message', role: 'user', content: [{ type: 'input_text', text: '<environment_context>ignore</environment_context>' }] }) +
      row('response_item', { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'desktop question' }] }) +
      row('response_item', { type: 'function_call', name: 'exec_command', call_id: 'a', arguments: '{}' }) +
      row('response_item', { type: 'function_call_output', call_id: 'a', output: 'ok' }) +
      row('response_item', { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'paired question' }] }) +
      row('event_msg', { type: 'user_message', message: 'paired question' }));
    const result = await readCodexSessionFacts(f, 0);
    expect(result.facts.filter(fact => fact.kind === 'prompt').map(fact => fact.kind === 'prompt' ? fact.text : '')).toEqual(['desktop question', 'paired question']);
  });
  it('associates nested subagent tools with the root and preserves child identity', async () => {
    file('root', { source: 'vscode' });
    file('child', { parent_thread_id: 'root', thread_source: 'subagent' });
    const f = file('grandchild', { source: { subagent: { thread_spawn: { parent_thread_id: 'child', depth: 2 } } } },
      row('event_msg', { type: 'user_message', message: 'delegated' }) +
      row('response_item', { type: 'custom_tool_call', name: 'apply_patch', call_id: 'patch', input: 'patch' }) +
      row('response_item', { type: 'custom_tool_call_output', call_id: 'patch', output: 'done' }));
    const result = await readCodexSessionFacts(f, 0);
    expect(result.facts.some(fact => fact.kind === 'prompt')).toBe(false);
    expect(result.facts).toContainEqual(expect.objectContaining({ kind: 'tool', sessionId: 'root', subagent: { id: 'grandchild' } }));
    const previousHome = process.env.CODEX_HOME;
    try {
      process.env.CODEX_HOME = root;
      expect(await codexRootSessionId('grandchild')).toBe('root');
    } finally {
      if (previousHome === undefined) delete process.env.CODEX_HOME;
      else process.env.CODEX_HOME = previousHome;
    }
  });
});
