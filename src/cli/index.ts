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
import { registerCommitGateCommands } from '../core/commit-gate/cli';
import { registerFeaturesCommands } from '../core/features/cli';
import { registerReportCommands } from '../core/report/cli';
import { registerReplicaCommands } from '../core/replica/cli';
import { registerReleaseCommands } from '../core/release/cli';
import { registerProjectCommands } from '../core/project/cli';
import { registerLegacyHookCommands } from './legacy-hook-commands';
import { emitSessionNotices } from '../core/session-notices';

import { buildNodeTooOldBanner, MIN_NODE_MAJOR } from './node-version-check';
import { installFatalHandlers } from './fatal-handler';
import {
  getCodeGraphDir,
  unsafeIndexRootReason,
} from '../core/directory';

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
  // 隐藏的 commit-gate-hook 命令(commit-msg 门禁片段经 PATH 调起)
  registerCommitGateCommands(program);
  registerFeaturesCommands(program);
  registerReportCommands(program);
  registerReplicaCommands(program);
  registerReleaseCommands(program);
  registerProjectCommands(program);
  // 已下掉功能的五个兼容空命令(隐藏,读完 stdin 不做任何事)
  registerLegacyHookCommands(program);

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
    .option('-t, --target <ids>', 'Target agent id(s), comma-separated (e.g. claude-code), or all / none')
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
    .option('-t, --target <ids>', 'Target agent id(s), comma-separated (e.g. claude-code), or all / none')
    .option('-y, --yes', 'Non-interactive: no prompts (also deletes .cgraphx/ without confirming)')
    .option(
      '--keep-data',
      "Keep this directory's .cgraphx/ (knowledge index and my-features); project data in ~/.cgraphx/projects/ is never removed by uninstall",
    )
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

  // ===========================================================================
  // 会话提示的统一挂点(spec F4 / D16):每条命令 action 完成后出一次提示,只写 stderr。
  // 不在任何子系统的 cli 里各调一次——漏一个就不提示(D16 没选)。调 process.exit 的命令
  // 路径(upgrade、install/uninstall 出错)拿不到 postAction,不提示,下一条补上(已知接受项)。
  // ===========================================================================

  // 不算一条的命令名(C-9):隐藏命令、git 钩子调起的命令、`version`(`--help`、`--version`、
  // `help` 不走 action,天然不算)。commander 没有公开的 hidden 读取口,按命令名静态列全
  // (名单实现方式是 plan 允许的局部适配):
  // - timeline 的 8 个隐藏 hook 子命令(agent 配置 / git 钩子调起;T-8 撤 hooks 时名单一并删)
  // - commit-gate-hook(commit-msg 门禁片段调起)、guard(release 的 commit-msg 拦截片段调起)
  // - 已下掉功能的 5 个兼容空命令(旧 agent 配置调起)
  // - version(裸名词形式的 --version)
  const NON_SESSION_COMMAND_NAMES = new Set([
    'timeline-user-prompt-hook',
    'timeline-pre-tool-use-hook',
    'timeline-post-tool-use-hook',
    'timeline-post-tool-use-failure-hook',
    'timeline-stop-hook',
    'timeline-session-start-hook',
    'timeline-session-end-hook',
    'timeline-git-commit-hook',
    'commit-gate-hook',
    'guard',
    'sync-session-start-hook',
    'sync-stop-hook',
    'task-session-start-hook',
    'task-stop-hook',
    'task-post-tool-use-hook',
    'version',
  ]);

  program.hook('postAction', (_thisCommand: Command, actionCommand: Command) => {
    if (NON_SESSION_COMMAND_NAMES.has(actionCommand.name())) return;
    // 提示绝不影响命令:emitSessionNotices 内部整体 try/catch,失败只是不出提示
    emitSessionNotices(process.cwd());
  });

  program.parse();
}
