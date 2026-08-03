/**
 * `cgraphx upgrade` — npm-only self-update + project refresh.
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
 *   - **npx**   — ephemeral; nothing to pull (next `npx` fetches latest).
 *   - **other** — source checkout / anything else; guided back to npm.
 *
 * Since 2.0.x, `upgrade` is meant to be run INSIDE a project directory: after
 * the package pull it automatically refreshes the project by running `install`
 * with the freshly-installed CLI (`node <fresh-entry> install -y`), so one
 * command brings both the CLI and the current project up to date. Guards:
 * unsafe roots ($HOME / filesystem root) skip the install with a warning; a
 * directory with no `.cgraphx/` / `.claude/` asks for confirmation first
 * (non-interactive stdin declines); `--no-install` restores the old
 * package-only behavior.
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
// Windows spawn quirk
// ---------------------------------------------------------------------------

/**
 * Since the April-2024 security fix (CVE-2024-27980, Node ≥ 20.12), spawning
 * a `.bat`/`.cmd` file WITHOUT `shell: true` throws EINVAL on Windows.
 * `npm` / `npx` resolve to `npm.cmd` / `npx.cmd` there, so every spawn of
 * them needs the shell. All arg vectors involved are hard-coded (no user
 * input), so `shell: true` carries no injection risk here.
 */
function needsShell(cmd: string): boolean {
  return process.platform === 'win32' && /\.(cmd|bat)$/i.test(cmd);
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
  const r = spawnSync(npm, ['view', NPM_PACKAGE, 'version'], {
    encoding: 'utf-8',
    shell: needsShell(npm),
  });
  const version = (r.stdout ?? '').trim();
  if (r.status !== 0 || !/^\d+\.\d+\.\d+/.test(version)) {
    throw new Error(
      'could not resolve the latest version from npm. Check your network / registry, or pin a version: `cgraphx upgrade <version>`.'
    );
  }
  return normalizeVersion(version);
}

/**
 * The global npm `node_modules` root (`npm root -g`) — where a global
 * `npm install -g cgraphx@…` puts the fresh package. Returns null when npm
 * can't answer (non-zero exit / blank output); callers degrade to a
 * "run `cgraphx install` yourself" hint rather than guessing.
 */
export function resolveNpmGlobalRoot(platform: NodeJS.Platform): string | null {
  const npm = platform === 'win32' ? 'npm.cmd' : 'npm';
  const r = spawnSync(npm, ['root', '-g'], {
    encoding: 'utf-8',
    shell: platform === 'win32' && needsShell(npm),
  });
  if (r.status !== 0) return null;
  const root = (r.stdout ?? '').split(/\r?\n/).find((l) => l.trim().length > 0)?.trim();
  return root ? root : null;
}

// ---------------------------------------------------------------------------
// Project-install planning (pure — fully unit-testable)
// ---------------------------------------------------------------------------

export type ProjectInstallPlan =
  | { cmd: string; args: string[] }
  | { unavailable: string };

export interface PlanProjectInstallInput {
  method: InstallMethod;
  /** Whether a package pull actually happened (false = up-to-date / npx). */
  pulled: boolean;
  projectRoot: string;
  /** The running CLI's entry file (`__filename` of dist/cli/index.js). */
  currentCliEntry: string;
  /** `process.execPath` — the node binary to run the fresh CLI with. */
  nodeExecPath: string;
  /** `npm root -g` result; only consulted for a pulled global npm install. */
  npmGlobalRoot: string | null;
}

/**
 * Decide how to run the project `install` after the upgrade. The install must
 * run from the FRESH package (its bundled `.claude-template/` assets are what
 * we're refreshing to), so after a pull we point at the just-installed entry:
 *
 *   - npm global → `<npm root -g>/cgraphx/dist/cli/index.js`
 *   - npm local  → `<projectRoot>/node_modules/cgraphx/dist/cli/index.js`
 *
 * When no pull happened (already up to date) — and always for npx, whose
 * running process IS the fetched package — the current entry is the right one.
 * `other` (source checkout) has no supported automatic path.
 */
