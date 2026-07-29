/**
 * Tests for the two units the install/uninstall refactor adds:
 *   - `removeClaudeAssets` (claude-assets.ts) — manifest-driven removal of the
 *     package-owned `.claude/` assets on uninstall.
 *   - `ensureProjectInitialized` (installer/index.ts) — the `.cgraphx/` init
 *     that install now does (the removed `cgraphx init`, folded in).
 *
 * The full install/uninstall orchestration is covered by the manual CLI e2e
 * (build + `node dist/cli/index.js install/uninstall` in a scratch project).
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';

import { removeClaudeAssets } from '../../../src/cli/installer/claude-assets';
import { ensureProjectInitialized } from '../../../src/cli/installer/index';

function tmpDir(prefix: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

describe('removeClaudeAssets (manifest-driven uninstall)', () => {
  let template: string;
  let claudeDir: string;

  beforeEach(() => {
    template = tmpDir('cg-tmpl-');
    claudeDir = tmpDir('cg-claude-');
    // The package manifest: a multi-file skill + a single-file command.
    fs.mkdirSync(path.join(template, 'skills', 'foo'), { recursive: true });
    fs.writeFileSync(path.join(template, 'skills', 'foo', 'SKILL.md'), 'x');
    fs.writeFileSync(path.join(template, 'skills', 'foo', 'extra.md'), 'y');
    fs.mkdirSync(path.join(template, 'commands'), { recursive: true });
    fs.writeFileSync(path.join(template, 'commands', 'bar.md'), 'z');
    // A template-root CLAUDE.md — must be ignored (it's marker-block owned).
    fs.writeFileSync(path.join(template, 'CLAUDE.md'), 'workflow');
  });
  afterEach(() => {
    fs.rmSync(template, { recursive: true, force: true });
    fs.rmSync(claudeDir, { recursive: true, force: true });
  });

  it('removes package-owned assets by manifest, keeps user-added ones', () => {
    // Deployed state: the package skill (with a stale v1 extra file) + command,
    // plus a user-renamed skill and the user's CLAUDE.md.
    fs.mkdirSync(path.join(claudeDir, 'skills', 'foo'), { recursive: true });
    fs.writeFileSync(path.join(claudeDir, 'skills', 'foo', 'SKILL.md'), 'x');
    fs.writeFileSync(path.join(claudeDir, 'skills', 'foo', 'stale-from-v1.md'), 'old');
    fs.mkdirSync(path.join(claudeDir, 'skills', 'user-custom'), { recursive: true });
    fs.writeFileSync(path.join(claudeDir, 'skills', 'user-custom', 'SKILL.md'), 'mine');
    fs.mkdirSync(path.join(claudeDir, 'commands'), { recursive: true });
    fs.writeFileSync(path.join(claudeDir, 'commands', 'bar.md'), 'z');
    fs.writeFileSync(path.join(claudeDir, 'CLAUDE.md'), 'user content + marker block');

    const changes = removeClaudeAssets(claudeDir, template);
    const removed = changes.filter((c) => c.action === 'removed').map((c) => c.path).sort();
    expect(removed).toEqual(['.claude/commands/bar.md', '.claude/skills/foo']);

    // The package skill dir is gone wholesale — including the stale v1 file,
    // so no orphan survives a version that ships fewer files.
    expect(fs.existsSync(path.join(claudeDir, 'skills', 'foo'))).toBe(false);
    expect(fs.existsSync(path.join(claudeDir, 'commands', 'bar.md'))).toBe(false);
    // The user's renamed skill and CLAUDE.md survive.
    expect(fs.existsSync(path.join(claudeDir, 'skills', 'user-custom', 'SKILL.md'))).toBe(true);
    expect(fs.existsSync(path.join(claudeDir, 'CLAUDE.md'))).toBe(true);
  });

  it('is idempotent: a second run removes nothing', () => {
    fs.mkdirSync(path.join(claudeDir, 'skills', 'foo'), { recursive: true });
    fs.writeFileSync(path.join(claudeDir, 'skills', 'foo', 'SKILL.md'), 'x');

    removeClaudeAssets(claudeDir, template);
    const second = removeClaudeAssets(claudeDir, template);
    expect(second.filter((c) => c.action === 'removed')).toHaveLength(0);
  });

  it('returns not-found when there is no template manifest to derive from', () => {
    const changes = removeClaudeAssets(claudeDir, path.join(template, 'does-not-exist'));
    expect(changes).toEqual([{ path: '', action: 'not-found' }]);
  });
});

describe('ensureProjectInitialized (init folded into install)', () => {
  let project: string;
  beforeEach(() => { project = tmpDir('cg-proj-'); });
  afterEach(() => { fs.rmSync(project, { recursive: true, force: true }); });

  it('creates .cgraphx/cgraphx.db on first run', async () => {
    const outcome = await ensureProjectInitialized(project);
    expect(outcome).toBe('initialized');
    expect(fs.existsSync(path.join(project, '.cgraphx', 'cgraphx.db'))).toBe(true);
  });

  it('is a no-op (no throw) when already initialized', async () => {
    await ensureProjectInitialized(project);
    const again = await ensureProjectInitialized(project);
    expect(again).toBe('already');
  });
});
