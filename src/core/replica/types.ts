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
  /** 开副本那一刻的提交:K3 据它只数需求分支自己做的提交;以前的登记没有这个字段 → null(spec D19) */
  baseCommit: string | null;
  /**
   * 开副本时从主目录这个需求目录移进副本的文件(仓库相对路径):sync 据它给开副本之前在主目录写的这些
   * 文件定根(spec D19、D29);以前的登记没有这个字段 → null
   */
  movedFiles: string[] | null;
  /** ISO 8601 */
  createdAt: string;
  /** ISO 8601;没删为 null */
  removedAt: string | null;
}

/**
 * replica 为 null 即不是副本登记的根(timeline 记下的根、当前根);realRoot 是 root 的 realpath(目录不在时取最近一级
 * 在的上级的 realpath 拼回),在 listProjectRoots 里一次算好
 */
export interface ProjectRoot {
  root: string;
  realRoot: string;
  replica: ReplicaEntry | null;
  /** 这个根最近一次活动的时间:按路径取调用方传入的 timeline 记下的根;没有记录为 null */
  lastActiveAt: string | null;
}

/**
 * 是不是副本(main-dir.ts 的 replicaLinkOf):
 * - own:不是副本(没有 shared 链接,或链接不作数)
 * - replica:登记过、没删除的副本
 * - main-missing:shared 链接指向的主目录 `.cgraphx/` 已不在
 */
export type ReplicaLinkState = 'own' | 'replica' | 'main-missing';

export interface ReplicaLink {
  state: ReplicaLinkState;
  /** own:项目根本身(path.resolve);replica:链接目标 realpath 的上级目录;main-missing:链接目标的上级目录 */
  mainRoot: string;
}

/** 副本状态:在 / 目录已不在 / 已删除(removedAt 非空)。 */
export type ReplicaState = 'present' | 'missing' | 'removed';

export interface ReplicaStatus extends ReplicaEntry {
  state: ReplicaState;
  /**
   * K3:需求分支自己做的提交都已在主目录当前分支里;还没有提交时为 false(ahead 为 0);
   * state 不是 present、或 git 判不了时为 null
   */
  merged: boolean | null;
  /** 需求分支自己做的提交里还没合入的个数;已合入、还没有提交为 0,不判时为 null */
  ahead: number | null;
  /** K9:改了没提交的已跟踪文件 + 没被跟踪也没被忽略的文件(仓库相对路径) */
  dirty: string[];
}

export interface CreateReplicaOptions {
  featureId: string;
  /** 文件前缀 = feature-id 去掉日期段,由调用方(dev-start)传入 */
  prefix: string;
  branch: string;
}

export interface CreateReplicaResult extends ReplicaEntry {
  /** 从主目录移进副本的文件(仓库相对路径);以前的登记没有时为 [] */
  movedFiles: string[];
  warnings: string[];
  /** 这次接上了删副本时留下的分支(D7、K15) */
  reattached: boolean;
}

export interface RemoveReplicaResult {
  name: string;
  /** removed:删掉了目录;missing:目录早已不在,只在登记里记为删除 */
  state: 'removed' | 'missing';
  /** 需求分支怎么处理的(D12、K13):已合入就删(deleted),还没合入或删不掉就留着(kept) */
  branch: {
    name: string;
    /** deleted:已删;kept:留着(还没合入 / 删不掉 / 主目录里没有这个分支) */
    state: 'deleted' | 'kept';
    /** 删除前 `refs/heads/<分支>` 的提交号;主目录里没有这个引用 → '' */
    tip: string;
  };
  /** 没删掉的分支等,给人手动处理的提示 */
  warnings: string[];
}
