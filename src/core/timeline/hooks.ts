/**
 * Claude Code hook 的处理函数(user_prompt / pre_tool_use / post_tool_use / post_tool_use_failure /
 * stop / session_start / session_end);git post-commit、post-merge 共用的 gitCommitHook 在 git-commit.ts,
 * 这里原名转出。
 *
 * 每个函数把宿主的 payload 映射成 TimelineEventInput 并交给 runHook,由 cli.ts 中的隐藏子命令调起
 * (如 `cgraphx timeline-pre-tool-use-hook`)。runHook 先按会话登记认出会话的根、定好数据位置,buildEvent
 * 拿到这个根读写轮次记录(会话中途 cd 到别处也不换);事件自己的 cwd 照实记 payload.cwd(spec K17)。
 *
 * 全部 async 并 await recordEvent —— 绝不 fire-and-forget。hook 进程短生命周期:
 * 打开 DB → INSERT → 退出,通常约 5ms。
 */

import { runHook } from './hook-runner';
import { extractHookPayload, type HookPayload } from './payload';
import { classifyAutoMessage } from './auto-message';
import { resolveProjectRoot } from '../directory';
import { hookNotice, repairHookSnippets } from '../git-hooks';
import { cleanupSessionRegistrations } from '../session-registry';
import { summarizeToolResponse } from './post-tool-summary';
import { sanitizeToolArgs } from './tool-args';
import { WRITE_TOOLS_WHITELIST } from './constants';
import { readCurrentTurnId, writeCurrentTurn, removeTurnState } from './turn-state';
import type { TimelineEventInput } from './types';
import { DEFAULT_AGENT_ID, requireAgentProfile, type AgentId } from '../agents';
import { hasTaskSessionStartHook, skillVersionNotice } from '../skill-version';
import { randomUUID } from 'node:crypto';
import * as path from 'node:path';

export { gitCommitHook, readGitCommitInfo, type GitCommitInfo, type GitDiffStats } from './git-commit';

/**
 * 工具事件的 metadata:tool_use_id、子 agent 归属(只写入,读取方不展示)。
 * 没有任何键时返回 undefined,与不带 metadata 的旧行为一致。
 */
function toolEventMetadata(payload: HookPayload): Record<string, unknown> | undefined {
  const meta: Record<string, unknown> = {};
  if (payload.tool_use_id !== undefined) meta.tool_use_id = payload.tool_use_id;
  if (payload.agent_id !== undefined) {
    meta.subagent = { id: payload.agent_id, type: payload.agent_type ?? null };
  }
  return Object.keys(meta).length > 0 ? meta : undefined;
}

/** 宿主测量的耗时写入事件,并标明来源;宿主没给返回 false(交给估算)。 */
function applyHostDuration(event: TimelineEventInput, payload: HookPayload): boolean {
  if (payload.duration_ms === undefined) return false;
  event.duration_ms = Math.round(payload.duration_ms);
  event.metadata = { ...(event.metadata ?? {}), duration_source: 'host' };
  return true;
}

export async function userPromptHook(agent: AgentId = DEFAULT_AGENT_ID): Promise<void> {
  await runHook((payload, { root }) => {
    if (payload.prompt === undefined) return null;
    // B-1:每轮一个 turn_id。宿主给了就原样沿用(往后的 Claude Code 可能会带),没给就新生成 UUID v4;
    // 都写进本会话的轮次记录,这一轮里后面的 pre / post / stop hook 读回去。
    const turn_id = payload.turn_id ?? randomUUID();
    // 轮次记录按会话的根写:会话 cd 进子目录、到附加目录里干活,都落在同一个数据位置(spec D6、D7)。
    writeCurrentTurn(root, {
      turn_id,
      session_id: payload.session_id ?? null,
    });
    // 后台任务通知 / 子 agent 交回也经这里进来:照旧开新一轮(写 turn 状态),
    // 只是不再记成用户提问,来源写进 metadata.source(spec 2026-10-31)。
    const autoSource = classifyAutoMessage(payload.prompt);
    return {
      event_type: autoSource !== null ? 'auto_message' : 'user_prompt',
      session_id: payload.session_id ?? null,
      prompt_text: payload.prompt,
      turn_id,
      cwd: payload.cwd,
      agent,
      metadata: autoSource !== null ? { source: autoSource } : undefined,
    } satisfies TimelineEventInput;
  }, { agent });
}

