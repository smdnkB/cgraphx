/**
 * CLI smoke tests for `codegraph db ...` (spec §5.2, T-8).
 *
 * Covers exit codes + format selection + disabled short-circuit. Does NOT
 * connect to a real DB — uses a fake profile pointing at an unreachable
 * host to drive connection-failure paths, and the disabled switch for the
 * success-shaped short-circuit.
 *
 * Driver-level integration (T-4/T-5) is in driver-mysql.test.ts /
 * driver-postgres.test.ts and needs Docker.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { spawnSync } from 'node:child_process';

import {
  PROFILES_FILENAME,
  PROFILES_PATH_ENV,
  DISABLED_ENV,
} from '../../../src/core/dbquery/constants';

// 2.0 bin layout: dist/cli/index.js (was dist/bin/codegraph.js in 1.x).
// Test dir is __tests__/core/dbquery/, so three `..` to reach the repo root.
const BIN = path.join(__dirname, '..', '..', '..', 'dist', 'cli', 'index.js');
const PREV_ENV = { ...process.env };

function makeTmpProject(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'cg-dbq-cli-'));
}

function writeProfiles(dir: string, content: unknown): void {
  fs.mkdirSync(path.join(dir, '.cgraphx'), { recursive: true });
  fs.writeFileSync(
    path.join(dir, '.cgraphx', PROFILES_FILENAME),
    typeof content === 'string' ? content : JSON.stringify(content),
  );
}

function runDb(args: string[], cwd: string, env: NodeJS.ProcessEnv = {}): {
  stdout: string;
  stderr: string;
  status: number | null;
} {
  const res = spawnSync(process.execPath, [BIN, 'db', ...args], {
    cwd,
    env: { ...process.env, ...env, CGRAPHX_ALLOW_UNSAFE_NODE: '1' },
    encoding: 'utf8',
  });
  return {
    stdout: res.stdout ?? '',
    stderr: res.stderr ?? '',
    status: res.status,
  };
}

describe('codegraph db: exit codes + formats (spec §5.2)', () => {
  let tmpProject: string;

  beforeEach(() => {
    delete process.env[PROFILES_PATH_ENV];
    delete process.env[DISABLED_ENV];
    tmpProject = makeTmpProject();
  });
  afterEach(() => {
    process.env = { ...PREV_ENV };
    fs.rmSync(tmpProject, { recursive: true, force: true });
  });

  it('exits 2 with config error when no profiles configured', () => {
    // Point env path at a nonexistent file so no config is loaded.
    const r = runDb(['profiles'], tmpProject, {
      CGRAPHX_DB_PROFILES_PATH: path.join(tmpProject, 'nope.json'),
    });
    expect(r.status).toBe(2);
    expect(r.stderr).toMatch(/No db-profiles\.json found/);
  });

  it('exits 0 and emits JSON for `profiles` when config exists', () => {
    writeProfiles(tmpProject, {
      default: 'p1',
      p1: { type: 'mysql', host: 'h', user: 'u', password: 'p', database: 'd' },
    });
    const r = runDb(['profiles'], tmpProject);
    expect(r.status).toBe(0);
    const parsed = JSON.parse(r.stdout) as { profiles: Array<{ name: string }> };
    expect(parsed.profiles[0]!.name).toBe('p1');
  });

  it('never includes password in `profiles` output', () => {
    writeProfiles(tmpProject, {
      default: 'p1',
      p1: { type: 'mysql', host: 'h', user: 'u', password: 'supersecret', database: 'd' },
    });
    const r = runDb(['profiles'], tmpProject);
    expect(r.stdout).not.toMatch(/supersecret/);
    expect(r.stdout).not.toMatch(/"password"/);
  });

  it('exits 5 on invalid --mode', () => {
    writeProfiles(tmpProject, {
      default: 'p1',
      p1: { type: 'mysql', host: 'h', user: 'u', password: 'p', database: 'd' },
    });
    const r = runDb(['schema', '--mode=bogus'], tmpProject);
    expect(r.status).toBe(5);
    expect(r.stderr).toMatch(/Invalid --mode/);
  });

  it('exits 5 when --table missing for ddl mode', () => {
    writeProfiles(tmpProject, {
      default: 'p1',
      p1: { type: 'mysql', host: 'h', user: 'u', password: 'p', database: 'd' },
    });
    const r = runDb(['schema', '--mode=ddl'], tmpProject);
    expect(r.status).toBe(5);
    expect(r.stderr).toMatch(/--table is required/);
  });

  it('exits 5 on invalid ddl table identifier (backtick)', () => {
    writeProfiles(tmpProject, {
      default: 'p1',
      p1: { type: 'mysql', host: 'h', user: 'u', password: 'p', database: 'd' },
    });
    const r = runDb(['schema', '--mode=ddl', '--table=a`b'], tmpProject);
    expect(r.status).toBe(5);
    expect(r.stderr).toMatch(/forbidden characters/i);
  });

  it('exits 5 on invalid ddl table identifier (semicolon)', () => {
    writeProfiles(tmpProject, {
      default: 'p1',
      p1: { type: 'mysql', host: 'h', user: 'u', password: 'p', database: 'd' },
    });
    const r = runDb(['schema', '--mode=ddl', '--table=a;b'], tmpProject);
    expect(r.status).toBe(5);
    expect(r.stderr).toMatch(/forbidden characters/i);
  });

  it('exits 3 when SQL contains write keyword', () => {
    writeProfiles(tmpProject, {
      default: 'p1',
      p1: { type: 'mysql', host: 'h', user: 'u', password: 'p', database: 'd' },
    });
    const r = runDb(['query', '--sql=DROP TABLE users'], tmpProject);
    expect(r.status).toBe(3);
    expect(r.stderr).toMatch(/forbidden keyword/i);
    expect(r.stderr).toMatch(/DROP/);
  });

  it('exits 3 on multi-statement SQL', () => {
    writeProfiles(tmpProject, {
      default: 'p1',
      p1: { type: 'mysql', host: 'h', user: 'u', password: 'p', database: 'd' },
    });
    const r = runDb(['query', '--sql=SELECT 1; DROP TABLE users'], tmpProject);
    expect(r.status).toBe(3);
  });

  it('exits 4 with fixed text when disabled via env', () => {
    writeProfiles(tmpProject, {
      default: 'p1',
      p1: { type: 'mysql', host: 'h', user: 'u', password: 'p', database: 'd' },
    });
    const r = runDb(['query', '--sql=SELECT 1'], tmpProject, {
      CGRAPHX_DB_QUERY_DISABLED: '1',
    });
    expect(r.status).toBe(4);
    expect(r.stderr).toMatch(/数据库无法连接/);
  });

  it('exits 4 with fixed text when disabled via config', () => {
    writeProfiles(tmpProject, {
      enabled: false,
      default: 'p1',
      p1: { type: 'mysql', host: 'h', user: 'u', password: 'p', database: 'd' },
    });
    const r = runDb(['profiles'], tmpProject);
    expect(r.status).toBe(4);
    expect(r.stderr).toMatch(/数据库无法连接/);
  });

  it('exits 4 on connection failure (unreachable host)', () => {
    writeProfiles(tmpProject, {
      default: 'p1',
      p1: { type: 'mysql', host: '192.0.2.1', port: 1, user: 'u', password: 'p', database: 'd' },
    });
    const r = runDb(['query', '--sql=SELECT 1'], tmpProject);
    expect(r.status).toBe(4);
    // Error message should not leak password.
    expect(r.stderr).not.toMatch(/password/i);
  });
});
