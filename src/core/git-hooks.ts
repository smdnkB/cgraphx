/**
 * git 钩子片段写入(spec D33):timeline 的 post-commit / post-merge 片段、release 的
 * commit-msg 片段都经这里写进 git 实际会执行的钩子文件。
 *
 * - 钩子目录取 `git rev-parse --git-path hooks`:已含 core.hooksPath(如 husky 把钩子目录
 *   改到 `.husky/_`),片段写进 git 真正执行的目录,而不是固定的 `.git/hooks`
 * - 片段紧跟第一行 shebang 插入(没有 shebang 就放最前):原钩子以 exec / exit 结尾时片段
 *   照样执行;每行都带调用方给的 marker(都以 SNIPPET_MARKER_PREFIX 开头),重装时先删旧行再插入
 * - 只动本机的东西,按钩子的情况分别处理:
 *   ① 钩子目录既不在工作区、也不在 git 目录里(core.hooksPath 指向仓库外的共用目录)→ 不写,卸载也不碰
 *   ② 钩子文件不是 shell 脚本(node、python 等;没有 shebang 而含 NUL 字节的按二进制算)→ 不写:
 *      插进 sh 片段会让钩子报错、每次提交都失败
 *   ③ 钩子文件是符号链接 → 不写:写入会顺着链接改到别处
 *   ④ 钩子文件被 git 跟踪 → 照写,并在本机配一条过滤规则:git 读这个文件时去掉片段行、写出时插回,
 *      改动不进 git status、不进提交,拉取和切分支照常
 *   ⑤ 在工作区里新建的钩子文件写进 `.git/info/exclude`
 * - 钩子目录不是默认的 `.git/hooks` 时,顺手删掉 `.git/hooks` 里旧版本留下的片段:git 不执行那里,
 *   撤掉 core.hooksPath 后才会复活
 * - 卸载按 marker 删行,不碰用户自己的内容;剩下只有 shebang 或空白时删掉文件(被跟踪的只写回、不删)
 *
 * 只用 `node:` 内置模块,不依赖任何子系统。
 */

import { execFileSync, spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';

export type GitHookName = 'post-commit' | 'post-merge' | 'commit-msg';

/** 没写入的原因:不是 shell 脚本 / 钩子目录在仓库外 / 钩子文件是链接。 */
export type HookSkipReason = 'not_shell' | 'outside_repo' | 'symlink';

export interface HookSnippetResult {
  /** 钩子文件绝对路径(unsupported 时为没写入的那个文件) */
  hookPath: string;
  status: 'installed' | 'present' | 'updated' | 'unsupported';
  /** 钩子文件被 git 跟踪:片段靠本机过滤规则藏起来,不进 git status、不进提交 */
  localFilter: boolean;
  /** unsupported 时:没写入的原因 */
  reason?: HookSkipReason;
  /** unsupported 时:要用户自己加的几行 */
  lines?: readonly string[];
}

/** 片段 marker 的共同前缀:本机过滤规则按它认出片段行。 */
export const SNIPPET_MARKER_PREFIX = '# cgraphx-';

/** 算作 shell 的解释器:shebang 里解释器路径的文件名是其中之一。 */
const SHELL_INTERPRETERS: ReadonlySet<string> = new Set(['sh', 'bash', 'zsh', 'dash', 'ksh']);

/** 新建钩子文件时的第一行。 */
const DEFAULT_SHEBANG = '#!/bin/sh';

/** 写入后的钩子文件、过滤脚本的权限。 */
const HOOK_FILE_MODE = 0o755;

/** 本机过滤规则的驱动名:`info/attributes` 里写 `filter=<名>`,本地 git 配置里配 `filter.<名>.*`。 */
const FILTER_DRIVER = 'cgraphx-hook';

/** 过滤脚本和各钩子的片段行放在 git 公共目录下的这个目录里(副本、worktree 各用各的 `.git`)。 */
const FILTER_DIR = 'cgraphx';
const FILTER_SCRIPT = 'hook-filter.sh';
const FILTER_LINES_DIR = 'hook-lines';

/**
 * 本机过滤脚本:`sh <脚本> clean|smudge <文件路径>`。clean 去掉带片段标记的行;smudge 把
 * `hook-lines/<钩子名>` 里的几行插回第一行 shebang 之后(shebang 不是 shell 时原样输出,没有
 * shebang 时插在最前)。只用 sh、sed、awk,不调 cgraphx、node。
 */
const FILTER_SCRIPT_BODY = [
  '#!/bin/sh',
  '# cgraphx:被 git 跟踪的钩子文件里,cgraphx 插的几行只留在本机(clean 去掉,smudge 插回)',
  'mode=$1',
  'lines="$(dirname "$0")/hook-lines/$(basename "$2")"',
  `if [ "$mode" = clean ]; then exec sed -e '/${SNIPPET_MARKER_PREFIX}/d'; fi`,
  'if [ ! -f "$lines" ]; then exec cat; fi',
  'exec awk -v f="$lines" \'',
  'NR == 1 && /^#!/ {',
  '  s = substr($0, 3); sub(/^[ \\t]+/, "", s); n = split(s, w, /[ \\t]+/)',
  '  b = w[1]; sub(/.*\\//, "", b)',
  '  if (b == "env") { b = ""; for (i = 2; i <= n; i++) if (w[i] !~ /^-/) { b = w[i]; break }; sub(/.*\\//, "", b) }',
  '  print',
  '  if (b ~ /^(sh|bash|zsh|dash|ksh)$/) while ((getline l < f) > 0) print l',
  '  next',
  '}',
  'NR == 1 { while ((getline l < f) > 0) print l }',
  '{ print }\'',
  '',
].join('\n');

/** 在 cwd 下跑 git,返回 stdout;出错(不在仓库、没装 git 等)一律 → null。 */
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
  /** 工作区根(realpath);bare 仓库等取不到 → null */
  top: string | null;
  /** git 公共目录(realpath):`info/exclude`、`info/attributes`、本机过滤脚本都在这里 */
  commonDir: string;
  /** 钩子目录在 git 目录里 / 工作区里 / 仓库外(①) */
  place: 'git_dir' | 'worktree' | 'outside';
}

