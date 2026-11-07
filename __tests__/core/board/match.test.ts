/**
 * 认任务匹配测试(2026-11-06-agent看板 单元测试规格 C1–C13;spec K8–K11、D14、验收 6)。
 *
 * matchSessionsToTasks 是纯函数:输入全部内联构造,不碰文件系统。
 */

import { describe, expect, it } from 'vitest';

import { createDirLabeler, matchSessionsToTasks } from '../../../src/core/board/match';
import {
  REASON_COMMIT_BRANCH,
  REASON_COMMIT_FILES,
  REASON_FLOW_COMMAND,
  REASON_PROMPT_PATH,
  REASON_PROMPT_TITLE,
  REASON_READ_FEATURE,
  REASON_REPLICA_CWD,
  REASON_WROTE_FEATURE,
} from '../../../src/core/board/constants';
import { createRootMatcher } from '../../../src/core/root-match';
import type { BoardTimelineData } from '../../../src/core/timeline';
import type { ReplicaRef, TaskMatchInput } from '../../../src/core/board/types';

const MAIN = '/tmp/board-main';
const REPLICA = '/tmp/board-main@订单导出';
const TASK = { featureId: '2026-11-06-订单导出', title: '订单导出' };
const OTHER = { featureId: '2026-10-27-积分发放', title: '积分发放' };
const REPLICA_REF: ReplicaRef = { name: 'board-main@订单导出', path: REPLICA, featureId: TASK.featureId, branch: 'feat/订单导出', removedAt: null };

function dataOf(parts: Partial<BoardTimelineData>): BoardTimelineData {
  return { sessions: [], prompts: [], commits: [], tools: [], titles: [], ...parts };
}

function inputOf(data: BoardTimelineData, tasks = [TASK], replicas: readonly ReplicaRef[] = [REPLICA_REF]): TaskMatchInput {
  return {
    data,
    tasks,
    replicas,
    rootsMatcher: createRootMatcher([MAIN, ...replicas.map((r) => r.path)]),
    mainDirs: [MAIN],
  };
}

const head = (id: string, startCwd = MAIN, ts = '2026-11-06T08:00:00.000Z') => ({ id, agent: 'claude-code', startCwd, ts });

