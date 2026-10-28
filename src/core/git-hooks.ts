/**
 * git 钩子片段写入(spec D33):timeline 的 post-commit / post-merge 片段、release 的
 * commit-msg 片段都经这里写进 git 实际会执行的钩子文件。
 *
 * - 钩子目录取 `git rev-parse --git-path hooks`:已含 core.hooksPath(如 husky 把钩子目录
 *   改到 `.husky/_`),片段写进 git 真正执行的目录,而不是固定的 `.git/hooks`
 * - 片段紧跟第一行 shebang 插入(没有 shebang 就放最前):原钩子以 exec / exit 结尾时片段
 *   照样执行;每行都带调用方给的 marker,重装时先删旧行再插入
 * - 只写不被 git 跟踪的钩子文件,其余情况不写,给出要用户自己加的几行:
 *   ① 钩子目录既不在工作区、也不在 git 目录里(core.hooksPath 指向仓库外的共用目录,或 `.git/hooks`
 *      链到仓库外)→ 卸载也不碰
 *   ② 钩子文件不是 shell 脚本(node、python 等;没有 shebang 而含 NUL 字节的按二进制算):插进 sh 片段
 *      会让钩子报错、每次提交都失败
 *   ③ 钩子文件是符号链接:写入会顺着链接改到别处(被跟踪的文件、别的仓库也在用的文件)
 *   ④ 钩子文件被 git 跟踪:写进去会出现在 git status 里、随提交给全组
 *   ⑤ 钩子文件不存在 → 新建,建在工作区里的写进 `.git/info/exclude`
 *   ⑥ 装上的片段登记在 `<git 公共目录>/cgraphx/hook-snippets.json`,会话开始时按登记补回缺了的
 *      (husky 9 每次装依赖都重写 `.husky/_/`、新开的 worktree、被别的工具覆盖)
 * - 钩子目录不是默认的 `.git/hooks` 时,新片段装上后删掉 `.git/hooks` 里旧版本留下的片段;
 *   `.git/hooks` 本身链到 git 目录外(共用目录)不动
 * - 卸载按 marker 删行,不碰用户自己的内容;剩下只有 shebang 或空白时删掉文件。钩子文件链接到本仓库
 *   里的文件时,删掉其中 cgraphx 自己的旧片段(2.0.10 顺着链接写进去的)
 *
 * 只用 `node:` 内置模块,不依赖任何子系统。
 */

import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';

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
  /** unsupported 时:要用户自己加的几行 */
  lines?: readonly string[];
  /** reason 为 symlink 时:链接指向的文件 */
  linkTarget?: HookLinkTarget;
}

/** 算作 shell 的解释器:shebang 里解释器路径的文件名是其中之一。 */
const SHELL_INTERPRETERS: ReadonlySet<string> = new Set(['sh', 'bash', 'zsh', 'dash', 'ksh']);

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

/** git 输出的单个路径:去掉末尾换行;没有输出 → null。 */
function outputPath(out: string | null): string | null {
  if (out === null) return null;
  const line = out.replace(/\r?\n$/, '');
  return line === '' ? null : line;
}

/** realpath;路径还不存在时,取最近一级已存在的上级做 realpath,再拼回剩下的部分。 */
function realpathLoose(p: string): string {
  const rest: string[] = [];
  let cur = path.resolve(p);
  for (;;) {
    try {
      return path.join(fs.realpathSync(cur), ...rest);
    } catch {
      const parent = path.dirname(cur);
      if (parent === cur) return path.resolve(p);
      rest.unshift(path.basename(cur));
      cur = parent;
    }
  }
}

/** child 就是 parent 或在它下面(两边都是绝对路径)。 */
function isWithin(parent: string, child: string): boolean {
  const rel = path.relative(parent, child);
  return rel === '' || (rel !== '..' && !rel.startsWith(`..${path.sep}`) && !path.isAbsolute(rel));
}

