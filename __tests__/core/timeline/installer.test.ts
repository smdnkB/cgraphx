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
import { Command } from 'commander';

import { installTimelineHooks, uninstallTimelineHooks } from '../../../src/core/timeline/installer';
import { registerTimelineCommands } from '../../../src/core/timeline/cli';
import { DatabaseConnection } from '../../../src/core/db';
import { createDirectory } from '../../../src/core/directory';
import { ensureTimelineSchema } from '../../../src/core/timeline/schema-bootstrap';

function makeTmpProject(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cg-tl-inst-'));
  execSync('git init -q', { cwd: dir });
  return dir;
}

/** 在 cwd 里跑 `cgraphx timeline <args>`(进程内注册命令),收下 stdout、stderr。 */
async function runTimelineCli(cwd: string, args: string[]): Promise<{ stdout: string; stderr: string }> {
  const program = new Command();
  program.exitOverride();
  registerTimelineCommands(program);
  const out: string[] = [];
  const err: string[] = [];
  const text = (chunk: string | Uint8Array): string => (typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString());
  const originalOut = process.stdout.write.bind(process.stdout);
  const originalErr = process.stderr.write.bind(process.stderr);
  const prevCwd = process.cwd();
  const prevExitCode = process.exitCode;
  process.stdout.write = ((chunk: string | Uint8Array) => { out.push(text(chunk)); return true; }) as typeof process.stdout.write;
  process.stderr.write = ((chunk: string | Uint8Array) => { err.push(text(chunk)); return true; }) as typeof process.stderr.write;
  try {
    process.chdir(cwd);
    await program.parseAsync(['node', 'cgraphx', 'timeline', ...args]);
  } finally {
    process.chdir(prevCwd);
    process.stdout.write = originalOut;
    process.stderr.write = originalErr;
    process.exitCode = prevExitCode;
  }
  return { stdout: out.join(''), stderr: err.join('') };
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

  it('--purge 不再删数据:timeline 表还在,stderr 提示用 cgraphx project remove 删(spec D31,M14)', async () => {
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

    const dbPath = path.join(project, '.cgraphx', 'cgraphx.db');
    expect(fs.existsSync(dbPath)).toBe(true);

    installTimelineHooks(project);
    const { stdout, stderr } = await runTimelineCli(project, ['uninstall', '--purge']);

    expect(reportTablesExist(project)).toBe(true);
    // stdout 照旧只有 JSON 报告
    expect(() => JSON.parse(stdout)).not.toThrow();
    // 本地库还有旧表(没并过),项目目录不在:提示不写路径
    expect(stderr).toContain('[timeline] 项目的数据要删用 cgraphx project remove');
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
