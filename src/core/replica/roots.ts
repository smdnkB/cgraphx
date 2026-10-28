/**
 * 主目录与副本的路径换算(spec D25、D26,plan C-4)。
 *
 * timeline 原样记绝对路径和 cwd;读取方(task、sync、features)经这里按「主目录 + 全部登记过的
 * 副本(含已删除)」换算:取包含该路径的最长根,得出项目内路径。各函数入口先把项目根换成主目录,
 * 在主目录、副本里调用结果相同。没有登记任何副本时,只有主目录一个根。
 */

import * as fs from 'node:fs';
import * as path from 'node:path';

import { resolveDataDir } from '../directory';
import { FEATURES_DIR_POSIX } from './constants';
import { readEntries } from './registry';
import type { ProjectRoot, ReplicaEntry } from './types';

/** 主目录(= resolveDataDir(projectRoot).mainRoot):在副本里是链接目标的上级目录,否则是项目根本身。 */
export function resolveMainRoot(projectRoot: string): string {
  return resolveDataDir(projectRoot).mainRoot;
}

/** createdAt 升序;同一时刻按副本目录名。 */
function byCreatedAt(a: ReplicaEntry, b: ReplicaEntry): number {
  if (a.createdAt !== b.createdAt) return a.createdAt < b.createdAt ? -1 : 1;
  if (a.name !== b.name) return a.name < b.name ? -1 : 1;
  return 0;
}

/** 主目录的登记,按 createdAt 升序;includeRemoved 为假时去掉已删除的。 */
function entriesOf(mainRoot: string, includeRemoved: boolean): ReplicaEntry[] {
  return readEntries(mainRoot)
    .filter((e) => includeRemoved || e.removedAt === null)
    .sort(byCreatedAt);
}

/** 登记过的副本;默认不含已删除的(removedAt 非空),按 createdAt 升序。 */
export function listReplicas(
  projectRoot: string,
  opts: { includeRemoved?: boolean } = {},
): ReplicaEntry[] {
  return entriesOf(resolveMainRoot(projectRoot), opts.includeRemoved === true);
}

/** realpath;失败(目录不在等)时原样返回。replica 内部共用。 */
export function realpathOr(p: string): string {
  try {
    return fs.realpathSync(p);
  } catch {
    return p;
  }
}

/**
 * 主目录加全部登记(含已删除),按 root 路径长度降序:依次匹配时第一个命中的就是最长的根。
 * 每个根的 realpath 在这里算一次,matchProjectRoot、replicaOfCwd 不再给根算。
 */
export function listProjectRoots(projectRoot: string): ProjectRoot[] {
  const mainRoot = resolveMainRoot(projectRoot);
  const roots: ProjectRoot[] = [{ root: mainRoot, realRoot: realpathOr(mainRoot), replica: null }];
  for (const entry of entriesOf(mainRoot, true)) {
    const root = path.resolve(entry.path);
    roots.push({ root, realRoot: realpathOr(root), replica: entry });
  }
  // sort 是稳定排序:长度相同时保持主目录在前、副本按 createdAt
  return roots.sort((a, b) => b.root.length - a.root.length);
}

/** p 在 root 之内时返回相对路径;allowSelf 为真时 p 等于 root 也算(返回 '')。replica 内部共用。 */
export function relativeInside(root: string, p: string, allowSelf: boolean): string | null {
  const rel = path.relative(root, p);
  if (rel === '') return allowSelf ? '' : null;
  if (rel === '..' || rel.startsWith(`..${path.sep}`) || path.isAbsolute(rel)) return null;
  return rel;
}

/**
 * p(已 resolve)在 root 之内时返回相对路径。按字符串前缀比、不拼接新串:Stop hook 每轮要比上万次,
 * path.relative 和临时拼的前缀串都是这里的大头。
 */
function insideByPrefix(root: string, p: string, allowSelf: boolean): string | null {
  if (p === root) return allowSelf ? '' : null;
  if (root.endsWith(path.sep)) return p.startsWith(root) ? p.slice(root.length) : null;
  return p.length > root.length && p[root.length] === path.sep && p.startsWith(root) ? p.slice(root.length + 1) : null;
}

