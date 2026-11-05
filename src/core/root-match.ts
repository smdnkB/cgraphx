/**
 * 根匹配(spec:2026-11-05-数据按项目放用户目录 D11、D12)
 *
 * 一个绝对路径落在哪个根里(取最长的),以及它在根下的项目内路径。timeline 统计的文件排行
 * 共用;timeline 不能依赖 replica,所以放在基础层。纯函数加一份目录 realpath 缓存,不读登记、不跑 git。
 */

import * as fs from 'node:fs';
import * as path from 'node:path';

export interface RootMatch { root: string; rel: string }   // rel 为 POSIX 分隔;等于根本身时为 ''
export interface RootMatcher { match(absPath: string, opts?: { allowSelf?: boolean }): RootMatch | null }

/**
 * 目录 → realpath 的缓存:一个会话的路径大多落在少数几个目录里,不必每条都做一次 realpath。只增不删,超过上限
 * 整个清掉,长驻进程里也不会无限涨。
 */
const dirRealpathCache = new Map<string, string>();
const DIR_REALPATH_CACHE_LIMIT = 4096;

/**
 * 目录的 realpath;目录不在时取最近一级在的上级做 realpath 再拼回去(先查在不在:已删副本的目录、删掉的文件所在
 * 目录很常见,realpath 抛错比查一次慢得多)。结果进缓存。
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

/**
 * 从 p 逐级往上找第一个是根的目录(最近的就是最长的根);allowSelf 为假时 p 本身不算。只看路径深度,和根有多少个
 * 无关:Stop hook 每轮要换算上万条路径。
 */
function walkUp(table: ReadonlyMap<string, string>, p: string, allowSelf: boolean): { root: string; rel: string } | null {
  let dir = p;
  if (!allowSelf) {
    const parent = path.dirname(p);
    if (parent === p) return null;
    dir = parent;
  }
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

/** POSIX 分隔的相对路径。 */
function toPosix(rel: string): string {
  return path.sep === '/' ? rel : rel.split(path.sep).join('/');
}

/**
 * 取包含 absPath 的最长的根:先按原样路径逐级往上查根表,对不上再取 absPath 所在目录的 realpath(带缓存,目录不在
 * 取最近一级在的上级)逐级查根的 realpath 表;allowSelf 为假时 absPath 等于根不算。返回的 root 是传入的根
 * path.resolve 后的写法;同一个根传了几次(含 realpath 相同的)取第一次的。
 */
export function createRootMatcher(roots: readonly string[]): RootMatcher {
  const byRoot = new Map<string, string>();
  const byReal = new Map<string, string>();
  for (const raw of roots) {
    const root = path.resolve(raw);
    if (!byRoot.has(root)) byRoot.set(root, root);
    const real = realDir(root);
    if (!byReal.has(real)) byReal.set(real, root);
  }
  return {
    match(absPath: string, opts?: { allowSelf?: boolean }): RootMatch | null {
      const allowSelf = opts?.allowSelf === true;
      const resolved = path.resolve(absPath);
      const hit =
        walkUp(byRoot, resolved, allowSelf) ??
        walkUp(byReal, path.join(realDir(path.dirname(resolved)), path.basename(resolved)), allowSelf);
      return hit === null ? null : { root: hit.root, rel: toPosix(hit.rel) };
    },
  };
}