describe.skipIf(process.platform === 'win32')('matchSessionsToTasks (spec K8–K11, D14)', () => {
  it('C1: K9① start cwd inside the feature replica (removed ones count) → fixed with replica reason, whole session window', () => {
    const out = matchSessionsToTasks(inputOf(dataOf({ sessions: [head('s1', REPLICA)] })));
    const hits = out.byTask.get(TASK.featureId) ?? [];
    expect(hits).toHaveLength(1);
    expect(hits[0]).toMatchObject({ sessionId: 's1', fixed: true, reasons: [REASON_REPLICA_CWD] });
    expect(hits[0]?.from).toBe('2026-11-06T08:00:00.000Z'); // K9① 一律整个会话

    const removed = matchSessionsToTasks(inputOf(dataOf({ sessions: [head('s1', REPLICA)] }), [TASK], [{ ...REPLICA_REF, removedAt: '2026-11-05T00:00:00.000Z' }]));
    expect(removed.byTask.get(TASK.featureId)).toHaveLength(1); // 已删副本也算(K8/K9①)
  });

  it('C2: K9② commit on the feature branch → fixed', () => {
    const out = matchSessionsToTasks(inputOf(dataOf({
      sessions: [head('s1')],
      commits: [{ ts: '2026-11-06T09:00:00.000Z', sessionId: 's1', files: [], branch: 'feat/订单导出' }],
    })));
    expect(out.byTask.get(TASK.featureId)?.[0]).toMatchObject({ fixed: true, reasons: [REASON_COMMIT_BRANCH] });
  });

  it('C3: K9③ commit touching docs/features/<id>/ → fixed', () => {
    const out = matchSessionsToTasks(inputOf(dataOf({
      sessions: [head('s1')],
      commits: [{ ts: '2026-11-06T09:00:00.000Z', sessionId: 's1', files: [`docs/features/${TASK.featureId}/订单导出-spec.md`], branch: null }],
    })));
    expect(out.byTask.get(TASK.featureId)?.[0]).toMatchObject({ fixed: true, reasons: [REASON_COMMIT_FILES] });
  });

  it('C4: K9④ write-tool filePath inside the feature dir → fixed (spec K9 example: wrote 订单导出-spec.md)', () => {
    const out = matchSessionsToTasks(inputOf(dataOf({
      sessions: [head('s1')],
      tools: [{ ts: '2026-11-06T09:00:00.000Z', sessionId: 's1', tool: 'Write', filePath: `/work/docs/features/${TASK.featureId}/订单导出-spec.md`, args: null }],
    })));
    expect(out.byTask.get(TASK.featureId)?.[0]).toMatchObject({ fixed: true, reasons: [REASON_WROTE_FEATURE] });
  });

  it('C5: K9⑤ flow command with the feature title in args (/dev-merge 订单导出), or Skill args mentioning it → fixed', () => {
    const byPrompt = matchSessionsToTasks(inputOf(dataOf({
      sessions: [head('s1')],
      prompts: [{ ts: '2026-11-06T09:00:00.000Z', sessionId: 's1', text: '/dev-merge 订单导出' }],
    })));
    expect(byPrompt.byTask.get(TASK.featureId)?.[0]?.reasons).toContain(REASON_FLOW_COMMAND);

    const bySkill = matchSessionsToTasks(inputOf(dataOf({
      sessions: [head('s1')],
      tools: [{ ts: '2026-11-06T09:00:00.000Z', sessionId: 's1', tool: 'Skill', filePath: null, args: '按订单导出 的 spec 写计划' }],
    })));
    expect(bySkill.byTask.get(TASK.featureId)?.[0]?.reasons).toContain(REASON_FLOW_COMMAND);
  });

  it('C6: K9⑥ prompt mentioning docs/features/<id>/ path → fixed (spec K9 example: 按 docs/features/.../订单导出-spec.md 写计划)', () => {
    const out = matchSessionsToTasks(inputOf(dataOf({
      sessions: [head('s1')],
      prompts: [{ ts: '2026-11-06T09:00:00.000Z', sessionId: 's1', text: `按 docs/features/${TASK.featureId}/订单导出-spec.md 写计划` }],
    })));
    expect(out.byTask.get(TASK.featureId)?.[0]).toMatchObject({ fixed: true, reasons: [REASON_PROMPT_PATH] });
  });

  it('C7: K10 maybe — read the feature dir, or mention the title (>= 4 chars) in a message; without any fixed hit', () => {
    const byRead = matchSessionsToTasks(inputOf(dataOf({
      sessions: [head('s1')],
      tools: [{ ts: '2026-11-06T09:00:00.000Z', sessionId: 's1', tool: 'Read', filePath: `/work/docs/features/${TASK.featureId}/订单导出-spec.md`, args: null }],
    })));
    expect(byRead.byTask.get(TASK.featureId)?.[0]).toMatchObject({ fixed: false, reasons: [REASON_READ_FEATURE] });

    const byMention = matchSessionsToTasks(inputOf(dataOf({
      sessions: [head('s1')],
      prompts: [{ ts: '2026-11-06T09:00:00.000Z', sessionId: 's1', text: '参考订单导出的做法' }],
    })));
    expect(byMention.byTask.get(TASK.featureId)?.[0]).toMatchObject({ fixed: false, reasons: [REASON_PROMPT_TITLE] });
  });

  it('C8: K8 — sessions under the project dirs (and subdirs) participate; parent dir does not; replicas count', () => {
    const data = dataOf({
      sessions: [
        head('s-in', MAIN),
        head('s-sub', `${MAIN}/.claude/worktrees/a`),
        head('s-parent', '/tmp'),
        head('s-replica', REPLICA),
      ],
    });
    const out = matchSessionsToTasks(inputOf(data));
    for (const id of ['s-in', 's-sub', 's-replica']) expect(out.sessions.has(id)).toBe(true);
    expect(out.sessions.has('s-parent')).toBe(false); // 上级目录开的会话不参与(K8「不算」)
  });

  it('C9: one session matching several features is attached to each (spec K9)', () => {
    const out = matchSessionsToTasks(inputOf(dataOf({
      sessions: [head('s1')],
      prompts: [
        { ts: '2026-11-05T08:00:00.000Z', sessionId: 's1', text: `改 docs/features/${TASK.featureId}/a.md` },
        { ts: '2026-11-07T08:00:00.000Z', sessionId: 's1', text: `改 docs/features/${OTHER.featureId}/b.md` },
      ],
    }), [TASK, OTHER]));
    expect(out.byTask.get(TASK.featureId)).toHaveLength(1);
    expect(out.byTask.get(OTHER.featureId)).toHaveLength(1);
  });

  it('C10: K10 — a 3-char title mentioned in a message does not count as maybe (spec K10 「不算」)', () => {
    const short = { featureId: '2026-10-01-改密', title: '改密码' }; // 3 个字
    const out = matchSessionsToTasks(inputOf(dataOf({
      sessions: [head('s1')],
      prompts: [{ ts: '2026-11-06T09:00:00.000Z', sessionId: 's1', text: '参考改密码的做法' }],
    }), [short], []));
    expect(out.byTask.get(short.featureId)).toBeUndefined();
    expect(out.unmatched).toContain('s1');
  });

  it('C11: K11 — a feature path appearing only in a Bash command line does not attach the session', () => {
    const out = matchSessionsToTasks(inputOf(dataOf({
      sessions: [head('s1')],
      // C-5 的查询根本不取 Bash 事件;这里直接模拟一条混进来的 Bash 事件,断言它不产生任何挂靠
      tools: [{ ts: '2026-11-06T09:00:00.000Z', sessionId: 's1', tool: 'Bash', filePath: null, args: `ls docs/features/${TASK.featureId}/` }],
    })));
    expect(out.byTask.get(TASK.featureId)).toBeUndefined();
    expect(out.unmatched).toContain('s1');
  });

  it('C12: sessions whose start cwd is a Windows path never participate (spec acceptance #6)', () => {
    const out = matchSessionsToTasks(inputOf(dataOf({
      sessions: [head('s-win', 'D:\\objects\\java\\some-service')],
      prompts: [{ ts: '2026-11-06T09:00:00.000Z', sessionId: 's-win', text: `改 docs/features/${TASK.featureId}/a.md` }],
    })));
    expect(out.sessions.size).toBe(0);
    expect(out.byTask.size).toBe(0);
  });

  it('C13: titles with - or _ are compared verbatim, no normalization (spec D14)', () => {
    const dashed = { featureId: '2026-10-27-order_export', title: 'order_export-v2' };
    const hit = matchSessionsToTasks(inputOf(dataOf({
      sessions: [head('s1')],
      prompts: [{ ts: '2026-11-06T09:00:00.000Z', sessionId: 's1', text: '继续做 order_export-v2 的后端' }],
    }), [dashed], []));
    expect(hit.byTask.get(dashed.featureId)).toBeDefined();
    const miss = matchSessionsToTasks(inputOf(dataOf({
      sessions: [head('s1')],
      prompts: [{ ts: '2026-11-06T09:00:00.000Z', sessionId: 's1', text: '继续做 order export v2 的后端' }], // 空格变体不算
    }), [dashed], []));
    expect(miss.byTask.get(dashed.featureId)).toBeUndefined();
  });

  it('K6: multi-task session windows use per-task hit range; replica-based hit uses the whole session', () => {
    const out = matchSessionsToTasks(inputOf(dataOf({
      sessions: [head('s1', MAIN, '2026-11-01T00:00:00.000Z')],
      prompts: [
        { ts: '2026-11-01T00:00:00.000Z', sessionId: 's1', text: `改 docs/features/${TASK.featureId}/a.md` },
        { ts: '2026-11-09T00:00:00.000Z', sessionId: 's1', text: `改 docs/features/${OTHER.featureId}/b.md` },
      ],
    }), [TASK, OTHER]));
    expect(out.byTask.get(TASK.featureId)?.[0]).toMatchObject({ from: '2026-11-01T00:00:00.000Z', to: '2026-11-01T00:00:00.000Z' }); // 只算命中区间
    expect(out.byTask.get(OTHER.featureId)?.[0]).toMatchObject({ from: '2026-11-09T00:00:00.000Z', to: '2026-11-09T00:00:00.000Z' });

    // 同一会话在副本里开:副本依据一律整个会话(K6),且只挂这一个任务时窗口也是整个会话
    const single = matchSessionsToTasks(inputOf(dataOf({
      sessions: [head('s1', REPLICA, '2026-11-01T00:00:00.000Z')],
      prompts: [{ ts: '2026-11-05T00:00:00.000Z', sessionId: 's1', text: '干活' }],
    })));
    expect(single.byTask.get(TASK.featureId)?.[0]).toMatchObject({ from: '2026-11-01T00:00:00.000Z', to: '2026-11-05T00:00:00.000Z' });
  });
});

describe.skipIf(process.platform === 'win32')('createDirLabeler (plan C-11)', () => {
  it('D12: replica → 副本 <name>, main dir → 主目录 <project>, otherwise basename', () => {
    const label = createDirLabeler([REPLICA_REF], [MAIN], 'board-main');
    expect(label(REPLICA)).toBe('副本 board-main@订单导出');
    expect(label(`${MAIN}/sub`)).toBe('主目录 board-main');
    expect(label('/tmp/elsewhere')).toBe('elsewhere');
  });
});

