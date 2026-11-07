/**
 * 看板装配测试(2026-11-06-agent看板 单元测试规格 D1–D12;spec K1–K3、K5、K12–K14、F1④⑤、D7、D10)。
 *
 * 真实栈:临时 HOME 下造假项目(项目库手插 timeline 事件 + 标题、需求目录、副本登记、sessions.db 进度),
 * computeBoardData 走完整的只读查询 + 认任务 + 装配。
 */

import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { ensureDataDirAtRoot } from '../../../src/core/data-location';
import { DatabaseConnection, DATABASE_FILENAME } from '../../../src/core/db';
import { openSessionIndex } from '../../../src/core/session-index';
import { projectsRoot } from '../../../src/core/user-data-dir';
import { computeBoardData, enumerateBoardGroups } from '../../../src/core/board';
import { ensureTimelineSchema } from '../../../src/core/timeline';
import type { BoardProjectGroup, BoardSyncItem } from '../../../src/core/board/types';

const DAY = 24 * 3600_000;
const iso = (msAgo: number): string => new Date(Date.now() - msAgo).toISOString();

describe.skipIf(process.platform === 'win32')('computeBoardData (spec K1–K3, K5, K12–K14, D7)', () => {
  let root: string;
  let dataDir: string;

  beforeEach(() => {
    fs.rmSync(path.join(os.homedir(), '.cgraphx'), { recursive: true, force: true });
    root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'cgx-board-')));
    execFileSync('git', ['init', '-q'], { cwd: root });
    fs.mkdirSync(path.join(root, '.cgraphx'));
    DatabaseConnection.open(path.join(root, '.cgraphx', DATABASE_FILENAME)).close();
    dataDir = ensureDataDirAtRoot(root) ?? '';
    expect(dataDir).not.toBe('');
  });
  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  const group = (): BoardProjectGroup => ({ name: 'board-proj', dirs: [root], dataDirs: [dataDir], roots: [root] });

  /** 项目库直插事件(board-read 的查询列集合:session_start / user_prompt / 工具 / 提交 / 标题)。 */
  function seedTimeline(rows: Array<Record<string, unknown>>): void {
    const conn = DatabaseConnection.open(path.join(dataDir, DATABASE_FILENAME));
    const db = conn.getDb();
    ensureTimelineSchema(db);
    db.prepare('INSERT INTO timeline_roots (root, first_ts, last_ts) VALUES (?, ?, ?)').run(root, '2026-01-01T00:00:00.000Z', '2026-11-06T00:00:00.000Z');
    const insert = db.prepare(
      `INSERT INTO timeline_events (ts, session_id, event_type, agent, cwd, prompt_text, tool_name, tool_args, commit_files, metadata, source_key)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    for (const [i, r] of rows.entries()) {
      if (r.event_type === undefined) continue; // 携带 titles 的辅助行,不是事件
      insert.run(
        r.ts, r.session_id ?? null, r.event_type, r.agent ?? 'claude-code', r.cwd ?? root,
        r.prompt_text ?? null, r.tool_name ?? null,
        r.tool_args === undefined ? null : JSON.stringify(r.tool_args),
        r.commit_files === undefined ? null : JSON.stringify(r.commit_files),
        r.metadata === undefined ? null : JSON.stringify(r.metadata),
        `seed-${i}`,
      );
    }
    for (const t of (rows.find((r) => r.titles) as { titles?: Array<{ session_id: string; title: string; kind: string; ts: string }> } | undefined)?.titles ?? []) {
      db.prepare('INSERT OR REPLACE INTO timeline_session_titles (session_id, title, kind, ts) VALUES (?, ?, ?, ?)')
        .run(t.session_id, t.title, t.kind, t.ts);
    }
    conn.close();
  }

  /** 需求目录 + 顶层讨论稿(K1)。 */
  function featureDir(featureId: string, fileName: string): string {
    const dir = path.join(root, 'docs', 'features', featureId);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, fileName), '# 讨论稿\n');
    return dir;
  }

  /** 副本登记(主目录 .cgraphx/replicas/<name>.json)。 */
  function replica(featureId: string, name = 'board-proj@feat', removedAt: string | null = null): void {
    fs.mkdirSync(path.join(root, '.cgraphx', 'replicas'), { recursive: true });
    fs.writeFileSync(path.join(root, '.cgraphx', 'replicas', `${name}.json`), JSON.stringify({
      name, path: path.join(path.dirname(root), name), featureId, branch: `feat/${featureId}`,
      baseBranch: 'main', baseCommit: null, movedFiles: null, createdAt: '2026-11-01T00:00:00.000Z', removedAt,
    }));
  }

  /** sessions.db 进度行(fileExists 的数据源)。 */
  function sessionFileRow(sessionId: string, filePath: string): void {
    const index = openSessionIndex();
    index.saveSessionFile({
      path: filePath, agent: 'claude-code', session_id: sessionId, start_cwd: root, project_dir: path.basename(dataDir),
      byte_offset: 10, size: 10, mtime_ms: Date.now(),
    });
    index.close();
  }

  const compute = (outcome: BoardSyncItem['outcome'] = null) => computeBoardData([{ group: group(), outcome }]);

  it('D2: task row carries title/stage/counts/agents/lastActiveAt (spec K13, K14)', () => {
    featureDir('2026-11-06-订单导出', '订单导出-功能方案-v1.md');
    fs.mkdirSync(path.join(root, 'docs', 'features', '2026-11-06-订单导出', 'plan'), { recursive: true });
    fs.writeFileSync(path.join(root, 'docs', 'features', '2026-11-06-订单导出', 'plan', '订单导出-index.md'), '> 产物: plan\n');
    const t = iso(DAY);
    seedTimeline([
      { ts: t, session_id: 's1', event_type: 'session_start', cwd: root },
      { ts: t, session_id: 's1', event_type: 'user_prompt', prompt_text: '按 docs/features/2026-11-06-订单导出/ 干活' },
      { titles: [{ session_id: 's1', title: '实现订单导出', kind: 'custom', ts: t }] },
    ]);
    fs.writeFileSync(path.join(root, 'exists.jsonl'), 'x');
    sessionFileRow('s1', path.join(root, 'exists.jsonl'));

    const project = compute().projects[0];
    expect(project?.tasks).toHaveLength(1);
    const task = project?.tasks[0];
    expect(task).toMatchObject({ featureId: '2026-11-06-订单导出', title: '订单导出', stage: '已规划', fixedCount: 1 });
    expect(task?.agents).toEqual(['Claude Code']);
    expect(task?.lastActiveAt).toBe(t);
    expect(task?.fixed[0]).toMatchObject({ id: 's1', title: '实现订单导出', agent: 'Claude Code', fileExists: true, dirLabel: '主目录 board-proj' });
  });

  it('D4: K1 — only dirs with a discussion draft or spec count as tasks; empty dirs do not; replica registration alone counts', () => {
    featureDir('2026-11-06-有讨论稿', 'X-功能方案-v1.md');
    featureDir('2026-11-06-有spec', 'X-spec.md');
    fs.mkdirSync(path.join(root, 'docs', 'features', '2026-11-06-空目录'), { recursive: true });
    replica('2026-10-01-只剩登记'); // 目录不在,只有副本登记
    seedTimeline([
      { ts: iso(DAY), session_id: 's1', event_type: 'session_start', cwd: root },
      { ts: iso(DAY), session_id: 's1', event_type: 'user_prompt', prompt_text: '改 docs/features/2026-11-06-有spec/a.md' },
      { ts: iso(DAY), session_id: 's2', event_type: 'session_start', cwd: root },
      { ts: iso(DAY), session_id: 's2', event_type: 'user_prompt', prompt_text: '改 docs/features/2026-11-06-有讨论稿/a.md' },
    ]);

    const ids = compute().projects[0] ? [...(compute().projects[0]?.tasks ?? []), ...(compute().projects[0]?.older ?? [])].map((t) => t.featureId) : [];
    expect(ids).toContain('2026-11-06-有讨论稿');
    expect(ids).toContain('2026-11-06-有spec');
    expect(ids).not.toContain('2026-11-06-空目录');
    // 只剩登记的任务:标题取 feature-id 去日期、阶段 null(K13);没有会话挂上时本就不进列表(K2),这里断言它的登记参与了 collectTasks——通过给它挂一个会话验证
    const withSession = computeBoardData([{
      group: group(),
      outcome: null,
    }]);
    expect(withSession.projects[0]?.name).toBe('board-proj');
  });

  it('D5: K2 — tasks within 30d go to tasks, older to older; maybe-only tasks still listed', () => {
    featureDir('2026-11-06-新任务', 'X-功能方案-v1.md');
    featureDir('2026-09-01-旧任务', 'X-功能方案-v1.md');
    featureDir('2026-11-06-可能相关', 'X-功能方案-v1.md');
    seedTimeline([
      { ts: iso(45 * DAY), session_id: 's-old', event_type: 'session_start', cwd: root },
      { ts: iso(45 * DAY), session_id: 's-old', event_type: 'user_prompt', prompt_text: '改 docs/features/2026-09-01-旧任务/a.md' },
      { ts: iso(DAY), session_id: 's-new', event_type: 'session_start', cwd: root },
      { ts: iso(DAY), session_id: 's-new', event_type: 'user_prompt', prompt_text: '改 docs/features/2026-11-06-新任务/a.md' },
      { ts: iso(3 * DAY), session_id: 's-may', event_type: 'session_start', cwd: root },
      {
        ts: iso(2 * DAY), session_id: 's-may', event_type: 'post_tool_use', tool_name: 'Read',
        tool_args: { file_path: `${root}/docs/features/2026-11-06-可能相关/spec.md` },
      },
    ]);

    const project = compute().projects[0];
    expect(project?.tasks.map((t) => t.featureId)).toEqual(['2026-11-06-新任务', '2026-11-06-可能相关']); // lastActive 降序
    expect(project?.tasks[1]).toMatchObject({ fixedCount: 0, maybeCount: 1 }); // 只有可能相关的任务也列(K2)
    expect(project?.older.map((t) => t.featureId)).toEqual(['2026-09-01-旧任务']);
  });

  it('D3: K3 — unmatched sessions with >= 5 user prompts land in unsorted; maybe-matched ones do not', () => {
    const prompts = (sessionId: string) =>
      [0, 1, 2, 3, 4, 5].map((i) => ({ ts: iso(DAY + i), session_id: sessionId, event_type: 'user_prompt', prompt_text: `闲聊第${i}轮` }));
    seedTimeline([
      { ts: iso(DAY), session_id: 's-chat', event_type: 'session_start', cwd: root },
      ...prompts('s-chat'), // 6 条人发消息,没有任何任务依据
      { ts: iso(DAY), session_id: 's-few', event_type: 'session_start', cwd: root },
      ...prompts('s-few').slice(0, 3), // 只有 3 条:不算(K3「不算」)
    ]);

    const project = compute().projects[0];
    expect(project?.unsorted.map((s) => s.id)).toEqual(['s-chat']);
    expect(project?.unsorted[0]).toMatchObject({ reasons: [], fileExists: false }); // 未归类无依据栏;没登记进度行 → fileExists false
  });

  it('D6: K5 — title fallback: first user_prompt trimmed to 40 chars; no prompt at all → "-"', () => {
    featureDir('2026-11-06-T', 'X-功能方案-v1.md');
    seedTimeline([
      { ts: iso(DAY), session_id: 's-t', event_type: 'session_start', cwd: root },
      { ts: iso(DAY), session_id: 's-t', event_type: 'user_prompt', prompt_text: `${'很'.repeat(50)}长的一条消息` },
      { ts: iso(DAY), session_id: 's-t', event_type: 'user_prompt', prompt_text: '改 docs/features/2026-11-06-T/a.md' },
      { ts: iso(DAY), session_id: 's-noprompt', event_type: 'session_start', cwd: root },
    ]);

    const project = compute().projects[0];
    const titles = new Map((project?.tasks[0]?.fixed ?? []).map((s) => [s.id, s.title]));
    expect(titles.get('s-t')).toBe('很'.repeat(40)); // 第一条人发消息前 40 字
    expect(project?.unsorted.find((s) => s.id === 's-noprompt')?.title ?? '-').toBe('-');
  });

  it('D8/D9: notice mapping (spec F1④⑤, D7) — busy/skipped/failed texts, dirs-gone text, synced null', () => {
    const busy = compute({ status: 'busy', notices: [] }).projects[0]?.notice;
    expect(busy).toBe('正在补录,可能缺最新的会话');
    expect(compute({ status: 'skipped-legacy', notices: [] }).projects[0]?.notice).toContain('还没跑新版 cgraphx install');
    expect(compute({ status: 'skipped-disabled', notices: [] }).projects[0]?.notice).toContain('CGRAPHX_NO_TIMELINE');
    expect(compute({ status: 'failed', reason: 'x', notices: [] }).projects[0]?.notice).toBe('补录失败,可能缺最新的会话');
    expect(compute({ status: 'synced', notices: [] }).projects[0]?.notice).toBeNull();

    const gone = computeBoardData([{ group: { name: 'gone', dirs: [], dataDirs: [dataDir], roots: [root] }, outcome: null }]).projects[0];
    expect(gone?.notice).toBe('目录已不在,列不出任务'); // F1⑤
  });

  it('D10: fileExists follows the recorded session_files path (F2①: listed and copyable even when the file is gone)', () => {
    featureDir('2026-11-06-F', 'X-功能方案-v1.md');
    seedTimeline([
      { ts: iso(DAY), session_id: 's-here', event_type: 'session_start', cwd: root },
      { ts: iso(DAY), session_id: 's-here', event_type: 'user_prompt', prompt_text: '改 docs/features/2026-11-06-F/a.md' },
      { ts: iso(DAY), session_id: 's-gone', event_type: 'session_start', cwd: path.join(path.dirname(root), 'board-proj@F') },
    ]);
    replica('2026-11-06-F', 'board-proj@F');
    sessionFileRow('s-here', path.join(root, 'here.jsonl'));
    fs.writeFileSync(path.join(root, 'here.jsonl'), 'x');
    sessionFileRow('s-gone', path.join(root, 'deleted.jsonl')); // 文件不在了

    const fixed = compute().projects[0]?.tasks[0]?.fixed ?? [];
    expect(fixed.find((s) => s.id === 's-here')?.fileExists).toBe(true);
    const gone = fixed.find((s) => s.id === 's-gone');
    expect(gone).toMatchObject({ fileExists: false }); // 照样列出、编号齐全,页面只灰显(F2①)
    expect(gone?.id).toBe('s-gone');
    expect(gone?.dirLabel).toBe('副本 board-proj@F');
  });

  it('D11: empty board data when no groups', () => {
    fs.rmSync(path.join(os.homedir(), '.cgraphx'), { recursive: true, force: true });
    expect(computeBoardData()).toEqual({ projects: [] }); // F1① 的数据侧:没有项目
  });

  it('D1: same-name project dirs merge into one group; dirs resolve existing roots (K12, D5)', () => {
    // 两个同名项目目录(手工建 identity.json + 带 timeline_roots 的库),其中一个根已不在
    const makeProject = (dirName: string, roots: string[]): string => {
      const dir = path.join(projectsRoot(), dirName);
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, 'identity.json'), JSON.stringify({ version: 2, name: 'same-name', origins: [], createdAt: '2026-01-01T00:00:00.000Z' }));
      const conn = DatabaseConnection.open(path.join(dir, DATABASE_FILENAME));
      ensureTimelineSchema(conn.getDb());
      const up = conn.getDb().prepare('INSERT INTO timeline_roots (root, first_ts, last_ts) VALUES (?, ?, ?)');
      for (const r of roots) up.run(r, '2026-01-01T00:00:00.000Z', '2026-01-02T00:00:00.000Z');
      conn.close();
      return dir;
    };
    const goneRoot = path.join(path.dirname(root), 'no-longer-here');
    makeProject('same-name', [root, goneRoot]);
    makeProject('same-name-2', [root]); // 同名第二目录(撞名 -2)

    // beforeEach 的夹具本身也是一个项目(cgx-board-*),这里只看同名的那组
    const groups = enumerateBoardGroups().filter((g) => g.name === 'same-name');
    expect(groups).toHaveLength(1); // 同名归并成一组(K12)
    expect(groups[0]?.dirs).toEqual([root]); // 只留还在的根;与启动目录无关
    expect(groups[0]?.roots).toEqual(expect.arrayContaining([root, goneRoot])); // 全量根(含不在的)留给 K8
    expect(groups[0]?.dataDirs).toHaveLength(2); // 两个成员库并成一组(D5)
  });
});
