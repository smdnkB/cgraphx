/**
 * task 的 Claude Code hook 入口(spec §6.3 自动绑定、§7 会话开始提醒、§9 降级与关闭开关)。
 *
 * 两个隐藏命令共用的规则:
 *   - CGRAPHX_NO_TIMELINE 生效时直接返回:不读 stdin、不输出;
 *   - stdin 解析失败或缺 session_id 时静默退出;
 *   - 任何异常吞掉,只写 stderr `[task] …`,退出码恒为 0;
 *   - 不发网络请求,所有 DB 写入都 await。
 *
 * 与 timeline hook 不同:task hook 允许向 stdout 输出一行
 * `{"hookSpecificOutput":{…,"additionalContext":…}}`,把上下文回传给 agent。
 * 因此不复用 timeline 的 runHook(它的契约是 stdout 恒空)。
 */

import { resolveProjectRoot } from '../directory';
import { isKillSwitchOn } from '../timeline';
import { getCurrentBinding } from './binding';
import { autoBindFromFeatureDir } from './feature-link';
import type { CurrentBinding } from './types';

/** 单次 hook 耗时预算(与 timeline 一致),超出写 stderr 告警。 */
const HOOK_PERF_WARN_MS = 50;

/** 触发需求目录自动绑定的写类工具。 */
const WRITE_TOOLS = ['Edit', 'Write', 'MultiEdit', 'NotebookEdit'] as const;

type HookEventName = 'SessionStart' | 'PostToolUse';

interface TaskHookPayload {
  sessionId: string;
  cwd: string | undefined;
  raw: Record<string, unknown>;
}

/** SessionStart:向 agent 注入当前绑定的任务(未绑定时只注入会话 id,不提示绑定);查询失败不输出任何内容。 */
export async function taskSessionStartHook(): Promise<void> {
  await runTaskHook(async (payload) => {
    const projectRoot = resolveProjectRoot(payload.cwd ?? process.cwd());
    const current = getCurrentBinding(projectRoot, payload.sessionId);
    writeAdditionalContext('SessionStart', sessionStartContext(payload.sessionId, current));
  });
}

/** PostToolUse(写类工具):改动需求目录内文件时自动绑定;需提醒时回传提醒文本。 */
export async function taskPostToolUseHook(): Promise<void> {
  await runTaskHook(async (payload) => {
    const toolName = payload.raw.tool_name;
    if (typeof toolName !== 'string' || !(WRITE_TOOLS as readonly string[]).includes(toolName)) return;

    const filePath = readEditedPath(toolName, payload.raw.tool_input);
    if (filePath === null) return;
    if (hasErrorField(payload.raw.tool_response)) return;

    const projectRoot = resolveProjectRoot(payload.cwd ?? process.cwd());
    const outcome = await autoBindFromFeatureDir(projectRoot, payload.sessionId, filePath);
    if (outcome.kind === 'remind') writeAdditionalContext('PostToolUse', outcome.message);
  });
}

// ─── 共用骨架 ───────────────────────────────────────────────────────────────

async function runTaskHook(handler: (payload: TaskHookPayload) => Promise<void>): Promise<void> {
  const start = Date.now();
  if (isKillSwitchOn()) return;

  try {
    const raw = await readStdinJson();
    if (raw === null) return;
    const sessionId = typeof raw.session_id === 'string' ? raw.session_id.trim() : '';
    if (!sessionId) return;
    const cwd = typeof raw.cwd === 'string' && raw.cwd ? raw.cwd : undefined;
    await handler({ sessionId, cwd, raw });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    process.stderr.write(`[task] hook 失败(已忽略,不影响会话):${msg}\n`);
  }

  const durationMs = Date.now() - start;
  if (durationMs > HOOK_PERF_WARN_MS) {
    process.stderr.write(`[task] hook 耗时 ${durationMs}ms(超出 ${HOOK_PERF_WARN_MS}ms 预算)\n`);
  }
}

/** 读 stdin 到 EOF 并解析为 JSON 对象;交互终端、空输入、解析失败、非对象都返回 null。 */
async function readStdinJson(): Promise<Record<string, unknown> | null> {
  if (process.stdin.isTTY) return null;
  const text = await new Promise<string>((resolve) => {
    let data = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (chunk) => { data += chunk; });
    process.stdin.on('end', () => resolve(data));
    process.stdin.on('error', () => resolve(data));
  });
  if (!text.trim()) return null;
  try {
    const parsed: unknown = JSON.parse(text);
    return parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

function writeAdditionalContext(hookEventName: HookEventName, additionalContext: string): void {
  process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName, additionalContext } }) + '\n');
}

// ─── 取值与文案 ─────────────────────────────────────────────────────────────

/** NotebookEdit 取 notebook_path,其余写类工具取 file_path;不是非空字符串返回 null。 */
function readEditedPath(toolName: string, toolInput: unknown): string | null {
  if (toolInput === null || typeof toolInput !== 'object') return null;
  const key = toolName === 'NotebookEdit' ? 'notebook_path' : 'file_path';
  const value = (toolInput as Record<string, unknown>)[key];
  return typeof value === 'string' && value ? value : null;
}

function hasErrorField(toolResponse: unknown): boolean {
  return toolResponse !== null && typeof toolResponse === 'object' && 'error' in toolResponse;
}

function sessionStartContext(sessionId: string, current: CurrentBinding | null): string {
  if (current !== null) {
    const { task } = current;
    const ref = task.source === 'api' && task.externalId ? task.externalId : '手动';
    return `当前会话已绑定开发任务:${ref} ${task.name}。当前会话 id:${sessionId}。`;
  }
  return (
    `当前会话 id:${sessionId}(执行 cgraphx task 命令拿不到会话时用 --session 传入)。`
  );
}
