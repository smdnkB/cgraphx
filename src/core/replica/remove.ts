/**
 * 删副本(spec F9、D35)。
 *
 * 删除不可恢复,登记文件的 path 被改错就可能删到别处,所以逐条核对全过才删:登记过且没删;
 * 副本目录(按 D22 在主目录的上级、名为登记的副本目录名)就是登记的 path;它不是主目录、也不是
 * 主目录的上级;目录名以 `<主目录名>@` 开头;目录里的 `.cgraphx/shared` 指回本主目录的数据目录;
 * K9 没有改动。删除只用 fs.rmSync(不跟随符号链接,不调 shell);删完只在登记里填 removedAt,
 * 登记文件和主目录里的数据都留着。目录已经没了 → 只填 removedAt。
 */

import * as fs from 'node:fs';
import * as path from 'node:path';

import { codeGraphDirName, getDataDir, resolveDataDir, SHARED_LINK_NAME } from '../directory';
import { REPLICA_NAME_SEPARATOR } from './constants';
import { formatFileList, ReplicaError } from './errors';
import { entryFilePath, markRemoved } from './registry';
import { isDirectory, listReplicas, realpathOr, relativeInside } from './roots';
import { uncommittedFiles } from './status';
import type { RemoveReplicaResult, ReplicaEntry } from './types';

/** 先按副本目录名找,再按 feature-id 找(同一需求有多个在用登记时取目录还在的那个)。 */
function findActive(mainRoot: string, key: string): ReplicaEntry | null {
  const active = listReplicas(mainRoot);
  const byName = active.find((e) => e.name === key);
  if (byName !== undefined) return byName;
  const byFeature = active.filter((e) => e.featureId === key);
  return byFeature.find((e) => isDirectory(e.path)) ?? byFeature[0] ?? null;
}

function unsafeTarget(mainRoot: string, entry: ReplicaEntry, reason: string): ReplicaError {
  return new ReplicaError(
    'unsafe_target',
    `${entry.name} 没删:${reason};核对 ${entryFilePath(mainRoot, entry.name)} 里的 path,对不上就手动处理这个目录`,
  );
}

/** lstat;不在或路径中间不是目录等读不了的情形 → undefined。 */
function lstatOrUndefined(p: string): fs.Stats | undefined {
  try {
    return fs.lstatSync(p, { throwIfNoEntry: false });
  } catch {
    return undefined;
  }
}

/** 第 1~4 条核对,任一条不过抛 unsafe_target;全过返回要删的目录(realpath)。 */
function verifyTarget(mainRoot: string, entry: ReplicaEntry): string {
  const realMain = realpathOr(mainRoot);
  const realDir = realpathOr(entry.path);

  // 1. 副本目录就是登记的 path
  const expected = path.join(path.dirname(realMain), entry.name);
  if (realpathOr(expected) !== realDir) {
    throw unsafeTarget(mainRoot, entry, `副本目录应是 ${expected},登记的 path 是 ${entry.path},两者不是同一个目录`);
  }
  // 2. 不是主目录,也不是主目录的上级
  if (relativeInside(realDir, realMain, true) !== null) {
    throw unsafeTarget(mainRoot, entry, `${realDir} 是主目录或主目录的上级`);
  }
  // 3. 目录名以 <主目录名>@ 开头
  const namePrefix = `${path.basename(realMain)}${REPLICA_NAME_SEPARATOR}`;
  const dirName = path.basename(realDir);
  if (!dirName.startsWith(namePrefix) || dirName.length === namePrefix.length) {
    throw unsafeTarget(mainRoot, entry, `目录名 ${dirName} 不是以「${namePrefix}」开头,不是本主目录的副本`);
  }
  // 4. 目录里的 .cgraphx/shared 是符号链接,且指回本主目录的数据目录
  const link = path.join(realDir, codeGraphDirName(), SHARED_LINK_NAME);
  const mainData = realpathOr(getDataDir(mainRoot));
  if (lstatOrUndefined(link)?.isSymbolicLink() !== true || realpathOr(link) !== mainData) {
    throw unsafeTarget(mainRoot, entry, `${link} 不是指回本主目录数据目录 ${mainData} 的链接`);
  }
  return realDir;
}

/** 按副本目录名或 feature-id 删一个在用的副本(只在主目录执行)。 */
export function removeReplica(projectRoot: string, nameOrFeatureId: string): RemoveReplicaResult {
  const root = path.resolve(projectRoot);
  const info = resolveDataDir(root);
  if (info.state === 'replica') {
    throw new ReplicaError(
      'not_main_dir',
      `${root} 是副本,不能在副本里删副本;到主目录 ${info.mainRoot} 执行 cgraphx replica remove`,
    );
  }
  if (info.state === 'main-missing') {
    throw new ReplicaError(
      'not_main_dir',
      `${root} 的 ${codeGraphDirName()}/${SHARED_LINK_NAME} 指向的主目录 ${info.mainRoot} 已不在;到主目录执行 cgraphx replica remove`,
    );
  }
  const mainRoot = info.mainRoot;

  const entry = findActive(mainRoot, nameOrFeatureId);
  if (entry === null) {
    throw new ReplicaError(
      'not_found',
      `没有登记在用的副本「${nameOrFeatureId}」;用 cgraphx replica list 查看副本目录名和需求`,
    );
  }

  // F9②:目录已经被手动删掉 → 只在登记里记为删除,不报错
  if (!isDirectory(entry.path)) {
    markRemoved(mainRoot, entry.name, new Date().toISOString());
    return { name: entry.name, state: 'missing' };
  }

  const dir = verifyTarget(mainRoot, entry);
  // 5. K9 没有改动(F9①)
  const dirty = uncommittedFiles(dir);
  if (dirty === null) {
    throw new ReplicaError(
      'unsafe_target',
      `${entry.name} 没删:查不了副本里没提交的改动(git status 失败);在副本里确认 git 正常后再删`,
    );
  }
  if (dirty.length > 0) {
    throw new ReplicaError(
      'dirty',
      `${entry.name} 有 ${dirty.length} 个文件没提交:${formatFileList(dirty)};先在副本里提交或收好再删`,
      { files: dirty },
    );
  }

  fs.rmSync(dir, { recursive: true, force: true });
  markRemoved(mainRoot, entry.name, new Date().toISOString());
  return { name: entry.name, state: 'removed' };
}
