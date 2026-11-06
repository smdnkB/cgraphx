/**
 * 开副本(spec:2026-11-06-副本改用worktree F1、D1~D9)。
 *
 * 前置检查全过才动手(任一不过就抛对应 code,什么都不改)→ 在主目录旁 `git worktree add` 出副本 →
 * 在副本里建自己的数据目录(D5)→ 带上 agent 配置与 `.worktreeinclude` 里的文件并对 git 隐藏(D2~D4)→
 * 把主目录这个需求目录下没被跟踪的文件拷进副本(K6)→ 写登记 → 补钩子片段(D8)。
 *
 * add 之后任一步失败:删 worktree、删这次新建的分支、删已写的登记,再抛原错误——主目录不动,接上的旧分支
 * 留着(D6)。最后删主目录那份需求文件,删不掉只记进 warnings,不回滚。
 *
 * 路径都按主目录的 realpath 算:副本放在它的上级目录,名为 `<主目录名>@<文件前缀>`(plan C-10)。
 */

import * as fs from 'node:fs';
import * as path from 'node:path';

import { DatabaseConnection, getLocalDatabasePath } from '../db';
import {
  codeGraphDirName,
  createDirectory,
  getCodeGraphDir,
  isInitialized,
  SHARED_LINK_NAME,
} from '../directory';
import { hookNotice, repairHookSnippets } from '../git-hooks';
import { carryIntoReplica } from './carry';
import {
  FEATURES_DIR_POSIX,
  REPLICA_NAME_SEPARATOR,
  SENSITIVE_NAME_CHARS,
  SUPPORTED_PLATFORMS,
} from './constants';
import { ReplicaError } from './errors';
import { replicaLinkOf } from './main-dir';
import { markRemoved, writeEntry } from './registry';
import { featureDirOf, isDirectory, listReplicas, realpathOr, relativeInside } from './roots';
import { firstLine, gitValue, runGit, trackedChanges, untrackedFiles } from './status';
import type { CreateReplicaOptions, CreateReplicaResult, ReplicaEntry } from './types';

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** 删掉 p(不跟随符号链接);清理失败不盖过原错误。 */
function removeQuietly(p: string): void {
  try {
    fs.rmSync(p, { recursive: true, force: true });
  } catch {
    // 留给用户手动清理;调用方会抛出原错误
  }
}

// ---------- 前置检查 ----------

function assertPlatform(): void {
  if (!SUPPORTED_PLATFORMS.includes(process.platform)) {
    throw new ReplicaError(
      'unsupported_platform',
      `副本只支持 macOS 和 Linux,当前平台是 ${process.platform};在这台机器上照旧在主目录开发`,
    );
  }
}

/** 单段目录名:非空、不是 . / ..,不含敏感字符和控制字符。 */
function isPlainDirName(name: string): boolean {
  if (name === '' || name === '.' || name === '..') return false;
  if (SENSITIVE_NAME_CHARS.some((ch) => name.includes(ch))) return false;
  for (const ch of name) {
    const code = ch.codePointAt(0) ?? 0;
    if (code < 0x20 || code === 0x7f) return false;
  }
  return true;
}

function invalidArgs(message: string): ReplicaError {
  return new ReplicaError('invalid_args', message);
}

function assertArgs(projectRoot: string, opts: CreateReplicaOptions): void {
  const chars = SENSITIVE_NAME_CHARS.join(' ');
  if (!isPlainDirName(opts.featureId)) {
    throw invalidArgs(
      `feature-id「${opts.featureId}」不是单段目录名,或含 ${chars} 这些字符;传 docs/features/ 下的目录名,如 2026-10-27-订单导出`,
    );
  }
  if (opts.prefix === '') {
    throw invalidArgs('缺 --prefix <文件前缀>:feature-id 去掉日期段,如 2026-10-27-订单导出 → 订单导出');
  }
  if (!isPlainDirName(opts.prefix)) {
    throw invalidArgs(`文件前缀「${opts.prefix}」不是单段目录名,或含 ${chars} 这些字符;换个前缀,如 订单导出`);
  }
  if (opts.branch === '') {
    throw invalidArgs(`缺 --branch <分支>:需求用 feat/${opts.prefix},bug 修复用 fix/${opts.prefix}`);
  }
  const check = runGit(projectRoot, ['check-ref-format', '--branch', opts.branch]);
  if (check.error !== undefined) {
    throw new Error(`跑不了 git(${check.error.message});装好 git 后重试`);
  }
  if (check.status !== 0) {
    throw invalidArgs(
      `分支名「${opts.branch}」不合法(git check-ref-format --branch 不通过);换个分支名,如 feat/${opts.prefix}`,
    );
  }
}

