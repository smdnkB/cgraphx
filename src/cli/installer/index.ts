/**
 * cgraphx Interactive Installer (2.0)
 *
 * Single target: Claude Code. Wires the bundled `.claude/` template
 * (skills / agents / commands / hooks / plugins), the cgraphx-specific
 * hooks + statusLine, and (opt-in) the front-load prompt hook into the
 * user's Claude Code configuration. Optionally registers the markdown /
 * dbquery / timeline subsystems.
 *
 * 2.0 cut points versus 1.x: NO server config is written (no server in
 * 2.0); NO usage stats are collected; the live graph watcher / git-sync-hook
 * fallback is gone (no graph in 2.0); and only Claude Code is shipped
 * (every other 1.x agent target wrote only the now-removed server config).
 *
 * Uses @clack/prompts for the interactive UI; `runInstallerWithOptions`
 * is the non-interactive entry point used by the `--target` flag.
 */

import { execSync } from 'child_process';
import * as path from 'path';
import * as fs from 'fs';
import {
  ALL_TARGETS,
  detectAll,
  resolveTargetFlag,
} from './targets/registry';
import type { AgentTarget, Location } from './targets/types';
import { getCodeGraphDir } from '../../core/directory';
import { NPM_PACKAGE } from '../upgrade';

// Dynamic import helper — tsc compiles import() to require() in CJS mode,
// which fails for ESM-only packages. This bypasses the transformation.
// eslint-disable-next-line @typescript-eslint/no-implied-eval
const importESM = new Function('specifier', 'return import(specifier)') as
  (specifier: string) => Promise<typeof import('@clack/prompts')>;

function getVersion(): string {
  try {
    const packageJsonPath = path.join(__dirname, '..', '..', '..', 'package.json');
    const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8'));
    return packageJson.version;
  } catch {
    return '0.0.0';
  }
}

export interface RunInstallerOptions {
  /**
   * Accepted for back-compat. In 2.0 only Claude is shipped, so any
   * non-empty value effectively resolves to `[claudeTarget]` — the
   * flag is parsed (and unknown ids error) but no longer drives a
   * multi-agent prompt.
   *
   * Comma-separated target list, or `auto` / `all` / `none`.
   */
  target?: string;
  /** Skip the location prompt; use this value directly. */
  location?: Location;
  /** Skip the prompt-hook prompt; use this value directly. */
  promptHook?: boolean;
  /**
   * Skip every confirm and use defaults: location=local, promptHook=true.
   * For scripting / CI.
   */
  yes?: boolean;
}

/**
 * Interactive entry point — preserves the historical UX (`cgraphx
 * install` with no args goes through the prompts).
 */
export async function runInstaller(): Promise<void> {
  return runInstallerWithOptions({});
}

