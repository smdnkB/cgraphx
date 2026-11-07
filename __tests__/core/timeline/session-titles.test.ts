/**
 * 会话标题链路测试(2026-11-06-agent看板 单元测试规格 B2–B8;spec D8、D9、验收 5)。
 *
 * upsert 语义直接在库上断言;回填与改名走真实 ensureTimelineUpToDate(临时 HOME + 手写会话文件)。
 */

import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { ensureDataDirAtRoot } from '../../../src/core/data-location';
import { DatabaseConnection, DATABASE_FILENAME } from '../../../src/core/db';
import { readClaudeSessionFacts } from '../../../src/core/timeline/ingest/claude-transcript';
import { readCodebuddySessionFacts } from '../../../src/core/timeline/ingest/codebuddy-transcript';
import { ensureTimelineSchema, ensureTimelineUpToDate } from '../../../src/core/timeline';
import { upsertSessionTitle } from '../../../src/core/timeline/store';
import { TIMELINE_SCHEMA_VERSION } from '../../../src/core/timeline/constants';

const EPOCH = '1970-01-01T00:00:00.000Z';

describe('upsertSessionTitle priority (spec D8: custom > ai > agent, same-kind newer wins)', () => {
  let file: string;
  let conn: DatabaseConnection;

  beforeEach(() => {
    file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'cgx-title-')), 't.db');
    conn = DatabaseConnection.open(file);
    ensureTimelineSchema(conn.getDb());
  });
  afterEach(() => {
    conn.close();
    fs.rmSync(path.dirname(file), { recursive: true, force: true });
  });

  const row = (title: string, kind: 'custom' | 'ai' | 'agent', ts: string) => ({ sessionId: 's1', title, kind, ts });
  const current = (): { title: string; kind: string; ts: string } => {
    const r = conn.getDb().prepare('SELECT title, kind, ts FROM timeline_session_titles WHERE session_id = ?').get('s1') as { title: string; kind: string; ts: string };
    return r;
  };

  it('B2: custom beats ai beats agent regardless of ts; same kind newer ts wins, older loses', () => {
    upsertSessionTitle(conn.getDb(), row('auto', 'agent', '2026-11-06T00:00:00.000Z'));
    upsertSessionTitle(conn.getDb(), row('ai1', 'ai', '2026-11-05T00:00:00.000Z')); // rank 高,ts 旧也盖
    expect(current().title).toBe('ai1');
    upsertSessionTitle(conn.getDb(), row('user-named', 'custom', '2026-11-01T00:00:00.000Z'));
    expect(current().title).toBe('user-named'); // custom 最旧也压 ai(spec:用户起的永远不被自动起的盖掉)
    upsertSessionTitle(conn.getDb(), row('renamed', 'custom', '2026-11-07T00:00:00.000Z'));
    expect(current().title).toBe('renamed');
    upsertSessionTitle(conn.getDb(), row('stale', 'custom', '2026-11-02T00:00:00.000Z'));
    expect(current().title).toBe('renamed'); // 同级旧 ts 不回退
  });

  it('B8 (upsert level): unknown-ts title (incremental rename) overwrites same kind; known ts beats unknown', () => {
    upsertSessionTitle(conn.getDb(), row('old', 'custom', '2026-11-01T00:00:00.000Z'));
    upsertSessionTitle(conn.getDb(), row('renamed', 'custom', EPOCH)); // 增量趟窗口内无带时间行 → 哨兵
    expect(current().title).toBe('renamed');
    upsertSessionTitle(conn.getDb(), row('final', 'custom', '2026-11-06T00:00:00.000Z'));
    expect(current().title).toBe('final');
    // 未知 ts 的 ai 不盖 custom(优先级不变)
    upsertSessionTitle(conn.getDb(), { sessionId: 's2', title: 'c2', kind: 'custom', ts: '2026-11-05T00:00:00.000Z' });
    upsertSessionTitle(conn.getDb(), { sessionId: 's2', title: 'a2', kind: 'ai', ts: EPOCH });
    const s2 = conn.getDb().prepare('SELECT title FROM timeline_session_titles WHERE session_id = ?').get('s2') as { title: string };
    expect(s2.title).toBe('c2');
  });

  it('B6: applying the schema twice is idempotent and the schema version stays put (spec D8 migration note)', () => {
    ensureTimelineSchema(conn.getDb());
    ensureTimelineSchema(conn.getDb());
    const v = conn.getDb().prepare('SELECT MAX(version) AS v FROM timeline_schema_versions').get() as { v: number };
    expect(v.v).toBe(TIMELINE_SCHEMA_VERSION);
    expect(conn.getDb().prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE name = 'timeline_session_titles'").get()).toMatchObject({ n: 1 });
  });
});

