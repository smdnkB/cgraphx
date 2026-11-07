/**
 * 是不是副本、主目录在哪(spec:2026-11-05-数据按项目放用户目录 D8、D22)。
 *
 * 按项目根 `.cgraphx/shared` 链接和链接目标下的副本登记判断,只给版本流程(开、列、删副本)与 features 用;
 * timeline、task、sync 的数据放在哪不看这里(由基础层 data-location.ts 定)。只读登记文件的 path、removedAt
 * 两个字段,不写登记:
 *
 * 1. `<项目根>/.cgraphx/shared` 不存在或不是符号链接(lstat)→ own
 * 2. 链接目标不存在 → main-missing:主目录已不在
 * 3. 目标下 `replicas/<项目根 realpath 的目录名>.json` 能解析成对象,其 path 的 realpath 就是项目根的 realpath,
 *    且 removedAt 为 null → replica
 * 4. 其余(没登记、已删除、读不了)→ own
 *
 * 任何异常都按 own 处理,不抛。
 */

import * as fs from 'node:fs';
import * as path from 'node:path';

import { getCodeGraphDir, REPLICAS_DIRNAME, SHARED_LINK_NAME } from '../directory';
import { readRawEntryIn } from './registry';
import type { ReplicaLink } from './types';

/** realpath;失败(路径不在、没权限等)退回 path.resolve 的结果。 */
function realpathOrResolve(p: string): string {
  try {
    return fs.realpathSync(p);
  } catch {
    return path.resolve(p);
  }
}

/**
 * `<项目根>/.cgraphx/shared` 是符号链接时返回链接目标(按链接所在目录解析成绝对路径,不再往下跟随);不在、
 * 不是符号链接 → null。读链接出错照常抛出,由调用方兜。
 */
export function sharedLinkTarget(projectRoot: string): string | null {
  const local = getCodeGraphDir(projectRoot);
  const link = path.join(local, SHARED_LINK_NAME);
  // lstat 只看链接本身;不存在时返回 undefined,不走异常(没有副本的项目每次都走这条)
  const linkStat = fs.lstatSync(link, { throwIfNoEntry: false });
  if (linkStat === undefined || !linkStat.isSymbolicLink()) return null;
  return path.resolve(local, fs.readlinkSync(link));
}

/** projectRoot 是不是副本、主目录在哪(判定见文件头)。 */
export function replicaLinkOf(projectRoot: string): ReplicaLink {
  const own: ReplicaLink = { state: 'own', mainRoot: path.resolve(projectRoot) };
  try {
    const target = sharedLinkTarget(projectRoot);
    if (target === null) return own;
    if (!fs.existsSync(target)) return { state: 'main-missing', mainRoot: path.dirname(target) };

    const realRoot = realpathOrResolve(projectRoot);
    const entry = readRawEntryIn(path.join(target, REPLICAS_DIRNAME), path.basename(realRoot));
    if (
      entry !== null &&
      typeof entry.path === 'string' &&
      realpathOrResolve(entry.path) === realRoot &&
      entry.removedAt === null
    ) {
      return { state: 'replica', mainRoot: path.dirname(realpathOrResolve(target)) };
    }
    return own;
  } catch {
    return own;
  }
}
