/**
 * 2026-10-31 timeline 区分自动消息:
 *   - 判定:提问文本去掉开头空白后,`<task-notification>` / `<agent-message` 开头的
 *     记成 auto_message 并把来源写进 metadata.source;真实提问与 `<system-reminder>` 照旧
 *   - 自动消息照旧开新一轮(turn_id 照旧生成、写入 turn 状态文件,后续事件沿用)
 *   - 存量迁移:旧版本记成 user_prompt 的这类行改记为 auto_message,按 id 水位
 *     只扫新行(旧版全局 cgraphx 之后写进来的也能改到),不升 schema 版本号
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { Readable } from 'node:stream';

import { DatabaseConnection } from '../../../src/core/db';
import {
  ensureTimelineSchema,
  getCurrentTimelineSchemaVersion,
} from '../../../src/core/timeline/schema-bootstrap';
import { TimelineStore } from '../../../src/core/timeline/store';
import { classifyAutoMessage } from '../../../src/core/timeline/auto-message';
import { describeEvent } from '../../../src/core/timeline/describe';
import { userPromptHook, preToolUseHook } from '../../../src/core/timeline/hooks';
import type { TimelineEvent } from '../../../src/core/timeline/types';

// ─── Helpers ────────────────────────────────────────────────────────────────

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function makeTmpProject(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'cg-auto-msg-'));
}

/** 用合成 stdin payload 驱动 hook,与宿主调起方式一致(cwd 指向临时项目)。 */
async function runHookWithPayload(
  hook: () => Promise<void>,
  payload: Record<string, unknown>,
): Promise<void> {
  const originalStdin = process.stdin;
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
  }
}

/** 用新连接读全部事件(ts DESC);不经过待测连接,避免读到未提交内容。 */
function readAllRows(dbPath: string): TimelineEvent[] {
  const conn = DatabaseConnection.open(dbPath);
  try {
    return new TimelineStore(conn.getDb()).query({});
  } finally {
    conn.close();
  }
}

/** 读 <dir>/.cgraphx/turns/<会话>.json。 */
function readTurnFile(dir: string, sessionId: string): { turn_id?: string } | null {
  try {
    return JSON.parse(fs.readFileSync(path.join(dir, '.cgraphx', 'turns', `${sessionId}.json`), 'utf8'));
  } catch {
    return null;
  }
}

// ─── 判定 ───────────────────────────────────────────────────────────────────

describe('classifyAutoMessage', () => {
  it('去掉开头空白后以 <task-notification> 开头 → 后台任务通知', () => {
    expect(classifyAutoMessage('\n  <task-notification>\n<task-id>x</task-id>')).toBe('task_notification');
  });

  it('以 <agent-message 开头 → 子 agent 交回(标签带 from 属性)', () => {
    expect(classifyAutoMessage('<agent-message from="ab12">\n[Subagent hand-back] 结果')).toBe('agent_message');
  });

  it('真实提问与 <system-reminder> 开头的文本都不算自动消息', () => {
    expect(classifyAutoMessage('帮我查一下这个 bug')).toBeNull();
    expect(classifyAutoMessage('<system-reminder>\n提醒\n</system-reminder>\n\n真提问')).toBeNull();
    expect(classifyAutoMessage('   ')).toBeNull();
  });
});

// ─── hook 写入 ──────────────────────────────────────────────────────────────