/**
 * 钩子目录的绝对路径:`git rev-parse --git-path hooks`(已含 core.hooksPath),输出按 cwd
 * 解析成绝对路径。不在 git 仓库 → null。
 */
export function resolveHooksDir(cwd: string): string | null {
  const out = outputPath(runGit(cwd, ['rev-parse', '--git-path', 'hooks']));
  return out === null ? null : path.resolve(cwd, out);
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

/** 一次 rev-parse 取齐钩子目录、公共目录和工作区根;bare 仓库没有工作区,去掉 --show-toplevel 再取。 */
function locateHooks(cwd: string): HookLocation | null {
  const out =
    runGit(cwd, ['rev-parse', '--git-path', 'hooks', '--git-common-dir', '--show-toplevel']) ??
    runGit(cwd, ['rev-parse', '--git-path', 'hooks', '--git-common-dir']);
  if (out === null) return null;
  const [hooksOut, commonOut, topOut] = out.split(/\r?\n/);
  if (hooksOut === undefined || hooksOut === '' || commonOut === undefined || commonOut === '') return null;
  const hooksDir = path.resolve(cwd, hooksOut);
  const commonDir = realpathLoose(path.resolve(cwd, commonOut));
  const top = topOut === undefined || topOut === '' ? null : realpathLoose(topOut);
  const realHooksDir = realpathLoose(hooksDir);
  let place: HookLocation['place'] = 'outside';
  if (isWithin(commonDir, realHooksDir)) place = 'git_dir';
  else if (top !== null && isWithin(top, realHooksDir)) place = 'worktree';
  return { hooksDir, realHooksDir, top, commonDir, place };
}

/** 文件(realpath 后)在工作区里时,它相对工作区根的 POSIX 路径;否则 null。 */
function worktreeRelOf(loc: HookLocation, realFile: string): string | null {
  if (loc.top === null || !isWithin(loc.top, realFile)) return null;
  return path.relative(loc.top, realFile).split(path.sep).join('/');
}

function isTracked(top: string, rel: string): boolean {
  const out = runGit(top, ['--literal-pathspecs', 'ls-files', '-z', '--', rel]);
  return out !== null && out !== '';
}

/** 钩子文件在工作区里、并且被 git 跟踪(④)。 */
function isTrackedHook(loc: HookLocation, hookPath: string): boolean {
  const rel = worktreeRelOf(loc, realpathLoose(hookPath));
  return loc.top !== null && rel !== null && isTracked(loc.top, rel);
}

/**
 * 工作区相对路径写成只匹配它自己的 gitignore 模式(`info/exclude` 用):以 `/` 开头锚定到根
 * (开头的 `#`、`!` 也就不再特殊),通配符前加 `\`,末尾空格转义。
 */
export function gitPathPattern(relPosix: string): string {
  const escaped = relPosix
    .replace(/[\\*?[]/g, (c) => `\\${c}`)
    .replace(/ +$/, (spaces) => spaces.replace(/ /g, '\\ '));
  return `/${escaped}`;
}

/**
 * 往 `.git/info/` 下的 exclude 这类文件追加几行;已有同一行不重复加。文件是符号链接时
 * (整仓克隆带过来的)先删链接本身再写,免得写进它指向的文件。
 */
export function appendGitInfoLines(file: string, lines: readonly string[]): void {
  const existing = readFileOrNull(file) ?? '';
  const present = new Set(existing.split(/\r?\n/).map((line) => line.trim()));
  const missing = lines.filter((line) => !present.has(line));
  if (missing.length === 0) return;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const sep = existing === '' || existing.endsWith('\n') ? '' : '\n';
  if (isSymlink(file)) fs.rmSync(file);
  fs.writeFileSync(file, `${existing}${sep}${missing.join('\n')}\n`, 'utf8');
}

/** 从 `.git/info/` 下的文件里删掉逐字相同的那一行;文件不在或没有这一行 → 不动。 */
function removeGitInfoLine(file: string, line: string): void {
  const existing = readFileOrNull(file);
  if (existing === null) return;
  const next = existing
    .split('\n')
    .filter((l) => l.trim() !== line)
    .join('\n');
  if (next !== existing) fs.writeFileSync(file, next, 'utf8');
}

/** 识别片段行的串:marker,以及给了的 legacyMatch;空串不算,免得删光整个文件。 */
function snippetNeedles(marker: string, legacyMatch: string | undefined): string[] {
  return [marker, legacyMatch].filter((s): s is string => typeof s === 'string' && s !== '');
}

function isSnippetLine(line: string, needles: readonly string[]): boolean {
  return needles.some((needle) => line.includes(needle));
}

/**
 * 第一行是不是 shell 以外解释器的 shebang。没有 shebang → false(git 会交给 sh 执行)。
 * 取 `#!` 之后解释器路径的文件名;是 env 时取它后面第一个不以 `-` 开头的参数。
 */
function isNonShellShebang(firstLine: string | undefined): boolean {
  if (firstLine === undefined || !firstLine.startsWith('#!')) return false;
  const words = firstLine.slice(2).trim().split(/\s+/);
  let interpreter = path.basename(words[0] ?? '');
  if (interpreter === 'env') {
    interpreter = path.basename(words.slice(1).find((w) => !w.startsWith('-')) ?? '');
  }
  return !SHELL_INTERPRETERS.has(interpreter);
}

/** ② 没有 shebang 而内容含 NUL 字节:二进制钩子,不能当 sh 脚本改。 */
function isBinaryHook(content: string): boolean {
  return !content.startsWith('#!') && content.includes('\u0000');
}

/** 读文件;不存在 → null,其余读失败照常抛出。 */
function readFileOrNull(file: string): string | null {
  try {
    return fs.readFileSync(file, 'utf8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw err;
  }
}

function isSymlink(file: string): boolean {
  return fs.lstatSync(file, { throwIfNoEntry: false })?.isSymbolicLink() === true;
}

/** 删掉片段行后只剩 shebang 或空白。 */
function onlyShebangLeft(kept: readonly string[]): boolean {
  const body = kept[0]?.startsWith('#!') === true ? kept.slice(1) : kept;
  return body.every((line) => line.trim() === '');
}

/**
 * 从文件里删掉片段行;剩下只有 shebang 或空白、而且 deleteIfEmpty 时删掉文件,否则保留原权限写回。
 * 2.0.10 把片段追加在文件末尾、前面空一行:删掉的行都在末尾时,连同末尾的空行去掉、只留一个换行,
 * 还原成追加前的样子(和 2.0.10 自己卸载的写法一致)。文件不在、没有可删的行 → null。
 */
function stripSnippetLines(file: string, needles: readonly string[], deleteIfEmpty: boolean): 'deleted' | 'rewritten' | null {
  const original = readFileOrNull(file);
  if (original === null) return null;
  const originalLines = original.split('\n');
  const kept = originalLines.filter((line) => !isSnippetLine(line, needles));
  if (kept.length === originalLines.length) return null;
  if (deleteIfEmpty && onlyShebangLeft(kept)) {
    fs.rmSync(file, { force: true });
    return 'deleted';
  }
  const firstSnippet = originalLines.findIndex((line) => isSnippetLine(line, needles));
  let lastContent = originalLines.length - 1;
  while (lastContent >= 0) {
    const line = originalLines[lastContent] ?? '';
    if (!isSnippetLine(line, needles) && line.trim() !== '') break;
    lastContent -= 1;
  }
  const next = firstSnippet > lastContent ? `${kept.join('\n').replace(/\n+$/, '')}\n` : kept.join('\n');
  fs.writeFileSync(file, next);
  return 'rewritten';
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

function registerSnippet(loc: HookLocation, entry: RegisteredSnippet): void {
  const others = readRegistry(loc).filter((e) => !(e.hook === entry.hook && e.marker === entry.marker));
  writeRegistry(loc, [...others, entry]);
}

function unregisterSnippet(loc: HookLocation, hook: GitHookName, marker: string): void {
  const entries = readRegistry(loc);
  const kept = entries.filter((e) => !(e.hook === hook && e.marker === marker));
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
function linkTargetOf(loc: HookLocation, hookPath: string): HookLinkTarget {
  const target = realpathLoose(hookPath);
  if (!isWithin(loc.commonDir, target) && (loc.top === null || !isWithin(loc.top, target))) {
    return { path: target, scope: 'outside_repo' };
  }
  const rel = worktreeRelOf(loc, target);
  return { path: target, scope: loc.top !== null && rel !== null && isTracked(loc.top, rel) ? 'tracked' : 'local' };
}

/** 按 ①~⑤ 写入,不碰登记和旧片段。 */
function writeSnippet(
  loc: HookLocation,
  hookPath: string,
  marker: string,
  lines: readonly string[],
  needles: readonly string[],
): HookSnippetResult {
  const skip = (reason: HookSkipReason, extra?: Partial<HookSnippetResult>): HookSnippetResult => ({
    hookPath,
    status: 'unsupported',
    reason,
    lines,
    ...extra,
  });

  if (loc.place === 'outside') return skip('outside_repo');
  if (isSymlink(hookPath)) return skip('symlink', { linkTarget: linkTargetOf(loc, hookPath) });
  if (loc.place === 'worktree' && isTrackedHook(loc, hookPath)) return skip('tracked');

  const original = readFileOrNull(hookPath);
  if (original === null) {
    fs.mkdirSync(loc.hooksDir, { recursive: true });
    createHookFile(hookPath, `${[DEFAULT_SHEBANG, ...lines].join('\n')}\n`);
    const rel = worktreeRelOf(loc, realpathLoose(hookPath));
    if (loc.top !== null && rel !== null && runGit(loc.top, ['check-ignore', '-q', '--', rel]) === null) {
      appendGitInfoLines(path.join(loc.commonDir, 'info', 'exclude'), [gitPathPattern(rel)]);
    }
    return { hookPath, status: 'installed' };
  }

  const originalLines = original.split('\n');
  const kept = originalLines.filter((line) => !isSnippetLine(line, needles));
  if (isBinaryHook(original) || isNonShellShebang(kept[0])) return skip('not_shell');

  const insertAt = kept[0]?.startsWith('#!') === true ? 1 : 0;
  const next = [...kept.slice(0, insertAt), ...lines, ...kept.slice(insertAt)].join('\n');
  const hadMarker = marker !== '' && originalLines.some((line) => line.includes(marker));
  if (hadMarker && next === original) return { hookPath, status: 'present' };
  // 已有文件写回时保留原权限
  fs.writeFileSync(hookPath, next);
  return { hookPath, status: hadMarker ? 'updated' : 'installed' };
}

/**
 * 把片段写进钩子文件。不在 git 仓库 → null。
 *
 * - ① 钩子目录在仓库外、③ 钩子文件是链接、④ 钩子文件被 git 跟踪、② 钩子文件不是 shell 脚本 →
 *   什么都不写,status `unsupported`,带 reason 和要用户自己加的 lines(链接还带它指向的文件)
 * - ⑤ 文件不存在 → 新建(钩子目录不在时一并创建),内容为 `#!/bin/sh` 加 lines;建在工作区里的写进
 *   `.git/info/exclude`(本来就被忽略的不写)
 * - 否则先删掉含 marker(及 legacyMatch)的行,再把 lines 插到 shebang 之后(没有就放最前)
 * - 装上后(⑥)登记这个片段,并删掉默认钩子目录里旧版本留下的片段
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
  if (loc === null) return null;
  const needles = snippetNeedles(marker, opts?.legacyMatch);
  const result = writeSnippet(loc, path.join(loc.hooksDir, hook), marker, lines, needles);
  if (result.status !== 'unsupported') {
    registerSnippet(loc, {
      hook,
      marker,
      lines: [...lines],
      ...(opts?.legacyMatch !== undefined ? { legacyMatch: opts.legacyMatch } : {}),
    });
    stripLegacySnippet(loc, hook, needles);
  }
  return result;
}

/**
 * 从钩子文件删掉含 marker(及 legacyMatch)的行,并删掉这个片段的登记;剩下的只有 shebang 或空白 →
 * 删掉文件,连同它在 `.git/info/exclude` 里的那一行。仓库外的共用钩子目录、被 git 跟踪的钩子文件
 * 不碰;钩子文件是链接时,链到本仓库里的文件才删其中的片段行(只写回、不删文件)。默认钩子目录以外时,
 * `.git/hooks` 里旧版本留下的片段一并删掉。
 * 返回删过片段的钩子文件路径;不在 git 仓库、没有可删的行 → null。
 */
export function removeHookSnippet(
  cwd: string,
  hook: GitHookName,
  marker: string,
  opts?: { legacyMatch?: string },
): string | null {
  const loc = locateHooks(cwd);
  if (loc === null) return null;
  const needles = snippetNeedles(marker, opts?.legacyMatch);
  unregisterSnippet(loc, hook, marker);
  const legacy = stripLegacySnippet(loc, hook, needles);
  const hookPath = path.join(loc.hooksDir, hook);
  if (loc.place === 'outside') return legacy;

  if (isSymlink(hookPath)) {
    const target = linkTargetOf(loc, hookPath);
    if (target.scope === 'outside_repo') return legacy;
    return stripSnippetLines(target.path, needles, false) === null ? legacy : hookPath;
  }
  if (loc.place === 'worktree' && isTrackedHook(loc, hookPath)) return legacy;

  const outcome = stripSnippetLines(hookPath, needles, true);
  if (outcome === null) return legacy;
  const rel = worktreeRelOf(loc, realpathLoose(hookPath));
  if (outcome === 'deleted' && rel !== null) {
    removeGitInfoLine(path.join(loc.commonDir, 'info', 'exclude'), gitPathPattern(rel));
  }
  return hookPath;
}

/**
 * ⑥ 按登记补回缺了的片段:钩子文件里已经有这个 marker 的跳过;其余照 installHookSnippet 写入
 * (同样按 ①~⑤ 判断,被跟踪了、成了链接就不写)。不在 git 仓库、没有登记 → []。
 * 返回这次尝试补装的结果。
 */
export function repairHookSnippets(cwd: string): HookSnippetResult[] {
  const loc = locateHooks(cwd);
  if (loc === null) return [];
  const results: HookSnippetResult[] = [];
  for (const entry of readRegistry(loc)) {
    const hookPath = path.join(loc.hooksDir, entry.hook);
    if (readFileOrNull(hookPath)?.includes(entry.marker) === true) continue;
    const result = installHookSnippet(cwd, entry.hook, entry.marker, entry.lines, {
      ...(entry.legacyMatch !== undefined ? { legacyMatch: entry.legacyMatch } : {}),
    });
    if (result !== null) results.push(result);
  }
  return results;
}

/**
 * 安装结果给人看的一句提示:没写入时说原因和要加的几行;其余 → null。what 是没写入时的说法,
 * 默认「没写入」(release 传「没装上提交拦截」)。
 */
export function hookNotice(
  result: Pick<HookSnippetResult, 'hookPath' | 'reason' | 'lines' | 'linkTarget'> & { status: string },
  what = '没写入',
): string | null {
  if (result.status !== 'unsupported') return null;
  const addLines = (where: string): string => `;要装的话,把下面几行加到${where}第一行之后:\n${(result.lines ?? []).join('\n')}`;
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
