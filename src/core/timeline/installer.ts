/**
 * timeline 子系统的项目级安装器:只往 git 钩子目录写提交记录片段(post-commit、post-merge,经
 * `../git-hooks` 写入:跟随 core.hooksPath,片段紧跟 shebang),不再读写 agent 配置——会话事件改由
 * 会话文件解析补录(spec:2026-11-06-会话文件解析替代hooks D17、D18),也绝不碰用户全局的 `~/.claude/`。
 *
 * 幂等:重复安装片段只留一份。可逆:卸载只删安装写入的内容,用户自己的钩子内容原样保留。
 *
 * 卸载只卸这个目录(spec:2026-11-05-数据按项目放用户目录 D31):不删数据(项目的数据用 `cgraphx project remove`
 * 删);git 钩子目录是同一仓库各个工作区共用的,同一仓库还有装着 cgraphx 的目录时 git 钩子片段留着,提交照样记。
 */

import * as path from 'node:path';

import { execSync } from 'node:child_process';

import { hookRemoveNotice, installHookSnippet, removeHookSnippet, resolveHooksDir, type HookSnippetResult } from '../git-hooks';
import { listOtherInstalledDirs } from '../repo-projects';
import {
  CHERRY_PICK_ENV,
  COMMIT_BRANCH_ENV,
  COMMIT_HOOK_ENV,
  COMMIT_REFLOG_ENV,
  COMMIT_SHA_ENV,
  GATE_TREE_ENV,
  GIT_COMMIT_SUBCOMMAND,
  REBASE_ENV,
} from './constants';
import { cleanDebrisCgraphxDirs } from './debris';

export interface InstallReport {
  projectRoot: string;
  /** post-commit 钩子文件路径;不在 git 仓库为 null。 */
  gitHookPath: string | null;
  /** post-commit 片段本次写了盘(status 为 installed 或 updated)。 */
  gitHookWritten: boolean;
  /** 本次安装顺手清理掉的碎片 `.cgraphx/` 目录(仅含 turn 文件的空壳)。 */
  debrisRemoved: string[];
  /** post-commit、post-merge 片段的写入结果,按此顺序;不在 git 仓库为 []。 */
  gitHooks: HookSnippetResult[];
}

export interface UninstallReport {
  projectRoot: string;
  /** post-commit 钩子文件路径;不在 git 仓库为 null。 */
  gitHookPath: string | null;
  /** 本次从 post-commit 钩子删掉了片段。 */
  gitHookRemoved: boolean;
  /** 本次从 post-merge 钩子删掉了片段。 */
  mergeHookRemoved: boolean;
  /** 片段是提交在被跟踪的钩子文件里的、没删时给人看的提示(spec D33④)。 */
  gitHookNotices: string[];
  /**
   * 同一仓库还装着 cgraphx 的别的目录(spec D31,C-2 listOtherInstalledDirs 的结果):非空时 git 钩子片段留着没动;
   * 删了钩子、或按 keepGitHook 没碰钩子时为 []。
   */
  gitHookKeptFor: string[];
}

/** Find the project's git toplevel, or null if not a git repo. */
function findGitRoot(projectRoot: string): string | null {
  try {
    const out = execSync('git rev-parse --show-toplevel', {
      cwd: projectRoot,
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'ignore'],
    });
    return out.trim() || null;
  } catch {
    return null;
  }
}

/** 片段每行都带的标记:升级与卸载按行精确删除,不碰用户自己的钩子内容。 */
const GIT_HOOK_MARKER = '# cgraphx-timeline-hook';

/**
 * 门禁上下文的前台取值(post-commit / post-merge 共用,每行带 marker):读出并删掉门禁记号
 * (commit-msg 门禁只要没打回就写的 `git write-tree` 输出,内容经 GATE_TREE_ENV 传给后台记录进程,
 * 由它判这笔提交走没走过门禁——前台读掉删掉是因为后台进程启动有延迟,连续快速提交时记号已被下一笔
 * 覆盖),再判 cherry-pick / rebase 是否在进行。命令替换与条件命令一律 `|| true`:
 * 片段紧跟 shebang,钩子是 `#!/bin/sh -e` 这类写法时,一条命令失败会让整个钩子提前退出,
 * 跳过原钩子后面的内容。
 */
