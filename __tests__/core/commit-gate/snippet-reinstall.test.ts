/**
 * 门禁的 commit-msg 片段重装:每次升级都要重跑 install,片段会被装第二次。片段里不能有真的换行——
 * 否则一行拆成两行、只有后一行带 marker,重装删不掉前一行,钩子语法错误,之后每次提交都失败。
 *
 * 全部在临时仓库里跑,真实仓库不碰(HOME 由 setup-home 换成临时目录)。
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { execFileSync, spawnSync } from 'node:child_process';

import { COMMIT_GATE_MARKER, installCommitGate } from '../../../src/core/commit-gate';

// 测试进程本身可能跑在 agent 会话里:提交时去掉会话变量,当成人手动提交
const SESSION_VARS = ['CLAUDE_CODE_SESSION_ID', 'CODEBUDDY_SESSION_ID'];
function envWithout(names: readonly string[], extra: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env, ...extra };
  for (const name of names) delete env[name];
  return env;
}

let repo: string;
let hook: string;

beforeEach(() => {
  repo = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'cg-gate-reinstall-')));
  execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: repo });
  execFileSync('git', ['config', 'user.email', 't@t'], { cwd: repo });
  execFileSync('git', ['config', 'user.name', 't'], { cwd: repo });
  hook = path.join(repo, '.git', 'hooks', 'commit-msg');
});

afterEach(() => {
  fs.rmSync(repo, { recursive: true, force: true });
});

describe('commit-msg gate snippet', () => {
  it('stays valid shell after being installed twice, and a manual commit still succeeds', () => {
    installCommitGate(repo);
    installCommitGate(repo);

    const lines = fs.readFileSync(hook, 'utf8').split('\n').filter((l) => l !== '');
    expect(lines.slice(1).every((l) => l.includes(COMMIT_GATE_MARKER))).toBe(true);
    expect(lines).toHaveLength(3); // shebang + 说明 + 一行片段
    expect(spawnSync('sh', ['-n', hook]).status).toBe(0);

    fs.writeFileSync(path.join(repo, 'a.txt'), 'a\n');
    execFileSync('git', ['add', 'a.txt'], { cwd: repo });
    const commit = spawnSync('git', ['commit', '-q', '-m', 'test: after reinstall'], {
      cwd: repo,
      env: envWithout(SESSION_VARS),
      encoding: 'utf8',
    });
    expect(commit.stderr).toBe('');
    expect(commit.status).toBe(0);
  });

  it('prints the rejection text line by line and fails the commit when the gate returns 3', () => {
    installCommitGate(repo);
    // PATH 上放一个假的 cgraphx:打两行打回原文,退出码 3
    const bin = path.join(repo, 'fake-bin');
    fs.mkdirSync(bin);
    fs.writeFileSync(path.join(bin, 'cgraphx'), '#!/bin/sh\necho "第一行"\necho "第二行"\nexit 3\n', { mode: 0o755 });
    const msg = path.join(repo, 'msg.txt');
    fs.writeFileSync(msg, 'feat: x\n');

    const run = spawnSync('sh', [hook, msg], {
      cwd: repo,
      env: envWithout(['CODEBUDDY_SESSION_ID'], { CLAUDE_CODE_SESSION_ID: 's1', PATH: `${bin}:${process.env.PATH ?? ''}` }),
      encoding: 'utf8',
    });
    expect(run.status).toBe(1);
    expect(run.stderr).toBe('第一行\n第二行\n');
  });
});
