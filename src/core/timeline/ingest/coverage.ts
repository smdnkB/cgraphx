/**
 * 补录结果的形状、覆盖判定与缺口信号(spec F1 K4、D4「补录状态契约」;plan T-1)。
 *
 * ensureTimelineUpToDate 的结果在原有 status(六个值一个不改,调用方兼容)之外新增可选 coverage,
 * 供查询命令与补账编排判断「这次补录可不可信」:
 *   complete  本次已安装、可用来源的处理全部完成,没有已知缺口
 *   partial   处理过但有缺口——单文件读取失败、整份解析不出(K11)、认不出项目归属、已探测到的来源
 *             读不了(如 Node 没有 zstd API 的 DeepSeek)、所有来源都没有文件;已成功部分仍是有限证据
 *   blocked   这次根本没补成——锁竞争、采集关闭、旧库未合并、项目数据不可用或全局失败
 * 状态行(`[timeline] 补录状态: …`)由查询命令的 stderr 在补录完成后输出;具体原因沿用 notices
 * (describeSyncOutcome 渲染)。coverage 不进 board 的对外 JSON,board 提示仍按 status 映射(C-1)。
 *
 * 结果形状与 describeSyncOutcome 从 ingest.ts 拆到这里(ingest.ts 原路径再导出,既有引用全部可用);
 * 「处理过的文件有缺口」的三类信号(读取失败、解析不出在 facts.ts 陪读取侧,无法归属在这里)增量与
 * 重建共用,按来源显示名聚合成人读提示。
 */

import type { SessionSource } from '../../agents';

// ─── 结果形状(plan C-4;coverage 为 D4 新增的可选字段)───────────────────────

export type TimelineSyncStatus =
  | 'synced'
  | 'rebuilt'
  | 'busy'
  | 'failed'
  | 'skipped-disabled'
  | 'skipped-legacy';

export interface TimelineSyncOutcome {
  status: TimelineSyncStatus;
  /** 本次覆盖判定(D4 补录状态契约):complete / partial / blocked,取值见文件头 */
  coverage?: TimelineCoverage;
  /** 本次涉及的会话数(重建:全部会话) */
  sessions?: number;
  /** 本次新写进库的事件数 */
  events?: number;
  /** 动态的人读提示(如 K11 解析不出的文件);固定文案(status 决定的)由 describeSyncOutcome 出 */
  notices: string[];
  /** status 为 failed 时的原因 */
  reason?: string;
}

/** 人读提示(F1/F6 图的原文):固定文案按 status 出,rebuilt 的汇总在最前,动态的(notices)跟在后面。 */
export function describeSyncOutcome(outcome: TimelineSyncOutcome): string[] {
  switch (outcome.status) {
    case 'skipped-disabled':
      return [];
    case 'skipped-legacy':
      return ['这个目录还没装新版,时间线停在升级前;运行 cgraphx install 补齐'];
    case 'busy':
      return ['时间线正在补录,结果可能缺最近的', ...outcome.notices];
    case 'failed':
      return [`时间线补录失败:${outcome.reason ?? '未知原因'},结果可能缺最近的`];
    case 'rebuilt':
      return [
        `时间线已重建:${outcome.sessions ?? 0} 个会话,${outcome.events ?? 0} 条事件`,
        ...outcome.notices,
      ];
    case 'synced':
      return outcome.notices;
  }
}

// ─── 覆盖判定(D4 补录状态契约)──────────────────────────────────────────────

export type TimelineCoverage = 'complete' | 'partial' | 'blocked';

/** 覆盖的严重度(合并取更差的那档用)。 */
const COVERAGE_SEVERITY: Readonly<Record<TimelineCoverage, number>> = {
  complete: 0,
  partial: 1,
  blocked: 2,
};

/** 重建 + 增量合并覆盖时取更差的一档;一边没给(旧调用方)就取另一边,都没给 → undefined。 */
export function worseCoverage(
  a: TimelineCoverage | undefined,
  b: TimelineCoverage | undefined,
): TimelineCoverage | undefined {
  if (a === undefined) return b;
  if (b === undefined) return a;
  return COVERAGE_SEVERITY[a] >= COVERAGE_SEVERITY[b] ? a : b;
}

/** D4:所有来源都没有文件 → partial,并说明无来源(不报错;单个来源没有文件不算失败)。 */
export const NO_SESSION_FILES_NOTICE = '本机没有任何受支持 agent 的会话文件,时间线可能不全';

// ─── 缺口信号:读取失败、无法归属(增量与重建共用)──────────────────────────

export function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** 原因取错误消息的第一行、截到 80 字,提示不被长堆栈撑爆。 */
export function shortReason(err: unknown): string {
  const first = errorMessage(err).split('\n')[0] ?? '';
  return [...first].slice(0, 80).join('');
}

/** 读取器抛错的文件(增量与重建共用):按来源显示名 + 原因首行计数,单文件隔离不拖垮整趟。 */
export interface ReadFailedTally {
  display: string;
  reason: string;
  count: number;
}

export type ReadFailedMap = Map<string, ReadFailedTally>;

/** 记一个读取失败的文件(按显示名 + 原因聚合)。 */
export function noteReadFailed(map: ReadFailedMap, source: SessionSource, err: unknown): void {
  const reason = shortReason(err);
  const key = `${source.displayName}\0${reason}`;
  const cur = map.get(key);
  if (cur === undefined) map.set(key, { display: source.displayName, reason, count: 1 });
  else cur.count += 1;
}

/** 读取失败的人读提示:偏移没推进,文件修复 / 删除后下一趟自动重试。 */
export function readFailedNotices(map: ReadFailedMap): string[] {
  return [...map.values()].map(
    (f) => `${f.display} 的会话文件有 ${f.count} 个读取失败(${f.reason}),时间线可能不全;文件修复或删除后会自动重试`,
  );
}

/** 认不出项目归属的文件(K2「不强行归入」):按来源显示名计数——可能丢的是本项目的会话,K4 要说明。 */
export interface UnattributedTally {
  display: string;
  count: number;
}

export type UnattributedMap = Map<string, UnattributedTally>;

/** 记一个无法归属的文件(按显示名聚合)。 */
export function noteUnattributed(map: UnattributedMap, source: SessionSource): void {
  const cur = map.get(source.displayName);
  if (cur === undefined) map.set(source.displayName, { display: source.displayName, count: 1 });
  else cur.count += 1;
}

/** 无法归属的人读提示:归属认不出时不重试(已记空行),只提示覆盖可能不全。 */
export function unattributedNotices(map: UnattributedMap): string[] {
  return [...map.values()].map(
    (u) => `${u.display} 的会话文件有 ${u.count} 个认不出属于哪个项目,时间线可能不全`,
  );
}