export function planProjectInstall(input: PlanProjectInstallInput): ProjectInstallPlan {
  const { method } = input;
  if (method.kind === 'other') {
    return { unavailable: method.reason };
  }
  if (!input.pulled || method.kind === 'npx') {
    return {
      cmd: input.nodeExecPath,
      args: [input.currentCliEntry, 'install', '-y'],
    };
  }
  if (method.scope === 'local') {
    const entry = path.join(
      input.projectRoot, 'node_modules', NPM_PACKAGE, 'dist', 'cli', 'index.js',
    );
    return { cmd: input.nodeExecPath, args: [entry, 'install', '-y'] };
  }
  if (!input.npmGlobalRoot) {
    return { unavailable: 'could not resolve the npm global root (`npm root -g` failed)' };
  }
  const entry = path.join(input.npmGlobalRoot, NPM_PACKAGE, 'dist', 'cli', 'index.js');
  return { cmd: input.nodeExecPath, args: [entry, 'install', '-y'] };
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
  /**
   * Refresh the current project after the pull (default true). Commander's
   * `--no-install` sets this to false, restoring package-only behavior.
   */
  install?: boolean;
}

/** Injectable side-effects so the orchestrator stays unit-testable. */
export interface UpgradeDeps {
  currentVersion: string;
  method: InstallMethod;
  resolveLatest: (pin?: string) => Promise<string>;
  /** Run the package-pull command (npm) with inherited stdio; exit code (-1 = spawn failed). */
  run: (cmd: string, args: string[], env?: NodeJS.ProcessEnv) => number;
  log: (msg: string) => void;
  warn: (msg: string) => void;
  error: (msg: string) => void;
  platform: NodeJS.Platform;
  /** The directory upgrade was invoked in — the project to refresh. */
  projectRoot: string;
  /** Why projectRoot is an unsafe root ($HOME / filesystem root), or null when fine. */
  unsafeRootReason: (dir: string) => string | null;
  /** Whether dir looks like a cgraphx-connected project (`.cgraphx/` or `.claude/` present). */
  projectMarkerPresent: (dir: string) => boolean;
  /** Confirm installing in an unrecognized dir; must return false when stdin isn't interactive. */
  confirmInstall: (message: string) => Promise<boolean>;
  /** The running CLI entry file (`__filename`). */
  currentCliEntry: string;
  /** The node binary to run the fresh CLI with (`process.execPath`). */
  nodeExecPath: string;
  /** `npm root -g`, or null when it can't be resolved. Only called when needed. */
  npmGlobalRoot: () => string | null;
  /** Run the project-install child with inherited stdio in cwd; exit code (-1 = spawn failed). */
  runInstall: (cmd: string, args: string[], cwd: string) => number;
}

const c = {
  bold: (s: string) => `\x1b[1m${s}\x1b[0m`,
  dim: (s: string) => `\x1b[2m${s}\x1b[0m`,
  green: (s: string) => `\x1b[32m${s}\x1b[0m`,
  yellow: (s: string) => `\x1b[33m${s}\x1b[0m`,
  cyan: (s: string) => `\x1b[36m${s}\x1b[0m`,
};

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
      deps.log(c.dim('Run `cgraphx upgrade` inside a project directory to install it and refresh the project.'));
    } else {
      deps.log(c.green(`You’re on the latest version (${currentDisplay}).`));
    }
    return 0;
  }

  // -------------------------------------------------------------------------
  // Step 1: pull the package (unless already up to date and not forced/pinned).
  // -------------------------------------------------------------------------
  let pulled = false;

  if (!updateAvailable && !opts.force && !opts.version) {
    deps.log(c.green(`Already up to date (${currentDisplay}).`));
  } else {
    switch (method.kind) {
      case 'npm': {
        // npm version specs have no leading "v" (`@0.9.8`, not `@v0.9.8` — the
        // latter resolves as a nonexistent dist-tag).
        const code = upgradeNpm(method, opts.version ? stripV(latest) : 'latest', deps);
        if (code !== 0) return code;
        pulled = true;
        break;
      }
      case 'npx':
        // npx fetched this CLI on demand — there is nothing to pull; the
        // running process is the version the project gets refreshed with.
        deps.log(c.dim('npx fetches on demand — nothing to pull.'));
        break;
      default:
        deps.warn(`This cgraphx isn't an npm install (${method.reason}).`);
        deps.log(c.dim(`Install / upgrade via npm:  npm install -g ${NPM_PACKAGE}@latest`));
        deps.log(c.dim('(Running from a source checkout? `git pull && npm run build`, then `cgraphx install` in each project.)'));
        return 0;
    }
  }

  // -------------------------------------------------------------------------
  // Step 2: refresh the current project (`install -y` with the fresh CLI).
  // -------------------------------------------------------------------------
  if (opts.install === false) {
    deps.log(c.dim('Skipped the project refresh (--no-install). Run `cgraphx install` inside each project to update its skills / hooks.'));
    return 0;
  }

  return runProjectInstallStep(deps, pulled);
}

