/**
 * cgraphx 交互式安装器(2.0)
 *
 * 按 agent 描述为每个选中的 agent(Claude Code / CodeBuddy …)部署模板资产、
 * cgraphx hook 与 statusLine、指引块;项目级的事每个目录只做一次:本地 `.cgraphx/`(知识库)
 * 初始化、docs / db 子系统、问项目名称并把本地旧库并进用户目录(spec:2026-11-05-数据按项目放
 * 用户目录 D25);timeline hook 对每个选中 agent 接入。
 * 安装对象选择见 `agent-steps.ts`(spec §4.1),卸载规则见 `runUninstaller`(spec §5、D31)。
 *
 * Uses @clack/prompts for the interactive UI; `runInstallerWithOptions`
 * is the non-interactive entry point used by the `--target` flag.
 */

import { execSync } from 'node:child_process';
import * as path from 'node:path';
import * as fs from 'node:fs';
import { ALL_TARGETS, resolveTargetFlag } from './targets/registry';
import type { AgentTarget, Location } from './targets/types';
import {
  anyAgentInstalled,
  installAgentHooks,
  installedTargetsOrDefault,
  installAgentTargets,
  selectInstallTargets,
  tildify,
  uninstallAgentHooks,
} from './agent-steps';
import {
  removeLocalDir,
  removeReleaseGuardIfAlone,
  reportProjectDataKept,
  settleProjectData,
  type Clack,
} from './project-steps';
import {
  getCodeGraphDir,
  isInitialized,
  createDirectory,
  unsafeIndexRootReason,
} from '../../core/directory';
import { NPM_PACKAGE } from '../upgrade';

