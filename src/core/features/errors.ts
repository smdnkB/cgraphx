/**
 * features 子系统错误层级。
 *
 * 与其它子系统的错误相互独立(直接继承 Error),子系统可整体移除。
 * 用户可以修复的错误,消息里带修复提示。
 */

import type { CheckReport } from './types';

export class FeaturesError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'FeaturesError';
  }
}

/** feature-id 精确 / 子串匹配都没有命中。 */
export class FeatureNotFoundError extends FeaturesError {
  constructor(public readonly query: string) {
    super(
      `找不到需求目录「${query}」,用 cgraphx features list --q <关键词> 查找`,
    );
    this.name = 'FeatureNotFoundError';
  }
}

/** feature-id 子串匹配命中多个需求目录。 */
export class FeatureAmbiguousError extends FeaturesError {
  constructor(
    public readonly query: string,
    public readonly candidates: string[],
  ) {
    super(
      `需求目录「${query}」命中多个候选:${candidates.join('、')};` +
        '请传完整的 feature-id',
    );
    this.name = 'FeatureAmbiguousError';
  }
}

/** check 的目标路径不存在。 */
export class CheckTargetNotFoundError extends FeaturesError {
  constructor(public readonly target: string) {
    super(
      `目标不存在:${target};请传 feature-id,或 docs/features/ 下的文件、目录路径`,
    );
    this.name = 'CheckTargetNotFoundError';
  }
}

/** check 同时传了 --staged 和目标参数。 */
export class CheckStagedWithTargetsError extends FeaturesError {
  constructor() {
    super('--staged 不能和目标参数一起用;要查指定文件或需求目录就去掉 --staged');
    this.name = 'CheckStagedWithTargetsError';
  }
}

/** 错误类型 → CLI 退出码(show / check 的「目标不存在」类为 2)。 */
export function exitCodeForError(err: unknown): number {
  if (err instanceof FeatureNotFoundError) return 2;
  if (err instanceof FeatureAmbiguousError) return 2;
  if (err instanceof CheckTargetNotFoundError) return 2;
  if (err instanceof CheckStagedWithTargetsError) return 2;
  return 1;
}

/** check 结果 → CLI 退出码:有失败为 1,只有警告或全部通过为 0。 */
export function exitCodeForCheckReport(report: CheckReport): number {
  return report.failures > 0 ? 1 : 0;
}
