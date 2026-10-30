/**
 * release 子系统错误层级。
 *
 * 与其它子系统的错误相互独立(直接继承 Error),子系统可整体移除。
 * CLI 层经 exitCodeForError 映射退出码:not_git_repo → 2、其它 → 1。
 */

export type ReleaseErrorCode = 'not_git_repo';

/** 各 code 的默认消息(带修复提示);调用方可传更具体的消息。 */
const DEFAULT_MESSAGES: Readonly<Record<ReleaseErrorCode, string>> = {
  not_git_repo: '当前目录不在 git 仓库里,装不了版本分支提交拦截;到项目的 git 仓库里再执行 cgraphx release guard',
};

export class ReleaseError extends Error {
  constructor(
    public readonly code: ReleaseErrorCode,
    message: string = DEFAULT_MESSAGES[code],
    options?: { cause?: unknown },
  ) {
    super(message, options);
    this.name = 'ReleaseError';
  }
}

/** 错误类型 → CLI 退出码。 */
export function exitCodeForError(err: unknown): number {
  if (err instanceof ReleaseError && err.code === 'not_git_repo') return 2;
  return 1;
}
