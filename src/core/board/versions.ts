/**
 * 认版本:任务 → 版本(纯函数,spec K15–K20、D17–D19)。
 *
 * 输入版本历史、副本登记与需求分支末端,输出每个任务的版本;不碰 git、不读文件系统——版本分支、
 * 合入说明、tag 的约定留在 release 门面(D15)。装配时每次现算,不写绑定(D14)。
 *
 * 合入认两种(满足一种就算):这一段第一父链上的合入说明标题与任务标题全等(D17);或这个任务某份
 * 副本登记的需求分支,末端提交在这一段的全部提交里、又不在这一段第一父链上(D18)。一个都没合入时,
 * 取最近一次开副本的起点分支当计划版本(K18);没有就是无版本(K20)。
 */

import { VERSION_BRANCH_PATTERN, type VersionHistory } from '../release';
import type { ReplicaRef, TaskVersion } from './types';

/** 版本号逐段按数字比,大的在前(C-5;2.0.10 在 2.0.9 前)。 */
function compareVersionDesc(a: string, b: string): number {
  const x = a.split('.').map((part) => Number.parseInt(part, 10) || 0);
  const y = b.split('.').map((part) => Number.parseInt(part, 10) || 0);
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    const diff = (x[i] ?? 0) - (y[i] ?? 0);
    if (diff !== 0) return diff > 0 ? -1 : 1;
  }
  return a < b ? -1 : a > b ? 1 : 0;
}

/** 同一需求开过几次副本,取 createdAt 最大的那份(K18)。 */
function latestReplica(replicas: readonly ReplicaRef[]): ReplicaRef | undefined {
  let latest: ReplicaRef | undefined;
  for (const replica of replicas) {
    if (latest === undefined || replica.createdAt > latest.createdAt) latest = replica;
  }
  return latest;
}

/**
 * 给每个任务算版本(D19):合入过的版本按版本号倒序去重;一个都没合入时,最近一次开副本的起点分支过
 * VERSION_BRANCH_PATTERN 就给一个计划版本(merged: false);否则空数组(无版本)。released 一律按
 * 版本历史里的 tag 判。
 */
export function assignTaskVersions(input: {
  tasks: ReadonlyArray<{ featureId: string; title: string }>;
  replicas: readonly ReplicaRef[];
  history: VersionHistory;
  branchTips: ReadonlyMap<string, string>;
}): Map<string, TaskVersion[]> {
  const released = new Set(input.history.releasedVersions);
  const versions = new Map<string, TaskVersion[]>();

  for (const task of input.tasks) {
    const replicas = input.replicas.filter((replica) => replica.featureId === task.featureId);
    const merged: string[] = [];
    const seen = new Set<string>();
    for (const segment of input.history.segments) {
      const byTitle = segment.mergedTitles.includes(task.title);
      const byBranch = replicas.some((replica) => {
        const tip = input.branchTips.get(replica.branch);
        return tip !== undefined && segment.commits.has(tip) && !segment.firstParent.has(tip);
      });
      if ((byTitle || byBranch) && !seen.has(segment.version)) {
        seen.add(segment.version);
        merged.push(segment.version);
      }
    }

    if (merged.length > 0) {
      merged.sort(compareVersionDesc);
      versions.set(
        task.featureId,
        merged.map((version) => ({ version, released: released.has(version), merged: true })),
      );
      continue;
    }

    const latest = latestReplica(replicas);
    if (latest === undefined || !VERSION_BRANCH_PATTERN.test(latest.baseBranch)) {
      versions.set(task.featureId, []);
      continue;
    }
    const version = latest.baseBranch.slice('dev/'.length);
    versions.set(task.featureId, [
      { version, released: released.has(version), merged: false },
    ]);
  }

  return versions;
}
