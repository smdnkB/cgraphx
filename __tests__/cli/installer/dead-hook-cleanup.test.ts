/**
 * Dead-hook cleanup — the Claude target's install/uninstall must strip hook
 * entries that point at removed subcommands / deprecated scripts:
 *
 *   - `cgraphx prompt-hook` — the 2.0-removed front-load hook. Early-2.0
 *     installers offered it as an opt-in, but the subcommand was cut with
 *     the 1.x graph layer (running it is `error: unknown command`), so a
 *     leftover entry errors on every prompt submission.
 *   - the pre-0.8 `codegraph mark-dirty` / `sync-if-dirty` auto-sync pair.
 *   - the five platform-sync / dev-task subcommands cut in 2.0.14
 *     (`sync-session-start-hook`, `sync-stop-hook`,
 *     `task-session-start-hook`, `task-stop-hook`,
 *     `task-post-tool-use-hook`) and the seven timeline subcommands retired
 *     in 2.0.15 (`timeline-{session-start,session-end,user-prompt,
 *     pre-tool-use,post-tool-use,stop,post-tool-use-failure}-hook`; the
 *     session events moved to session-file parsing) plus the deprecated
 *     `precommit-check.cjs` script entry (the gate moved to a git commit-msg
 *     hook). All matched by full subcommand name / script path — with or
 *     without `--agent <id>` / the tolerant suffix — never by the
 *     `cgraphx sync-` / `cgraphx task-` / `cgraphx timeline-` prefix (future
 *     commands with the same prefix must survive; `timeline-git-commit-hook`
 *     is still live and would, if seeded). Removing any of the five surfaces
 *     the one-line note `平台同步、开发任务已下掉:已移除 hooks(<events
 *     /-joined>)`; removing any of the timeline/precommit batch surfaces
 *     `时间线和提交门禁改走会话文件和 git 钩子:已移除 hooks(<events>)`;
 *     both via `WriteResult.notes`. Removing only the 1.x trio surfaces
 *     neither.
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
// Retired in 2.0.15 (timeline collection moved to session-file parsing); the
// git-commit recording subcommand is still live and must survive.
const TIMELINE_STOP = 'cgraphx timeline-stop-hook';
const TIMELINE_USER_PROMPT = 'cgraphx timeline-user-prompt-hook --agent codebuddy 2>/dev/null || true';
const TIMELINE_SESSION_END = 'cgraphx timeline-session-end-hook';
const TIMELINE_POST_FAILURE = 'cgraphx timeline-post-tool-use-failure-hook --agent codebuddy 2>/dev/null || true';
const GIT_COMMIT_HOOK = 'cgraphx timeline-git-commit-hook';
// The precommit-check script entry is deprecated (gate moved to git commit-msg).
const PRECOMMIT_CHECK = 'node $CLAUDE_PROJECT_DIR/.claude/hooks/precommit-check/precommit-check.cjs';

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
  it('strips the dangling prompt-hook, legacy auto-sync and precommit-check entries, keeps user hooks, writes cgraphx hooks', () => {
    seedSettings({
      UserPromptSubmit: [
        { hooks: [{ type: 'command', command: PROMPT_HOOK }] },
        { hooks: [{ type: 'command', command: USER_HOOK }] },
      ],
      Stop: [
        { hooks: [{ type: 'command', command: LEGACY_SYNC }] },
      ],
      PreToolUse: [
        { matcher: 'Bash', hooks: [{ type: 'command', command: PRECOMMIT_CHECK }] },
      ],
    });

    const result = claudeTarget.install('local', {});

    const out = settingsDump();
    expect(out).not.toContain(PROMPT_HOOK);
    expect(out).not.toContain(LEGACY_SYNC);
    expect(out).not.toContain('precommit-check');
    expect(out).toContain(USER_HOOK);
    // the live cgraphx entries are in place
    expect(out).toContain('context-monitor');
    // the deprecated precommit-check entry surfaces the timeline/gate note
    expect(result.notes).toContain('时间线和提交门禁改走会话文件和 git 钩子:已移除 hooks(PreToolUse)');
  });

  it('a fresh install never writes the prompt-hook or precommit-check entry', () => {
    claudeTarget.install('local', {});
    const out = settingsDump();
    expect(out).not.toContain(PROMPT_HOOK);
    expect(out).not.toContain('precommit-check');
    expect(out).toContain('context-monitor');
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
  it('strips the five cut subcommands (--agent / tolerant suffix / bare), keeps user hooks', () => {
    seedSettings({
      SessionStart: [
        { hooks: [{ type: 'command', command: SYNC_SESSION_START }] },
        { hooks: [{ type: 'command', command: TASK_SESSION_START }] },
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
    // 只删了 sync/task 那批:不出时间线/门禁那条 note
    expect((result.notes ?? []).some((n) => n.includes('时间线和提交门禁'))).toBe(false);
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
    expect((result.notes ?? []).some((n) => n.includes('时间线和提交门禁'))).toBe(false);
  });
});

describe('install/uninstall: retired timeline hooks & precommit-check', () => {
  it('strips the seven timeline subcommands and the precommit-check script entry, keeps the live git-commit subcommand and user hooks', () => {
    seedSettings({
      SessionEnd: [
        { hooks: [{ type: 'command', command: TIMELINE_SESSION_END }] },
      ],
      UserPromptSubmit: [
        { hooks: [{ type: 'command', command: TIMELINE_USER_PROMPT }] },
      ],
      Stop: [
        { hooks: [{ type: 'command', command: TIMELINE_STOP }] },
        { hooks: [{ type: 'command', command: USER_HOOK }] },
      ],
      PostToolUseFailure: [
        { hooks: [{ type: 'command', command: TIMELINE_POST_FAILURE }] },
      ],
      PreToolUse: [
        { matcher: 'Bash', hooks: [{ type: 'command', command: PRECOMMIT_CHECK }] },
      ],
      // 还在的子命令(被 git 钩子调起,不经 agent 配置;种进去只为验证完整子命令名匹配不误删)
      PostCommit: [
        { hooks: [{ type: 'command', command: GIT_COMMIT_HOOK }] },
      ],
    });

    const result = claudeTarget.install('local', {});

    const out = settingsDump();
    expect(out).not.toContain('timeline-user-prompt-hook');
    expect(out).not.toContain('timeline-stop-hook');
    expect(out).not.toContain('timeline-session-end-hook');
    expect(out).not.toContain('timeline-post-tool-use-failure-hook');
    expect(out).not.toContain('precommit-check');
    // 完整子命令名匹配:还活着的 timeline-git-commit-hook(git 钩子调起)不被误删
    expect(out).toContain(GIT_COMMIT_HOOK);
    expect(out).toContain(USER_HOOK);
    expect(result.notes).toContain(
      '时间线和提交门禁改走会话文件和 git 钩子:已移除 hooks(SessionEnd/UserPromptSubmit/Stop/PostToolUseFailure/PreToolUse)',
    );
  });

  it('uninstall sweeps the timeline batch too and returns the note', () => {
    seedSettings({
      SessionEnd: [
        { hooks: [{ type: 'command', command: TIMELINE_SESSION_END }] },
        { hooks: [{ type: 'command', command: TIMELINE_USER_PROMPT }] },
      ],
    });

    const result = claudeTarget.uninstall('local');

    const out = settingsDump();
    expect(out).not.toContain('timeline-session-end-hook');
    expect(out).not.toContain('timeline-user-prompt-hook');
    expect(result.notes).toContain('时间线和提交门禁改走会话文件和 git 钩子:已移除 hooks(SessionEnd)');
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

  it('removes the five cut subcommands and returns the note', () => {
    seedSettings({
      SessionStart: [
        { hooks: [{ type: 'command', command: SYNC_SESSION_START }] },
      ],
    });

    const result = claudeTarget.uninstall('local');

    const out = settingsDump();
    expect(out).not.toContain('sync-session-start-hook');
    expect(result.notes).toContain('平台同步、开发任务已下掉:已移除 hooks(SessionStart)');
  });
});