function buildGateContextLines(): string[] {
  return [
    `__cgx_gitdir=$(git rev-parse --absolute-git-dir 2>/dev/null || true); __cgx_gate_tree=$([ -n "$__cgx_gitdir" ] && cat "$__cgx_gitdir/cgraphx/commit-gate-pass" 2>/dev/null || true); [ -n "$__cgx_gitdir" ] && rm -f "$__cgx_gitdir/cgraphx/commit-gate-pass" 2>/dev/null || true ${GIT_HOOK_MARKER}`,
    `__cgx_cherry=$([ -n "$__cgx_gitdir" ] && [ -e "$__cgx_gitdir/CHERRY_PICK_HEAD" ] && echo 1 || true); __cgx_rebase=$([ -n "$__cgx_gitdir" ] && { [ -d "$__cgx_gitdir/rebase-merge" ] || [ -d "$__cgx_gitdir/rebase-apply" ]; } && echo 1 || true) ${GIT_HOOK_MARKER}`,
  ];
}

/**
 * post-commit 片段:先在前台取得本次提交的 hash、分支与门禁上下文,再把记录进程放到后台。
 */
function buildGitPostCommitSnippet(): string[] {
  return [
    `${GIT_HOOK_MARKER} — record commit events to .cgraphx/cgraphx.db`,
    `__cgx_sha=$(git rev-parse HEAD 2>/dev/null || true); __cgx_branch=$(git symbolic-ref --short -q HEAD 2>/dev/null || true) ${GIT_HOOK_MARKER}`,
    ...buildGateContextLines(),
    `${COMMIT_SHA_ENV}="$__cgx_sha" ${COMMIT_BRANCH_ENV}="$__cgx_branch" ${GATE_TREE_ENV}="$__cgx_gate_tree" ${CHERRY_PICK_ENV}="$__cgx_cherry" ${REBASE_ENV}="$__cgx_rebase" cgraphx ${GIT_COMMIT_SUBCOMMAND} >/dev/null 2>&1 & ${GIT_HOOK_MARKER}`,
  ];
}

/**
 * post-merge 片段:`$1` 为 1 是 squash 合并(不产生提交),跳过;其余同 post-commit(hash、分支、
 * 门禁上下文都取),另传 COMMIT_HOOK_ENV=post-merge,并当场取 reflog 最新一行经 COMMIT_REFLOG_ENV
 * 传过去,记录进程据此跳过快进(快进不产生新提交;合并提交也不判门禁跳过,但上下文照传无害)。
 * hash 和 reflog 那一行用一条 `git log -g` 同时取(`--no-show-signature`:配了 log.showSignature 时
 * 不混进签名校验的输出);关掉了 reflog 取不到时 hash 退回 rev-parse。
 */
function buildGitPostMergeSnippet(): string[] {
  return [
    `${GIT_HOOK_MARKER} — record merge commits to .cgraphx/cgraphx.db`,
    `if [ "$1" != "1" ]; then ${GIT_HOOK_MARKER}`,
    `__cgx_r=$(git log -g -1 --no-show-signature --format='%H %gs' HEAD 2>/dev/null || true); __cgx_sha=\${__cgx_r%% *}; __cgx_reflog=\${__cgx_r#* }; [ -n "$__cgx_sha" ] || __cgx_sha=$(git rev-parse HEAD 2>/dev/null || true); __cgx_branch=$(git symbolic-ref --short -q HEAD 2>/dev/null || true) ${GIT_HOOK_MARKER}`,
    ...buildGateContextLines(),
    `${COMMIT_HOOK_ENV}=post-merge ${COMMIT_REFLOG_ENV}="$__cgx_reflog" ${COMMIT_SHA_ENV}="$__cgx_sha" ${COMMIT_BRANCH_ENV}="$__cgx_branch" ${GATE_TREE_ENV}="$__cgx_gate_tree" ${CHERRY_PICK_ENV}="$__cgx_cherry" ${REBASE_ENV}="$__cgx_rebase" cgraphx ${GIT_COMMIT_SUBCOMMAND} >/dev/null 2>&1 & ${GIT_HOOK_MARKER}`,
    `fi ${GIT_HOOK_MARKER}`,
  ];
}

