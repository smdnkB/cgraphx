/**
 * Dead-hook cleanup — the Claude target's install/uninstall must strip hook
 * entries that point at removed subcommands:
 *
 *   - `cgraphx prompt-hook` — the 2.0-removed front-load hook. Early-2.0
 *     installers offered it as an opt-in, but the subcommand was cut with
 *     the 1.x graph layer (running it is `error: unknown command`), so a
 *     leftover entry errors on every prompt submission.
 *   - the pre-0.8 `codegraph mark-dirty` / `sync-if-dirty` auto-sync pair.
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
});
