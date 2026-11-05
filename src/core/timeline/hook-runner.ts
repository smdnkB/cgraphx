/**
 * hook 入口的公共流程:读 stdin 的 payload → 认出会话的根、定好数据位置 → buildEvent → recordEvent。
 *
 * Spec §3.1 / §4.5:永远以 0 退出,stdout 恒空,失败只写 stderr —— 绝不阻塞宿主。
 * 唯一例外:会话开始 hook 在 runHook 返回后可能输出一段 hookSpecificOutput(skill 版本落后提示、git 钩子片段
 * 没补上的原因,见 hooks.ts 的 sessionStartHook);runHook 本身仍不写 stdout。
 *
 * 会话的根(spec D6、K17):按 payload 的 session_id 读会话登记(基础层 session-registry.ts),读不到就现认一次
 * 并补写——起点在会话开始 hook 是 payload.cwd,其余 hook 是 agent 描述的项目目录环境变量(projectDirEnv),
 * 没有再用 payload.cwd。整个会话都记在开始的那个项目里:中途 cd 到别处、在附加目录里改文件都不换根,事件自己的
 * cwd 照实记 payload.cwd。
 *
 * 定数据位置(spec D7):拿到根先 ensureDataDirAtRoot(要建就建),之后轮次记录、事件都按这个根。认不出根(git
 * 出错、起点往上没有根)或这个根按 D7 不记(没有标识、没装过而项目库不在)时,这一条不记、不写轮次记录。
 */

import { NO_TIMELINE_ENV, PERF_WARN_MS } from './constants';
import { recordEvent, type EventEnricher } from './recorder';
import { readStdinJson, extractHookPayload, type HookPayload } from './payload';
import { ensureDataDirAtRoot } from '../data-location';
import { sessionRootOf } from '../session-registry';
import { DEFAULT_AGENT_ID, getAgentProfile, type AgentId } from '../agents';
import type { TimelineEventInput } from './types';

export interface HookRunResult {
  payloadPresent: boolean;
  recorded: boolean;
  durationMs: number;
  error?: string;
}

/** buildEvent 拿到的上下文。 */
export interface HookContext {
  /** 会话的根(已知根):轮次记录、事件都按它定数据位置 */
  readonly root: string;
}

/** runHook 的选项。 */
export interface RunHookOptions {
  /**
   * 转交给 recordEvent 的增强回调:在写事务里、写入之前调用,拿到活的 store 可以查之前的事件。
   * 它抛的异常由 runHook 的 try/catch 兜住,hook 照样以 0 退出。
   */
  enricher?: EventEnricher;
  /** 调起 hook 的 agent:会话登记读不到时,按它的项目目录环境变量取起点;不给按默认 agent */
  agent?: AgentId;
  /** 会话开始 hook:会话登记读不到时起点取 payload.cwd(spec D6) */
  sessionStart?: boolean;
  /**
   * 读到 payload 后、认根之前调用:会话开始 hook 据此记下 cwd 与 source,这一条记不记都照样输出提示。
   */
  onPayload?: (payload: HookPayload) => void;
}

/**
 * 跑一个 hook:从 stdin 读宿主的 payload,记一条事件,无论结果如何都正常返回。
 *
 * @param buildEvent  把 payload 映射成 TimelineEventInput,拿到会话的根(轮次记录按它读写);返回 `null` 不记
 *   (如缺字段、只读工具的 pre 事件)。可以是 async——如读轮次记录。认不出根或这个根不记时不调用。
 * @param options     增强回调、agent、是不是会话开始、读到 payload 时的回调。
 */
export async function runHook(
  buildEvent: (
    payload: HookPayload,
    ctx: HookContext,
  ) => Promise<TimelineEventInput | null> | TimelineEventInput | null,
  options?: RunHookOptions,
): Promise<void> {
  const start = Date.now();

  // 开关关闭:不读 stdin,不碰库
  if (isKillSwitchOn()) {
    return;
  }

  const raw = await readStdinJson();
  if (!raw) {
    // 没有 payload(手动调起或 stdin 立即 EOF):静默退出
    return;
  }

  const payload = extractHookPayload(raw);
  options?.onPayload?.(payload);

  let root: string | null;
  try {
    root = sessionRoot(payload, options);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    process.stderr.write(`[timeline] record failed: ${msg}\n`);
    return;
  }
  if (root === null) return;

  const event = await buildEvent(payload, { root });
  if (!event) return;

  try {
    await recordEvent(root, event, options?.enricher);
  } catch (err) {
    // 只写 stderr,绝不阻塞宿主;也兜住 enricher 抛的异常——坏掉的 enricher 退化为这一条没记上,
    // hook 照样退出
    const msg = err instanceof Error ? err.message : String(err);
    process.stderr.write(`[timeline] record failed: ${msg}\n`);
  }

  const durationMs = Date.now() - start;
  if (durationMs > PERF_WARN_MS) {
    process.stderr.write(`[timeline] hook took ${durationMs}ms (>${PERF_WARN_MS} budget)\n`);
  }
}

/**
 * 会话的根(spec D6、D7):会话登记里的根,数据位置拿得到才算;认不出根、git 出错、这个根按 D7 不记 → null。
 * 拿到根先 ensureDataDirAtRoot:根装过的项目库模式下,项目目录不在就当场建,之后的轮次记录写得进去。
 */
function sessionRoot(payload: HookPayload, options: RunHookOptions | undefined): string | null {
  const reg = sessionRootOf(payload.session_id ?? null, startOf(payload, options));
  if (reg === null || reg.root === null) return null;
  return ensureDataDirAtRoot(reg.root) === null ? null : reg.root;
}

/**
 * 会话登记读不到时认根的起点(spec D6):会话开始 hook 用 payload.cwd;其余 hook 用 agent 给的项目目录环境变量
 * (agents 描述的 projectDirEnv),没有再用 payload.cwd。
 */
function startOf(payload: HookPayload, options: RunHookOptions | undefined): string {
  const cwd = payload.cwd ?? process.cwd();
  if (options?.sessionStart === true) return cwd;
  const profile = getAgentProfile(options?.agent ?? DEFAULT_AGENT_ID);
  const fromEnv = profile === undefined ? undefined : process.env[profile.projectDirEnv]?.trim();
  return fromEnv !== undefined && fromEnv !== '' ? fromEnv : cwd;
}

export function isKillSwitchOn(): boolean {
  const v = process.env[NO_TIMELINE_ENV];
  if (!v) return false;
  const trimmed = v.trim().toLowerCase();
  return trimmed !== '' && trimmed !== '0' && trimmed !== 'false';
}
