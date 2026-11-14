/** Codex CLI / desktop rollout JSONL → timeline facts. */
import * as fs from 'node:fs';
import * as readline from 'node:readline';
import * as path from 'node:path';
import * as os from 'node:os';
import type { AgentAdapterContext } from '../adapter';
import { readJsonlLinesFrom } from './jsonl-lines';
import type { SessionFact, SessionFileReadResult } from './types';

function record(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}
function str(value: unknown): string | undefined { return typeof value === 'string' && value !== '' ? value : undefined; }
function args(value: unknown): unknown {
  if (typeof value !== 'string') return value;
  try { return JSON.parse(value) as unknown; } catch { return value; }
}
async function header(file: string): Promise<Record<string, unknown> | undefined> {
  const stream = fs.createReadStream(file, { encoding: 'utf8' });
  const lines = readline.createInterface({ input: stream, crlfDelay: Infinity });
  try {
    for await (const line of lines) {
      try { const item = record(JSON.parse(line)); return item?.['type'] === 'session_meta' ? record(item['payload']) : undefined; }
      catch { return undefined; }
    }
    return undefined;
  } finally { lines.close(); stream.destroy(); }
}

function parentOf(meta: Record<string, unknown> | undefined): string | undefined {
  const source = record(meta?.['source']);
  const spawned = record(record(source?.['subagent'])?.['thread_spawn']);
  return str(meta?.['parent_thread_id']) ?? str(spawned?.['parent_thread_id']);
}

function findSessionFile(dir: string, id: string): string | undefined {
  let entries: fs.Dirent[];
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return undefined; }
  for (const entry of entries) {
    const file = path.join(dir, entry.name);
    if (entry.isFile() && entry.name.endsWith(`-${id}.jsonl`)) return file;
    if (entry.isDirectory()) {
      const found = findSessionFile(file, id);
      if (found) return found;
    }
  }
  return undefined;
}

async function rootSession(file: string, parent: string): Promise<string> {
  const root = path.resolve(path.dirname(file), '../../..');
  const seen = new Set<string>();
  let current = parent;
  while (!seen.has(current)) {
    seen.add(current);
    const parentFile = findSessionFile(root, current);
    if (!parentFile) break;
    const next = parentOf(await header(parentFile));
    if (!next || seen.has(next)) break;
    current = next;
  }
  return current;
}

/** Map a Codex child thread to its root for commit attribution, when its rollout is available. */
export async function codexRootSessionId(id: string, context?: AgentAdapterContext): Promise<string> {
  const env = context?.env ?? process.env;
  const home = context?.userHome ?? os.homedir();
  const root = path.join(env['CODEX_HOME']?.trim() || path.join(home, '.codex'), 'sessions');
  if (!root) return id;
  const file = findSessionFile(root, id);
  if (!file) return id;
  const parent = parentOf(await header(file));
  return parent ? rootSession(file, parent) : id;
}

export async function readCodexSessionFacts(file: string, offset: number): Promise<SessionFileReadResult> {
  const meta = await header(file);
  const id = str(meta?.['id']);
  const cwd = str(meta?.['cwd']);
  const parentId = parentOf(meta);
  const sessionId = parentId ? await rootSession(file, parentId) : id;
  if (!id || !sessionId) return { facts: [], consumedBytes: offset };
  const facts: SessionFact[] = [];
  const calls = new Map<string, { start: number; name: string; input: unknown; ts: string; cwd: string | undefined }>();
  let currentCwd = cwd;
  let pendingPrompt: { text: string; ts: string; start: number } | undefined;
  const flushPrompt = (): void => {
    if (!pendingPrompt || parentId) { pendingPrompt = undefined; return; }
    facts.push({ kind: 'prompt', sessionId, ts: pendingPrompt.ts, uuid: `${id}:${pendingPrompt.start}`, text: pendingPrompt.text, source: 'user' });
    pendingPrompt = undefined;
  };
  const end = await readJsonlLinesFrom(file, offset, line => {
    let row: Record<string, unknown> | undefined;
    try { row = record(JSON.parse(line.text)); } catch { return; }
    const p = record(row?.['payload']);
    const time = str(row?.['timestamp']);
    if (!row || !p || !time) return;
    const kind = str(row['type']);
    const type = str(p['type']);
    if (kind === 'session_meta' && cwd) facts.push({ kind: 'session_head', sessionId, startCwd: cwd, ts: time });
    if (kind === 'turn_context') currentCwd = str(p['cwd']) ?? currentCwd;
    if (kind === 'response_item' && type === 'message' && p['role'] === 'user') {
      const blocks = Array.isArray(p['content']) ? p['content'] : [];
      const text = blocks.map(block => record(block)).filter(block => block?.['type'] === 'input_text')
        .map(block => str(block?.['text']) ?? '').filter(Boolean).join('\n');
      if (text && !/^\s*<(?:environment_context|user_instructions|system-reminder)\b/.test(text)) {
        flushPrompt();
        pendingPrompt = { text, ts: time, start: line.start };
      }
      return;
    }
    if (kind === 'event_msg' && type === 'user_message' && !parentId) {
      const text = str(p['message']);
      if (text && pendingPrompt?.text === text) flushPrompt();
      else {
        flushPrompt();
        if (text) facts.push({ kind: 'prompt', sessionId, ts: time, uuid: `${id}:${line.start}`, text, source: 'user' });
      }
    }
    if (kind === 'event_msg' && type === 'task_complete') {
      flushPrompt();
      if (!parentId) facts.push({ kind: 'turn_end', sessionId, ts: time, messageId: str(p['turn_id']) ?? `${id}:${line.start}` });
      calls.clear();
    }
    if (kind !== 'response_item') return;
    flushPrompt();
    const callId = str(p['call_id']);
    if (!callId) return;
    if (type === 'function_call' || type === 'custom_tool_call') {
      const name = str(p['name']);
      if (name) calls.set(callId, { start: line.start, name, input: args(p['arguments'] ?? p['input']), ts: time, cwd: currentCwd });
    } else if (type === 'function_call_output' || type === 'custom_tool_call_output') {
      const call = calls.get(callId);
      if (!call) return;
      calls.delete(callId);
      const name = call.name === 'exec_command' ? 'Bash' : call.name === 'apply_patch' ? 'Edit' : call.name;
      let input = name === 'Bash' && record(call.input) ? { ...record(call.input), command: record(call.input)?.['cmd'] } : call.input;
      if (call.name === 'apply_patch' && typeof call.input === 'string') {
        const filePath = /^\*\*\* (?:Update|Add|Delete) File: (.+)$/m.exec(call.input)?.[1];
        input = { file_path: filePath, patch_bytes: Buffer.byteLength(call.input) };
      }
      const output = typeof p['output'] === 'string' ? p['output'] : '';
      const exitCode = /(?:Process exited with code|exit code):\s*(\d+)/i.exec(output)?.[1];
      facts.push({ kind: 'tool', sessionId, cwd: call.cwd, toolUseId: callId, toolName: name,
        issuedTs: call.ts, args: input, resultTs: time, resultPayload: p['output'], isError: exitCode !== undefined && exitCode !== '0',
        ...(parentId ? { subagent: { id } } : {}) });
    }
  });
  const pendingStart = pendingPrompt?.start;
  flushPrompt();
  const firstPending = Math.min(end, ...Array.from(calls.values(), c => c.start));
  return { facts, consumedBytes: Math.min(firstPending, pendingStart ?? end) };
}