export async function runInstallerWithOptions(opts: RunInstallerOptions): Promise<void> {
  const clack = await importESM('@clack/prompts');

  clack.intro(`cgraphx v${getVersion()}`);

  const useDefaults = opts.yes === true;

  // Step 1: targets. 2.0 ships only Claude, so there's no multi-select —
  // just resolve the (legacy) --target flag if present and move on.
  const targets = await resolveTargets(clack, opts, useDefaults);
  if (targets.length === 0) {
    clack.outro('未选择任何 agent —— 无操作。');
    return;
  }

  // Step 2: install the cgraphx npm package on PATH (only when NOT already
  // there). Running this for an already-installed user is noise + fragile
  // (re-running `npm install -g <pkg>` pulls from the registry, which fails
  // pre-publish or in air-gapped setups even though the CLI works fine).
  if (!useDefaults) {
    const existingPath = detectCgraphxOnPath();
    if (existingPath) {
      clack.log.info(`cgraphx CLI 已在 PATH 上(${existingPath})—— 跳过安装步骤。`);
    } else {
      const shouldInstallGlobally = await clack.confirm({
        message: '是否安装 cgraphx CLI 到 PATH?(运行 cgraphx 子命令需要)',
        initialValue: true,
      });
      if (clack.isCancel(shouldInstallGlobally)) {
        clack.cancel('安装已取消。');
        process.exit(0);
      }
      if (shouldInstallGlobally) {
        const s = clack.spinner();
        s.start('正在安装 cgraphx CLI...');
        try {
          // Capture stderr so the real failure (404 from registry, EACCES,
          // network) surfaces instead of being hidden behind a guessed
          // "permission denied" message.
          const result = execSync(`npm install -g ${NPM_PACKAGE}`, {
            stdio: ['pipe', 'pipe', 'pipe'],
            windowsHide: true,
          });
          s.stop('cgraphx CLI 已安装到 PATH');
          void result; // output suppressed — npm progress bars aren't useful here
        } catch (err) {
          const stderr = extractStderr(err);
          s.stop('cgraphx CLI 安装失败');
          clack.log.warn(formatInstallHint(stderr));
        }
      } else {
        clack.log.info('已跳过 CLI 安装 —— 没有它部分子命令将无法运行');
      }
    }
  }

  // Step 3: where the per-agent config files should land. Default LOCAL
  // (project-level) — keeps the user's global ~/.claude/ untouched unless
  // they explicitly opt in with --location=global.
  let location: Location;
  if (opts.location) {
    location = opts.location;
  } else if (useDefaults) {
    location = 'local';
  } else {
    const sel = await clack.select({
      message: '配置应用到当前项目,还是所有项目?',
      options: [
        { value: 'local'  as const, label: '仅当前项目(推荐)',  hint: './.claude' },
        { value: 'global' as const, label: '⚠️  所有项目(不建议)', hint: '会影响你所有项目;如非必要不要选' },
      ],
      initialValue: 'local' as const,
    });
    if (clack.isCancel(sel)) {
      clack.cancel('安装已取消。');
      process.exit(0);
    }
    location = sel;
  }

  // Step 4: front-load prompt hook (`cgraphx prompt-hook`). Opt-in via the
  // installer prompt (default-yes): `true` writes it; `false` strips any
  // prior install so opting out round-trips; `undefined` (the implicit
  // default in the multi-target flow) leaves it untouched.
  let promptHook: boolean | undefined;
  if (opts.promptHook !== undefined) {
    promptHook = opts.promptHook;
  } else if (useDefaults) {
    promptHook = true;
  } else {
    const ans = await clack.confirm({
      message:
        '⚠️  是否启用 cgraphx 前置注入?(非常不建议 —— 仅对不会主动调工具的弱 agent 有用)',
      initialValue: false,
    });
    if (clack.isCancel(ans)) {
      clack.cancel('安装已取消。');
      process.exit(0);
    }
    promptHook = ans;
  }

  // Step 5: per-target install loop.
  for (const target of targets) {
    if (!target.supportsLocation(location)) {
      clack.log.warn(
        `${target.displayName}:已跳过 —— 不支持 --location=${location}。`,
      );
      continue;
    }
    const result = target.install(location, { promptHook });
    for (const file of result.files) {
      const verb = file.action === 'unchanged'
        ? 'Unchanged'
        : file.action === 'created' ? 'Created'
          : file.action === 'removed' ? 'Removed'
            : file.action === 'overwritten' ? 'Overwritten'
              : 'Updated';
      clack.log.success(`${target.displayName}: ${verb} ${tildify(file.path)}`);
    }
    for (const note of result.notes ?? []) {
      clack.log.info(`${target.displayName}: ${note}`);
    }
  }

  // Step 5½: optional subsystem setup — docs / db / timeline.
  // Each is independent and runs only if the user keeps it checked.
  // Skipped silently under --yes if their preconditions aren't met
  // (e.g. db init needs .cgraphx/ to exist; docs needs docs/knowledge/).
  const projectRoot = process.cwd();
  const cgraphxExists = fs.existsSync(getCodeGraphDir(projectRoot));
  const docsDir = path.join(projectRoot, 'docs', 'knowledge');
  const docsHasMd = fs.existsSync(docsDir) &&
    fs.readdirSync(docsDir).some(f => f.endsWith('.md') || f.endsWith('.mdx'));

  type Subsystem = 'docs' | 'db' | 'timeline';
  let chosen: Subsystem[];
  if (useDefaults) {
    chosen = ['docs', 'db', 'timeline'];
  } else {
    const sel = await clack.multiselect({
      message: '配置可选子系统(回车确认默认全选)',
      options: [
        { value: 'docs' as const,     label: '文档知识库',     hint: docsHasMd ? '扫描 docs/knowledge/' : 'docs/knowledge/ 不存在 — 跳过' },
        { value: 'db' as const,       label: '数据库查询',     hint: cgraphxExists ? '生成 .cgraphx/db-profiles.json 模板' : '.cgraphx/ 不存在 — 跳过' },
        { value: 'timeline' as const, label: 'Developer Timeline', hint: '装 Claude Code hooks(项目级)' },
      ],
      initialValues: ['docs', 'db', 'timeline'] as Subsystem[],
      required: false,
    });
    if (clack.isCancel(sel)) {
      clack.cancel('取消');
      process.exit(0);
    }
    chosen = sel as Subsystem[];
  }

  if (chosen.includes('docs')) {
    if (!cgraphxExists) {
      clack.log.info('.cgraphx/ 不存在 — 文档子系统跳过(跑 `cgraphx init` 后再 `cgraphx docs index`)');
    } else if (docsHasMd) {
      const s = clack.spinner();
      s.start('索引文档知识库...');
      try {
        const { indexMarkdownKnowledgeBase } = await import('../../core/markdown/indexer');
        const report = await indexMarkdownKnowledgeBase(projectRoot);
        s.stop(`文档知识库已建(${report.indexedDocuments} 篇文档,${report.skippedFiles} 篇跳过)`);
      } catch (err) {
        s.stop('文档索引失败');
        clack.log.warn(`docs index 失败:${err instanceof Error ? err.message : String(err)}(可稍后手动跑 \`cgraphx docs index\`)`);
      }
    } else {
      clack.log.info('docs/knowledge/ 不存在或为空 — 文档子系统跳过(后续可创建文档后跑 `cgraphx docs index`)');
    }
  }

  if (chosen.includes('db')) {
    if (cgraphxExists) {
      try {
        const { initDbProfiles } = await import('../../core/dbquery/init');
        const report = initDbProfiles(projectRoot);
        if (report.action === 'already-exists') {
          clack.log.info('db-profiles.json 已存在 — 保留用户配置(如需重置加 --force 跑 `cgraphx db init`)');
        } else {
          clack.log.success(`已生成 ${report.filePath} — 编辑后填实际密码`);
        }
      } catch (err) {
        clack.log.warn(`db init 失败:${err instanceof Error ? err.message : String(err)}`);
      }
    } else {
      clack.log.info('.cgraphx/ 不存在 — 数据库子系统跳过(跑 `cgraphx init` 后再 `cgraphx db init`)');
    }
  }

  if (chosen.includes('timeline')) {
    try {
      const { installTimelineHooks } = await import('../../core/timeline/installer');
      const report = installTimelineHooks(projectRoot);
      const events = report.writtenHookEvents.length > 0
        ? report.writtenHookEvents.join('/')
        : '已存在(幂等)';
      const git = report.gitHookWritten
        ? ' + git post-commit'
        : report.gitHookPath ? '(git hook 已存在)' : '(非 git 仓库,跳过 git hook)';
      clack.log.success(`Developer Timeline 已装:${events}${git}`);
    } catch (err) {
      clack.log.warn(`timeline install 失败:${err instanceof Error ? err.message : String(err)}`);
    }
  }

  // Step 6: next steps. `install` deliberately doesn't initialize the
  // data directory — the user runs `cgraphx init` (per project) when
  // they're ready, so we never create a surprise `.cgraphx/` in e.g.
  // $HOME.
  clack.note(
    location === 'local'
      ? 'cgraphx init        # 初始化本项目的 .cgraphx/(一次性)'
      : 'cd <你的项目>\ncgraphx init        # 初始化项目 .cgraphx/(一次性)',
    '下一步',
  );

  const finalNote = targets.length > 0
    ? `完成!重启你的 agent${targets.length > 1 ? 's' : ''} 即可使用 cgraphx。`
    : '完成!';
  clack.outro(finalNote);
}

