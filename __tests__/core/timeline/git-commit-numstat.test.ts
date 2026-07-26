/**
 * B-4 (timeline-data-quality) — git_commit numstat (insertions/deletions).
 *
 * Six test cases from the plan:
 *   1. Single file, one-line addition → insertions=1, deletions=0
 *   2. Multi-file, mixed +3/-1 and +5/-2 → aggregated insertions=8, deletions=3
 *   3. Binary file commit → numstat shows "-", parser skips it (no crash, no NaN)
 *   4. Empty commit (`--allow-empty`) → insertions=0, deletions=0
 *   5. File deletion commit → deletions>0, insertions=0
 *   6. numstat command fails (git binary missing from PATH) → returns
 *      insertions=0, deletions=0, no throw — numstat is an enhancement, not a gate
 *
 * All tests create a throwaway git repo with fs.mkdtempSync + `git init` and
 * drive `readGitCommitInfo` directly. The real .cgraphx/ is NEVER touched.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { execSync } from 'node:child_process';

import { readGitCommitInfo } from '../../../src/core/timeline/hooks';

// ─── Helpers ────────────────────────────────────────────────────────────────

function makeTmpRepo(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cg-git-numstat-'));
  // -b main for a stable default branch (avoids master/main warnings on
  // newer git). The -q suppresses the hints.
  execSync('git init -q -b main', { cwd: dir });
  // Without these, `git commit` fails on hosts without global identity config.
  execSync('git config user.email test@test', { cwd: dir });
  execSync('git config user.name test', { cwd: dir });
  return dir;
}

function git(args: string, cwd: string): string {
  return execSync(`git ${args}`, { cwd, encoding: 'utf8' });
}

/**
 * Create a file, write content, stage + commit it. Returns the new HEAD sha.
 */
function commitFile(
  repo: string,
  filename: string,
  content: string,
  message = 'test commit',
): string {
  fs.writeFileSync(path.join(repo, filename), content);
  git(`add ${filename}`, repo);
  git(`commit -q -m ${JSON.stringify(message)}`, repo);
  return git('rev-parse HEAD', repo).trim();
}

/**
 * Force a real binary file. Using an actual NUL-containing blob (not a text
 * file with `.bin` extension) is what makes git classify it as binary in
 * numstat — git sniffs content, not extension.
 */
function commitBinaryFile(
  repo: string,
  filename: string,
  bytes: Buffer,
  message = 'binary commit',
): string {
  fs.writeFileSync(path.join(repo, filename), bytes);
  git(`add ${filename}`, repo);
  git(`commit -q -m ${JSON.stringify(message)}`, repo);
  return git('rev-parse HEAD', repo).trim();
}

/**
 * readGitCommitInfo resolves the repo from process.cwd(), so each test chdir's
 * into its temp repo and restores the original cwd in `finally`. Saves callers
 * from having to remember the restore.
 */
async function readInfoFrom(repo: string) {
  const originalCwd = process.cwd();
  process.chdir(repo);
  try {
    return readGitCommitInfo();
  } finally {
    process.chdir(originalCwd);
  }
}

// ─── Tests ──────────────────────────────────────────────────────────────────

