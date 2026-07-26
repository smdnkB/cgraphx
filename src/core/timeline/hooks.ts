/**
 * Five hook handlers (spec §3).
 *
 * Each is a thin function that maps a Claude Code payload to a TimelineEventInput
 * and calls runHook. They're called by the hidden CLI subcommands in cli.ts
 * (e.g. `cgraphx timeline-pre-tool-use-hook`).
 *
 * These are async + await recordEvent — never fire-and-forget. Per spec §4.4,
 * hook processes are short-lived: open DB, INSERT, exit. ~5ms typical.
 */

import { runHook } from './hook-runner';
import { extractHookPayload } from './payload';
import { summarizeToolResponse } from './post-tool-summary';
import { WRITE_TOOLS_WHITELIST } from './constants';
import type { TimelineEventInput } from './types';
import { randomUUID } from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';

/**
 * Per-turn state file used to hand the current turn_id from the user_prompt
 * hook (which generates it) to the pre/post/stop hooks in the SAME turn.
 *
 * Each Claude Code hook is a separate short-lived process — there's no shared
 * memory — so we use a single JSON file under `.cgraphx/`. Write is a single
 * `fs.writeFileSync(..., {flag:'w'})` (atomic-ish: a small complete overwrite,
 * no locks needed). Reads tolerate a missing / corrupt file (return null,
 * which makes the duration_ms enricher a no-op — graceful degradation, never
 * blocks the hook).
 */
const TURN_STATE_FILENAME = 'timeline-current-turn.json';

function turnStateFilePath(projectRoot: string): string {
  return path.join(projectRoot, '.cgraphx', TURN_STATE_FILENAME);
}

/**
 * Read the current turn_id for a given session from the per-turn state file.
 *
 * Returns null if the file is absent, the JSON is corrupt, or the stored
 * session_id does not match `session_id` (cross-session isolation — two
 * parallel Claude Code sessions on the same project must not share a turn id).
 *
 * `projectRoot` defaults to process.cwd() (Claude Code launches hooks with
 * cwd = project root); callers may pass an explicit root (e.g. payload.cwd)
 * to be precise.
 */
async function readCurrentTurnId(
  session_id: string | null,
  projectRoot: string = process.cwd(),
): Promise<string | null> {
  try {
    const content = await fs.promises.readFile(turnStateFilePath(projectRoot), 'utf8');
    const data = JSON.parse(content) as {
      turn_id?: string;
      session_id?: string | null;
      ts?: string;
    };
    // Cross-session isolation: if the caller pins a session and the file's
    // session differs, the stored turn belongs to a different conversation —
    // do not propagate it. A null session_id caller accepts any stored turn.
    if (session_id !== null && data.session_id !== session_id) return null;
    return data.turn_id ?? null;
  } catch {
    // File missing / unreadable / JSON.parse threw — silent null. The
    // duration_ms enricher no-ops on null turn_id, so this degrades cleanly.
    return null;
  }
}

/**
 * Persist the current turn_id to the per-turn state file (B-1).
 *
 * Writes the whole file each call ({flag:'w'} truncates). Failures are
 * swallowed and reported to stderr — a missing turn file only disables
 * duration_ms computation, it must never block the hook (spec §4.5).
 */
function writeCurrentTurn(
  projectRoot: string,
  turn: { turn_id: string; session_id: string | null; ts?: string },
): void {
  const payload = {
    turn_id: turn.turn_id,
    session_id: turn.session_id,
    ts: turn.ts ?? new Date().toISOString(),
  };
  try {
    const filePath = turnStateFilePath(projectRoot);
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, JSON.stringify(payload), { flag: 'w' });
  } catch (err) {
    // Never throw — recording the user_prompt still matters more than the
    // turn file. Subsequent pre/post hooks will read null (no duration_ms),
    // which is a tolerable degradation.
    const msg = err instanceof Error ? err.message : String(err);
    process.stderr.write(`[timeline] turn-state write failed: ${msg}\n`);
  }
}

export async function userPromptHook(): Promise<void> {
  await runHook((payload) => {
    if (payload.prompt === undefined) return null;
    // B-1: generate a per-turn id. Honor a host-supplied turn_id if present
    // (forward-compat — a future Claude Code may send one); otherwise mint a
    // fresh UUID v4. Either way, persist it to the per-turn state file so the
    // downstream pre/post/stop hooks in this turn can read it back.
    const turn_id = payload.turn_id ?? randomUUID();
    const projectRoot = payload.cwd ?? process.cwd();
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
    } satisfies TimelineEventInput;
  });
}

export async function preToolUseHook(): Promise<void> {
  await runHook(async (payload) => {
    if (!payload.tool_name) return null;
    // B-2 pre-event reduction: only write-tools (Edit/Write/MultiEdit/
    // NotebookEdit/Bash) record pre_tool_use. Read-only tool pre events
    // (Read/Grep/TaskUpdate/etc.) carry no signal — their post event is
    // sufficient — and dropping them cuts ~30% of event volume.
    if (!WRITE_TOOLS_WHITELIST.has(payload.tool_name)) return null;
    const turn_id = await readCurrentTurnId(payload.session_id ?? null, payload.cwd ?? process.cwd());
    return {
      event_type: 'pre_tool_use',
      session_id: payload.session_id ?? null,
      tool_name: payload.tool_name,
      tool_args: payload.tool_input,
      turn_id,
      cwd: payload.cwd,
    } satisfies TimelineEventInput;
  });
}

