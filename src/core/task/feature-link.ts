/**
 * 任务 ↔ 需求目录关联(spec §6)与任务详情(spec §5.5)。
 *
 * 关联只以需求目录主 spec 头部的 `> 任务:` 声明为准,实时扫描派生,不另外存储。
 * 事件归属按 spec §3.2 在查询时派生:事件落在某条绑定的 [bound_at, unbound_at) 区间内。
 */

import path from 'node:path';

import { readFeatureTask, scanFeatureTasks } from '../features';
import { isKillSwitchOn, queryEvents, type TimelineEvent } from '../timeline';
import { bindSessionCore } from './binding';
import { TaskArgError } from './errors';
import { findTask, resolveDeclaredTask } from './resolve';
import { openTaskDb } from './schema-bootstrap';
import { loadTaskSourceConfig } from './source';
import { TaskStore } from './store';
import type { AutoBindOutcome, TaskDetail, TaskItem } from './types';

/** 改动文件(相对项目根的 POSIX 路径)所在的需求目录。 */
const FEATURE_DIR_PATTERN = /^docs\/features\/([^/]+)\//;

/** 单条绑定区间内拉取事件的上限(timeline 查询硬上限)。 */
const EVENTS_PER_BINDING_LIMIT = 10_000;

/** `task show --events` 默认明细条数。 */
const DEFAULT_DETAIL_EVENT_LIMIT = 100;

/**
 * 写类工具改动文件后的需求目录自动绑定(spec §6.3)。不发网络请求。
 *
 *   - 文件不在 docs/features/<id>/ 下,或该需求目录主 spec 没声明任务 → none;
 *   - 会话未绑定 → 绑定到声明的任务 B(bind_source = feature_dir)→ bound;
 *   - 已绑定 B → none;
 *   - 已绑定其它任务 A → 不切换;同一会话内 (A, B) 首次出现时 remind,之后 none。
 *
 * CGRAPHX_NO_TIMELINE 生效时整体关闭(spec §9),直接 none。
 */
export async function autoBindFromFeatureDir(
  projectRoot: string,
  sessionId: string,
  filePath: string,
): Promise<AutoBindOutcome> {
  if (isKillSwitchOn()) return { kind: 'none' };
  const sid = sessionId.trim();
  if (!sid) return { kind: 'none' };

  const root = path.resolve(projectRoot);
  const rel = path.relative(root, path.resolve(root, filePath)).split(path.sep).join('/');
  const m = FEATURE_DIR_PATTERN.exec(rel);
  const featureId = m?.[1];
  if (!featureId) return { kind: 'none' };

  const declared = readFeatureTask(root, featureId);
  if (declared === null) return { kind: 'none' };

  const configured = loadTaskSourceConfig(root) !== null;

  let target: TaskItem;
  const conn = openTaskDb(root);
  try {
    target = resolveDeclaredTask(new TaskStore(conn.getDb()), declared, configured);
  } finally {
    conn.close();
  }

  const outcome = await bindSessionCore(root, sid, target.id, 'feature_dir', 'ifUnbound');
  if (outcome.kind === 'done') {
    return outcome.result.status === 'bound' ? { kind: 'bound', task: outcome.result.task } : { kind: 'none' };
  }

  // 已绑定其它任务 A:不切换,同一 (会话, A, B) 只提醒一次
  const boundTask = outcome.current.task;
  const remindConn = openTaskDb(root);
  try {
    const store = new TaskStore(remindConn.getDb());
    const first = store.recordReminder(sid, boundTask.id, target.id, new Date().toISOString());
    if (!first) return { kind: 'none' };
  } finally {
    remindConn.close();
  }

  const targetRef = target.source === 'api' && target.externalId ? target.externalId : target.name;
  return {
    kind: 'remind',
    boundTask,
    otherTask: target,
    message:
      `当前会话绑定任务「${boundTask.name}」,但本次改动属于任务「${target.name}」的需求目录(${featureId});` +
      `如需切换请与用户确认后执行 cgraphx task use ${targetRef}`,
  };
}

/**
 * 任务详情(spec §5.5):任务本身、声明了它的需求目录、绑定过的会话,
 * 以及按绑定区间派生的归属事件(commit、按类型计数、可选明细)。
 *
 * @throws TaskArgError 本地没有该任务。
 */
export async function getTaskDetail(
  projectRoot: string,
  taskId: number,
  opts: { events?: boolean; limit?: number } = {},
): Promise<TaskDetail> {
  const conn = openTaskDb(projectRoot);
  let detail: Pick<TaskDetail, 'task' | 'featureDirs' | 'sessions'>;
  try {
    const store = new TaskStore(conn.getDb());
    const task = store.getTaskById(taskId);
    if (!task) throw new TaskArgError(`找不到本地任务 ${taskId};用 cgraphx task list 查看可用任务`);
    const featureDirs = scanFeatureTasks(projectRoot)
      .filter((e) => findTask(store, e.task)?.id === taskId)
      .map((e) => e.path);
    detail = { task, featureDirs, sessions: store.listBindingsForTask(taskId) };
  } finally {
    conn.close();
  }

  // 每条绑定区间单独查询;timeline 的 until 是闭区间,这里再剔除 ts >= unbound_at(左闭右开)
  const byId = new Map<number, TimelineEvent>();
  for (const b of detail.sessions) {
    const events = await queryEvents(projectRoot, {
      session: b.sessionId,
      since: b.boundAt,
      until: b.unboundAt ?? undefined,
      limit: EVENTS_PER_BINDING_LIMIT,
    });
    for (const e of events) {
      if (e.ts < b.boundAt) continue;
      if (b.unboundAt !== null && e.ts >= b.unboundAt) continue;
      byId.set(e.id, e);
    }
  }
  const attributed = [...byId.values()].sort((a, b) => a.ts.localeCompare(b.ts) || a.id - b.id);

  const eventCounts: Record<string, number> = {};
  for (const e of attributed) eventCounts[e.event_type] = (eventCounts[e.event_type] ?? 0) + 1;

  return {
    ...detail,
    commits: attributed.filter((e) => e.event_type === 'git_commit'),
    eventCounts,
    events: opts.events === true ? attributed.slice(0, opts.limit ?? DEFAULT_DETAIL_EVENT_LIMIT) : null,
  };
}
