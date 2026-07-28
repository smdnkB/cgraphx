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

import {
  getCodeGraphDir,
  isInitialized,
} from '../core/directory';
import { DatabaseConnection, getDatabasePath } from '../core/db';
import { ensureMarkdownSchema } from '../core/markdown/schema-bootstrap';
import { ensureTimelineSchema } from '../core/timeline/schema-bootstrap';
import { registerDocsCommands } from '../core/markdown/cli';
import { registerDbCommands } from '../core/dbquery/cli';
import { registerTimelineCommands } from '../core/timeline/cli';
import { registerFeaturesCommands } from '../core/features/cli';

import { buildNodeTooOldBanner, MIN_NODE_MAJOR } from './node-version-check';
import { installFatalHandlers } from './fatal-handler';
import { getGlyphs } from './ui/glyphs';
import { runStatus } from './status';

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

  // ===========================================================================
  // init — create an empty shared cgraphx.db and ensure subsystem schemas.
  //
  // 2.0 init deliberately does NOT build a code-graph index (there is no graph
  // layer in 2.0). It just creates the .cgraphx/ directory, opens the shared
  // SQLite DB (which is schema-agnostic at the base-layer level), and asks the
  // markdown + timeline subsystems to apply their own idempotent schemas on
  // top. Re-running init on an already-initialized project is a no-op.
  // ===========================================================================
  program
    .command('init [path]')
    .description('Initialize the shared .cgraphx/ database for this project')
    .action(async (pathArg: string | undefined) => {
      const projectRoot = path.resolve(pathArg || process.cwd());

      if (isInitialized(projectRoot)) {
        console.log(`Already initialized in ${projectRoot}`);
        return;
      }

      try {
        // createDirectory: makes .cgraphx/, writes .gitignore, throws if
        // cgraphx.db already exists (race guard; the isInitialized check
        // above makes this branch unlikely).
        const { createDirectory } = await import('../core/directory');
        createDirectory(projectRoot);

        const conn = DatabaseConnection.open(getDatabasePath(projectRoot));
        try {
          const db = conn.getDb();
          ensureMarkdownSchema(db);
          ensureTimelineSchema(db);
        } finally {
          conn.close();
        }

        console.log(
          `${chalk.green(getGlyphs().ok)} Initialized cgraphx in ${projectRoot}`,
        );
        console.log(
          chalk.dim(
            `  ${getCodeGraphDir(projectRoot)}  (markdown + timeline schemas applied)`,
          ),
        );
      } catch (err) {
        console.error(
          `${chalk.red(getGlyphs().err)} Failed: ${err instanceof Error ? err.message : String(err)}`,
        );
        process.exit(1);
      }
    });

  // ===========================================================================
  // status — placeholder wiring. B-7 fills in the full report.
  // ===========================================================================
  program
    .command('status [path]')
    .description('Show initialization state and subsystem summaries')
    .option('-j, --json', 'Output as JSON')
    .action(async (pathArg: string | undefined, options: { json?: boolean }) => {
      const projectRoot = path.resolve(pathArg || process.cwd());
      await runStatus(projectRoot, { json: options.json });
    });

  // ===========================================================================
  // uninit — delete the project's .cgraphx/ data directory.
  //
  // The inverse of `init`: drops the shared cgraphx.db plus every transient
  // file the runtime keeps in .cgraphx/. Sibling project files (.claude/,
  // settings.json, the git post-commit hook) are untouched — those are owned
  // by `uninstall` / `timeline uninstall`. Confirmation is y/N by default;
  // `-f` / `--force` skips it.
  // ===========================================================================
  program
    .command('uninit [path]')
    .description('Remove the .cgraphx/ data directory from a project')
    .option('-f, --force', 'Skip the confirmation prompt')
    .action(async (pathArg: string | undefined, options: { force?: boolean }) => {
      const projectRoot = path.resolve(pathArg || process.cwd());

      if (!isInitialized(projectRoot)) {
        console.log(`${chalk.yellow(getGlyphs().warn)} cgraphx is not initialized in ${projectRoot}`);
        return;
      }

      if (!options.force) {
        const readline = await import('node:readline');
        const rl = readline.createInterface({
          input: process.stdin,
          output: process.stdout,
        });
        const answer = await new Promise<string>((resolve) => {
          rl.question(
            chalk.yellow(
              `${getGlyphs().warn} This will permanently delete all cgraphx data in ${projectRoot}. Continue? (y/N) `,
            ),
            resolve,
          );
        });
        rl.close();
        if (answer.trim().toLowerCase() !== 'y') {
          console.log('Cancelled');
          return;
        }
      }

      try {
        const { removeDirectory } = await import('../core/directory');
        removeDirectory(projectRoot);
        console.log(`${chalk.green(getGlyphs().ok)} Removed cgraphx from ${projectRoot}`);
      } catch (err) {
        console.error(
          `${chalk.red(getGlyphs().err)} Failed to uninitialize: ${err instanceof Error ? err.message : String(err)}`,
        );
        process.exit(1);
      }
    });

  // ===========================================================================
  // upgrade — inline registration (matches cgraphx 1.x; no register()
  // wrapper). Dynamic import keeps startup fast and isolates the network
  // module.
  // ===========================================================================
  program
    .command('upgrade [version]')
    .description('Update cgraphx to the latest release (or a specific version)')
    .option('--check', 'Check whether an update is available without installing')
    .option('-f, --force', 'Reinstall even if already on the target version')
    .action(
      async (
        versionArg: string | undefined,
        options: { check?: boolean; force?: boolean },
      ) => {
        const up = await import('./upgrade');
        const method = up.detectInstallMethod({
          filename: __filename,
          platform: process.platform,
          cwd: process.cwd(),
        });
        const pin = versionArg || process.env.CGRAPHX_VERSION || undefined;
        const code = await up.runUpgrade(
          { version: pin, check: options.check, force: options.force },
          {
            currentVersion: packageJson.version,
            method,
            resolveLatest: () => up.resolveLatestVersion(),
            run: up.defaultRun,
            hasCommand: up.hasCommand,
            log: (m: string) => console.log(m),
            warn: (m: string) => console.log(chalk.yellow(m)),
            error: (m: string) => console.error(chalk.red(m)),
            platform: process.platform,
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
    .description('Install cgraphx into Claude Code (skills, hooks, statusLine)')
    .option('-t, --target <ids>', 'Target agent(s) (2.0 ships only Claude)')
    .option(
      '-l, --location <where>',
      'Install location: "global" or "local". Default: prompt',
    )
    .option(
      '-y, --yes',
      'Non-interactive: defaults to --location=local, prompt-hook on',
    )
    .option(
      '--prompt-hook <bool>',
      'Wire the front-load prompt hook (true) or skip it (false)',
    )
    .action(
      async (opts: {
        target?: string;
        location?: string;
        yes?: boolean;
        promptHook?: string;
      }) => {
        const { runInstallerWithOptions } = await import('./installer');
        if (
          opts.location &&
          opts.location !== 'global' &&
          opts.location !== 'local'
        ) {
          console.error(
            `${chalk.red(getGlyphs().err)} --location must be "global" or "local" (got "${opts.location}").`,
          );
          process.exit(1);
        }
        const promptHook =
          opts.promptHook === undefined
            ? undefined
            : opts.promptHook === 'true';
        try {
          await runInstallerWithOptions({
            target: opts.target,
            location: opts.location as 'global' | 'local' | undefined,
            promptHook,
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
    .description('Remove cgraphx from Claude Code')
    .option('-t, --target <ids>', 'Target agent(s) (2.0 ships only Claude)')
    .option(
      '-l, --location <where>',
      'Uninstall location: "global" or "local". Default: prompt',
    )
    .option('-y, --yes', 'Non-interactive: defaults to --location=global')
    .action(
      async (opts: {
        target?: string;
        location?: string;
        yes?: boolean;
      }) => {
        const { runUninstaller } = await import('./installer');
        if (
          opts.location &&
          opts.location !== 'global' &&
          opts.location !== 'local'
        ) {
          console.error(
            `${chalk.red(getGlyphs().err)} --location must be "global" or "local" (got "${opts.location}").`,
          );
          process.exit(1);
        }
        try {
          await runUninstaller({
            target: opts.target,
            location: opts.location as 'global' | 'local' | undefined,
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

  program.parse();
}
