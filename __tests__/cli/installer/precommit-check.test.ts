/**
 * Tests for the version-branch gate in the precommit-check PreToolUse hook
 * (版本流程与需求副本 spec D12, acceptance 31): on a project that follows the
 * version flow (`cgraphx.releaseFlow`), an agent's `git commit` on
 * `dev/x.y.z` is denied unless it concludes a merge or carries
 * `chore(release):` — with no commit-msg snippet installed, and without
 * `--no-verify` / CGRAPHX_PRECOMMIT_REVIEWED=1 getting past it.
 *
 * Each test runs the template hook script with node in a throwaway repo,
 * feeding the PreToolUse input on stdin. Nothing is staged, so once the
 * version-branch gate lets a command through the script exits at the
 * "nothing staged" step: empty stdout means allowed. git's global and
 * system config are pointed away so host config can't leak in.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { execFileSync, spawnSync } from 'node:child_process';

const HOOK = path.resolve(
  __dirname,
  '../../../assets/claude-template/hooks/precommit-check/precommit-check.cjs',
);

let root: string;
let repo: string;
let env: NodeJS.ProcessEnv;

function git(...args: string[]): string {
  return execFileSync('git', args, { cwd: repo, env, encoding: 'utf8' }).trim();
}

/** Runs the hook on `command`; returns the deny reason, or null when allowed. */
function runHook(command: string): string | null {
  const result = spawnSync(process.execPath, [HOOK], {
    cwd: repo,
    env,
    input: JSON.stringify({ tool_name: 'Bash', tool_input: { command } }),
    encoding: 'utf8',
  });
  const out = result.stdout.trim();
  if (out === '') return null;
  const decision = JSON.parse(out).hookSpecificOutput;
  expect(decision.permissionDecision).toBe('deny');
  return decision.permissionDecisionReason as string;
}

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'cg-precommit-'));
  repo = path.join(root, 'repo');
  fs.mkdirSync(repo);
  const globalConfig = path.join(root, 'gitconfig');
  fs.writeFileSync(globalConfig, '');
  env = {
    ...process.env,
    GIT_CONFIG_GLOBAL: globalConfig,
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_AUTHOR_NAME: 'test',
    GIT_AUTHOR_EMAIL: 'test@test',
    GIT_COMMITTER_NAME: 'test',
    GIT_COMMITTER_EMAIL: 'test@test',
  };
  for (const key of ['GIT_DIR', 'GIT_WORK_TREE', 'GIT_INDEX_FILE']) delete env[key];

  git('init', '-q', '-b', 'main');
  git('commit', '-q', '--allow-empty', '-m', 'init');
  git('checkout', '-q', '-b', 'dev/2.0.11');
  git('config', 'cgraphx.releaseFlow', 'true');
});

afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

describe('precommit-check: version-branch gate', () => {
  it('denies a plain commit on the version branch, even with --no-verify or the review bypass', () => {
    for (const command of [
      'git commit -m "fix: 顺手修个 bug"',
      'git commit -am "fix: 顺手修个 bug"',
      'git commit --no-verify -m "fix: 顺手修个 bug"',
      'CGRAPHX_PRECOMMIT_REVIEWED=1 git commit -m "fix: 顺手修个 bug"',
    ]) {
      const reason = runHook(command);
      expect(reason, command).toContain('dev/2.0.11 是版本分支');
      expect(reason, command).toContain('/dev-start');
    }
    expect(fs.existsSync(path.join(repo, '.git', 'hooks', 'commit-msg'))).toBe(false);
  });

  it('allows chore(release): commits, including a heredoc message', () => {
    expect(runHook('git commit -m "chore(release): 2.0.11"')).toBeNull();
    expect(
      runHook(`git commit -m "$(cat <<'EOF'\nchore(release): 发版审核报告\nEOF\n)"`),
    ).toBeNull();
  });

  it('allows concluding a merge (MERGE_HEAD present)', () => {
    fs.writeFileSync(path.join(repo, '.git', 'MERGE_HEAD'), `${git('rev-parse', 'HEAD')}\n`);
    expect(runHook('git commit --no-edit')).toBeNull();
  });

  it('leaves projects that do not follow the version flow alone', () => {
    git('config', 'cgraphx.releaseFlow', 'false');
    expect(runHook('git commit -m "fix: x"')).toBeNull();
    git('config', '--unset', 'cgraphx.releaseFlow');
    expect(runHook('git commit -m "fix: x"')).toBeNull();
  });

  it('leaves other branches and detached HEAD alone', () => {
    git('checkout', '-q', '-b', 'feat/订单导出');
    expect(runHook('git commit -m "feat: x"')).toBeNull();
    git('checkout', '-q', '-b', 'dev/zhangsan');
    expect(runHook('git commit -m "feat: x"')).toBeNull();
    git('checkout', '-q', '--detach');
    expect(runHook('git commit -m "feat: x"')).toBeNull();
  });

  it('ignores commands that are not git commit', () => {
    expect(runHook('git status')).toBeNull();
  });
});
