/**
 * 开发任务页(2026-10-14-cgraphx-web开发任务浏览):任务列表 + 任务详情。
 *
 * 只读:数据只经 task 门面的 listTaskSummaries / getTaskReport(不建表、不写库、不请求外部接口);
 * 口径(时长、合计、排序、产出、参考)全部由 core 算好,本模块只做格式化与链接解析。
 * 项目没有 task 表 → 启用提示页(200);任务不存在 → 404。
 */

import type { SqliteDatabase } from '../core/db';
import { MarkdownQuery } from '../core/markdown';
import {
  getTaskReport,
  listTaskSummaries,
  TaskArgError,
  TaskNotEnabledError,
  type ArtifactGroup,
  type SegmentReport,
  type TaskReport,
} from '../core/task';
import type { TimelineEvent } from '../core/timeline';
import { isSafeCodemapName } from './codemap-reader';
import {
  ARTIFACT_CATEGORY_LABELS,
  BIND_SOURCE_LABELS,
  EVENT_TYPE_LABELS,
  TASK_SEGMENT_EVENT_LIMIT,
  TASK_SOURCE_LABELS,
} from './constants';
import { renderShellPage } from './layout';
import { buildOverviewUrl } from './pages-overview';
import { formatDuration, formatTaskTime, pad2 } from './render-utils';
import {
  renderTaskDetailContent,
  renderTaskListContent,
  renderTaskNotEnabledContent,
  TRUNCATED_NOTE,
  type ArtifactGroupModel,
  type LinkModel,
  type SegmentBlockModel,
  type SegmentItemModel,
  type SegmentRowModel,
  type TaskDetailModel,
} from './task-templates';
import { toCommitRow, toEventRow, truncate } from './timeline-event-rows';

export interface TaskPageCtx {
  version: string;
  localHost: string;
  projectRoot: string;
}

const DASH = '—';

function shell(title: string, contentHtml: string, ctx: TaskPageCtx): string {
  return renderShellPage({ title, active: 'tasks', contentHtml, version: ctx.version, localHost: ctx.localHost });
}

// ----- 链接解析(spec §8)----------------------------------------------------

const CODEMAP_SYSTEM = /^docs\/code-map\/([^/]+)\.md$/;
const CODEMAP_FLOW = /^docs\/code-map\/flows\/([^/]+)\.md$/;
const SCHEMA_TABLE = /^docs\/schema-knowledge\/([^/]+)\/ddl\/([^/]+)\.sql$/;
const SCHEMA_PROJECT = /^docs\/schema-knowledge\/([^/]+)\/.+/;

/** 项目相对路径 → 链接:知识库(已索引)/ 系统地图 / 模型知识库可点,其余只显示路径。 */
function resolveLink(query: MarkdownQuery, relPath: string): LinkModel {
  const plain: LinkModel = { href: null, text: relPath, title: relPath };
  if (relPath.startsWith('docs/knowledge/')) {
    const doc = query.getDocumentDetail(relPath);
    return doc !== null ? { href: `/doc/${encodeURIComponent(relPath)}`, text: doc.title, title: relPath } : plain;
  }
  const flow = CODEMAP_FLOW.exec(relPath);
  if (flow?.[1] !== undefined && isSafeCodemapName(flow[1])) {
    return { href: `/map/flow/${encodeURIComponent(flow[1])}`, text: flow[1], title: relPath };
  }
  const system = CODEMAP_SYSTEM.exec(relPath);
  if (system?.[1] !== undefined && isSafeCodemapName(system[1])) {
    return { href: `/map/system/${encodeURIComponent(system[1])}`, text: system[1], title: relPath };
  }
  const table = SCHEMA_TABLE.exec(relPath);
  if (table?.[1] !== undefined && table[2] !== undefined) {
    return { href: `/schema/${encodeURIComponent(table[1])}/${encodeURIComponent(table[2])}`, text: table[2], title: relPath };
  }
  const project = SCHEMA_PROJECT.exec(relPath);
  if (project?.[1] !== undefined) {
    return { href: `/schema/${encodeURIComponent(project[1])}`, text: relPath, title: relPath };
  }
  return plain;
}

function toGroupModels(query: MarkdownQuery, groups: ArtifactGroup[]): ArtifactGroupModel[] {
  return groups.map((g) => ({
    label: ARTIFACT_CATEGORY_LABELS[g.category],
    collapsed: g.category === 'code',
    items: g.paths.map((p) => resolveLink(query, p)),
  }));
}

// ----- 列表页(spec §4)------------------------------------------------------

export async function renderTasksListPage(ctx: TaskPageCtx): Promise<string> {
  let summaries;
  try {
    summaries = await listTaskSummaries(ctx.projectRoot);
  } catch (err) {
    if (err instanceof TaskNotEnabledError) return shell('开发任务', renderTaskNotEnabledContent(), ctx);
    throw err;
  }
  const now = Date.now();
  const rows = summaries.map(({ task, inProgress, totals }) => ({
    id: task.id,
    name: task.name,
    inProgress,
    source: TASK_SOURCE_LABELS[task.source],
    status: task.status ?? DASH,
    sessions: totals !== null ? String(totals.sessionCount) : DASH,
    commits: totals !== null ? String(totals.commitCount) : DASH,
    active: totals !== null ? formatDuration(totals.activeMs) : DASH,
    lastActivity: totals?.lastActivityAt != null ? formatTaskTime(totals.lastActivityAt, now) : DASH,
  }));
  const content = renderTaskListContent({
    rows,
    hasApiTask: summaries.some((s) => s.task.source === 'api'),
    truncated: summaries.some((s) => s.truncated),
  });
  return shell('开发任务', content, ctx);
}

