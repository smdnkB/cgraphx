/**
 * Claude Code target. Writes (2.0 — no server config):
 *
 *   - `hooks.UserPromptSubmit` (context-monitor) — appends a hook that
 *     runs the bundled `context-monitor.cjs` asset.
 *   - `hooks.PreToolUse` (precommit-check on Bash) — guards `git commit`.
 *   - `hooks.UserPromptSubmit` (front-load prompt hook) — runs
 *     `cgraphx prompt-hook`; opt-in via the installer prompt.
 *   - `statusLine` — points at the bundled `claude-hud` asset.
 *   - `.claude/` template (skills / agents / commands / hooks / plugins)
 *     deployed into the project's `.claude/` directory (local scope only).
 *
 * 2.0 cut points (versus 1.x): the server-entry write, the
 * server-scoped permissions write, and the CGRAPHX instructions block
 * write are GONE — there is no server in 2.0. The 1.x marker-fenced
 * block in CLAUDE.md is still stripped on uninstall (and on install as
 * self-heal) so upgrades don't leave stale pointers to a server that
 * no longer exists.
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import {
  AgentTarget,
  DetectionResult,
  InstallOptions,
  Location,
  WriteResult,
} from './types';
import {
  readJsonFile,
  writeJsonFile,
  removeMarkedSection,
} from './shared';
import { deployClaudeAssets } from '../claude-assets';

function configDir(loc: Location): string {
  return loc === 'global'
    ? path.join(os.homedir(), '.claude')
    : path.join(process.cwd(), '.claude');
}
function settingsJsonPath(loc: Location): string {
  return path.join(configDir(loc), 'settings.json');
}

/**
 * Markers used by the (removed) CGRAPHX instructions block. Kept as
 * private constants so uninstall / self-heal can strip a stale 1.x
 * block from CLAUDE.md without us having to keep the block content
 * (which advertized the removed server) in the source tree.
 */
const CGRAPHX_SECTION_START = '<!-- CGRAPHX_START -->';
const CGRAPHX_SECTION_END = '<!-- CGRAPHX_END -->';
function instructionsPath(loc: Location): string {
  return path.join(configDir(loc), 'CLAUDE.md');
}

class ClaudeCodeTarget implements AgentTarget {
  readonly id = 'claude' as const;
  readonly displayName = 'Claude Code';
  readonly docsUrl = 'https://docs.claude.com/en/docs/claude-code';

  supportsLocation(_loc: Location): boolean {
    return true;
  }

  detect(loc: Location): DetectionResult {
    const settingsPath = settingsJsonPath(loc);
    const settings = readJsonFile(settingsPath);
    // "Already configured" in 2.0 = any of our markers is present in
    // settings.json (a hook command we own, or our statusLine). Reads
    // only — never writes.
    const alreadyConfigured = settingsHasCgraphxMarker(settings);
    // "Installed" heuristic: ~/.claude (global) or ./.claude (local)
    // exists. Cheap, no shell-out.
    const installed = fs.existsSync(configDir(loc));
    return { installed, alreadyConfigured, configPath: settingsPath };
  }

  install(loc: Location, opts: InstallOptions): WriteResult {
    const files: WriteResult['files'] = [];
    const notes: string[] = [];

    // 1. hooks.UserPromptSubmit (context-monitor) + statusLine (claude-hud).
    //    Core to the cgraphx UX; always merges into the existing settings.json.
    //    A user's other hooks and a pre-existing non-cgraphx statusLine are
    //    preserved.
    const hookResult = writeHooksAndStatusLineEntry(loc);
    files.push(hookResult.file);
    if (hookResult.notes && hookResult.notes.length > 0) {
      notes.push(...hookResult.notes);
    }

    // 2. hooks.PreToolUse (precommit-check on Bash). Not gated — always
    //    merges in.
    files.push(writePrecommitHookEntry(loc));

    // 3. Strip stale auto-sync hooks left by a pre-0.8 install
    //    (`codegraph mark-dirty` / `sync-if-dirty`). Both subcommands are
    //    gone from the CLI; cleaning up on install makes an upgrade
    //    self-healing. Only surfaced when something was actually removed.
    const hookCleanup = cleanupLegacyHooks(loc);
    if (hookCleanup.action === 'removed') files.push(hookCleanup);

    // 4. Front-load prompt hook (`cgraphx prompt-hook`). Opt-in via the
    //    installer prompt: `promptHook === true` writes it; `=== false`
    //    strips any prior install so opting out round-trips; `undefined`
    //    leaves it untouched.
    if (opts.promptHook === true) {
      files.push(writePromptHookEntry(loc));
    } else if (opts.promptHook === false) {
      const removed = removePromptHookEntry(loc);
      if (removed.action === 'removed') files.push(removed);
    }

    // 5. Self-heal: strip any stale 1.x CGRAPHX instructions block from
    //    CLAUDE.md. The block advertized a server that no longer exists.
    const instructionsHeal = removeInstructionsEntry(loc);
    if (instructionsHeal.action === 'removed') files.push(instructionsHeal);

    // 6. Deploy the bundled `.claude/` template (skills / agents / commands
    //    / hooks / plugins) into the project's `.claude/` directory. Local
    //    only — global installs don't seed a per-project workspace. Existing
    //    files are overwritten (skills are tools maintained by cgraphx, not
    //    user-owned). The template itself lives in `dist/.claude-template/`
    //    (populated by copy-assets).
    if (loc === 'local') {
      const targetClaudeDir = configDir(loc);
      const assetChanges = deployClaudeAssets(targetClaudeDir);
      for (const change of assetChanges) {
        if (change.action === 'not-found') continue; // no template baked in
        files.push(change);
      }
    }

    return notes.length > 0 ? { files, notes } : { files };
  }

