/**
 * 提交记录后台进程(timeline-git-commit-hook)的两处判断:
 *
 * 1. git 钩子带来的 GIT_DIR 等变量:worktree 里提交时 GIT_DIR 是绝对路径,后台进程继承后识别别的仓库
 *    读到的是提交所在的仓库;进程一启动就清掉,别的仓库按自己的配置认。
 * 2. 跳过门禁(spec D14、K16):agent 提交的 tree 和门禁记号对不上就标,`--no-verify` 时门禁没跑、
 *    没有记号,也要标。
 *
 * 全部在临时目录里建仓库,真实仓库和用户目录不碰(HOME 由 setup-home 换成临时目录)。
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { execFileSync, execSync } from 'node:child_process';

import type { SessionFromEnv } from '../../../src/core/agents';
import { COMMIT_GATE_MARKER } from '../../../src/core/commit-gate';
import { clearRepoLocalGitEnv } from '../../../src/core/git-hooks';
import { identityOfRoot } from '../../../src/core/project-identity';
import {
  CHERRY_PICK_ENV,
  COMMIT_BRANCH_ENV,
  COMMIT_HOOK_ENV,
  COMMIT_SHA_ENV,
  GATE_TREE_ENV,
  REBASE_ENV,
} from '../../../src/core/timeline/constants';
import { gitCommitHook, isGateSkipped, readGitCommitInfo } from '../../../src/core/timeline/git-commit';

// 测试里会改的环境变量,每个用例前后原样还原
const TOUCHED_ENV = [
  'GIT_DIR',
  'GIT_WORK_TREE',
  'GIT_INDEX_FILE',
  'GIT_COMMON_DIR',
  'GIT_PREFIX',
  'CGRAPHX_NO_TIMELINE',
  GATE_TREE_ENV,
  COMMIT_HOOK_ENV,
  COMMIT_SHA_ENV,
  COMMIT_BRANCH_ENV,
  CHERRY_PICK_ENV,
  REBASE_ENV,
  'DSH_SESSION_ID',
];

function makeRepo(dir: string, origin: string): string {
  fs.mkdirSync(dir, { recursive: true });
  execSync('git init -q -b main', { cwd: dir });
  execSync('git config user.email test@test', { cwd: dir });
  execSync('git config user.name test', { cwd: dir });
  execSync(`git remote add origin ${origin}`, { cwd: dir });
  return fs.realpathSync(dir);
}

function commitFile(repo: string, file: string, message: string): void {
  fs.writeFileSync(path.join(repo, file), `${file}\n`);
  execSync(`git add ${file}`, { cwd: repo });
  execFileSync('git', ['commit', '-q', '-m', message], { cwd: repo });
}

function installGateSnippet(repo: string): void {
  const hook = path.join(repo, '.git', 'hooks', 'commit-msg');
  // 一行假片段:marker + Claude 来源的探针(片段说明行与探针行都带 marker,必须看带探针那行)
  fs.writeFileSync(hook, `#!/bin/sh\ntrue ${COMMIT_GATE_MARKER} \${CLAUDE_CODE_SESSION_ID:-}\n`, { mode: 0o755 });
}

/** isGateSkipped 的会话参数:Claude 来源;人手动提交传 null。 */
const CLAUDE_SESSION: SessionFromEnv = {
  sessionId: 's',
  agent: 'claude-code',
  sessionIdEnv: 'CLAUDE_CODE_SESSION_ID',
};

function infoOf(repo: string) {
  const original = process.cwd();
  process.chdir(repo);
  try {
    const info = readGitCommitInfo();
    if (info === null) throw new Error('readGitCommitInfo returned null');
    return info;
  } finally {
    process.chdir(original);
  }
}

let tmp: string;
let savedEnv: Record<string, string | undefined>;

beforeEach(() => {
  tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'cg-commit-hook-env-')));
  savedEnv = Object.fromEntries(TOUCHED_ENV.map((k) => [k, process.env[k]]));
  for (const k of TOUCHED_ENV) delete process.env[k];
});

