/**
 * task 的 agent hook 入口(spec §3.3 会话开始只注入会话 id、§9 降级与关闭开关)。
 *
 * 各隐藏命令共用的规则:
 *   - CGRAPHX_NO_TIMELINE 生效时直接返回:不读 stdin、不输出;
 *   - stdin 解析失败或缺 session_id 时静默退出;
 *   - 任何异常吞掉,只写 stderr `[task] …`,退出码恒为 0;
 *   - 不发网络请求,所有 DB 写入都 await。
 *
 * 只有 SessionStart 向 stdout 输出一行
 * `{"hookSpecificOutput":{…,"additionalContext":…}}`,把会话 id 回传给 agent;
 * 项目 skill 版本落后时,同一段里在会话 id 后另起一行接上提示(skill-version);
 * 本项目关了 Claude Code 自动记忆时,再接一行记忆去向提示(记忆迁进知识库 spec D9)。
 * Stop 与兼容用的 PostToolUse 入口 stdout 恒空。因此不复用 timeline 的 runHook。
 */

import * as fs from 'node:fs';
import * as path from 'node:path';

import { agentConfigDir, DEFAULT_AGENT_ID, type AgentProfile } from '../agents';
import { resolveProjectRoot } from '../directory';
import { skillVersionNotice } from '../skill-version';
import { isKillSwitchOn } from '../timeline';
import { isHistoryPassDone, refreshAutoBindings } from './auto-binding';

/** 单次 hook 耗时预算(与 timeline 一致),超出写 stderr 告警。 */
const HOOK_PERF_WARN_MS = 50;

/** Claude Code 本人的本地设置文件(不签入),`autoMemoryEnabled` 写在这里。 */
const CLAUDE_LOCAL_SETTINGS_FILE = 'settings.local.json';

interface TaskHookPayload {
  sessionId: string;
  cwd: string | undefined;
  raw: Record<string, unknown>;
}

/**
 * SessionStart:注入当前会话 id(供拿不到会话时用 --session 传入),
 * 不再查询绑定、不注入任何任务内容,未绑定时也不提示。
 * 项目 skill 版本落后时,在会话 id 那行后接一行提示,合成同一段输出(skill版本落后提示 spec D5);
 * 本项目关了 Claude Code 自动记忆时,再接一行记忆去向提示(记忆迁进知识库 spec D9),没关时输出不变。
 */
export async function taskSessionStartHook(profile: AgentProfile): Promise<void> {
  await runTaskHook(async (payload) => {
    const lines = [sessionStartContext(payload.sessionId)];
    const source = typeof payload.raw.source === 'string' ? payload.raw.source : undefined;
    const projectRoot = resolveProjectRoot(payload.cwd ?? process.cwd());
    const notice = skillVersionNotice(projectRoot, profile, source);
    if (notice !== null) lines.push(notice);
    if (isAutoMemoryOff(projectRoot, profile)) lines.push(autoMemoryOffContext());
    writeAdditionalContext('SessionStart', lines.join('\n'));
  });
}

/**
 * Stop:每轮结束刷新本会话的自动绑定派生;首轮历史派生未完成时改为全量。
 * B-2 实测本仓库首轮全量约 0.36~0.43 秒(60 会话),在 hook 预算内;
 * 之后只刷新当前会话(约 3~4ms)。stdout 不输出任何内容。
 */
export async function taskStopHook(_profile: AgentProfile): Promise<void> {
  await runTaskHook(async (payload) => {
    const projectRoot = resolveProjectRoot(payload.cwd ?? process.cwd());
    if (isHistoryPassDone(projectRoot)) {
      await refreshAutoBindings(projectRoot, { sessionIds: [payload.sessionId] });
    } else {
      await refreshAutoBindings(projectRoot);
    }
  });
}

/**
 * PostToolUse(旧配置仍可能调用):自动绑定已改为按会话派生,本入口只保留兼容——
 * 读完 stdin 后直接返回,退出码恒为 0、stdout 为空。
 */
export async function taskPostToolUseHook(_profile: AgentProfile): Promise<void> {
  await runTaskHook(async () => {
    // 兼容入口:不读事件、不写库、不输出。
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

/**
 * 本项目是否关了 Claude Code 自动记忆:只看本人本地设置里 `autoMemoryEnabled` 是否为 false;
 * 其他 agent、文件不存在、读不出或不是 JSON 对象一律按没关处理。
 */
function isAutoMemoryOff(projectRoot: string, profile: AgentProfile): boolean {
  if (profile.id !== DEFAULT_AGENT_ID) return false;
  try {
    const file = path.join(agentConfigDir(projectRoot, profile), CLAUDE_LOCAL_SETTINGS_FILE);
    const parsed: unknown = JSON.parse(fs.readFileSync(file, 'utf-8'));
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return false;
    return (parsed as { autoMemoryEnabled?: unknown }).autoMemoryEnabled === false;
  } catch {
    return false;
  }
}

function writeAdditionalContext(hookEventName: 'SessionStart', additionalContext: string): void {
  process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName, additionalContext } }) + '\n');
}

// ─── 文案 ───────────────────────────────────────────────────────────────────

function sessionStartContext(sessionId: string): string {
  return `当前会话 id:${sessionId}(执行 cgraphx task 命令拿不到会话时用 --session 传入)。`;
}

/** 关了自动记忆以后,用户说「以后都这样做」时先问去向;只讲去向,不提还有没迁的记忆。 */
function autoMemoryOffContext(): string {
  return (
    '本项目已关 Claude Code 自动记忆:用户要你以后都照某个做法来时,先问记到哪——' +
    '知识库(项目里的决策、规则、教训,走 /knowledge-write)/ 项目约定(每轮都要守的,写进项目根目录 CLAUDE.md)/ ' +
    '你个人的设置(只关于本人的偏好,写进 ~/.claude/CLAUDE.md)。'
  );
}
