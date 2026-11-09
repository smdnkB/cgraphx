/**
 * DeepSeek 会话读取器单元测试(2026-11-06-agent看板 单元测试规格 A1–A8;spec D13、K4、验收 3)。
 *
 * 会话文件用 zlib.zstdCompressSync 现场造(spec 验收 3 的原话),不碰本机 ~/.dsh。
 */

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import * as zlib from 'node:zlib';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { listSessionSources } from '../../../src/core/agents';
import { readDeepSeekSessionFacts } from '../../../src/core/timeline/ingest/deepseek-session';

/** 一帧:若干 JSONL 行压成一个 zstd 帧。 */
function frame(lines: unknown[]): Buffer {
  return zlib.zstdCompressSync(Buffer.from(lines.map((l) => `${JSON.stringify(l)}\n`).join('')));
}

const PROJ = '/tmp/deepseek-proj'; // 会话头里的 cwd(读取器不查目录在不在,测试里是任意路径)

function header(id: string, extra: Record<string, unknown> = {}): unknown {
  return { type: 'session', version: 4, id, createdAt: 1793100000000, cwd: PROJ, isSeeded: false, delegationDepth: 0, ...extra };
}

function userMessage(seq: number, time: number, text: string, id: string): unknown {
  return {
    type: 'user/message', seq, time,
    data: { content: [{ type: 'text', text }], source: { kind: 'user' }, role: 'user', id },
    surfaceOp: 'append',
  };
}

function toolCall(seq: number, time: number, callId: string, name: string, argsJson: string): unknown {
  return { type: 'tool/call', seq, time, data: { turn: 1, step: 1, callId, name, arguments: argsJson } };
}

function toolResult(seq: number, time: number, callId: string): unknown {
  return {
    type: 'tool/result', seq, time,
    data: { turn: 1, step: 1, message: { role: 'tool', toolCallId: callId, content: [{ type: 'text', text: 'ok' }] } },
  };
}

