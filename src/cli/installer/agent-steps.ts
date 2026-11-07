/**
 * 安装器中按 agent 执行的步骤:安装对象选择(spec §4.1)、逐 agent 写配置、
 * timeline 的 git 片段接入 / 移除(片段与 agent 无关,每项目只装一次)。单个 agent 失败只 warn,继续
 * 其他 agent(spec §12)。
 */

import * as os from 'node:os';
import * as path from 'node:path';
import { ALL_TARGETS, getTarget, resolveTargetFlag } from './targets/registry';
import type { AgentTarget, Location } from './targets/types';
import { hookNotice, type HookSnippetResult } from '../../core/git-hooks';
import {
  defaultAgentProfile,
  isAgentInstalled,
  parseAgentList,
  selectInstalledAgents,
  type AgentProfile,
} from '../../core/agents';

type Clack = typeof import('@clack/prompts');

/**
 * timeline 安装成功那行的 git 部分:有写了盘的钩子(installed / updated)→ ` + git <钩子名用 / 连起来>`;
 * 全是 present → `(git hook 已存在)`;不在 git 仓库 → `(非 git 仓库,跳过 git hook)`;
 * 其余(有没写入的钩子)不写这部分,由随后的提示逐个说明原因。
 */
function gitHookSummary(hooks: readonly HookSnippetResult[]): string {
  if (hooks.length === 0) return '(非 git 仓库,跳过 git hook)';
  const written = hooks.filter((h) => h.status === 'installed' || h.status === 'updated');
  if (written.length > 0) return ` + git ${written.map((h) => path.basename(h.hookPath)).join('/')}`;
  return hooks.every((h) => h.status === 'present') ? '(git hook 已存在)' : '';
}

/** git 钩子的安装提示(spec D33):没写入的说原因,链接、被跟踪的还给要加的几行。 */
function gitHookNotices(hooks: readonly HookSnippetResult[]): string[] {
  return hooks.map((h) => hookNotice(h)).filter((n): n is string => n !== null);
}

/** 描述对应的 target(注册表由全部描述生成,必然存在)。 */
function targetOf(profile: AgentProfile): AgentTarget {
  const target = getTarget(profile.id);
  if (!target) throw new Error(`agent ${profile.id} 未生成 target`);
  return target;
}

/** 当前项目中「已装」的 agent 的 target;一个都没装时为 `[claude-code]`。 */
export function installedTargetsOrDefault(projectRoot: string): AgentTarget[] {
  return selectInstalledAgents(projectRoot).map(targetOf);
}

/**
 * 这个项目里已装 cgraphx 的 agent,不带「都没装取 claude-code」的兜底(spec:2026-11-07-安装只留选中的agent
 * D1)。要在选 agent、装配置之前算,装完就分不出原来装没装。
 */
export function installedTargets(projectRoot: string): AgentTarget[] {
  return ALL_TARGETS.filter((t) => isAgentInstalled(projectRoot, t.profile));
}

/**
 * 这次安装没选、但原来已装的 agent:要卸掉它的 cgraphx 配置(spec:2026-11-07-安装只留选中的agent K1、D2)。
 * `-t none` 不动任何 agent 配置 → 空;`-y` 不带 `-t` 时选中的就是全部已装 → 自然为空。
 */