export async function preToolUseHook(agent: AgentId = DEFAULT_AGENT_ID): Promise<void> {
  await runHook(async (payload, { root }) => {
    if (!payload.tool_name) return null;
    // B-2 精简 pre 事件:只有写类工具(Edit / Write / MultiEdit / NotebookEdit / Bash)记 pre_tool_use。
    // 只读工具(Read / Grep / TaskUpdate 等)的 pre 没有信息量,有 post 就够;去掉它们,事件量少约三成。
    if (!WRITE_TOOLS_WHITELIST.has(payload.tool_name)) return null;
    // 轮次记录按会话的根读,与 user_prompt hook 写入侧一致。
    const turn_id = await readCurrentTurnId(payload.session_id ?? null, root);
    return {
      event_type: 'pre_tool_use',
      session_id: payload.session_id ?? null,
      tool_name: payload.tool_name,
      tool_args: sanitizeToolArgs(payload.tool_name, payload.tool_input),
      turn_id,
      cwd: payload.cwd,
      agent,
      metadata: toolEventMetadata(payload),
    } satisfies TimelineEventInput;
  }, { agent });
}

export async function postToolUseHook(agent: AgentId = DEFAULT_AGENT_ID): Promise<void> {
  await runHook(async (payload, { root }) => {
    if (!payload.tool_name) return null;
    const summary = summarizeToolResponse(payload.tool_name, payload.tool_response, payload.tool_input);
    // 轮次记录按会话的根读,与 user_prompt hook 写入侧一致。
    const turn_id = await readCurrentTurnId(payload.session_id ?? null, root);
    const event: TimelineEventInput = {
      event_type: 'post_tool_use',
      session_id: payload.session_id ?? null,
      tool_name: payload.tool_name,
      tool_args: sanitizeToolArgs(payload.tool_name, payload.tool_input),
      tool_result_summary: summary,
      turn_id,
      cwd: payload.cwd,
      agent,
      metadata: toolEventMetadata(payload),
    };
    applyHostDuration(event, payload);
    return event;
  }, {
    agent,
    // Enricher runs inside recordEvent before insert. Computes duration_ms
    // = post.ts - pre.ts for write-tool post events by looking up the
    // most-recent pre_tool_use with matching (turn_id, tool_name, session_id).
    // No-op (returns void) for read tools or when turn_id is null — post
    // event still records, duration_ms stays null/undefined.
    //
    // Inner try/catch is belt-and-suspenders: a faulty lookup degrades to
    // "post still recorded, duration_ms null" rather than blocking the hook
    // or losing the event. Same pattern as stopHook's enricher below.
    // 宿主已给耗时(duration_ms 已写入)时不再估算;估算出值时标明来源。
    enricher: (store, event) => {
      if (event.duration_ms !== undefined) return;
      const toolName = event.tool_name;
      if (!toolName) return;
      if (!WRITE_TOOLS_WHITELIST.has(toolName)) return;
      if (!event.turn_id) return;
      try {
        const recentPre = store.getMostRecentPre({
          turn_id: event.turn_id,
          tool_name: toolName,
          session_id: event.session_id ?? null,
        });
        if (!recentPre) return;
        const postTs = new Date(event.ts ?? new Date().toISOString()).getTime();
        const preTs = new Date(recentPre.ts).getTime();
        const delta = postTs - preTs;
        // Math.max guards against clock-skew / bad ts ordering producing
        // negative durations; we'd rather record 0 than a misleading negative.
        event.duration_ms = Math.max(0, delta);
        event.metadata = { ...(event.metadata ?? {}), duration_source: 'estimated' };
      } catch (err) {
        process.stderr.write(`[timeline] duration enrich failed: ${err instanceof Error ? err.message : String(err)}\n`);
      }
    },
  });
}

