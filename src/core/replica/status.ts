/**
 * 副本状态:在不在(state)、已合入(K3)、没提交的改动(K9)——spec「细节方案:F7」的 K3、K9 取法。
 *
 * 本文件也放 replica 内部共用的外部命令封装(runCommand / runGit,create、remove 用):不经 shell,
 * 参数原样传给命令;退出码、stdout、stderr 都交给调用方判断,命令本身失败不抛。
 */

import { spawnSync } from 'node:child_process';

import { resolveMainRoot, isDirectory, listReplicas } from './roots';
import type { ReplicaEntry, ReplicaStatus } from './types';

/** 一条外部命令的结果。status 为 null:没跑起来(命令不存在等,原因在 error)或被信号终止。 */
export interface CommandResult {
  status: number | null;
  stdout: string;
  stderr: string;
  error?: Error;
}

/** 输出上限:大仓库里没被跟踪的文件列表、cp 的告警都可能很长,超了子进程会被杀掉。 */
const MAX_BUFFER = 64 * 1024 * 1024;

/** 跑一条外部命令(不经 shell)。 */
export function runCommand(cmd: string, args: readonly string[], cwd: string): CommandResult {
  const r = spawnSync(cmd, args, {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    maxBuffer: MAX_BUFFER,
  });
  const result: CommandResult = { status: r.status, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
  if (r.error !== undefined) result.error = r.error;
  return result;
}

export function runGit(cwd: string, args: readonly string[]): CommandResult {
  return runCommand('git', args, cwd);
}

/** git 输出的单行值(去掉末尾换行);命令失败或没有输出 → null。 */
export function gitValue(cwd: string, args: readonly string[]): string | null {
  const r = runGit(cwd, args);
  if (r.status !== 0) return null;
  const value = r.stdout.replace(/\r?\n$/, '');
  return value === '' ? null : value;
}

/** stderr 的第一行非空内容,拼进错误消息用。 */
export function firstLine(text: string): string {
  return text.split('\n').map((l) => l.trim()).find((l) => l !== '') ?? '没有输出';
}

/**
 * 改了没提交的已跟踪文件:`git status --porcelain -z --untracked-files=no`(-z 拿原样路径,
 * 中文文件名不转义)。改名 / 复制的条目后面跟着原路径,跳过它。git 失败 → null。
 */
export function trackedChanges(cwd: string): string[] | null {
  const r = runGit(cwd, ['status', '--porcelain', '-z', '--untracked-files=no']);
  if (r.status !== 0) return null;
  const tokens = r.stdout.split('\0');
  const files: string[] = [];
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i] ?? '';
    if (token.length < 4) continue;
    files.push(token.slice(3));
    const x = token[0];
    const y = token[1];
    if (x === 'R' || x === 'C' || y === 'R' || y === 'C') i++;
  }
  return files;
}

/**
 * 没被跟踪、也没被忽略的文件:`git ls-files --others --exclude-standard -z`。内嵌的 git 仓库
 * 以 `目录/` 的形式出现。git 失败 → null。
 */
export function untrackedFiles(cwd: string): string[] | null {
  const r = runGit(cwd, ['ls-files', '--others', '--exclude-standard', '-z']);
  if (r.status !== 0) return null;
  return r.stdout.split('\0').filter((s) => s !== '');
}

/** K9:副本一侧 = 改了没提交的已跟踪文件 + 没被跟踪的文件;git 失败 → null。 */
export function uncommittedFiles(replicaRoot: string): string[] | null {
  const tracked = trackedChanges(replicaRoot);
  if (tracked === null) return null;
  const untracked = untrackedFiles(replicaRoot);
  if (untracked === null) return null;
  return [...tracked, ...untracked];
}

/** 副本里需求分支的最新提交;分支不存在 → '';ls-remote 失败 → null。 */
function replicaBranchTip(mainRoot: string, entry: ReplicaEntry): string | null {
  const ref = `refs/heads/${entry.branch}`;
  const r = runGit(mainRoot, ['ls-remote', entry.path, ref]);
  if (r.status !== 0) return null;
  // ls-remote 的模式按尾部匹配,只认引用名完全相同的那一行
  for (const line of r.stdout.split('\n')) {
    const [sha, name] = line.split('\t');
    if (name === ref && sha !== undefined && sha !== '') return sha;
  }
  return '';
}

/**
 * K3(只对目录在的副本):副本里需求分支的最新提交,是否已在主目录当前分支里。比较对象用 HEAD
 * ——在分支上时就是当前分支。主目录里还没有这个提交就先 fetch 对象(不写引用、不写
 * FETCH_HEAD,也不连带去取子模块)。副本里分支不存在、git 判不了 → 都为 null。
 */
function mergeState(mainRoot: string, entry: ReplicaEntry): { merged: boolean | null; ahead: number | null } {
  const undecided = { merged: null, ahead: null };
  const tip = replicaBranchTip(mainRoot, entry);
  if (tip === null || tip === '') return undecided;

  if (runGit(mainRoot, ['cat-file', '-e', `${tip}^{commit}`]).status !== 0) {
    const fetched = runGit(mainRoot, [
      'fetch',
      '--no-tags',
      '--no-write-fetch-head',
      '--no-recurse-submodules',
      entry.path,
      `refs/heads/${entry.branch}`,
    ]);
    if (fetched.status !== 0) return undecided;
  }

  // --is-ancestor:0 是祖先、1 不是,其余为出错
  const ancestor = runGit(mainRoot, ['merge-base', '--is-ancestor', tip, 'HEAD']);
  if (ancestor.status === 0) return { merged: true, ahead: 0 };
  if (ancestor.status !== 1) return undecided;

  const count = runGit(mainRoot, ['rev-list', '--count', `HEAD..${tip}`]);
  const ahead = Number.parseInt(count.stdout.trim(), 10);
  return count.status === 0 && Number.isInteger(ahead) ? { merged: false, ahead } : undecided;
}

function statusOf(mainRoot: string, entry: ReplicaEntry): ReplicaStatus {
  if (entry.removedAt !== null) {
    return { ...entry, state: 'removed', merged: null, ahead: null, dirty: [] };
  }
  if (!isDirectory(entry.path)) {
    return { ...entry, state: 'missing', merged: null, ahead: null, dirty: [] };
  }
  const { merged, ahead } = mergeState(mainRoot, entry);
  return { ...entry, state: 'present', merged, ahead, dirty: uncommittedFiles(entry.path) ?? [] };
}

/** 副本列表与状态;默认不含已删除的。在副本里也能跑:登记、合入都按主目录算。 */
export function listReplicaStatus(
  projectRoot: string,
  opts: { includeRemoved?: boolean } = {},
): ReplicaStatus[] {
  const mainRoot = resolveMainRoot(projectRoot);
  return listReplicas(mainRoot, opts).map((entry) => statusOf(mainRoot, entry));
}