export interface RunUninstallerOptions {
  /**
   * Comma-separated target list, or `auto` / `all` / `none`. Defaults
   * to `all` — uninstall sweeps every known agent and reports which
   * ones it actually touched, so the user doesn't have to remember
   * where they configured it.
   */
  target?: string;
  /** Skip the location prompt; use this value directly. */
  location?: Location;
  /** Non-interactive: location=global, target=all, no prompts. */
  yes?: boolean;
}

export type UninstallStatus = 'removed' | 'not-configured' | 'unsupported';

/**
 * Per-target outcome of an uninstall sweep. `removed` means we deleted
 * at least one thing; `not-configured` means the agent had no cgraphx
 * config at this location (nothing to do); `unsupported` means the
 * agent has no config concept for this location.
 */
export interface UninstallReport {
  id: string;
  displayName: string;
  status: UninstallStatus;
  /** Absolute paths we actually edited/removed (action === 'removed'). */
  removedPaths: string[];
  /** Verbatim notes from the target (rare for uninstall). */
  notes: string[];
}

/**
 * Pure uninstall sweep — no prompts, no I/O beyond the targets' own
 * file edits. Exposed (and unit-testable) separately from the clack UI
 * in `runUninstaller` so the aggregation logic can be asserted directly.
 *
 * Each target's `uninstall()` is already safe to call when nothing was
 * installed (it returns `not-found` actions), so this is safe to run
 * across every target unconditionally.
 */
