/**
 * `cgraphx upgrade` — npm-only self-update.
 *
 * cgraphx ships as an npm package, so the single supported download channel is
 * the npm registry: upgrading shells out to `npm install -g cgraphx@<ver>`.
 * The 1.x-era "bundle" path (download `install.sh` / a release zip from GitHub)
 * was removed — those artifacts were never built or published, and a CLI
 * upgrade should not depend on anything but npm.
 *
 * Detection (`detectInstallMethod`) only distinguishes what matters here:
 *   - **npm**   — installed via `npm i -g cgraphx` (or a local `npm i`); the
 *                 upgrade performs `npm install -g cgraphx@<ver>`.
 *   - **npx**   — ephemeral; nothing to upgrade (next `npx` fetches latest).
 *   - **other** — source checkout / anything else; guided back to npm.
 */

import * as path from 'path';
import { spawnSync } from 'child_process';

export const NPM_PACKAGE = 'cgraphx';

// ---------------------------------------------------------------------------
// Install-method detection (pure — fully unit-testable)
// ---------------------------------------------------------------------------

export type InstallMethod =
  | { kind: 'npm'; scope: 'global' | 'local' }
  | { kind: 'npx' }
  | { kind: 'other'; reason: string };

export interface DetectInput {
  /** `__filename` of the running CLI module — `<…>/dist/cli/index.js`. */
  filename: string;
  platform: NodeJS.Platform;
  cwd: string;
}

function toPosix(p: string): string {
  return p.replace(/\\/g, '/');
}

export function detectInstallMethod(input: DetectInput): InstallMethod {
  const isWin = input.platform === 'win32';
  // Path math keyed on the TARGET platform so detection is host-independent
  // (a Windows path resolves correctly even when unit-tested on macOS/Linux).
  const P = isWin ? path.win32 : path.posix;
  const norm = toPosix(input.filename);

  // npx cache: <…>/_npx/<hash>/node_modules/cgraphx/…
  if (norm.includes('/_npx/')) {
    return { kind: 'npx' };
  }
  // npm install (global or local): lives under a node_modules tree.
  if (norm.includes('/node_modules/')) {
    const underCwd = norm.startsWith(toPosix(P.resolve(input.cwd)) + '/');
    return { kind: 'npm', scope: underCwd ? 'local' : 'global' };
  }
  // Anything else (source checkout, legacy layout, unknown) — npm-only now.
  return { kind: 'other', reason: `not an npm install (running from ${input.filename})` };
}

// ---------------------------------------------------------------------------
// Version helpers (pure)
// ---------------------------------------------------------------------------

export interface Semver {
  major: number;
  minor: number;
  patch: number;
  pre: string | null;
}

export function parseSemver(version: string): Semver | null {
  const m = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?/.exec(version.trim());
  if (!m) return null;
  return {
    major: parseInt(m[1]!, 10),
    minor: parseInt(m[2]!, 10),
    patch: parseInt(m[3]!, 10),
    pre: m[4] ?? null,
  };
}

/** Returns >0 if a>b, <0 if a<b, 0 if equal. Throws on unparseable input. */
export function compareVersions(a: string, b: string): number {
  const sa = parseSemver(a);
  const sb = parseSemver(b);
  if (!sa || !sb) throw new Error(`cannot compare versions: "${a}" vs "${b}"`);
  if (sa.major !== sb.major) return sa.major - sb.major;
  if (sa.minor !== sb.minor) return sa.minor - sb.minor;
  if (sa.patch !== sb.patch) return sa.patch - sb.patch;
  // A prerelease is "less than" its release (1.0.0-rc < 1.0.0).
  if (sa.pre && !sb.pre) return -1;
  if (!sa.pre && sb.pre) return 1;
  if (sa.pre && sb.pre) return sa.pre < sb.pre ? -1 : sa.pre > sb.pre ? 1 : 0;
  return 0;
}