/**
 * 工具失败(Claude Code 的 PostToolUseFailure):记为 post_tool_use + success:false。
 * 失败 payload 不带 tool_response;耗时只取宿主给的值,不估算。
 * CodeBuddy 没有该事件(失败走 PostToolUse 并带 is_error),由安装器按能力开关不接入。
 */
export async function postToolUseFailureHook(agent: AgentId = DEFAULT_AGENT_ID): Promise<void> {
  await runHook(async (payload, { root }) => {
    if (!payload.tool_name) return null;
    const turn_id = await readCurrentTurnId(payload.session_id ?? null, root);
    const event: TimelineEventInput = {
      event_type: 'post_tool_use',
      session_id: payload.session_id ?? null,
      tool_name: payload.tool_name,
      tool_args: sanitizeToolArgs(payload.tool_name, payload.tool_input),
      tool_result_summary: summarizeToolResponse(payload.tool_name, undefined, payload.tool_input, {
        error: payload.error,
        isInterrupt: payload.is_interrupt,
      }),
      turn_id,
      cwd: payload.cwd,
      agent,
      metadata: toolEventMetadata(payload),
    };
    applyHostDuration(event, payload);
    return event;
  }, { agent });
}

export async function stopHook(agent: AgentId = DEFAULT_AGENT_ID): Promise<void> {
  await runHook(async (payload, { root }) => {
    // 轮次记录按会话的根读,与 user_prompt hook 写入侧一致。
    const turn_id = await readCurrentTurnId(payload.session_id ?? null, root);
    return {
      event_type: 'stop',
      session_id: payload.session_id ?? null,
      turn_id,
      cwd: payload.cwd,
      agent,
      // If Claude Code surfaces token usage in the payload later, capture it here.
      metadata: payload.stop_hook_active !== undefined
        ? { stop_hook_active: payload.stop_hook_active }
        : undefined,
    } satisfies TimelineEventInput;
  }, {
    agent,
    // B-6: enrich the stop event with a session summary — total event count,
    // duration (first event → last user_prompt), and a 200-char preview of the
    // last user_prompt. This is the "session recap" surfaced at stop time.
    //
    // No-op when session_id is null (we can't attribute events to a session)
    // — the stop event still records with whatever metadata it already had.
    // The inner try/catch is belt-and-suspenders: runHook also catches, so a
    // thrown getSessionStats degrades to "stop recorded, summary fields
    // absent" rather than blocking the hook.
    enricher: (store, event) => {
      if (event.event_type !== 'stop' || !event.session_id) return;
      try {
        const stats = store.getSessionStats(event.session_id);
        event.metadata = {
          ...(event.metadata ?? {}),
          // +1 to count the stop event itself — the enricher runs BEFORE
          // store.insert, so getSessionStats's COUNT(*) doesn't see this stop
          // row yet. The surfaced count is "events in the session including
          // this stop", which is what a reader of the stop event expects.
          session_event_count: stats.event_count + 1,
          session_duration_ms: stats.duration_ms,
          session_last_prompt_preview: stats.last_user_prompt?.slice(0, 200) ?? null,
        };
      } catch (err) {
        process.stderr.write(`[timeline] stop enrich failed: ${err instanceof Error ? err.message : String(err)}\n`);
      }
    },
  });
}

/**
 * 会话开始(SessionStart):记录 session_start 事件,turn_id 恒为 null。
 * 宿主给出字符串 `source`(startup / resume / clear / compact 等)时写入 metadata.source。
 *
 * 会话的根按开始的目录(payload.cwd)认,写进会话登记(已在就沿用:resume、compact 是同一个会话 id),
 * 同一会话之后的 hook 都按登记记(spec D6);记完顺手删掉 7 天没改过的登记。
 *
 * 该 agent 的 settings 里没接 task 会话开始 hook(只接了 timeline hook 的早期项目)时,
 * 项目 skill 版本落后的提示由这里单独输出一段(skill版本落后提示 spec D6);接了 task hook 时
 * 提示跟会话 id 走 task hook。按登记补装 git 钩子片段补不上时,原因也由这里输出(spec D33⑥);
 * 两段合成一条 additionalContext,都没有时 stdout 为空。这两段照旧按 payload.cwd 找,事件记不记都输出。
 */