export function uninstallTargets(
  targets: readonly AgentTarget[],
  location: Location,
): UninstallReport[] {
  return targets.map((target) => {
    if (!target.supportsLocation(location)) {
      const only: Location = location === 'local' ? 'global' : 'local';
      return {
        id: target.id,
        displayName: target.displayName,
        status: 'unsupported' as const,
        removedPaths: [],
        notes: [`no ${location} config — this agent is ${only}-only`],
      };
    }
    const result = target.uninstall(location);
    const removedPaths = result.files
      .filter((f) => f.action === 'removed')
      .map((f) => f.path);
    return {
      id: target.id,
      displayName: target.displayName,
      status: removedPaths.length > 0 ? ('removed' as const) : ('not-configured' as const),
      removedPaths,
      notes: result.notes ?? [],
    };
  });
}

/**
 * Interactive uninstaller — the inverse of `runInstallerWithOptions`.
 * Asks global-vs-local first (unless `--location`/`--yes` is given),
 * then sweeps every agent target (or the `--target` subset) and prints
 * one block per agent so the user sees exactly which providers it hit.
 *
 * Removes only what install wrote: the agent targets' hooks / statusLine /
 * prompt-hook / stale instructions block, and (for local uninstall) the
 * Developer Timeline hooks install wired into .claude/settings.json. The
 * `.cgraphx/` data dir is owned by `cgraphx uninit` and is left untouched;
 * the bundled `.claude/` template (skills/agents/...) is retained — the
 * user may have customized it (a hint is printed).
 */
export async function runUninstaller(opts: RunUninstallerOptions): Promise<void> {
  const clack = await importESM('@clack/prompts');

  clack.intro(`cgraphx v${getVersion()} —— 卸载`);

  const useDefaults = opts.yes === true;

  // Step 1: which location. Default is GLOBAL for uninstall — clean every
  // trace of cgraphx from the user's home (project-local files are easy for
  // the user to delete themselves; ~/.claude/ is the dangerous one they
  // want us to remove for them).
  let location: Location;
  if (opts.location) {
    location = opts.location;
  } else if (useDefaults) {
    location = 'global';
  } else {
    const sel = await clack.select({
      message: '从所有项目移除 cgraphx,还是仅当前项目?',
      options: [
        { value: 'global' as const, label: '所有项目(全局)', hint: '~/.claude' },
        { value: 'local'  as const, label: '仅当前项目(本地)', hint: './.claude' },
      ],
      initialValue: 'global' as const,
    });
    if (clack.isCancel(sel)) {
      clack.cancel('卸载已取消。');
      process.exit(0);
    }
    location = sel;
  }

  // Step 2: which agents. Default is every agent.
  let targets: AgentTarget[];
  if (opts.target !== undefined) {
    targets = resolveTargetFlag(opts.target, location);
  } else {
    targets = [...ALL_TARGETS];
  }
  if (targets.length === 0) {
    clack.outro('未选择任何 agent —— 无操作。');
    return;
  }

  // Step 3: sweep + per-agent feedback.
  const reports = uninstallTargets(targets, location);
  const removed = reports.filter((r) => r.status === 'removed');

  for (const r of reports) {
    if (r.status === 'removed') {
      for (const p of r.removedPaths) {
        clack.log.success(`${r.displayName}:已移除 ${tildify(p)}`);
      }
    } else if (r.status === 'not-configured') {
      clack.log.info(`${r.displayName}:未配置 —— 无需移除`);
    } else {
      clack.log.info(`${r.displayName}:已跳过 —— ${r.notes[0] ?? '不支持该位置'}`);
    }
  }

  // Step 4: for local uninstall, mirror what `install` did beyond the
  // agent targets. install optionally wires Developer Timeline hooks into
  // .claude/settings.json (Step 5½), so uninstall removes them here for
  // symmetry (spec §84 — install/uninstall must be inverse). The .cgraphx/
  // data dir is owned by `cgraphx uninit` and is left untouched; the
  // bundled .claude/ template (skills/agents/commands/hooks/plugins) is
  // intentionally retained — the user may have customized it.
  if (location === 'local') {
    try {
      const { uninstallTimelineHooks } = await import('../../core/timeline/installer');
      const tlReport = uninstallTimelineHooks(process.cwd(), {});
      if (tlReport.removedHookEvents.length > 0) {
        clack.log.success(
          `Developer Timeline:已移除 hooks(${tlReport.removedHookEvents.join(', ')})`,
        );
      }
      if (tlReport.gitHookRemoved) {
        clack.log.success('Developer Timeline:已移除 git post-commit hook');
      }
    } catch (err) {
      clack.log.warn(
        `timeline uninstall 失败:${err instanceof Error ? err.message : String(err)}`,
      );
    }

    if (fs.existsSync(getCodeGraphDir(process.cwd()))) {
      clack.log.info(`本项目的 .cgraphx/ 仍然存在。运行 \`cgraphx uninit\` 删除。`);
    }
    clack.log.info(
      `模板文件保留在 .claude/,如需手动删除:rm -rf .claude/{skills,agents,commands,hooks,plugins}`,
    );
  }

  // Step 5: summary.
  if (removed.length > 0) {
    const names = removed.map((r) => r.displayName).join(', ');
    clack.outro(
      `已从 ${removed.length} 个 agent${removed.length > 1 ? 's' : ''} 移除 cgraphx:${names}。` +
      `重启 ${removed.length > 1 ? '它们' : '它'} 后生效。`,
    );
  } else {
    clack.outro(`cgraphx 未在任何 ${location} agent 中配置 —— 无需移除。`);
  }
}

