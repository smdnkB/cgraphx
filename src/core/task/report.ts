/**
 * 任务报告:只读的任务汇总与详情(cgraphx-web开发任务浏览 spec §3–§7)。
 *
 * 只读:经 openTaskDbReadOnly 打开库,不应用 schema、不写任何表、不请求外部任务接口。
 * 时长口径只在这里实现:活跃时长按 ACTIVE_GAP_MS 断点去间隔,工作时长 = 首末事件差,
 * 任务合计为各绑定段之和(并行会话重叠不扣除)。
 */

import { scanFeatureTasks } from '../features';
import type { TimelineEvent } from '../timeline';
import { collectOutputs, collectReferences } from './artifacts';
import { queryBindingEvents } from './attribution';
import { ACTIVE_GAP_MS } from './constants';
import { TaskArgError } from './errors';
import { findTask } from './resolve';
import { openTaskDbReadOnly } from './schema-bootstrap';
import { TaskStore } from './store';
import type {
  SegmentReport,
  SegmentStats,
  TaskBinding,
  TaskItem,
  TaskReport,
  TaskSummary,
  TaskTotals,
} from './types';

/** spec §3.1:eventsAsc 为 ts 升序的归属事件。 */
export function computeSegmentStats(eventsAsc: TimelineEvent[]): SegmentStats {
  let commitCount = 0;
  let activeMs = 0;
  let runStart: number | null = null;
  let prev: number | null = null;
  for (const e of eventsAsc) {
    if (e.event_type === 'git_commit') commitCount++;
    const t = Date.parse(e.ts);
    if (runStart === null || prev === null) {
      runStart = t;
    } else if (t - prev > ACTIVE_GAP_MS) {
      activeMs += prev - runStart;
      runStart = t;
    }
    prev = t;
  }
  if (runStart !== null && prev !== null) activeMs += prev - runStart;

  const first = eventsAsc[0];
  const last = eventsAsc[eventsAsc.length - 1];
  return {
    eventCount: eventsAsc.length,
    commitCount,
    activeMs,
    workMs: first !== undefined && last !== undefined ? Date.parse(last.ts) - Date.parse(first.ts) : 0,
    firstTs: first?.ts ?? null,
    lastTs: last?.ts ?? null,
  };
}

/** spec §3.2:各段求和;会话数按不同 session_id 去重。没有绑定 → null。 */
function sumTotals(segments: Array<{ binding: TaskBinding; stats: SegmentStats }>): TaskTotals | null {
  if (segments.length === 0) return null;
  const totals: TaskTotals = {
    sessionCount: new Set(segments.map((s) => s.binding.sessionId)).size,
    bindingCount: segments.length,
    eventCount: 0,
    commitCount: 0,
    activeMs: 0,
    workMs: 0,
    lastActivityAt: null,
  };
  for (const { stats } of segments) {
    totals.eventCount += stats.eventCount;
    totals.commitCount += stats.commitCount;
    totals.activeMs += stats.activeMs;
    totals.workMs += stats.workMs;
    if (stats.lastTs !== null && (totals.lastActivityAt === null || stats.lastTs > totals.lastActivityAt)) {
      totals.lastActivityAt = stats.lastTs;
    }
  }
  return totals;
}

/** 逐段取归属事件并统计。 */
async function loadSegments(
  projectRoot: string,
  bindings: TaskBinding[],
): Promise<{ segments: Array<{ binding: TaskBinding; events: TimelineEvent[]; stats: SegmentStats }>; truncated: boolean }> {
  const segments: Array<{ binding: TaskBinding; events: TimelineEvent[]; stats: SegmentStats }> = [];
  let truncated = false;
  for (const binding of bindings) {
    const result = await queryBindingEvents(projectRoot, binding);
    if (result.truncated) truncated = true;
    segments.push({ binding, events: result.events, stats: computeSegmentStats(result.events) });
  }
  return { segments, truncated };
}

