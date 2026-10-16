/**
 * 七个 hook 处理函数:6 个 Claude Code hook(user_prompt / pre_tool_use /
 * post_tool_use / stop / session_start / session_end)+ git post-commit 的 gitCommitHook。
 *
 * 每个函数把 Claude Code 的 payload 映射成 TimelineEventInput 并交给 runHook,
 * 由 cli.ts 中的隐藏子命令调起(如 `cgraphx timeline-pre-tool-use-hook`)。
 *
 * 全部 async 并 await recordEvent —— 绝不 fire-and-forget。hook 进程短生命周期:
 * 打开 DB → INSERT → 退出,通常约 5ms。
 */

import { runHook, isKillSwitchOn } from './hook-runner';
import { extractHookPayload, type HookPayload } from './payload';
import { resolveProjectRoot } from '../directory';
import { summarizeToolResponse } from './post-tool-summary';
import { sanitizeToolArgs } from './tool-args';
import { COMMIT_BRANCH_ENV, COMMIT_SHA_ENV, WRITE_TOOLS_WHITELIST } from './constants';
import { readCurrentTurnId, writeCurrentTurn, removeTurnState } from './turn-state';
import type { TimelineEventInput } from './types';
import { DEFAULT_AGENT_ID, resolveSessionIdFromEnv, type AgentId } from '../agents';
import { randomUUID } from 'node:crypto';
import { execSync } from 'node:child_process';

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
  await runHook((payload) => {
    if (payload.prompt === undefined) return null;
    // B-1: generate a per-turn id. Honor a host-supplied turn_id if present
    // (forward-compat — a future Claude Code may send one); otherwise mint a
    // fresh UUID v4. Either way, persist it to the per-turn state file so the
    // downstream pre/post/stop hooks in this turn can read it back.
    const turn_id = payload.turn_id ?? randomUUID();
    // 项目根向上回溯:cwd 漂移进子目录时 turn 文件仍落在根上(spec 2026-08-13)。
    const projectRoot = resolveProjectRoot(payload.cwd ?? process.cwd());
    writeCurrentTurn(projectRoot, {
      turn_id,
      session_id: payload.session_id ?? null,
    });
    return {
      event_type: 'user_prompt',
      session_id: payload.session_id ?? null,
      prompt_text: payload.prompt,
      turn_id,
      cwd: payload.cwd,
      agent,
    } satisfies TimelineEventInput;
  });
}

export async function preToolUseHook(agent: AgentId = DEFAULT_AGENT_ID): Promise<void> {
  await runHook(async (payload) => {
    if (!payload.tool_name) return null;
    // B-2 pre-event reduction: only write-tools (Edit/Write/MultiEdit/
    // NotebookEdit/Bash) record pre_tool_use. Read-only tool pre events
    // (Read/Grep/TaskUpdate/etc.) carry no signal — their post event is
    // sufficient — and dropping them cuts ~30% of event volume.
    if (!WRITE_TOOLS_WHITELIST.has(payload.tool_name)) return null;
    // 项目根向上回溯(spec 2026-08-13),与 user_prompt hook 写入侧一致。
    const turn_id = await readCurrentTurnId(
      payload.session_id ?? null,
      resolveProjectRoot(payload.cwd ?? process.cwd()),
    );
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
  });
}