/**
 * 目录 → realpath 的缓存:一个会话的路径大多落在少数几个目录里,不必每条都做一次 realpath
 * (路径不在时 realpath 还要抛错,更慢)。只增不删,超过上限整个清掉,长驻进程里也不会无限涨。
 */
const dirRealpathCache = new Map<string, string>();
const DIR_REALPATH_CACHE_LIMIT = 4096;

/** 目录的 realpath;目录不在时取最近一级在的上级做 realpath 再拼回去。结果进缓存。 */
function realDir(dir: string): string {
  const cached = dirRealpathCache.get(dir);
  if (cached !== undefined) return cached;
  let real: string;
  try {
    real = fs.realpathSync(dir);
  } catch {
    const parent = path.dirname(dir);
    real = parent === dir ? dir : path.join(realDir(parent), path.basename(dir));
  }
  if (dirRealpathCache.size >= DIR_REALPATH_CACHE_LIMIT) dirRealpathCache.clear();
  dirRealpathCache.set(dir, real);
  return real;
}

/**
 * 先按各根的原样路径找,都不中时才取 absPath 所在目录的 realpath(带缓存)拼回文件名,再与各 realRoot
 * 比一次。根的 realpath 不在这里算(listProjectRoots 已算好)。
 */
function findRoot(
  roots: readonly ProjectRoot[],
  absPath: string,
  allowSelf: boolean,
): { root: ProjectRoot; rel: string } | null {
  const resolved = path.resolve(absPath);
  for (const root of roots) {
    const rel = insideByPrefix(root.root, resolved, allowSelf);
    if (rel !== null) return { root, rel };
  }
  const real = path.join(realDir(path.dirname(resolved)), path.basename(resolved));
  if (real === resolved) return null;
  for (const root of roots) {
    const rel = insideByPrefix(root.realRoot, real, allowSelf);
    if (rel !== null) return { root, rel };
  }
  return null;
}

/** POSIX 分隔的相对路径。 */
function toPosix(rel: string): string {
  return path.sep === '/' ? rel : rel.split(path.sep).join('/');
}

/** absPath 落在哪个根里(取最长的),rel 为根下的项目内路径(POSIX 分隔);都不在 → null。 */
export function matchProjectRoot(
  roots: readonly ProjectRoot[],
  absPath: string,
): { root: ProjectRoot; rel: string } | null {
  const hit = findRoot(roots, absPath, false);
  return hit === null ? null : { root: hit.root, rel: toPosix(hit.rel) };
}

/** cwd 所在的副本(cwd 等于副本根也算);在主目录里或都不在 → null。 */
export function replicaOfCwd(roots: readonly ProjectRoot[], cwd: string): ReplicaEntry | null {
  return findRoot(roots, cwd, true)?.root.replica ?? null;
}

/** p 是目录(跟随链接);不在、读不了 → false。replica 内部共用。 */
export function isDirectory(p: string): boolean {
  try {
    return fs.statSync(p, { throwIfNoEntry: false })?.isDirectory() === true;
  } catch {
    return false;
  }
}

/** `<root>/docs/features/<featureId>` 的绝对路径。replica 内部共用。 */
export function featureDirOf(root: string, featureId: string): string {
  return path.join(root, ...FEATURES_DIR_POSIX.split('/'), featureId);
}

/**
 * 需求目录在哪个根里:先找主目录,再找第一个没删、featureId 相同、目录里有这个需求目录的副本
 * (按 createdAt 升序);都没有 → null。
 */
export function locateFeatureRoot(projectRoot: string, featureId: string): string | null {
  const mainRoot = resolveMainRoot(projectRoot);
  if (isDirectory(featureDirOf(mainRoot, featureId))) return mainRoot;
  for (const entry of entriesOf(mainRoot, false)) {
    if (entry.featureId === featureId && isDirectory(featureDirOf(entry.path, featureId))) {
      return path.resolve(entry.path);
    }
  }
  return null;
}
