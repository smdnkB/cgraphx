/**
 * git-hooks 的文件级辅助(spec D33):路径与链接、片段行的识别与删除、shebang 判断、
 * `.git/info/` 下文件的增删行。只给 `git-hooks.ts` 用,外部经它的门面取 `gitPathPattern`、
 * `appendGitInfoLines`。只用 `node:` 内置模块。
 */

import * as fs from 'node:fs';
import * as path from 'node:path';

/** 算作 shell 的解释器:shebang 里解释器路径的文件名是其中之一。 */
const SHELL_INTERPRETERS: ReadonlySet<string> = new Set(['sh', 'bash', 'zsh', 'dash', 'ksh']);

/** realpath;路径还不存在时,取最近一级已存在的上级做 realpath,再拼回剩下的部分。 */
export function realpathLoose(p: string): string {
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
export function isWithin(parent: string, child: string): boolean {
  const rel = path.relative(parent, child);
  return rel === '' || (rel !== '..' && !rel.startsWith(`..${path.sep}`) && !path.isAbsolute(rel));
}

/** 读文件;不存在 → null,其余读失败照常抛出。 */
export function readFileOrNull(file: string): string | null {
  try {
    return fs.readFileSync(file, 'utf8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw err;
  }
}

export function isSymlink(file: string): boolean {
  return fs.lstatSync(file, { throwIfNoEntry: false })?.isSymbolicLink() === true;
}

/** 链接最终指向的文件;链接悬空时 realpath 会失败,顺着链接里写的路径逐级解析。 */
export function linkTargetPath(link: string): string {
  try {
    return fs.realpathSync(link);
  } catch {
    let cur = link;
    for (let i = 0; i < 40 && isSymlink(cur); i += 1) cur = path.resolve(path.dirname(cur), fs.readlinkSync(cur));
    return realpathLoose(cur);
  }
}

/** 钩子文件的规范路径:目录取 realpath,文件名照原样(链接本身不解析);登记和比较都用它。 */
export function canonicalHookPath(file: string): string {
  return path.join(realpathLoose(path.dirname(file)), path.basename(file));
}

/** 文件不可执行时补上执行位(git 不执行没有执行位的钩子)。 */
export function makeExecutable(file: string): void {
  try {
    const mode = fs.statSync(file).mode;
    if ((mode & 0o100) === 0) fs.chmodSync(file, (mode & 0o7777) | 0o111);
  } catch {
    // 不支持 chmod 的文件系统:保持原权限
  }
}

/** 识别片段行的串:marker,以及给了的 legacyMatch;空串不算,免得删光整个文件。 */
export function snippetNeedles(marker: string, legacyMatch: string | undefined): string[] {
  return [marker, legacyMatch].filter((s): s is string => typeof s === 'string' && s !== '');
}

export function isSnippetLine(line: string, needles: readonly string[]): boolean {
  return needles.some((needle) => line.includes(needle));
}

export function hasSnippetLine(content: string, needles: readonly string[]): boolean {
  return content.split('\n').some((line) => isSnippetLine(line, needles));
}

/**
 * 第一行是不是 shell 以外解释器的 shebang。没有 shebang → false(git 会交给 sh 执行)。
 * 取 `#!` 之后解释器路径的文件名;是 env 时取它后面第一个不以 `-` 开头的参数。
 */
export function isNonShellShebang(firstLine: string | undefined): boolean {
  if (firstLine === undefined || !firstLine.startsWith('#!')) return false;
  const words = firstLine.slice(2).trim().split(/\s+/);
  let interpreter = path.basename(words[0] ?? '');
  if (interpreter === 'env') {
    interpreter = path.basename(words.slice(1).find((w) => !w.startsWith('-')) ?? '');
  }
  return !SHELL_INTERPRETERS.has(interpreter);
}

/** 没有 shebang 而内容含 NUL 字节:二进制钩子,不能当 sh 脚本改。 */
export function isBinaryHook(content: string): boolean {
  return !content.startsWith('#!') && content.includes('\u0000');
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
export function stripSnippetLines(
  file: string,
  needles: readonly string[],
  deleteIfEmpty: boolean,
): 'deleted' | 'rewritten' | null {
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
export function removeGitInfoLine(file: string, line: string): void {
  const existing = readFileOrNull(file);
  if (existing === null) return;
  const next = existing
    .split('\n')
    .filter((l) => l.trim() !== line)
    .join('\n');
  if (next !== existing) fs.writeFileSync(file, next, 'utf8');
}
