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
