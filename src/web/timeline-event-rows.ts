/**
 * 时间线事件 → 行模型(时间线页与开发任务页共用)。
 *
 * 从 pages-timeline.ts 原样搬出:事件行(EventRowModel)与提交行(CommitRowModel)的
 * 组装、payload 字段矩阵、主路径提取、一行摘要。时间均为进程本地时区。
 */

import type { TimelineEvent } from '../core/timeline';
import { EVENT_TYPE_LABELS, EVENT_TYPE_CHIP_TONE } from './constants';
import { pad2 } from './render-utils';
import type { CommitRowModel, EventRowModel, Payload } from './timeline-templates';

/** ms → 进程本地 HH:mm:ss(spec §3.3 事件行精确到秒;不用 data-local-time 避免 app.js 降为分钟)。 */
export function eventTime(ms: number): { datetime: string; text: string } {
  const d = new Date(ms);
  return {
    datetime: d.toISOString(),
    text: `${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`,
  };
}

/** ms → 进程本地 HH:mm(会话卡/提交时间范围,分钟精度)。 */
export function cardTime(ms: number): { datetime: string; text: string } {
  const d = new Date(ms);
  return { datetime: d.toISOString(), text: `${pad2(d.getHours())}:${pad2(d.getMinutes())}` };
}

/** 截断 + 省略号。 */
export function truncate(s: string, max: number): string {
  return s.length <= max ? s : `${s.slice(0, max)}…`;
}

// ----- payload 字段矩阵(spec §3.3,值原样不派生;null 字段省略)--------------

/**
 * 组装单事件 payload 对象(按 event_type)。值为 null 的字段不入对象(省略)。
 * hasPayload = 对象非空(有可展开字段)。子 agent 行型(Agent/Task 的 post)附说明文案。
 */
function buildPayload(e: TimelineEvent): { payload: Payload; isSubagent: boolean; subagentNote: string | null } {
  const isSubagent = e.event_type === 'post_tool_use' && (e.tool_name === 'Agent' || e.tool_name === 'Task');
  const note =
    isSubagent
      ? '记录层现状:子 agent 仅「完成」事件入库——启动时刻与内部工具步骤不记录;此行呈现的是完成时刻。branch 信息未记录,无法呈现。'
      : null;

  const obj: Record<string, unknown> = {};
  const set = (k: string, v: unknown): void => {
    if (v !== null && v !== undefined) obj[k] = v;
  };

  switch (e.event_type) {
    case 'user_prompt':
      set('prompt_text', e.prompt_text);
      set('turn_id', e.turn_id);
      break;
    case 'pre_tool_use':
      set('tool_name', e.tool_name);
      set('tool_args', e.tool_args);
      set('turn_id', e.turn_id);
      break;
    case 'post_tool_use':
      set('tool_name', e.tool_name);
      set('tool_args', e.tool_args);
      set('tool_result_summary', e.tool_result_summary);
      set('duration_ms', e.duration_ms);
      set('turn_id', e.turn_id);
      break;
    case 'stop':
      // metadata 是 Record(可能含 session_event_count / session_duration_ms / session_last_prompt_preview)
      if (e.metadata !== null && Object.keys(e.metadata).length > 0) {
        obj.metadata = e.metadata;
      }
      set('turn_id', e.turn_id);
      break;
    default:
      // git_commit 不走事件行(入 CommitRowModel),此处不触发
      break;
  }

  return { payload: Object.keys(obj).length > 0 ? obj : null, isSubagent, subagentNote: note };
}

/** 从 tool_args(已解析对象)提取主路径/命令,用于事件行 ev__path。 */
function extractPath(e: TimelineEvent): string | null {
  if (e.tool_args === null || typeof e.tool_args !== 'object') return null;
  const a = e.tool_args as Record<string, unknown>;
  const pick = (k: string): string | null => (typeof a[k] === 'string' ? (a[k] as string) : null);
  switch (e.tool_name) {
    case 'Edit':
    case 'Write':
    case 'MultiEdit':
    case 'NotebookEdit':
    case 'Read':
      return pick('file_path');
    case 'Bash':
      return pick('command');
    case 'Grep':
      return pick('pattern') ?? pick('path');
    case 'Glob':
      return pick('path') ?? pick('pattern');
    case 'Agent':
    case 'Task':
      return pick('description');
    default:
      return null;
  }
}

/** 一行摘要(按 event_type)。 */
function buildSummary(e: TimelineEvent): string | null {
  switch (e.event_type) {
    case 'user_prompt':
      return e.prompt_text !== null ? truncate(e.prompt_text, 80) : null;
    case 'pre_tool_use':
      return null;
    case 'post_tool_use':
      return e.tool_result_summary !== null ? truncate(e.tool_result_summary, 100) : null;
    case 'stop':
      return null;
    default:
      return null;
  }
}

/** 单事件 → EventRowModel(不含分组归属,仅行本身)。 */
export function toEventRow(e: TimelineEvent): EventRowModel {
  const { payload, isSubagent, subagentNote } = buildPayload(e);
  return {
    time: eventTime(Date.parse(e.ts)),
    eventType: e.event_type,
    label: EVENT_TYPE_LABELS[e.event_type],
    tone: EVENT_TYPE_CHIP_TONE[e.event_type],
    toolName: e.tool_name,
    path: extractPath(e) !== null ? truncate(extractPath(e) as string, 60) : null,
    summary: buildSummary(e),
    hasPayload: payload !== null,
    payload,
    isSubagent,
    subagentNote,
  };
}

/** git_commit 事件 → CommitRowModel。 */
export function toCommitRow(e: TimelineEvent): CommitRowModel {
  // hash 截短到 8 位(短 hash,与 git log --oneline 一致);完整 40 位会挤爆行布局。
  const fullHash = e.commit_hash ?? '';
  return {
    time: cardTime(Date.parse(e.ts)),
    hash: fullHash.length > 8 ? fullHash.slice(0, 8) : fullHash,
    message: e.commit_message ?? '',
    insertions: e.commit_insertions ?? 0,
    deletions: e.commit_deletions ?? 0,
    files: e.commit_files,
  };
}
