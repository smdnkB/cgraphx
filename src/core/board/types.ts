/**
 * board 子系统类型(2026-11-06-agent看板 plan C-6)。
 *
 * BoardData / BoardProject / BoardTask / BoardSession 是页面与接口的数据形状(page ↔ server 契约,
 * 字段与 C-6 一一对应);BoardProjectGroup、BoardSyncItem、TaskMatch* 是内部计算类型,不经门面导出。
 */

import type { RootMatcher } from '../root-match';
import type { BoardSessionHead, BoardTimelineData, TimelineSyncOutcome } from '../timeline';

/** 看板整体:`GET /api/board` 的出参。 */
export interface BoardData {
  projects: BoardProject[];
}

/** 左栏的一个项目:同名项目的几个目录归并成一组(K12),任务 + 未归类会话都在这里。 */
export interface BoardProject {
  /** 显示名(项目名;identity 读不出的按目录名单独成组,用目录名) */
  name: string;
  /** 在用主目录(还在的根经 replicaLinkOf 换成主目录后去重) */
  dirs: string[];
  /** 没能补录(F1 ④)、目录全不在(F1 ⑤)等原因提示;正常为 null */
  notice: string | null;
  /** 最近 30 天有活动的任务(K2) */
  tasks: BoardTask[];
  /** 超过 30 天的任务;页面点「全部」才显示(K2) */
  older: BoardTask[];
  /** 未归类会话(K3) */
  unsorted: BoardSession[];
}

/** 左栏的一行任务(F1;K1、K2、K13、K14)。 */
export interface BoardTask {
  featureId: string;
  /** K13:FeatureEntry 的标题;目录不在(只有副本登记)取 feature-id 去日期段 */
  title: string;
  /** K13:需求阶段;null 时页面显示 - */
  stage: string | null;
  fixedCount: number;
  maybeCount: number;
  /** 去重后的来源显示名,按 claude-code、codebuddy、deepseek 顺序 */
  agents: string[];
  /** K14:各会话窗口 to 的最大值(定挂优先,没有定挂取可能相关);ISO 或 null */
  lastActiveAt: string | null;
  fixed: BoardSession[];
  maybe: BoardSession[];
}

/** 右栏的一行会话(F2;K4、K5、K6、K7、F2 ①)。 */
export interface BoardSession {
  /** 来源显示名(如 Claude Code、DeepSeek) */
  agent: string;
  /** 完整会话编号(K7:复制的就是它) */
  id: string;
  /** K5:标题表 → 第一条 user_prompt 前 40 字 → '-' */
  title: string;
  startCwd: string;
  /** 开始目录的短标签:副本 <副本目录名> / 主目录 <项目名> / 目录名(C-11) */
  dirLabel: string;
  /** K6 活动窗口;ISO 或 null */
  from: string | null;
  to: string | null;
  /** 命中依据(K9/K10 的文案,页面用「、」连接);未归类为空数组 */
  reasons: string[];
  /** 会话文件还在不在(F2 ①;不在的行灰显,照样能复制) */
  fileExists: boolean;
}

// ─── 内部计算类型 ────────────────────────────────────────────────────────────

/**
 * C-9 的一个项目组:listProjects 按项目名分组(identity 读不出的按目录名单独成组)归并后的一个项目。
 * 由 enumerateBoardGroups 枚举,syncProjects 与 computeBoardData 共用。
 */
export interface BoardProjectGroup {
  /** 显示名 */
  name: string;
  /** 在用主目录(各成员 roots 里 exists 的根,经 replicaLinkOf 换主目录后去重;第一个是最近活动的) */
  dirs: string[];
  /** 各成员的项目数据目录(读 BoardTimelineData 用) */
  dataDirs: string[];
  /** timeline 记下的全部根(含目录已不在的;K8 根匹配器用) */
  roots: string[];
}

/** syncProjects 的一项:项目组与它的补录结果(C-8 启动 / 刷新共用的编排单元)。 */
export interface BoardSyncItem {
  group: BoardProjectGroup;
  /** 没补录(目录全不在)为 null */
  outcome: TimelineSyncOutcome | null;
}

/** 认任务要用的副本登记字段(ReplicaEntry 的结构子集,match.ts 的纯函数输入)。 */
export interface ReplicaRef {
  /** 副本目录名 `<主目录名>@<文件前缀>` */
  name: string;
  /** 副本目录的绝对路径 */
  path: string;
  featureId: string;
  /** 需求分支,如 feat/订单导出 */
  branch: string;
  /** 已删为非 null;K9①、K8、dirLabel 含已删都算 */
  removedAt: string | null;
}

/** match.ts 的输入(plan C-11;全部纯数据)。 */
export interface TaskMatchInput {
  /** 该项目的看板只读数据(C-5) */
  data: BoardTimelineData;
  /** 该项目的任务清单(K1 认定的 featureId → 标题) */
  tasks: ReadonlyArray<{ featureId: string; title: string }>;
  /** 副本登记(在用 + 已删) */
  replicas: readonly ReplicaRef[];
  /** K8 根匹配器(根 = timeline_roots 全部根 ∪ 全部副本 path) */
  rootsMatcher: RootMatcher;
  /** 该项目的在用主目录(dirLabel 用) */
  mainDirs: readonly string[];
}

/** 一个会话挂到一个任务(K9 定挂 / K10 可能相关)。 */
export interface TaskSessionMatch {
  sessionId: string;
  /** K9 命中为 true,K10 为 false */
  fixed: boolean;
  /** 命中依据文案(去重) */
  reasons: string[];
  /** K6 活动窗口:只挂一个任务或靠 K9① 挂上的算整个会话,否则取命中该任务的事件 */
  from: string;
  to: string;
}

/** match.ts 的输出。 */
export interface TaskMatchOutput {
  /** K8 参与的会话:id → 会话头与全事件窗(K6:只挂一个任务 / K9① / 未归类用) */
  sessions: Map<string, { head: BoardSessionHead; wholeFrom: string; wholeTo: string }>;
  /** featureId → 该任务的命中(定挂 + 可能相关) */
  byTask: Map<string, TaskSessionMatch[]>;
  /** 参与但一个任务都没认到的会话 id(K3 的候选,还要过 user_prompt ≥ 5 条) */
  unmatched: string[];
}