describe.skipIf(process.platform === 'win32')('title facts and backfill through ingestion (spec D8, D9)', () => {
  let root: string;
  let dataDir: string;
  let sessionsDir: string;

  /** 一行 claude 会话(user 行带时间戳,标题行不带——与真实布局一致)。 */
  const userLine = (text: string) => `${JSON.stringify({
    type: 'user', sessionId: 'cc1', cwd: root, timestamp: '2026-11-06T08:00:00.000Z', uuid: `u-${text}`,
    message: { role: 'user', content: text },
  })}\n`;
  const titleLine = (kind: 'custom' | 'ai', title: string) =>
    `${JSON.stringify(kind === 'custom' ? { type: 'custom-title', customTitle: title, sessionId: 'cc1' } : { type: 'ai-title', aiTitle: title, sessionId: 'cc1' })}\n`;

  /** 一行 codebuddy 会话(实测布局:message 行 + message.content)。 */
  const cbLine = (text: string) => `${JSON.stringify({
    type: 'message', role: 'user', sessionId: 'cb1', cwd: root, timestamp: 1793100000000, id: 'cbu1',
    message: { role: 'user', content: text },
  })}\n`;

  beforeEach(() => {
    fs.rmSync(path.join(os.homedir(), '.cgraphx'), { recursive: true, force: true });
    sessionsDir = path.join(os.homedir(), '.claude', 'projects', '-t');
    fs.rmSync(path.dirname(sessionsDir), { recursive: true, force: true });
    fs.mkdirSync(sessionsDir, { recursive: true });
    root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'cgx-title-e2e-')));
    execFileSync('git', ['init', '-q'], { cwd: root });
    fs.mkdirSync(path.join(root, '.cgraphx'));
    DatabaseConnection.open(path.join(root, '.cgraphx', DATABASE_FILENAME)).close();
    dataDir = ensureDataDirAtRoot(root) ?? '';
    expect(dataDir).not.toBe('');
  });
  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  function seedRebuilt(): void {
    const conn = DatabaseConnection.open(path.join(dataDir, DATABASE_FILENAME));
    const db = conn.getDb();
    ensureTimelineSchema(db);
    db.prepare('INSERT INTO timeline_roots (root, first_ts, last_ts) VALUES (?, ?, ?)').run(root, '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z');
    db.prepare('INSERT INTO timeline_meta (key, value) VALUES (?, ?)').run('rebuilt_at', '2026-01-01T00:00:00.000Z');
    conn.close();
  }

  function titles(): Array<{ session_id: string; title: string; kind: string }> {
    const conn = DatabaseConnection.open(path.join(dataDir, DATABASE_FILENAME));
    const rows = conn.getDb().prepare('SELECT session_id, title, kind FROM timeline_session_titles').all() as Array<{ session_id: string; title: string; kind: string }>;
    conn.close();
    return rows;
  }

  function eventCount(): number {
    const conn = DatabaseConnection.open(path.join(dataDir, DATABASE_FILENAME));
    const n = (conn.getDb().prepare('SELECT COUNT(*) AS n FROM timeline_events').get() as { n: number }).n;
    conn.close();
    return n;
  }

  it('B3: claude title lines produce SessionTitleFact with ts from the preceding timestamped line; codebuddy produces none', async () => {
    const claudeFile = path.join(sessionsDir, 'cc1.jsonl');
    fs.writeFileSync(claudeFile, userLine('你好') + titleLine('ai', '自动标题') + titleLine('custom', '用户改名'));
    const facts = (await readClaudeSessionFacts(claudeFile, 0)).facts;
    const titleFacts = facts.filter((f) => f.kind === 'session_title');
    expect(titleFacts.map((f) => (f as { title: string }).title)).toEqual(['自动标题', '用户改名']);
    for (const fact of titleFacts) expect(fact.ts).toBe('2026-11-06T08:00:00.000Z'); // 前面最近一条带时间行(D8)

    const cbFile = path.join(sessionsDir, 'cb1.jsonl');
    fs.writeFileSync(cbFile, cbLine('你好'));
    const cbFacts = await readCodebuddySessionFacts(cbFile, 0);
    expect(cbFacts.facts.some((f) => f.kind === 'session_title')).toBe(false); // CodeBuddy 没有标题(D8)
    expect(cbFacts.facts.some((f) => f.kind === 'prompt')).toBe(true); // 文件本身可解析,上一条不是空转
  });

  it('B4/B5: backfill writes titles once without touching events, marker prevents re-runs (spec D9, acceptance #5)', async () => {
    seedRebuilt();
    const claudeFile = path.join(sessionsDir, 'cc1.jsonl');
    fs.writeFileSync(claudeFile, userLine('你好') + titleLine('custom', '用户起的名字'));

    const first = await ensureTimelineUpToDate(root);
    expect(first.status).toBe('synced');
    expect(titles()).toEqual([{ session_id: 'cc1', title: '用户起的名字', kind: 'custom' }]);
    const eventsAfterFirst = eventCount();
    expect(eventsAfterFirst).toBeGreaterThan(0);

    // 第二趟:记号已写,不再重读;事件数不变(验收 5)
    const second = await ensureTimelineUpToDate(root);
    expect(second.status).toBe('synced');
    expect(second.notices).toEqual([]);
    expect(eventCount()).toBe(eventsAfterFirst);
    expect(titles()).toHaveLength(1);
  });

  it('B8 (e2e): a rename appended as the only new line takes effect on the incremental pass', async () => {
    seedRebuilt();
    const claudeFile = path.join(sessionsDir, 'cc1.jsonl');
    fs.writeFileSync(claudeFile, userLine('你好') + titleLine('custom', '旧名字'));
    await ensureTimelineUpToDate(root);
    expect(titles()[0]?.title).toBe('旧名字');

    // 用户在 Claude Code 里改名:新标题行是该趟窗口里唯一的行(行内不带时间戳)
    fs.appendFileSync(claudeFile, titleLine('custom', '新名字'));
    const outcome = await ensureTimelineUpToDate(root);

    expect(outcome.status).toBe('synced');
    expect(titles()[0]?.title).toBe('新名字'); // 修复前:ts=0 判负,改名永远不生效
  });
});
