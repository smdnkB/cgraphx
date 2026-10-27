/**
 * 开副本(spec F7、D20、D21、D22)。
 *
 * 前置检查全过才动手(任一不过就抛对应 code,什么都不改)→ 写时复制整个主目录 → 在副本里整理
 * (D21 ①~⑤)→ 移走主目录里这个需求目录下没被跟踪的文件(⑥)。①~⑤ 任一步失败:删掉副本目录
 * 和已写的登记,抛原错误,主目录不动;⑥ 删不掉的文件只记进 warnings,不回滚。
 *
 * 复制、命名都用主目录的 realpath:副本放在它的上级目录,名为 `<主目录名>@<文件前缀>`(plan C-8)。
 */

import * as fs from 'node:fs';
import * as path from 'node:path';

import { listAgentProfiles } from '../agents';
import { DatabaseConnection, getLocalDatabasePath } from '../db';
import {
  codeGraphDirName,
  createDirectory,
  getCodeGraphDir,
  isInitialized,
  resolveDataDir,
  SHARED_LINK_NAME,
} from '../directory';
import {
  FEATURES_DIR_POSIX,
  REPLICA_NAME_SEPARATOR,
  SENSITIVE_NAME_CHARS,
  SUPPORTED_PLATFORMS,
} from './constants';
import { formatFileList, ReplicaError } from './errors';
import { writeEntry } from './registry';
import { featureDirOf, isDirectory, listReplicas, realpathOr, relativeInside } from './roots';
import { firstLine, gitValue, runCommand, runGit, trackedChanges, untrackedFiles } from './status';
import type { CreateReplicaOptions, CreateReplicaResult, ReplicaEntry } from './types';

const GITIGNORE = '.gitignore';
const PYVENV_CFG = 'pyvenv.cfg';

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
 * 未初始化、项目根不是独立 git 仓库的根(含 worktree、子模块:.git 是文件,整仓复制出的副本会和
 * 原仓库共用引用)、detached HEAD。全过返回主目录的 realpath 和当前分支(登记的 baseBranch)。
 */
