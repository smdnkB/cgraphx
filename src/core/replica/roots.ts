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
 * 主目录加全部登记(含已删除),按 root 路径长度降序(嵌套的根里更深的在前;按顺序遍历的读者靠它)。
 * 同一路径取哪条由查找表定(preferRoot)。每个根的 realpath 在这里算一次(走目录缓存,已删副本的目录
 * 不在也不抛错),matchProjectRoot、replicaOfCwd 不再给根算。
 */
export function listProjectRoots(projectRoot: string): ProjectRoot[] {
  const mainRoot = resolveMainRoot(projectRoot);
  const roots: ProjectRoot[] = [{ root: mainRoot, realRoot: realDir(mainRoot), replica: null }];
  for (const entry of entriesOf(mainRoot, true)) {
    const root = path.resolve(entry.path);
    roots.push({ root, realRoot: realDir(root), replica: entry });
  }
  // 稳定排序:长度相同时主目录在前、副本按 createdAt
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
 * 目录 → realpath 的缓存:一个会话的路径大多落在少数几个目录里,不必每条都做一次 realpath。只增不删,
 * 超过上限整个清掉,长驻进程里也不会无限涨。
 */
const dirRealpathCache = new Map<string, string>();
const DIR_REALPATH_CACHE_LIMIT = 4096;

/**
 * 目录的 realpath;目录不在时取最近一级在的上级做 realpath 再拼回去(先查在不在:已删副本的目录、
 * 删掉的文件所在目录很常见,realpath 抛错比查一次慢得多)。结果进缓存。
 */
function realDir(dir: string): string {
  const cached = dirRealpathCache.get(dir);
  if (cached !== undefined) return cached;
  let real: string;
  const parent = path.dirname(dir);
  if (fs.existsSync(dir)) {
    try {
      real = fs.realpathSync(dir);
    } catch {
      real = dir;
    }
  } else {
    real = parent === dir ? dir : path.join(realDir(parent), path.basename(dir));
  }
  if (dirRealpathCache.size >= DIR_REALPATH_CACHE_LIMIT) dirRealpathCache.clear();
  dirRealpathCache.set(dir, real);
  return real;
}

/** 根路径 → 根的查找表(原样路径、realpath 各一张);同一路径登记过多次时取在用的,都删了取最新的。 */
interface RootIndex {
  byRoot: Map<string, ProjectRoot>;
  byReal: Map<string, ProjectRoot>;
}

/** 每份 roots 只建一次查找表;roots 是 listProjectRoots 的返回,调用方整轮复用同一份。 */
const rootIndexCache = new WeakMap<readonly ProjectRoot[], RootIndex>();

function preferRoot(current: ProjectRoot | undefined, next: ProjectRoot): ProjectRoot {
  if (current === undefined) return next;
  const curInUse = current.replica === null || current.replica.removedAt === null;
  const nextInUse = next.replica === null || next.replica.removedAt === null;
  if (curInUse !== nextInUse) return curInUse ? current : next;
  return (next.replica?.createdAt ?? '') > (current.replica?.createdAt ?? '') ? next : current;
}

function rootIndexOf(roots: readonly ProjectRoot[]): RootIndex {
  const cached = rootIndexCache.get(roots);
  if (cached !== undefined) return cached;
  const byRoot = new Map<string, ProjectRoot>();
  const byReal = new Map<string, ProjectRoot>();
  for (const root of roots) {
    byRoot.set(root.root, preferRoot(byRoot.get(root.root), root));
    byReal.set(root.realRoot, preferRoot(byReal.get(root.realRoot), root));
  }
  const index = { byRoot, byReal };
  rootIndexCache.set(roots, index);
  return index;
}

/**
 * 从 p 逐级往上找第一个是根的目录(最近的就是最长的根);allowSelf 为假时 p 本身不算。
 * 只看路径深度,和登记了多少副本无关:Stop hook 每轮要换算上万条路径。
 */
function walkUp(table: Map<string, ProjectRoot>, p: string, allowSelf: boolean): { root: ProjectRoot; rel: string } | null {
  let dir = allowSelf ? p : path.dirname(p);
  for (;;) {
    const root = table.get(dir);
    if (root !== undefined) {
      if (dir === p) return { root, rel: '' };
      const rel = dir.endsWith(path.sep) ? p.slice(dir.length) : p.slice(dir.length + 1);
      return { root, rel };
    }
    const parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

/**
 * 先按各根的原样路径找,都不中时再取 absPath 所在目录的 realpath(带缓存)拼回文件名,和各根的
 * realpath 比:根以经链接的路径给出、而查询路径已是真实路径时也对得上。
 */
function findRoot(
  roots: readonly ProjectRoot[],
  absPath: string,
  allowSelf: boolean,
): { root: ProjectRoot; rel: string } | null {
  const resolved = path.resolve(absPath);
  const index = rootIndexOf(roots);
  const literal = walkUp(index.byRoot, resolved, allowSelf);
  if (literal !== null) return literal;
  const real = path.join(realDir(path.dirname(resolved)), path.basename(resolved));
  return walkUp(index.byReal, real, allowSelf);
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
 * 需求目录在哪个根里(spec D26):先找没删、featureId 相同、目录里有这个需求目录的副本(按 createdAt
 * 升序取第一个)——副本里那份是正在改的,和 features list 取副本那份(D30)同一口径;开副本后主目录
 * 留下的空壳(被忽略的文件、空子目录)也就不影响查找。没有再找主目录;都没有 → null。
 * roots 是 listProjectRoots 的返回,调用方整轮复用,不再每次读登记。
 */
export function locateFeatureRoot(roots: readonly ProjectRoot[], featureId: string): string | null {
  const replicas = roots
    .flatMap(({ replica }) => (replica !== null && replica.removedAt === null && replica.featureId === featureId ? [replica] : []))
    .sort(byCreatedAt);
  for (const entry of replicas) {
    if (isDirectory(featureDirOf(entry.path, featureId))) return path.resolve(entry.path);
  }
  const main = roots.find(({ replica }) => replica === null)?.root;
  return main !== undefined && isDirectory(featureDirOf(main, featureId)) ? main : null;
}
