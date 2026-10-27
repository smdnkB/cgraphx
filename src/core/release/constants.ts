/**
 * release 子系统常量。
 */

/** 版本分支(spec K8):`dev/<主版本>.<次版本>.<修订号>`;与 RELEASE_GUARD_LINES 里 grep 的模式一致。 */
export const VERSION_BRANCH_PATTERN: RegExp = /^dev\/[0-9]+\.[0-9]+\.[0-9]+$/;

/** 提交拦截片段每行都带的标记:重装时按它先删旧行,卸载时按它删行。 */
export const RELEASE_GUARD_MARKER = '# cgraphx-release-guard';

/**
 * commit-msg 钩子片段(spec D12),三行逐字,紧跟钩子文件的 shebang 插入。
 *
 * 当前分支是版本分支时,只放行合并提交(有 MERGE_HEAD)和说明首行以 `chore(release):` 开头的提交,
 * 其余提交打一行提示后 `exit 1` 挡下;不在版本分支、detached HEAD 时什么都不做。
 * 片段每次提交都会执行:只在违规时 exit;命令替换写成 `$(… || true)`,钩子用 `#!/bin/sh -e`
 * 这类写法时也不会提前退出;不调 cgraphx、node。
 */
export const RELEASE_GUARD_LINES: readonly string[] = [
  '# cgraphx-release-guard — 版本分支只收合并提交和 chore(release): 开头的提交',
  '__cgx_rb=$(git symbolic-ref --short -q HEAD 2>/dev/null || true) # cgraphx-release-guard',
  String.raw`if printf '%s' "$__cgx_rb" | grep -Eq '^dev/[0-9]+\.[0-9]+\.[0-9]+$' && ! git rev-parse -q --verify MERGE_HEAD >/dev/null 2>&1 && ! head -n 1 "$1" | grep -q '^chore(release):'; then echo "[cgraphx] $__cgx_rb 是版本分支:需求改动到副本里做(/dev-start <需求>);整个版本的改动以 chore(release): 开头提交" >&2; exit 1; fi # cgraphx-release-guard`,
];

/** 装过拦截的记号:本地 git 配置键,装上后值为 true(spec D5)。 */
export const RELEASE_GUARD_CONFIG_KEY = 'cgraphx.releaseGuard';
