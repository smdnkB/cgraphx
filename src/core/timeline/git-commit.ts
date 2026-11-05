/**
 * git post-commit / post-merge 钩子调起的 `timeline-git-commit-hook`:读提交信息,按仓库认项目,记 git_commit。
 *
 * 不读 stdin,从 `git` CLI 取提交信息(spec D32)。由钩子目录里 post-commit、post-merge 片段后台调起(`&`),
 * 耗时可以比 Claude Code hook 宽松。
 * - 合并提交(父提交 ≥ 2):文件列表为空、增删行记 0,相对第一父提交的统计记进 `metadata.merge`
 * - post-merge 调起(COMMIT_HOOK_ENV 为 post-merge)而这次合并是快进(isFastForward):不产生新提交,不记
 * - 同一 commit_hash 在一个项目里已记过的不再记(去重在 recordEvent 里)
 *
 * 记到哪(spec D9、K18):在哪个仓库提交就记到那个仓库的项目,不看是哪个会话里提交的。按工作区根列出仓库里的
 * 项目(基础层 repo-projects.ts:工作区根按 D2 认的根 + 本地 git 配置里记了名字的子目录项目),只跑一次配置
 * 读取。没有子目录项目时整个提交记给那一个项目;有的话按改到的文件分,每个文件归包含它的最深那个项目,一个项目
 * 一条 git_commit,文件和增删行只算归它的,一个文件都没分到的项目不记。子目录项目的根还在旧库模式(没并过)时
 * 照现在不记:它名下的文件照样按最深的根分给它,只是这一条不记,不改归工作区根。事件的 cwd 一律记工作区根。
 * 其余记不记、记旧库还是项目库由 recordEvent 按已知根定(spec D7;工作区根那一项在旧库模式下照旧记进本地库)。
 *
 * 会话 id 与来源 agent 经 agents 门面从会话环境变量解析:agent 在会话内通过 Bash 提交时子进程继承该变量;
 * 终端手动提交时没有,两者均记为 null(未归属)。
 */

import { execSync } from 'node:child_process';

import { resolveSessionIdFromEnv } from '../agents';
import { locateDataAtRoot } from '../data-location';
import { listRepoProjects, type RepoProject } from '../repo-projects';
import { COMMIT_BRANCH_ENV, COMMIT_HOOK_ENV, COMMIT_REFLOG_ENV, COMMIT_SHA_ENV } from './constants';
import { isKillSwitchOn } from './hook-runner';
import { recordEvent } from './recorder';

/** numstat 汇总:files 含二进制文件,增删行数不计二进制文件。 */
export interface GitDiffStats {
  files: number;
  insertions: number;
  deletions: number;
}

// 导出以便单测直接驱动(否则只能经 gitCommitHook 的副作用路径触达)。
export interface GitCommitInfo {
  hash: string;
  message: string;
  /** 改动的文件;合并提交为空数组(统计见 merge)。 */
  files: string[];
  cwd: string;
  /** 增删行数;合并提交为 0(统计见 merge)。 */
  insertions: number;
  deletions: number;
  /** 当前分支名;detached HEAD(输出为 `HEAD`)或命令失败时为 null。 */
  branch: string | null;
  /** 父提交 hash,第一父提交在前;根提交为空数组。 */
  parents: string[];
  /** 合并提交(父提交 ≥ 2)相对第一父提交的改动统计;其余为 null。 */
  merge: GitDiffStats | null;
}

/** numstat 里的一个文件;二进制文件(两列是 `-`)行数记 0。 */
interface FileStat {
  path: string;
  insertions: number;
  deletions: number;
}

/** 一个项目分到的那份提交。 */
interface CommitShare {
  root: string;
  /** 非合并提交:归它的文件;合并提交:空数组(统计见 merge) */
  files: string[];
  insertions: number;
  deletions: number;
  /** 合并提交:归它的那份相对第一父提交的统计;其余为 null */
  merge: GitDiffStats | null;
}

