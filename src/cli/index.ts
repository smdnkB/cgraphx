#!/usr/bin/env node
/**
 * cgraphx CLI — 2.0 main entry.
 *
 * Compiled to `./dist/cli/index.js` and wired as the `cgraphx` bin in
 * package.json. The 2.0 command surface is the three reused subsystems
 * (docs / db / timeline), the `init` / `status` project commands, the
 * self-update `upgrade`, and the Claude Code `install` / `uninstall`
 * flow.
 *
 * What was cut vs. the cgraphx 1.x lineage:
 *   - every code-graph command (explore / query / node / callers /
 *     callees / affected / index / sync / files / context / search / …)
 *   - the MCP `serve` command (no server in 2.0)
 *   - usage collection and the preAction usage-record hook (no collection in 2.0)
 *   - `prompt-hook` (was a graph-front-load hook; no graph in 2.0)
 *   - the WASM-runtime-flag re-exec (no extraction parser in 2.0)
 *   - the Node 25 hard-block (the V8 turboshaft bug it guarded only fired
 *     while compiling the extraction parser)
 *
 * What was kept: commander-based framing, ANSI helpers, the
 * `installFatalHandlers` last-resort handler, the Node floor check, the
 * no-args-runs-installer affordance, and the `-v` / `-version`
 * spellings.
 */

import { Command } from 'commander';
import * as path from 'node:path';
import * as fs from 'node:fs';

import { registerDocsCommands } from '../core/markdown/cli';
import { registerDbCommands } from '../core/dbquery/cli';
import { registerTimelineCommands } from '../core/timeline/cli';
import { registerFeaturesCommands } from '../core/features/cli';
// 组合根例外(仅此一处):cli/index.ts 作为组装入口可经 web 门面接入
// `cgraphx web`;src/web/ 自身只依赖 src/core/,不反向依赖 cli。
import { registerWebCommand } from '../web';

import { buildNodeTooOldBanner, MIN_NODE_MAJOR } from './node-version-check';
import { installFatalHandlers } from './fatal-handler';
import { getCodeGraphDir, unsafeIndexRootReason } from '../core/directory';

// -----------------------------------------------------------------------------
// Node.js version floor.
//
// `engines` in package.json only *warns* on install (unless engine-strict),
// so we hard-block here to actually keep users off unsupported versions.
// The Node 25 special-case from cgraphx 1.x is intentionally gone — that
// block existed solely because of a V8 turboshaft JIT bug that fired while
// compiling the 1.x extraction parser, which 2.0 no longer ships.
// -----------------------------------------------------------------------------
const nodeVersion = process.versions.node;
const nodeMajor = parseInt(nodeVersion.split('.')[0] ?? '0', 10);
if (nodeMajor < MIN_NODE_MAJOR) {
  process.stderr.write(buildNodeTooOldBanner(nodeVersion) + '\n');
  if (!process.env.CGRAPHX_ALLOW_UNSAFE_NODE) {
    process.exit(1);
  }
  // Override active — banner shown for visibility, continuing.
}

// Last-resort fatal handlers. See ./fatal-handler.ts for the rationale
// (the bounded, hang-proof log line is load-bearing).
installFatalHandlers();

// -----------------------------------------------------------------------------
// No-args → interactive installer (same affordance as cgraphx 1.x).
// -----------------------------------------------------------------------------
if (process.argv.length === 2) {
  import('./installer')
    .then(({ runInstaller }) => runInstaller())
    .catch((err) => {
      console.error(
        'Installation failed:',
        err instanceof Error ? err.message : String(err),
      );
      process.exit(1);
    });
} else {
  main();
}

// Dynamic import helper — tsc compiles import() to require() in CJS mode,
// which fails for ESM-only packages (@clack/prompts). Same trick as the
// installer.
// eslint-disable-next-line @typescript-eslint/no-implied-eval
const importESM = new Function('specifier', 'return import(specifier)') as
  (specifier: string) => Promise<typeof import('@clack/prompts')>;

/**
 * Confirmation gate for `upgrade`'s auto project-install when the current
 * directory doesn't look like a cgraphx project (no `.cgraphx/` / `.claude/`).
 * Non-interactive stdin declines (safe default for scripts); a cancelled
 * prompt or a prompt failure also declines — upgrade degrades to
 * "package updated, run install yourself", never crashes on a prompt.
 */
async function confirmProjectInstall(message: string): Promise<boolean> {
  if (!process.stdin.isTTY) return false;
  try {
    const clack = await importESM('@clack/prompts');
    const ans = await clack.confirm({ message, initialValue: false });
    return clack.isCancel(ans) ? false : ans;
  } catch {
    return false;
  }
}

