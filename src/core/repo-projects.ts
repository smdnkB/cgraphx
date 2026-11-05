/**
 * 一个 git 仓库里的项目(spec:2026-11-05-数据按项目放用户目录 D9、D19、D31)
 *
 * - git 钩子按工作区根列出这个仓库的项目:从工作区根按 D2 认的根,加上本地 git 配置里记了名字的子目录项目
 *   (`[cgraphx "<子目录>"] projectName`);只跑一次配置读取,读完把各根的标识填进进程内记忆
 * - 改名影响到的根:这个根,加上同一仓库各个工作区里同一相对位置的根
 * - 卸载时「还有别的装着的」:同一仓库各个工作区里,工作区根或记了名字的子目录有 `.cgraphx/cgraphx.db` 的目录
 */

import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';

import { findProjectRoot } from './data-location';
import { isInitialized } from './directory';
import { identityOfRoot, readGitConfig, rememberRootIdentity, type ProjectIdentity } from './project-identity';

export interface RepoProject { root: string; identity: ProjectIdentity; subdir: string | null }

/** 装过(`.cgraphx/cgraphx.db` 在);判断出错按没装过。 */
function isInstalled(dir: string): boolean {
  try {
    return isInitialized(dir);
  } catch {
    return false;
  }
}

function realpathOrResolve(p: string): string {
  try {
    return fs.realpathSync(p);
  } catch {
    return path.resolve(p);
  }
}

/** POSIX 子目录拼到工作区根上。 */
function joinSubdir(workTreeRoot: string, subdir: string): string {
  return path.join(workTreeRoot, ...subdir.split('/'));
}

/** `git worktree list --porcelain` 列出的各个工作区根;git 出错 → null。 */
function listWorktreeRoots(cwd: string): string[] | null {
  let out: string;
  try {
    out = execFileSync('git', ['worktree', 'list', '--porcelain'], {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
  } catch {
    return null;
  }
  const roots: string[] = [];
  for (const line of out.split(/\r?\n/)) {
    if (line.startsWith('worktree ')) roots.push(path.resolve(line.slice('worktree '.length)));
  }
  return roots;
}

/**
 * spec D9:工作区根 T 的项目——T 按 D2 认的根(有标识时,subdir 为 null)+ 本地 git 配置里记了名字的子目录项目;
 * 只跑一次配置读取,读完把各根的标识填进进程内记忆。git 出错 → 'git-error'。
 */
export function listRepoProjects(workTreeRoot: string): RepoProject[] | 'git-error' {
  const top = path.resolve(workTreeRoot);
  const config = readGitConfig(top);
  if (config === 'git-error') return 'git-error';
  const projects: RepoProject[] = [];
  const base = findProjectRoot(top);
  if (base !== null) {
    // base 就是 T 时标识从刚读的那份配置里算(同一工作区的配置已记住,不再跑 git)
    const info = identityOfRoot(base);
    if (info === 'git-error') return 'git-error';
    if (info.identity !== null) {
      projects.push({ root: base, identity: info.identity, subdir: null });
      rememberRootIdentity(base, info.identity);
    }
  }
  for (const [subdir, name] of config.subdirNames) {
    const root = joinSubdir(top, subdir);
    const identity: ProjectIdentity = { origin: config.origin, name };
    projects.push({ root, identity, subdir });
    rememberRootIdentity(root, identity);
  }
  return projects;
}

/**
 * spec D19:受影响的根——这个根,加上同一仓库各个工作区(`git worktree list --porcelain`)里同一相对位置的根,
 * 按 realpath 去重(这个根排第一个)。不在 git 里、git 出错 → 只有它自己。
 */
export function listSiblingRoots(root: string): string[] {
  const resolved = path.resolve(root);
  const info = identityOfRoot(resolved);
  if (info === 'git-error' || info.workTreeRoot === null) return [resolved];
  const worktrees = listWorktreeRoots(resolved);
  if (worktrees === null) return [resolved];
  const roots = [resolved];
  const seen = new Set([realpathOrResolve(resolved)]);
  for (const worktree of worktrees) {
    const sibling = info.subdir === null ? worktree : joinSubdir(worktree, info.subdir);
    const real = realpathOrResolve(sibling);
    if (seen.has(real)) continue;
    seen.add(real);
    roots.push(sibling);
  }
  return roots;
}

/**
 * spec D31:同一仓库各个工作区里,工作区根或配置里记了名字的子目录有 `.cgraphx/cgraphx.db` 的目录,不含 root 本身
 * (按 realpath 比)。不在 git 里、git 出错 → []。
 */
export function listOtherInstalledDirs(root: string): string[] {
  const resolved = path.resolve(root);
  const info = identityOfRoot(resolved);
  if (info === 'git-error' || info.workTreeRoot === null) return [];
  const worktrees = listWorktreeRoots(resolved);
  if (worktrees === null) return [];
  const config = readGitConfig(resolved);
  if (config === 'git-error') return [];
  const subdirs = [...config.subdirNames.keys()];
  const seen = new Set([realpathOrResolve(resolved)]);
  const dirs: string[] = [];
  for (const worktree of worktrees) {
    for (const dir of [worktree, ...subdirs.map((subdir) => joinSubdir(worktree, subdir))]) {
      const real = realpathOrResolve(dir);
      if (seen.has(real)) continue;
      seen.add(real);
      if (isInstalled(dir)) dirs.push(dir);
    }
  }
  return dirs;
}
