/**
 * Tests for the cgraphx workflow-guidance block written into a target
 * project's `.claude/CLAUDE.md` on local install.
 *
 * Covers the two new units directly:
 *   - `replaceOrAppendMarkedSection` (shared.ts) — the idempotent marker-
 *     block upsert that install uses.
 *   - `readTemplateClaudeMd` (claude-assets.ts) — reads the template-root
 *     CLAUDE.md asset that supplies the block content.
 * Plus a file-level round-trip that mirrors exactly what the Claude target's
 * writeInstructionsEntry / removeInstructionsEntry do with those helpers and
 * the CGRAPHX markers (write → idempotent re-write → preserve user content →
 * strip on uninstall).
 *
 * The full target wiring (asset → claudeTarget.install → file) is covered by
 * the manual CLI e2e: from source, vitest resolves the template dir relative
 * to `src/` (no baked asset), so `readTemplateClaudeMd()` returns null and the
 * target skips the write — that graceful-skip path is exercised in the wild by
 * `npm run build && node dist/cli/index.js install` in a scratch project.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';

import {
  replaceOrAppendMarkedSection,
  removeMarkedSection,
} from '../../../src/cli/installer/targets/shared';
import { readTemplateClaudeMd } from '../../../src/cli/installer/claude-assets';

// The marker contract (must match CGRAPHX_SECTION_* in targets/claude.ts).
const START = '<!-- CGRAPHX_START -->';
const END = '<!-- CGRAPHX_END -->';

function tmpDir(prefix: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

describe('replaceOrAppendMarkedSection', () => {
  let dir: string;
  beforeEach(() => { dir = tmpDir('cg-marked-'); });
  afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }); });

  it('creates the file and block when the file is missing', () => {
    const f = path.join(dir, 'CLAUDE.md');
    expect(replaceOrAppendMarkedSection(f, START, END, 'BODY')).toBe('created');
    expect(fs.readFileSync(f, 'utf8')).toBe(`${START}\nBODY\n${END}\n`);
  });

  it('appends to an existing marker-less file, preserving user content above the block', () => {
    const f = path.join(dir, 'CLAUDE.md');
    fs.writeFileSync(f, '# My Project\n\nuser content\n');
    expect(replaceOrAppendMarkedSection(f, START, END, 'BODY')).toBe('updated');
    const out = fs.readFileSync(f, 'utf8');
    expect(out).toContain('# My Project');
    expect(out).toContain('user content');
    expect(out).toContain(`${START}\nBODY\n${END}`);
    expect(out.indexOf('user content')).toBeLessThan(out.indexOf(START));
  });

  it('replaces an existing block in place, preserving surrounding content', () => {
    const f = path.join(dir, 'CLAUDE.md');
    fs.writeFileSync(f, `before\n${START}\nOLD\n${END}\nafter\n`);
    expect(replaceOrAppendMarkedSection(f, START, END, 'NEW')).toBe('updated');
    expect(fs.readFileSync(f, 'utf8')).toBe(`before\n${START}\nNEW\n${END}\nafter\n`);
  });

  it('is idempotent: identical body → unchanged, file bytes untouched', () => {
    const f = path.join(dir, 'CLAUDE.md');
    const initial = `x\n${START}\nBODY\n${END}\ny\n`;
    fs.writeFileSync(f, initial);
    expect(replaceOrAppendMarkedSection(f, START, END, 'BODY')).toBe('unchanged');
    expect(fs.readFileSync(f, 'utf8')).toBe(initial);
  });

  it('normalizes trailing whitespace in the body', () => {
    const f = path.join(dir, 'CLAUDE.md');
    expect(replaceOrAppendMarkedSection(f, START, END, 'BODY\n\n\n')).toBe('created');
    expect(fs.readFileSync(f, 'utf8')).toBe(`${START}\nBODY\n${END}\n`);
  });
});

describe('readTemplateClaudeMd', () => {
  let dir: string;
  beforeEach(() => { dir = tmpDir('cg-tmpl-'); });
  afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }); });

  it('reads CLAUDE.md from the given template dir', () => {
    fs.writeFileSync(path.join(dir, 'CLAUDE.md'), 'hello workflow');
    expect(readTemplateClaudeMd(dir)).toBe('hello workflow');
  });

  it('returns null when the template dir is missing', () => {
    expect(readTemplateClaudeMd(path.join(dir, 'does-not-exist'))).toBeNull();
  });

  it('returns null when CLAUDE.md is absent from an existing dir', () => {
    expect(readTemplateClaudeMd(dir)).toBeNull();
  });
});

describe('.claude/CLAUDE.md install/uninstall round-trip (file-level)', () => {
  // Mirrors claude.ts writeInstructionsEntry (upsert) + removeInstructionsEntry
  // (strip) using the shared helpers and the CGRAPHX markers.
  let dir: string;
  let file: string;
  const BODY = '本项目用 cgraphx 的 skill 流程做需求。';

  beforeEach(() => {
    dir = tmpDir('cg-claudemd-');
    file = path.join(dir, '.claude', 'CLAUDE.md');
    fs.mkdirSync(path.join(dir, '.claude'), { recursive: true });
  });
  afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }); });

  it('writes, is idempotent on re-install, preserves user content, and strips clean on uninstall', () => {
    // The user already keeps their own notes in .claude/CLAUDE.md.
    fs.writeFileSync(file, '# 我的项目说明\n');

    // install #1 → block appended after user content
    expect(replaceOrAppendMarkedSection(file, START, END, BODY)).toBe('updated');
    let out = fs.readFileSync(file, 'utf8');
    expect(out).toContain('# 我的项目说明');
    expect(out).toContain(BODY);

    // install #2 → unchanged (no spurious rewrite)
    const snapshot = fs.readFileSync(file, 'utf8');
    expect(replaceOrAppendMarkedSection(file, START, END, BODY)).toBe('unchanged');
    expect(fs.readFileSync(file, 'utf8')).toBe(snapshot);

    // uninstall → block stripped, user content kept
    expect(removeMarkedSection(file, START, END)).toBe('removed');
    out = fs.readFileSync(file, 'utf8');
    expect(out).toContain('# 我的项目说明');
    expect(out).not.toContain(START);
    expect(out).not.toContain(END);
    expect(out).not.toContain(BODY);
  });
});
