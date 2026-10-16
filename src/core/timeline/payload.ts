/**
 * Parse Claude Code hook payloads from stdin.
 *
 * Spec §3.2 — payload field assumptions. All fields are optional in practice
 * (Claude Code versions differ); callers handle nulls gracefully.
 */

import type { EventType } from './types';

/** Read stdin until EOF, parse JSON. Returns null on any failure. */
export async function readStdinJson<T = Record<string, unknown>>(): Promise<T | null> {
  if (process.stdin.isTTY) return null; // manual invocation, no piped payload

  try {
    const raw = await new Promise<string>((resolve) => {
      let data = '';
      process.stdin.setEncoding('utf8');
      process.stdin.on('data', (c) => { data += c; });
      process.stdin.on('end', () => resolve(data));
      process.stdin.on('error', () => resolve(data));
    });
    if (!raw.trim()) return null;
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

/** Pull common fields from any Claude Code hook payload. */
export interface HookPayload {
  session_id?: string | null;
  cwd?: string;
  prompt?: string;
  tool_name?: string;
  tool_input?: unknown;
  tool_response?: unknown;
  stop_hook_active?: boolean;
  /**
   * 宿主在 payload 中给出的 turn id(B-1)。目前多数 Claude Code 版本不带,
   * user-prompt hook 会自行生成 UUID v4 并写入本会话的 turn 状态文件
   * (见 turn-state.ts);宿主给出时原样沿用,不覆盖。
   */
  turn_id?: string | null;
  /** SessionStart 的启动来源(startup / resume / clear / compact 等)。 */
  source?: string;
  /** SessionEnd 的结束原因。 */
  reason?: string;
  /** 工具调用 id(两个 agent 的 Pre/PostToolUse 都带),写入 metadata.tool_use_id。 */
  tool_use_id?: string;
  /** 子 agent 内的工具事件才有;主会话的事件没有(CodeBuddy 主会话只有 agent_type)。 */
  agent_id?: string;
  agent_type?: string;
  /** 宿主测量的工具耗时(Claude Code 的 PostToolUse / PostToolUseFailure)。 */
  duration_ms?: number;
  /** PostToolUseFailure 的失败文本。 */
  error?: string;
  /** PostToolUseFailure:以中断而非工具报错的形式失败。 */
  is_interrupt?: boolean;
}

export function extractHookPayload(raw: unknown): HookPayload {
  if (!raw || typeof raw !== 'object') return {};
  const obj = raw as Record<string, unknown>;
  return {
    session_id: typeof obj.session_id === 'string' ? obj.session_id : null,
    cwd: typeof obj.cwd === 'string' ? obj.cwd : undefined,
    prompt: typeof obj.prompt === 'string' ? obj.prompt : undefined,
    tool_name: typeof obj.tool_name === 'string' ? obj.tool_name : undefined,
    tool_input: obj.tool_input,
    tool_response: obj.tool_response,
    stop_hook_active: typeof obj.stop_hook_active === 'boolean' ? obj.stop_hook_active : undefined,
    turn_id: typeof obj.turn_id === 'string' ? obj.turn_id : null,
    source: typeof obj.source === 'string' ? obj.source : undefined,
    reason: typeof obj.reason === 'string' ? obj.reason : undefined,
    tool_use_id: typeof obj.tool_use_id === 'string' && obj.tool_use_id !== '' ? obj.tool_use_id : undefined,
    agent_id: typeof obj.agent_id === 'string' && obj.agent_id !== '' ? obj.agent_id : undefined,
    agent_type: typeof obj.agent_type === 'string' ? obj.agent_type : undefined,
    duration_ms: typeof obj.duration_ms === 'number' && Number.isFinite(obj.duration_ms) && obj.duration_ms >= 0
      ? obj.duration_ms
      : undefined,
    error: typeof obj.error === 'string' ? obj.error : undefined,
    is_interrupt: typeof obj.is_interrupt === 'boolean' ? obj.is_interrupt : undefined,
  };
}

/** Discriminator for which event type a payload represents (caller decides). */
export function assertEventType(s: string): EventType | null {
  const valid: EventType[] = [
    'user_prompt',
    'pre_tool_use',
    'post_tool_use',
    'stop',
    'git_commit',
    'session_start',
    'session_end',
  ];
  return (valid as string[]).includes(s) ? (s as EventType) : null;
}