function notMainDir(message: string): ReplicaError {
  return new ReplicaError('not_main_dir', message);
}

/**
 * C-5 的 not_main_dir 情形,按调用方传入的项目根(不先换成主目录)逐条查:在副本里或主目录已不在、
 * 未初始化、项目根不是独立 git 仓库的根(含 worktree、子模块:.git 是文件,worktree 的副本要从原仓库的
 * 主目录开)、detached HEAD。全过返回主目录的 realpath 和当前分支(登记的 baseBranch)。
 */
function assertMainDir(projectRoot: string): { realRoot: string; baseBranch: string } {
  const root = path.resolve(projectRoot);
  const info = replicaLinkOf(root);
  if (info.state === 'replica') {
    throw notMainDir(`${root} 是副本,不能在副本里开副本;到主目录 ${info.mainRoot} 的会话里开`);
  }
  if (info.state === 'main-missing') {
    throw notMainDir(
      `${root} 的 ${codeGraphDirName()}/${SHARED_LINK_NAME} 指向的主目录 ${info.mainRoot} 已不在,不能在这里开副本;到主目录执行 cgraphx replica create`,
    );
  }
  if (!isInitialized(root)) {
    throw notMainDir(`${root} 还没初始化 cgraphx(没有 ${codeGraphDirName()}/cgraphx.db);先在项目根执行 cgraphx install,再开副本`);
  }

  const realRoot = realpathOr(root);
  const top = gitValue(root, ['rev-parse', '--show-toplevel']);
  if (top === null) {
    throw notMainDir(`${root} 不在 git 仓库里;副本要用 git worktree 开,到项目的 git 仓库根目录执行`);
  }
  if (realpathOr(top) !== realRoot) {
    throw notMainDir(`${root} 不是 git 仓库的根(仓库根是 ${top});到仓库根目录执行`);
  }
  const gitDir = gitValue(root, ['rev-parse', '--absolute-git-dir']);
  const dotGit = fs.lstatSync(path.join(root, '.git'), { throwIfNoEntry: false });
  if (gitDir === null || realpathOr(gitDir) !== path.join(realRoot, '.git') || dotGit?.isDirectory() !== true) {
    throw notMainDir(
      `${root} 是 git worktree 或子模块(.git 不是项目根下的目录),不能在这里再开副本;到原仓库的主目录执行`,
    );
  }
  const baseBranch = gitValue(root, ['symbolic-ref', '-q', '--short', 'HEAD']);
  if (baseBranch === null) {
    throw notMainDir(
      `主目录 ${root} 处于 detached HEAD,没有可登记的基础分支;先 git switch 到要拉需求分支的分支(如 main 或 dev/<版本号>)再开副本`,
    );
  }
  return { realRoot, baseBranch };
}

/** K7、D9:主目录改了没提交的文件只提示(W1),不拦;git 出错也不拦。 */
function mainDirtyWarnings(mainRoot: string): string[] {
  const changed = trackedChanges(mainRoot);
  if (changed === null || changed.length === 0) return [];
  return [`主目录有 ${changed.length} 个文件没提交,没带进副本`];
}

/** 这次要开的分支是新建的,还是接上删副本时留下的那个(③、K15、D7)。 */
interface BranchPlan {
  /** 接上的旧登记;新建分支为 null */
  reattached: ReplicaEntry | null;
}

/**
 * 分支判断(D7 / ③ / K15):主目录没有这个本地分支 → 新建;有 → 找这个需求留下的登记(feature-id、分支
 * 都相同,且已删或目录已不在),取 createdAt 最新的那条接上;找不到说明这个分支不是本需求留下的 → ③。
 * 旧登记已删也照常找:删副本时分支按合入情况留下了,重开同一个需求要接上它,不能另起一个。
 */