export async function gitCommitHook(): Promise<void> {
  if (isKillSwitchOn()) return;

  // 钩子在提交当下固定的 hash / 分支(旧版钩子脚本不传 → 退回读 HEAD 与当前分支)
  const info = readGitCommitInfo({
    hash: process.env[COMMIT_SHA_ENV],
    branch: process.env[COMMIT_BRANCH_ENV],
  });
  if (!info) return;
  // post-merge 遇到快进:不产生新提交,快进到的提交在别处做的,不算本机的提交(spec D32)
  if (process.env[COMMIT_HOOK_ENV] === 'post-merge' && isFastForward(info)) return;

  // 归属会话与来源 agent 取自会话环境变量;终端手动提交时两者均为 null。
  const fromEnv = resolveSessionIdFromEnv();
  const session_id = fromEnv?.sessionId ?? null;
  const agent = fromEnv?.agent ?? null;

  // 一个项目一条,各记各的:一个项目的库出错不耽误别的项目
  for (const share of sharesOf(info)) {
    try {
      await recordEvent(share.root, {
        event_type: 'git_commit',
        session_id,
        agent,
        commit_hash: info.hash,
        commit_message: info.message,
        commit_files: share.files,
        commit_insertions: share.insertions,
        commit_deletions: share.deletions,
        cwd: info.cwd,
        metadata: commitMetadata(info, share.merge),
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      process.stderr.write(`[timeline] git-commit record failed: ${msg}\n`);
    }
  }
}

/**
 * 按工作区根列出仓库里的项目(只跑一次配置读取,各根的标识填进进程内记忆,记事件时不再跑 git,spec D5、D9),
 * 再把提交分给它们。git 出错时不猜标识、没有项目 → 不记(空数组);其余异常写 stderr 后同样不记。
 */
function sharesOf(info: GitCommitInfo): CommitShare[] {
  try {
    const projects = listRepoProjects(info.cwd);
    if (projects === 'git-error' || projects.length === 0) return [];
    return splitCommit(info, projects);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    process.stderr.write(`[timeline] git-commit record failed: ${msg}\n`);
    return [];
  }
}

/**
 * spec D9:把一次提交分给仓库里的项目。只有一个项目而且不是子目录项目 → 整个提交照原样给它。否则按改到的文件分:
 * 每个文件归包含它的最深那个项目(子目录项目按 `<子目录>/` 前缀;都不中的归工作区根那一项,没有这一项就不归),
 * 按 projects 的顺序给每个分到文件的项目一份。
 *
 * 子目录项目的根还在旧库模式(没并过)时,它那一份不给(照现在不记)。归属先按全部项目分好、再排除,所以它名下
 * 的文件不会改归工作区根或更浅的子目录项目,整份丢掉。
 */
function splitCommit(info: GitCommitInfo, projects: readonly RepoProject[]): CommitShare[] {
  const only = projects.length === 1 ? projects[0] : undefined;
  if (only !== undefined && only.subdir === null) {
    return [{
      root: only.root,
      files: info.files,
      insertions: info.insertions,
      deletions: info.deletions,
      merge: info.merge,
    }];
  }

  const owned = new Map<RepoProject, FileStat[]>();
  for (const file of readFileStats(info)) {
    const owner = ownerOf(file.path, projects);
    if (owner === undefined) continue;
    const list = owned.get(owner);
    if (list === undefined) owned.set(owner, [file]);
    else list.push(file);
  }

  const shares: CommitShare[] = [];
  for (const project of projects) {
    const files = owned.get(project);
    if (files === undefined) continue;
    // 没并过的子目录项目照现在不记;工作区根那一项不在这里排除,旧库模式照旧由 recordEvent 记进本地库
    if (project.subdir !== null && isLegacyRoot(project.root)) continue;
    const stats = sumStats(files);
    shares.push(info.merge !== null
      ? { root: project.root, files: [], insertions: 0, deletions: 0, merge: stats }
      : { root: project.root, files: files.map((f) => f.path), insertions: stats.insertions, deletions: stats.deletions, merge: null });
  }
  return shares;
}

/**
 * 根的数据位置是旧库模式(装过、没有并过记号、本地库里有 timeline、task、sync 的表,spec D7)。只读:不写记号、
 * 不建目录;标识已由 listRepoProjects 填进进程内记忆,不再跑 git。
 */
function isLegacyRoot(root: string): boolean {
  return locateDataAtRoot(root).mode === 'legacy';
}

/** 文件归哪个项目:包含它的最深的子目录项目;都不中的归工作区根那一项(subdir 为 null);都没有 → undefined。 */
function ownerOf(file: string, projects: readonly RepoProject[]): RepoProject | undefined {
  let best: RepoProject | undefined;
  let bestDepth = -1;
  for (const project of projects) {
    if (project.subdir === null) continue;
    if (file.startsWith(`${project.subdir}/`) && project.subdir.length > bestDepth) {
      best = project;
      bestDepth = project.subdir.length;
    }
  }
  return best ?? projects.find((p) => p.subdir === null);
}

/**
 * 按文件的增删行(分项目用):非合并提交 `git show`,合并提交相对第一父提交 `git diff`;都加 `--no-renames`,
 * 改名记成删旧加新,两边的项目都分得到。命令失败:非合并提交退回已读出的文件列表(行数记 0),合并提交分不出,
 * 返回空。
 */
function readFileStats(info: GitCommitInfo): FileStat[] {
  const firstParent = info.merge !== null ? info.parents[0] : undefined;
  const args = firstParent !== undefined
    ? `-c core.quotePath=false diff --numstat --no-renames ${firstParent} ${info.hash}`
    : `-c core.quotePath=false show --numstat --no-renames --format= ${info.hash}`;
  try {
    return parseNumstat(runGit(args, info.cwd));
  } catch {
    if (info.merge !== null) return [];
    return info.files.map((file) => ({ path: file, insertions: 0, deletions: 0 }));
  }
}

/**
 * post-merge 时这次合并是不是快进(spec D32):HEAD 的 reflog 最新一行含 `: Fast-forward`
 * (`pull -q: Fast-forward`、带 -m 时 `merge x: Fast-forward (no commit created; …)`;git 不翻译这个词)。
 * 不能只看父提交数——快进到别人做的合并提交时,HEAD 也有两个父提交。reflog 那一行取片段当场传来的
 * COMMIT_REFLOG_ENV,旧版片段不传时现读;读不到(关掉了 core.logAllRefUpdates 等)才退回看父提交数。
 */
function isFastForward(info: GitCommitInfo): boolean {
  let subject = process.env[COMMIT_REFLOG_ENV];
  if (subject === undefined) {
    try {
      subject = runGit('reflog -1 --format=%gs HEAD', info.cwd).trim();
    } catch {
      subject = '';
    }
  }
  if (subject !== '') return subject.includes(': Fast-forward');
  return info.parents.length === 1;
}

/** git_commit 的 metadata:分支(读得到才带)+ 合并统计(合并提交才带,merge 是这一份的统计);都没有 → undefined。 */
function commitMetadata(info: GitCommitInfo, merge: GitDiffStats | null): Record<string, unknown> | undefined {
  const meta: Record<string, unknown> = {};
  if (info.branch !== null) meta.branch = info.branch;
  if (merge !== null) meta.merge = { parents: info.parents, ...merge };
  return Object.keys(meta).length > 0 ? meta : undefined;
}

/** 只接受十六进制提交 hash:它会拼进 git 命令行,其它内容一律退回 HEAD。 */
const COMMIT_HASH_PATTERN = /^[0-9a-f]{7,64}$/i;

/** 在 cwd 下跑一条 git 命令(不给 cwd 即当前目录),返回 stdout;失败照常抛出。 */
function runGit(args: string, cwd?: string): string {
  return execSync(`git ${args}`, { encoding: 'utf8', stdio: ['pipe', 'pipe', 'ignore'], cwd });
}

/**
 * 读取一个提交的信息 + 父提交 + 汇总增删行数 + 分支名。
 *
 * `pinned.hash` 合法时读该提交,否则读 HEAD;`pinned.branch` 有定义时直接采用
 * (空串 = detached HEAD → null),未定义时读当前分支。钩子在提交当下固定这两项,
 * 避免后台进程启动后 HEAD 已前移(连续提交只记到最后一个)。
 *
 * 父提交取 `git rev-list --parents -n 1`,读不出整条返回 null(分不清是不是合并提交)。
 * 合并提交上 `git diff-tree` 输出为空,文件与行数改取 `git diff --numstat <第一父提交> <hash>`,
 * 记进 merge;files 记空数组、增删行记 0。
 *
 * numstat 每个文件一行 `<ins>\t<del>\t<path>`,二进制文件两列为字面量 `-`,不计行数。
 * numstat 或分支读取失败(浅克隆、仓库损坏、git 过旧)不影响其它字段:行数记 0/0,
 * 分支记 null —— 它们是增强项,不是闸门。
 */
export function readGitCommitInfo(pinned: { hash?: string; branch?: string } = {}): GitCommitInfo | null {
  const ref = pinned.hash !== undefined && COMMIT_HASH_PATTERN.test(pinned.hash) ? pinned.hash : 'HEAD';
  try {
    const cwd = runGit('rev-parse --show-toplevel').trim();
    const hash = runGit(`rev-parse --verify ${ref}^{commit}`).trim();
    const message = runGit(`log -1 --pretty=%B ${ref}`).trim();
    // 以仓库根为 cwd 跑后面的命令,hook 从别处启动也能正确执行。
    const parents = readParents(hash, cwd);
    const branch = readBranch(pinned.branch, cwd);

    const firstParent = parents[0];
    if (parents.length >= 2 && firstParent !== undefined) {
      const merge = readNumstat(`diff --numstat ${firstParent} ${hash}`, cwd);
      return { hash, message, files: [], cwd, insertions: 0, deletions: 0, branch, parents, merge };
    }

    // quotePath=false:中文等非 ASCII 路径原样输出,不转成 "\344\270..." 带引号的形式;
    // --root:仓库的第一个提交也列出文件
    const files = runGit(`-c core.quotePath=false diff-tree --root --no-commit-id --name-only -r ${ref}`, cwd)
      .split('\n').map(s => s.trim()).filter(Boolean);
    const { insertions, deletions } = readNumstat(`show --numstat --format= ${ref}`, cwd);
    return { hash, message, files, cwd, insertions, deletions, branch, parents, merge: null };
  } catch {
    return null;
  }
}

/** `git rev-list --parents -n 1 <hash>` 输出 `<hash> <父1> <父2> …`,取父提交部分;失败照常抛出。 */
function readParents(hash: string, cwd: string): string[] {
  return runGit(`rev-list --parents -n 1 ${hash}`, cwd).trim().split(/\s+/).slice(1).filter(Boolean);
}

/** 当前分支:`pinned` 有定义时直接采用(空串 → null);否则读 HEAD 的分支名,失败或 detached → null。 */
function readBranch(pinned: string | undefined, cwd: string): string | null {
  if (pinned !== undefined) return pinned !== '' ? pinned : null;
  try {
    const out = runGit('rev-parse --abbrev-ref HEAD', cwd).trim();
    return out && out !== 'HEAD' ? out : null;
  } catch {
    // 分支读取失败 —— 记 null。
    return null;
  }
}

/** 跑一条输出 numstat 的 git 命令并汇总;命令失败 —— 记 0,不阻塞其余字段。 */
function readNumstat(args: string, cwd: string): GitDiffStats {
  try {
    return sumStats(parseNumstat(runGit(args, cwd)));
  } catch {
    return { files: 0, insertions: 0, deletions: 0 };
  }
}

/** 解析 numstat 输出:每行 `<ins>\t<del>\t<path>` 一个文件;路径原样保留(不去首尾空白)。 */
function parseNumstat(out: string): FileStat[] {
  const files: FileStat[] = [];
  for (const raw of out.split('\n')) {
    const line = raw.endsWith('\r') ? raw.slice(0, -1) : raw;
    const parts = line.split('\t');
    if (parts.length < 3) continue;
    const filePath = parts.slice(2).join('\t');
    if (filePath === '') continue;
    files.push({ path: filePath, insertions: lineCount(parts[0]), deletions: lineCount(parts[1]) });
  }
  return files;
}

/** numstat 的行数列:二进制文件是字面量 `-`,计入文件数、不计行数;读不出数的也记 0。 */
function lineCount(column: string | undefined): number {
  if (column === undefined || column === '-') return 0;
  const n = parseInt(column, 10);
  return Number.isNaN(n) ? 0 : n;
}

/** 汇总一组文件:files 含二进制文件。 */
function sumStats(files: readonly FileStat[]): GitDiffStats {
  const stats: GitDiffStats = { files: files.length, insertions: 0, deletions: 0 };
  for (const file of files) {
    stats.insertions += file.insertions;
    stats.deletions += file.deletions;
  }
  return stats;
}