function locateHooks(cwd: string): HookLocation | null {
  const hooksDir = resolveHooksDir(cwd);
  const commonOut = outputPath(runGit(cwd, ['rev-parse', '--git-common-dir']));
  if (hooksDir === null || commonOut === null) return null;
  const commonDir = realpathLoose(path.resolve(cwd, commonOut));
  const topOut = outputPath(runGit(cwd, ['rev-parse', '--show-toplevel']));
  const top = topOut === null ? null : realpathLoose(topOut);
  const realHooksDir = realpathLoose(hooksDir);
  let place: HookLocation['place'] = 'outside';
  if (isWithin(commonDir, realHooksDir)) place = 'git_dir';
  else if (top !== null && isWithin(top, realHooksDir)) place = 'worktree';
  return { hooksDir, top, commonDir, place };
}

/** 钩子文件在工作区里时,它相对工作区根的 POSIX 路径;否则 null。 */
function worktreeRel(loc: HookLocation, file: string): string | null {
  if (loc.place !== 'worktree' || loc.top === null) return null;
  return path.relative(loc.top, realpathLoose(file)).split(path.sep).join('/');
}

function isTracked(top: string, rel: string): boolean {
  const out = runGit(top, ['--literal-pathspecs', 'ls-files', '-z', '--', rel]);
  return out !== null && out !== '';
}

/**
 * 工作区相对路径写成只匹配它自己的 gitignore 模式(`info/exclude`、`info/attributes` 同一套写法):
 * 以 `/` 开头锚定到根(开头的 `#`、`!` 也就不再特殊),通配符前加 `\`,末尾空格转义。
 */
