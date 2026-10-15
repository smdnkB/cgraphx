/**
 * Type definitions for the Developer Timeline subsystem.
 *
 * Isolated from cgraphx's main types — timeline records development events
 * (user prompts, tool calls, commits), not code-graph nodes. See spec §0.1.
 */

import type { AgentId } from '../agents';

export type EventType =
  | 'user_prompt'
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
  /** 来源 agent;仅写入,读取侧 TimelineEvent 不暴露。git_commit 未归属会话时为 null。 */
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
