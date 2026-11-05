/**
 * 上报路径的安全判定与归一(spec §6「路径」:一律转成仓库内相对 POSIX 路径,转换不了的不上报)。
 *
 * 两套相对路径:`repoRel` 相对 `git rev-parse --show-toplevel`(上报用);
 * `projectRel` 相对项目根(产物分类、沉淀目录判断用)。
 *
 * 多根(spec:2026-11-05-数据按项目放用户目录 D11):给了 roots(timeline 记下的根 + 当前根 + 副本登记,
 * task 门面 collectProjectRoots)时,绝对路径落在哪个根里(取最长的根)就相对那个根算项目内路径;同一项目
 * 各根布局相同,`repoRel` 照旧按当前根的「项目根在仓库内的相对位置」拼。不落在任何根里的,照原来比当前根的
 * 原样路径和 realpath。
 */

import fs from 'node:fs';
import path from 'node:path';

import { matchProjectRoot, type ProjectRoot } from '../replica';

/** 安全的相对路径:非空,不以 `/` 或 `~` 开头,不含 `\`,不含 `..` 段,不是盘符开头。 */
export function isSafeRelPath(p: string): boolean {
  if (p === '') return false;
  if (p.startsWith('/') || p.startsWith('~')) return false;
  if (p.includes('\\')) return false;
  if (/^[A-Za-z]:/.test(p)) return false;
  return !p.split('/').includes('..');
}

/** 一条路径同时给出的两种相对形式,及它所在的根。 */
export interface RelPaths {
  repoRel: string;
  projectRel: string;
  /** 路径所在的根(当前根、timeline 记下的根或副本)的绝对路径。 */
  root: string;
}

export interface PathResolver {
  /** 项目根在仓库内的相对位置(POSIX 分隔,'' 表示项目根即仓库根);按当前根算,同一项目各根相同。 */
  readonly projectInRepo: string;
  /** 绝对路径(或相对 `cwd` 的路径)→ 两种相对形式;不在当前根或任何根内、或不安全返回 null。 */
  fromAbs(p: string, cwd?: string): RelPaths | null;
  /** 仓库相对路径 → 两种相对形式;`root` 是路径所在的根(不传为当前根)。不在项目根内或不安全返回 null。 */
  fromRepoRel(repoRel: string, root?: string): RelPaths | null;
  /** 项目相对路径 → 两种相对形式;`root` 同上。不安全返回 null。 */
  fromProjectRel(projectRel: string, root?: string): RelPaths | null;
}

function toPosix(p: string): string {
  return p.split(path.sep).join('/');
}

function realOrSelf(p: string): string {
  try {
    return fs.realpathSync(p);
  } catch {
    return p;
  }
}

/** 相对 root 的 POSIX 路径;不在 root 内返回 null。 */
function relWithin(root: string, abs: string): string | null {
  const rel = path.relative(root, abs);
  if (rel === '' || rel.startsWith('..') || path.isAbsolute(rel)) return null;
  return toPosix(rel);
}

/**
 * @param projectRoot 当前根。
 * @param roots timeline 记下的根 + 当前根 + 副本登记(task 门面 collectProjectRoots)。不给或为空时,
 *   只认当前根。
 */
export function createPathResolver(
  projectRoot: string,
  repoRoot: string,
  roots?: readonly ProjectRoot[],
): PathResolver {
  const project = path.resolve(projectRoot);
  const projectReal = realOrSelf(project);
  // 项目根在仓库内的相对位置('' 表示项目根即仓库根);同一项目各根的相对位置相同,按当前根算
  const projectInRepo = toPosix(path.relative(realOrSelf(path.resolve(repoRoot)), projectReal));
  const matchRoots = roots !== undefined && roots.length > 0 ? roots : null;

  const fromProjectRel = (projectRel: string, root: string = project): RelPaths | null => {
    if (!isSafeRelPath(projectRel)) return null;
    const repoRel = projectInRepo === '' ? projectRel : `${projectInRepo}/${projectRel}`;
    return isSafeRelPath(repoRel) ? { repoRel, projectRel, root } : null;
  };

  return {
    projectInRepo,
    fromAbs(p: string, cwd?: string): RelPaths | null {
      if (p === '') return null;
      const abs = path.isAbsolute(p) ? path.normalize(p) : path.resolve(cwd ?? project, p);
      // 落在某个根里(取最长的根):相对那个根算项目内路径
      if (matchRoots !== null) {
        const hit = matchProjectRoot(matchRoots, abs);
        if (hit !== null) return fromProjectRel(hit.rel, hit.root.root);
      }
      // 哪个根都不中:照原来先比原样的当前根、再比 realpath 后的当前根
      const projectRel = relWithin(project, abs) ?? relWithin(projectReal, abs);
      return projectRel === null ? null : fromProjectRel(projectRel);
    },
    fromRepoRel(repoRel: string, root: string = project): RelPaths | null {
      if (!isSafeRelPath(repoRel)) return null;
      if (projectInRepo === '') return { repoRel, projectRel: repoRel, root };
      const prefix = `${projectInRepo}/`;
      if (!repoRel.startsWith(prefix)) return null;
      const projectRel = repoRel.slice(prefix.length);
      return isSafeRelPath(projectRel) ? { repoRel, projectRel, root } : null;
    },
    fromProjectRel,
  };
}

/** p 是目录(跟随链接);不在、读不了 → false。 */
export function isDirectory(p: string): boolean {
  try {
    return fs.statSync(p, { throwIfNoEntry: false })?.isDirectory() === true;
  } catch {
    return false;
  }
}

/**
 * 读文件用哪个根:这个根的目录还在就用它,不在(副本删掉了、别的 clone 挪走了)退回当前根;当前根本身不查。
 */
export function rootOrCurrent(root: string, currentRoot: string): string {
  if (root === currentRoot) return currentRoot;
  return isDirectory(root) ? root : currentRoot;
}
