/**
 * PostToolUse `tool_result_summary` algorithm (spec §4.2).
 *
 * PostToolUse payloads include `tool_response` which can be large (Read of a
 * 5000-line file, Bash with 100KB stdout). We never store the full response —
 * just a per-tool summary capped at RESULT_SUMMARY_MAX_BYTES.
 *
 * B-3 (timeline-data-quality) additions:
 *   - TaskUpdate / TaskCreate / TaskGet cases — extract subject/status/taskId
 *     so the post event carries usable content instead of an empty payload.
 *   - Bash case — detect semantic category (test/build/lint/git_write) and
 *     parse pass/fail counts from stdout; fall back to stdout_preview for
 *     non-semantic commands.
 */

import { RESULT_SUMMARY_MAX_BYTES, TRUNCATED_SUFFIX } from './constants';
import { detectBashSemantics } from './bash-semantics';

interface ResponseSummary {
  success: boolean;
  payload: Record<string, unknown>;
}

function looksLikeError(response: unknown): boolean {
  if (response === null || typeof response !== 'object') return false;
  const r = response as Record<string, unknown>;
  if (r.error !== undefined && r.error !== null) return true;
  if (typeof r.stderr === 'string' && r.stderr.length > 0) {
    // Bash responses include stderr on success too — only treat as error if
    // there's also a non-zero exit_code or explicit error field.
    if (typeof r.exit_code === 'number' && r.exit_code !== 0) return true;
  }
  return false;
}

function truncate(s: string): string {
  if (s.length <= RESULT_SUMMARY_MAX_BYTES) return s;
  return s.slice(0, RESULT_SUMMARY_MAX_BYTES - TRUNCATED_SUFFIX.length) + TRUNCATED_SUFFIX;
}

/** Per-field cap for the task subject (B-3). */
const SUBJECT_MAX_CHARS = 200;

function truncateSubject(s: string): string {
  if (s.length <= SUBJECT_MAX_CHARS) return s;
  return s.slice(0, SUBJECT_MAX_CHARS - TRUNCATED_SUFFIX.length) + TRUNCATED_SUFFIX;
}

/**
 * Try to pull a string field from a record at any of the given keys, returning
 * the first string hit. Used when a field's path varies slightly across tool
 * variants (taskId at root vs nested in task{}).
 */
function pickString(rec: Record<string, unknown>, keys: string[]): string | undefined {
  for (const k of keys) {
    const v = rec[k];
    if (typeof v === 'string' && v.length > 0) return v;
  }
  return undefined;
}

/**
 * Best-effort extract the Bash command string from the tool_args (preferred)
 * or fall back to a command-shaped field on the tool_response itself.
 *
 * Claude Code's Bash tool_args carries the command at `command`. The tool_response
 * carries stdout / stderr / exit_code but NOT the command, so we prefer toolArgs
 * when the caller passes it; otherwise we scan tool_response for a command-like
 * field (some tool variants echo it back) and return '' when nothing is found.
 */
function extractBashCommand(
  toolResponse: Record<string, unknown>,
  toolArgs?: unknown,
): string {
  if (toolArgs && typeof toolArgs === 'object') {
    const a = toolArgs as Record<string, unknown>;
    if (typeof a.command === 'string') return a.command;
  }
  // tool_response sometimes echoes the command (varies by Claude Code version).
  if (typeof toolResponse.command === 'string') return toolResponse.command;
  return '';
}

/**
 * Build a per-tool summary object, JSON-stringified by the store.
 * Unknown tools get a generic shape with a small response_preview.
 *
 * @param toolName    Claude Code tool name (Read/Write/Bash/TaskUpdate/...)
 * @param toolResponse  The `tool_response` payload from Claude Code.
 * @param toolArgs    Optional `tool_input` payload — passed by callers that have
 *   it (B-3 uses it to find the Bash command string). When omitted, Bash
 *   semantic detection degrades gracefully (no command → null → stdout_preview
 *   fallback), and Task* tools still work because taskId/subject/status are
 *   mirrored onto tool_response by Claude Code. Backwards-compatible: the old
 *   two-arg signature still works.
 */
