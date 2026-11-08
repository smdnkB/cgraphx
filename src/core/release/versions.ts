/**
 * 版本历史的只读读取(spec D16–D18),给看板认版本用。
 *
 * 只跑只读 git 命令(rev-parse / rev-list / for-each-ref,spec 全局约束):各版本分支自己那一段的
 * 第一父链与全部提交、这一段合入说明里的需求标题、打过 tag 的版本,以及本地需求分支的末端。不 fetch、
 * 不写 ref、不改工作区;任何 git 失败都返回空结果,不抛错、不打印。
 *
 * 版本相关的 git 命令只在本文件里(C-6);合入说明、tag 的匹配规则与输出上限在 constants.ts。
 */

import { execFileSync } from 'node:child_process';

import {
  MERGE_SUBJECT_PATTERN,
  VERSION_BRANCH_PATTERN,
  VERSION_HISTORY_MAX_BUFFER,
  VERSION_TAG_PATTERN,
} from './constants';
import type { VersionHistory, VersionSegment } from './types';

/** 在 dir 下跑 git,返回 stdout;出错(不在仓库、键不存在等)一律 → null。 */
function runGit(cwd: string, args: readonly string[]): string | null {
  try {
    return execFileSync('git', args, {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      // 全部提交列表可能上万行,默认 1MB 不够(C-6)
      maxBuffer: VERSION_HISTORY_MAX_BUFFER,
    });
  } catch {
    return null;
  }
}

/** 把一个逐行输出的 git 结果拆成非空行(顺序不变);输出为 null(命令失败)→ 空数组。 */
function outputLines(output: string | null): string[] {
  if (output === null) return [];
  const lines: string[] = [];
  for (const line of output.split('\n')) {
    const trimmed = line.trim();
    if (trimmed !== '') lines.push(trimmed);
  }
  return lines;
}

/** 主干:`refs/heads/main` 在就用 main,否则 master;都没有 → null。 */
function mainRef(dir: string): string | null {
  for (const name of ['refs/heads/main', 'refs/heads/master']) {
    if (runGit(dir, ['rev-parse', '--verify', '--quiet', name]) !== null) return name;
  }
  return null;
}

/** `rev-list --format=%H %P%x09%s` 的一行:提交 hash、全部父提交、说明第一行。 */
interface FormattedCommit {
  hash: string;
  parents: string[];
  subject: string;
}

/**
 * 解析 `rev-list --format=%H %P%x09%s` 的输出:每条提交先有一行 `commit <hash>`,跳过它;
 * 其余行是 `<hash> <父提交…>\t<说明>`(父提交可能为空)。
 */
function parseFormattedCommits(output: string | null): FormattedCommit[] {
  const commits: FormattedCommit[] = [];
  if (output === null) return commits;
  for (const line of output.split('\n')) {
    if (line === '' || line.startsWith('commit ')) continue;
    const tab = line.indexOf('\t');
    if (tab < 0) continue;
    const left = line.slice(0, tab).split(' ').filter((part) => part !== '');
    const hash = left[0];
    if (hash === undefined) continue;
    commits.push({ hash, parents: left.slice(1), subject: line.slice(tab + 1) });
  }
  return commits;
}

/**
 * 读一个版本分支自己那一段(D16、D17):从末端沿第一父往回走,遇到第一个主干第一父链上的提交 B 停下
 * (B 不算进这一段);走过的是 firstParent,`rev-list <分支> ^B` 是这一段的全部提交(D18 用),
 * 段内第一父链上「合入需求：」的合并说明取出标题、去重保留首次出现顺序。
 *
 * 和主干没有共同历史(一路没遇到主干上的提交)→ null,这个分支不出 segment。
 */
function readSegment(
  dir: string,
  branch: string,
  mainFirstParent: ReadonlySet<string>,
): VersionSegment | null {
  let base: string | null = null;
  for (const hash of outputLines(runGit(dir, ['rev-list', '--first-parent', branch]))) {
    if (mainFirstParent.has(hash)) {
      base = hash;
      break;
    }
  }
  if (base === null) return null;

  const formatted = parseFormattedCommits(
    runGit(dir, ['rev-list', '--first-parent', '--format=%H %P%x09%s', branch, `^${base}`]),
  );
  const firstParent = new Set(formatted.map((commit) => commit.hash));
  const commits = new Set(outputLines(runGit(dir, ['rev-list', branch, `^${base}`])));

  const mergedTitles: string[] = [];
  const seenTitles = new Set<string>();
  for (const commit of formatted) {
    if (commit.parents.length < 2) continue; // 合并提交才有合入说明
    const title = MERGE_SUBJECT_PATTERN.exec(commit.subject)?.[1];
    if (title === undefined || title === '' || seenTitles.has(title)) continue;
    seenTitles.add(title);
    mergedTitles.push(title);
  }

  return {
    version: branch.slice('dev/'.length),
    branch,
    firstParent,
    commits,
    mergedTitles,
  };
}

/**
 * 读一个仓库的版本历史(D16、D17):主干(没有就用 master)第一父链上的提交作为截段的边界;本地每个过
 * VERSION_BRANCH_PATTERN 的 `refs/heads/dev/*` 各读一段;tag 里过 VERSION_TAG_PATTERN 的算已发版本。
 *
 * 不是 git 仓库、没有 main 也没有 master、任一 git 命令失败 → 空历史(C-1),不抛错。
 */
export function readVersionHistory(dir: string): VersionHistory {
  const main = mainRef(dir);
  if (main === null) return { segments: [], releasedVersions: [] };

  const mainFirstParent = new Set(
    outputLines(runGit(dir, ['rev-list', '--first-parent', main])),
  );
  if (mainFirstParent.size === 0) return { segments: [], releasedVersions: [] };

  const segments: VersionSegment[] = [];
  for (const branch of outputLines(
    runGit(dir, ['for-each-ref', '--format=%(refname:short)', 'refs/heads/dev/']),
  )) {
    if (!VERSION_BRANCH_PATTERN.test(branch)) continue;
    const segment = readSegment(dir, branch, mainFirstParent);
    if (segment !== null) segments.push(segment);
  }

  const releasedVersions = outputLines(
    runGit(dir, ['for-each-ref', '--format=%(refname:short)', 'refs/tags/']),
  )
    .filter((tag) => VERSION_TAG_PATTERN.test(tag))
    .map((tag) => tag.slice(1));

  return { segments, releasedVersions };
}

/**
 * 取本地需求分支的末端提交(D18):一条 for-each-ref 取全部本地分支,按传入的分支名过滤;
 * 本地没有的分支不放进结果。git 失败 → 空 Map,不抛错。
 */
export function resolveBranchTips(
  dir: string,
  branches: readonly string[],
): Map<string, string> {
  const tips = new Map<string, string>();
  if (branches.length === 0) return tips;
  const wanted = new Set(branches);
  for (const line of outputLines(
    runGit(dir, ['for-each-ref', '--format=%(refname:short) %(objectname)', 'refs/heads/']),
  )) {
    const space = line.indexOf(' ');
    if (space <= 0) continue;
    const name = line.slice(0, space);
    const hash = line.slice(space + 1).trim();
    if (wanted.has(name) && hash !== '') tips.set(name, hash);
  }
  return tips;
}
