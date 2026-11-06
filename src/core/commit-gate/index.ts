/**
 * commit-gate 子系统公共门面。
 *
 * 外部调用方必须用它 —— 不得直接伸手进内部模块。
 * 职责:agent 提交的 git commit-msg 钩子门禁(spec F2)—— 判定主体 runCommitGate(隐藏命令
 * `commit-gate-hook` 调用,退出码 0 放行 / 3 打回)、commit-msg 片段的装卸(install / uninstall
 * 消费;片段 marker 供 post-commit 链路判「钩子文件里有门禁片段」)。轻形态:无 DB、无 schema,
 * 只依赖基础层 git-hooks 与 release、agents 门面(产物检查经子进程,不 import features 门面)。
 * 命令注册 `registerCommitGateCommands` 在 cli.ts。
 */

export { COMMIT_GATE_HOOK, COMMIT_GATE_HOOK_COMMAND, COMMIT_GATE_MARKER } from './constants';
export { CommitGateError, exitCodeForError } from './errors';
export type { CommitGateInstallResult, CommitGateOutcome, CommitGateRemoveResult } from './gate';
export { installCommitGate, removeCommitGate, runCommitGate } from './gate';