describe('userPromptHook 区分自动消息', () => {
  let dir: string;
  let dbPath: string;
  let conn: DatabaseConnection;
  let realCwd: string;

  beforeEach(() => {
    dir = makeTmpProject();
    dbPath = path.join(dir, '.cgraphx', 'cgraphx.db');
    fs.mkdirSync(path.dirname(dbPath), { recursive: true });
    conn = DatabaseConnection.open(dbPath);
    ensureTimelineSchema(conn.getDb());
    realCwd = process.cwd();
  });

  afterEach(() => {
    process.chdir(realCwd);
    conn.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('后台任务通知记成 auto_message,来源写 metadata.source,照旧开新一轮', async () => {
    const sessionId = 'sess-task-note';
    await runHookWithPayload(userPromptHook, {
      session_id: sessionId,
      cwd: dir,
      prompt: '<task-notification>\n<task-id>t1</task-id>\n<status>completed</status>',
    });

    const turnFile = readTurnFile(dir, sessionId);
    expect(turnFile?.turn_id).toMatch(UUID_V4);

    await runHookWithPayload(preToolUseHook, {
      session_id: sessionId,
      cwd: dir,
      tool_name: 'Edit',
      tool_input: { file_path: 'src/a.ts' },
    });

    const rows = readAllRows(dbPath);
    expect(rows.some((r) => r.event_type === 'user_prompt')).toBe(false);
    const auto = rows.find((r) => r.event_type === 'auto_message');
    expect(auto).toBeDefined();
    expect(auto!.metadata).toEqual({ source: 'task_notification' });
    // 自动消息开的新一轮:后续工具事件沿用同一个 turn_id
    expect(auto!.turn_id).toBe(turnFile!.turn_id);
    expect(rows.find((r) => r.event_type === 'pre_tool_use')!.turn_id).toBe(turnFile!.turn_id);
  });

  it('子 agent 交回记成 auto_message,来源 agent_message', async () => {
    await runHookWithPayload(userPromptHook, {
      session_id: 'sess-agent-msg',
      cwd: dir,
      prompt: '<agent-message from="ab12">\n[Subagent hand-back] 报告正文',
    });

    const rows = readAllRows(dbPath);
    const auto = rows.find((r) => r.event_type === 'auto_message');
    expect(auto?.metadata).toEqual({ source: 'agent_message' });
  });

  it('普通提问仍是 user_prompt,不带 metadata.source', async () => {
    await runHookWithPayload(userPromptHook, {
      session_id: 'sess-real',
      cwd: dir,
      prompt: '把这个需求实现一下',
    });

    const rows = readAllRows(dbPath);
    const prompt = rows.find((r) => r.event_type === 'user_prompt');
    expect(prompt).toBeDefined();
    expect(prompt!.metadata).toEqual({});
    expect(rows.some((r) => r.event_type === 'auto_message')).toBe(false);
  });

});

describe('auto_message 的事件摘要', () => {
  it('沿用提问文本的截断展示', () => {
    expect(describeEvent({
      id: 1,
      ts: '2026-10-31T00:00:00.000Z',
      session_id: null,
      event_type: 'auto_message',
      tool_name: null,
      tool_args: null,
      tool_result_summary: null,
      prompt_text: '<task-notification> done',
      duration_ms: null,
      commit_hash: null,
      commit_message: null,
      commit_files: [],
      cwd: '/proj',
      metadata: { source: 'task_notification' },
      turn_id: null,
      commit_insertions: null,
      commit_deletions: null,
    })).toBe('<task-notification> done');
  });
});

// ─── 存量迁移 ───────────────────────────────────────────────────────────────

describe('存量自动消息迁移', () => {
  let dir: string;
  let dbPath: string;
  let conn: DatabaseConnection;

  beforeEach(() => {
    dir = makeTmpProject();
    dbPath = path.join(dir, '.cgraphx', 'cgraphx.db');
    fs.mkdirSync(path.dirname(dbPath), { recursive: true });
    conn = DatabaseConnection.open(dbPath);
    ensureTimelineSchema(conn.getDb());
  });

  afterEach(() => {
    conn.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  /** 模拟旧版本写进来的事件(直接按 user_prompt 落库)。 */
  function insertOldStyle(store: TimelineStore, prompt_text: string, metadata?: Record<string, unknown>): number {
    return store.insert({ event_type: 'user_prompt', prompt_text, metadata });
  }

  it('把旧的自动消息改记为 auto_message,保留原 metadata 的其它键;真实提问不动', () => {
    const store = new TimelineStore(conn.getDb());
    const taskId = insertOldStyle(store, '  <task-notification>\n<task-id>t1</task-id>');
    const agentId = insertOldStyle(store, '<agent-message from="a">\n报告', { tool: 'Agent' });
    const realId = insertOldStyle(store, '正经提问');
    const reminderId = insertOldStyle(store, '<system-reminder>\n提醒\n</system-reminder>\n\n真提问');

    ensureTimelineSchema(conn.getDb());

    expect(store.getById(taskId)!.event_type).toBe('auto_message');
    expect(store.getById(taskId)!.metadata).toEqual({ source: 'task_notification' });
    expect(store.getById(agentId)!.event_type).toBe('auto_message');
    expect(store.getById(agentId)!.metadata).toEqual({ tool: 'Agent', source: 'agent_message' });
    expect(store.getById(realId)!.event_type).toBe('user_prompt');
    expect(store.getById(reminderId)!.event_type).toBe('user_prompt');
    // 锁定取舍:不升 schema 版本号(升了旧版全局 cgraphx 打开库会报错)
    expect(getCurrentTimelineSchemaVersion(conn.getDb())).toBe(2);
  });

  it('按 id 水位往前扫:旧版本此后写进来的自动消息,下次打开库时也能改到', () => {
    const store = new TimelineStore(conn.getDb());
    const firstId = insertOldStyle(store, '<task-notification>\n第一条');
    ensureTimelineSchema(conn.getDb());
    expect(store.getById(firstId)!.event_type).toBe('auto_message');

    // 旧版全局 cgraphx 继续按旧分类写入
    const laterId = insertOldStyle(store, '<agent-message from="b">\n后写进来的');
    const realLaterId = insertOldStyle(store, '后写进来的真实提问');

    ensureTimelineSchema(conn.getDb());

    expect(store.getById(laterId)!.event_type).toBe('auto_message');
    expect(store.getById(laterId)!.metadata).toEqual({ source: 'agent_message' });
    expect(store.getById(realLaterId)!.event_type).toBe('user_prompt');
    // 已改过的行重复扫不会变回去
    expect(store.getById(firstId)!.event_type).toBe('auto_message');
  });

  it('旧版 --purge 删过 events 表(水位比表尾大)时从头重扫', () => {
    const store = new TimelineStore(conn.getDb());
    insertOldStyle(store, '<task-notification>\n第一条');
    ensureTimelineSchema(conn.getDb());

    // 旧版 purge 只删 events / versions 两张表,不认识 timeline_meta;重建后 id 从头开始
    conn.getDb().exec('DROP TABLE timeline_events');
    ensureTimelineSchema(conn.getDb());

    const fresh = new TimelineStore(conn.getDb());
    const newId = insertOldStyle(fresh, '<agent-message from="c">\npurge 后写进来的');
    ensureTimelineSchema(conn.getDb());

    expect(fresh.getById(newId)!.event_type).toBe('auto_message');
    expect(fresh.getById(newId)!.metadata).toEqual({ source: 'agent_message' });
  });

  it('其它事件类型不受影响', () => {
    const store = new TimelineStore(conn.getDb());
    store.insert({ event_type: 'pre_tool_use', tool_name: 'Edit', tool_args: { file_path: 'a.ts' } });
    const commitId = store.insert({
      event_type: 'git_commit',
      commit_hash: 'abc1234',
      commit_message: 'feat: <task-notification> in message',
    });

    ensureTimelineSchema(conn.getDb());

    expect(store.getById(commitId)!.event_type).toBe('git_commit');
    expect(store.query({ type: 'pre_tool_use' })).toHaveLength(1);
    expect(store.query({ type: 'auto_message' })).toHaveLength(0);
  });
});