function planBranch(mainRoot: string, opts: CreateReplicaOptions): BranchPlan {
  if (runGit(mainRoot, ['show-ref', '--verify', '--quiet', `refs/heads/${opts.branch}`]).status !== 0) {
    return { reattached: null };
  }
  const previous = listReplicas(mainRoot, { includeRemoved: true }).filter(
    (e) =>
      e.featureId === opts.featureId &&
      e.branch === opts.branch &&
      (e.removedAt !== null || !isDirectory(e.path)),
  );
  // listReplicas 按 createdAt 升序,取最后一条即最新的
  const latest = previous[previous.length - 1];
  if (latest === undefined) {
    throw invalidArgs(`主目录已有本地分支 ${opts.branch};换个分支名再开副本`);
  }
  return { reattached: latest };
}

/**
 * spec:2026-11-05-下掉web与平台同步 D13(F5③):同一个 feature-id 已有在用的副本(present:没删、目录还在)
 * → 一个需求只开一个副本,报 feature_has_replica,什么都不建;要并行先把需求拆成几个需求目录。
 * 已删(removed)的 listReplicas 默认就不返回,目录已不在(missing)的过不了 isDirectory,都不拦。
 */
function assertFeatureHasNoReplica(mainRoot: string, featureId: string): void {
  const existing = listReplicas(mainRoot).find((e) => e.featureId === featureId && isDirectory(e.path));
  if (existing === undefined) return;
  throw new ReplicaError(
    'feature_has_replica',
    `这个需求已经有副本 ${existing.name};一个需求只开一个副本,要并行先把需求拆成几个需求目录`,
  );
}

/**
 * D22:副本目录名已登记给别的需求(副本在用、已删都算)→ name_taken。登记按目录名一个文件,照开会覆盖
 * 旧需求的登记,旧会话重新算归属时就算到新需求头上;同一个需求删了副本再开照旧。
 */
function assertNameFree(mainRoot: string, name: string, featureId: string): void {
  const owner = listReplicas(mainRoot, { includeRemoved: true }).find(
    (e) => e.name === name && e.featureId !== featureId,
  );
  if (owner === undefined) return;
  throw new ReplicaError(
    'name_taken',
    `副本目录名 ${name} 已登记给需求 ${owner.featureId}${owner.removedAt !== null ? '(副本已删)' : ''};给这个需求换个标题或加业务 ID,换个文件前缀(--prefix)再开`,
  );
}

function assertTargetFree(mainRoot: string, target: string): void {
  if (fs.lstatSync(target, { throwIfNoEntry: false }) === undefined) return;
  const owner = listReplicas(mainRoot).find((e) => path.resolve(e.path) === target);
  throw new ReplicaError(
    'target_exists',
    owner === undefined
      ? `目标目录 ${target} 已存在,不是登记过的副本;换个文件前缀(--prefix),或先挪走这个目录`
      : `目标目录 ${target} 已存在,是需求 ${owner.featureId} 的副本;换个文件前缀(--prefix)`,
  );
}

// ---------- 开 worktree 与数据目录 ----------

/**
 * 开出 worktree(D1、D7):新建分支用 `-b <分支> <目标> HEAD`,接上留下的分支用 `<目标> <分支>`。
 * 返回登记的 baseCommit(新建分支读 add 之前的 HEAD;接上的沿用旧登记,K3 才数得对)。
 * add 失败:删掉可能建了一半的目标、prune 掉 worktree 元数据,报 ⑦,什么都不留。
 */
function addWorktree(mainRoot: string, target: string, opts: CreateReplicaOptions, plan: BranchPlan): string | null {
  let baseCommit: string | null;
  if (plan.reattached === null) {
    baseCommit = gitValue(mainRoot, ['rev-parse', '--verify', '-q', 'HEAD']);
  } else {
    baseCommit = plan.reattached.baseCommit;
    // 旧副本目录可能被手动删过、worktree 元数据还留着:先 prune(失败也继续),否则 add 可能撞名
    runGit(mainRoot, ['worktree', 'prune']);
  }
  const args =
    plan.reattached === null
      ? ['worktree', 'add', '-q', '-b', opts.branch, target, 'HEAD']
      : ['worktree', 'add', '-q', target, opts.branch];
  const r = runGit(mainRoot, args);
  if (r.status === 0) return baseCommit;
  removeQuietly(target);
  runGit(mainRoot, ['worktree', 'prune']);
  throw new ReplicaError('worktree_failed', `开 worktree 失败:${firstLine(r.stderr)};没有留下任何东西,主目录没动`);
}

