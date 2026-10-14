/**
 * task 子系统领域类型。
 *
 * DB 原始行类型(`XxxRow`,snake_case)只在 store 层内部使用,不出现在这里。
 */

import type { TimelineEvent } from '../timeline';
import type { BIND_SOURCES, TASK_SOURCES } from './constants';

export type TaskSource = (typeof TASK_SOURCES)[number];
export type BindSource = (typeof BIND_SOURCES)[number];

/** 任务(接口任务或手动任务)。 */
export interface TaskItem {
  id: number;
  source: TaskSource;
  externalId: string | null;
  name: string;
  url: string | null;
  status: string | null;
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
