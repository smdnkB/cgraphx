/**
 * Tests for the project-local installer — spec §9.1 #14 #15.
 *
 * Verifies idempotency, full reversibility, and that unrelated user hooks
 * are left intact.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { execSync } from 'node:child_process';

import { installTimelineHooks, uninstallTimelineHooks } from '../../../src/core/timeline/installer';
import { DatabaseConnection } from '../../../src/core/db';
import { createDirectory } from '../../../src/core/directory';
import { ensureTimelineSchema } from '../../../src/core/timeline/schema-bootstrap';

function makeTmpProject(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cg-tl-inst-'));
  execSync('git init -q', { cwd: dir });
  return dir;
}

function readSettings(projectRoot: string): Record<string, unknown> {
  const p = path.join(projectRoot, '.claude', 'settings.json');
  if (!fs.existsSync(p)) return {};
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

function readGitHook(projectRoot: string): string {
  const p = path.join(projectRoot, '.git', 'hooks', 'post-commit');
  if (!fs.existsSync(p)) return '';
  return fs.readFileSync(p, 'utf8');
}

describe('installTimelineHooks', () => {
  let project: string;

  beforeEach(() => { project = makeTmpProject(); });
  afterEach(() => { fs.rmSync(project, { recursive: true, force: true }); });

  it('writes 6 hook events into .claude/settings.json', () => {
    const report = installTimelineHooks(project);
    expect(report.writtenHookEvents).toEqual(
      expect.arrayContaining(['UserPromptSubmit', 'PreToolUse', 'PostToolUse', 'Stop', 'SessionStart', 'SessionEnd']),
    );
    const settings = readSettings(project);
    const hooks = settings.hooks as Record<string, unknown>;
    expect(Object.keys(hooks)).toEqual(
      expect.arrayContaining(['UserPromptSubmit', 'PreToolUse', 'PostToolUse', 'Stop', 'SessionStart', 'SessionEnd']),
    );
  });

  it('writes git post-commit hook', () => {
    installTimelineHooks(project);
    const hook = readGitHook(project);
    expect(hook).toContain('timeline-git-commit-hook');
    expect(hook).toContain('cgraphx-timeline-hook');
  });

  it('is idempotent — running twice results in single hook per event', () => {
    installTimelineHooks(project);
    const second = installTimelineHooks(project);
    expect(second.writtenHookEvents).toEqual([]);
    expect(second.skipped).toEqual(
      expect.arrayContaining(['UserPromptSubmit', 'PreToolUse', 'PostToolUse', 'Stop', 'SessionStart', 'SessionEnd']),
    );

    const settings = readSettings(project);
    const hooks = settings.hooks as Record<string, Array<{ hooks: Array<{ command: string }> }>>;
    for (const event of ['UserPromptSubmit', 'PreToolUse', 'PostToolUse', 'Stop', 'SessionStart', 'SessionEnd']) {
      const commands = hooks[event]!.flatMap(g => g.hooks.map(h => h.command));
      const timelineCmds = commands.filter(c => c.includes('timeline-'));
      expect(timelineCmds).toHaveLength(1);
    }
  });

  it('preserves unrelated user hooks in same event', () => {
    // Pre-populate with a user's own hook
    const settingsPath = path.join(project, '.claude', 'settings.json');
    fs.mkdirSync(path.dirname(settingsPath), { recursive: true });
    fs.writeFileSync(settingsPath, JSON.stringify({
      hooks: {
        PreToolUse: [
          { hooks: [{ type: 'command', command: '/usr/local/bin/user-tool' }] },
        ],
      },
    }));

    installTimelineHooks(project);

    const settings = readSettings(project);
    const groups = (settings.hooks as Record<string, Array<{ hooks: Array<{ command: string }> }>>)
      .PreToolUse;
    const commands = groups!.flatMap(g => g.hooks.map(h => h.command));
    expect(commands).toContain('/usr/local/bin/user-tool');
    expect(commands.some(c => c.includes('timeline-'))).toBe(true);
  });

  it('preserves unrelated git post-commit content', () => {
    const gitHookPath = path.join(project, '.git', 'hooks', 'post-commit');
    fs.mkdirSync(path.dirname(gitHookPath), { recursive: true });
    fs.writeFileSync(gitHookPath, '#!/bin/sh\necho user hook\n', { mode: 0o755 });

    installTimelineHooks(project);

    const content = readGitHook(project);
    expect(content).toContain('echo user hook');
    expect(content).toContain('timeline-git-commit-hook');
  });
});

describe('uninstallTimelineHooks', () => {
  let project: string;

  beforeEach(() => { project = makeTmpProject(); });
  afterEach(() => { fs.rmSync(project, { recursive: true, force: true }); });

  it('removes exactly what install wrote (full reversibility)', () => {
    installTimelineHooks(project);
    const report = uninstallTimelineHooks(project);

    expect(report.removedHookEvents).toEqual(
      expect.arrayContaining(['UserPromptSubmit', 'PreToolUse', 'PostToolUse', 'Stop', 'SessionStart', 'SessionEnd']),
    );
    expect(report.gitHookRemoved).toBe(true);

    const settings = readSettings(project);
    expect(settings.hooks).toBeUndefined();

    expect(readGitHook(project)).toBe('');
  });

  it('leaves unrelated user hooks intact', () => {
    const settingsPath = path.join(project, '.claude', 'settings.json');
    fs.mkdirSync(path.dirname(settingsPath), { recursive: true });
    fs.writeFileSync(settingsPath, JSON.stringify({
      hooks: {
        PreToolUse: [
          { hooks: [{ type: 'command', command: '/usr/local/bin/user-tool' }] },
        ],
      },
    }));

    installTimelineHooks(project);
    uninstallTimelineHooks(project);

    const settings = readSettings(project);
    const groups = (settings.hooks as Record<string, Array<{ hooks: Array<{ command: string }> }>>)
      .PreToolUse;
    const commands = groups!.flatMap(g => g.hooks.map(h => h.command));
    expect(commands).toContain('/usr/local/bin/user-tool');
    expect(commands.some(c => c.includes('timeline-'))).toBe(false);
  });

  it('--purge drops timeline_* tables from the DB', () => {
    // init cgraphx + populate one event first
    execSync('git config user.email test@test', { cwd: project });
    execSync('git config user.name test', { cwd: project });
    // `cgraphx init` was folded into `install`; initialize the data dir directly
    // via the core API (createDirectory + timeline schema) instead of shelling
    // out to the CLI.
    createDirectory(project);
    const initConn = DatabaseConnection.open(path.join(project, '.cgraphx', 'cgraphx.db'));
    try {
      ensureTimelineSchema(initConn.getDb());
    } finally {
      initConn.close();
    }

    // Insert one event
    const dbPath = path.join(project, '.cgraphx', 'cgraphx.db');
    expect(fs.existsSync(dbPath)).toBe(true);

    installTimelineHooks(project);
    uninstallTimelineHooks(project, { purgeData: true });

    expect(reportTablesExist(project)).toBe(false);
  });
});

function reportTablesExist(projectRoot: string): boolean {
  const dbPath = path.join(projectRoot, '.cgraphx', 'cgraphx.db');
  if (!fs.existsSync(dbPath)) return false;
  const conn = DatabaseConnection.open(dbPath);
  try {
    const rows = conn.getDb().prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'timeline_%'",
    ).all() as Array<{ name: string }>;
    return rows.length > 0;
  } finally {
    conn.close();
  }
}