/**
 * D5:副本自己的数据目录。`.cgraphx` 是链接或文件时只删链接/文件本身(主目录的数据目录本身是链接时,
 * worktree 也带不过来;防御手动场景),再建空的本地库和指回主目录 `.cgraphx/` 的 `shared` 链接
 * (版本流程据它和主目录的登记认出副本、找到主目录)。
 */
function prepareDataDir(target: string, mainRoot: string): void {
  const local = getCodeGraphDir(target);
  const stat = fs.lstatSync(local, { throwIfNoEntry: false });
  if (stat !== undefined && !stat.isDirectory()) fs.rmSync(local, { force: true });
  createDirectory(target);
  DatabaseConnection.open(getLocalDatabasePath(target)).close();
  fs.symlinkSync(fs.realpathSync(getCodeGraphDir(mainRoot)), path.join(local, SHARED_LINK_NAME), 'dir');
}

/**
 * ⑧ 失败回滚:先删 worktree(删不掉就整个目录删掉再 prune),再删这次新建的分支(接上的分支留着),
 * 最后删已写的登记文件。清理失败不盖过原错误。
 */
function rollback(
  mainRoot: string,
  target: string,
  branch: string,
  createdBranch: boolean,
  entryFile: string | null,
): void {
  const removed = runGit(mainRoot, ['worktree', 'remove', '--force', target]);
  if (removed.status !== 0) {
    removeQuietly(target);
    runGit(mainRoot, ['worktree', 'prune']);
  }
  if (createdBranch) runGit(mainRoot, ['branch', '-D', branch]);
  if (entryFile !== null) removeQuietly(entryFile);
}

// ---------- 移需求文件 ----------

/**
 * K6:把主目录 `docs/features/<featureId>/` 下没被跟踪的文件拷进副本(worktree 只签出被跟踪的内容;
 * 讨论稿、plan 这些大多还没提交)。返回拷过的相对路径。被忽略的文件不带、也不删(留在主目录)。
 */
function copyFeatureFiles(mainRoot: string, target: string, featureId: string): string[] {
  const files = untrackedFiles(mainRoot);
  if (files === null) {
    throw new Error('列不出主目录里没被跟踪的文件(git ls-files 失败);确认 git 正常后重试');
  }
  const prefix = `${FEATURES_DIR_POSIX}/${featureId}/`;
  const copied: string[] = [];
  for (const rel of files) {
    if (!rel.startsWith(prefix)) continue;
    const destination = path.join(target, rel);
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.cpSync(path.join(mainRoot, rel), destination, { recursive: true, verbatimSymlinks: true });
    copied.push(rel);
  }
  return copied;
}

/** 从 start 往上逐级删空目录,到 top 为止(includeTop 决定 top 本身删不删);遇到非空或删不掉就停。 */
function pruneEmptyDirs(start: string, top: string, includeTop: boolean): void {
  let dir = start;
  for (;;) {
    const atTop = path.relative(top, dir) === '';
    if (atTop ? !includeTop : relativeInside(top, dir, false) === null) return;
    try {
      fs.rmdirSync(dir); // 只删得掉空目录
    } catch {
      return;
    }
    if (atTop) return;
    dir = path.dirname(dir);
  }
}

/**
 * K6 的后半:删掉主目录 `docs/features/<featureId>/` 下已拷进副本的文件,再删掉因此变空的目录(含这个
 * 需求目录本身)。被忽略的文件留在原处(副本里没有它们的一份,但也不该删用户的本地文件);删不掉的、
 * 内嵌的 git 仓库只记进 warnings,不回滚。
 */
