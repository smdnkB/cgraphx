/**
 * release 子系统类型。
 */

import type { HookSkipReason } from '../git-hooks';

/** 装上 / 卸掉版本分支提交拦截的结果。 */
export interface GuardResult {
  /** 本次查看的 commit-msg 钩子文件绝对路径;不在 git 仓库时为 null */
  hookPath: string | null;
  /**
   * - installed:原来没有片段,这次装上
   * - present:片段已是当前内容,没写盘
   * - updated:片段原来就在,这次换成当前内容
   * - repaired:片段原来不在,但装过的记号为 true(钩子文件被别的工具覆盖、换了 core.hooksPath 等),这次补装
   * - unsupported:没写入,原因见 reason(spec D33)
   * - removed:删掉了片段
   * - absent:没装过,或不在 git 仓库,没有可删的
   */
  status: 'installed' | 'present' | 'updated' | 'repaired' | 'unsupported' | 'removed' | 'absent';
  /** 钩子文件被 git 跟踪,片段靠本机过滤规则藏起来、不进提交;卸掉时恒为 false */
  localFilter: boolean;
  /** unsupported 时:not_shell 不是 shell 脚本 / outside_repo 钩子目录在仓库外 / symlink 钩子文件是链接 */
  reason?: HookSkipReason;
  /** unsupported 时:要用户自己加的几行 */
  lines?: readonly string[];
}
