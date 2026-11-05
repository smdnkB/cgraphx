/**
 * Type definitions for the Developer Timeline subsystem.
 *
 * Isolated from cgraphx's main types — timeline records development events
 * (user prompts, tool calls, commits), not code-graph nodes. See spec §0.1.
 */

import type { AgentId } from '../agents';

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
  /** 来源 agent;git_commit 未归属会话时为 null。 */
  agent?: AgentId | null;
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
  /** 来源 agent;旧事件可能为 null(按默认 agent 处理)。 */
  agent?: AgentId | null;
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

// ─── 并旧事件(spec D27、D28、D29 timeline 部分)───────────────────────────

/** 旧库事件 id → 项目库事件 id 的对照,project 并旧事件时换算 id。 */
export interface EventIdMapping {
  /** 旧 id → 新 id;重复的取项目库已有那条的 id;旧库里没有这个 id → undefined */
  get(oldId: number): number | undefined;
  /**
   * 换算一个会话的进度:旧值在表里取对应新 id;不在取这个会话里不大于它的最大旧 id 对应的新 id;都没有 → 0。
   * 这个会话在旧库里没有事件(终端会话、副本会话这类非 hook 记的会话 id)→ get(oldId) ?? 0。
   */
  mapProgress(sessionId: string, oldId: number): number;
  /** 并之前这个会话在项目库里的最大 id;项目库没有这个会话 → null */
  projectMaxIdBefore(sessionId: string): number | null;
}

export interface TimelineMergeStats {
  /** 旧库处理过的事件数(含重复) */
  events: number;
  /** 旧库非空 session_id 的不同值个数 */
  sessions: number;
  /** 重复的条数(项目库里已经有,只留一份) */
  duplicates: number;
}

export interface TimelineMerger {
  readonly mapping: EventIdMapping;
  /** D27 ①:不加锁,把旧库 id ≤ upToId 的事件分批写进项目库 */
  mergeEventsUpTo(upToId: number): void;
  /** D27 ②:由调用方在旧库写事务里调;并 id > afterId 的事件,再并 timeline_roots */
  mergeTail(afterId: number, attributionRoots: readonly string[]): void;
  stats(): TimelineMergeStats;
}