  uninstall(loc: Location): WriteResult {
    const files: WriteResult['files'] = [];

    // 1. Strip our hook commands (context-monitor / precommit-check /
    //    prompt-hook) from settings.json. Surgical: only our commands are
    //    dropped; sibling hooks survive. The statusLine is removed only when
    //    it points at claude-hud.
    files.push(removeCgraphxSettings(loc));

    // 2. Strip stale auto-sync hooks a pre-0.8 install left (same helper
    //    install uses for self-heal).
    const hookCleanup = cleanupLegacyHooks(loc);
    if (hookCleanup.action === 'removed') files.push(hookCleanup);

    // 3. Strip the 1.x CGRAPHX instructions block if present.
    files.push(removeInstructionsEntry(loc));

    return { files };
  }

  describePaths(loc: Location): string[] {
    return [settingsJsonPath(loc), instructionsPath(loc)];
  }
}

/**
 * settings.json shape subset we care about. Loose on purpose — we only
 * traverse well-known arrays / objects and ignore everything else.
 */
interface SettingsJson {
  hooks?: Record<string, Array<{ matcher?: string; hooks?: Array<{ type?: string; command?: string; timeout?: number }> }>>;
  statusLine?: { type?: string; command?: string } | null;
  [k: string]: unknown;
}

/**
 * True when settings.json carries any of our hook commands OR our
 * statusLine. Used by `detect().alreadyConfigured` so the orchestrator
 * (and `cgraphx upgrade`'s self-heal) can tell a fresh install apart
 * from an already-configured one without referencing the removed
 * server-entry config.
 */
function settingsHasCgraphxMarker(settings: SettingsJson): boolean {
  const hooks = settings.hooks;
  if (hooks && typeof hooks === 'object' && !Array.isArray(hooks)) {
    for (const event of Object.keys(hooks)) {
      const groups = hooks[event];
      if (!Array.isArray(groups)) continue;
      for (const group of groups) {
        const inner = group?.hooks;
        if (!Array.isArray(inner)) continue;
        for (const h of inner) {
          const cmd = h?.command;
          if (typeof cmd === 'string' && isCgraphxHookCommand(cmd)) return true;
        }
      }
    }
  }
  const sl = settings.statusLine;
  if (sl && typeof sl === 'object' && typeof sl.command === 'string' && sl.command.includes('claude-hud')) {
    return true;
  }
  return false;
}

/**
 * Commands cgraphx owns in Claude `settings.json`. Used for detection
 * AND for surgical uninstall (drop only these; preserve sibling user
 * hooks). The context-monitor / precommit-check / prompt-hook commands
 * are the install-time writes; the legacy `codegraph mark-dirty` /
 * `sync-if-dirty` strings recognize hooks a pre-0.8 install wrote.
 */
function isCgraphxHookCommand(command: string): boolean {
  return (
    command.includes(CONTEXT_MONITOR_COMMAND) ||
    command.includes(PRECOMMIT_CHECK_COMMAND) ||
    command.includes(PROMPT_HOOK_COMMAND) ||
    command.includes('codegraph mark-dirty') ||
    command.includes('codegraph sync-if-dirty')
  );
}

/**
 * Remove every cgraphx-owned hook command from settings.json (all
 * events), drop the claude-hud statusLine if it's ours, and prune
 * emptied groups / events / `hooks` / `statusLine` keys. Sibling user
 * hooks (different commands in the same group, or different events
 * entirely) and a non-cgraphx statusLine are preserved verbatim.
 *
 * Reports `removed` when at least one command or the statusLine was
 * dropped, `not-found` when settings.json had nothing of ours, `kept`
 * when the file didn't exist.
 */
