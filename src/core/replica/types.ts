/**
 * replica 子系统类型(plan C-4)。
 */

/** 一个副本的登记(主目录 `.cgraphx/replicas/<副本目录名>.json`,plan C-3)。 */
export interface ReplicaEntry {
  /** 副本目录名 `<主目录名>@<文件前缀>` */
  name: string;
  /** 副本目录的绝对路径 */
  path: string;
  featureId: string;
  /** 副本里的需求分支,如 feat/订单导出 */
  branch: string;
  /** 开副本时主目录所在的分支 */
  baseBranch: string;
  /** ISO 8601 */
  createdAt: string;
  /** ISO 8601;没删为 null */
  removedAt: string | null;
}

/** replica 为 null 即主目录;realRoot 是 root 的 realpath(目录不在时等于 root),在 listProjectRoots 里一次算好 */
export interface ProjectRoot {
  root: string;
  realRoot: string;
  replica: ReplicaEntry | null;
}

/** 副本状态:在 / 目录已不在 / 已删除(removedAt 非空)。 */
export type ReplicaState = 'present' | 'missing' | 'removed';

export interface ReplicaStatus extends ReplicaEntry {
  state: ReplicaState;
  /** K3:需求分支的最新提交已在主目录当前分支里;state 不是 present、或判不了时为 null */
  merged: boolean | null;
  /** 差几个提交;已合入为 0,不判时为 null */
  ahead: number | null;
  /** K9:改了没提交的已跟踪文件 + 没被跟踪也没被忽略的文件(仓库相对路径) */
  dirty: string[];
}

export interface CreateReplicaOptions {
  featureId: string;
  /** 文件前缀 = feature-id 去掉日期段,由调用方(dev-start)传入 */
  prefix: string;
  branch: string;
  /** 不用写时复制,整份复制 */
  fullCopy?: boolean;
}

export interface CreateReplicaResult extends ReplicaEntry {
  /** false:这个需求的副本已经有了,没重建 */
  created: boolean;
  /** 从主目录移进副本的文件(仓库相对路径) */
  movedFiles: string[];
  warnings: string[];
}

export interface RemoveReplicaResult {
  name: string;
  /** removed:删掉了目录;missing:目录早已不在,只在登记里记为删除 */
  state: 'removed' | 'missing';
}
