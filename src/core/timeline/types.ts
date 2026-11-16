/**
 * Type definitions for the Developer Timeline subsystem.
 *
 * Isolated from cgraphx's main types — timeline records development events
 * (user prompts, tool calls, commits), not code-graph nodes. See spec §0.1.
 */

import type { SessionSourceId } from '../agents';

export type EventType =
  | 'user_prompt'
  | 'auto_message'
  | 'pre_tool_use'
  | 'post_tool_use'
  | 'stop'
  | 'git_commit'
  | 'session_start'
  | 'session_end';

export interface TimelineEventInput {
  ts?: string; // ISO 8601 UTC ms; defaults to now
  session_id?: string | null;
  event_type: EventType;
  tool_name?: string;
  tool_args?: unknown; // any JSON; store serializes + truncates
  tool_result_summary?: string;
  prompt_text?: string;
  duration_ms?: number;
  commit_hash?: string;
  commit_message?: string;
  commit_files?: string[];
  cwd?: string; // defaults to process.cwd()
  metadata?: Record<string, unknown>;
  turn_id?: string | null;
  commit_insertions?: number | null;
  commit_deletions?: number | null;
  /** 来源 agent(已登记 agent 或只读会话来源如 deepseek);git_commit 未归属会话时为 null。 */
  agent?: SessionSourceId | null;
  /**
   * 去重键(spec:2026-11-06-会话文件解析替代hooks D5):解析补录的事件按它 INSERT OR IGNORE,
   * 重读同一事实不多记;hook 路径与 git_commit 不带(部分唯一索引只盖非空行,行为不变)。
   */
  source_key?: string;
}

export interface TimelineEvent {
  id: number;
  ts: string;
  session_id: string | null;
  event_type: EventType;
  tool_name: string | null;
  tool_args: unknown | null;
  tool_result_summary: string | null;
  prompt_text: string | null;
  duration_ms: number | null;
  commit_hash: string | null;
  commit_message: string | null;
  commit_files: string[];
  cwd: string;
  metadata: Record<string, unknown>;
  turn_id: string | null;
  commit_insertions: number | null;
  commit_deletions: number | null;
  /** 来源 agent(含只读来源如 deepseek);旧事件可能为 null(按默认 agent 处理)。 */
  agent?: SessionSourceId | null;
}

export interface TimelineQueryFilter {
  since?: string; // ISO 8601 or relative (7d / 12h / 30m / now)
  until?: string;
  type?: EventType;
  tool?: string; // exact tool_name match
  file?: string; // substring match against tool_args + commit_files
  session?: string; // exact session_id
  turn?: string; // exact turn_id match
  limit?: number; // default 100, max 10000
}

// ─── 历史查询分页(spec:2026-11-16-Codex历史会话补录 D9)──────────────────────

/** 分页位置:一条事件的 (ts,id)。升序分页的续页边界,同 ts 靠 id 分先后(不漏不重)。 */
export interface TimelinePagePosition {
  ts: string;
  id: number;
}

/**
 * 分页查询的已规范化过滤:时间界已解析成 ISO UTC(无界为 null),其余过滤没有的为 null,
 * limit 是夹紧后的页大小(1..10000)。首页算好即封进游标,续页原样恢复——翻页期间条件不变。
 */
export interface PagedQueryFilter {
  since: string | null;
  until: string | null;
  type: EventType | null;
  tool: string | null;
  file: string | null;
  session: string | null;
  turn: string | null;
  limit: number;
}

/** 分页查询的一页:事件按 (ts,id) 升序;取满一页才有 nextCursor(下一页游标),空页/末页为 null。 */
export interface TimelinePagedResult {
  events: TimelineEvent[];
  nextCursor: string | null;
}

