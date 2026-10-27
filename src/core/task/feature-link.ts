/**
 * 任务详情(spec §5.5)。
 *
 * 关联只以需求目录主 spec 头部的 `> 任务:` 声明为准,实时扫描派生,不另外存储。
 * 事件归属按 spec §3.2 在查询时派生:事件落在某条绑定段的 [bound_at, unbound_at) 区间内;
 * 段以 bindingKey 区分(派生段共享 id = 0)。
 * 以主目录为准(版本流程与需求副本 spec D25);副本里没对上会话的提交归副本登记的需求(D28)。
 */

import { listProjectRoots, replicaOfCwd, resolveMainRoot } from '../replica';
import { listCommitEvents, type TimelineEvent } from '../timeline';
import { queryBindingEvents } from './attribution';
import { TaskArgError } from './errors';
import { scanFeatureTasksAcrossRoots } from './feature-task';
import { listEffectiveBindings } from './report';
import { findTask } from './resolve';
import { openTaskDb } from './schema-bootstrap';
import { TaskStore } from './store';
import type { TaskDetail, TaskItem } from './types';

/** `task show --events` 默认明细条数。 */
const DEFAULT_DETAIL_EVENT_LIMIT = 100;

/**
 * 副本里没对上会话的提交(spec D28 本地部分):只有目录任务有;session_id 为空、提交时的 cwd
 * 落在登记了这个需求的副本里(含已删除的副本)。没有这样的副本时不查时间线。
 */
async function unmatchedReplicaCommits(root: string, task: TaskItem): Promise<TimelineEvent[]> {
  const featureId = task.source === 'feature' ? task.featureId : null;
  if (featureId === null) return [];
  const roots = listProjectRoots(root);
  if (!roots.some((r) => r.replica?.featureId === featureId)) return [];
  return (await listCommitEvents(root)).filter(
    (e) => e.session_id === null && replicaOfCwd(roots, e.cwd)?.featureId === featureId,
  );
}

/**
 * 任务详情:任务本身、声明了它的需求目录、生效绑定过的会话,
 * 以及按绑定区间派生的归属事件(commit、按类型计数、可选明细)。
 * 目录任务的归属事件另并上副本里没对上会话的提交。
 *
 * @throws TaskArgError 本地没有该任务。
 */
export async function getTaskDetail(
  projectRoot: string,
  taskId: number,
  opts: { events?: boolean; limit?: number } = {},
): Promise<TaskDetail> {
  const root = resolveMainRoot(projectRoot);
  let detail: Pick<TaskDetail, 'task' | 'featureDirs'>;
  const conn = openTaskDb(root);
  try {
    const store = new TaskStore(conn.getDb());
    const task = store.getTaskById(taskId);
    if (!task) throw new TaskArgError(`找不到本地任务 ${taskId};用 cgraphx task list 查看可用任务`);
    // 目录任务的产出目录就是它自己的 feature-id;其它任务按头部声明反查(主目录 + 在用副本)。
    const featureDirs =
      task.source === 'feature' && task.featureId !== null
        ? [`docs/features/${task.featureId}`]
        : scanFeatureTasksAcrossRoots(root)
            .filter((e) => findTask(store, e.task)?.id === taskId)
            .map((e) => e.path);
    detail = { task, featureDirs };
  } finally {
    conn.close();
  }

  const sessions = listEffectiveBindings(root)
    .filter((entry) => entry.binding.taskId === taskId)
    .map(({ bindingKey, binding }) => ({ bindingKey, binding }));

  // 每条绑定区间单独查询(左闭右开在 queryBindingEvents 内处理),按 id 去重合并
  const byId = new Map<number, TimelineEvent>();
  for (const { binding } of sessions) {
    const { events } = await queryBindingEvents(root, binding);
    for (const e of events) byId.set(e.id, e);
  }
  for (const e of await unmatchedReplicaCommits(root, detail.task)) byId.set(e.id, e);
  const attributed = [...byId.values()].sort((a, b) => a.ts.localeCompare(b.ts) || a.id - b.id);

  const eventCounts: Record<string, number> = {};
  for (const e of attributed) eventCounts[e.event_type] = (eventCounts[e.event_type] ?? 0) + 1;

  return {
    ...detail,
    sessions,
    commits: attributed.filter((e) => e.event_type === 'git_commit'),
    eventCounts,
    events: opts.events === true ? attributed.slice(0, opts.limit ?? DEFAULT_DETAIL_EVENT_LIMIT) : null,
  };
}