function main(): void {
  const program = new Command();

  // Version from package.json. Reading it at runtime keeps a single source
  // of truth — `npm version` bumps flow through without touching this file.
  const packageJson = JSON.parse(
    fs.readFileSync(path.join(__dirname, '..', '..', 'package.json'), 'utf-8'),
  ) as { version: string };

  // Intercept lowercase `-v` and single-dash `-version` before commander parses
  // (its `--version` short flag is capital `-V`, and its parser rejects a
  // multi-character single-dash flag). The bare `cgraphx version` subcommand
  // is registered further down so the affordance also shows up in `--help`.
  const firstArg = process.argv[2];
  if (firstArg === '-v' || firstArg === '-version') {
    console.log(packageJson.version);
    return;
  }

  // ===========================================================================
  // ANSI helpers (avoid chalk ESM issues).
  // ===========================================================================
  const colors = {
    reset: '\x1b[0m',
    bold: '\x1b[1m',
    dim: '\x1b[2m',
    red: '\x1b[31m',
    green: '\x1b[32m',
    yellow: '\x1b[33m',
    blue: '\x1b[34m',
    cyan: '\x1b[36m',
  };
  const chalk = {
    bold: (s: string) => `${colors.bold}${s}${colors.reset}`,
    dim: (s: string) => `${colors.dim}${s}${colors.reset}`,
    red: (s: string) => `${colors.red}${s}${colors.reset}`,
    green: (s: string) => `${colors.green}${s}${colors.reset}`,
    yellow: (s: string) => `${colors.yellow}${s}${colors.reset}`,
    blue: (s: string) => `${colors.blue}${s}${colors.reset}`,
    cyan: (s: string) => `${colors.cyan}${s}${colors.reset}`,
  };

  program
    .name('cgraphx')
    .description(
      'Local markdown knowledge base, database query, and developer timeline toolkit for AI coding agents.',
    )
    .version(packageJson.version);

  // ===========================================================================
  // Subsystem command groups (B-3 / B-4 / B-5).
  // ===========================================================================
  registerDocsCommands(program);
  registerDbCommands(program);
  registerTimelineCommands(program);
  registerFeaturesCommands(program);

  // web — 本地只读浏览服务(顶层命令,经 web 门面注册;组合根例外见上方 import)。
  registerWebCommand(program);

  // ===========================================================================
  // (init / status / uninit were folded into install / uninstall — see the
  // installer. `install` creates `.cgraphx/` + applies schemas; `uninstall`
  // removes it. There is no separate data-layer command in 2.0.)
  // ===========================================================================

  // ===========================================================================
  // upgrade — inline registration (matches cgraphx 1.x; no register()
  // wrapper). Dynamic import keeps startup fast and isolates the network
  // module.
  // ===========================================================================
  program
    .command('upgrade [version]')
    .description('Update cgraphx and refresh the current project (pull the package, then auto-run install)')
    .option('--check', 'Check whether an update is available without installing')
    .option('-f, --force', 'Reinstall even if already on the target version')
    .option('--no-install', 'Only update the package; skip refreshing the current project')
    .action(
      async (
        versionArg: string | undefined,
        options: { check?: boolean; force?: boolean; install?: boolean },
      ) => {
        const up = await import('./upgrade');
        const projectRoot = process.cwd();
        const method = up.detectInstallMethod({
          filename: __filename,
          platform: process.platform,
          cwd: projectRoot,
        });
        const pin = versionArg || process.env.CGRAPHX_VERSION || undefined;
        const code = await up.runUpgrade(
          {
            version: pin,
            check: options.check,
            force: options.force,
            install: options.install,
          },
          {
            currentVersion: packageJson.version,
            method,
            resolveLatest: () => up.resolveLatestVersion(),
            run: up.defaultRun,
            log: (m: string) => console.log(m),
            warn: (m: string) => console.log(chalk.yellow(m)),
            error: (m: string) => console.error(chalk.red(m)),
            platform: process.platform,
            projectRoot,
            unsafeRootReason: (dir: string) => unsafeIndexRootReason(dir),
            projectMarkerPresent: (dir: string) =>
              fs.existsSync(getCodeGraphDir(dir)) ||
              fs.existsSync(path.join(dir, '.claude')),
            confirmInstall: confirmProjectInstall,
            currentCliEntry: __filename,
            nodeExecPath: process.execPath,
            npmGlobalRoot: () => up.resolveNpmGlobalRoot(process.platform),
            runInstall: up.defaultRunInstall,
          },
        );
        process.exit(code);
      },
    );

  // ===========================================================================
  // version — bare-noun form of `--version`.
  // ===========================================================================
  program
    .command('version')
    .description('Print the installed cgraphx version (also: -v, --version)')
    .action(() => {
      console.log(packageJson.version);
    });

  // ===========================================================================
  // install / uninstall — delegate to the installer (B-9).
  // ===========================================================================
  program
    .command('install')
    .description('Install cgraphx into the current project (skills, hooks, statusLine, .cgraphx/)')
    .option('-t, --target <ids>', 'Target agent(s) (2.0 ships only Claude)')
    .option(
      '-y, --yes',
      'Non-interactive: use defaults (all subsystems, no prompts)',
    )
    .action(
      async (opts: {
        target?: string;
        yes?: boolean;
      }) => {
        const { runInstallerWithOptions } = await import('./installer');
        try {
          await runInstallerWithOptions({
            target: opts.target,
            yes: opts.yes,
          });
        } catch (err) {
          console.error(
            err instanceof Error ? err.message : String(err),
          );
          process.exit(1);
        }
      },
    );

  program
    .command('uninstall')
    .description('Remove cgraphx from the current project (skills, config, .cgraphx/)')
    .option('-t, --target <ids>', 'Target agent(s) (2.0 ships only Claude)')
    .option('-y, --yes', 'Non-interactive: no prompts (also deletes .cgraphx/ without confirming)')
    .option('--keep-data', 'Keep the .cgraphx/ data directory (default: remove it)')
    .action(
      async (opts: {
        target?: string;
        yes?: boolean;
        keepData?: boolean;
      }) => {
        const { runUninstaller } = await import('./installer');
        try {
          await runUninstaller({
            target: opts.target,
            yes: opts.yes,
            keepData: opts.keepData,
          });
        } catch (err) {
          console.error(
            err instanceof Error ? err.message : String(err),
          );
          process.exit(1);
        }
      },
    );

  program.parse();
}
