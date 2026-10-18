/**
 * spec 指纹与依据比对。
 *
 * 指纹与 `git hash-object <主 spec>` 一致(含工作区未提交修改);
 * git 不可用时进程内按 git blob 格式计算 sha1,结果等价。
 */

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, statSync } from 'node:fs';
import { join, sep } from 'node:path';
import { BASIS_PATTERN } from './constants';

const FULL_HASH_PATTERN = /^[0-9a-f]{40}$/;

/** 路径转绝对路径(项目相对 POSIX 路径 → 本地分隔符)。 */
function toAbsolutePath(projectRoot: string, projectRelPath: string): string {
  return join(projectRoot, ...projectRelPath.split('/'));
}

/** 进程内按 git blob 格式计算哈希(与 git hash-object 等价)。 */
function hashObjectInProcess(absPath: string): string | null {
  let content: Buffer;
  try {
    content = readFileSync(absPath);
  } catch {
    return null;
  }
  const header = Buffer.from(`blob ${content.length}\0`, 'utf-8');
  return createHash('sha1').update(header).update(content).digest('hex');
}

/**
 * 计算文件内容的 git 指纹(40 位小写十六进制)。
 *
 * 优先调用 `git hash-object`(与 git 行为严格一致);git 不存在、
 * 报错、超时或输出异常时退回进程内计算。文件不存在或不是普通文件返回 null。
 */
export function specFingerprint(
  projectRoot: string,
  projectRelPath: string,
): string | null {
  const absPath = toAbsolutePath(projectRoot, projectRelPath);
  try {
    if (!statSync(absPath).isFile()) {
      return null;
    }
  } catch {
    return null;
  }

  const localRelPath = projectRelPath.split('/').join(sep);
  try {
    const output = execFileSync('git', ['hash-object', '--', localRelPath], {
      cwd: projectRoot,
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: 5000,
    }).trim();
    if (FULL_HASH_PATTERN.test(output)) {
      return output;
    }
  } catch {
    // git 不可用:退回进程内计算。
  }
  return hashObjectInProcess(absPath);
}

/** 解析依据值(`spec@` + 7–40 位十六进制),返回小写前缀;不合法返回 null。 */
export function parseBasis(value: string): string | null {
  const match = BASIS_PATTERN.exec(value.trim());
  if (match === null || match[1] === undefined) {
    return null;
  }
  return match[1].toLowerCase();
}

/** 依据前缀是否匹配完整指纹(按前缀、不区分大小写)。 */
export function basisMatches(prefix: string, fullHash: string): boolean {
  return fullHash.toLowerCase().startsWith(prefix.toLowerCase());
}
