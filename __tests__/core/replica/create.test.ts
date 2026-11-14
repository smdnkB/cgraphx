import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { DatabaseConnection, getLocalDatabasePath } from '../../../src/core/db';
import { createDirectory } from '../../../src/core/directory';
import { createReplica, ReplicaError, removeReplica } from '../../../src/core/replica';
import { replicaProjectDir, replicaTarget } from '../../../src/core/replica/paths';
import { replicaLinkOf } from '../../../src/core/replica/main-dir';
import { syncMyFeatures } from '../../../src/core/features/sync';

function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', ['-c', 'user.name=test', '-c', 'user.email=test@example.com', ...args], {
    cwd,
    encoding: 'utf8',
  }).trim();
}

function commitFile(cwd: string, name: string): string {
  fs.writeFileSync(path.join(cwd, name), `${name}\n`);
  git(cwd, 'add', name);
  git(cwd, 'commit', '-q', '-m', `test: ${name}`);
  return git(cwd, 'rev-parse', 'HEAD');
}

function replicaErrorOf(run: () => unknown): ReplicaError {
  try {
    run();
  } catch (err) {
    if (err instanceof ReplicaError) return err;
    throw err;
  }
  throw new Error('应该抛 ReplicaError');
}

describe('createReplica:重复开副本与留下的分支', () => {
  let base: string;
  let main: string;
  const feature = '2026-11-06-订单导出';
  const opts = { featureId: feature, prefix: '订单导出', branch: 'feat/订单导出' };

  beforeEach(() => {
    base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'cgraphx-replica-')));
    main = path.join(base, 'app');
    fs.mkdirSync(main);
    git(main, 'init', '-q', '-b', 'dev/9.9.9');
    commitFile(main, 'README.md');
    createDirectory(main);
    DatabaseConnection.open(getLocalDatabasePath(main)).close();
  });

  afterEach(() => {
    fs.rmSync(base, { recursive: true, force: true });
  });

  it('这个需求已有在用副本时报 feature_has_replica,不提示换分支名,什么都不动', () => {
    const first = createReplica(main, opts);
    const branches = git(main, 'branch', '--list');
    const worktrees = git(main, 'worktree', 'list');

    const err = replicaErrorOf(() => createReplica(main, opts));

    expect(err.code).toBe('feature_has_replica');
    expect(err.message).toContain(first.name);
    expect(git(main, 'branch', '--list')).toBe(branches);
    expect(git(main, 'worktree', 'list')).toBe(worktrees);
    expect(fs.existsSync(first.path)).toBe(true);
  });

  it('删副本留下的分支,重开同一个需求时接上,起点沿用第一次开副本的提交', () => {
    const first = createReplica(main, opts);
    const tip = commitFile(first.path, 'a.txt');

    const removed = removeReplica(main, first.name);
    expect(removed.state).toBe('removed');
    expect(git(main, 'rev-parse', `refs/heads/${opts.branch}`)).toBe(tip);

    const again = createReplica(main, opts);

    expect(again.reattached).toBe(true);
    expect(again.baseCommit).toBe(first.baseCommit);
    expect(git(again.path, 'rev-parse', 'HEAD')).toBe(tip);
  });

  it('新副本在独立目录，可识别并安全删除', () => {
    const created = createReplica(main, opts);
    expect(created.path).toBe(replicaTarget(main, created.name));
    expect(created.path).toContain(path.join('.cgraphx', 'worktrees'));
    expect(replicaLinkOf(created.path)).toMatchObject({ state: 'replica', mainRoot: main });
    expect(removeReplica(main, created.name).state).toBe('removed');
    expect(fs.existsSync(main)).toBe(true);
  });

  it('主目录的需求索引链接到实际副本中的 spec', () => {
    const created = createReplica(main, opts);
    const spec = path.join(created.path, 'docs', 'features', feature, '订单导出-spec.md');
    fs.writeFileSync(spec, '> 负责人: 张三\n');
    const result = syncMyFeatures(main, '张三');
    const content = fs.readFileSync(result.file, 'utf8');
    const rel = path.relative(path.dirname(result.file), spec).split(path.sep).join('/');
    expect(content).toContain(`<${rel}>`);
  });

  it('旧版同级副本仍可识别和删除', () => {
    const created = createReplica(main, opts);
    const oldPath = path.join(base, created.name);
    git(main, 'worktree', 'move', created.path, oldPath);
    git(oldPath, 'config', '--worktree', 'core.excludesFile', path.join(oldPath, '.cgraphx', 'replica-exclude'));
    const file = path.join(main, '.cgraphx', 'replicas', `${created.name}.json`);
    const entry = JSON.parse(fs.readFileSync(file, 'utf8'));
    fs.writeFileSync(file, JSON.stringify({ ...entry, path: oldPath }));
    expect(replicaLinkOf(oldPath)).toMatchObject({ state: 'replica', mainRoot: main });
    expect(removeReplica(main, created.name).state).toBe('removed');
  });

  it('登记路径被改为其他 worktree 时拒绝删除', () => {
    const created = createReplica(main, opts);
    const foreign = path.join(base, 'elsewhere', created.name);
    fs.mkdirSync(path.dirname(foreign));
    git(main, 'worktree', 'move', created.path, foreign);
    const file = path.join(main, '.cgraphx', 'replicas', `${created.name}.json`);
    const entry = JSON.parse(fs.readFileSync(file, 'utf8'));
    fs.writeFileSync(file, JSON.stringify({ ...entry, path: foreign }));
    expect(replicaErrorOf(() => removeReplica(main, created.name)).code).toBe('unsafe_target');
    expect(fs.existsSync(foreign)).toBe(true);
  });

  it('长中文项目名截断后仍可创建目录，且同名仓库保持隔离', () => {
    const label = '项目'.repeat(30);
    const first = path.join(base, 'first', label);
    const second = path.join(base, 'second', label);
    fs.mkdirSync(first, { recursive: true });
    fs.mkdirSync(second, { recursive: true });
    const firstDir = replicaProjectDir(first);
    const secondDir = replicaProjectDir(second);
    expect(firstDir).not.toBe(secondDir);
    expect(Buffer.byteLength(path.basename(firstDir), 'utf8')).toBeLessThanOrEqual(137);
    expect(path.basename(firstDir)).toMatch(/^(?:项目)+-[a-f0-9]{16}$/);
    fs.mkdirSync(firstDir, { recursive: true });
    expect(fs.statSync(firstDir).isDirectory()).toBe(true);
  });

  it('同名仓库的副本位置不同', () => {
    const other = path.join(base, 'other', 'app');
    fs.mkdirSync(other, { recursive: true });
    expect(replicaTarget(main, 'app@需求')).not.toBe(replicaTarget(other, 'app@需求'));
  });

  it('同名分支是别的需求的,报原提示,不接上', () => {
    createReplica(main, opts);

    const err = replicaErrorOf(() =>
      createReplica(main, { featureId: '2026-11-06-积分发放', prefix: '积分发放', branch: opts.branch }),
    );

    expect(err.code).toBe('invalid_args');
    expect(err.message).toContain(`主目录已有本地分支 ${opts.branch}`);
    expect(fs.existsSync(replicaTarget(main, 'app@积分发放'))).toBe(false);
  });
});

