/**
 * 上报路径的安全判定与归一(spec §6「路径」:一律转成仓库内相对 POSIX 路径,转换不了的不上报)。
 *
 * 两套相对路径:`repoRel` 相对 `git rev-parse --show-toplevel`(上报用);
 * `projectRel` 相对项目根(产物分类、沉淀目录判断用)。
 *
 * 多根(spec D26):给了「主目录 + 全部登记过的副本」时,落在副本里的绝对路径相对那个副本算
 * 项目内路径;副本整仓复制、布局相同,`repoRel` 照旧按主目录的「项目根在仓库内的相对位置」拼。
 * 主目录里的路径、没有登记副本时,结果与不给 roots 逐字相同。
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
  /** 路径所在的根(主目录或副本)的绝对路径。 */
  root: string;
}

export interface PathResolver {
  /** 绝对路径(或相对 `cwd` 的路径)→ 两种相对形式;不在主目录或任何副本内、或不安全返回 null。 */
  fromAbs(p: string, cwd?: string): RelPaths | null;
  /** 仓库相对路径 → 两种相对形式;`root` 是路径所在的根(不传为主目录)。不在项目根内或不安全返回 null。 */
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
 * @param roots 主目录 + 全部登记过的副本(replica 门面 listProjectRoots)。不给、或其中没有副本时,
 *   只认主目录。
 */
export function createPathResolver(
  projectRoot: string,
  repoRoot: string,
  roots?: readonly ProjectRoot[],
): PathResolver {
  const project = path.resolve(projectRoot);
  const projectReal = realOrSelf(project);
  // 项目根在仓库内的相对位置('' 表示项目根即仓库根)
  const projectInRepo = toPosix(path.relative(realOrSelf(path.resolve(repoRoot)), projectReal));
  // 登记过副本才按多根定根;没有副本时不多算一次
  const multiRoots = roots !== undefined && roots.some((r) => r.replica !== null) ? roots : null;

  const fromProjectRel = (projectRel: string, root: string = project): RelPaths | null => {
    if (!isSafeRelPath(projectRel)) return null;
    const repoRel = projectInRepo === '' ? projectRel : `${projectInRepo}/${projectRel}`;
    return isSafeRelPath(repoRel) ? { repoRel, projectRel, root } : null;
  };

  return {
    fromAbs(p: string, cwd?: string): RelPaths | null {
      if (p === '') return null;
      const abs = path.isAbsolute(p) ? path.normalize(p) : path.resolve(cwd ?? project, p);
      if (multiRoots !== null) {
        const hit = matchProjectRoot(multiRoots, abs);
        if (hit !== null && hit.root.replica !== null) return fromProjectRel(hit.rel, hit.root.root);
      }
      // 主目录:照原来先比原样的项目根、再比 realpath 后的项目根
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

/**
 * 读文件用哪个根:副本目录还在就用它,已不在(副本删掉了)退回主目录;主目录本身不查。
 */
export function rootOrMain(root: string, mainRoot: string): string {
  if (root === mainRoot) return mainRoot;
  try {
    return fs.statSync(root, { throwIfNoEntry: false })?.isDirectory() === true ? root : mainRoot;
  } catch {
    return mainRoot;
  }
}
