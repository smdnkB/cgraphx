/**
 * 任务详情(spec §5.5)。
 *
 * 关联只以需求目录主 spec 头部的 `> 任务:` 声明为准,实时扫描派生,不另外存储。
 * 事件归属按 spec §3.2 在查询时派生:事件落在某条绑定段的 [bound_at, unbound_at) 区间内;
 * 段以 bindingKey 区分(派生段共享 id = 0)。
 */

import { scanFeatureTasks } from '../features';
import type { TimelineEvent } from '../timeline';
import { queryBindingEvents } from './attribution';
import { TaskArgError } from './errors';
import { listEffectiveBindings } from './report';
import { findTask } from './resolve';
import { openTaskDb } from './schema-bootstrap';
import { TaskStore } from './store';
import type { TaskDetail } from './types';

/** `task show --events` 默认明细条数。 */
const DEFAULT_DETAIL_EVENT_LIMIT = 100;

/**
 * 任务详情:任务本身、声明了它的需求目录、生效绑定过的会话,
 * 以及按绑定区间派生的归属事件(commit、按类型计数、可选明细)。
 *
 * @throws TaskArgError 本地没有该任务。
 */
export async function getTaskDetail(
  projectRoot: string,
  taskId: number,
  opts: { events?: boolean; limit?: number } = {},
): Promise<TaskDetail> {
  let detail: Pick<TaskDetail, 'task' | 'featureDirs'>;
  const conn = openTaskDb(projectRoot);
  try {
    const store = new TaskStore(conn.getDb());
    const task = store.getTaskById(taskId);
    if (!task) throw new TaskArgError(`找不到本地任务 ${taskId};用 cgraphx task list 查看可用任务`);
    // 目录任务的产出目录就是它自己的 feature-id;其它任务按头部声明反查。
    const featureDirs =
      task.source === 'feature' && task.featureId !== null
        ? [`docs/features/${task.featureId}`]
        : scanFeatureTasks(projectRoot)
            .filter((e) => findTask(store, e.task)?.id === taskId)
            .map((e) => e.path);
    detail = { task, featureDirs };
  } finally {
    conn.close();
  }

  const sessions = listEffectiveBindings(projectRoot)
    .filter((entry) => entry.binding.taskId === taskId)
    .map(({ bindingKey, binding }) => ({ bindingKey, binding }));

  // 每条绑定区间单独查询(左闭右开在 queryBindingEvents 内处理),按 id 去重合并
  const byId = new Map<number, TimelineEvent>();
  for (const { binding } of sessions) {
    const { events } = await queryBindingEvents(projectRoot, binding);
    for (const e of events) byId.set(e.id, e);
  }
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
