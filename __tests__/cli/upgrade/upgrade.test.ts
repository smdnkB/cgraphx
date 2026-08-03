/**
 * Tests for the npm-only `cgraphx upgrade`:
 *   - `detectInstallMethod` — npm (global/local) / npx / other.
 *   - `runUpgrade` — pull dispatch, the automatic project-install step and
 *     its gates (unsafe root / unrecognized-dir confirm / --no-install),
 *     --check, pin, failure paths.
 *   - `planProjectInstall` — fresh-entry resolution per install method.
 *   - pure version helpers.
 *
 * The orchestrator is exercised with injected stub deps, so no real `npm`
 * invocation or network access happens here.
 */

import { describe, it, expect, vi } from 'vitest';
import {
  detectInstallMethod,
  runUpgrade,
  planProjectInstall,
  compareVersions,
  isUpdateAvailable,
  normalizeVersion,
  stripV,
} from '../../../src/cli/upgrade';
import type { UpgradeDeps, InstallMethod } from '../../../src/cli/upgrade';

type Mock = ReturnType<typeof vi.fn>;

const NODE = '/usr/bin/node';
const CURRENT_ENTRY = '/usr/local/lib/node_modules/cgraphx/dist/cli/index.js';
const GLOBAL_ROOT = '/usr/local/lib/node_modules';
const PROJECT = '/home/me/project';

function makeDeps(over: Partial<UpgradeDeps> = {}): UpgradeDeps & {
  run: Mock; warn: Mock; error: Mock; runInstall: Mock; confirmInstall: Mock;
} {
  return {
    currentVersion: '2.0.0',
    method: { kind: 'npm', scope: 'global' } as InstallMethod,
    resolveLatest: async () => 'v2.0.0',
    run: vi.fn(() => 0),
    log: () => {},
    warn: vi.fn(),
    error: vi.fn(),
    platform: 'linux',
    projectRoot: PROJECT,
    unsafeRootReason: () => null,
    projectMarkerPresent: () => true,
    confirmInstall: vi.fn(async () => true),
    currentCliEntry: CURRENT_ENTRY,
    nodeExecPath: NODE,
    npmGlobalRoot: () => GLOBAL_ROOT,
    runInstall: vi.fn(() => 0),
    ...over,
  } as UpgradeDeps & {
    run: Mock; warn: Mock; error: Mock; runInstall: Mock; confirmInstall: Mock;
  };
}

describe('detectInstallMethod', () => {
  it('detects a global npm install', () => {
    expect(detectInstallMethod({
      filename: '/usr/local/lib/node_modules/cgraphx/dist/cli/index.js',
      platform: 'linux',
      cwd: '/home/me/project',
    })).toEqual({ kind: 'npm', scope: 'global' });
  });

  it('detects a local npm install (under cwd)', () => {
    expect(detectInstallMethod({
      filename: '/home/me/project/node_modules/cgraphx/dist/cli/index.js',
      platform: 'linux',
      cwd: '/home/me/project',
    })).toEqual({ kind: 'npm', scope: 'local' });
  });

  it('detects npx (matched before the node_modules rule)', () => {
    expect(detectInstallMethod({
      filename: '/home/me/.npm/_npx/abc123/node_modules/cgraphx/dist/cli/index.js',
      platform: 'linux',
      cwd: '/home/me/project',
    })).toEqual({ kind: 'npx' });
  });

  it('falls back to other for a source checkout', () => {
    const m = detectInstallMethod({
      filename: '/home/me/cgraphx/dist/cli/index.js',
      platform: 'linux',
      cwd: '/home/me/cgraphx',
    });
    expect(m.kind).toBe('other');
  });
});

