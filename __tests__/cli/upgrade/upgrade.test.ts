/**
 * Tests for the npm-only `cgraphx upgrade`:
 *   - `detectInstallMethod` — npm (global/local) / npx / other.
 *   - `runUpgrade` — npm dispatch, npx/other no-ops, --check, pin, failure.
 *   - pure version helpers.
 *
 * The orchestrator is exercised with injected stub deps, so no real `npm`
 * invocation or network access happens here.
 */

import { describe, it, expect, vi } from 'vitest';
import {
  detectInstallMethod,
  runUpgrade,
  compareVersions,
  isUpdateAvailable,
  normalizeVersion,
  stripV,
} from '../../../src/cli/upgrade';
import type { UpgradeDeps, InstallMethod } from '../../../src/cli/upgrade';

type Mock = ReturnType<typeof vi.fn>;

function makeDeps(over: Partial<UpgradeDeps> = {}): UpgradeDeps & { run: Mock; warn: Mock; error: Mock } {
  return {
    currentVersion: '2.0.0',
    method: { kind: 'npm', scope: 'global' } as InstallMethod,
    resolveLatest: async () => 'v2.0.0',
    run: vi.fn(() => 0),
    log: () => {},
    warn: vi.fn(),
    error: vi.fn(),
    platform: 'linux',
    ...over,
  } as UpgradeDeps & { run: Mock; warn: Mock; error: Mock };
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

describe('runUpgrade (npm-only dispatch)', () => {
  it('npm: runs `npm install -g cgraphx@latest` when an update is available', async () => {
    const deps = makeDeps({ resolveLatest: async () => 'v2.1.0' });
    expect(await runUpgrade({}, deps)).toBe(0);
    expect(deps.run).toHaveBeenCalledWith('npm', ['install', '-g', 'cgraphx@latest'], expect.anything());
  });

  it('npm: installs the pinned version when one is given', async () => {
    const deps = makeDeps();
    expect(await runUpgrade({ version: '2.0.5' }, deps)).toBe(0);
    expect(deps.run).toHaveBeenCalledWith('npm', ['install', '-g', 'cgraphx@2.0.5'], expect.anything());
  });

  it('npm: local scope drops the -g flag', async () => {
    const deps = makeDeps({
      method: { kind: 'npm', scope: 'local' } as InstallMethod,
      resolveLatest: async () => 'v2.1.0',
    });
    expect(await runUpgrade({}, deps)).toBe(0);
    expect(deps.run).toHaveBeenCalledWith('npm', ['install', 'cgraphx@latest'], expect.anything());
  });

  it('npm: already up to date → no run', async () => {
    const deps = makeDeps({ resolveLatest: async () => 'v2.0.0' });
    expect(await runUpgrade({}, deps)).toBe(0);
    expect(deps.run).not.toHaveBeenCalled();
  });

  it('--check reports but never runs', async () => {
    const deps = makeDeps({ resolveLatest: async () => 'v2.1.0' });
    expect(await runUpgrade({ check: true }, deps)).toBe(0);
    expect(deps.run).not.toHaveBeenCalled();
  });

  it('npx: nothing to upgrade, no run', async () => {
    const deps = makeDeps({ method: { kind: 'npx' }, resolveLatest: async () => 'v2.1.0' });
    expect(await runUpgrade({}, deps)).toBe(0);
    expect(deps.run).not.toHaveBeenCalled();
  });

  it('other: guides back to npm, no run', async () => {
    const deps = makeDeps({ method: { kind: 'other', reason: 'source' }, resolveLatest: async () => 'v2.1.0' });
    expect(await runUpgrade({}, deps)).toBe(0);
    expect(deps.run).not.toHaveBeenCalled();
    expect(deps.warn).toHaveBeenCalled();
  });

  it('resolveLatest failure → exit 1 + error, no run', async () => {
    const deps = makeDeps({ resolveLatest: async () => { throw new Error('no network'); } });
    expect(await runUpgrade({}, deps)).toBe(1);
    expect(deps.error).toHaveBeenCalled();
    expect(deps.run).not.toHaveBeenCalled();
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
