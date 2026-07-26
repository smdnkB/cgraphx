/**
 * Tests for config.ts — spec §2.2-§2.5, §9.1 #8-#10.
 *
 * Isolation: HOME / USERPROFILE is redirected to a tmp dir per test so the
 * user-global path doesn't collide with the dev machine's real config.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';

import { loadProfiles, resolveProfile } from '../../../src/core/dbquery/config';
import {
  PROFILES_FILENAME,
  PROFILES_PATH_ENV,
  DISABLED_ENV,
} from '../../../src/core/dbquery/constants';
import { ConfigNotFoundError } from '../../../src/core/dbquery/errors';

const PREV_ENV = { ...process.env };
const PREV_HOME = process.env.HOME;
const PREV_USERPROFILE = process.env.USERPROFILE;

function makeTmpProject(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'cg-dbq-cfg-'));
}

function writeConfig(dir: string, content: unknown): string {
  const codegraphDir = path.join(dir, '.cgraphx');
  fs.mkdirSync(codegraphDir, { recursive: true });
  const p = path.join(codegraphDir, PROFILES_FILENAME);
  fs.writeFileSync(p, typeof content === 'string' ? content : JSON.stringify(content), 'utf8');
  return p;
}

function setUserGlobalRoot(root: string): void {
  // Redirect what config.ts reads as the user-global path. Node's os.homedir()
  // on POSIX respects HOME; on Windows it respects USERPROFILE.
  process.env.HOME = root;
  process.env.USERPROFILE = root;
}

function clearEnv(): void {
  delete process.env[PROFILES_PATH_ENV];
  delete process.env[DISABLED_ENV];
}

describe('config: three-tier load order (spec §2.2, §9.1 #8)', () => {
  let tmpProject: string;
  let fakeHome: string;

  beforeEach(() => {
    clearEnv();
    tmpProject = makeTmpProject();
    fakeHome = makeTmpProject();
    setUserGlobalRoot(fakeHome);
  });

  afterEach(() => {
    clearEnv();
    if (PREV_HOME === undefined) delete process.env.HOME;
    else process.env.HOME = PREV_HOME;
    if (PREV_USERPROFILE === undefined) delete process.env.USERPROFILE;
    else process.env.USERPROFILE = PREV_USERPROFILE;
    fs.rmSync(tmpProject, { recursive: true, force: true });
    fs.rmSync(fakeHome, { recursive: true, force: true });
  });

  it('throws ConfigNotFoundError when no config exists anywhere', () => {
    // No env, no project-local, no user-global (fakeHome is empty).
    expect(() => loadProfiles(tmpProject)).toThrow(ConfigNotFoundError);
  });

  it('reads project-local when only it exists', () => {
    writeConfig(tmpProject, {
      default: 'local1',
      local1: { type: 'postgres', host: 'h', user: 'u', password: 'p', database: 'd' },
    });
    const cfg = loadProfiles(tmpProject);
    expect(cfg.profiles).toHaveLength(1);
    expect(cfg.profiles[0]!.name).toBe('local1');
    expect(cfg.defaultProfile).toBe('local1');
    expect(cfg.sources).toContain('project-local');
  });

  it('CGRAPHX_DB_PROFILES_PATH env var overrides everything', () => {
    const envFile = path.join(tmpProject, 'custom.json');
    fs.writeFileSync(
      envFile,
      JSON.stringify({
        default: 'env1',
        env1: { type: 'mysql', host: 'eh', user: 'eu', password: 'ep', database: 'ed' },
      }),
    );
    process.env[PROFILES_PATH_ENV] = envFile;
    const cfg = loadProfiles(tmpProject);
    expect(cfg.profiles).toHaveLength(1);
    expect(cfg.profiles[0]!.name).toBe('env1');
    expect(cfg.sources).toEqual(['env']);
  });

  it('project-local overrides user-global for same-named profile', () => {
    writeConfig(tmpProject, {
      default: 'shared',
      shared: { type: 'postgres', host: 'local-host', user: 'lu', password: 'lp', database: 'ld' },
    });
    writeConfig(fakeHome, {
      shared: { type: 'postgres', host: 'global-host', user: 'gu', password: 'gp', database: 'gd' },
      onlyGlobal: { type: 'mysql', host: 'gh2', user: 'gu2', password: 'gp2', database: 'gd2' },
    });
    const cfg = loadProfiles(tmpProject);
    const shared = cfg.profiles.find(p => p.name === 'shared');
    expect(shared?.host).toBe('local-host');
    const onlyG = cfg.profiles.find(p => p.name === 'onlyGlobal');
    expect(onlyG?.host).toBe('gh2');
    expect(cfg.defaultProfile).toBe('shared');
  });

  it('falls back to user-global when project-local absent', () => {
    writeConfig(fakeHome, {
      default: 'g1',
      g1: { type: 'mysql', host: 'gh', user: 'gu', password: 'gp', database: 'gd' },
    });
    const cfg = loadProfiles(tmpProject);
    expect(cfg.profiles).toHaveLength(1);
    expect(cfg.profiles[0]!.name).toBe('g1');
    expect(cfg.sources).toContain('user-global');
  });
});

describe('config: edge cases (spec §2.3)', () => {
  let tmpProject: string;
  beforeEach(() => {
    clearEnv();
    tmpProject = makeTmpProject();
  });
  afterEach(() => {
    clearEnv();
    fs.rmSync(tmpProject, { recursive: true, force: true });
  });

  it('reports JSON parse errors with file path', () => {
    writeConfig(tmpProject, '{ this is not json ');
    expect(() => loadProfiles(tmpProject)).toThrow(/JSON parse failed/);
  });

  it('reports missing required field host', () => {
    writeConfig(tmpProject, {
      p1: { type: 'mysql', user: 'u', password: 'p', database: 'd' }, // no host
    });
    expect(() => loadProfiles(tmpProject)).toThrow(/host/);
  });

  it('reports invalid driver type', () => {
    writeConfig(tmpProject, {
      p1: { type: 'sqlite', host: 'h', user: 'u', password: 'p', database: 'd' },
    });
    expect(() => loadProfiles(tmpProject)).toThrow(/type must be 'mysql' or 'postgres'/);
  });

  it('reports default pointing to nonexistent profile', () => {
    writeConfig(tmpProject, {
      default: 'ghost',
      p1: { type: 'mysql', host: 'h', user: 'u', password: 'p', database: 'd' },
    });
    expect(() => loadProfiles(tmpProject)).toThrow(/Default profile "ghost" does not exist/);
  });

  it('applies default port for MySQL when not specified', () => {
    writeConfig(tmpProject, {
      p1: { type: 'mysql', host: 'h', user: 'u', password: 'p', database: 'd' },
    });
    const cfg = loadProfiles(tmpProject);
    expect(cfg.profiles[0]!.port).toBe(3306);
  });

  it('applies default port for PostgreSQL when not specified', () => {
    writeConfig(tmpProject, {
      p1: { type: 'postgres', host: 'h', user: 'u', password: 'p', database: 'd' },
    });
    const cfg = loadProfiles(tmpProject);
    expect(cfg.profiles[0]!.port).toBe(5432);
  });

  it('applies default schema=public for PostgreSQL', () => {
    writeConfig(tmpProject, {
      p1: { type: 'postgres', host: 'h', user: 'u', password: 'p', database: 'd' },
    });
    const cfg = loadProfiles(tmpProject);
    expect(cfg.profiles[0]!.schema).toBe('public');
  });
});

describe('config: subsystem disable switch (spec §2.5, §9.1 #8)', () => {
  let tmpProject: string;
  beforeEach(() => {
    clearEnv();
    tmpProject = makeTmpProject();
  });
  afterEach(() => {
    clearEnv();
    fs.rmSync(tmpProject, { recursive: true, force: true });
  });

  it('enabled=true when nothing sets disabled', () => {
    writeConfig(tmpProject, {
      p1: { type: 'mysql', host: 'h', user: 'u', password: 'p', database: 'd' },
    });
    const cfg = loadProfiles(tmpProject);
    expect(cfg.enabled).toBe(true);
  });

  it('CGRAPHX_DB_QUERY_DISABLED=1 disables', () => {
    writeConfig(tmpProject, {
      p1: { type: 'mysql', host: 'h', user: 'u', password: 'p', database: 'd' },
    });
    process.env[DISABLED_ENV] = '1';
    const cfg = loadProfiles(tmpProject);
    expect(cfg.enabled).toBe(false);
  });

  it('CGRAPHX_DB_QUERY_DISABLED=false does NOT disable', () => {
    writeConfig(tmpProject, {
      p1: { type: 'mysql', host: 'h', user: 'u', password: 'p', database: 'd' },
    });
    process.env[DISABLED_ENV] = 'false';
    const cfg = loadProfiles(tmpProject);
    expect(cfg.enabled).toBe(true);
  });

  it('CGRAPHX_DB_QUERY_DISABLED=0 does NOT disable', () => {
    writeConfig(tmpProject, {
      p1: { type: 'mysql', host: 'h', user: 'u', password: 'p', database: 'd' },
    });
    process.env[DISABLED_ENV] = '0';
    const cfg = loadProfiles(tmpProject);
    expect(cfg.enabled).toBe(true);
  });

  it('enabled:false in project-local config disables', () => {
    writeConfig(tmpProject, {
      enabled: false,
      p1: { type: 'mysql', host: 'h', user: 'u', password: 'p', database: 'd' },
    });
    const cfg = loadProfiles(tmpProject);
    expect(cfg.enabled).toBe(false);
  });

  it('env var overrides config enabled:true', () => {
    writeConfig(tmpProject, {
      enabled: true,
      p1: { type: 'mysql', host: 'h', user: 'u', password: 'p', database: 'd' },
    });
    process.env[DISABLED_ENV] = 'yes';
    const cfg = loadProfiles(tmpProject);
    expect(cfg.enabled).toBe(false);
  });
});

describe('config: resolveProfile', () => {
  let tmpProject: string;
  beforeEach(() => {
    clearEnv();
    tmpProject = makeTmpProject();
    writeConfig(tmpProject, {
      default: 'p1',
      p1: { type: 'mysql', host: 'h', user: 'u', password: 'p', database: 'd' },
      p2: { type: 'postgres', host: 'h2', user: 'u2', password: 'p2', database: 'd2' },
    });
  });
  afterEach(() => {
    fs.rmSync(tmpProject, { recursive: true, force: true });
  });

  it('uses default when no name given', () => {
    const cfg = loadProfiles(tmpProject);
    const p = resolveProfile(cfg);
    expect(p.name).toBe('p1');
  });

  it('uses explicit name', () => {
    const cfg = loadProfiles(tmpProject);
    const p = resolveProfile(cfg, 'p2');
    expect(p.name).toBe('p2');
  });

  it('throws ConfigNotFoundError for unknown name', () => {
    const cfg = loadProfiles(tmpProject);
    expect(() => resolveProfile(cfg, 'ghost')).toThrow(/Profile "ghost" not found/);
  });
});