export function installTimelineHooks(
  projectRoot: string,
  opts: { purgeFirst?: boolean } = {},
): InstallReport {
  const resolvedRoot = path.resolve(projectRoot);
  const gitRoot = findGitRoot(resolvedRoot);

  if (opts.purgeFirst) {
    uninstallTimelineHooks(resolvedRoot);
  }

  // git 钩子:post-commit 记普通提交和冲突后用 git commit 收尾的合并,post-merge 记 git merge
  // 直接生成的合并提交。已装的片段(含旧版写在文件末尾的、更早不带标记的调用行)先删掉,
  // 再插到 shebang 之后;内容未变则不写盘(幂等)。
  let commitHook: HookSnippetResult | null = null;
  let mergeHook: HookSnippetResult | null = null;
  if (gitRoot) {
    commitHook = installHookSnippet(gitRoot, 'post-commit', GIT_HOOK_MARKER, buildGitPostCommitSnippet(), {
      legacyMatch: GIT_COMMIT_SUBCOMMAND,
    });
    mergeHook = installHookSnippet(gitRoot, 'post-merge', GIT_HOOK_MARKER, buildGitPostMergeSnippet());
  }
  const gitHooks = [commitHook, mergeHook].filter((r): r is HookSnippetResult => r !== null);
  const gitHookWritten = commitHook !== null && (commitHook.status === 'installed' || commitHook.status === 'updated');

  // 存量碎片清理(spec §3.4):按签名精确匹配删除 cwd 漂移 bug 时代散落的
  // 空壳 `.cgraphx/`。幂等;失败只报 stderr,绝不中断安装。
  let debrisRemoved: string[] = [];
  try {
    debrisRemoved = cleanDebrisCgraphxDirs(resolvedRoot);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    process.stderr.write(`[timeline] debris clean failed: ${msg}\n`);
  }

  return {
    projectRoot: resolvedRoot,
    gitHookPath: commitHook?.hookPath ?? null,
    gitHookWritten,
    debrisRemoved,
    gitHooks,
  };
}

export function uninstallTimelineHooks(
  projectRoot: string,
  opts: { keepGitHook?: boolean } = {},
): UninstallReport {
  const resolvedRoot = path.resolve(projectRoot);
  const gitRoot = findGitRoot(resolvedRoot);
  const hooksDir = gitRoot ? resolveHooksDir(gitRoot) : null;
  const gitHookPath = hooksDir ? path.join(hooksDir, 'post-commit') : null;

  // git 钩子:keepGitHook(只卸指定 agent 的部分卸载)时保留;同一仓库还有装着 cgraphx 的目录时也
  // 保留——钩子目录是各个工作区共用的,删了那些目录的提交就记不上了(spec D31)。其余情况 post-commit
  // 连同旧版不带标记的调用行一起删
  const gitHookKeptFor = opts.keepGitHook ? [] : listOtherInstalledDirs(resolvedRoot);
  let gitHookRemoved = false;
  let mergeHookRemoved = false;
  const gitHookNotices: string[] = [];
  if (!opts.keepGitHook && gitHookKeptFor.length === 0 && gitRoot) {
    const commit = removeHookSnippet(gitRoot, 'post-commit', GIT_HOOK_MARKER, { legacyMatch: GIT_COMMIT_SUBCOMMAND });
    const merge = removeHookSnippet(gitRoot, 'post-merge', GIT_HOOK_MARKER);
    gitHookRemoved = commit?.status === 'removed';
    mergeHookRemoved = merge?.status === 'removed';
    for (const r of [commit, merge]) {
      const notice = r === null ? null : hookRemoveNotice(r, '提交记录片段');
      if (notice !== null) gitHookNotices.push(notice);
    }
  }

  return {
    projectRoot: resolvedRoot,
    gitHookPath,
    gitHookRemoved,
    mergeHookRemoved,
    gitHookNotices,
    gitHookKeptFor,
  };
}