export function gitPathPattern(relPosix: string): string {
  const escaped = relPosix
    .replace(/[\\*?[]/g, (c) => `\\${c}`)
    .replace(/ +$/, (spaces) => spaces.replace(/ /g, '\\ '));
  return `/${escaped}`;
}

/** attributes 一行按空白分隔:模式里有空白或引号时整个用 C 风格的双引号括起来。 */
function attributesLine(rel: string): string {
  const pattern = gitPathPattern(rel);
  const quoted = /[\s"]/.test(pattern) ? `"${pattern.replace(/["\\]/g, (c) => `\\${c}`)}"` : pattern;
  return `${quoted} filter=${FILTER_DRIVER}`;
}

/**
 * 往 `.git/info/` 下的 exclude、attributes 这类文件追加几行;已有同一行不重复加。文件是符号链接时
 * (整仓克隆带过来的)先删链接本身再写,免得写进它指向的文件。
 */
export function appendGitInfoLines(file: string, lines: readonly string[]): void {
  const existing = readHookFile(file) ?? '';
  const present = new Set(existing.split(/\r?\n/).map((line) => line.trim()));
  const missing = lines.filter((line) => !present.has(line));
  if (missing.length === 0) return;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const sep = existing === '' || existing.endsWith('\n') ? '' : '\n';
  if (fs.lstatSync(file, { throwIfNoEntry: false })?.isSymbolicLink() === true) fs.rmSync(file);
  fs.writeFileSync(file, `${existing}${sep}${missing.join('\n')}\n`, 'utf8');
}

/** 从 `.git/info/` 下的文件里删掉逐字相同的那一行;文件不在或没有这一行 → 不动。 */
function removeGitInfoLine(file: string, line: string): void {
  const existing = readHookFile(file);
  if (existing === null) return;
  const kept = existing.split('\n').filter((l) => l.trim() !== line);
  const next = kept.join('\n');
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

/** 读钩子文件;不存在 → null,其余读失败照常抛出。 */
function readHookFile(hookPath: string): string | null {
  try {
    return fs.readFileSync(hookPath, 'utf8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw err;
  }
}

/** 写钩子文件并设为 0755(writeFileSync 的 mode 只在新建时生效,已有文件显式 chmod)。 */
function writeHookFile(hookPath: string, content: string): void {
  fs.writeFileSync(hookPath, content, { mode: HOOK_FILE_MODE });
  try {
    fs.chmodSync(hookPath, HOOK_FILE_MODE);
  } catch {
    // 不支持 chmod 的文件系统:保持 writeFileSync 给的权限
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
 * 从不被跟踪的钩子文件里删掉片段行(如 `.git/hooks` 里的);剩下只有 shebang 或空白 → 删掉文件。
 * 删过返回 true;文件不在、是链接、没有可删的行 → false。
 */
function stripSnippetFile(file: string, needles: readonly string[]): boolean {
  if (isSymlink(file)) return false;
  const original = readHookFile(file);
  if (original === null) return false;
  const originalLines = original.split('\n');
  const kept = originalLines.filter((line) => !isSnippetLine(line, needles));
  if (kept.length === originalLines.length) return false;
  if (onlyShebangLeft(kept)) fs.rmSync(file, { force: true });
  // 已有文件写回时保留原权限
  else fs.writeFileSync(file, kept.join('\n'));
  return true;
}

/** 默认钩子目录 `<git 公共目录>/hooks` 以外时,删掉那里旧版本留下的片段;删过返回那个文件路径。 */
function stripLegacySnippet(loc: HookLocation, hook: GitHookName, needles: readonly string[]): string | null {
  const defaultHooksDir = path.join(loc.commonDir, 'hooks');
  if (realpathLoose(loc.hooksDir) === defaultHooksDir) return null;
  const legacy = path.join(defaultHooksDir, hook);
  return stripSnippetFile(legacy, needles) ? legacy : null;
}

function filterCommand(mode: 'clean' | 'smudge'): string {
  return `sh "$(git rev-parse --git-common-dir)/${FILTER_DIR}/${FILTER_SCRIPT}" ${mode} %f`;
}

/**
 * 工作区文件经过滤规则后的内容和索引里的一样时,`git add` 一下:只刷新索引里记的文件大小和时间。
 * 不刷新的话,文件大小变了,git status 会一直报它改过。内容不一样(用户自己另有改动)就不动索引。
 */
function refreshIndexEntry(top: string, rel: string): void {
  const worktree = outputPath(runGit(top, ['hash-object', `--path=${rel}`, '--', rel]));
  const indexed = outputPath(runGit(top, ['rev-parse', '--verify', '-q', `:${rel}`]));
  if (worktree !== null && worktree === indexed) runGit(top, ['--literal-pathspecs', 'add', '--', rel]);
}

/** ④ 被跟踪的钩子文件:记下它的片段行,配上本机过滤规则(attributes + 本地 git 配置),再刷新索引。 */
function enableLocalFilter(top: string, loc: HookLocation, rel: string, hook: GitHookName, content: string): void {
  const dir = path.join(loc.commonDir, FILTER_DIR);
  fs.mkdirSync(path.join(dir, FILTER_LINES_DIR), { recursive: true });
  writeHookFile(path.join(dir, FILTER_SCRIPT), FILTER_SCRIPT_BODY);
  const snippetLines = content.split('\n').filter((line) => line.includes(SNIPPET_MARKER_PREFIX));
  fs.writeFileSync(path.join(dir, FILTER_LINES_DIR, hook), `${snippetLines.join('\n')}\n`, 'utf8');
  appendGitInfoLines(path.join(loc.commonDir, 'info', 'attributes'), [attributesLine(rel)]);
  runGit(top, ['config', '--local', `filter.${FILTER_DRIVER}.clean`, filterCommand('clean')]);
  runGit(top, ['config', '--local', `filter.${FILTER_DRIVER}.smudge`, filterCommand('smudge')]);
  refreshIndexEntry(top, rel);
}

/**
 * 卸载时:从片段行文件里删掉这次的行;一行不剩就撤掉这个文件的过滤规则,再没有别的钩子用就整个撤掉
 * (脚本目录和 git 配置)。最后刷新索引,让写回原样的文件在 git status 里也是干净的。
 */
function disableLocalFilter(top: string, loc: HookLocation, rel: string, hook: GitHookName, needles: readonly string[]): void {
  const dir = path.join(loc.commonDir, FILTER_DIR);
  const linesFile = path.join(dir, FILTER_LINES_DIR, hook);
  const remaining = (readHookFile(linesFile) ?? '')
    .split('\n')
    .filter((line) => line !== '' && !isSnippetLine(line, needles));
  if (remaining.length > 0) {
    fs.writeFileSync(linesFile, `${remaining.join('\n')}\n`, 'utf8');
  } else {
    fs.rmSync(linesFile, { force: true });
    removeGitInfoLine(path.join(loc.commonDir, 'info', 'attributes'), attributesLine(rel));
    const left = fs.existsSync(path.join(dir, FILTER_LINES_DIR)) ? fs.readdirSync(path.join(dir, FILTER_LINES_DIR)) : [];
    if (left.length === 0) {
      fs.rmSync(dir, { recursive: true, force: true });
      runGit(top, ['config', '--local', '--remove-section', `filter.${FILTER_DRIVER}`]);
    }
  }
  refreshIndexEntry(top, rel);
}

/**
 * 把片段写进钩子文件。不在 git 仓库 → null。
 *
 * - ① 钩子目录在仓库外、③ 钩子文件是链接、② 钩子文件不是 shell 脚本 → 什么都不写,status
 *   `unsupported`,带 reason 和要用户自己加的 lines
 * - 文件不存在 → 新建(钩子目录不在时一并创建),内容为 `#!/bin/sh` 加 lines;建在工作区里的写进
 *   `.git/info/exclude`(⑤,本来就被忽略的不写)
 * - 否则先删掉含 marker(及 legacyMatch)的行,再把 lines 插到 shebang 之后(没有就放最前);
 *   文件被 git 跟踪时配上本机过滤规则(④,localFilter 为 true)。仓库里提交的版本已经带着这个
 *   marker(团队自己提交了片段)→ 不动,status `present`
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
  const hookPath = path.join(loc.hooksDir, hook);
  const needles = snippetNeedles(marker, opts?.legacyMatch);
  stripLegacySnippet(loc, hook, needles);
  const skip = (reason: HookSkipReason): HookSnippetResult =>
    ({ hookPath, status: 'unsupported', localFilter: false, reason, lines });

  if (loc.place === 'outside') return skip('outside_repo');
  if (isSymlink(hookPath)) return skip('symlink');

  const rel = worktreeRel(loc, hookPath);
  const original = readHookFile(hookPath);
  if (original === null) {
    fs.mkdirSync(loc.hooksDir, { recursive: true });
    writeHookFile(hookPath, `${[DEFAULT_SHEBANG, ...lines].join('\n')}\n`);
    if (loc.top !== null && rel !== null && spawnSync('git', ['check-ignore', '-q', '--', rel], { cwd: loc.top }).status !== 0) {
      appendGitInfoLines(path.join(loc.commonDir, 'info', 'exclude'), [gitPathPattern(rel)]);
    }
    return { hookPath, status: 'installed', localFilter: false };
  }

  const originalLines = original.split('\n');
  const kept = originalLines.filter((line) => !isSnippetLine(line, needles));
  if (isBinaryHook(original) || isNonShellShebang(kept[0])) return skip('not_shell');

  const tracked = loc.top !== null && rel !== null && isTracked(loc.top, rel);
  if (loc.top !== null && rel !== null && tracked && runGit(loc.top, ['show', `:${rel}`])?.includes(marker) === true) {
    return { hookPath, status: 'present', localFilter: false };
  }

  const insertAt = kept[0]?.startsWith('#!') === true ? 1 : 0;
  const next = [...kept.slice(0, insertAt), ...lines, ...kept.slice(insertAt)].join('\n');
  const hadMarker = marker !== '' && originalLines.some((line) => line.includes(marker));
  let status: HookSnippetResult['status'] = 'installed';
  if (hadMarker) status = next === original ? 'present' : 'updated';
  if (status !== 'present') writeHookFile(hookPath, next);
  if (tracked && loc.top !== null && rel !== null) enableLocalFilter(loc.top, loc, rel, hook, next);
  return { hookPath, status, localFilter: tracked };
}

/**
 * 从钩子文件删掉含 marker(及 legacyMatch)的行;剩下的只有 shebang 或空白 → 删掉文件,连同它在
 * `.git/info/exclude` 里的那一行(被 git 跟踪的文件只写回、不删,并撤掉本机过滤规则)。仓库外的共用
 * 钩子目录、链接形式的钩子文件不碰。默认钩子目录以外时,`.git/hooks` 里旧版本留下的片段一并删掉。
 * 返回删过片段的钩子文件路径;不在 git 仓库、文件不在、没有可删的行 → null。
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
  const legacy = stripLegacySnippet(loc, hook, needles);
  const hookPath = path.join(loc.hooksDir, hook);
  if (loc.place === 'outside' || isSymlink(hookPath)) return legacy;

  const original = readHookFile(hookPath);
  if (original === null) return legacy;
  const originalLines = original.split('\n');
  const kept = originalLines.filter((line) => !isSnippetLine(line, needles));
  if (kept.length === originalLines.length) return legacy;

  const rel = worktreeRel(loc, hookPath);
  const tracked = loc.top !== null && rel !== null && isTracked(loc.top, rel);
  if (!tracked && onlyShebangLeft(kept)) {
    // rmSync 不跟随符号链接
    fs.rmSync(hookPath, { force: true });
    if (rel !== null) removeGitInfoLine(path.join(loc.commonDir, 'info', 'exclude'), gitPathPattern(rel));
  } else {
    // 已有文件写回时保留原权限
    fs.writeFileSync(hookPath, kept.join('\n'));
  }
  if (tracked && loc.top !== null && rel !== null) disableLocalFilter(loc.top, loc, rel, hook, needles);
  return hookPath;
}

/**
 * 安装结果给人看的一句提示:没写入时说原因,被跟踪的钩子文件靠本机过滤规则藏起改动时说一句;
 * 其余 → null。what 是没写入时的说法,默认「没写入」(release 传「没装上提交拦截」)。
 */
export function hookNotice(result: HookSnippetResult, what = '没写入'): string | null {
  if (result.status === 'unsupported') {
    if (result.reason === 'outside_repo') {
      return `core.hooksPath 指向仓库外的共用目录 ${path.dirname(result.hookPath)},${what}`;
    }
    if (result.reason === 'symlink') {
      return `钩子文件 ${result.hookPath} 是链接,${what};要装的话,把下面几行加到它指向的文件第一行之后:\n${(result.lines ?? []).join('\n')}`;
    }
    return `钩子文件 ${result.hookPath} 不是 shell 脚本,${what}`;
  }
  if (result.localFilter) return `钩子文件 ${result.hookPath} 跟着仓库提交,这几行只在本机,不会进提交`;
  return null;
}