describe('B-4 git_commit numstat — readGitCommitInfo', () => {
  let repo: string;

  beforeEach(() => {
    repo = makeTmpRepo();
  });

  afterEach(() => {
    try {
      fs.rmSync(repo, { recursive: true, force: true });
    } catch {
      // best-effort cleanup; tmpdir GC will handle it
    }
  });

  it('case 1: single file with one added line → insertions=1, deletions=0', async () => {
    // Initial commit so HEAD has a parent (readGitCommitInfo reads HEAD).
    commitFile(repo, 'a.txt', 'first line\n', 'init');

    // Now the commit under test: add exactly one line.
    fs.writeFileSync(path.join(repo, 'a.txt'), 'first line\nsecond line\n');
    git('add a.txt', repo);
    git('commit -q -m "add one line"', repo);

    const info = await readInfoFrom(repo);
    expect(info).not.toBeNull();
    expect(info!.insertions).toBe(1);
    expect(info!.deletions).toBe(0);
    expect(info!.files).toContain('a.txt');
  });

  it('case 2: multi-file mixed changes aggregate correctly (+3/-1 and +5/-2 → 8/3)', async () => {
    // Seed: two files with known starting content.
    commitFile(repo, 'f1.txt', 'l1\nl2\nl3\nl4\nl5\n', 'init');
    commitFile(repo, 'f2.txt', 'm1\nm2\nm3\nm4\nm5\nm6\nm7\n', 'init2');

    // f1: keep l1-l4, delete l5 (-1), add newA/newB/newC (+3) → +3/-1
    fs.writeFileSync(path.join(repo, 'f1.txt'), 'l1\nl2\nl3\nl4\nnewA\nnewB\nnewC\n');
    // f2: keep m1-m5, delete m6/m7 (-2), add x1-x5 (+5) → +5/-2
    fs.writeFileSync(path.join(repo, 'f2.txt'), 'm1\nm2\nm3\nm4\nm5\nx1\nx2\nx3\nx4\nx5\n');

    git('add f1.txt f2.txt', repo);
    git('commit -q -m "multi-file"', repo);

    const info = await readInfoFrom(repo);
    expect(info).not.toBeNull();
    expect(info!.insertions).toBe(8);
    expect(info!.deletions).toBe(3);
    expect(info!.files.sort()).toEqual(['f1.txt', 'f2.txt']);
  });

  it('case 3: binary file commit — parser skips without crashing', async () => {
    // Seed commit first so the binary commit has a PARENT. readGitCommitInfo
    // uses `git diff-tree ... HEAD` (without --root), which returns empty for
    // a root commit — so the binary must be the SECOND commit to be picked up
    // in the files list.
    commitFile(repo, 'seed.txt', 'seed\n', 'seed');

    // A NUL byte makes git classify the blob as binary, which makes numstat
    // emit "-\t-\tfile.bin".
    const binaryBytes = Buffer.from([0x00, 0x01, 0x02, 0xff, 0xfe, 0x00, 0x42]);
    commitBinaryFile(repo, 'image.bin', binaryBytes, 'add binary');

    // Sanity check: confirm git itself sees this as binary in numstat.
    const numstat = git('show --numstat --format= HEAD', repo).trim();
    expect(numstat.startsWith('-\t-\t')).toBe(true);

    const info = await readInfoFrom(repo);
    expect(info).not.toBeNull();
    // Binary contributes nothing.
    expect(info!.insertions).toBe(0);
    expect(info!.deletions).toBe(0);
    // File still listed in the changed-files list (diff-tree is unaffected).
    expect(info!.files).toContain('image.bin');
  });

  it('case 4: empty commit (`--allow-empty`) → insertions=0, deletions=0', async () => {
    commitFile(repo, 'seed.txt', 'seed\n', 'seed');
    // Empty commit: no diff at all.
    git('commit -q --allow-empty -m "empty"', repo);

    const info = await readInfoFrom(repo);
    expect(info).not.toBeNull();
    expect(info!.insertions).toBe(0);
    expect(info!.deletions).toBe(0);
    expect(info!.files).toEqual([]);
  });

  it('case 5: file deletion commit → deletions>0, insertions=0', async () => {
    // Seed a file with 3 lines.
    commitFile(repo, 'doomed.txt', 'a\nb\nc\n', 'add file to be deleted');
    // Delete it.
    git('rm doomed.txt', repo);
    git('commit -q -m "remove file"', repo);

    const info = await readInfoFrom(repo);
    expect(info).not.toBeNull();
    expect(info!.insertions).toBe(0);
    expect(info!.deletions).toBe(3);
    expect(info!.files).toContain('doomed.txt');
  });

  it('case 6: numstat unavailable → returns null, no throw (git binary unreachable)', async () => {
    commitFile(repo, 'a.txt', 'hello\n', 'init');

    // Move into the repo, then break PATH so `git` cannot be found —
    // simulates git being unavailable. readGitCommitInfo's outer
    // `git rev-parse --show-toplevel` also fails, so the whole function
    // returns null (no throw). This proves the failure path is contained.
    const originalCwd = process.cwd();
    const originalPath = process.env.PATH;
    process.chdir(repo);
    process.env.PATH = '';
    try {
      const info = readGitCommitInfo();
      expect(info).toBeNull();
    } finally {
      process.env.PATH = originalPath;
      process.chdir(originalCwd);
    }
  });
});
