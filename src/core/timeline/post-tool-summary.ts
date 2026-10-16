/**
 * 工具结果摘要(tool_result_summary)生成器 —— 摘要契约 v2 的唯一产出方。
 *
 * 形状:`{ v: 2, success, payload }`。payload 按工具区分,取不到的字段一律不写
 * (不写 null),两个 agent(Claude Code / CodeBuddy)共用同一份契约:
 *   - 能从调用参数(tool_input)取的信息都取自调用参数,两边一致;
 *   - 宿主没给的信息就缺省,不推测(如 CodeBuddy 的 Bash 不给 stdout)。
 * 失败有两种来源:Claude Code 的 PostToolUseFailure(经 failure 参数传入)、
 * CodeBuddy 带 `is_error:true` 的 PostToolUse 响应;被中断也算失败。
 * 字段契约成文见 docs/knowledge/开发时间线工具事件契约.md。
 */

import {
  RESULT_SUMMARY_MAX_BYTES,
  SUMMARY_FIELD_MAX_BYTES,
  SUMMARY_VERSION,
  TRUNCATED_SUFFIX,
} from './constants';
import { detectBashSemantics } from './bash-semantics';
import { capJsonValue, truncateUtf8 } from './json-cap';

/** 摘要契约 v2。 */
export interface ToolResultSummaryV2 {
  v: 2;
  success: boolean;
  payload: Record<string, unknown>;
}

/** 宿主报告的失败(Claude Code PostToolUseFailure 的 error / is_interrupt)。 */
export interface ToolFailure {
  error?: string;
  isInterrupt?: boolean;
}

/** 任务标题的单字段上限(字符数,沿用 v1)。 */
const SUBJECT_MAX_CHARS = 200;

/** Claude Code 失败文本以 "Exit code N" 开头。 */
const EXIT_CODE_IN_ERROR = /^Exit code (\d+)/;

function asRecord(v: unknown): Record<string, unknown> | null {
  return v !== null && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : null;
}

function nonEmptyString(v: unknown): string | undefined {
  return typeof v === 'string' && v.length > 0 ? v : undefined;
}

function truncateSubject(s: string): string {
  if (s.length <= SUBJECT_MAX_CHARS) return s;
  return s.slice(0, SUBJECT_MAX_CHARS - TRUNCATED_SUFFIX.length) + TRUNCATED_SUFFIX;
}

/** 按 key 顺序取第一个非空字符串(字段位置随工具变体略有不同时用)。 */
function pickString(rec: Record<string, unknown>, keys: string[]): string | undefined {
  for (const k of keys) {
    const v = nonEmptyString(rec[k]);
    if (v !== undefined) return v;
  }
  return undefined;
}

/** 退出码:响应的 exit_code / exitCode(CodeBuddy),否则从失败文本解析;都没有返回 undefined。 */
function resolveExitCode(response: Record<string, unknown> | null, failure?: ToolFailure): number | undefined {
  if (response) {
    if (typeof response.exit_code === 'number') return response.exit_code;
    if (typeof response.exitCode === 'number') return response.exitCode;
  }
  const m = failure?.error !== undefined ? EXIT_CODE_IN_ERROR.exec(failure.error) : null;
  return m ? Number(m[1]) : undefined;
}

/** 把值写进 payload;undefined 不写。 */
function put(payload: Record<string, unknown>, key: string, value: unknown): void {
  if (value !== undefined) payload[key] = value;
}

function preview(s: string): string {
  return truncateUtf8(s, SUMMARY_FIELD_MAX_BYTES);
}

/** Task* 工具:taskId 在根上(TaskUpdate)或 task{} 下(Create / Get),status 位置同理。 */
function taskPayload(payload: Record<string, unknown>, r: Record<string, unknown>): void {
  const nested = asRecord(r.task);
  const statusChange = asRecord(r.statusChange);
  const subject = pickString(r, ['subject']) ?? (nested ? pickString(nested, ['subject']) : undefined);
  put(payload, 'taskId', pickString(r, ['taskId', 'task_id', 'id'])
    ?? (nested ? pickString(nested, ['id', 'taskId', 'task_id']) : undefined));
  put(payload, 'subject', subject !== undefined ? truncateSubject(subject) : undefined);
  put(payload, 'status', pickString(r, ['status'])
    ?? (statusChange ? pickString(statusChange, ['to', 'status']) : undefined)
    ?? (nested ? pickString(nested, ['status']) : undefined));
}

