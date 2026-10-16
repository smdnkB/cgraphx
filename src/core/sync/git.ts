/**
 * sync 用到的 git 只读查询。失败一律返回 null,不抛错、不输出。
 */

import { execFileSync } from 'node:child_process';

function runGit(cwd: string, args: string[]): string | null {
  try {
    const out = execFileSync('git', args, { cwd, stdio: ['ignore', 'pipe', 'ignore'] });
    const text = out.toString('utf-8').trim();
    return text === '' ? null : text;
  } catch {
    return null;
  }
}

/** `origin` 远程地址;没有 origin 或不在 git 仓库内返回 null。 */
export function getOriginUrl(projectRoot: string): string | null {
  return runGit(projectRoot, ['remote', 'get-url', 'origin']);
}

/** 仓库根目录(`git rev-parse --show-toplevel`);不在 git 仓库内返回 null。 */
export function getRepoToplevel(projectRoot: string): string | null {
  return runGit(projectRoot, ['rev-parse', '--show-toplevel']);
}

// ─── GitCache:一轮同步内复用的 git 只读查询 ────────────────────────────────

/** 一轮同步内的 git 查询缓存(按 hash / 首次载入缓存,不跨轮复用)。 */
export interface GitCache {
  /** 该 commit 是否已在任意远程分支上(`git branch -r --contains`,以本机最近一次同步远程后的状态为准)。 */
  isOnRemote(hash: string): boolean;
  /** 该 commit 是否新增了 `repoRel`(仓库相对 POSIX 路径)。 */
  fileAddedIn(hash: string, repoRel: string): boolean;
  /** `repoRel` 当前是否被 git 跟踪。 */
  isTracked(repoRel: string): boolean;
}

/** 原样取 stdout(不 trim);失败返回 null。`core.quotePath=false` 保证非 ASCII 路径不被转义。 */
function runGitRaw(cwd: string, args: string[]): string | null {
  try {
    const out = execFileSync('git', ['-c', 'core.quotePath=false', ...args], {
      cwd,
      stdio: ['ignore', 'pipe', 'ignore'],
      maxBuffer: 256 * 1024 * 1024,
    });
    return out.toString('utf-8');
  } catch {
    return null;
  }
}

export function createGitCache(repoRoot: string): GitCache {
  const onRemote = new Map<string, boolean>();
  const addedFiles = new Map<string, Set<string>>();
  let tracked: Set<string> | null = null;

  return {
    isOnRemote(hash: string): boolean {
      const hit = onRemote.get(hash);
      if (hit !== undefined) return hit;
      const out = runGitRaw(repoRoot, ['branch', '-r', '--contains', hash]);
      const result = out !== null && out.trim() !== '';
      onRemote.set(hash, result);
      return result;
    },
    fileAddedIn(hash: string, repoRel: string): boolean {
      let files = addedFiles.get(hash);
      if (files === undefined) {
        const out = runGitRaw(repoRoot, ['show', '--diff-filter=A', '--name-only', '--format=', hash]);
        files = new Set((out ?? '').split('\n').filter((line) => line !== ''));
        addedFiles.set(hash, files);
      }
      return files.has(repoRel);
    },
    isTracked(repoRel: string): boolean {
      if (tracked === null) {
        const out = runGitRaw(repoRoot, ['ls-files', '-z']);
        tracked = new Set((out ?? '').split('\0').filter((p) => p !== ''));
      }
      return tracked.has(repoRel);
    },
  };
}
