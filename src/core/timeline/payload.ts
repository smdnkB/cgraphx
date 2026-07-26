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
   * Turn id surfaced by Claude Code, when the host includes one in the payload
   * (B-1). Most Claude Code versions today do NOT populate this, so the
   * user-prompt hook generates a UUID v4 itself and writes it to a per-turn
   * file — see hooks.ts `readCurrentTurnId`. When the host DOES send a
   * turn_id, the hook honors it verbatim (no overwrite).
   */
  turn_id?: string | null;
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
  ];
  return (valid as string[]).includes(s) ? (s as EventType) : null;
}