function bashPayload(
  payload: Record<string, unknown>,
  r: Record<string, unknown> | null,
  args: Record<string, unknown> | null,
  exitCode: number | undefined,
): void {
  put(payload, 'exit_code', exitCode);
  const stdout = r && typeof r.stdout === 'string' ? r.stdout : '';
  const semantics = detectBashSemantics({
    command: args && typeof args.command === 'string' ? args.command : '',
    stdout,
    exit_code: exitCode,
  });
  if (semantics) {
    payload.category = semantics.category;
    put(payload, 'pass', semantics.pass);
    put(payload, 'fail', semantics.fail);
    put(payload, 'duration_ms', semantics.duration_ms);
  } else if (stdout.length > 0) {
    payload.stdout_preview = preview(stdout);
  }
  const stderr = r ? nonEmptyString(r.stderr) : undefined;
  if (stderr !== undefined) payload.stderr_preview = preview(stderr);
}

/** 未专门处理的工具:响应的字符串本身或 JSON 文本做预览。 */
function responsePreview(toolResponse: unknown): string | undefined {
  if (typeof toolResponse === 'string') return preview(toolResponse);
  if (toolResponse === null || typeof toolResponse !== 'object') return undefined;
  try {
    const json = JSON.stringify(toolResponse);
    return json ? preview(json) : undefined;
  } catch {
    return '<unserializable>';
  }
}

/**
 * 生成一次工具调用的摘要(JSON 文本,契约 v2)。
 *
 * @param toolName      工具名(Read / Bash / Edit / ...)
 * @param toolResponse  宿主的 tool_response;失败事件(PostToolUseFailure)没有,传 undefined
 * @param toolArgs      宿主的 tool_input(原始值,未经净化)
 * @param failure       宿主报告的失败;传入即视为失败
 */
export function summarizeToolResponse(
  toolName: string | undefined,
  toolResponse: unknown,
  toolArgs?: unknown,
  failure?: ToolFailure,
): string {
  const r = asRecord(toolResponse);
  const args = asRecord(toolArgs);
  const exitCode = resolveExitCode(r, failure);
  const interrupted = r?.interrupted === true || failure?.isInterrupt === true;
  const responseError = r ? nonEmptyString(r.error) : undefined;

  const success = !(
    failure !== undefined
    || r?.is_error === true
    || interrupted
    || (exitCode !== undefined && exitCode !== 0)
    || responseError !== undefined
  );

  const payload: Record<string, unknown> = {};
  switch (toolName) {
    case 'Read':
    case 'Edit':
    case 'Write':
    case 'MultiEdit':
      put(payload, 'file', args ? nonEmptyString(args.file_path) : undefined);
      break;
    case 'NotebookEdit':
      put(payload, 'file', args ? nonEmptyString(args.notebook_path) ?? nonEmptyString(args.file_path) : undefined);
      break;
    case 'Bash':
      bashPayload(payload, r, args, exitCode);
      break;
    case 'Task':
    case 'Agent':
      put(payload, 'subagent_type', args ? nonEmptyString(args.subagent_type) : undefined);
      break;
    case 'Skill':
      put(payload, 'skill', args ? nonEmptyString(args.skill) : undefined);
      break;
    case 'WebFetch':
    case 'WebSearch':
      put(payload, 'url', args ? nonEmptyString(args.url) : undefined);
      break;
    case 'TaskUpdate':
    case 'TaskCreate':
    case 'TaskGet':
      if (r) taskPayload(payload, r);
      break;
    default:
      put(payload, 'response_preview', responsePreview(toolResponse));
  }

  // Bash 已在 bashPayload 写入 exit_code;其它工具失败时有退出码也记下
  if (toolName !== 'Bash' && !success) put(payload, 'exit_code', exitCode);
  if (interrupted) payload.interrupted = true;
  if (!success) {
    const error = failure?.error ?? responseError;
    if (error !== undefined) payload.error = preview(error);
  }

  const summary: ToolResultSummaryV2 = { v: SUMMARY_VERSION, success, payload };
  return capJsonValue(summary, { maxStringBytes: SUMMARY_FIELD_MAX_BYTES, maxTotalBytes: RESULT_SUMMARY_MAX_BYTES });
}