describe('runUpgrade (pull + automatic project install)', () => {
  it('npm global: pulls, then installs with the fresh global entry', async () => {
    const deps = makeDeps({ resolveLatest: async () => 'v2.1.0' });
    expect(await runUpgrade({}, deps)).toBe(0);
    expect(deps.run).toHaveBeenCalledWith('npm', ['install', '-g', 'cgraphx@latest'], expect.anything());
    expect(deps.runInstall).toHaveBeenCalledWith(
      NODE,
      [`${GLOBAL_ROOT}/cgraphx/dist/cli/index.js`, 'install', '-y'],
      PROJECT,
    );
  });

  it('npm: installs the pinned version when one is given', async () => {
    const deps = makeDeps({ resolveLatest: async () => 'v2.1.0' });
    expect(await runUpgrade({ version: '2.0.5' }, deps)).toBe(0);
    expect(deps.run).toHaveBeenCalledWith('npm', ['install', '-g', 'cgraphx@2.0.5'], expect.anything());
  });

  it('npm local: drops the -g flag and uses the project node_modules entry', async () => {
    const deps = makeDeps({
      method: { kind: 'npm', scope: 'local' } as InstallMethod,
      resolveLatest: async () => 'v2.1.0',
    });
    expect(await runUpgrade({}, deps)).toBe(0);
    expect(deps.run).toHaveBeenCalledWith('npm', ['install', 'cgraphx@latest'], expect.anything());
    expect(deps.runInstall).toHaveBeenCalledWith(
      NODE,
      [`${PROJECT}/node_modules/cgraphx/dist/cli/index.js`, 'install', '-y'],
      PROJECT,
    );
  });

  it('already up to date: no pull, but still refreshes the project with the current entry', async () => {
    const deps = makeDeps({ resolveLatest: async () => 'v2.0.0' });
    expect(await runUpgrade({}, deps)).toBe(0);
    expect(deps.run).not.toHaveBeenCalled();
    expect(deps.runInstall).toHaveBeenCalledWith(
      NODE,
      [CURRENT_ENTRY, 'install', '-y'],
      PROJECT,
    );
  });

  it('--force re-pulls even when up to date', async () => {
    const deps = makeDeps({ resolveLatest: async () => 'v2.0.0' });
    expect(await runUpgrade({ force: true }, deps)).toBe(0);
    expect(deps.run).toHaveBeenCalled();
    expect(deps.runInstall).toHaveBeenCalled();
  });

  it('--check reports but never pulls or installs', async () => {
    const deps = makeDeps({ resolveLatest: async () => 'v2.1.0' });
    expect(await runUpgrade({ check: true }, deps)).toBe(0);
    expect(deps.run).not.toHaveBeenCalled();
    expect(deps.runInstall).not.toHaveBeenCalled();
  });

  it('--no-install pulls but skips the project refresh', async () => {
    const deps = makeDeps({ resolveLatest: async () => 'v2.1.0' });
    expect(await runUpgrade({ install: false }, deps)).toBe(0);
    expect(deps.run).toHaveBeenCalled();
    expect(deps.runInstall).not.toHaveBeenCalled();
  });

  it('npx: nothing to pull; refreshes the project with the running entry', async () => {
    const deps = makeDeps({ method: { kind: 'npx' }, resolveLatest: async () => 'v2.1.0' });
    expect(await runUpgrade({}, deps)).toBe(0);
    expect(deps.run).not.toHaveBeenCalled();
    expect(deps.runInstall).toHaveBeenCalledWith(
      NODE,
      [CURRENT_ENTRY, 'install', '-y'],
      PROJECT,
    );
  });

  it('other: guides back to npm, no pull, no auto install', async () => {
    const deps = makeDeps({ method: { kind: 'other', reason: 'source' }, resolveLatest: async () => 'v2.1.0' });
    expect(await runUpgrade({}, deps)).toBe(0);
    expect(deps.run).not.toHaveBeenCalled();
    expect(deps.runInstall).not.toHaveBeenCalled();
    expect(deps.warn).toHaveBeenCalled();
  });

  it('resolveLatest failure → exit 1 + error, nothing runs', async () => {
    const deps = makeDeps({ resolveLatest: async () => { throw new Error('no network'); } });
    expect(await runUpgrade({}, deps)).toBe(1);
    expect(deps.error).toHaveBeenCalled();
    expect(deps.run).not.toHaveBeenCalled();
    expect(deps.runInstall).not.toHaveBeenCalled();
  });

  it('pull failure → exit 1, project install never runs', async () => {
    const deps = makeDeps({ resolveLatest: async () => 'v2.1.0', run: vi.fn(() => 1) });
    expect(await runUpgrade({}, deps)).toBe(1);
    expect(deps.runInstall).not.toHaveBeenCalled();
  });

  it('unsafe root (e.g. $HOME): still pulls, but skips the project install', async () => {
    const deps = makeDeps({
      resolveLatest: async () => 'v2.1.0',
      unsafeRootReason: () => 'your home directory',
    });
    expect(await runUpgrade({}, deps)).toBe(0);
    expect(deps.run).toHaveBeenCalled();
    expect(deps.runInstall).not.toHaveBeenCalled();
    expect(deps.warn).toHaveBeenCalled();
  });

  it('no project marker + declined confirm → pull happens, install skipped', async () => {
    const deps = makeDeps({
      resolveLatest: async () => 'v2.1.0',
      projectMarkerPresent: () => false,
      confirmInstall: vi.fn(async () => false),
    });
    expect(await runUpgrade({}, deps)).toBe(0);
    expect(deps.run).toHaveBeenCalled();
    expect(deps.confirmInstall).toHaveBeenCalled();
    expect(deps.runInstall).not.toHaveBeenCalled();
  });

  it('no project marker + accepted confirm → install runs', async () => {
    const deps = makeDeps({
      resolveLatest: async () => 'v2.1.0',
      projectMarkerPresent: () => false,
      confirmInstall: vi.fn(async () => true),
    });
    expect(await runUpgrade({}, deps)).toBe(0);
    expect(deps.confirmInstall).toHaveBeenCalled();
    expect(deps.runInstall).toHaveBeenCalled();
  });

  it('unresolvable npm global root after pull → advisory skip, exit 0', async () => {
    const deps = makeDeps({ resolveLatest: async () => 'v2.1.0', npmGlobalRoot: () => null });
    expect(await runUpgrade({}, deps)).toBe(0);
    expect(deps.run).toHaveBeenCalled();
    expect(deps.runInstall).not.toHaveBeenCalled();
    expect(deps.warn).toHaveBeenCalled();
  });

  it('project install failure → exit 1 with an error', async () => {
    const deps = makeDeps({ resolveLatest: async () => 'v2.1.0', runInstall: vi.fn(() => 3) });
    expect(await runUpgrade({}, deps)).toBe(1);
    expect(deps.error).toHaveBeenCalled();
  });
});