export async function postToolUseHook(): Promise<void> {
  await runHook(async (payload) => {
    if (!payload.tool_name) return null;
    const summary = summarizeToolResponse(payload.tool_name, payload.tool_response, payload.tool_input);
    const turn_id = await readCurrentTurnId(payload.session_id ?? null, payload.cwd ?? process.cwd());
    return {
      event_type: 'post_tool_use',
      session_id: payload.session_id ?? null,
      tool_name: payload.tool_name,
      tool_args: payload.tool_input,
      tool_result_summary: summary,
      turn_id,
      cwd: payload.cwd,
    } satisfies TimelineEventInput;
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
    enricher: (store, event) => {
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
      } catch (err) {
        process.stderr.write(`[timeline] duration enrich failed: ${err instanceof Error ? err.message : String(err)}\n`);
      }
    },
  });
}

export async function stopHook(): Promise<void> {
  await runHook(async (payload) => {
    const turn_id = await readCurrentTurnId(
      payload.session_id ?? null,
      payload.cwd ?? process.cwd(),
    );
    return {
      event_type: 'stop',
      session_id: payload.session_id ?? null,
      turn_id,
      cwd: payload.cwd,
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
 * Git post-commit hook — reads no stdin; pulls commit info from `git` CLI.
 *
 * Spec §3.3. Invoked from a `.git/hooks/post-commit` script that backgrounds
 * us (`&`), so we're allowed to take longer than the Claude Code hooks.
 */
export async function gitCommitHook(): Promise<void> {
  if (isKillSwitchOn()) return;

  const info = readGitCommitInfo();
  if (!info) return;

  try {
    const { recordEvent } = await import('./recorder');
    await recordEvent(info.cwd, {
      event_type: 'git_commit',
      commit_hash: info.hash,
      commit_message: info.message,
      commit_files: info.files,
      commit_insertions: info.insertions,
      commit_deletions: info.deletions,
      cwd: info.cwd,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    process.stderr.write(`[timeline] git-commit record failed: ${msg}\n`);
  }
}

// Imported here (not at module top) to avoid a circular import: hook-runner
// imports recorder which imports store which imports nothing — fine, but
// keeping the import inline matches the lazy pattern used for git.
import { isKillSwitchOn } from './hook-runner';
import { execSync } from 'node:child_process';

// Exported for direct unit testing (otherwise it's only reachable through the
// `gitCommitHook` side-effect path, which is awkward to drive from a test).
export interface GitCommitInfo {
  hash: string;
  message: string;
  files: string[];
  cwd: string;
  insertions: number;
  deletions: number;
}

/**
 * Read HEAD commit info + aggregated insertions/deletions.
 *
 * numstat parsing: `git show --numstat --format= HEAD` emits one line per
 * changed file as `<ins>\t<del>\t<path>`. Binary files show literal `-` in
 * the ins/del columns — we skip those (no numeric contribution). The result
 * is aggregated across ALL files in the commit.
 *
 * If numstat fails (rare: shallow clone, broken repo, git too old), we still
 * return the rest of the info with insertions/deletions = 0 — numstat is an
 * enhancement, not a gate.
 */
export function readGitCommitInfo(): GitCommitInfo | null {
  try {
    const cwd = execSync('git rev-parse --show-toplevel', { encoding: 'utf8', stdio: ['pipe', 'pipe', 'ignore'] }).trim();
    const hash = execSync('git rev-parse HEAD', { encoding: 'utf8', stdio: ['pipe', 'pipe', 'ignore'] }).trim();
    const message = execSync('git log -1 --pretty=%B HEAD', { encoding: 'utf8', stdio: ['pipe', 'pipe', 'ignore'] }).trim();
    const filesOut = execSync('git diff-tree --no-commit-id --name-only -r HEAD', { encoding: 'utf8', stdio: ['pipe', 'pipe', 'ignore'] });
    const files = filesOut.split('\n').map(s => s.trim()).filter(Boolean);

    // Aggregate insertions/deletions from numstat. Run with cwd=parsed repo
    // root so the command works even when the hook is launched from elsewhere.
    let insertions = 0;
    let deletions = 0;
    try {
      const numstatOut = execSync('git show --numstat --format= HEAD', {
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
        // Binary file: git emits literal "-" — skip, contributes no count.
        if (ins === '-' || del === '-') continue;
        const insNum = parseInt(ins!, 10);
        const delNum = parseInt(del!, 10);
        if (!Number.isNaN(insNum)) insertions += insNum;
        if (!Number.isNaN(delNum)) deletions += delNum;
      }
    } catch {
      // numstat unavailable — keep 0/0, don't block the rest of the record.
    }

    return { hash, message, files, cwd, insertions, deletions };
  } catch {
    return null;
  }
}

// Re-export for cli.ts so the dispatcher has a single import surface.
export { extractHookPayload };
