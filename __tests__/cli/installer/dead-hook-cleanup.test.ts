/**
 * Dead-hook cleanup — the Claude target's install/uninstall must strip hook
 * entries that point at removed subcommands:
 *
 *   - `cgraphx prompt-hook` — the 2.0-removed front-load hook. Early-2.0
 *     installers offered it as an opt-in, but the subcommand was cut with
 *     the 1.x graph layer (running it is `error: unknown command`), so a
 *     leftover entry errors on every prompt submission.
 *   - the pre-0.8 `codegraph mark-dirty` / `sync-if-dirty` auto-sync pair.
 *   - the five platform-sync / dev-task subcommands cut in 2.0.14
 *     (`sync-session-start-hook`, `sync-stop-hook`,
 *     `task-session-start-hook`, `task-stop-hook`,
 *     `task-post-tool-use-hook`). Matched by full subcommand name — with or
 *     without `--agent <id>` / the tolerant suffix — never by the
 *     `cgraphx sync-` / `cgraphx task-` prefix (future commands with the
 *     same prefix must survive). Removing any of the five surfaces the
 *     one-line note `平台同步、开发任务已下掉:已移除 hooks(<events /-joined>)`
 *     via `WriteResult.notes`; removing only the 1.x trio does not.
 *
 * Sibling (user-owned) hooks under the same events must survive. The
 * settings.json writes key off `process.cwd()`, so each test chdirs into a
 * scratch dir (vitest isolates test files per worker, so this is safe).
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';

import { claudeTarget } from '../../../src/cli/installer/targets/claude';

const PROMPT_HOOK = 'cgraphx prompt-hook';
const LEGACY_SYNC = 'codegraph sync-if-dirty';
const USER_HOOK = 'node /home/me/my-own-hook.js';

// Cut in 2.0.14 (platform sync + dev task). Old configs wrote them with
// `--agent <id>` and/or the tolerant suffix; early entries have neither.
const SYNC_STOP = 'cgraphx sync-stop-hook --agent codebuddy 2>/dev/null || true';
const SYNC_SESSION_START = 'cgraphx sync-session-start-hook --agent codebuddy 2>/dev/null || true';
const TASK_SESSION_START = 'cgraphx task-session-start-hook';
const TASK_STOP = 'cgraphx task-stop-hook --agent codebuddy 2>/dev/null || true';
const TASK_POST_TOOL_USE = 'cgraphx task-post-tool-use-hook';
// Live subcommand sharing the `-hook` suffix family — must survive.
const TIMELINE_STOP = 'cgraphx timeline-stop-hook';

let dir: string;
let prevCwd: string;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cg-deadhooks-'));
  prevCwd = process.cwd();
  process.chdir(dir);
});

afterEach(() => {
  process.chdir(prevCwd);
  fs.rmSync(dir, { recursive: true, force: true });
});

function settingsPath(): string {
  return path.join(dir, '.claude', 'settings.json');
}

function seedSettings(hooks: Record<string, unknown>): void {
  fs.mkdirSync(path.join(dir, '.claude'), { recursive: true });
  fs.writeFileSync(settingsPath(), JSON.stringify({ hooks }, null, 2));
}

function settingsDump(): string {
  return fs.readFileSync(settingsPath(), 'utf8');
}

describe('install: dead-hook self-heal', () => {
  it('strips the dangling prompt-hook and legacy auto-sync entries, keeps user hooks, writes cgraphx hooks', () => {
    seedSettings({
      UserPromptSubmit: [
        { hooks: [{ type: 'command', command: PROMPT_HOOK }] },
        { hooks: [{ type: 'command', command: USER_HOOK }] },
      ],
      Stop: [
        { hooks: [{ type: 'command', command: LEGACY_SYNC }] },
      ],
    });

    claudeTarget.install('local', {});

    const out = settingsDump();
    expect(out).not.toContain(PROMPT_HOOK);
    expect(out).not.toContain(LEGACY_SYNC);
    expect(out).toContain(USER_HOOK);
    // the live cgraphx entries are in place
    expect(out).toContain('context-monitor');
    expect(out).toContain('precommit-check');
  });

  it('a fresh install never writes the prompt-hook entry', () => {
    claudeTarget.install('local', {});
    const out = settingsDump();
    expect(out).not.toContain(PROMPT_HOOK);
    expect(out).toContain('context-monitor');
    expect(out).toContain('precommit-check');
  });

  it('second install is idempotent (settings.json bytes unchanged)', () => {
    seedSettings({
      UserPromptSubmit: [
        { hooks: [{ type: 'command', command: PROMPT_HOOK }] },
      ],
    });
    claudeTarget.install('local', {});
    const first = settingsDump();
    claudeTarget.install('local', {});
    expect(settingsDump()).toBe(first);
  });
});

describe('install/uninstall: removed platform-sync & dev-task hooks', () => {
  it('strips the five cut subcommands (--agent / tolerant suffix / bare), keeps timeline hooks and user hooks', () => {
    seedSettings({
      SessionStart: [
        { hooks: [{ type: 'command', command: SYNC_SESSION_START }] },
        { hooks: [{ type: 'command', command: TASK_SESSION_START }] },
        { hooks: [{ type: 'command', command: TIMELINE_STOP }] },
      ],
      Stop: [
        { hooks: [{ type: 'command', command: SYNC_STOP }] },
        { hooks: [{ type: 'command', command: TASK_STOP }] },
        { hooks: [{ type: 'command', command: USER_HOOK }] },
      ],
      PreToolUse: [
        { hooks: [{ type: 'command', command: TASK_POST_TOOL_USE }] },
      ],
    });

    claudeTarget.install('local', {});

    const out = settingsDump();
    expect(out).not.toContain('sync-session-start-hook');
    expect(out).not.toContain('sync-stop-hook');
    expect(out).not.toContain('task-session-start-hook');
    expect(out).not.toContain('task-post-tool-use-hook');
    expect(out).not.toContain('cgraphx task-stop-hook');
    // full-subcommand-name matching: the live timeline hook (same `-hook`
    // suffix family, shares `stop-hook` with the cut task one) survives
    expect(out).toContain('cgraphx timeline-stop-hook');
    expect(out).toContain(USER_HOOK);
  });

  it('install surfaces the one-line note with the deduped removed events', () => {
    seedSettings({
      SessionStart: [
        { hooks: [{ type: 'command', command: SYNC_SESSION_START }] },
        { hooks: [{ type: 'command', command: TASK_SESSION_START }] },
      ],
      Stop: [
        { hooks: [{ type: 'command', command: SYNC_STOP }] },
      ],
    });

    const result = claudeTarget.install('local', {});
    expect(result.notes).toContain('平台同步、开发任务已下掉:已移除 hooks(SessionStart/Stop)');
  });

  it('removing only the 1.x dead hooks surfaces no note', () => {
    seedSettings({
      UserPromptSubmit: [
        { hooks: [{ type: 'command', command: PROMPT_HOOK }] },
      ],
      Stop: [
        { hooks: [{ type: 'command', command: LEGACY_SYNC }] },
      ],
    });

    const result = claudeTarget.install('local', {});
    expect((result.notes ?? []).some((n) => n.includes('平台同步、开发任务已下掉'))).toBe(false);
  });
});

describe('uninstall: dead-hook sweep', () => {
  it('removes dangling prompt-hook leftovers, preserves sibling user hooks', () => {
    seedSettings({
      UserPromptSubmit: [
        { hooks: [{ type: 'command', command: PROMPT_HOOK }] },
        { hooks: [{ type: 'command', command: USER_HOOK }] },
      ],
    });

    claudeTarget.uninstall('local');

    const out = settingsDump();
    expect(out).not.toContain(PROMPT_HOOK);
    expect(out).toContain(USER_HOOK);
  });

  it('removes the five cut subcommands and returns the note (timeline hook kept)', () => {
    seedSettings({
      SessionStart: [
        { hooks: [{ type: 'command', command: SYNC_SESSION_START }] },
        { hooks: [{ type: 'command', command: TIMELINE_STOP }] },
      ],
    });

    const result = claudeTarget.uninstall('local');

    const out = settingsDump();
    expect(out).not.toContain('sync-session-start-hook');
    expect(out).toContain('cgraphx timeline-stop-hook');
    expect(result.notes).toContain('平台同步、开发任务已下掉:已移除 hooks(SessionStart)');
  });
});
