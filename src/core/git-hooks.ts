/**
 * git 钩子片段写入(spec D33):timeline 的 post-commit / post-merge 片段、release 的
 * commit-msg 片段都经这里写进 git 实际会执行的钩子文件。
 *
 * - 钩子目录取 `git rev-parse --git-path hooks`:已含 core.hooksPath(如 husky 把钩子目录
 *   改到 `.husky/_`),片段写进 git 真正执行的目录,而不是固定的 `.git/hooks`
 * - 钩子文件是非 shell 脚本(node、python 等)→ 不写,返回 unsupported:插进 sh 片段会让
 *   钩子报错、每次提交都失败
 * - 片段紧跟第一行 shebang 插入(没有 shebang 就放最前):原钩子以 exec / exit 结尾时片段
 *   照样执行;每行都带调用方给的 marker,重装时先删旧行再插入
 * - 卸载按 marker 删行,不碰用户自己的内容;剩下只有 shebang 或空白时删掉文件
 *
 * 只用 `node:` 内置模块,不依赖任何子系统。
 */

import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';

export type GitHookName = 'post-commit' | 'post-merge' | 'commit-msg';

export interface HookSnippetResult {
  /** 钩子文件绝对路径(unsupported 时为没写入的那个文件) */
  hookPath: string;
  status: 'installed' | 'present' | 'updated' | 'unsupported';
  /** 钩子目录在仓库工作区内,且其中有被 git 跟踪的文件 */
  hooksDirTracked: boolean;
}

/** 算作 shell 的解释器:shebang 里解释器路径的文件名是其中之一。 */
const SHELL_INTERPRETERS: ReadonlySet<string> = new Set(['sh', 'bash', 'zsh', 'dash', 'ksh']);

/** 新建钩子文件时的第一行。 */
const DEFAULT_SHEBANG = '#!/bin/sh';

/** 写入后的钩子文件权限。 */
const HOOK_FILE_MODE = 0o755;

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

/** realpath;路径不在等失败时退回 path.resolve 的结果。 */
function realpathOrResolve(p: string): string {
  try {
    return fs.realpathSync(p);
  } catch {
    return path.resolve(p);
  }
}

/**
 * 钩子目录的绝对路径:`git rev-parse --git-path hooks`(已含 core.hooksPath),输出按 cwd
 * 解析成绝对路径。不在 git 仓库 → null。
 */
export function resolveHooksDir(cwd: string): string | null {
  const out = outputPath(runGit(cwd, ['rev-parse', '--git-path', 'hooks']));
  return out === null ? null : path.resolve(cwd, out);
}

/** 钩子目录在 `git rev-parse --show-toplevel` 之内,且 `git ls-files -- <该目录>` 有输出。 */
function isHooksDirTracked(cwd: string, hooksDir: string): boolean {
  const top = outputPath(runGit(cwd, ['rev-parse', '--show-toplevel']));
  if (top === null) return false;
  // 两边都取 realpath 再比:toplevel 是 git 给的真实路径,cwd 可能经过符号链接(如 macOS 的 /tmp)
  const realHooksDir = realpathOrResolve(hooksDir);
  const rel = path.relative(realpathOrResolve(path.resolve(cwd, top)), realHooksDir);
  if (rel === '..' || rel.startsWith(`..${path.sep}`) || path.isAbsolute(rel)) return false;
  const listed = runGit(cwd, ['ls-files', '--', realHooksDir]);
  return listed !== null && listed.trim() !== '';
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

/**
 * 把片段写进钩子文件。不在 git 仓库 → null。
 *
 * - 文件不存在 → 新建(钩子目录不在时一并创建),内容为 `#!/bin/sh` 加 lines
 * - 文件第一行是 shell 以外解释器的 shebang → 什么都不写,status `unsupported`
 * - 否则先删掉含 marker(及 legacyMatch)的行,再把 lines 插到 shebang 之后(没有就放最前)
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
  const hooksDir = resolveHooksDir(cwd);
  if (hooksDir === null) return null;
  const hookPath = path.join(hooksDir, hook);
  const hooksDirTracked = isHooksDirTracked(cwd, hooksDir);

  const original = readHookFile(hookPath);
  if (original === null) {
    fs.mkdirSync(hooksDir, { recursive: true });
    writeHookFile(hookPath, `${[DEFAULT_SHEBANG, ...lines].join('\n')}\n`);
    return { hookPath, status: 'installed', hooksDirTracked };
  }

  const originalLines = original.split('\n');
  const needles = snippetNeedles(marker, opts?.legacyMatch);
  const kept = originalLines.filter((line) => !isSnippetLine(line, needles));
  if (isNonShellShebang(kept[0])) {
    return { hookPath, status: 'unsupported', hooksDirTracked };
  }

  const insertAt = kept[0]?.startsWith('#!') === true ? 1 : 0;
  const next = [...kept.slice(0, insertAt), ...lines, ...kept.slice(insertAt)].join('\n');
  const hadMarker = marker !== '' && originalLines.some((line) => line.includes(marker));
  if (!hadMarker) {
    writeHookFile(hookPath, next);
    return { hookPath, status: 'installed', hooksDirTracked };
  }
  if (next === original) {
    return { hookPath, status: 'present', hooksDirTracked };
  }
  writeHookFile(hookPath, next);
  return { hookPath, status: 'updated', hooksDirTracked };
}

/**
 * 从钩子文件删掉含 marker(及 legacyMatch)的行;剩下的只有 shebang 或空白 → 删掉文件。
 * 返回删过片段的钩子文件路径;不在 git 仓库、文件不在、没有可删的行 → null。
 */
export function removeHookSnippet(
  cwd: string,
  hook: GitHookName,
  marker: string,
  opts?: { legacyMatch?: string },
): string | null {
  const hooksDir = resolveHooksDir(cwd);
  if (hooksDir === null) return null;
  const hookPath = path.join(hooksDir, hook);
  const original = readHookFile(hookPath);
  if (original === null) return null;

  const originalLines = original.split('\n');
  const needles = snippetNeedles(marker, opts?.legacyMatch);
  const kept = originalLines.filter((line) => !isSnippetLine(line, needles));
  if (kept.length === originalLines.length) return null;

  const body = kept[0]?.startsWith('#!') === true ? kept.slice(1) : kept;
  if (body.every((line) => line.trim() === '')) {
    // rmSync 不跟随符号链接:钩子文件是链接时只删链接本身
    fs.rmSync(hookPath, { force: true });
  } else {
    // 已有文件写回时保留原权限
    fs.writeFileSync(hookPath, kept.join('\n'));
  }
  return hookPath;
}