afterEach(() => {
  for (const [k, v] of Object.entries(savedEnv)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe('clearRepoLocalGitEnv', () => {
  it('lets git read another repo by its own config once the inherited GIT_DIR is cleared', () => {
    const alpha = makeRepo(path.join(tmp, 'alpha'), 'git@example.com:team/alpha.git');
    const beta = makeRepo(path.join(tmp, 'beta'), 'git@example.com:team/beta.git');
    const env: NodeJS.ProcessEnv = { ...process.env, GIT_DIR: path.join(alpha, '.git') };

    // 前提:带着 alpha 的 GIT_DIR,在 beta 里读到的是 alpha 的地址
    const readOrigin = (e: NodeJS.ProcessEnv) =>
      execFileSync('git', ['config', '--get', 'remote.origin.url'], { cwd: beta, env: e, encoding: 'utf8' }).trim();
    expect(readOrigin(env)).toBe('git@example.com:team/alpha.git');

    clearRepoLocalGitEnv(env);
    expect(env.GIT_DIR).toBeUndefined();
    expect(readOrigin(env)).toBe('git@example.com:team/beta.git');
  });

  it('removes every repo-local variable git lists and keeps unrelated ones', () => {
    const listed = execFileSync('git', ['rev-parse', '--local-env-vars'], { encoding: 'utf8' })
      .split('\n').map((s) => s.trim()).filter(Boolean);
    const env: NodeJS.ProcessEnv = { PATH: '/usr/bin', GIT_AUTHOR_NAME: 'someone' };
    for (const name of listed) env[name] = 'x';

    clearRepoLocalGitEnv(env);

    expect(listed.filter((name) => env[name] !== undefined)).toEqual([]);
    expect(env.PATH).toBe('/usr/bin');
    expect(env.GIT_AUTHOR_NAME).toBe('someone');
  });
});

describe('gitCommitHook started from a worktree commit', () => {
  it('clears the absolute GIT_DIR the hook passed down, so other repos are identified by their own config', async () => {
    const main = makeRepo(path.join(tmp, 'main'), 'git@example.com:team/main.git');
    const other = makeRepo(path.join(tmp, 'other'), 'git@example.com:team/other.git');
    commitFile(main, 'a.txt', 'feat: first');
    const wt = path.join(tmp, 'main@wt');
    execFileSync('git', ['worktree', 'add', '-q', '-b', 'feat/wt', wt], { cwd: main });
    commitFile(wt, 'b.txt', 'feat: in worktree');

    // git 在 worktree 里跑 post-commit 时带的变量
    process.env.GIT_DIR = path.join(main, '.git', 'worktrees', 'main@wt');
    process.env.GIT_INDEX_FILE = path.join(main, '.git', 'worktrees', 'main@wt', 'index');
    process.env[COMMIT_SHA_ENV] = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: wt, encoding: 'utf8' }).trim();
    process.env[COMMIT_BRANCH_ENV] = 'feat/wt';

    const original = process.cwd();
    process.chdir(wt);
    try {
      await gitCommitHook();
    } finally {
      process.chdir(original);
    }

    expect(process.env.GIT_DIR).toBeUndefined();
    expect(process.env.GIT_INDEX_FILE).toBeUndefined();
    const id = identityOfRoot(other);
    expect(id === 'git-error' ? id : id.identity.name).toBe('other');
  });
});

describe('isGateSkipped', () => {
  let repo: string;

  beforeEach(() => {
    repo = makeRepo(path.join(tmp, 'repo'), 'git@example.com:team/repo.git');
    installGateSnippet(repo);
    commitFile(repo, 'a.txt', 'feat: add a');
  });

  it('marks an agent commit with no gate mark as skipped (--no-verify)', () => {
    expect(isGateSkipped(infoOf(repo), CLAUDE_SESSION)).toBe(true);
  });

  it('marks an agent commit whose tree differs from the gate mark as skipped', () => {
    process.env[GATE_TREE_ENV] = '0'.repeat(40);
    expect(isGateSkipped(infoOf(repo), CLAUDE_SESSION)).toBe(true);
  });

  it('does not mark an agent commit whose tree matches the gate mark', () => {
    const info = infoOf(repo);
    process.env[GATE_TREE_ENV] = `${info.tree}\n`;
    expect(isGateSkipped(info, CLAUDE_SESSION)).toBe(false);
  });

  it('does not mark a manual commit', () => {
    expect(isGateSkipped(infoOf(repo), null)).toBe(false);
  });

  it('does not mark when the commit-msg hook has no gate snippet', () => {
    fs.rmSync(path.join(repo, '.git', 'hooks', 'commit-msg'));
    expect(isGateSkipped(infoOf(repo), CLAUDE_SESSION)).toBe(false);
  });

  it('does not mark commits recorded by post-merge', () => {
    process.env[COMMIT_HOOK_ENV] = 'post-merge';
    expect(isGateSkipped(infoOf(repo), CLAUDE_SESSION)).toBe(false);
  });

  it('does not mark commits made during cherry-pick or rebase', () => {
    process.env[CHERRY_PICK_ENV] = '1';
    expect(isGateSkipped(infoOf(repo), CLAUDE_SESSION)).toBe(false);
    delete process.env[CHERRY_PICK_ENV];
    process.env[REBASE_ENV] = '1';
    expect(isGateSkipped(infoOf(repo), CLAUDE_SESSION)).toBe(false);
  });

  it('does not mark a revert commit', () => {
    const head = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repo, encoding: 'utf8' }).trim();
    execFileSync('git', ['revert', '--no-edit', head], { cwd: repo, stdio: 'ignore' });
    expect(isGateSkipped(infoOf(repo), CLAUDE_SESSION)).toBe(false);
  });
});