export async function sessionStartHook(agent: AgentId = DEFAULT_AGENT_ID): Promise<void> {
  // runHook 不提供写库后回调;读到 payload 时记下 cwd 与 source,runHook 返回后再检查版本。
  let started = null as { cwd: string | undefined; source: string | undefined } | null;
  await runHook((payload) => ({
    event_type: 'session_start',
    session_id: payload.session_id ?? null,
    turn_id: null,
    cwd: payload.cwd,
    agent,
    metadata: payload.source !== undefined ? { source: payload.source } : undefined,
  } satisfies TimelineEventInput), {
    agent,
    sessionStart: true,
    onPayload: (payload) => {
      started = { cwd: payload.cwd, source: payload.source };
    },
  });
  if (started) {
    cleanupSessionRegistrations();
    const { cwd, source } = started;
    const notices = [skillVersionNoticeWithoutTaskHook(agent, cwd, source), ...repairGitHookSnippets(cwd)];
    const text = notices.filter((n): n is string => n !== null).join('\n\n');
    if (text !== '') {
      process.stdout.write(
        JSON.stringify({ hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext: text } }) + '\n',
      );
    }
  }
}

/**
 * spec D33⑥:会话开始时按登记补回缺了的 git 钩子片段(husky 9 每次装依赖都重写 `.husky/_/`、新开的
 * worktree、被别的工具覆盖)。补不上的(登记已由基础层删掉)返回给人看的原因,只说这一次;不在 git
 * 仓库、没有登记或任何异常都返回 [],不影响会话。
 */
function repairGitHookSnippets(cwd: string | undefined): string[] {
  try {
    return repairHookSnippets(cwd ?? process.cwd())
      .map((r) => hookNotice(r, path.basename(r.hookPath) === 'commit-msg' ? '版本分支提交拦截没补上' : '提交记录片段没补上'))
      .filter((n): n is string => n !== null)
      .map((n) => `[cgraphx] ${n}`);
  } catch {
    // 补装失败只等下次会话或 cgraphx install 再补
    return [];
  }
}

/** 没接 task 会话开始 hook 时的版本落后提示;settings 读不出、无需提示或任何异常都 → null。 */
function skillVersionNoticeWithoutTaskHook(agent: AgentId, cwd: string | undefined, source: string | undefined): string | null {
  try {
    const profile = requireAgentProfile(agent);
    const projectRoot = resolveProjectRoot(cwd ?? process.cwd());
    if (hasTaskSessionStartHook(projectRoot, profile) !== false) return null;
    return skillVersionNotice(projectRoot, profile, source);
  } catch (err) {
    process.stderr.write(`[timeline] skill version notice failed: ${err instanceof Error ? err.message : String(err)}\n`);
    return null;
  }
}

/**
 * 会话结束(SessionEnd):记录 session_end 事件(metadata.reason 规则同 source),
 * 事件写入后删除本会话的 turn 状态文件(按会话的根找)。会话登记不删:同时触发的 task、sync hook
 * 还要读,7 天后由会话开始 hook 清理。开关关闭、无 payload,或这一条不记(认不出会话的根)时
 * runHook 不调 buildEvent,此时也不碰 turn 文件。
 */
export async function sessionEndHook(agent: AgentId = DEFAULT_AGENT_ID): Promise<void> {
  // runHook 不提供写库后回调;buildEvent 被调用时记下待清理的会话,runHook 返回后再删。
  let ended = null as { root: string; session_id: string | null } | null;
  await runHook((payload, { root }) => {
    const session_id = payload.session_id ?? null;
    ended = { root, session_id };
    return {
      event_type: 'session_end',
      session_id,
      turn_id: null,
      cwd: payload.cwd,
      agent,
      metadata: payload.reason !== undefined ? { reason: payload.reason } : undefined,
    } satisfies TimelineEventInput;
  }, { agent });
  if (ended) {
    const { root, session_id } = ended;
    removeTurnState(root, session_id);
  }
}

// Re-export for cli.ts so the dispatcher has a single import surface.
export { extractHookPayload };