/**
 * 全部本地任务及汇总(spec §4)。不请求外部接口。
 * 排序:totals?.lastActivityAt 降序;为 null 的排最后;同值或同为 null 按 task.id 降序。
 * @throws TaskConfigError 未初始化;TaskNotEnabledError 没有 task 表。
 */
export async function listTaskSummaries(projectRoot: string): Promise<TaskSummary[]> {
  let tasks: TaskItem[];
  let bindings: TaskBinding[];
  const conn = openTaskDbReadOnly(projectRoot);
  try {
    const store = new TaskStore(conn.getDb());
    tasks = store.listTasks();
    bindings = store.listAllBindings();
  } finally {
    conn.close();
  }

  const bindingsByTask = new Map<number, TaskBinding[]>();
  for (const b of bindings) {
    const list = bindingsByTask.get(b.taskId) ?? [];
    list.push(b);
    bindingsByTask.set(b.taskId, list);
  }

  const summaries: TaskSummary[] = [];
  for (const task of tasks) {
    const own = bindingsByTask.get(task.id) ?? [];
    const { segments, truncated } = await loadSegments(projectRoot, own);
    summaries.push({
      task,
      inProgress: own.some((b) => b.unboundAt === null),
      totals: sumTotals(segments),
      truncated,
    });
  }

  return summaries.sort((a, b) => {
    const la = a.totals?.lastActivityAt ?? null;
    const lb = b.totals?.lastActivityAt ?? null;
    if (la !== lb) {
      if (la === null) return 1;
      if (lb === null) return -1;
      return lb.localeCompare(la);
    }
    return b.task.id - a.task.id;
  });
}

/**
 * 单任务报告(spec §3、§5、§6、§7)。
 * @throws TaskArgError 本地没有该任务;TaskConfigError / TaskNotEnabledError 同上。
 */
export async function getTaskReport(
  projectRoot: string,
  taskId: number,
  opts: { eventLimitPerSegment: number },
): Promise<TaskReport> {
  let task: TaskItem;
  let bindings: TaskBinding[];
  let featureDirs: string[];
  const conn = openTaskDbReadOnly(projectRoot);
  try {
    const store = new TaskStore(conn.getDb());
    const found = store.getTaskById(taskId);
    if (!found) throw new TaskArgError(`找不到本地任务 ${taskId}`);
    task = found;
    bindings = store.listBindingsForTask(taskId);
    featureDirs = scanFeatureTasks(projectRoot)
      .filter((e) => findTask(store, e.task)?.id === taskId)
      .map((e) => e.path);
  } finally {
    conn.close();
  }

  const { segments, truncated } = await loadSegments(projectRoot, bindings);

  // 合计、统计、产出、参考基于全部归属事件(各段合并,按 id 去重)
  const byId = new Map<number, TimelineEvent>();
  for (const s of segments) for (const e of s.events) byId.set(e.id, e);
  const allEvents = [...byId.values()].sort((a, b) => a.ts.localeCompare(b.ts) || a.id - b.id);

  const eventCounts: Record<string, number> = {};
  for (const e of allEvents) eventCounts[e.event_type] = (eventCounts[e.event_type] ?? 0) + 1;

  const outputs = collectOutputs(projectRoot, allEvents, featureDirs);
  const outputPaths = new Set(outputs.flatMap((g) => g.paths));

  const segmentReports: SegmentReport[] = segments.map(({ binding, events, stats }) => {
    const shown = events.slice(0, opts.eventLimitPerSegment);
    return { binding, stats, events: shown, hiddenEventCount: stats.eventCount - shown.length };
  });

  return {
    task,
    featureDirs,
    inProgress: bindings.some((b) => b.unboundAt === null),
    totals: sumTotals(segments),
    segments: segmentReports,
    eventCounts,
    outputs,
    references: collectReferences(projectRoot, allEvents, outputPaths),
    truncated,
  };
}