function assertMainDir(projectRoot: string): { realRoot: string; baseBranch: string } {
  const root = path.resolve(projectRoot);
  const info = resolveDataDir(root);
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
    throw notMainDir(`${root} 不在 git 仓库里;副本要整仓复制 git 仓库,到项目的 git 仓库根目录执行`);
  }
  if (realpathOr(top) !== realRoot) {
    throw notMainDir(`${root} 不是 git 仓库的根(仓库根是 ${top});到仓库根目录执行`);
  }
  const gitDir = gitValue(root, ['rev-parse', '--absolute-git-dir']);
  const dotGit = fs.lstatSync(path.join(root, '.git'), { throwIfNoEntry: false });
  if (gitDir === null || realpathOr(gitDir) !== path.join(realRoot, '.git') || dotGit?.isDirectory() !== true) {
    throw notMainDir(
      `${root} 是 git worktree 或子模块(.git 不是项目根下的目录),整仓复制出的副本会和原仓库共用引用;到原仓库的主目录执行`,
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

/** F7①:主目录只查改了没提交的已跟踪文件;没被跟踪的新文件不拦,也不带进副本。 */
function assertCleanMain(mainRoot: string): void {
  const changed = trackedChanges(mainRoot);
  if (changed === null) {
    throw new Error(`主目录 ${mainRoot} 里 git status 失败,判断不了有没有改了没提交的文件;确认 git 正常后重试`);
  }
  if (changed.length > 0) {
    throw new ReplicaError(
      'dirty_main',
      `主目录有 ${changed.length} 个改了没提交的文件:${formatFileList(changed)};开出来的副本会带走这些改动,先提交或收好再开(没被跟踪的新文件不拦,也不带进副本)`,
      { files: changed },
    );
  }
}

function assertBranchFree(mainRoot: string, branch: string): void {
  if (runGit(mainRoot, ['show-ref', '--verify', '--quiet', `refs/heads/${branch}`]).status === 0) {
    throw invalidArgs(`主目录已有本地分支 ${branch};换个分支名再开副本`);
  }
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

// ---------- 复制(D20) ----------

/** macOS 固定用系统的 /bin/cp:PATH 上若是 GNU cp,-c 不是 clonefile。 */
function copyCommand(fullCopy: boolean): { cmd: string; args: string[] } {
  if (process.platform === 'darwin') return { cmd: '/bin/cp', args: fullCopy ? ['-R'] : ['-cR'] };
  return { cmd: 'cp', args: fullCopy ? ['-R'] : ['-R', '--reflink=always'] };
}

/** 整份复制要的空间:`du -sk` × 1024;du 遇到读不了的子目录会非零退出,但照样输出总数。 */
function requiredBytes(root: string): number {
  const r = runCommand('du', ['-sk', root], root);
  const kb = Number.parseInt(r.stdout.trim().split(/\s+/)[0] ?? '', 10);
  return Number.isFinite(kb) ? kb * 1024 : 0;
}

function formatGb(bytes: number): string {
  return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
}

/** 以命令失败为准判 no_cow,不自己判断文件系统;失败时先删掉复制了一半的目标目录。 */
function copyTree(source: string, target: string, fullCopy: boolean): void {
  const { cmd, args } = copyCommand(fullCopy);
  const r = runCommand(cmd, [...args, source, target], path.dirname(source));
  if (r.status === 0) return;
  removeQuietly(target);
  const reason = r.error?.message ?? firstLine(r.stderr);
  if (fullCopy) {
    throw new Error(`整份复制失败(${reason}),已删掉复制了一半的 ${target};检查磁盘空间和权限后重跑`);
  }
  const bytes = requiredBytes(source);
  throw new ReplicaError(
    'no_cow',
    `这块盘不能写时复制(${reason}),已删掉复制了一半的 ${target};整份复制约需 ${formatGb(bytes)},确认后加 --full-copy 重跑`,
    { requiredBytes: bytes },
  );
}

// ---------- 整理(D21) ----------

/** 各 agent 的配置目录和 cgraphx 数据目录,写成 exclude 的 `/<目录名>/`。 */
function localDirPatterns(): string[] {
  const names = [...listAgentProfiles().map((p) => p.configDirName), codeGraphDirName()];
  return [...new Set(names)].map((name) => `/${name}/`);
}

/** ① 追加到副本自己的 `.git/info/exclude`(主目录的不动);已有同一行不重复加。 */
function appendExclude(replicaRoot: string, patterns: readonly string[]): void {
  const infoDir = path.join(replicaRoot, '.git', 'info');
  fs.mkdirSync(infoDir, { recursive: true });
  const file = path.join(infoDir, 'exclude');
  let existing = '';
  try {
    existing = fs.readFileSync(file, 'utf8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
  }
  const present = new Set(existing.split(/\r?\n/).map((line) => line.trim()));
  const missing = patterns.filter((p) => !present.has(p));
  if (missing.length === 0) return;
  const sep = existing === '' || existing.endsWith('\n') ? '' : '\n';
  // 克隆带过来的 exclude 是符号链接时,先删链接本身再写,免得写进它指向的文件
  if (fs.lstatSync(file, { throwIfNoEntry: false })?.isSymbolicLink() === true) fs.rmSync(file);
  fs.writeFileSync(file, `${existing}${sep}${missing.join('\n')}\n`, 'utf8');
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
 * ① 副本里删掉没被跟踪的文件(这时 exclude 已含 agent 配置目录和数据目录,它们不在列表里),
 * `docs/features/<featureId>/` 下的保留(移进副本);删完顺手删掉因此变空的目录。返回保留的文件。
 */
function dropUntracked(replicaRoot: string, featureId: string): string[] {
  const files = untrackedFiles(replicaRoot);
  if (files === null) throw new Error(`副本 ${replicaRoot} 里列不出没被跟踪的文件(git ls-files 失败)`);
  const keepPrefix = `${FEATURES_DIR_POSIX}/${featureId}/`;
  const kept: string[] = [];
  const parents = new Set<string>();
  for (const rel of files) {
    if (rel.startsWith(keepPrefix)) {
      kept.push(rel);
      continue;
    }
    const abs = path.join(replicaRoot, rel);
    if (relativeInside(replicaRoot, abs, false) === null) continue;
    // rmSync 不跟随符号链接;内嵌的 git 仓库以 `目录/` 出现,整个删
    fs.rmSync(abs, { recursive: true, force: true });
    parents.add(path.dirname(abs));
  }
  for (const dir of parents) pruneEmptyDirs(dir, replicaRoot, false);
  return kept;
}

/**
 * ② 清空副本数据目录里除 `.gitignore` 以外的内容(克隆带过来的是主目录的数据),`.gitignore` 原样
 * 保留;建空的本地库和指回主目录数据目录的 `shared` 链接(目标写 realpath,两边打开同一个库文件)。
 */
function resetDataDir(replicaRoot: string, mainRoot: string): void {
  const local = getCodeGraphDir(replicaRoot);
  const stat = fs.lstatSync(local, { throwIfNoEntry: false });
  let hasGitignore = false;
  if (stat !== undefined && !stat.isDirectory()) {
    // 主目录的数据目录本身是链接时克隆带来的也是链接:只删链接本身,不进去清空(那是主目录的数据)
    fs.rmSync(local, { force: true });
  } else if (stat !== undefined) {
    for (const name of fs.readdirSync(local)) {
      if (name === GITIGNORE) {
        hasGitignore = true;
        continue;
      }
      fs.rmSync(path.join(local, name), { recursive: true, force: true });
    }
  }
  if (!hasGitignore) createDirectory(replicaRoot);
  DatabaseConnection.open(getLocalDatabasePath(replicaRoot)).close();
  fs.symlinkSync(fs.realpathSync(getCodeGraphDir(mainRoot)), path.join(local, SHARED_LINK_NAME), 'dir');
}

/** ③ 副本里从当前提交拉出需求分支。 */
function checkoutBranch(replicaRoot: string, branch: string): void {
  const r = runGit(replicaRoot, ['checkout', '-q', '-b', branch]);
  if (r.status !== 0) {
    throw new Error(`副本里建分支 ${branch} 失败:${r.error?.message ?? firstLine(r.stderr)}`);
  }
}

/** dir 的直接子目录(不跟随符号链接,跳过 .git);读不了 → []。 */
function subdirs(dir: string): string[] {
  try {
    return fs
      .readdirSync(dir, { withFileTypes: true })
      .filter((d) => d.isDirectory() && d.name !== '.git')
      .map((d) => path.join(dir, d.name));
  } catch {
    return [];
  }
}

/** text 里出现 p,且后面紧跟路径分隔、空白或结尾(免得 /a/proj 误中 /a/proj2)。 */
function mentionsPath(text: string, p: string): boolean {
  for (let i = text.indexOf(p); i !== -1; i = text.indexOf(p, i + 1)) {
    const next = text[i + p.length];
    if (next === undefined || next === '/' || /\s/.test(next)) return true;
  }
  return false;
}

/** ④ 副本根下一层、两层目录里的 pyvenv.cfg 写着主目录路径 → 提示在副本里重建虚拟环境。 */
function venvWarnings(replicaRoot: string, mainPaths: readonly string[]): string[] {
  const candidates: string[] = [];
  for (const dir of subdirs(replicaRoot)) candidates.push(dir, ...subdirs(dir));
  const warnings: string[] = [];
  for (const dir of candidates) {
    let text: string;
    try {
      text = fs.readFileSync(path.join(dir, PYVENV_CFG), 'utf8');
    } catch {
      continue;
    }
    if (mainPaths.some((p) => mentionsPath(text, p))) {
      const rel = path.relative(replicaRoot, dir).split(path.sep).join('/');
      warnings.push(`副本里的 ${rel} 写死了主目录路径,在副本里重建虚拟环境`);
    }
  }
  return warnings;
}

/**
 * ⑥ 删掉主目录 `docs/features/<featureId>/` 下第 ① 步保留的文件(已移进副本),再删掉因此变空的
 * 目录(含这个需求目录本身:留下空目录,按 feature-id 找需求目录时会先命中主目录)。
 * 删不掉的、内嵌的 git 仓库只记进 warnings,不回滚。
 */
function moveOutOfMain(
  mainRoot: string,
  featureId: string,
  kept: readonly string[],
): { movedFiles: string[]; warnings: string[] } {
  const movedFiles: string[] = [];
  const warnings: string[] = [];
  const parents = new Set<string>();
  for (const rel of kept) {
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

// ---------- 入口 ----------

/**
 * 在主目录旁开出需求副本并登记。这个需求已有在用、目录还在的副本 → 原样返回它(created: false)。
 */
export function createReplica(projectRoot: string, opts: CreateReplicaOptions): CreateReplicaResult {
  assertPlatform();
  assertArgs(projectRoot, opts);
  const { realRoot, baseBranch } = assertMainDir(projectRoot);
  const mainRoot = path.resolve(projectRoot);

  const existing = listReplicas(mainRoot).find(
    (e) => e.featureId === opts.featureId && isDirectory(e.path),
  );
  if (existing !== undefined) return { ...existing, created: false, movedFiles: [], warnings: [] };

  assertCleanMain(mainRoot);
  assertBranchFree(mainRoot, opts.branch);
  const name = `${path.basename(realRoot)}${REPLICA_NAME_SEPARATOR}${opts.prefix}`;
  const target = path.join(path.dirname(realRoot), name);
  assertTargetFree(mainRoot, target);

  copyTree(realRoot, target, opts.fullCopy === true);

  let entryFile: string | null = null;
  let kept: string[];
  let entry: ReplicaEntry;
  const warnings: string[] = [];
  try {
    appendExclude(target, localDirPatterns()); // ①
    kept = dropUntracked(target, opts.featureId);
    resetDataDir(target, mainRoot); // ②
    checkoutBranch(target, opts.branch); // ③
    fs.mkdirSync(featureDirOf(target, opts.featureId), { recursive: true });
    warnings.push(...venvWarnings(target, [...new Set([mainRoot, realRoot])])); // ④
    entry = {
      name,
      path: target,
      featureId: opts.featureId,
      branch: opts.branch,
      baseBranch,
      createdAt: new Date().toISOString(),
      removedAt: null,
    };
    entryFile = writeEntry(mainRoot, entry); // ⑤
  } catch (err) {
    removeQuietly(target);
    if (entryFile !== null) removeQuietly(entryFile);
    throw err;
  }

  const moved = moveOutOfMain(realRoot, opts.featureId, kept); // ⑥
  return {
    ...entry,
    created: true,
    movedFiles: moved.movedFiles,
    warnings: [...warnings, ...moved.warnings],
  };
}
