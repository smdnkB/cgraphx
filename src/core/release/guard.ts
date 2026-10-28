/**
 * 版本分支提交拦截的装卸(spec D5、D12)。
 *
 * 拦截是 commit-msg 钩子里的一段 sh 片段(RELEASE_GUARD_LINES):当前分支是版本分支时,
 * 只放行合并提交和说明以 `chore(release):` 开头的提交。片段只经基础层 git-hooks 写进 git
 * 实际执行的钩子文件(跟随 core.hooksPath,spec D33);钩子文件是不是 shell 脚本也由它判定。
 *
 * 装过的记号记在本地 git 配置 `cgraphx.releaseGuard`:记号为 true 而片段不在(钩子文件被
 * husky 等工具覆盖、换了 core.hooksPath)→ 再装时报 repaired。另记「按版本走」的记号
 * `cgraphx.releaseFlow`:每次装都写,拦截没装上也写(spec D5),卸掉时一起清。
 */

import { execFileSync } from 'node:child_process';
import * as path from 'node:path';

import { installHookSnippet, removeHookSnippet, resolveHooksDir } from '../git-hooks';
import {
  RELEASE_FLOW_CONFIG_KEY,
  RELEASE_GUARD_CONFIG_KEY,
  RELEASE_GUARD_LINES,
  RELEASE_GUARD_MARKER,
} from './constants';
import { ReleaseError } from './errors';
import type { GuardResult } from './types';

/** 拦截所在的钩子。 */
const GUARD_HOOK = 'commit-msg';

/** 在 cwd 下跑 git,返回 stdout;出错(键不存在、不在仓库等)一律 → null。 */
function runGit(cwd: string, args: readonly string[]): string | null {
  try {
    return execFileSync('git', args, {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
  } catch {
    return null;
  }
}

function notGitRepoError(cwd: string): ReleaseError {
  return new ReleaseError(
    'not_git_repo',
    `${path.resolve(cwd)} 不在 git 仓库里,装不了版本分支提交拦截;到项目的 git 仓库里再执行 cgraphx release guard`,
  );
}

/** 装过的记号原来是不是 true。 */
function readGuardMark(cwd: string): boolean {
  return runGit(cwd, ['config', '--local', '--get', RELEASE_GUARD_CONFIG_KEY])?.trim() === 'true';
}

/**
 * 在 cwd 所在仓库的 commit-msg 钩子里装上提交拦截。不在 git 仓库 → 抛 ReleaseError(not_git_repo)。
 *
 * 先写「按版本走」的记号(拦截没装上也写);没写入 → 原样返回 unsupported(带 reason 和要加的几行),
 * 不写装过的记号;原来没有片段而装过的记号为 true → repaired;其余照基础层给的 status。装上(含
 * present)后写装过的记号。
 */
export function installReleaseGuard(cwd: string): GuardResult {
  if (resolveHooksDir(cwd) === null) throw notGitRepoError(cwd);
  // 两个记号写不进去(如 .git/config 正被别的 git 进程锁住)都不影响拦截本身
  runGit(cwd, ['config', '--local', RELEASE_FLOW_CONFIG_KEY, 'true']);
  const marked = readGuardMark(cwd);

  const snippet = installHookSnippet(cwd, GUARD_HOOK, RELEASE_GUARD_MARKER, RELEASE_GUARD_LINES);
  if (snippet === null) throw notGitRepoError(cwd);
  const { hookPath, localFilter } = snippet;
  if (snippet.status === 'unsupported') {
    return { hookPath, status: 'unsupported', localFilter, reason: snippet.reason, lines: snippet.lines };
  }

  const status: GuardResult['status'] =
    snippet.status === 'installed' && marked ? 'repaired' : snippet.status;
  runGit(cwd, ['config', '--local', RELEASE_GUARD_CONFIG_KEY, 'true']);
  return { hookPath, status, localFilter };
}

/**
 * 从 cwd 所在仓库的 commit-msg 钩子删掉提交拦截,并清掉两个记号(退出版本流程)。
 * 删过片段 → removed;没装过 → absent;不在 git 仓库 → absent,hookPath 为 null。
 */
export function removeReleaseGuard(cwd: string): GuardResult {
  const hooksDir = resolveHooksDir(cwd);
  if (hooksDir === null) return { hookPath: null, status: 'absent', localFilter: false };

  const removed = removeHookSnippet(cwd, GUARD_HOOK, RELEASE_GUARD_MARKER);
  // 没有这个键时 git 以非零退出,忽略
  runGit(cwd, ['config', '--local', '--unset', RELEASE_GUARD_CONFIG_KEY]);
  runGit(cwd, ['config', '--local', '--unset', RELEASE_FLOW_CONFIG_KEY]);
  return {
    hookPath: removed ?? path.join(hooksDir, GUARD_HOOK),
    status: removed === null ? 'absent' : 'removed',
    localFilter: false,
  };
}
