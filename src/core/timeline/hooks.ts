/**
 * 七个 hook 处理函数:6 个 Claude Code hook(user_prompt / pre_tool_use /
 * post_tool_use / stop / session_start / session_end)+ git post-commit、post-merge 共用的
 * gitCommitHook。
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
import { COMMIT_BRANCH_ENV, COMMIT_HOOK_ENV, COMMIT_SHA_ENV, WRITE_TOOLS_WHITELIST } from './constants';
import { readCurrentTurnId, writeCurrentTurn, removeTurnState } from './turn-state';
import type { TimelineEventInput } from './types';
import { DEFAULT_AGENT_ID, requireAgentProfile, resolveSessionIdFromEnv, type AgentId } from '../agents';
import { hasTaskSessionStartHook, skillVersionNotice } from '../skill-version';
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
 *
 * 该 agent 的 settings 里没接 task 会话开始 hook(只接了 timeline hook 的早期项目)时,
 * 项目 skill 版本落后的提示由这里单独输出一段(skill版本落后提示 spec D6);接了 task hook 时
 * 提示跟会话 id 走 task hook,这里 stdout 仍为空。
 */
export async function sessionStartHook(agent: AgentId = DEFAULT_AGENT_ID): Promise<void> {
  // runHook 不提供写库后回调;buildEvent 被调用时记下 cwd 与 source,runHook 返回后再检查版本。
  let started = null as { cwd: string | undefined; source: string | undefined } | null;
  await runHook((payload) => {
    started = { cwd: payload.cwd, source: payload.source };
    return {
      event_type: 'session_start',
      session_id: payload.session_id ?? null,
      turn_id: null,
      cwd: payload.cwd,
      agent,
      metadata: payload.source !== undefined ? { source: payload.source } : undefined,
    } satisfies TimelineEventInput;
  });
  if (started) {
    const { cwd, source } = started;
    writeSkillVersionNoticeWithoutTaskHook(agent, cwd, source);
  }
}

/** 没接 task 会话开始 hook 时输出版本落后提示;settings 读不出、无需提示或任何异常都不输出。 */
function writeSkillVersionNoticeWithoutTaskHook(agent: AgentId, cwd: string | undefined, source: string | undefined): void {
  try {
    const profile = requireAgentProfile(agent);
    const projectRoot = resolveProjectRoot(cwd ?? process.cwd());
    if (hasTaskSessionStartHook(projectRoot, profile) !== false) return;
    const notice = skillVersionNotice(projectRoot, profile, source);
    if (notice === null) return;
    process.stdout.write(
      JSON.stringify({ hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext: notice } }) + '\n',
    );
  } catch (err) {
    process.stderr.write(`[timeline] skill version notice failed: ${err instanceof Error ? err.message : String(err)}\n`);
  }
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
 * git post-commit / post-merge hook —— 不读 stdin,从 `git` CLI 取提交信息(spec D32)。
 *
 * 由钩子目录里 post-commit、post-merge 片段后台调起(`&`),耗时可以比 Claude Code hook 宽松。
 * - 合并提交(父提交 ≥ 2):文件列表为空、增删行记 0,相对第一父提交的统计记进 `metadata.merge`
 * - post-merge 调起(COMMIT_HOOK_ENV 为 post-merge)而提交只有一个父提交:快进,不产生新提交,不记
 * - 同一 commit_hash 已记过的不再记(去重在 recordEvent 里)
 *
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
  // post-merge 遇到只有一个父提交的提交 = 快进:不产生新提交,提交本身在当时已记过
  if (info.parents.length === 1 && process.env[COMMIT_HOOK_ENV] === 'post-merge') return;

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
      metadata: commitMetadata(info),
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    process.stderr.write(`[timeline] git-commit record failed: ${msg}\n`);
  }
}

/** git_commit 的 metadata:分支(读得到才带)+ 合并统计(合并提交才带);都没有 → undefined。 */
function commitMetadata(info: GitCommitInfo): Record<string, unknown> | undefined {
  const meta: Record<string, unknown> = {};
  if (info.branch !== null) meta.branch = info.branch;
  if (info.merge !== null) meta.merge = { parents: info.parents, ...info.merge };
  return Object.keys(meta).length > 0 ? meta : undefined;
}

/** numstat 汇总:files 含二进制文件,增删行数不计二进制文件。 */
export interface GitDiffStats {
  files: number;
  insertions: number;
  deletions: number;
}

// 导出以便单测直接驱动(否则只能经 gitCommitHook 的副作用路径触达)。
export interface GitCommitInfo {
  hash: string;
  message: string;
  /** 改动的文件;合并提交为空数组(统计见 merge)。 */
  files: string[];
  cwd: string;
  /** 增删行数;合并提交为 0(统计见 merge)。 */
  insertions: number;
  deletions: number;
  /** 当前分支名;detached HEAD(输出为 `HEAD`)或命令失败时为 null。 */
  branch: string | null;
  /** 父提交 hash,第一父提交在前;根提交为空数组。 */
  parents: string[];
  /** 合并提交(父提交 ≥ 2)相对第一父提交的改动统计;其余为 null。 */
  merge: GitDiffStats | null;
}