/**
 * Replace home-directory prefix in a path with `~/` for cleaner log
 * lines. Pure cosmetic.
 */
function tildify(p: string): string {
  const home = require('os').homedir();
  if (p.startsWith(home + path.sep)) return '~' + p.substring(home.length);
  return p;
}

/**
 * Detect whether the `cgraphx` command is already resolvable on PATH.
 *
 * Cross-platform: `command -v` works on POSIX, `where` on Windows. Returns
 * the resolved absolute path on success (first line of output, in case
 * Windows `where` lists multiple matches) or null when not found / lookup
 * failed. Never throws.
 */
function detectCgraphxOnPath(): string | null {
  const cmd = process.platform === 'win32' ? 'where cgraphx' : 'command -v cgraphx || which cgraphx';
  try {
    const out = execSync(cmd, {
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
      encoding: 'utf-8',
    });
    const first = out.split(/\r?\n/).find(l => l.trim().length > 0);
    return first ? first.trim() : null;
  } catch {
    return null;
  }
}

/**
 * Pull stderr out of an execSync error object for display. execSync wraps the
 * underlying error in an Error with `.stderr` / `.stdout` Buffers when
 * stdio is piped — surface that instead of guessing the cause.
 */
function extractStderr(err: unknown): string {
  if (err && typeof err === 'object') {
    const e = err as { stderr?: string | Buffer; stdout?: string | Buffer; message?: string };
    if (e.stderr) return e.stderr.toString().trim();
    if (e.stdout) return e.stdout.toString().trim();
    if (e.message) return e.message;
  }
  return String(err);
}

/**
 * Build a platform-appropriate hint when `npm install -g` fails. `sudo` is
 * meaningless on Windows — the user needs to either rerun PowerShell as
 * Administrator or change npm's prefix to a user-writable directory.
 */
function formatInstallHint(stderr: string): string {
  const is404 = /404\s+not\s+found/i.test(stderr) || /cgraphx/i.test(stderr) && /not\s+found/i.test(stderr);
  if (is404) {
    return `${NPM_PACKAGE} is not yet published to npm. Run \`npm publish\` first, or install locally with \`npm install -g ./cgraphx-<version>.tgz\`.`;
  }
  if (process.platform === 'win32') {
    return `Try: open PowerShell as Administrator and run \`npm install -g ${NPM_PACKAGE}\`. Or change npm prefix to a user-writable directory: \`npm config set prefix "$APPDATA\\npm"\`.`;
  }
  return `Try: \`sudo npm install -g ${NPM_PACKAGE}\`, or change npm prefix to avoid sudo.`;
}

/**
 * Resolve the (legacy) --target flag in 2.0. With only Claude shipped,
 * there's no multi-select prompt — we just validate the flag and return
 * the registry's targets. Defaults to "all targets" (= Claude) when no
 * flag is present.
 */
async function resolveTargets(
  _clack: typeof import('@clack/prompts'),
  opts: RunInstallerOptions,
  _useDefaults: boolean,
): Promise<AgentTarget[]> {
  if (opts.target !== undefined) {
    return resolveTargetFlag(opts.target, 'local');
  }
  // Surface detection (info-only) so the user sees whether Claude was
  // found — harmless when nothing's installed.
  void detectAll('local');
  return [...ALL_TARGETS];
}