export async function postToolUseHook(agent: AgentId = DEFAULT_AGENT_ID): Promise<void> {
  await runHook(async (payload) => {
    if (!payload.tool_name) return null;
    const summary = summarizeToolResponse(payload.tool_name, payload.tool_response, payload.tool_input);
    // 项目根向上回溯(spec 2026-08-13),与 user_prompt hook 写入侧一致。
    const turn_id = await readCurrentTurnId(
      payload.session_id ?? null,
      resolveProjectRoot(payload.cwd ?? process.cwd()),
    );
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
  await runHook(async (payload) => {
    if (!payload.tool_name) return null;
    const turn_id = await readCurrentTurnId(
      payload.session_id ?? null,
      resolveProjectRoot(payload.cwd ?? process.cwd()),
    );
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
  });
}

export async function stopHook(agent: AgentId = DEFAULT_AGENT_ID): Promise<void> {
  await runHook(async (payload) => {
    const turn_id = await readCurrentTurnId(
      payload.session_id ?? null,
      // 项目根向上回溯(spec 2026-08-13),与 user_prompt hook 写入侧一致。
      resolveProjectRoot(payload.cwd ?? process.cwd()),
    );
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
 */
export async function sessionStartHook(agent: AgentId = DEFAULT_AGENT_ID): Promise<void> {
  await runHook((payload) => ({
    event_type: 'session_start',
    session_id: payload.session_id ?? null,
    turn_id: null,
    cwd: payload.cwd,
    agent,
    metadata: payload.source !== undefined ? { source: payload.source } : undefined,
  } satisfies TimelineEventInput));
}

/**
 * 会话结束(SessionEnd):记录 session_end 事件(metadata.reason 规则同 source),
 * 事件写入后删除本会话的 turn 状态文件。开关关闭或无 payload 时 runHook 不调
 * buildEvent,此时也不碰 turn 文件。
 */
export async function sessionEndHook(agent: AgentId = DEFAULT_AGENT_ID): Promise<void> {
  // runHook 不提供写库后回调;buildEvent 被调用时记下待清理的会话,runHook 返回后再删。
  let ended = null as { projectRoot: string; session_id: string | null } | null;
  await runHook((payload) => {
    const session_id = payload.session_id ?? null;
    ended = { projectRoot: resolveProjectRoot(payload.cwd ?? process.cwd()), session_id };
    return {
      event_type: 'session_end',
      session_id,
      turn_id: null,
      cwd: payload.cwd,
      agent,
      metadata: payload.reason !== undefined ? { reason: payload.reason } : undefined,
    } satisfies TimelineEventInput;
  });
  if (ended) {
    const { projectRoot, session_id } = ended;
    removeTurnState(projectRoot, session_id);
  }
}

/**
 * git post-commit hook —— 不读 stdin,从 `git` CLI 取提交信息。
 *
 * 由 `.git/hooks/post-commit` 片段后台调起(`&`),耗时可以比 Claude Code hook 宽松。
 * 会话 id 与来源 agent 经 agents 门面从会话环境变量解析:agent 在会话内通过 Bash
 * 提交时子进程继承该变量;终端手动提交时没有,两者均记为 null(未归属)。
 */
export async function gitCommitHook(): Promise<void> {
  if (isKillSwitchOn()) return;

  // 钩子在提交当下固定的 hash / 分支(旧版钩子脚本不传 → 退回读 HEAD 与当前分支)
  const info = readGitCommitInfo({
    hash: process.env[COMMIT_SHA_ENV],
    branch: process.env[COMMIT_BRANCH_ENV],
  });
  if (!info) return;

  // 归属会话与来源 agent 取自会话环境变量;终端手动提交时两者均为 null。
  const fromEnv = resolveSessionIdFromEnv();
  const session_id = fromEnv?.sessionId ?? null;
  const agent = fromEnv?.agent ?? null;

  try {
    const { recordEvent } = await import('./recorder');
    // info.cwd 是 git 仓库根;项目可能初始化在其子目录,向上回溯找真根
    // (spec 2026-08-13)。事件自身的 cwd 字段仍记录真实 git 根。
    await recordEvent(resolveProjectRoot(info.cwd), {
      event_type: 'git_commit',
      session_id,
      agent,
      commit_hash: info.hash,
      commit_message: info.message,
      commit_files: info.files,
      commit_insertions: info.insertions,
      commit_deletions: info.deletions,
      cwd: info.cwd,
      metadata: info.branch !== null ? { branch: info.branch } : undefined,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    process.stderr.write(`[timeline] git-commit record failed: ${msg}\n`);
  }
}

// 导出以便单测直接驱动(否则只能经 gitCommitHook 的副作用路径触达)。
export interface GitCommitInfo {
  hash: string;
  message: string;
  files: string[];
  cwd: string;
  insertions: number;
  deletions: number;
  /** 当前分支名;detached HEAD(输出为 `HEAD`)或命令失败时为 null。 */
  branch: string | null;
}

/** 只接受十六进制提交 hash:它会拼进 git 命令行,其它内容一律退回 HEAD。 */
const COMMIT_HASH_PATTERN = /^[0-9a-f]{7,64}$/i;

/**
 * 读取一个提交的信息 + 汇总增删行数 + 分支名。
 *
 * `pinned.hash` 合法时读该提交,否则读 HEAD;`pinned.branch` 有定义时直接采用
 * (空串 = detached HEAD → null),未定义时读当前分支。钩子在提交当下固定这两项,
 * 避免后台进程启动后 HEAD 已前移(连续提交只记到最后一个)。
 *
 * numstat:`git show --numstat --format= HEAD` 每个文件一行 `<ins>\t<del>\t<path>`,
 * 二进制文件两列为字面量 `-`,跳过不计。numstat 或分支读取失败(浅克隆、仓库损坏、
 * git 过旧)不影响其它字段:行数记 0/0,分支记 null —— 它们是增强项,不是闸门。
 */
export function readGitCommitInfo(pinned: { hash?: string; branch?: string } = {}): GitCommitInfo | null {
  const ref = pinned.hash !== undefined && COMMIT_HASH_PATTERN.test(pinned.hash) ? pinned.hash : 'HEAD';
  try {
    const cwd = execSync('git rev-parse --show-toplevel', { encoding: 'utf8', stdio: ['pipe', 'pipe', 'ignore'] }).trim();
    const hash = execSync(`git rev-parse --verify ${ref}^{commit}`, { encoding: 'utf8', stdio: ['pipe', 'pipe', 'ignore'] }).trim();
    const message = execSync(`git log -1 --pretty=%B ${ref}`, { encoding: 'utf8', stdio: ['pipe', 'pipe', 'ignore'] }).trim();
    const filesOut = execSync(`git diff-tree --no-commit-id --name-only -r ${ref}`, { encoding: 'utf8', stdio: ['pipe', 'pipe', 'ignore'] });
    const files = filesOut.split('\n').map(s => s.trim()).filter(Boolean);

    // 以仓库根为 cwd 跑 numstat,hook 从别处启动也能正确执行。
    let insertions = 0;
    let deletions = 0;
    try {
      const numstatOut = execSync(`git show --numstat --format= ${ref}`, {
        encoding: 'utf8',
        stdio: ['pipe', 'pipe', 'ignore'],
        cwd,
      });
      for (const line of numstatOut.split('\n')) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        const parts = trimmed.split('\t');
        if (parts.length < 3) continue;
        const [ins, del] = parts;
        // 二进制文件:git 输出字面量 "-",跳过不计。
        if (ins === '-' || del === '-') continue;
        const insNum = parseInt(ins!, 10);
        const delNum = parseInt(del!, 10);
        if (!Number.isNaN(insNum)) insertions += insNum;
        if (!Number.isNaN(delNum)) deletions += delNum;
      }
    } catch {
      // numstat 不可用 —— 保持 0/0,不阻塞其余字段。
    }

    let branch: string | null = null;
    if (pinned.branch !== undefined) {
      branch = pinned.branch !== '' ? pinned.branch : null;
    } else {
      try {
        const out = execSync('git rev-parse --abbrev-ref HEAD', {
          encoding: 'utf8',
          stdio: ['pipe', 'pipe', 'ignore'],
          cwd,
        }).trim();
        branch = out && out !== 'HEAD' ? out : null;
      } catch {
        // 分支读取失败 —— 记 null。
      }
    }

    return { hash, message, files, cwd, insertions, deletions, branch };
  } catch {
    return null;
  }
}

// Re-export for cli.ts so the dispatcher has a single import surface.
export { extractHookPayload };