function moveOutOfMain(
  mainRoot: string,
  featureId: string,
  copied: readonly string[],
): { movedFiles: string[]; warnings: string[] } {
  const movedFiles: string[] = [];
  const warnings: string[] = [];
  const parents = new Set<string>();
  for (const rel of copied) {
    const abs = path.join(mainRoot, rel);
    try {
      const stat = fs.lstatSync(abs, { throwIfNoEntry: false });
      if (stat?.isDirectory() === true) {
        warnings.push(`主目录里的 ${rel} 是内嵌的 git 仓库,没删;副本里已有一份,主目录这份手动处理`);
        continue;
      }
      if (stat !== undefined) fs.rmSync(abs, { force: true });
      movedFiles.push(rel);
      parents.add(path.dirname(abs));
    } catch (err) {
      warnings.push(`主目录里的 ${rel} 没删掉(${errorMessage(err)}),副本里已有一份;手动删掉主目录这份`);
    }
  }
  const featureDir = featureDirOf(mainRoot, featureId);
  for (const dir of parents) pruneEmptyDirs(dir, featureDir, true);
  return { movedFiles, warnings };
}

/** 拷进副本、要记进登记的 filesToMove:内嵌的 git 仓库(目录)不删,不算。 */
function filesToMove(mainRoot: string, copied: readonly string[]): string[] {
  return copied.filter((rel) => fs.lstatSync(path.join(mainRoot, rel), { throwIfNoEntry: false })?.isDirectory() !== true);
}

// ---------- 入口 ----------

/**
 * 在主目录旁开出需求副本并登记。同一个 feature-id 已有在用副本(present)→ 报 feature_has_replica,
 * 不开第二个(spec:2026-11-05-下掉web与平台同步 D13,一个需求只开一个副本);已删、目录已不在的照常另开。
 */
export function createReplica(projectRoot: string, opts: CreateReplicaOptions): CreateReplicaResult {
  assertPlatform();
  assertArgs(projectRoot, opts);
  const { realRoot, baseBranch } = assertMainDir(projectRoot);
  const mainRoot = realRoot;

  const warnings = mainDirtyWarnings(mainRoot); // K7、D9
  const plan = planBranch(mainRoot, opts); // ③、K15、D7
  const name = `${path.basename(realRoot)}${REPLICA_NAME_SEPARATOR}${opts.prefix}`;
  const target = path.join(path.dirname(realRoot), name);
  assertFeatureHasNoReplica(mainRoot, opts.featureId);
  assertNameFree(mainRoot, name, opts.featureId);
  assertTargetFree(mainRoot, target);

  const baseCommit = addWorktree(mainRoot, target, opts, plan);
  const reattached = plan.reattached !== null;

  let entryFile: string | null = null;
  let entry: ReplicaEntry;
  let copied: string[];
  try {
    prepareDataDir(target, mainRoot); // D5
    warnings.push(...carryIntoReplica(mainRoot, target).warnings); // D2~D4、K4、K16
    copied = copyFeatureFiles(mainRoot, target, opts.featureId); // K6
    entry = {
      name,
      path: target,
      featureId: opts.featureId,
      branch: opts.branch,
      baseBranch,
      baseCommit,
      movedFiles: filesToMove(mainRoot, copied),
      createdAt: new Date().toISOString(),
      removedAt: null,
    };
    entryFile = writeEntry(mainRoot, entry); // D6:拷完才写登记
    for (const result of repairHookSnippets(target)) {
      const notice = hookNotice(result, '钩子片段没补上'); // D8、W4
      if (notice !== null) warnings.push(notice);
    }
    // D7:接上的旧登记名字不一样时标成已删(新登记顶上,不再有第二份在用的)
    if (plan.reattached !== null && plan.reattached.name !== name) {
      markRemoved(mainRoot, plan.reattached.name, new Date().toISOString());
    }
  } catch (err) {
    rollback(mainRoot, target, opts.branch, plan.reattached === null, entryFile);
    throw err;
  }

  const moved = moveOutOfMain(mainRoot, opts.featureId, copied); // K6:主目录那份最后删
  return {
    ...entry,
    movedFiles: moved.movedFiles,
    warnings: [...warnings, ...moved.warnings],
    reattached,
  };
}
