/**
 * commit-gate 子系统错误层级。
 *
 * 与其它子系统的错误相互独立(直接继承 Error),子系统可整体移除。
 * 判定主体(runCommitGate)不抛错:任何异常都放行,退出码只有 0 / 3 的领域信号;这里的错误
 * 只用于装卸(installCommitGate / removeCommitGate)的前置条件不满足。
 */

export type CommitGateErrorCode = 'not_git_repo';

/** 各 code 的默认消息(带修复提示);调用方可传更具体的消息。 */
const DEFAULT_MESSAGES: Readonly<Record<CommitGateErrorCode, string>> = {
  not_git_repo: '当前目录不在 git 仓库里,装不了提交门禁;在项目的 git 仓库里再装(cgraphx install)',
};

export class CommitGateError extends Error {
  constructor(
    public readonly code: CommitGateErrorCode,
    message: string = DEFAULT_MESSAGES[code],
    options?: { cause?: unknown },
  ) {
    super(message, options);
    this.name = 'CommitGateError';
  }
}

/**
 * 错误类型 → CLI 退出码(not_git_repo → 2、其它 → 1)。
 * 门禁打回的退出码 3 是领域信号,不走这个映射(见 cli.ts 的例外说明)。
 */
export function exitCodeForError(err: unknown): number {
  if (err instanceof CommitGateError && err.code === 'not_git_repo') return 2;
  return 1;
}
