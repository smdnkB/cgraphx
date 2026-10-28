/**
 * git 钩子片段写入(spec D33):timeline 的 post-commit / post-merge 片段、release 的
 * commit-msg 片段都经这里写进 git 实际会执行的钩子文件。
 *
 * - 钩子目录取 `git rev-parse --git-path hooks`:已含 core.hooksPath(如 husky 把钩子目录
 *   改到 `.husky/_`),片段写进 git 真正执行的目录,而不是固定的 `.git/hooks`
 * - 片段紧跟第一行 shebang 插入(没有 shebang 就放最前):原钩子以 exec / exit 结尾时片段
 *   照样执行;每行都带调用方给的 marker,重装时先删旧行再插入;写进已有文件后设为可执行
 * - 只写不被 git 跟踪的钩子文件,按情况依次判断,不写的给出原因(链接、被跟踪的还给要加的几行):
 *   ① 钩子目录既不在工作区、也不在 git 目录里(core.hooksPath 指向仓库外的共用目录,或 `.git/hooks`
 *      链到仓库外)→ 卸载也不碰
 *   ② 钩子文件(链接看它指向的文件)不是 shell 脚本(node、python 等;没有 shebang 而含 NUL 字节的按
 *      二进制算):插进 sh 片段会让钩子报错、每次提交都失败
 *   ③ 钩子文件是符号链接:写入会顺着链接改到别处(被跟踪的文件、别的仓库也在用的文件)
 *   ④ 钩子文件或链接指向的文件被 git 跟踪(不在工作区里也算):工作区这份有片段就算已装上;卸载看暂存区
 *      那份——有片段是团队提交的,不删;只有工作区这份有是本机没提交的,删掉
 *   ⑤ 钩子文件不存在 → 新建,建在工作区里的写进 `.git/info/exclude`
 *   ⑥ 装上的片段登记在 `<git 公共目录>/cgraphx/hook-snippets.json`,连同写进过的文件:换了钩子目录
 *      后迁走同一工作区或 git 目录下旧文件里的片段,卸载按登记清(别的仓库的不碰);会话开始时按登记补回缺了的
 *      (husky 9 每次装依赖都重写 `.husky/_/`、新开的 worktree、被别的工具覆盖),补不上的删掉登记
 * - 钩子目录不是默认的 `.git/hooks` 时,新片段装上后删掉 `.git/hooks` 里旧版本留下的片段;
 *   `.git/hooks` 本身链到 git 目录外(共用目录)不动
 *
 * 只用 `node:` 内置模块,不依赖任何子系统。
 */

import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';

import {
  appendGitInfoLines,
  canonicalHookPath,
  gitPathPattern,
  hasSnippetLine,
  isBinaryHook,
  isNonShellShebang,
  isSnippetLine,
  isSymlink,
  isWithin,
  linkTargetPath,
  makeExecutable,
  readFileOrNull,
  realpathLoose,
  removeGitInfoLine,
  snippetNeedles,
  stripSnippetLines,
} from './git-hooks-files';

export { appendGitInfoLines, gitPathPattern } from './git-hooks-files';

export type GitHookName = 'post-commit' | 'post-merge' | 'commit-msg';

/** 没写入的原因:不是 shell 脚本 / 钩子目录在仓库外 / 钩子文件是链接 / 钩子文件被 git 跟踪。 */
export type HookSkipReason = 'not_shell' | 'outside_repo' | 'symlink' | 'tracked';

/** 钩子文件是链接时它最终指向的文件,以及往那里加片段的后果。 */
export interface HookLinkTarget {
  path: string;
  /** tracked:被 git 跟踪,加进去会随提交给全组 / outside_repo:在仓库外,会影响所有用它的仓库 / local:本机文件 */
  scope: 'tracked' | 'outside_repo' | 'local';
}

export interface HookSnippetResult {
  /** 钩子文件绝对路径(unsupported 时为没写入的那个文件) */
  hookPath: string;
  status: 'installed' | 'present' | 'updated' | 'unsupported';
  /** unsupported 时:没写入的原因 */
  reason?: HookSkipReason;
  /** reason 为 symlink、tracked 时:要用户自己加的几行 */
  lines?: readonly string[];
  /** reason 为 symlink 时:链接指向的文件 */
  linkTarget?: HookLinkTarget;
}