function removeCgraphxSettings(loc: Location): WriteResult['files'][number] {
  const file = settingsJsonPath(loc);
  if (!fs.existsSync(file)) return { path: file, action: 'kept' };

  const settings = readJsonFile(file) as SettingsJson;
  let changed = false;

  const hooks = settings.hooks;
  if (hooks && typeof hooks === 'object' && !Array.isArray(hooks)) {
    for (const event of Object.keys(hooks)) {
      const groups = hooks[event];
      if (!Array.isArray(groups)) continue;
      for (const group of groups) {
        const inner = group?.hooks;
        if (!Array.isArray(inner)) continue;
        const before = inner.length;
        // Rebuild the array in place, dropping only our commands.
        const filtered = inner.filter(
          (h) => !(h && typeof h === 'object' && typeof h.command === 'string' && isCgraphxHookCommand(h.command)),
        );
        if (filtered.length !== before) {
          group.hooks = filtered;
          changed = true;
        }
      }
      // Prune emptied groups, then emptied events.
      hooks[event] = groups.filter(
        (g) => g && Array.isArray(g.hooks) && g.hooks.length > 0,
      );
      if (hooks[event].length === 0) delete hooks[event];
    }
    if (Object.keys(hooks).length === 0) {
      delete settings.hooks;
    } else {
      settings.hooks = hooks;
    }
  }

  const sl = settings.statusLine;
  if (sl && typeof sl === 'object' && typeof sl.command === 'string' && sl.command.includes('claude-hud')) {
    delete settings.statusLine;
    changed = true;
  }

  if (!changed) return { path: file, action: 'not-found' };

  writeJsonFile(file, settings);
  return { path: file, action: 'removed' };
}

/**
 * True when a Claude Code hook `command` is one of the auto-sync hooks
 * a pre-0.8 install wrote. Both subcommands were later removed from the
 * CLI, so a Stop hook left pointing at `sync-if-dirty` fails every turn.
 * Recognized by substring so an `npx @colbymchenry/codegraph …` form is
 * also caught.
 */
function isLegacyCodegraphHookCommand(command: unknown): boolean {
  if (typeof command !== 'string') return false;
  return (
    command.includes('codegraph mark-dirty') ||
    command.includes('codegraph sync-if-dirty')
  );
}

/**
 * Remove stale codegraph auto-sync hooks (`mark-dirty` / `sync-if-dirty`)
 * that a pre-0.8 install wrote. Reused by both `install` (an upgrade
 * self-heals) and `uninstall`.
 */
function cleanupLegacyHooks(loc: Location): WriteResult['files'][number] {
  const file = settingsJsonPath(loc);
  if (!fs.existsSync(file)) return { path: file, action: 'not-found' };

  const settings = readJsonFile(file) as SettingsJson;
  const hooks = settings.hooks;
  if (!hooks || typeof hooks !== 'object' || Array.isArray(hooks)) {
    return { path: file, action: 'unchanged' };
  }

  let removedAny = false;
  for (const event of Object.keys(hooks)) {
    const groups = hooks[event];
    if (!Array.isArray(groups)) continue;
    for (const group of groups) {
      if (!group || !Array.isArray(group.hooks)) continue;
      const before = group.hooks.length;
      group.hooks = group.hooks.filter((h) => !isLegacyCodegraphHookCommand((h as { command?: unknown })?.command));
      if (group.hooks.length !== before) removedAny = true;
    }
  }
  if (!removedAny) return { path: file, action: 'unchanged' };

  for (const event of Object.keys(hooks)) {
    const groups = hooks[event];
    if (!Array.isArray(groups)) continue;
    hooks[event] = groups.filter(
      (g) => !(g && Array.isArray(g.hooks) && g.hooks.length === 0),
    );
    if (hooks[event].length === 0) delete hooks[event];
  }
  if (Object.keys(hooks).length === 0) delete settings.hooks;

  writeJsonFile(file, settings);
  return { path: file, action: 'removed' };
}

const CONTEXT_MONITOR_COMMAND = 'node $CLAUDE_PROJECT_DIR/.claude/hooks/context-monitor/context-monitor.cjs';
const CLAUDE_HUD_COMMAND = 'node $CLAUDE_PROJECT_DIR/.claude/plugins/claude-hud/dist/index.js';
const PRECOMMIT_CHECK_COMMAND = 'node $CLAUDE_PROJECT_DIR/.claude/hooks/precommit-check/precommit-check.cjs';
const PROMPT_HOOK_COMMAND = 'cgraphx prompt-hook';