export function isUpdateAvailable(current: string, latest: string): boolean {
  try {
    return compareVersions(latest, current) > 0;
  } catch {
    // If either is unparseable (e.g. a dev "0.0.0-unknown"), treat differing
    // strings as "update available" so the user isn't stuck.
    return normalizeVersion(current) !== normalizeVersion(latest);
  }
}

/** `0.9.9` / `v0.9.9` → `v0.9.9` (release tags are v-prefixed). */
export function normalizeVersion(v: string): string {
  const t = v.trim();
  return t.startsWith('v') ? t : `v${t}`;
}

/** Strip a leading `v`: `v0.9.9` → `0.9.9`. */
export function stripV(v: string): string {
  const t = v.trim();
  return t.startsWith('v') ? t.slice(1) : t;
}

// ---------------------------------------------------------------------------
// Latest-version resolution (npm registry)
// ---------------------------------------------------------------------------

/**
 * Resolve the latest published version (e.g. `v2.0.0`) from the npm registry
 * via `npm view cgraphx version`. npm-only by design — no GitHub dependency.
 * npm is guaranteed present for anyone who installed via npm/npx, and the
 * registry has none of the GitHub API's rate-limit problems.
 */
export async function resolveLatestVersion(): Promise<string> {
  const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  const r = spawnSync(npm, ['view', NPM_PACKAGE, 'version'], { encoding: 'utf-8' });
  const version = (r.stdout ?? '').trim();
  if (r.status !== 0 || !/^\d+\.\d+\.\d+/.test(version)) {
    throw new Error(
      'could not resolve the latest version from npm. Check your network / registry, or pin a version: `cgraphx upgrade <version>`.'
    );
  }
  return normalizeVersion(version);
}

// ---------------------------------------------------------------------------
// Orchestrator
// ---------------------------------------------------------------------------

export interface UpgradeOptions {
  /** Pin a specific version (positional arg or CGRAPHX_VERSION). */
  version?: string;
  /** Report current vs latest, don't change anything. */
  check?: boolean;
  /** Reinstall even if already on the resolved version. */
  force?: boolean;
}

/** Injectable side-effects so the orchestrator stays unit-testable. */
export interface UpgradeDeps {
  currentVersion: string;
  method: InstallMethod;
  resolveLatest: (pin?: string) => Promise<string>;
  /** Run a command inheriting stdio; returns its exit code (-1 = spawn failed). */
  run: (cmd: string, args: string[], env?: NodeJS.ProcessEnv) => number;
  log: (msg: string) => void;
  warn: (msg: string) => void;
  error: (msg: string) => void;
  platform: NodeJS.Platform;
}

const c = {
  bold: (s: string) => `\x1b[1m${s}\x1b[0m`,
  dim: (s: string) => `\x1b[2m${s}\x1b[0m`,
  green: (s: string) => `\x1b[32m${s}\x1b[0m`,
  yellow: (s: string) => `\x1b[33m${s}\x1b[0m`,
  cyan: (s: string) => `\x1b[36m${s}\x1b[0m`,
};

/** The honest, additive reminder shown after a successful upgrade. */
export function reindexAdvisory(): string {
  // upgrade is a pure binary swap — it touches no project's `.claude/` config
  // or `.cgraphx/` data. To pick up this version's skills / hooks / workflow
  // guidance (and any markdown-parser improvements), re-run install per project.
  return [
    c.dim('upgrade 只更新了 CLI 本体,没有改动任何项目的配置。'),
    c.dim('要让各项目用上这一版的 skills / hooks / 工作方式与解析改进,请到项目内重跑:'),
    `  ${c.cyan('cgraphx install')}    ${c.dim('# 刷新 .claude/ skills、配置与 .claude/CLAUDE.md')}`,
  ].join('\n');
}

/**
 * Returns the process exit code (0 = success / nothing to do, 1 = failure).
 */
