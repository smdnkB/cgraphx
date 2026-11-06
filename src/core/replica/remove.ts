/**
 * 删副本(spec:2026-11-06-副本改用worktree F3、D12~D14)。
 *
 * 删除不可恢复,登记文件的 path 被改错就可能删到别处,所以逐条核对全过才删:登记过且没删;副本目录(按 D22
 * 在主目录的上级、名为登记的副本目录名)就是登记的 path;它不是主目录、也不是主目录的上级;目录名以
 * `<主目录名>@` 开头;目录里的 `.cgraphx/shared` 指回本主目录的 `.cgraphx/`;目录在 `git worktree list`
 * 里(旧版整仓复制出来的副本不是 worktree,停在这条);K9 没有改动。
 *
 * 删目录只用 `git worktree remove --force`(副本里通常有被忽略的 node_modules、.env,不带 force 会被拒绝)。
 * 需求分支按 K9 处理(C-7、K13):已合入、或还没有自己做的提交 → 删;还没合入 → 留着,下次开同一个需求
 * 接上(K15)。tip 在删除之前取(删完 rev-parse 取不到了)。目录已经不在 → 先 `git worktree prune`(残留的
 * worktree 记录会让 `git branch -D` 拒绝),同样处理分支,只在登记里填 removedAt。
 */

import * as fs from 'node:fs';
import * as path from 'node:path';

import { codeGraphDirName, getCodeGraphDir, SHARED_LINK_NAME } from '../directory';
import { listWorktreeRoots } from '../repo-projects';
import { REPLICA_NAME_SEPARATOR } from './constants';
import { formatFileList, ReplicaError } from './errors';
import { replicaLinkOf } from './main-dir';
import { entryFilePath, markRemoved } from './registry';
import { isDirectory, listReplicas, realpathOr, relativeInside } from './roots';
import { firstLine, gitValue, mergeStateOf, runGit, uncommittedFiles } from './status';
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

/** 第 1~5 条核对,任一条不过抛 unsafe_target;全过返回要删的目录(realpath)。 */
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
  // 4. 目录里的 .cgraphx/shared 是符号链接,且指回本主目录的 .cgraphx/
  const link = path.join(realDir, codeGraphDirName(), SHARED_LINK_NAME);
  const mainLocalDir = realpathOr(getCodeGraphDir(mainRoot));
  if (lstatOrUndefined(link)?.isSymbolicLink() !== true || realpathOr(link) !== mainLocalDir) {
    throw unsafeTarget(mainRoot, entry, `${link} 不是指回本主目录 ${mainLocalDir} 的链接`);
  }
  // 5. 这个目录确实是本仓库的 worktree(D13;旧版整仓复制出来的副本不是,git 列不出来也按这条拦下)
  const worktrees = listWorktreeRoots(mainRoot);
  if (worktrees === null || !worktrees.some((wt) => realpathOr(wt) === realDir)) {
    throw unsafeTarget(mainRoot, entry, '这个目录不是本仓库的 worktree');
  }
  return realDir;
}

/** 分支怎么处理,在删 worktree 之前算好(C-7、D12、K13)。 */
interface BranchPlan {
  name: string;
  /** 删除前 `refs/heads/<分支>` 的提交号;引用不在 → '' */
  tip: string;
  /** K9:已合入,或还没有自己做的提交 → 可以删 */
  removable: boolean;
}

/**
 * 算分支的处置:tip 必须在删之前取(分支被 worktree 占用时删不掉,所以也必须在 `worktree remove` 之后
 * 才真删)。K9 用 status 的 mergeStateOf,不在这里重算提交数。引用不在 → 留着不动,不报错也不警告。
 */
function planBranch(mainRoot: string, entry: ReplicaEntry): BranchPlan {
  const tip = gitValue(mainRoot, ['rev-parse', '-q', '--verify', `refs/heads/${entry.branch}`]) ?? '';
  if (tip === '') return { name: entry.branch, tip, removable: false };
  const { merged, ahead } = mergeStateOf(mainRoot, entry);
  return { name: entry.branch, tip, removable: merged === true || (merged === false && ahead === 0) };
}

/** 按 BranchPlan 处理分支:删不掉不升级成错误(目录已经删了),进 warnings,结果记为 kept。 */
function applyBranch(
  mainRoot: string,
  plan: BranchPlan,
): { branch: RemoveReplicaResult['branch']; warnings: string[] } {
  const kept: RemoveReplicaResult['branch'] = { name: plan.name, state: 'kept', tip: plan.tip };
  if (!plan.removable) return { branch: kept, warnings: [] };
  const r = runGit(mainRoot, ['branch', '-D', plan.name]);
  if (r.status === 0) return { branch: { name: plan.name, state: 'deleted', tip: plan.tip }, warnings: [] };
  return {
    branch: kept,
    warnings: [`分支 ${plan.name} 没删掉(${firstLine(r.stderr)});手动删:git branch -D ${plan.name}`],
  };
}

/** 按副本目录名或 feature-id 删一个在用的副本(只在主目录执行)。 */
export function removeReplica(projectRoot: string, nameOrFeatureId: string): RemoveReplicaResult {
  const root = path.resolve(projectRoot);
  const info = replicaLinkOf(root);
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

  // D14:目录已经被手动删掉 → prune 掉残留的 worktree 记录,按 K9 处理分支,只在登记里记为删除,不报错
  if (!isDirectory(entry.path)) {
    runGit(mainRoot, ['worktree', 'prune']);
    const plan = planBranch(mainRoot, entry);
    const { branch, warnings } = applyBranch(mainRoot, plan);
    markRemoved(mainRoot, entry.name, new Date().toISOString());
    return { name: entry.name, state: 'missing', branch, warnings };
  }

  const dir = verifyTarget(mainRoot, entry);
  // K10:没有改动(F3)
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

  // K9、tip 都在删之前取:此时 worktree、分支都还在
  const plan = planBranch(mainRoot, entry);
  const r = runGit(mainRoot, ['worktree', 'remove', '--force', dir]);
  if (r.status !== 0) {
    throw new Error(`删不掉 worktree(${firstLine(r.stderr)});${entry.name} 没删,在 ${mainRoot} 手动处理`);
  }
  // D13:删 worktree 之后才删分支(被 worktree 占用的分支删不掉)
  const { branch, warnings } = applyBranch(mainRoot, plan);
  markRemoved(mainRoot, entry.name, new Date().toISOString());
  return { name: entry.name, state: 'removed', branch, warnings };
}