function isPromptHookCommand(command: unknown): boolean {
  return typeof command === 'string' && command.includes(PROMPT_HOOK_COMMAND);
}

/**
 * Append cgraphx's context-monitor entry to `hooks.UserPromptSubmit` and
 * point `statusLine` at claude-hud. Append-only / non-destructive: a
 * user's existing hooks under the same event are preserved verbatim, and
 * a non-cgraphx statusLine is left alone with a `notes` warning. The
 * cgraphx entries are deduped by their `command` string, so re-running
 * install is a no-op. All other settings.json keys (theme, model, …)
 * are preserved by the read-merge-write.
 */
export function writeHooksAndStatusLineEntry(loc: Location): {
  file: WriteResult['files'][number];
  notes?: string[];
} {
  const file = settingsJsonPath(loc);
  const settings = readJsonFile(file) as SettingsJson;
  const created = !fs.existsSync(file);
  const notes: string[] = [];
  let changed = false;

  if (!settings.hooks || typeof settings.hooks !== 'object') settings.hooks = {};
  if (!Array.isArray(settings.hooks.UserPromptSubmit)) settings.hooks.UserPromptSubmit = [];

  const alreadyHasContextMonitor = settings.hooks.UserPromptSubmit.some(
    (entry) => {
      if (!entry || typeof entry !== 'object') return false;
      const inner = entry.hooks;
      if (!Array.isArray(inner)) return false;
      return inner.some(
        (h) =>
          h && typeof h === 'object' &&
          (h as { command?: unknown }).command === CONTEXT_MONITOR_COMMAND,
      );
    },
  );

  if (!alreadyHasContextMonitor) {
    settings.hooks.UserPromptSubmit.push({
      hooks: [{
        type: 'command',
        command: CONTEXT_MONITOR_COMMAND,
        timeout: 5000,
      }],
    });
    changed = true;
  }

  const existing = settings.statusLine;
  if (existing && typeof existing === 'object') {
    const cmd = existing.command;
    const isOurs = typeof cmd === 'string' && cmd.includes('claude-hud');
    if (!isOurs) {
      notes.push(
        `statusLine already set to a non-cgraphx command ("${typeof cmd === 'string' ? cmd : '<unknown>'}"); not overwritten. To use claude-hud, set statusLine.command to "${CLAUDE_HUD_COMMAND}".`,
      );
    }
  } else {
    settings.statusLine = {
      type: 'command',
      command: CLAUDE_HUD_COMMAND,
    };
    changed = true;
  }

  if (!changed && !created) {
    return { file: { path: file, action: 'unchanged' }, notes };
  }

  writeJsonFile(file, settings);
  return {
    file: { path: file, action: created ? 'created' : 'updated' },
    notes,
  };
}

/**
 * Write the precommit-check `PreToolUse` hook into Claude `settings.json` —
 * a `command` hook on the `Bash` matcher that runs precommit-check.cjs.
 * Guard: when Claude calls `git commit` with a non-empty staged set, the
 * hook denies and points the agent at the project's
 * `docs/guides/git-standards.md` (commit message conventions + project-
 * specific pre-commit checkpoints, generated by init-project-guides). The
 * agent reads the guide, self-audits the staged diff against its
 * checkpoints, writes the message per its conventions, and retries with
 * `CGRAPHX_PRECOMMIT_REVIEWED=1 git commit ...`. Guide missing → the deny
 * reason suggests `/init-project-guides` (user may waive).
 *
 * Idempotent: deduped by the exact `command` string, so re-running install
 * is a no-op. Sibling hooks under PreToolUse are preserved.
 */
export function writePrecommitHookEntry(loc: Location): WriteResult['files'][number] {
  const file = settingsJsonPath(loc);
  const settings = readJsonFile(file) as SettingsJson;
  const created = !fs.existsSync(file);

  if (!settings.hooks || typeof settings.hooks !== 'object') settings.hooks = {};
  if (!Array.isArray(settings.hooks.PreToolUse)) settings.hooks.PreToolUse = [];

  const alreadyHas = settings.hooks.PreToolUse.some((entry) => {
    if (!entry || typeof entry !== 'object') return false;
    const inner = entry.hooks;
    if (!Array.isArray(inner)) return false;
    return inner.some(
      (h) =>
        h && typeof h === 'object' &&
        (h as { command?: unknown }).command === PRECOMMIT_CHECK_COMMAND,
    );
  });

  if (alreadyHas && !created) {
    return { path: file, action: 'unchanged' };
  }

  if (!alreadyHas) {
    settings.hooks.PreToolUse.push({
      matcher: 'Bash',
      hooks: [{
        type: 'command',
        command: PRECOMMIT_CHECK_COMMAND,
        timeout: 10000,
      }],
    });
  }

  writeJsonFile(file, settings);
  return { path: file, action: created ? 'created' : 'updated' };
}