export async function runUpgrade(opts: UpgradeOptions, deps: UpgradeDeps): Promise<number> {
  const { currentVersion, method } = deps;

  // Resolve the target version (pinned or latest).
  let latest: string;
  try {
    latest = normalizeVersion(opts.version || (await deps.resolveLatest()));
  } catch (err) {
    deps.error(err instanceof Error ? err.message : String(err));
    return 1;
  }

  const currentDisplay = normalizeVersion(currentVersion);
  deps.log(`${c.bold('cgraphx')}  current ${c.cyan(currentDisplay)}  ${opts.version ? 'target' : 'latest'} ${c.cyan(latest)}`);

  const updateAvailable = isUpdateAvailable(currentVersion, latest);

  if (opts.check) {
    if (updateAvailable) {
      deps.log(c.yellow(`An update is available: ${currentDisplay} → ${latest}`));
      deps.log(c.dim('Run `cgraphx upgrade` to install it.'));
    } else {
      deps.log(c.green(`You’re on the latest version (${currentDisplay}).`));
    }
    return 0;
  }

  if (!updateAvailable && !opts.force && !opts.version) {
    deps.log(c.green(`Already up to date (${currentDisplay}).`));
    deps.log(c.dim('Use `--force` to reinstall, or `cgraphx upgrade <version>` to change versions.'));
    return 0;
  }

  // npm-only dispatch: npm performs the real update; npx fetches on demand
  // (nothing to do); anything else is guided back to npm.
  switch (method.kind) {
    case 'npm': {
      // npm version specs have no leading "v" (`@0.9.8`, not `@v0.9.8` — the
      // latter resolves as a nonexistent dist-tag).
      const code = upgradeNpm(method, opts.version ? stripV(latest) : 'latest', deps);
      // Future: when a release changes the `.cgraphx/cgraphx.db` data model, a
      // schema-migration step would hook in here (after `code === 0`). None yet.
      return code;
    }
    case 'npx':
      deps.log(c.green('npx always runs the latest version on demand — nothing to upgrade.'));
      deps.log(c.dim(`Force a fresh fetch with: npx ${NPM_PACKAGE}@latest`));
      return 0;
    default:
      deps.warn(`This cgraphx isn't an npm install (${method.reason}).`);
      deps.log(c.dim(`Install / upgrade via npm:  npm install -g ${NPM_PACKAGE}@latest`));
      deps.log(c.dim('(Running from a source checkout? `git pull && npm run build`.)'));
      return 0;
  }
}

function upgradeNpm(
  method: Extract<InstallMethod, { kind: 'npm' }>,
  versionSpec: string,
  deps: UpgradeDeps
): number {
  const npm = deps.platform === 'win32' ? 'npm.cmd' : 'npm';
  const args = method.scope === 'global'
    ? ['install', '-g', `${NPM_PACKAGE}@${versionSpec}`]
    : ['install', `${NPM_PACKAGE}@${versionSpec}`];
  deps.log(c.dim(`Running: ${npm} ${args.join(' ')}`));
  const code = deps.run(npm, args, process.env);
  if (code !== 0) {
    deps.error(`npm exited with code ${code}.`);
    if (method.scope === 'global') {
      deps.log(c.dim('If this is a permissions error (EACCES), your global prefix needs sudo, or use a'));
      deps.log(c.dim('Node version manager (nvm/fnm) so global installs don’t require root.'));
    }
    return 1;
  }
  deps.log('');
  deps.log(c.green('✓ Upgrade complete.'));
  deps.log(reindexAdvisory());
  return 0;
}

// ---------------------------------------------------------------------------
// Production deps wiring (used by the CLI)
// ---------------------------------------------------------------------------

export function defaultRun(cmd: string, args: string[], env?: NodeJS.ProcessEnv): number {
  const r = spawnSync(cmd, args, { stdio: 'inherit', env: env ?? process.env });
  if (r.error) return -1;
  return r.status ?? -1;
}