describe('planProjectInstall', () => {
  const base = {
    projectRoot: PROJECT,
    currentCliEntry: CURRENT_ENTRY,
    nodeExecPath: NODE,
    npmGlobalRoot: GLOBAL_ROOT,
  };

  it('not pulled → runs the current entry', () => {
    const plan = planProjectInstall({ ...base, method: { kind: 'npm', scope: 'global' }, pulled: false });
    expect(plan).toEqual({ cmd: NODE, args: [CURRENT_ENTRY, 'install', '-y'] });
  });

  it('npm global pulled → fresh entry under the npm global root', () => {
    const plan = planProjectInstall({ ...base, method: { kind: 'npm', scope: 'global' }, pulled: true });
    expect(plan).toEqual({
      cmd: NODE,
      args: [`${GLOBAL_ROOT}/cgraphx/dist/cli/index.js`, 'install', '-y'],
    });
  });

  it('npm global pulled but npm root unknown → unavailable', () => {
    const plan = planProjectInstall({ ...base, npmGlobalRoot: null, method: { kind: 'npm', scope: 'global' }, pulled: true });
    expect('unavailable' in plan).toBe(true);
  });

  it('npm local pulled → fresh entry under the project node_modules', () => {
    const plan = planProjectInstall({ ...base, method: { kind: 'npm', scope: 'local' }, pulled: true });
    expect(plan).toEqual({
      cmd: NODE,
      args: [`${PROJECT}/node_modules/cgraphx/dist/cli/index.js`, 'install', '-y'],
    });
  });

  it('npx always uses the running entry (it IS the fetched package)', () => {
    const plan = planProjectInstall({ ...base, method: { kind: 'npx' }, pulled: true });
    expect(plan).toEqual({ cmd: NODE, args: [CURRENT_ENTRY, 'install', '-y'] });
  });

  it('other → unavailable', () => {
    const plan = planProjectInstall({ ...base, method: { kind: 'other', reason: 'source checkout' }, pulled: false });
    expect('unavailable' in plan).toBe(true);
  });
});

describe('version helpers', () => {
  it('compareVersions orders correctly', () => {
    expect(compareVersions('1.2.3', '1.2.3')).toBe(0);
    expect(compareVersions('1.2.4', '1.2.3')).toBeGreaterThan(0);
    expect(compareVersions('1.2.3', '1.3.0')).toBeLessThan(0);
    expect(compareVersions('2.0.0-rc', '2.0.0')).toBeLessThan(0);
  });

  it('isUpdateAvailable', () => {
    expect(isUpdateAvailable('2.0.0', 'v2.0.1')).toBe(true);
    expect(isUpdateAvailable('2.0.0', 'v2.0.0')).toBe(false);
  });

  it('normalizeVersion / stripV', () => {
    expect(normalizeVersion('2.0.0')).toBe('v2.0.0');
    expect(normalizeVersion('v2.0.0')).toBe('v2.0.0');
    expect(stripV('v2.0.0')).toBe('2.0.0');
    expect(stripV('2.0.0')).toBe('2.0.0');
  });
});
