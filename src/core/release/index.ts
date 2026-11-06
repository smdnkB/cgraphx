/**
 * release 子系统公共门面。
 *
 * 外部调用方必须用它 —— 不得直接伸手进内部模块。
 * 职责:版本流程的程序侧 —— 版本分支模式(spec K8),以及版本分支提交拦截(commit-msg 钩子片段)
 * 的装卸(spec D5、D12)。无 DB、不依赖 .cgraphx/ 初始化,只依赖基础层 git-hooks。
 * 命令注册 `registerReleaseCommands` 在 cli.ts。
 */

export { VERSION_BRANCH_PATTERN } from './constants';
// 「按版本走」的 git 配置键:commit-gate 门面按铁律经这里取,不直接 import release/constants.ts
export { RELEASE_FLOW_CONFIG_KEY } from './constants';
export type { GuardResult } from './types';
export { installReleaseGuard, removeReleaseGuard } from './guard';
export { ReleaseError, exitCodeForError } from './errors';