/**
 * Write the front-load `UserPromptSubmit` hook into Claude `settings.json` —
 * a `command` hook that runs `cgraphx prompt-hook`. Idempotent: if our
 * command is already wired under UserPromptSubmit the file is left
 * byte-for-byte untouched and reported `unchanged`. Sibling hooks (the
 * user's own, or other events) are preserved. Opt-in — the installer only
 * calls this when the user accepts the prompt.
 *
 * Exported because `cgraphx upgrade` reaches in directly to self-heal the
 * hook on already-configured global Claude installs.
 */
export function writePromptHookEntry(loc: Location): WriteResult['files'][number] {
  const file = settingsJsonPath(loc);
  const created = !fs.existsSync(file);
  const settings = readJsonFile(file) as SettingsJson;

  if (!settings.hooks || typeof settings.hooks !== 'object' || Array.isArray(settings.hooks)) {
    settings.hooks = {};
  }
  if (!Array.isArray(settings.hooks.UserPromptSubmit)) settings.hooks.UserPromptSubmit = [];

  const already = settings.hooks.UserPromptSubmit.some(
    (g) => g && Array.isArray(g.hooks) && g.hooks.some((h) => isPromptHookCommand((h as { command?: unknown })?.command)),
  );
  if (already) return { path: file, action: 'unchanged' };

  settings.hooks.UserPromptSubmit.push({
    hooks: [{ type: 'command', command: PROMPT_HOOK_COMMAND }],
  });
  writeJsonFile(file, settings);
  return { path: file, action: created ? 'created' : 'updated' };
}

/**
 * Strip the front-load `UserPromptSubmit` hook this installer writes. Used
 * by `uninstall`, and by `install` when the user opts out, so the choice
 * round-trips.
 */
export function removePromptHookEntry(loc: Location): WriteResult['files'][number] {
  return removeHookCommandsMatching(loc, isPromptHookCommand);
}

/**
 * Drop hook commands matching `match` from every event in settings.json.
 * Surgical at the command level; prunes emptied groups / events / `hooks`.
 * Returns `unchanged` when nothing matched.
 */
function removeHookCommandsMatching(
  loc: Location,
  match: (command: unknown) => boolean,
): WriteResult['files'][number] {
  const file = settingsJsonPath(loc);
  if (!fs.existsSync(file)) return { path: file, action: 'not-found' };

  const settings = readJsonFile(file) as SettingsJson;
  const hooks = settings.hooks;
  if (!hooks || typeof hooks !== 'object' || Array.isArray(hooks)) {
    return { path: file, action: 'unchanged' };
  }

  let removedAny = false;
  for (const event of Object.keys(hooks)) {
    const groups = hooks[event];
    if (!Array.isArray(groups)) continue;
    for (const group of groups) {
      if (!group || !Array.isArray(group.hooks)) continue;
      const before = group.hooks.length;
      group.hooks = group.hooks.filter((h) => !match((h as { command?: unknown })?.command));
      if (group.hooks.length !== before) removedAny = true;
    }
  }

  if (!removedAny) return { path: file, action: 'unchanged' };

  for (const event of Object.keys(hooks)) {
    const groups = hooks[event];
    if (!Array.isArray(groups)) continue;
    hooks[event] = groups.filter(
      (g) => !(g && Array.isArray(g.hooks) && g.hooks.length === 0),
    );
    if (hooks[event].length === 0) delete hooks[event];
  }
  if (Object.keys(hooks).length === 0) delete settings.hooks;

  writeJsonFile(file, settings);
  return { path: file, action: 'removed' };
}

/**
 * Strip the marker-delimited CGRAPHX block from CLAUDE.md if a prior 1.x
 * install wrote one. The block advertized a server that no longer exists,
 * so install (self-heal on upgrade) and uninstall both call this.
 * `removeMarkedSection` returns `not-found`/`kept` when there's nothing
 * to strip; the install caller drops those from the report so a fresh
 * install stays quiet.
 */
function removeInstructionsEntry(loc: Location): WriteResult['files'][number] {
  const file = instructionsPath(loc);
  const action = removeMarkedSection(file, CGRAPHX_SECTION_START, CGRAPHX_SECTION_END);
  return { path: file, action };
}

export const claudeTarget: AgentTarget = new ClaudeCodeTarget();
