/**
 * timeline 事件的人读摘要(单行)。
 *
 * `timeline query/recent --format table` 与其它子系统(经门面)共用,保证同一事件处处摘要一致。
 */

import type { TimelineEvent } from './types';

/** 按事件类型生成一行人读摘要;无可展示内容时返回空串。 */
export function describeEvent(e: TimelineEvent): string {
  switch (e.event_type) {
    case 'user_prompt':
      return truncate(e.prompt_text ?? '', 120);
    case 'pre_tool_use':
    case 'post_tool_use':
      return describeToolArgs(e.tool_name, e.tool_args);
    case 'git_commit': {
      const parts: string[] = [];
      if (e.commit_hash) parts.push(e.commit_hash.slice(0, 7));
      if (e.commit_message) parts.push(truncate(e.commit_message, 100));
      if (e.commit_files.length > 0) parts.push(`(${e.commit_files.length} files)`);
      return parts.join(' ');
    }
    case 'stop':
      // stop 是一轮对话结束,不是会话结束(会话结束见 session_end)。
      return e.duration_ms !== null ? `turn ended (${e.duration_ms}ms)` : 'turn ended';
    case 'session_start': {
      const source = typeof e.metadata.source === 'string' ? e.metadata.source : null;
      return source ? `session started (${source})` : 'session started';
    }
    case 'session_end': {
      const reason = typeof e.metadata.reason === 'string' ? e.metadata.reason : null;
      return reason ? `session ended (${reason})` : 'session ended';
    }
  }
}

/** 工具调用参数里最能代表本次调用的字段(文件路径 / 命令 / URL / 查询词 / skill 名)。 */
function describeToolArgs(toolName: string | null, args: unknown): string {
  if (!toolName || !args || typeof args !== 'object') return '';
  const r = args as Record<string, unknown>;
  if (typeof r.file_path === 'string') return r.file_path;
  if (typeof r.path === 'string') return r.path;
  if (typeof r.command === 'string') return truncate(r.command, 120);
  if (typeof r.url === 'string') return r.url;
  if (typeof r.query === 'string') return truncate(r.query, 120);
  if (typeof r.skill === 'string') return r.skill;
  return '';
}

/** 超长截断,末尾补省略号。 */
export function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return s.slice(0, max - 1) + '…';
}
