/**
 * 只读来源接入补录的端到端测试(2026-11-06-agent看板 单元测试规格 A9、B1、B9;spec D12、D13、全局约束)。
 *
 * 走真实 ensureTimelineUpToDate:临时 HOME 下造假项目根 + 手造 DeepSeek 会话文件(zstdCompressSync 拼帧)。
 */

import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import * as zlib from 'node:zlib';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { ensureDataDirAtRoot } from '../../../src/core/data-location';
import { DatabaseConnection, DATABASE_FILENAME } from '../../../src/core/db';
import { openSessionIndex } from '../../../src/core/session-index';
import { listSessionSources } from '../../../src/core/agents';
import { ensureTimelineSchema, ensureTimelineUpToDate } from '../../../src/core/timeline';

function frame(lines: unknown[]): Buffer {
  return zlib.zstdCompressSync(Buffer.from(lines.map((l) => `${JSON.stringify(l)}\n`).join('')));
}

describe.skipIf(process.platform === 'win32')('DeepSeek read-only source through ingestion (spec D12, D13)', () => {
  let root: string;
  let dataDir: string;

  beforeEach(() => {
    fs.rmSync(path.join(os.homedir(), '.cgraphx'), { recursive: true, force: true });
    fs.rmSync(path.join(os.homedir(), '.dsh'), { recursive: true, force: true });
    root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'cgx-ds-ingest-')));
    execFileSync('git', ['init', '-q'], { cwd: root });
    fs.mkdirSync(path.join(root, '.cgraphx'));
    DatabaseConnection.open(path.join(root, '.cgraphx', DATABASE_FILENAME)).close(); // 装过的目录才建项目目录
    dataDir = ensureDataDirAtRoot(root) ?? '';
    expect(dataDir).not.toBe('');
  });

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  /** 项目库:记下当前根;rebuilt 为真时写记号,让补录直接走增量。 */
  function seedProjectDb(rebuilt: boolean): void {
    const conn = DatabaseConnection.open(path.join(dataDir, DATABASE_FILENAME));
    const db = conn.getDb();
    ensureTimelineSchema(db);
    db.prepare('INSERT INTO timeline_roots (root, first_ts, last_ts) VALUES (?, ?, ?)').run(
      root, '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z',
    );
    if (rebuilt) db.prepare('INSERT INTO timeline_meta (key, value) VALUES (?, ?)').run('rebuilt_at', '2026-01-01T00:00:00.000Z');
    conn.close();
  }

  /** 造一个 DeepSeek 会话文件:`~/.dsh/sessions/<group>/<sid>/session.v4.jsonl.zstd`。 */
  function writeDsSession(sid: string, frames: unknown[][], corruptTail?: string): string {
    const dir = path.join(os.homedir(), '.dsh', 'sessions', '-tmp-ds', sid);
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, 'session.v4.jsonl.zstd');
    const body = Buffer.concat(frames.map(frame));
    fs.writeFileSync(file, corruptTail === undefined ? body : Buffer.concat([body, Buffer.from(corruptTail)]));
    return file;
  }

  function events(): Array<{ event_type: string; agent: string | null; cwd: string; turn_id: string | null; session_id: string | null }> {
    const conn = DatabaseConnection.open(path.join(dataDir, DATABASE_FILENAME));
    const rows = conn.getDb()
      .prepare('SELECT event_type, agent, cwd, turn_id, session_id FROM timeline_events ORDER BY id')
      .all() as Array<{ event_type: string; agent: string | null; cwd: string; turn_id: string | null; session_id: string | null }>;
    conn.close();
    return rows;
  }

  function normalLines(sid: string): unknown[][] {
    return [[
      { type: 'session', version: 4, id: sid, createdAt: 1793100000000, cwd: root, isSeeded: false, delegationDepth: 0 },
      { type: 'user/message', seq: 8, time: 1793100000200, data: { content: [{ type: 'text', text: '你好' }], source: { kind: 'user' }, role: 'user', id: 'u1' }, surfaceOp: 'append' },
      { type: 'tool/call', seq: 18, time: 1793100000300, data: { turn: 1, step: 1, callId: 'c1', name: 'write', arguments: JSON.stringify({ file_path: `${root}/x.md` }) } },
      { type: 'tool/result', seq: 20, time: 1793100000400, data: { turn: 1, step: 1, message: { role: 'tool', toolCallId: 'c1', content: [{ type: 'text', text: 'ok' }] } } },
      { type: 'turn/end', seq: 21, time: 1793100000500, data: { turn: 1, reason: { kind: 'completed' } } },
    ]];
  }

  it('B1: deepseek sessions are ingested with agent=deepseek and correct event fields (spec D12)', async () => {
    seedProjectDb(true);
    writeDsSession('session-e2e-0000-4000-8000-000000000001', normalLines('session-e2e-0000-4000-8000-000000000001'));

    const outcome = await ensureTimelineUpToDate(root);

    expect(outcome.status).toBe('synced');
    const rows = events();
    expect(rows.map((r) => r.event_type)).toEqual(['session_start', 'user_prompt', 'post_tool_use', 'stop']);
    for (const row of rows) {
      expect(row.agent).toBe('deepseek');
      expect(row.session_id).toBe('session-e2e-0000-4000-8000-000000000001');
    }
    expect(rows[0]).toMatchObject({ cwd: root, turn_id: null });
    expect(rows[1]).toMatchObject({ turn_id: 'u1' });
    expect(rows[2]).toMatchObject({ cwd: root });
  });

  it('B9: a corrupt frame is isolated per file — notice shown, offset kept, later files still ingested (incremental)', async () => {
    seedProjectDb(true);
    // 好文件排序在前、坏文件(尾部拼了非 zstd 字节)排序在后:坏的不许挡住别的,也不许让整趟 failed
    const goodSid = 'session-good-0000-4000-8000-000000000002';
    writeDsSession(goodSid, normalLines(goodSid));
    const badFile = writeDsSession('session-zzzz-0000-4000-8000-000000000003', normalLines('session-zzzz-0000-4000-8000-000000000003'), 'not-zstd-at-all');

    const outcome = await ensureTimelineUpToDate(root);

    expect(outcome.status).toBe('synced'); // 不再 failed
    expect(outcome.notices.join('\n')).toContain('读取失败');
    expect(outcome.notices.join('\n')).toContain('DeepSeek');
    // 好文件的事件照常入库
    expect(events().some((r) => r.session_id === goodSid && r.event_type === 'user_prompt')).toBe(true);
    // 坏文件偏移没推进(下一趟重试),进度行也没记成已完成
    const index = openSessionIndex();
    expect(index.getSessionFile(badFile)?.byte_offset ?? 0).toBe(0);
    index.close();
  });

  it('B9 (rebuild path): one corrupt file no longer kills the whole rebuild', async () => {
    seedProjectDb(false); // 没有 rebuilt_at → 走全量重建
    const goodSid = 'session-rgood-0000-4000-8000-000000000004';
    writeDsSession(goodSid, normalLines(goodSid));
    writeDsSession('session-rzzzz-0000-4000-8000-000000000005', normalLines('session-rzzzz-0000-4000-8000-000000000005'), 'not-zstd-at-all');

    const outcome = await ensureTimelineUpToDate(root);

    expect(outcome.status).toBe('rebuilt'); // 修复前:failed,时间线整体卡死
    expect(outcome.notices.join('\n')).toContain('读取失败');
    expect(events().some((r) => r.session_id === goodSid)).toBe(true);
  });

  it('A9a: deepseek source reports available on this Node runtime', () => {
    const deepseek = listSessionSources().find((s) => s.id === 'deepseek');
    expect(deepseek?.unavailableReason()).toBeNull();
  });

  // A9b:Node 没有 zstdDecompressSync 时的「要 Node 22.15 以上」提示无法在本运行时模拟
  //(内置模块命名空间不可改写、仓库规范禁 vi.mock);留待提供可注入的可用性探测后补。
  it.skip('A9b: missing zstd API surfaces the "Node 22.15+" notice', () => {
    // TODO: 可用性探测改为可注入后填实
  });
});