export interface TimelineStats {
  totalEvents: number;
  byType: Record<EventType, number>;
  byTool: Array<{ tool: string; count: number }>;
  byDay: Array<{ day: string; count: number }>; // YYYY-MM-DD
  topFilesRead: Array<{ file: string; count: number }>;
  topFilesWritten: Array<{ file: string; count: number }>;
  windowStart: string | null;
  windowEnd: string | null;
}

export type StatsGroupBy = 'day' | 'event_type' | 'tool_name';

// ─── 项目在本机出现过的根(spec D10、D11)─────────────────────────────────

/** timeline_roots 的一行:装过的目录或工作区根,以及它最早、最近一次活动的时间(ISO UTC)。 */
export interface TimelineRoot {
  root: string;
  firstTs: string;
  lastTs: string;
}

/** 一个数据目录里 timeline 的汇总(spec D32、D33:列出、删除项目时显示)。 */
export interface TimelineDataSummary {
  events: number;
  /** 非空 session_id 的不同值个数 */
  sessions: number;
  /** 按 lastTs 降序:roots[0] 是最近活动的根 */
  roots: TimelineRoot[];
}

// ─── 并旧数据(spec D27、D28 timeline 部分;2026-11-06-会话文件解析替代hooks D20 只并提交)───

export interface TimelineMergeStats {
  /** 旧库处理过的提交记录数(含重复) */
  events: number;
  /** 重复的条数(项目库里已有同 hash 的,只留一份) */
  duplicates: number;
}

export interface TimelineMerger {
  /** D27 ①:不加锁,把旧库 id ≤ upToId 的提交记录分批写进项目库 */
  mergeEventsUpTo(upToId: number): void;
  /** D27 ②:由调用方在旧库写事务里调;并 id > afterId 的提交记录,再并 timeline_roots */
  mergeTail(afterId: number, attributionRoots: readonly string[]): void;
  stats(): TimelineMergeStats;
}

// ─── 看板只读查询(2026-11-06-agent看板 D14;plan C-5)────────────────────────

/** 看板要用的一个会话头:session_start 事件(session_id、agent、cwd、ts)。 */
export interface BoardSessionHead {
  /** 会话编号(session_id;deepseek 是主会话编号) */
  id: string;
  /** 来源 id(SessionSourceId;旧事件可能为 null 已在读取侧兜底) */
  agent: string;
  /** 会话开始目录(session_start 的 cwd) */
  startCwd: string;
  ts: string;
}

/** 看板要用的提问:user_prompt 事件的 ts、session_id、prompt_text。 */
export interface BoardPrompt {
  ts: string;
  sessionId: string;
  text: string;
}

/** 看板要用的提交:commit_files 已在读取侧解析成路径数组;branch 取 metadata 的 $.branch。 */
export interface BoardCommit {
  ts: string;
  /** DeepSeek 的提交、早就记下的提交没有会话编号 → null(认不到会话上) */
  sessionId: string | null;
  files: string[];
  branch: string | null;
}

/** 看板要用的工具事件:写 / 读 / Skill 六种;Bash 不取(K11 天然成立)。 */
export interface BoardToolEvent {
  ts: string;
  sessionId: string;
  tool: string;
  /** tool_args 的 $.file_path;取不出为 null */
  filePath: string | null;
  /** 仅 Skill:tool_args 的 $.args;其余为 null */
  args: string | null;
}

/**
 * 一个项目库的看板数据(plan C-5):session_start、user_prompt、git_commit 与写读类工具事件,
 * 外加标题表全表;各数组按 ts 升序(同 ts 按 id)。列集合钉死在 plan——除这些列外不取大列
 * (tool_result_summary、整段 tool_args 不出库),Bash 事件不进查询。
 */
export interface BoardTimelineData {
  sessions: BoardSessionHead[];
  prompts: BoardPrompt[];
  commits: BoardCommit[];
  tools: BoardToolEvent[];
  /** timeline_session_titles 全表(形状同 store.ts 的 SessionTitle) */
  titles: Array<{ sessionId: string; title: string; kind: string; ts: string }>;
}