export interface HookRemoveResult {
  /** removed:删过片段的文件;unsupported:片段提交在仓库里、没删的文件;absent:当前的钩子文件 */
  hookPath: string;
  status: 'removed' | 'absent' | 'unsupported';
  /** unsupported 时:片段在被 git 跟踪的文件里,是提交进仓库的 */
  reason?: 'tracked';
}

/** 新建钩子文件时的第一行。 */
const DEFAULT_SHEBANG = '#!/bin/sh';

/** 新建的钩子文件的权限。 */
const HOOK_FILE_MODE = 0o755;

/** 片段登记:`<git 公共目录>/cgraphx/hook-snippets.json`(副本、worktree 各按自己的公共目录)。 */
const REGISTRY_DIR = 'cgraphx';
const REGISTRY_FILE = 'hook-snippets.json';

/** 在 cwd 下跑 git,返回 stdout;出错(不在仓库、没装 git、非零退出等)一律 → null。 */
function runGit(cwd: string, args: readonly string[]): string | null {
  try {
    return execFileSync('git', args, {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
  } catch {
    return null;
  }
}

/**
 * 钩子目录的绝对路径:`git rev-parse --git-path hooks`(已含 core.hooksPath),输出按 cwd
 * 解析成绝对路径。不在 git 仓库 → null。
 */
export function resolveHooksDir(cwd: string): string | null {
  const out = runGit(cwd, ['rev-parse', '--git-path', 'hooks'])?.replace(/\r?\n$/, '');
  return out === undefined || out === '' ? null : path.resolve(cwd, out);
}

interface HookLocation {
  hooksDir: string;
  /** 钩子目录的 realpath */
  realHooksDir: string;
  /** 工作区根(realpath);bare 仓库等取不到 → null */
  top: string | null;
  /** git 公共目录(realpath):`info/exclude` 和片段登记都在这里 */
  commonDir: string;
  /** 钩子目录在 git 目录里 / 工作区里 / 仓库外(①) */
  place: 'git_dir' | 'worktree' | 'outside';
}

/**
 * 文件(realpath 后)在工作区里 → 相对工作区根的 POSIX 路径;不在、或其实在 git 目录里 → null。
 * 两边都含它时按更深的那个算:默认的 `.git/hooks` 在工作区根下但属于 git 目录;在 bare 仓库目录里
 * 建的 worktree,工作区在 git 目录下面,工作区里的文件仍算工作区。
 */
function worktreeRelOf(loc: Pick<HookLocation, 'top' | 'commonDir'>, realFile: string): string | null {
  if (loc.top === null || !isWithin(loc.top, realFile)) return null;
  if (isWithin(loc.commonDir, realFile) && loc.commonDir.length >= loc.top.length) return null;
  return path.relative(loc.top, realFile).split(path.sep).join('/');
}

/**
 * 一次 rev-parse 取齐钩子目录、公共目录和工作区根。bare 仓库没有工作区:--show-toplevel 报错前
 * 已经输出了前两项,从失败的输出里取,不再跑第二次;什么都没输出(不在仓库)→ null。
 */
function locateHooks(cwd: string): HookLocation | null {
  let out: string;
  try {
    out = execFileSync('git', ['rev-parse', '--git-path', 'hooks', '--git-common-dir', '--show-toplevel'], {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
  } catch (err) {
    const stdout = (err as { stdout?: unknown }).stdout;
    out = typeof stdout === 'string' ? stdout : '';
  }
  const [hooksOut, commonOut, topOut] = out.split(/\r?\n/);
  if (hooksOut === undefined || hooksOut === '' || commonOut === undefined || commonOut === '') return null;
  const hooksDir = path.resolve(cwd, hooksOut);
  const commonDir = realpathLoose(path.resolve(cwd, commonOut));
  const top = topOut === undefined || topOut === '' ? null : realpathLoose(topOut);
  const realHooksDir = realpathLoose(hooksDir);
  const place: HookLocation['place'] =
    worktreeRelOf({ top, commonDir }, realHooksDir) !== null
      ? 'worktree'
      : isWithin(commonDir, realHooksDir)
        ? 'git_dir'
        : 'outside';
  return { hooksDir, realHooksDir, top, commonDir, place };
}

/**
 * 登记里的一个文件归谁:本工作区或 git 目录 → 'self';同一仓库别的 worktree → 那个 worktree 的位置;
 * 别的仓库(副本整仓复制带过去的登记)、目录已不在 → null。按 git 自己的判断,不按路径前缀:worktree
 * 可以建在主工作区或 bare 仓库目录里面。
 */
function ownerOf(loc: HookLocation, file: string): HookLocation | 'self' | null {
  const owner = locateHooks(path.dirname(file));
  if (owner === null || owner.commonDir !== loc.commonDir) return null;
  return owner.top === null || owner.top === loc.top ? 'self' : owner;
}

/** 被 git 跟踪的文件:工作区根和相对路径。 */
interface TrackedFile {
  top: string;
  rel: string;
}

/** ④ 文件(realpath 后)在工作区里且被 git 跟踪 → 它的位置;否则 null。 */
function trackedFileOf(loc: HookLocation, realFile: string): TrackedFile | null {
  const rel = worktreeRelOf(loc, realFile);
  if (loc.top === null || rel === null) return null;
  const out = runGit(loc.top, ['--literal-pathspecs', 'ls-files', '-z', '--', rel]);
  return out !== null && out !== '' ? { top: loc.top, rel } : null;
}

/** ④ 暂存区里那份的内容(提交进仓库的版本);读不到 → ''。 */
function committedContent(t: TrackedFile): string {
  return runGit(t.top, ['show', `:${t.rel}`]) ?? '';
}

/** 卸载、迁走旧位置时删一个钩子文件里的片段:按 ①③④ 判断能不能动。 */
type StripOutcome = 'removed' | 'absent' | 'committed' | 'skipped';

function stripAt(loc: HookLocation, file: string, needles: readonly string[]): StripOutcome {
  const link = isSymlink(file);
  const realFile = link ? linkTargetPath(file) : realpathLoose(file);
  // ① 仓库外的共用目录、链到仓库外的文件:不动
  if (!isWithin(loc.commonDir, realFile) && (loc.top === null || !isWithin(loc.top, realFile))) return 'skipped';
  const tracked = trackedFileOf(loc, realFile);
  // ④ 被跟踪的:团队提交了片段就不删;只是本机没提交的就删掉
  if (tracked !== null && hasSnippetLine(committedContent(tracked), needles)) return 'committed';
  // ③ 链到本仓库里的文件、④ 被跟踪的文件:只写回,不删文件
  if (link || tracked !== null) return stripSnippetLines(realFile, needles, false) === null ? 'absent' : 'removed';
  const outcome = stripSnippetLines(file, needles, true);
  if (outcome === null) return 'absent';
  const rel = worktreeRelOf(loc, realFile);
  if (outcome === 'deleted' && rel !== null) {
    removeGitInfoLine(path.join(loc.commonDir, 'info', 'exclude'), gitPathPattern(rel));
  }
  return 'removed';
}

/**
 * 默认钩子目录 `<git 公共目录>/hooks` 以外时,删掉那里旧版本留下的片段;删过返回那个文件路径。
 * 两边都解析链接后再比较;`.git/hooks` 本身链到 git 目录外(共用目录)不动,钩子文件是链接也不动。
 */
function stripLegacySnippet(loc: HookLocation, hook: GitHookName, needles: readonly string[]): string | null {
  const realDefault = realpathLoose(path.join(loc.commonDir, 'hooks'));
  if (realDefault === loc.realHooksDir || !isWithin(loc.commonDir, realDefault)) return null;
  const legacy = path.join(realDefault, hook);
  if (isSymlink(legacy)) return null;
  return stripSnippetLines(legacy, needles, true) === null ? null : legacy;
}

// ---------- 片段登记(⑥) ----------

interface RegisteredSnippet {
  hook: GitHookName;
  marker: string;
  lines: string[];
  legacyMatch?: string;
  /** 写进过的钩子文件(canonicalHookPath);以前的登记没有这一项 */
  files?: string[];
}

function registryPath(loc: HookLocation): string {
  return path.join(loc.commonDir, REGISTRY_DIR, REGISTRY_FILE);
}

/** 读登记;文件不在、解析不了 → [],坏掉的条目跳过。 */
function readRegistry(loc: HookLocation): RegisteredSnippet[] {
  let raw: unknown;
  try {
    raw = JSON.parse(readFileOrNull(registryPath(loc)) ?? '[]');
  } catch {
    return [];
  }
  if (!Array.isArray(raw)) return [];
  return raw.filter(
    (e): e is RegisteredSnippet =>
      typeof e === 'object' &&
      e !== null &&
      typeof (e as RegisteredSnippet).hook === 'string' &&
      typeof (e as RegisteredSnippet).marker === 'string' &&
      Array.isArray((e as RegisteredSnippet).lines),
  );
}

/** 写登记(临时文件 + rename);一条不剩就删掉文件,目录空了也删。 */
function writeRegistry(loc: HookLocation, entries: readonly RegisteredSnippet[]): void {
  const file = registryPath(loc);
  if (entries.length === 0) {
    fs.rmSync(file, { force: true });
    try {
      fs.rmdirSync(path.dirname(file));
    } catch {
      // 目录里还有别的文件,或本来就不在
    }
    return;
  }
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(entries, null, 2)}\n`, 'utf8');
  fs.renameSync(tmp, file);
}

function sameSnippet(e: RegisteredSnippet, hook: GitHookName, marker: string): boolean {
  return e.hook === hook && e.marker === marker;
}

/**
 * 装上之后登记,并迁走旧位置:登记里同一工作区或 git 目录下、不是这次写的文件,删掉其中的片段
 * (按 ①③④ 判断);别的 worktree 里的只在卸载时删;别的仓库的、目录已不在的从登记里去掉,不碰。
 * 内容没变不写盘。
 */
function registerSnippet(loc: HookLocation, entry: RegisteredSnippet, hookPath: string, needles: readonly string[]): void {
  const entries = readRegistry(loc);
  const index = entries.findIndex((e) => sameSnippet(e, entry.hook, entry.marker));
  const current = canonicalHookPath(hookPath);
  const files: string[] = [];
  for (const file of entries[index]?.files ?? []) {
    if (typeof file !== 'string' || file === current || files.includes(file)) continue;
    const owner = ownerOf(loc, file);
    if (owner === 'self') stripAt(loc, file, needles);
    else if (owner !== null) files.push(file);
  }
  const next: RegisteredSnippet = { ...entry, files: [...files, current] };
  if (index >= 0 && JSON.stringify(entries[index]) === JSON.stringify(next)) return;
  if (index >= 0) entries[index] = next;
  else entries.push(next);
  writeRegistry(loc, entries);
}

function unregisterSnippet(loc: HookLocation, hook: GitHookName, marker: string): void {
  const entries = readRegistry(loc);
  const kept = entries.filter((e) => !sameSnippet(e, hook, marker));
  if (kept.length !== entries.length) writeRegistry(loc, kept);
}

// ---------- 安装 / 卸载 ----------

/** 新建钩子文件并设为 0755(writeFileSync 的 mode 只在新建时生效,再显式 chmod 一次)。 */
function createHookFile(hookPath: string, content: string): void {
  fs.writeFileSync(hookPath, content, { mode: HOOK_FILE_MODE });
  try {
    fs.chmodSync(hookPath, HOOK_FILE_MODE);
  } catch {
    // 不支持 chmod 的文件系统:保持 writeFileSync 给的权限
  }
}

/** ③ 链接指向的文件,以及往那里加片段的后果。 */
function linkTargetOf(loc: HookLocation, target: string, tracked: TrackedFile | null): HookLinkTarget {
  if (!isWithin(loc.commonDir, target) && (loc.top === null || !isWithin(loc.top, target))) {
    return { path: target, scope: 'outside_repo' };
  }
  return { path: target, scope: tracked !== null ? 'tracked' : 'local' };
}

/** 按 ①~⑤ 写入,不碰登记和旧片段。 */
function writeSnippet(
  loc: HookLocation,
  hookPath: string,
  marker: string,
  lines: readonly string[],
  needles: readonly string[],
): HookSnippetResult {
  const skip = (reason: HookSkipReason, extra: Partial<HookSnippetResult> = {}): HookSnippetResult => ({
    hookPath,
    status: 'unsupported',
    reason,
    ...(reason === 'symlink' || reason === 'tracked' ? { lines } : {}),
    ...extra,
  });
  if (loc.place === 'outside') return skip('outside_repo');

  const link = isSymlink(hookPath);
  const realFile = link ? linkTargetPath(hookPath) : realpathLoose(hookPath);
  const original = readFileOrNull(realFile);
  const kept = original?.split('\n').filter((line) => !isSnippetLine(line, needles)) ?? [];
  // ② 先看内容(链接看它指向的文件):不是 shell 脚本就不给 sh 片段
  if (original !== null && (isBinaryHook(original) || isNonShellShebang(kept[0]))) return skip('not_shell');

  // ④ 被跟踪的按 git 判断:文件不在工作区里(删了没暂存、稀疏检出)也不新建
  const tracked = trackedFileOf(loc, realFile);
  if (link || tracked !== null) {
    // ③④ 不写;git 实际执行的那份(链接看它指向的文件)里已经有这段片段:算已装上
    if (original !== null && marker !== '' && original.includes(marker)) return { hookPath, status: 'present' };
    return link ? skip('symlink', { linkTarget: linkTargetOf(loc, realFile, tracked) }) : skip('tracked');
  }

  if (original === null) {
    fs.mkdirSync(loc.hooksDir, { recursive: true });
    createHookFile(hookPath, `${[DEFAULT_SHEBANG, ...lines].join('\n')}\n`);
    const rel = worktreeRelOf(loc, realpathLoose(hookPath));
    if (loc.top !== null && rel !== null && runGit(loc.top, ['check-ignore', '-q', '--', rel]) === null) {
      appendGitInfoLines(path.join(loc.commonDir, 'info', 'exclude'), [gitPathPattern(rel)]);
    }
    return { hookPath, status: 'installed' };
  }

  const insertAt = kept[0]?.startsWith('#!') === true ? 1 : 0;
  const next = [...kept.slice(0, insertAt), ...lines, ...kept.slice(insertAt)].join('\n');
  const hadMarker = marker !== '' && original.split('\n').some((line) => line.includes(marker));
  const unchanged = hadMarker && next === original;
  if (!unchanged) fs.writeFileSync(hookPath, next);
  makeExecutable(hookPath);
  return { hookPath, status: unchanged ? 'present' : hadMarker ? 'updated' : 'installed' };
}

/** 在已取到的钩子位置写入;装上后(⑥)登记、迁走旧位置,并删掉默认钩子目录里旧版本留下的片段。 */
function installAt(
  loc: HookLocation,
  hook: GitHookName,
  marker: string,
  lines: readonly string[],
  legacyMatch: string | undefined,
): HookSnippetResult {
  const needles = snippetNeedles(marker, legacyMatch);
  const hookPath = path.join(loc.hooksDir, hook);
  const result = writeSnippet(loc, hookPath, marker, lines, needles);
  if (result.status !== 'unsupported') {
    const entry: RegisteredSnippet = { hook, marker, lines: [...lines], ...(legacyMatch !== undefined ? { legacyMatch } : {}) };
    registerSnippet(loc, entry, hookPath, needles);
    stripLegacySnippet(loc, hook, needles);
  }
  return result;
}

/**
 * 把片段写进钩子文件。不在 git 仓库 → null。
 *
 * - ① 钩子目录在仓库外、② 钩子文件不是 shell 脚本、③ 钩子文件是链接、④ 钩子文件被 git 跟踪 →
 *   什么都不写,status `unsupported`,带 reason(链接、被跟踪的还带要用户自己加的 lines,链接带它指向
 *   的文件);git 实际执行的那份(③ 看链接指向的文件)里已经有这段片段 → `present`
 * - ⑤ 文件不存在 → 新建(钩子目录不在时一并创建),内容为 `#!/bin/sh` 加 lines;建在工作区里的写进
 *   `.git/info/exclude`(本来就被忽略的不写)
 * - 否则先删掉含 marker(及 legacyMatch)的行,再把 lines 插到 shebang 之后(没有就放最前),设为可执行
 * - 装上后(⑥)登记这个片段、迁走旧位置的片段,并删掉默认钩子目录里旧版本留下的片段
 *
 * status:原文件里没有含 marker 的行 → `installed`;插入后与原文件逐字相同 → `present`
 * (不写盘);其余 → `updated`。
 */
export function installHookSnippet(
  cwd: string,
  hook: GitHookName,
  marker: string,
  lines: readonly string[],
  opts?: { legacyMatch?: string },
): HookSnippetResult | null {
  const loc = locateHooks(cwd);
  return loc === null ? null : installAt(loc, hook, marker, lines, opts?.legacyMatch);
}

/**
 * 删掉片段:当前钩子文件、登记里写进过的文件(别的 worktree 里的按那个 worktree 判断,别的仓库的
 * 不碰)、默认钩子目录里旧版本留下的,再删掉这条登记。仓库外的不碰;被跟踪的文件里片段是提交进仓库的 → 不删,
 * 当前钩子文件是这种情况时返回 `unsupported`;只剩 shebang 或空白的、cgraphx 建的文件删掉,连同它在
 * exclude 里的那一行。不在 git 仓库 → null。
 */
export function removeHookSnippet(
  cwd: string,
  hook: GitHookName,
  marker: string,
  opts?: { legacyMatch?: string },
): HookRemoveResult | null {
  const loc = locateHooks(cwd);
  if (loc === null) return null;
  const needles = snippetNeedles(marker, opts?.legacyMatch);
  const recorded = readRegistry(loc).find((e) => sameSnippet(e, hook, marker))?.files ?? [];
  unregisterSnippet(loc, hook, marker);
  const hookPath = path.join(loc.hooksDir, hook);
  const current = stripAt(loc, hookPath, needles);
  let removed = stripLegacySnippet(loc, hook, needles);
  const self = canonicalHookPath(hookPath);
  for (const file of recorded) {
    if (typeof file !== 'string' || file === self) continue;
    const owner = ownerOf(loc, file);
    if (owner !== null && stripAt(owner === 'self' ? loc : owner, file, needles) === 'removed') removed ??= file;
  }
  if (current === 'committed') return { hookPath, status: 'unsupported', reason: 'tracked' };
  if (current === 'removed') return { hookPath, status: 'removed' };
  return removed !== null ? { hookPath: removed, status: 'removed' } : { hookPath, status: 'absent' };
}

/**
 * ⑥ 按登记补回缺了的片段:钩子文件里已经有这个 marker 的跳过;其余照安装写入(同样按 ①~⑤ 判断)。
 * 补不上的(被跟踪了、成了链接等)删掉这条登记,不再每次重试,由调用方把原因提示一次。
 * 不在 git 仓库、没有登记 → []。返回这次尝试补装的结果。
 */
export function repairHookSnippets(cwd: string): HookSnippetResult[] {
  const loc = locateHooks(cwd);
  if (loc === null) return [];
  const results: HookSnippetResult[] = [];
  for (const entry of readRegistry(loc)) {
    if (readFileOrNull(path.join(loc.hooksDir, entry.hook))?.includes(entry.marker) === true) continue;
    const result = installAt(loc, entry.hook, entry.marker, entry.lines, entry.legacyMatch);
    if (result.status === 'unsupported') unregisterSnippet(loc, entry.hook, entry.marker);
    results.push(result);
  }
  return results;
}

/**
 * 安装结果给人看的一句提示:没写入时说原因,链接、被跟踪的还给要加的几行;其余 → null。
 * what 是没写入时的说法,默认「没写入」(release 传「没装上提交拦截」)。
 */
export function hookNotice(
  result: Pick<HookSnippetResult, 'hookPath' | 'reason' | 'lines' | 'linkTarget'> & { status: string },
  what = '没写入',
): string | null {
  if (result.status !== 'unsupported') return null;
  const addLines = (where: string): string =>
    `;要装的话,把下面几行加到${where}第一行 shebang 之后(没有 shebang 就放最前):\n${(result.lines ?? []).join('\n')}`;
  switch (result.reason) {
    case 'outside_repo':
      return `钩子目录 ${path.dirname(result.hookPath)} 在仓库外,是多个仓库共用的,${what}`;
    case 'symlink': {
      const target = result.linkTarget;
      if (target === undefined) return `钩子文件 ${result.hookPath} 是链接,${what}`;
      const effect =
        target.scope === 'tracked'
          ? '(它被 git 跟踪,加进去会随提交给全组)'
          : target.scope === 'outside_repo'
            ? '(它在仓库外,加进去会影响所有用它的仓库)'
            : '';
      return `钩子文件 ${result.hookPath} 是链接,指向 ${target.path}${effect},${what}${addLines('它指向的文件')}`;
    }
    case 'tracked':
      return `钩子文件 ${result.hookPath} 被 git 跟踪,${what}(写进去会出现在 git status 里、随提交给全组)${addLines('它')}`;
    default:
      return `钩子文件 ${result.hookPath} 不是 shell 脚本,${what}`;
  }
}

/** 卸载结果给人看的一句提示:片段是提交在仓库里的、没删时说明;其余 → null。what 是片段的叫法。 */
export function hookRemoveNotice(result: HookRemoveResult, what = '片段'): string | null {
  if (result.status !== 'unsupported') return null;
  return `钩子文件 ${result.hookPath} 被 git 跟踪,里面的${what}是提交在仓库里的,没删;要去掉就从仓库里删掉这几行再提交`;
}