export function summarizeToolResponse(
  toolName: string | undefined,
  toolResponse: unknown,
  toolArgs?: unknown,
): string {
  const summary: ResponseSummary = {
    success: !looksLikeError(toolResponse),
    payload: {},
  };

  if (toolResponse === null || typeof toolResponse !== 'object') {
    if (typeof toolResponse === 'string') {
      summary.payload.response_preview = truncate(toolResponse);
    }
    return JSON.stringify(summary);
  }

  const r = toolResponse as Record<string, unknown>;

  switch (toolName) {
    case 'Read':
    case 'Write':
    case 'Edit':
    case 'MultiEdit':
    case 'NotebookEdit':
      summary.payload.file = typeof r.file_path === 'string' ? r.file_path : undefined;
      summary.payload.lines_changed = typeof r.lines_changed === 'number' ? r.lines_changed : undefined;
      break;

    case 'TaskUpdate':
    case 'TaskCreate':
    case 'TaskGet': {
      // Field paths verified against real Claude Code events (B-3):
      //   TaskUpdate tool_response: { taskId, statusChange:{to}, updatedFields }
      //   TaskCreate tool_response: { task:{ id, subject } }
      //   TaskGet    tool_response: { task:{ id, subject, status } }
      // taskId is at root for TaskUpdate; nested under task{} for Create/Get.
      const nestedTask = r.task && typeof r.task === 'object'
        ? r.task as Record<string, unknown>
        : null;
      const taskId = pickString(r, ['taskId', 'task_id', 'id'])
        ?? (nestedTask ? pickString(nestedTask, ['id', 'taskId', 'task_id']) : undefined);
      const subject = pickString(r, ['subject'])
        ?? (nestedTask ? pickString(nestedTask, ['subject']) : undefined);
      // status — TaskUpdate puts it under statusChange.to; TaskGet under task.status.
      const statusChange = r.statusChange && typeof r.statusChange === 'object'
        ? r.statusChange as Record<string, unknown>
        : null;
      const status = pickString(r, ['status'])
        ?? (statusChange ? pickString(statusChange, ['to', 'status']) : undefined)
        ?? (nestedTask ? pickString(nestedTask, ['status']) : undefined);
      summary.payload.taskId = taskId;
      summary.payload.subject = subject !== undefined ? truncateSubject(subject) : undefined;
      summary.payload.status = status;
      break;
    }

    case 'Bash': {
      summary.payload.exit_code = typeof r.exit_code === 'number' ? r.exit_code : undefined;
      const command = extractBashCommand(r, toolArgs);
      const stdout = typeof r.stdout === 'string' ? r.stdout : '';
      const semantics = detectBashSemantics({
        command,
        stdout,
        exit_code: typeof r.exit_code === 'number' ? r.exit_code : undefined,
      });
      if (semantics) {
        summary.payload.category = semantics.category;
        if (semantics.pass !== undefined) summary.payload.pass = semantics.pass;
        if (semantics.fail !== undefined) summary.payload.fail = semantics.fail;
        if (semantics.duration_ms !== undefined) summary.payload.duration_ms = semantics.duration_ms;
      } else {
        // Non-semantic command — keep the stdout_preview the old code wrote,
        // so non-test/build/lint/git Bash events don't regress.
        if (typeof r.stdout === 'string') summary.payload.stdout_preview = truncate(r.stdout);
      }
      if (typeof r.stderr === 'string') summary.payload.stderr_preview = truncate(r.stderr);
      break;
    }

    case 'Task':
    case 'Agent':
      summary.payload.subagent_type = typeof r.subagent_type === 'string' ? r.subagent_type : undefined;
      break;

    case 'WebFetch':
    case 'WebSearch':
      summary.payload.url = typeof r.url === 'string' ? r.url : undefined;
      summary.payload.status = typeof r.status === 'number' ? r.status : undefined;
      break;

    default:
      // Unknown tool — store a small preview of the response if stringifiable.
      try {
        const json = JSON.stringify(r);
        if (json) summary.payload.response_preview = truncate(json);
      } catch {
        summary.payload.response_preview = '<unserializable>';
      }
  }

  return JSON.stringify(summary);
}