export function unselectedInstalledTargets(
  installed: readonly AgentTarget[],
  selected: readonly AgentTarget[],
  targetFlag: string | undefined,
): AgentTarget[] {
  if (targetFlag !== undefined && parseAgentList(targetFlag) === 'none') return [];
  return installed.filter((t) => !selected.some((s) => s.id === t.id));
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * 决定本次安装的 agent(spec §4.1):
 *   - 给了 `-t`(不论是否 `-y`)→ 按参数解析;
 *   - 无 `-t` 但 `-y`(upgrade 走这条)→ 全部「已装」的 agent,都没装过时只装 claude-code;
 *   - 交互 → 多选列出全部 agent,默认勾选「检测到」的,都没检测到时勾选 claude-code;可一个都不选。
 * 选中的就是这次之后留下的全部:原来已装、这次没选的由调用方卸掉(unselectedInstalledTargets)。
 */
export async function selectInstallTargets(
  clack: Clack,
  opts: { target?: string },
  useDefaults: boolean,
  location: Location,
): Promise<AgentTarget[]> {
  if (opts.target !== undefined) return resolveTargetFlag(opts.target, location);

  if (useDefaults) return installedTargetsOrDefault(process.cwd());

  const detected = ALL_TARGETS.filter((t) => t.detect(location).detected).map((t) => t.id);
  const sel = await clack.multiselect({
    message: '选择要安装 cgraphx 的 agent(回车确认;已装的没勾会卸掉它的 cgraphx 配置)',
    options: ALL_TARGETS.map((t) => ({ value: t.id, label: t.displayName })),
    initialValues: detected.length > 0 ? detected : [defaultAgentProfile().id],
    required: false,
  });
  if (clack.isCancel(sel)) {
    clack.cancel('安装已取消。');
    process.exit(0);
  }
  const ids = sel as string[];
  return ALL_TARGETS.filter((t) => ids.includes(t.id));
}

/** 逐 agent 写入配置(hook / statusLine / 指引块 / 资产);单个 agent 失败只 warn。 */
export function installAgentTargets(
  clack: Clack,
  targets: readonly AgentTarget[],
  location: Location,
): void {
  for (const target of targets) {
    if (!target.supportsLocation(location)) {
      clack.log.warn(`${target.displayName}:已跳过 —— 不支持 --location=${location}。`);
      continue;
    }
    try {
      const result = target.install(location, {});
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
    } catch (err) {
      clack.log.warn(`${target.displayName}: 安装失败:${errorMessage(err)}(继续安装其他 agent)`);
    }
  }
}

/**
 * 「可选子系统」的 Developer Timeline 项:装 git 提交记录片段(post-commit / post-merge)。
 * 片段与 agent 无关,每项目装一次——会话事件改由会话文件解析补录,不再接 agent hook
 * (spec:2026-11-06-会话文件解析替代hooks D17、D18)。没选 agent 就整个跳过。
 * 只装片段、不开库:项目库的 timeline schema 由 install 并旧数据那一步建(spec D8、D25)。
 */
export async function installAgentHooks(
  clack: Clack,
  projectRoot: string,
  targets: readonly AgentTarget[],
): Promise<void> {
  if (targets.length === 0) {
    clack.log.info('未选择 agent —— Developer Timeline 跳过');
    return;
  }
  const { installTimelineHooks } = await import('../../core/timeline');
  try {
    const report = installTimelineHooks(projectRoot);
    clack.log.success(`Developer Timeline 已装:git 提交记录片段${gitHookSummary(report.gitHooks)}`);
    for (const notice of gitHookNotices(report.gitHooks)) clack.log.warn(notice);
  } catch (err) {
    // 失败只 warn,不中断安装
    clack.log.warn(`timeline install 失败:${errorMessage(err)}`);
  }
}

/**
 * 移除 timeline 的 git 提交记录片段与提交门禁片段(spec D18、K22)。`keepGitHook` 为真(`uninstall -t`,
 * 部分卸载)时都不动;否则先卸提交记录片段——同一仓库还有装着 cgraphx 的目录时留着(spec D31),
 * 提交门禁片段走同一判断(`gitHookKeptFor` 非空时也留着)。返回的 `gitHookKeptFor` 是提交记录片段
 * 报告里「还装着的目录」(删了钩子、没碰钩子时为 [])。
 */
export async function uninstallAgentHooks(
  clack: Clack,
  projectRoot: string,
  keepGitHook: boolean,
): Promise<{ gitHookKeptFor: string[] }> {
  if (keepGitHook) return { gitHookKeptFor: [] };

  const { uninstallTimelineHooks } = await import('../../core/timeline');
  let gitHookKeptFor: string[] = [];
  try {
    const tlReport = uninstallTimelineHooks(projectRoot);
    gitHookKeptFor = tlReport.gitHookKeptFor;
    // 还有装着的目录时钩子留着,不打「已移除」
    if (tlReport.gitHookRemoved && tlReport.gitHookKeptFor.length === 0) {
      clack.log.success('Developer Timeline:已移除 git 提交记录片段(post-commit)');
    }
    for (const notice of tlReport.gitHookNotices) clack.log.warn(`Developer Timeline:${notice}`);
  } catch (err) {
    clack.log.warn(`timeline uninstall 失败:${errorMessage(err)}`);
  }

  // 提交门禁片段(commit-msg)与提交记录片段同一判断:同一仓库还有装着的目录时留着,否则一并卸掉。
  if (gitHookKeptFor.length === 0) {
    const { removeCommitGate } = await import('../../core/commit-gate');
    try {
      const gate = removeCommitGate(projectRoot);
      if (gate.status === 'removed') {
        clack.log.success(`已移除提交门禁片段:${gate.hookPath}`);
      } else if (gate.notice !== undefined) {
        clack.log.warn(gate.notice);
      }
    } catch (err) {
      clack.log.warn(`移除提交门禁片段失败:${errorMessage(err)}`);
    }
  }
  return { gitHookKeptFor };
}

/** 项目中是否还有任一 agent 处于「已装」状态。 */
export function anyAgentInstalled(location: Location): boolean {
  void location;
  return ALL_TARGETS.some((t) => isAgentInstalled(process.cwd(), t.profile));
}

/** 日志行中把 home 前缀替换为 `~/`,纯展示用。 */
export function tildify(p: string): string {
  const home = os.homedir();
  if (p.startsWith(home + path.sep)) return '~' + p.substring(home.length);
  return p;
}
