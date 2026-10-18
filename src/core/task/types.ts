/**
 * task 子系统领域类型。
 *
 * DB 原始行类型(`XxxRow`,snake_case)只在 store 层内部使用,不出现在这里。
 */

import type { TimelineEvent } from '../timeline';
import type { ARTIFACT_CATEGORIES, AUTO_STRENGTHS, BIND_SOURCES, TASK_SOURCES } from './constants';

export type TaskSource = (typeof TASK_SOURCES)[number];
export type BindSource = (typeof BIND_SOURCES)[number];
export type AutoStrength = (typeof AUTO_STRENGTHS)[number];

/** 任务(接口任务 / 手动任务 / 目录任务)。 */
export interface TaskItem {
  id: number;
  source: TaskSource;
  externalId: string | null;
  name: string;
  url: string | null;
  status: string | null;
  /** 目录任务的 feature-id;api / manual 为 null。 */
  featureId: string | null;
  createdAt: string;
  updatedAt: string;
}

/** 会话绑定:会话在 [boundAt, unboundAt) 区间内归属某任务。unboundAt 为 null 表示生效中。 */
export interface TaskBinding {
  id: number;
  sessionId: string;
  taskId: number;
  boundAt: string;
  unboundAt: string | null;
  bindSource: BindSource;
}

/** 会话自动绑定派生结果(featureId 为 null 表示整个会话没碰过合格产出目录)。 */
export interface AutoSession {
  sessionId: string;
  /** 派生时该会话的最大事件 id;用于下次增量刷新。 */
  derivedMaxEventId: number;
  featureId: string | null;
  strength: AutoStrength | null;
  /** 绑定区间起点(会话最早事件 ts);无结果为 null。 */
  boundAt: string | null;
  /** 手动操作(R6)后的截止点;null 表示自动规则仍然有效。 */
  stoppedAt: string | null;
  derivedAt: string;
}

/** `.cgraphx/task-source.json` 的内容(headers 缺省为空对象)。 */
export interface TaskSourceConfig {
  url: string;
  headers: Record<string, string>;
}

/** 外部接口返回的一条合法任务。`raw` 为原始条目。 */
export interface RemoteTask {
  id: string;
  name: string;
  url: string | null;
  status: string | null;
  raw: unknown;
}

export interface TaskListResult {
  tasks: TaskItem[];
  /** 当前会话生效绑定的任务 id;拿不到会话或未绑定为 null。 */
  currentTaskId: number | null;
  /** 接口拉取失败时的警告(`<原因>;已显示本地缓存`),否则为 null。 */
  warning: string | null;
}

export interface BindResult {
  status: 'bound' | 'already' | 'switched';
  task: TaskItem;
  /** 切换前的任务;仅 status 为 switched 时非 null。 */
  previous: TaskItem | null;
  binding: TaskBinding;
}

export interface CurrentBinding {
  binding: TaskBinding;
  task: TaskItem;
}

export type AutoBindOutcome =
  | { kind: 'none' }
  | { kind: 'bound'; task: TaskItem }
  | { kind: 'remind'; boundTask: TaskItem; otherTask: TaskItem; message: string };

export interface TaskDetail {
  task: TaskItem;
  /** 主 spec 头部声明了该任务的需求目录(仓库相对 POSIX 路径)。 */
  featureDirs: string[];
  /** 该任务的全部绑定,按 boundAt 升序。 */
  sessions: TaskBinding[];
  /** 归属该任务的 git_commit 事件,按 ts 升序。 */
  commits: TimelineEvent[];
  /** 归属事件按 event_type 计数。 */
  eventCounts: Record<string, number>;
  /** 归属事件明细(按 ts 升序,截取前 limit 条);未要求时为 null。 */
  events: TimelineEvent[] | null;
}

// ── 任务报告(web 只读浏览;口径见 cgraphx-web开发任务浏览 spec §3–§7)──

export type ArtifactCategory = (typeof ARTIFACT_CATEGORIES)[number];

/** 一条绑定段的统计。无事件或仅 1 条事件时 activeMs / workMs 为 0。 */
export interface SegmentStats {
  eventCount: number;
  commitCount: number;
  activeMs: number;
  workMs: number;
  /** 段内最早 / 最晚归属事件 ts;无事件为 null。 */
  firstTs: string | null;
  lastTs: string | null;
}

/** 任务合计:各绑定段求和(并行会话重叠不扣除)。 */
export interface TaskTotals {
  /** 不同 session_id 个数。 */
  sessionCount: number;
  bindingCount: number;
  eventCount: number;
  commitCount: number;
  activeMs: number;
  workMs: number;
  /** 全部归属事件最大 ts;无归属事件为 null。 */
  lastActivityAt: string | null;
}

export interface TaskSummary {
  task: TaskItem;
  /** 至少一条 unboundAt 为 null 的绑定。 */
  inProgress: boolean;
  /** 从未绑定过会话为 null。 */
  totals: TaskTotals | null;
  /** 任一绑定段命中 EVENTS_PER_BINDING_LIMIT。 */
  truncated: boolean;
}

export interface SegmentReport {
  binding: TaskBinding;
  stats: SegmentStats;
  /** 段内最早的 eventLimitPerSegment 条归属事件,ts/id 升序。 */
  events: TimelineEvent[];
  /** stats.eventCount - events.length。 */
  hiddenEventCount: number;
}

export interface ArtifactGroup {
  category: ArtifactCategory;
  /** 项目相对 POSIX 路径,升序去重。 */
  paths: string[];
}

export interface ReferenceReport {
  /** 只含 REFERENCE_CATEGORIES 中非空的类别,按 ARTIFACT_CATEGORIES 顺序。 */
  groups: ArtifactGroup[];
  /** cgraphx docs 命令中按概念查询的概念名,去重,按首次出现顺序。 */
  concepts: string[];
  /** 既被参考又在产出中的文件数(这些文件不进 groups)。 */
  overlapCount: number;
}

export interface TaskReport {
  task: TaskItem;
  /** 主 spec 头部声明本任务的需求目录(项目相对 POSIX,如 docs/features/<id>)。 */
  featureDirs: string[];
  inProgress: boolean;
  totals: TaskTotals | null;
  /** 一条绑定段一项,按 bound_at、id 升序。 */
  segments: SegmentReport[];
  /** 全部归属事件按 event_type 计数。 */
  eventCounts: Record<string, number>;
  /** 非空类别,按 ARTIFACT_CATEGORIES 顺序。 */
  outputs: ArtifactGroup[];
  references: ReferenceReport;
  truncated: boolean;
}
