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
import { appendGitInfoLines, gitPathPattern } from '../git-hooks';
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

// ---------- 复制(D20) ----------

/** cp 克隆不了时的报错(GNU cp 的 reflink、macOS 的 clonefile):只有这类失败才报 no_cow。 */
const CLONE_UNSUPPORTED = /failed to clone|clonefile|not supported|cross-device|EOPNOTSUPP|EXDEV/i;

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

function noCowError(source: string, reason: string, note: string): ReplicaError {
  const bytes = requiredBytes(source);
  return new ReplicaError(
    'no_cow',
    `这块盘不能写时复制(${reason})${note};整份复制约需 ${formatGb(bytes)},确认后加 --full-copy 重跑`,
    { requiredBytes: bytes },
  );
}

/**
 * macOS 复制前判断能不能克隆(spec D20):`cp -c` 克隆不了时会悄悄退成整份复制、命令照样成功,
 * 只看命令失败判不出 no_cow(F7④ 要在整份复制前先问)。目标目录和主目录同卷、且卷是 APFS 才算能克隆;
 * 取不到设备或挂载信息按不能克隆处理。能克隆返回 null,否则返回原因。
 */
export function darwinCloneBlocker(source: string, targetParent: string): string | null {
  let sameVolume: boolean;
  try {
    sameVolume = fs.statSync(source).dev === fs.statSync(targetParent).dev;
  } catch (err) {
    return `读不了卷信息:${errorMessage(err)}`;
  }
  if (!sameVolume) return '目标目录和主目录不在同一个卷上';
  const stat = runCommand('/usr/bin/stat', ['-f', '%Sd', source], source);
  const device = stat.status === 0 ? stat.stdout.trim() : '';
  const mount = device === '' ? null : runCommand('/sbin/mount', [], source);
  // 挂载行形如 `/dev/disk3s5 on /System/Volumes/Data (apfs, local, …)`;挂载点可能带空格和括号,取最后一个 ` (`
  const line =
    mount !== null && mount.status === 0
      ? mount.stdout.split('\n').find((l) => l.startsWith(`/dev/${device} on `))
      : undefined;
  const open = line === undefined ? -1 : line.lastIndexOf(' (');
  const fsType = line === undefined || open < 0 ? '' : (line.slice(open + 2).split(/[,)]/)[0] ?? '').trim();
  if (fsType === '') return '判断不了这块盘是不是 APFS';
  return fsType === 'apfs' ? null : `这块盘是 ${fsType},不是 APFS`;
}

/** 写时复制整个主目录(D20);复制命令失败时先删掉复制了一半的目标目录。 */
function copyTree(source: string, target: string, fullCopy: boolean): void {
  if (!fullCopy && process.platform === 'darwin') {
    const blocker = darwinCloneBlocker(source, path.dirname(target));
    if (blocker !== null) throw noCowError(source, blocker, '');
  }
  const { cmd, args } = copyCommand(fullCopy);
  // LC_MESSAGES=C:GNU cp、glibc 的报错按 locale 翻译,中文环境下下面按英文认「克隆不了」会认不出。只改报错的
  // 语言、不动 LC_CTYPE(C 下 GNU cp 把中文文件名转义成 $'\350…');继承来的 LC_ALL 会盖过它,去掉
  const env: NodeJS.ProcessEnv = { ...process.env, LC_MESSAGES: 'C' };
  delete env.LC_ALL;
  const r = runCommand(cmd, [...args, source, target], path.dirname(source), env);
  if (r.status === 0) return;
  removeQuietly(target);
  const reason = r.error?.message ?? firstLine(r.stderr);
  if (fullCopy) {
    throw new Error(`整份复制失败(${reason}),已删掉复制了一半的 ${target};检查磁盘空间和权限后重跑`);
  }
  // 克隆不了才算 no_cow;读不了的文件、权限这类原因整份复制也会一样失败,照实报错
  if (CLONE_UNSUPPORTED.test(`${reason}\n${r.stderr}`)) throw noCowError(source, reason, `,已删掉复制了一半的 ${target}`);
  throw new Error(`复制失败(${reason}),已删掉复制了一半的 ${target};检查主目录里文件的读权限后重跑`);
}

// ---------- 整理(D21) ----------

/**
 * ① 写进副本 exclude 的模式:各 agent 配置目录里开副本时没被跟踪的部分(`git ls-files --others
 * --exclude-standard --directory` 列出的每一项,照原样写、去掉末尾 `/`——整个没被跟踪的目录列成
 * `.claude/`,写成 `/.claude` 才连链接形式的 `.claude` 也匹配上),加上 cgraphx 数据目录。仓库跟踪了
 * 配置目录的一部分时,之后在被跟踪的位置新建的文件 git 看得见,K9 照常算(spec D21)。
 */
function localDirPatterns(replicaRoot: string): string[] {
  const dirs = [...new Set(listAgentProfiles().map((p) => p.configDirName))];
  const listed = runGit(replicaRoot, ['ls-files', '-z', '--others', '--exclude-standard', '--directory', '--', ...dirs]);
  if (listed.status !== 0) throw new Error(`副本 ${replicaRoot} 里列不出 agent 配置目录里没被跟踪的文件(git ls-files 失败)`);
  const untracked = listed.stdout.split('\0').filter((s) => s !== '').map((s) => s.replace(/\/+$/, ''));
  return [...new Set([...untracked, codeGraphDirName()])].map(gitPathPattern);
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
 * 目录(含这个需求目录本身)。被忽略的文件留在原处(副本里已有一份);删不干净留下的空壳不影响查找,
 * 按 feature-id 找需求目录先找副本(spec D26)。删不掉的、内嵌的 git 仓库只记进 warnings,不回滚。
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

/** 第 ① 步保留的、第 ⑥ 步要从主目录移走的文件(登记的 movedFiles):内嵌的 git 仓库(目录)不移,不算。 */
function filesToMove(mainRoot: string, kept: readonly string[]): string[] {
  return kept.filter((rel) => fs.lstatSync(path.join(mainRoot, rel), { throwIfNoEntry: false })?.isDirectory() !== true);
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
  if (existing !== undefined) return { ...existing, created: false, movedFiles: existing.movedFiles ?? [], warnings: [] };

  assertCleanMain(mainRoot);
  assertBranchFree(mainRoot, opts.branch);
  const name = `${path.basename(realRoot)}${REPLICA_NAME_SEPARATOR}${opts.prefix}`;
  const target = path.join(path.dirname(realRoot), name);
  assertNameFree(mainRoot, name, opts.featureId);
  assertTargetFree(mainRoot, target);
  const baseCommit = gitValue(realRoot, ['rev-parse', '--verify', '-q', 'HEAD']);

  copyTree(realRoot, target, opts.fullCopy === true);

  let entryFile: string | null = null;
  let kept: string[];
  let entry: ReplicaEntry;
  const warnings: string[] = [];
  try {
    appendGitInfoLines(path.join(target, '.git', 'info', 'exclude'), localDirPatterns(target)); // ①
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
      baseCommit,
      movedFiles: filesToMove(realRoot, kept),
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
