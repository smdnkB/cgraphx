/**
 * 任务报告:只读的任务汇总与详情(cgraphx-web开发任务浏览 spec §3–§7)。
 *
 * 只读:经 openTaskDbReadOnly 打开库,不应用 schema、不写任何表、不请求外部任务接口。
 * 时长口径只在这里实现:活跃时长按 ACTIVE_GAP_MS 断点去间隔,工作时长 = 首末事件差,
 * 任务合计为各绑定段之和(并行会话重叠不扣除)。
 */

import { scanFeatureTasks } from '../features';
import type { SqliteDatabase } from '../db';
import type { TimelineEvent } from '../timeline';
import { collectOutputs, collectReferences } from './artifacts';
import { queryBindingEvents } from './attribution';
import { ACTIVE_GAP_MS, FEATURE_TASK_ID_BASE } from './constants';
import { TaskArgError, TaskConfigError, TaskNotEnabledError } from './errors';
import { resolveFeatureTargetReadOnly } from './feature-task';
import { findTask } from './resolve';
import { openTaskDbReadOnly } from './schema-bootstrap';
import { TaskStore } from './store';
import type {
  EffectiveBinding,
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

/** sqlite_master 探测:旧库没有新表时读取方降级,而不是抛错。 */
function tableExists(db: SqliteDatabase, name: string): boolean {
  return (
    db.prepare(`SELECT 1 AS hit FROM sqlite_master WHERE type = 'table' AND name = ?`).get(name) !== undefined
  );
}

/** 两个可空时间点取较早者。 */
function earlier(a: string | null, b: string | null): string | null {
  if (a === null) return b;
  if (b === null) return a;
  return a < b ? a : b;
}

/** 任务列表:task_items ∪ task_feature_tasks(旧库没有目录任务表时只返回前者)。 */
function listAllTasks(store: TaskStore, db: SqliteDatabase): TaskItem[] {
  const tasks = store.listTasks();
  if (tableExists(db, 'task_feature_tasks')) tasks.push(...store.listFeatureTasks());
  return tasks;
}

/**
 * 合并有效绑定(调用方已打开只读库)。
 *
 * ①/② task_sessions 中的手动 / 旧绑定(按需包含被取代行);
 * ③ task_auto_sessions 的派生结果,读取时解析目录对应任务;区间结束取该会话保留手动行
 *    最早 bound_at 与 stopped_at 的较早者,结束点 ≤ 起点时整段不出现。
 */
function collectEffectiveBindings(
  projectRoot: string,
  db: SqliteDatabase,
  store: TaskStore,
  includeSuperseded: boolean,
): EffectiveBinding[] {
  const result: EffectiveBinding[] = [];
  const hasFeatureTasks = tableExists(db, 'task_feature_tasks');
  const superseded = tableExists(db, 'task_superseded_bindings')
    ? store.listSupersededBindingIds()
    : new Set<number>();
  const all = tableExists(db, 'task_sessions') ? store.listAllBindings() : [];
  const retained = all.filter((binding) => !superseded.has(binding.id));

  const pushRow = (binding: TaskBinding, isSuperseded: boolean): void => {
    // 旧库缺少目录任务表时,指向大 id 的行无处解析,跳过。
    if (binding.taskId >= FEATURE_TASK_ID_BASE && !hasFeatureTasks) return;
    const task = store.getTaskById(binding.taskId);
    if (task !== null) {
      result.push({ bindingKey: String(binding.id), binding, task, superseded: isSuperseded });
    }
  };

  for (const binding of retained) pushRow(binding, false);
  if (includeSuperseded) {
    for (const binding of all) {
      if (superseded.has(binding.id)) pushRow(binding, true);
    }
  }

  if (tableExists(db, 'task_auto_sessions')) {
    // 保留的手动 / 旧绑定最早起点:派生段最晚在这里结束。
    const earliestBoundAt = new Map<string, string>();
    for (const binding of retained) {
      const prev = earliestBoundAt.get(binding.sessionId);
      if (prev === undefined || binding.boundAt < prev) earliestBoundAt.set(binding.sessionId, binding.boundAt);
    }
    for (const auto of store.listAutoSessions()) {
      if (auto.featureId === null || auto.boundAt === null) continue;
      const task = resolveFeatureTargetReadOnly(projectRoot, store, auto.featureId);
      if (task === null) continue;
      const unboundAt = earlier(earliestBoundAt.get(auto.sessionId) ?? null, auto.stoppedAt);
      if (unboundAt !== null && unboundAt <= auto.boundAt) continue;
      result.push({
        bindingKey: `auto:${auto.sessionId}`,
        binding: {
          id: 0,
          sessionId: auto.sessionId,
          taskId: task.id,
          boundAt: auto.boundAt,
          unboundAt,
          bindSource: auto.strength === 'write' ? 'auto_write' : 'auto_read',
        },
        task,
        superseded: false,
      });
    }
  }

  return result.sort(
    (a, b) => a.binding.boundAt.localeCompare(b.binding.boundAt) || a.bindingKey.localeCompare(b.bindingKey),
  );
}

/**
 * 全部有效绑定(只读)。项目未初始化或没有 task 表时返回空数组。
 * 旧库缺少 task_feature_tasks / task_auto_sessions 等新表时按现有表降级读取。
 */
export function listEffectiveBindings(
  projectRoot: string,
  opts: { includeSuperseded?: boolean } = {},
): EffectiveBinding[] {
  let conn;
  try {
    conn = openTaskDbReadOnly(projectRoot);
  } catch (err) {
    if (err instanceof TaskConfigError || err instanceof TaskNotEnabledError) return [];
    throw err;
  }
  try {
    const db = conn.getDb();
    return collectEffectiveBindings(projectRoot, db, new TaskStore(db), opts.includeSuperseded === true);
  } finally {
    conn.close();
  }
}

/** 该会话当前生效的绑定(手动优先;有保留的手动行时派生段不会生效)。 */
export function getCurrentEffectiveBinding(
  projectRoot: string,
  sessionId: string,
): EffectiveBinding | null {
  const open = listEffectiveBindings(projectRoot).filter(
    (entry) => entry.binding.sessionId === sessionId && entry.binding.unboundAt === null,
  );
  return (
    open.find((entry) => entry.binding.bindSource === 'cli' || entry.binding.bindSource === 'feature_dir') ??
    open[0] ??
    null
  );
}

/** 逐段取归属事件并统计;bindingKey 是段的唯一键(派生段共享 id = 0,不能按 id 区分)。 */
async function loadSegments(
  projectRoot: string,
  bindings: Array<{ bindingKey: string; binding: TaskBinding }>,
): Promise<{
  segments: Array<{ bindingKey: string; binding: TaskBinding; events: TimelineEvent[]; stats: SegmentStats }>;
  truncated: boolean;
}> {
  const segments: Array<{
    bindingKey: string;
    binding: TaskBinding;
    events: TimelineEvent[];
    stats: SegmentStats;
  }> = [];
  let truncated = false;
  for (const { bindingKey, binding } of bindings) {
    const result = await queryBindingEvents(projectRoot, binding);
    if (result.truncated) truncated = true;
    segments.push({ bindingKey, binding, events: result.events, stats: computeSegmentStats(result.events) });
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
  let bindings: EffectiveBinding[];
  const conn = openTaskDbReadOnly(projectRoot);
  try {
    const db = conn.getDb();
    const store = new TaskStore(db);
    tasks = listAllTasks(store, db);
    bindings = collectEffectiveBindings(projectRoot, db, store, false);
  } finally {
    conn.close();
  }

  const bindingsByTask = new Map<number, EffectiveBinding[]>();
  for (const entry of bindings) {
    const list = bindingsByTask.get(entry.binding.taskId) ?? [];
    list.push(entry);
    bindingsByTask.set(entry.binding.taskId, list);
  }

  const summaries: TaskSummary[] = [];
  for (const task of tasks) {
    const own = bindingsByTask.get(task.id) ?? [];
    const { segments, truncated } = await loadSegments(projectRoot, own);
    summaries.push({
      task,
      inProgress: own.some((entry) => entry.binding.unboundAt === null),
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
  let bindings: EffectiveBinding[];
  let featureDirs: string[];
  const conn = openTaskDbReadOnly(projectRoot);
  try {
    const db = conn.getDb();
    const store = new TaskStore(db);
    const found = store.getTaskById(taskId);
    if (!found) throw new TaskArgError(`找不到本地任务 ${taskId}`);
    task = found;
    bindings = collectEffectiveBindings(projectRoot, db, store, false).filter(
      (entry) => entry.binding.taskId === taskId,
    );
    // 目录任务的产出目录就是它自己的 feature-id;其它任务按头部声明反查。
    featureDirs =
      found.source === 'feature' && found.featureId !== null
        ? [`docs/features/${found.featureId}`]
        : scanFeatureTasks(projectRoot)
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

  const segmentReports: SegmentReport[] = segments.map(({ bindingKey, binding, events, stats }) => {
    const shown = events.slice(0, opts.eventLimitPerSegment);
    return { bindingKey, binding, stats, events: shown, hiddenEventCount: stats.eventCount - shown.length };
  });

  return {
    task,
    featureDirs,
    inProgress: bindings.some((entry) => entry.binding.unboundAt === null),
    totals: sumTotals(segments),
    segments: segmentReports,
    eventCounts,
    outputs,
    references: collectReferences(projectRoot, allEvents, outputPaths),
    truncated,
  };
}