// Dynamic import helper — tsc compiles import() to require() in CJS mode,
// which fails for ESM-only packages. This bypasses the transformation.
// eslint-disable-next-line @typescript-eslint/no-implied-eval
const importESM = new Function('specifier', 'return import(specifier)') as
  (specifier: string) => Promise<Clack>;

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
   * 逗号分隔的 agent id(支持 legacy 别名如 `claude`),或 `auto` / `all` / `none`。
   * 给出时只装指定 agent,优先于 `yes`,不弹任何提示。
   */
  target?: string;
  /**
   * Skip every confirm and use defaults: location=local, all subsystems.
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

  // 安装位置:2.0 只支持项目本地,是常量而非提示。
  const location: Location = 'local';

  // Step 1:安装对象(spec §4.1)。一个都不选 → 跳过 agent 配置写入,仍初始化 .cgraphx/。
  const targets = await selectInstallTargets(clack, opts, useDefaults, location);

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

  // 顺序固定(D25):① agent 配置 ② 本地 .cgraphx/ ③ 1.x 遗留表 ④ 选子系统 ⑤ docs 索引 ⑥ timeline 等 hook
  //   ⑦ 问名字、并旧数据 ⑧ db-query 模板。
  // ① 逐 agent 写配置;单个 agent 失败只 warn,继续其他 agent 与后续步骤。
  installAgentTargets(clack, targets, location);

  // ② 本地 `.cgraphx/`(被折叠进 install 的 `cgraphx init`),本地库只建知识库表。幂等;危险根($HOME /
  //   文件系统根)跳过并提示,不在那里建数据目录;上面写的 agent 配置不受影响。
  const projectRoot = process.cwd();
  const initOutcome = await ensureProjectInitialized(projectRoot);
  if (initOutcome === 'initialized') {
    clack.log.success(`已初始化 ${getCodeGraphDir(projectRoot)}(知识库)`);
  } else if (initOutcome === 'skipped-unsafe') {
    clack.log.warn('跳过 .cgraphx/ 初始化:当前目录看起来不是项目根($HOME / 文件系统根)。在真实项目内重跑 cgraphx install 以启用知识库 / 时间线。');
  }
  // (initOutcome === 'already' → quiet no-op)

  // ③ 清掉本地库里 1.x 代码图谱的遗留表(新装、升级都跑,没有就什么都不做);危险根没有数据目录,跳过。
  if (initOutcome !== 'skipped-unsafe') {
    const { dropLegacyGraphTables } = await import('../../core/db/migrate');
    const cleanup = dropLegacyGraphTables(projectRoot);
    if (cleanup.dropped.length > 0) {
      clack.log.success(`已清理 1.x 代码图谱遗留表:${cleanup.dropped.join(', ')}`);
    }
  }

  // ④ 可选子系统 docs / db / timeline:各自独立,只跑勾选的;--yes 下前置条件不满足的静默跳过
  //   (如 docs 要 docs/knowledge/ 下有 .md)。
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
        { value: 'db' as const,       label: '数据库查询',     hint: cgraphxExists ? '生成 db-profiles.json 模板(在项目数据目录)' : '.cgraphx/ 不存在 — 跳过' },
        {
          value: 'timeline' as const,
          label: 'Developer Timeline',
          hint: targets.length > 0
            ? `装 ${targets.map((t) => t.displayName).join(' / ')} hooks(项目级)`
            : '未选择 agent — 跳过',
        },
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

  // ⑤ docs 索引
  if (chosen.includes('docs')) {
    if (!cgraphxExists) {
      clack.log.info('.cgraphx/ 不存在 — 文档子系统跳过(在真实项目目录内重跑 `cgraphx install`,再 `cgraphx docs index`)');
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

  // ⑥ 对本次选中的每个 agent 接入 timeline hook;git post-commit 每项目一个
  if (chosen.includes('timeline')) {
    await installAgentHooks(clack, projectRoot, targets);
  }

  // ⑦ 问项目名称、把本地旧库并进用户目录(D25、D30),不受子系统勾选影响。必须在 ⑧ 之前:db-query 模板写进
  //   数据位置时会先写上并过记号,之后再并就成了「已经并过」。
  if (initOutcome !== 'skipped-unsafe') {
    await settleProjectData(clack, projectRoot, useDefaults);
  }

  // ⑧ db-query 模板(写进数据位置)
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
      clack.log.info('.cgraphx/ 不存在 — 数据库子系统跳过(在真实项目目录内重跑 `cgraphx install`,再 `cgraphx db init`)');
    }
  }

  // Step 5: next steps. install now initializes the data dir itself (the
  // removed `cgraphx init` is folded in), so the only thing left is to restart
  // the agent and, optionally, index an existing knowledge base.
  clack.note(
    '重启你的 agent 以加载新技能。\ncgraphx docs index   # 可选:已有 docs/knowledge/ 时建知识库索引',
    '下一步',
  );

  const finalNote = targets.length > 0
    ? `完成!重启你的 agent${targets.length > 1 ? 's' : ''} 即可使用 cgraphx。`
    : '完成!';
  clack.outro(finalNote);
}

export interface RunUninstallerOptions {
  /**
   * 逗号分隔的 agent id,或 `auto` / `all` / `none`。不给 → 卸载全部 agent,移除 git 钩子片段(timeline 的
   * post-commit / post-merge、版本分支提交拦截;同一仓库还有装着的目录时留着)与本地 `.cgraphx/`;
   * 给出 → 只移除指定 agent 的配置,不动 git 钩子、不删 `.cgraphx/`(忽略 `--keep-data`)。
   */
  target?: string;
  /** Non-interactive: target=all, no prompts (also skips the data-delete confirm). */
  yes?: boolean;
  /** 保留这个目录的 `.cgraphx/`(知识库索引和「我的需求」);用户目录里的项目数据卸载一律不删。 */
  keepData?: boolean;
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
      return {
        id: target.id,
        displayName: target.displayName,
        status: 'unsupported' as const,
        removedPaths: [],
        notes: [`no ${location} config for this agent`],
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
 * 交互式卸载(`runInstallerWithOptions` 的逆过程),只卸这个目录(spec D31)。清扫全部 agent(或 `--target`
 * 指定的),每个 agent 打一段反馈:移除 agent 配置(hook / statusLine / 指引块)、包内 `.claude/` 资产(按清单)、
 * timeline 等 hook 与死 hook 残留(pre-0.8 auto-sync、2.0 移除的 prompt-hook)。彻底卸载时再:同一仓库没有别的
 * 装着的目录才删 git 钩子与版本分支提交拦截;删本地 `.cgraphx/`(被折叠进来的 `uninit`)前先把没并过的旧数据
 * 并进用户目录,并不过去就留着;删除要确认(`--yes` 不问,`--keep-data` 保留)。用户目录里的项目数据不删,
 * 收尾说明它在哪、怎么删。
 */
export async function runUninstaller(opts: RunUninstallerOptions): Promise<void> {
  const clack = await importESM('@clack/prompts');

  clack.intro(`cgraphx v${getVersion()} —— 卸载`);

  const useDefaults = opts.yes === true;

  // Step 1: install location. 2.0 is project-local only — no global uninstall.
  const location: Location = 'local';

  // Step 2:卸载对象。不给 -t → 对全部 agent 静默清扫(彻底卸载),但只为「清扫前已装」的 agent
  //   打印反馈(都没装时为 claude-code,保证 git 钩子移除与改造前输出一致);给 -t → 只处理指定 agent。
  const partial = opts.target !== undefined;
  const targets: AgentTarget[] = opts.target !== undefined
    ? resolveTargetFlag(opts.target, location)
    : [...ALL_TARGETS];
  if (targets.length === 0) {
    clack.outro('未选择任何 agent —— 无操作。');
    return;
  }
  // 已装判定必须在清扫之前算
  const involved: AgentTarget[] = partial ? targets : installedTargetsOrDefault(process.cwd());

  // Step 3: sweep + per-agent feedback.
  const reports = uninstallTargets(targets, location);
  const removed = reports.filter((r) => r.status === 'removed');

  for (const r of reports) {
    // 未涉及的 agent 只在确有移除时打印,不打「未配置」
    if (r.status !== 'removed' && !involved.some((t) => t.id === r.id)) continue;
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

  // Step 4:撤销 install 在 agent target 之外做的事。① 逐 agent 移除 timeline hook(部分卸载保留
  //   git 钩子;同一仓库还有装着的目录时也留着,gitHookKeptFor 列出那些目录)。
  const cwd = process.cwd();
  const { gitHookKeptFor } = await uninstallAgentHooks(clack, cwd, targets, partial, involved);

  if (partial) {
    // 部分卸载(-t)不动 git 钩子与 `.cgraphx/`;已无已装 agent 时提示
    if (!anyAgentInstalled(location)) {
      clack.log.info('项目中已没有已装 cgraphx 的 agent。如需彻底卸载请执行不带 -t 的 cgraphx uninstall');
    }
  } else {
    removeReleaseGuardIfAlone(clack, cwd);
    const project = await removeLocalDir(clack, cwd, { keepData: opts.keepData === true, useDefaults });
    reportProjectDataKept(clack, project, gitHookKeptFor);
  }

  // Step 5: summary.
  if (removed.length > 0) {
    const names = removed.map((r) => r.displayName).join(', ');
    clack.outro(
      `已从 ${removed.length} 个 agent${removed.length > 1 ? 's' : ''} 移除 cgraphx:${names}。` +
      `重启 ${removed.length > 1 ? '它们' : '它'} 后生效。`,
    );
  } else {
    clack.outro('cgraphx 未在本项目配置 —— 无需移除。');
  }
}

/**
 * 本地 `.cgraphx/` 初始化(被折叠进 install 的 `cgraphx init`):建目录,本地库只建知识库(markdown)表——
 * timeline 的表建在项目库(spec D8);本地库里有了 `timeline_*`/`task_*`/`sync_*` 任一张表,都会被当成没并过的旧数据。幂等:装过的什么都不做。
 *
 * @returns `initialized`(新建)、`already`(已装过)、`skipped-unsafe`(根像 $HOME / 文件系统根,不在那里建数据目录)。
 */
export async function ensureProjectInitialized(
  projectRoot: string,
): Promise<'initialized' | 'already' | 'skipped-unsafe'> {
  if (isInitialized(projectRoot)) return 'already';
  if (unsafeIndexRootReason(projectRoot)) return 'skipped-unsafe';

  createDirectory(projectRoot);
  const { DatabaseConnection, getLocalDatabasePath } = await import('../../core/db');
  const { ensureMarkdownSchema } = await import('../../core/markdown/schema-bootstrap');
  const conn = DatabaseConnection.open(getLocalDatabasePath(projectRoot));
  try {
    ensureMarkdownSchema(conn.getDb());
  } finally {
    conn.close();
  }
  return 'initialized';
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