// ----- 详情页(spec §7)------------------------------------------------------

function rowOf(e: TimelineEvent): SegmentRowModel {
  return e.event_type === 'git_commit' ? { kind: 'commit', row: toCommitRow(e) } : { kind: 'event', row: toEventRow(e) };
}

/** 时间顺序遍历:连续且 turn_id 相同(非 null)的事件归一个轮次组,无轮次的事件单独成行。 */
function buildSegmentItems(events: TimelineEvent[]): { items: SegmentItemModel[]; turnCount: number } {
  const items: SegmentItemModel[] = [];
  let current: { turnId: string; firstMs: number; prompt: string | null; rows: SegmentRowModel[] } | null = null;
  let turnCount = 0;
  const flush = (): void => {
    if (current === null) return;
    const d = new Date(current.firstMs);
    const base = `轮 ${turnCount} · ${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
    items.push({ kind: 'turn', label: current.prompt !== null ? `${base} · ${truncate(current.prompt, 40)}` : base, rows: current.rows });
    current = null;
  };
  for (const e of events) {
    if (e.turn_id === null) {
      flush();
      items.push(rowOf(e));
      continue;
    }
    if (current === null || current.turnId !== e.turn_id) {
      flush();
      turnCount++;
      current = { turnId: e.turn_id, firstMs: Date.parse(e.ts), prompt: null, rows: [] };
    }
    if (current.prompt === null && e.event_type === 'user_prompt' && e.prompt_text !== null && e.prompt_text !== '') {
      current.prompt = e.prompt_text;
    }
    current.rows.push(rowOf(e));
  }
  flush();
  return { items, turnCount };
}

function toSegmentModel(s: SegmentReport, report: TaskReport, now: number): SegmentBlockModel {
  const { binding, stats } = s;
  const { items, turnCount } = buildSegmentItems(s.events);
  const end = binding.unboundAt !== null ? formatTaskTime(binding.unboundAt, now) : '生效中';
  return {
    sessionId: binding.sessionId,
    range: `${formatTaskTime(binding.boundAt, now)} → ${end}`,
    bindSource: BIND_SOURCE_LABELS[binding.bindSource],
    stats: `活跃 ${formatDuration(stats.activeMs)} · 工作 ${formatDuration(stats.workMs)} · ${stats.commitCount} commit`,
    eventCount: stats.eventCount,
    turnCount,
    items,
    hiddenHint:
      s.hiddenEventCount > 0
        ? `还有 ${s.hiddenEventCount} 条未显示,用 cgraphx task show ${report.task.id} --events --limit ${report.totals?.eventCount ?? stats.eventCount} 查看`
        : null,
  };
}

export async function renderTaskDetailPage(
  db: SqliteDatabase,
  taskId: number,
  ctx: TaskPageCtx,
): Promise<{ status: 200; html: string } | { status: 404 }> {
  let report: TaskReport;
  try {
    report = await getTaskReport(ctx.projectRoot, taskId, { eventLimitPerSegment: TASK_SEGMENT_EVENT_LIMIT });
  } catch (err) {
    if (err instanceof TaskNotEnabledError) return { status: 200, html: shell('开发任务', renderTaskNotEnabledContent(), ctx) };
    if (err instanceof TaskArgError) return { status: 404 };
    throw err;
  }

  const query = new MarkdownQuery(db);
  const now = Date.now();
  const { task, totals } = report;
  const url = task.url !== null && task.url !== ''
    ? { href: /^https?:\/\//i.test(task.url) ? task.url : null, text: task.url, title: task.url }
    : null;

  let bound: TaskDetailModel['bound'] = null;
  if (totals !== null) {
    const linkable = new Set(query.listConcepts({ sort: 'name' }).map((c) => c.name));
    bound = {
      sessions: String(totals.sessionCount),
      bindingNote: `${totals.bindingCount} 段绑定`,
      active: formatDuration(totals.activeMs),
      work: formatDuration(totals.workMs),
      commits: String(totals.commitCount),
      events: String(totals.eventCount),
      truncatedNote: report.truncated ? TRUNCATED_NOTE : null,
      outputCount: report.outputs.reduce((n, g) => n + g.paths.length, 0),
      outputs: toGroupModels(query, report.outputs),
      references: toGroupModels(query, report.references.groups),
      concepts: report.references.concepts.map((name) => ({
        name,
        href: linkable.has(name)
          ? buildOverviewUrl({ types: [], statuses: [], domains: [], concepts: [name], sort: 'updated', page: 1 })
          : null,
      })),
      overlapCount: report.references.overlapCount,
      segments: report.segments.map((s) => toSegmentModel(s, report, now)),
      eventStats: (Object.keys(EVENT_TYPE_LABELS) as Array<keyof typeof EVENT_TYPE_LABELS>)
        .filter((t) => (report.eventCounts[t] ?? 0) > 0)
        .map((t) => ({ label: EVENT_TYPE_LABELS[t], count: report.eventCounts[t] ?? 0 })),
    };
  }

  const model: TaskDetailModel = {
    name: task.name,
    source: TASK_SOURCE_LABELS[task.source],
    externalId: task.externalId ?? '',
    status: task.status ?? '',
    url,
    featureDirs: report.featureDirs,
    bound,
  };
  return { status: 200, html: shell(task.name, renderTaskDetailContent(model), ctx) };
}
