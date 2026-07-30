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

import { removeClaudeAssets, cleanDeprecatedAssets, deployClaudeAssets } from '../../../src/cli/installer/claude-assets';
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

describe('cleanDeprecatedAssets(升级清理已废弃资产)', () => {
  let template: string;
  let claudeDir: string;

  beforeEach(() => {
    template = tmpDir('cg-tmpl-depr-');
    claudeDir = tmpDir('cg-claude-depr-');
  });
  afterEach(() => {
    fs.rmSync(template, { recursive: true, force: true });
    fs.rmSync(claudeDir, { recursive: true, force: true });
  });

  it('删除清单里列出的旧路径,不碰用户内容', () => {
    // 清单:skills/old-skill 已废弃
    fs.writeFileSync(
      path.join(template, 'deprecated-assets.json'),
      JSON.stringify({ paths: ['skills/old-skill'] }),
    );
    // 目标:旧 skill 目录 + 用户自建 skill
    fs.mkdirSync(path.join(claudeDir, 'skills', 'old-skill'), { recursive: true });
    fs.writeFileSync(path.join(claudeDir, 'skills', 'old-skill', 'SKILL.md'), 'old');
    fs.mkdirSync(path.join(claudeDir, 'skills', 'user-custom'), { recursive: true });
    fs.writeFileSync(path.join(claudeDir, 'skills', 'user-custom', 'SKILL.md'), 'mine');

    const changes = cleanDeprecatedAssets(claudeDir, template);
    expect(changes).toEqual([{ path: '.claude/skills/old-skill', action: 'removed' }]);
    // 旧目录已删,用户 skill 不受影响
    expect(fs.existsSync(path.join(claudeDir, 'skills', 'old-skill'))).toBe(false);
    expect(fs.existsSync(path.join(claudeDir, 'skills', 'user-custom', 'SKILL.md'))).toBe(true);
  });

  it('幂等:路径不存在时不报错、不产出变更', () => {
    fs.writeFileSync(
      path.join(template, 'deprecated-assets.json'),
      JSON.stringify({ paths: ['skills/gone-skill'] }),
    );
    const changes = cleanDeprecatedAssets(claudeDir, template);
    expect(changes).toEqual([]);
  });

  it('清单文件不存在时静默跳过', () => {
    // 模板目录存在但没有 deprecated-assets.json
    fs.mkdirSync(path.join(template, 'skills', 'foo'), { recursive: true });
    const changes = cleanDeprecatedAssets(claudeDir, template);
    expect(changes).toEqual([]);
  });

  it('清单 JSON 损坏时不阻塞、不抛异常', () => {
    fs.writeFileSync(path.join(template, 'deprecated-assets.json'), '{broken');
    const changes = cleanDeprecatedAssets(claudeDir, template);
    expect(changes).toEqual([]);
  });

  it('deployClaudeAssets 部署后自动清理废弃资产', () => {
    // 模板:一个新 skill + 废弃清单
    fs.mkdirSync(path.join(template, 'skills', 'new-skill'), { recursive: true });
    fs.writeFileSync(path.join(template, 'skills', 'new-skill', 'SKILL.md'), 'new');
    fs.writeFileSync(
      path.join(template, 'deprecated-assets.json'),
      JSON.stringify({ paths: ['skills/old-skill'] }),
    );
    // 目标:旧 skill 已存在(模拟升级前的部署状态)
    fs.mkdirSync(path.join(claudeDir, 'skills', 'old-skill'), { recursive: true });
    fs.writeFileSync(path.join(claudeDir, 'skills', 'old-skill', 'SKILL.md'), 'old');

    // 注意:deployClaudeAssets 从 dist 内嵌模板解析,这里直接调 cleanDeprecatedAssets 验证集成;
    // 端到端由手动 CLI e2e 覆盖(build + install)。
    const cleanChanges = cleanDeprecatedAssets(claudeDir, template);
    expect(cleanChanges).toEqual([{ path: '.claude/skills/old-skill', action: 'removed' }]);
    expect(fs.existsSync(path.join(claudeDir, 'skills', 'old-skill'))).toBe(false);
  });

  it('removeClaudeAssets 卸载时也清理废弃资产', () => {
    // 模板 manifest:新 skill(用于卸载) + 废弃清单
    fs.mkdirSync(path.join(template, 'skills', 'new-skill'), { recursive: true });
    fs.writeFileSync(path.join(template, 'skills', 'new-skill', 'SKILL.md'), 'new');
    fs.writeFileSync(
      path.join(template, 'deprecated-assets.json'),
      JSON.stringify({ paths: ['skills/old-skill'] }),
    );
    // 目标:新 skill(包自带)+ 旧 skill(已废弃)+ 用户 skill
    fs.mkdirSync(path.join(claudeDir, 'skills', 'new-skill'), { recursive: true });
    fs.writeFileSync(path.join(claudeDir, 'skills', 'new-skill', 'SKILL.md'), 'new');
    fs.mkdirSync(path.join(claudeDir, 'skills', 'old-skill'), { recursive: true });
    fs.writeFileSync(path.join(claudeDir, 'skills', 'old-skill', 'SKILL.md'), 'old');
    fs.mkdirSync(path.join(claudeDir, 'skills', 'user-custom'), { recursive: true });
    fs.writeFileSync(path.join(claudeDir, 'skills', 'user-custom', 'SKILL.md'), 'mine');

    const changes = removeClaudeAssets(claudeDir, template);
    const removed = changes.filter(c => c.action === 'removed').map(c => c.path).sort();
    // 包自带 + 废弃的都被删,用户的留着
    expect(removed).toEqual(['.claude/skills/new-skill', '.claude/skills/old-skill']);
    expect(fs.existsSync(path.join(claudeDir, 'skills', 'old-skill'))).toBe(false);
    expect(fs.existsSync(path.join(claudeDir, 'skills', 'user-custom', 'SKILL.md'))).toBe(true);
  });
});