/** 只接受十六进制提交 hash:它会拼进 git 命令行,其它内容一律退回 HEAD。 */
const COMMIT_HASH_PATTERN = /^[0-9a-f]{7,64}$/i;

/** 在 cwd 下跑一条 git 命令(不给 cwd 即当前目录),返回 stdout;失败照常抛出。 */
function runGit(args: string, cwd?: string): string {
  return execSync(`git ${args}`, { encoding: 'utf8', stdio: ['pipe', 'pipe', 'ignore'], cwd });
}

/**
 * 读取一个提交的信息 + 父提交 + 汇总增删行数 + 分支名。
 *
 * `pinned.hash` 合法时读该提交,否则读 HEAD;`pinned.branch` 有定义时直接采用
 * (空串 = detached HEAD → null),未定义时读当前分支。钩子在提交当下固定这两项,
 * 避免后台进程启动后 HEAD 已前移(连续提交只记到最后一个)。
 *
 * 父提交取 `git rev-list --parents -n 1`,读不出整条返回 null(分不清是不是合并提交)。
 * 合并提交上 `git diff-tree` 输出为空,文件与行数改取 `git diff --numstat <第一父提交> <hash>`,
 * 记进 merge;files 记空数组、增删行记 0。
 *
 * numstat 每个文件一行 `<ins>\t<del>\t<path>`,二进制文件两列为字面量 `-`,不计行数。
 * numstat 或分支读取失败(浅克隆、仓库损坏、git 过旧)不影响其它字段:行数记 0/0,
 * 分支记 null —— 它们是增强项,不是闸门。
 */
export function readGitCommitInfo(pinned: { hash?: string; branch?: string } = {}): GitCommitInfo | null {
  const ref = pinned.hash !== undefined && COMMIT_HASH_PATTERN.test(pinned.hash) ? pinned.hash : 'HEAD';
  try {
    const cwd = runGit('rev-parse --show-toplevel').trim();
    const hash = runGit(`rev-parse --verify ${ref}^{commit}`).trim();
    const message = runGit(`log -1 --pretty=%B ${ref}`).trim();
    // 以仓库根为 cwd 跑后面的命令,hook 从别处启动也能正确执行。
    const parents = readParents(hash, cwd);
    const branch = readBranch(pinned.branch, cwd);

    const firstParent = parents[0];
    if (parents.length >= 2 && firstParent !== undefined) {
      const merge = readNumstat(`diff --numstat ${firstParent} ${hash}`, cwd);
      return { hash, message, files: [], cwd, insertions: 0, deletions: 0, branch, parents, merge };
    }

    const files = runGit(`diff-tree --no-commit-id --name-only -r ${ref}`, cwd)
      .split('\n').map(s => s.trim()).filter(Boolean);
    const { insertions, deletions } = readNumstat(`show --numstat --format= ${ref}`, cwd);
    return { hash, message, files, cwd, insertions, deletions, branch, parents, merge: null };
  } catch {
    return null;
  }
}

/** `git rev-list --parents -n 1 <hash>` 输出 `<hash> <父1> <父2> …`,取父提交部分;失败照常抛出。 */
function readParents(hash: string, cwd: string): string[] {
  return runGit(`rev-list --parents -n 1 ${hash}`, cwd).trim().split(/\s+/).slice(1).filter(Boolean);
}

/** 当前分支:`pinned` 有定义时直接采用(空串 → null);否则读 HEAD 的分支名,失败或 detached → null。 */
function readBranch(pinned: string | undefined, cwd: string): string | null {
  if (pinned !== undefined) return pinned !== '' ? pinned : null;
  try {
    const out = runGit('rev-parse --abbrev-ref HEAD', cwd).trim();
    return out && out !== 'HEAD' ? out : null;
  } catch {
    // 分支读取失败 —— 记 null。
    return null;
  }
}

/** 跑一条输出 numstat 的 git 命令并汇总;命令失败 —— 记 0,不阻塞其余字段。 */
function readNumstat(args: string, cwd: string): GitDiffStats {
  try {
    return sumNumstat(runGit(args, cwd));
  } catch {
    return { files: 0, insertions: 0, deletions: 0 };
  }
}

/** 汇总 numstat 输出:每行一个文件。 */
function sumNumstat(out: string): GitDiffStats {
  const stats: GitDiffStats = { files: 0, insertions: 0, deletions: 0 };
  for (const line of out.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const parts = trimmed.split('\t');
    if (parts.length < 3) continue;
    stats.files++;
    const [ins, del] = parts;
    // 二进制文件:git 输出字面量 "-",计入文件数、不计行数。
    if (ins === '-' || del === '-') continue;
    const insNum = parseInt(ins!, 10);
    const delNum = parseInt(del!, 10);
    if (!Number.isNaN(insNum)) stats.insertions += insNum;
    if (!Number.isNaN(delNum)) stats.deletions += delNum;
  }
  return stats;
}

// Re-export for cli.ts so the dispatcher has a single import surface.
export { extractHookPayload };