describe('readDeepSeekSessionFacts (spec D13)', () => {
  let root: string;

  beforeEach(() => {
    root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'cgx-ds-')));
  });
  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  /** 写一个会话文件:`<root>/<group>/<sid>/session.v4.jsonl.zstd`(readHeaderOf 找父会话靠这个布局)。 */
  function writeSession(sid: string, frames: Buffer[], group = 'g1'): string {
    const dir = path.join(root, group, sid);
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, 'session.v4.jsonl.zstd');
    fs.writeFileSync(file, Buffer.concat(frames));
    return file;
  }

  it('A1: maps header/user/tool/turn/title lines to facts and normalizes tool names', async () => {
    const file = writeSession('session-a1-0000-4000-8000-000000000001', [
      frame([
        header('session-a1-0000-4000-8000-000000000001'),
        { type: 'session/title', seq: 2, time: 1793100000100, data: { title: '会话标题', source: { kind: 'fallback' } } },
        userMessage(8, 1793100000200, '你好', 'u1'),
        toolCall(18, 1793100000300, 'call-1', 'read', JSON.stringify({ file_path: `${PROJ}/a.md` })),
        toolCall(19, 1793100000350, 'call-2', 'mcp__custom__tool', '{}'),
        toolResult(20, 1793100000400, 'call-1'),
        toolResult(21, 1793100000450, 'call-2'),
        { type: 'turn/end', seq: 22, time: 1793100000500, data: { turn: 1, reason: { kind: 'completed' } } },
      ]),
    ]);

    const { facts, consumedBytes } = await readDeepSeekSessionFacts(file, 0);

    expect(consumedBytes).toBe(fs.statSync(file).size);
    const head = facts.find((f) => f.kind === 'session_head');
    expect(head).toMatchObject({ kind: 'session_head', sessionId: 'session-a1-0000-4000-8000-000000000001', startCwd: PROJ });
    const title = facts.find((f) => f.kind === 'session_title');
    expect(title).toMatchObject({ kind: 'session_title', title: '会话标题', titleKind: 'agent' });
    const prompt = facts.find((f) => f.kind === 'prompt');
    expect(prompt).toMatchObject({ kind: 'prompt', text: '你好', source: 'user' });
    const tools = facts.filter((f) => f.kind === 'tool');
    expect(tools).toHaveLength(2);
    expect(tools[0]).toMatchObject({ toolName: 'Read', toolUseId: 'call-1' }); // 映射表内 → Claude 风格名
    expect(tools[1]).toMatchObject({ toolName: 'mcp__custom__tool' }); // 映射表外原样传(D13)
    expect(facts.some((f) => f.kind === 'turn_end')).toBe(true);
  });

  it('A2: incremental read from offset yields only newly appended frames', async () => {
    const sid = 'session-a2-0000-4000-8000-000000000002';
    const file = writeSession(sid, [frame([header(sid), userMessage(8, 1793100000200, '第一轮', 'u1')])]);
    const first = await readDeepSeekSessionFacts(file, 0);
    expect(first.facts.filter((f) => f.kind === 'prompt')).toHaveLength(1);

    fs.appendFileSync(file, frame([userMessage(9, 1793100001200, '第二轮', 'u2')]));
    const second = await readDeepSeekSessionFacts(file, first.consumedBytes);
    const prompts = second.facts.filter((f) => f.kind === 'prompt');
    expect(prompts).toHaveLength(1);
    expect(prompts[0]).toMatchObject({ text: '第二轮' });
  });

  it('A3: subagent facts are attributed to the root session, head keeps own cwd, no title (D9)', async () => {
    const parent = 'session-a3p-0000-4000-8000-000000000003';
    const child = 'session-a3c-0000-4000-8000-000000000004';
    writeSession(parent, [frame([header(parent), userMessage(8, 1793100000200, '主会话', 'u1')])]);
    const childFile = writeSession(child, [
      frame([
        header(child, { cwd: `${PROJ}/sub`, parentSession: parent, origin: 'subagent' }),
        { type: 'session/title', seq: 2, time: 1793100000100, data: { title: '子会话标题', source: { kind: 'fallback' } } },
        toolCall(3, 1793100000300, 'call-c', 'write', '{}'),
        toolResult(4, 1793100000400, 'call-c'),
      ]),
    ]);

    const { facts } = await readDeepSeekSessionFacts(childFile, 0);

    // 全部事实归根主会话(K4/D13);会话头的 startCwd 取子会话自己的文件头
    for (const fact of facts) expect(fact.sessionId).toBe(parent);
    expect(facts.find((f) => f.kind === 'session_head')).toMatchObject({ startCwd: `${PROJ}/sub` });
    // D9:子会话文件里的标题行不产事实(标题只归主会话自己的文件),工具事实仍归 parent
    expect(facts.some((f) => f.kind === 'session_title')).toBe(false);
    expect(facts.find((f) => f.kind === 'tool')).toMatchObject({ sessionId: parent, toolName: 'Write' });
  });

  it('A4: seeded continuation session keeps its own id (K4: each resumed session is its own row)', async () => {
    const prev = 'session-a4p-0000-4000-8000-000000000005';
    const next = 'session-a4n-0000-4000-8000-000000000006';
    writeSession(prev, [frame([header(prev)])]);
    const nextFile = writeSession(next, [
      // 续接:带 parentSession 但 origin 不是 subagent(T-1 实测判定)
      frame([header(next, { parentSession: prev, origin: 'continuation', isSeeded: true }), userMessage(8, 1793100000200, '续接', 'u1')]),
    ]);

    const { facts } = await readDeepSeekSessionFacts(nextFile, 0);
    expect(facts.length).toBeGreaterThan(0);
    for (const fact of facts) expect(fact.sessionId).toBe(next);
  });

  it('A5: torn tail frame is left for next pass and read once completed (spec acceptance #3)', async () => {
    const sid = 'session-a5-0000-4000-8000-000000000007';
    const f1 = frame([header(sid)]);
    const f2 = frame([userMessage(8, 1793100000200, '被截断的这轮', 'u1')]);
    const file = writeSession(sid, [f1]);
    const torn = Buffer.concat([f1, f2]);
    fs.writeFileSync(file, torn.subarray(0, torn.length - 5)); // 尾帧砍掉几个字节

    const first = await readDeepSeekSessionFacts(file, 0);
    expect(first.facts).toHaveLength(1); // 只有会话头
    expect(first.consumedBytes).toBe(f1.length); // 不越过不完整帧
    expect(first.consumedBytes).toBeLessThan(fs.statSync(file).size);

    fs.writeFileSync(file, Buffer.concat([torn, frame([userMessage(9, 1793100001200, '补齐后', 'u2')])]));
    const second = await readDeepSeekSessionFacts(file, first.consumedBytes);
    const texts = second.facts.filter((f) => f.kind === 'prompt').map((f) => (f as { text: string }).text);
    expect(texts).toEqual(['被截断的这轮', '补齐后']);
  });

  it('A6: pending tool call after last boundary is held for next pass', async () => {
    const sid = 'session-a6-0000-4000-8000-000000000008';
    const f1 = frame([header(sid), userMessage(8, 1793100000200, '提问', 'u1')]);
    const callFrame = frame([toolCall(18, 1793100000300, 'call-h', 'read', '{}')]); // 只有调用没有结果
    const file = writeSession(sid, [f1, callFrame]);

    const first = await readDeepSeekSessionFacts(file, 0);
    expect(first.facts.filter((f) => f.kind === 'tool')).toHaveLength(0);
    expect(first.consumedBytes).toBe(f1.length); // 收回到挂起调用所在帧的帧头之前

    fs.appendFileSync(file, frame([toolResult(20, 1793100000400, 'call-h')]));
    const second = await readDeepSeekSessionFacts(file, first.consumedBytes);
    expect(second.facts.filter((f) => f.kind === 'tool')).toHaveLength(1);
  });

  it('A7: DSH_HOME is the .dsh directory itself, as DeepSeek defines it (agents/sources)', () => {
    const deepseek = listSessionSources().find((s) => s.id === 'deepseek');
    expect(deepseek).toBeDefined();
    const prev = process.env.DSH_HOME;
    try {
      process.env.DSH_HOME = path.join(root, 'dsh-home');
      expect(deepseek?.sessionsRoot()).toBe(path.join(root, 'dsh-home', 'sessions'));
      delete process.env.DSH_HOME;
      expect(deepseek?.sessionsRoot()).toBe(path.join(os.homedir(), '.dsh', 'sessions'));
    } finally {
      if (prev === undefined) delete process.env.DSH_HOME;
      else process.env.DSH_HOME = prev;
    }
  });

  it('A8: unknown line types are skipped without error', async () => {
    const sid = 'session-a8-0000-4000-8000-000000000009';
    const file = writeSession(sid, [
      frame([
        header(sid),
        { type: 'future/thing', seq: 99, time: 1793100000000, data: { whatever: true } },
        userMessage(8, 1793100000200, '你好', 'u1'),
      ]),
    ]);
    const { facts } = await readDeepSeekSessionFacts(file, 0);
    expect(facts.map((f) => f.kind).sort()).toEqual(['prompt', 'session_head']);
  });
});