describe('createReplica: feature directory in the replica', () => {
  let base: string;
  let main: string;
  const feature = '2026-11-06-订单导出';
  const opts = { featureId: feature, prefix: '订单导出', branch: 'feat/订单导出' };

  beforeEach(() => {
    base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'cgraphx-replica-')));
    main = path.join(base, 'app');
    fs.mkdirSync(main);
    git(main, 'init', '-q', '-b', 'dev/9.9.9');
    commitFile(main, 'README.md');
    createDirectory(main);
    DatabaseConnection.open(getLocalDatabasePath(main)).close();
  });

  afterEach(() => {
    fs.rmSync(base, { recursive: true, force: true });
  });

  it('creates an empty feature directory in the replica when the main directory has none', () => {
    const created = createReplica(main, opts);
    const dir = path.join(created.path, 'docs', 'features', feature);

    expect(fs.statSync(dir).isDirectory()).toBe(true);
    expect(fs.readdirSync(dir)).toEqual([]);
    expect(fs.existsSync(path.join(main, 'docs', 'features', feature))).toBe(false);
  });

  it('keeps the feature directory and its files when the main directory already has them', () => {
    const draft = `${opts.prefix}-功能方案-v1.md`;
    const mainDir = path.join(main, 'docs', 'features', feature);
    fs.mkdirSync(mainDir, { recursive: true });
    fs.writeFileSync(path.join(mainDir, draft), 'draft\n');

    const created = createReplica(main, opts);
    const replicaDir = path.join(created.path, 'docs', 'features', feature);

    expect(fs.readdirSync(replicaDir)).toEqual([draft]);
    expect(fs.readFileSync(path.join(replicaDir, draft), 'utf8')).toBe('draft\n');
  });

  it('rolls back the whole replica when the feature directory cannot be created', () => {
    fs.mkdirSync(path.join(main, 'docs'), { recursive: true });
    fs.writeFileSync(path.join(main, 'docs', 'features'), 'not a directory\n');
    git(main, 'add', 'docs/features');
    git(main, 'commit', '-q', '-m', 'test: docs/features is a file');
    const branches = git(main, 'branch', '--list');

    expect(() => createReplica(main, opts)).toThrow(`在副本里建需求目录 docs/features/${feature}/`);

    expect(git(main, 'branch', '--list')).toBe(branches);
    expect(git(main, 'worktree', 'list')).not.toContain('app@订单导出');
    expect(fs.existsSync(replicaTarget(main, 'app@订单导出'))).toBe(false);
    expect(fs.existsSync(path.join(main, '.cgraphx', 'replicas', 'app@订单导出.json'))).toBe(false);
    expect(fs.readFileSync(path.join(main, 'docs', 'features'), 'utf8')).toBe('not a directory\n');
    expect(git(main, 'status', '--porcelain', '--untracked-files=no')).toBe('');
  });
});