/**
 * The project-refresh half of upgrade. Exit codes: 0 = refreshed, or skipped
 * for an advisory reason (unsafe root / declined / unresolvable entry) — the
 * CLI update itself succeeded either way; 1 = the install was attempted and
 * failed.
 */
async function runProjectInstallStep(deps: UpgradeDeps, pulled: boolean): Promise<number> {
  const { projectRoot } = deps;

  const unsafeReason = deps.unsafeRootReason(projectRoot);
  if (unsafeReason) {
    deps.warn(`Skipped the project refresh: the current directory looks like ${unsafeReason}.`);
    deps.log(c.dim('Run `cgraphx install` inside a real project root to refresh its .claude/ skills and hooks.'));
    return 0;
  }

  if (!deps.projectMarkerPresent(projectRoot)) {
    const ok = await deps.confirmInstall(
      '当前目录没有 .cgraphx/ 或 .claude/,不像是已接入 cgraphx 的项目根目录。install 会在此目录创建它们——确认继续?(建议 cd 到项目根目录再跑 `cgraphx upgrade`)',
    );
    if (!ok) {
      deps.log(c.dim('Skipped the project refresh. Run `cgraphx install` inside your project when ready.'));
      return 0;
    }
  }

  const globalRoot = pulled && deps.method.kind === 'npm' && deps.method.scope === 'global'
    ? deps.npmGlobalRoot()
    : null;
  const plan = planProjectInstall({
    method: deps.method,
    pulled,
    projectRoot,
    currentCliEntry: deps.currentCliEntry,
    nodeExecPath: deps.nodeExecPath,
    npmGlobalRoot: globalRoot,
  });
  if ('unavailable' in plan) {
    deps.warn(`Couldn't auto-run the project install (${plan.unavailable}).`);
    deps.log(c.dim('Run `cgraphx install` inside the project to refresh it.'));
    return 0;
  }

  deps.log('');
  deps.log(c.bold(`Refreshing project install in ${projectRoot} ...`));
  const code = deps.runInstall(plan.cmd, plan.args, projectRoot);
  if (code !== 0) {
    deps.error(`CLI 更新成功,但项目 install 失败(exit ${code})——请到项目内手动重跑 \`cgraphx install\`。`);
    return 1;
  }
  deps.log(c.green('✓ 完成——CLI 与当前项目都已对齐到当前版本。重启 agent 以加载新技能。'));
  return 0;
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
  deps.log(c.green('✓ Package updated.'));
  return 0;
}

// ---------------------------------------------------------------------------
// Production deps wiring (used by the CLI)
// ---------------------------------------------------------------------------

export function defaultRun(cmd: string, args: string[], env?: NodeJS.ProcessEnv): number {
  const r = spawnSync(cmd, args, {
    stdio: 'inherit',
    env: env ?? process.env,
    shell: needsShell(cmd),
  });
  if (r.error) return -1;
  return r.status ?? -1;
}

/** Like `defaultRun`, but pinned to the project directory being refreshed. */
export function defaultRunInstall(cmd: string, args: string[], cwd: string): number {
  const r = spawnSync(cmd, args, {
    stdio: 'inherit',
    cwd,
    shell: needsShell(cmd),
  });
  if (r.error) return -1;
  return r.status ?? -1;
}
