/**
 * 上报路径的安全判定与归一(spec §6「路径」:一律转成仓库内相对 POSIX 路径,转换不了的不上报)。
 *
 * 两套相对路径:`repoRel` 相对 `git rev-parse --show-toplevel`(上报用);
 * `projectRel` 相对项目根(产物分类、沉淀目录判断用)。
 */

import fs from 'node:fs';
import path from 'node:path';

/** 安全的相对路径:非空,不以 `/` 或 `~` 开头,不含 `\`,不含 `..` 段,不是盘符开头。 */
export function isSafeRelPath(p: string): boolean {
  if (p === '') return false;
  if (p.startsWith('/') || p.startsWith('~')) return false;
  if (p.includes('\\')) return false;
  if (/^[A-Za-z]:/.test(p)) return false;
  return !p.split('/').includes('..');
}

/** 一条路径同时给出的两种相对形式。 */
export interface RelPaths {
  repoRel: string;
  projectRel: string;
}

export interface PathResolver {
  /** 绝对路径(或相对 `cwd` 的路径)→ 两种相对形式;不在项目根内或不安全返回 null。 */
  fromAbs(p: string, cwd?: string): RelPaths | null;
  /** 仓库相对路径 → 两种相对形式;不在项目根内或不安全返回 null。 */
  fromRepoRel(repoRel: string): RelPaths | null;
  /** 项目相对路径 → 两种相对形式;不安全返回 null。 */
  fromProjectRel(projectRel: string): RelPaths | null;
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

export function createPathResolver(projectRoot: string, repoRoot: string): PathResolver {
  const project = path.resolve(projectRoot);
  const projectReal = realOrSelf(project);
  // 项目根在仓库内的相对位置('' 表示项目根即仓库根)
  const projectInRepo = toPosix(path.relative(realOrSelf(path.resolve(repoRoot)), projectReal));

  const fromProjectRel = (projectRel: string): RelPaths | null => {
    if (!isSafeRelPath(projectRel)) return null;
    const repoRel = projectInRepo === '' ? projectRel : `${projectInRepo}/${projectRel}`;
    return isSafeRelPath(repoRel) ? { repoRel, projectRel } : null;
  };

  return {
    fromAbs(p: string, cwd?: string): RelPaths | null {
      if (p === '') return null;
      const abs = path.isAbsolute(p) ? path.normalize(p) : path.resolve(cwd ?? project, p);
      const projectRel = relWithin(project, abs) ?? relWithin(projectReal, abs);
      return projectRel === null ? null : fromProjectRel(projectRel);
    },
    fromRepoRel(repoRel: string): RelPaths | null {
      if (!isSafeRelPath(repoRel)) return null;
      if (projectInRepo === '') return { repoRel, projectRel: repoRel };
      const prefix = `${projectInRepo}/`;
      if (!repoRel.startsWith(prefix)) return null;
      const projectRel = repoRel.slice(prefix.length);
      return isSafeRelPath(projectRel) ? { repoRel, projectRel } : null;
    },
    fromProjectRel,
  };
}
