/**
 * 安装器中按 agent 执行的步骤:安装对象选择(spec §4.1)、逐 agent 写配置、
 * 逐 agent 接入 / 移除 timeline 与任务绑定 hook。每个 agent 失败只 warn,继续其他 agent(spec §12)。
 */

import * as os from 'node:os';
import * as path from 'node:path';
import { ALL_TARGETS, getTarget, resolveTargetFlag } from './targets/registry';
import type { AgentTarget, Location } from './targets/types';
import { isInitialized } from '../../core/directory';

type Clack = typeof import('@clack/prompts');

/** 默认 agent(claude-code)的 target。 */
function defaultTarget(): AgentTarget {
  const target = getTarget('claude-code') ?? ALL_TARGETS[0];
  if (!target) throw new Error('未登记任何 agent 描述');
  return target;
}

/**
 * timeline / task 日志行前缀:本次只涉及 claude-code 时为空(与改造前输出一致),
 * 否则为 `<displayName>: `。
 */
function hookLogPrefix(targets: readonly AgentTarget[], target: AgentTarget): string {
  const onlyDefault = targets.length === 1 && target.id === defaultTarget().id;
  return onlyDefault ? '' : `${target.displayName}: `;
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * 决定本次安装的 agent(spec §4.1):
 *   - 给了 `-t`(不论是否 `-y`)→ 按参数解析;
 *   - 无 `-t` 但 `-y`(upgrade 走这条)→ 全部「已装」的 agent,都没装过时只装 claude-code;
 *   - 交互 → 多选列出全部 agent,默认勾选「检测到」的,都没检测到时勾选 claude-code;可一个都不选。
 */
export async function selectInstallTargets(
  clack: Clack,
  opts: { target?: string },
  useDefaults: boolean,
  location: Location,
): Promise<AgentTarget[]> {
  if (opts.target !== undefined) return resolveTargetFlag(opts.target, location);

  if (useDefaults) {
    const installed = ALL_TARGETS.filter((t) => t.detect(location).installed);
    return installed.length > 0 ? installed : [defaultTarget()];
  }

  const detected = ALL_TARGETS.filter((t) => t.detect(location).detected).map((t) => t.id);
  const sel = await clack.multiselect({
    message: '选择要安装 cgraphx 的 agent(回车确认)',
    options: ALL_TARGETS.map((t) => ({ value: t.id, label: t.displayName })),
    initialValues: detected.length > 0 ? detected : [defaultTarget().id],
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
 * 「可选子系统」的 Developer Timeline 项:对每个选中 agent 依次接入 timeline 与任务绑定 hook。
 * git post-commit 钩子每项目一个(首个 agent 写入,其后幂等)。已初始化项目先打开库应用
 * task schema(只做一次),保证老项目重装后也有 task 表。
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
  const { installTaskHooks, openTaskDb } = await import('../../core/task');
  let taskSchemaReady = false;

  for (const target of targets) {
    const prefix = hookLogPrefix(targets, target);
    try {
      const report = installTimelineHooks(projectRoot, { agent: target.id });
      const events = report.writtenHookEvents.length > 0
        ? report.writtenHookEvents.join('/')
        : '已存在(幂等)';
      const git = report.gitHookWritten
        ? ' + git post-commit'
        : report.gitHookPath ? '(git hook 已存在)' : '(非 git 仓库,跳过 git hook)';
      clack.log.success(`${prefix}Developer Timeline 已装:${events}${git}`);
    } catch (err) {
      clack.log.warn(`${prefix}timeline install 失败:${errorMessage(err)}`);
    }

    // 失败只 warn,不中断安装
    try {
      if (!taskSchemaReady) {
        if (isInitialized(projectRoot)) openTaskDb(projectRoot).close();
        taskSchemaReady = true;
      }
      const report = installTaskHooks(projectRoot, { agent: target.id });
      const events = report.written.length > 0 ? report.written.join('/') : '已存在(幂等)';
      clack.log.success(`${prefix}开发任务绑定已装:${events}`);
    } catch (err) {
      clack.log.warn(`${prefix}task hook install 失败:${errorMessage(err)}`);
    }
  }
}

/**
 * 逐 agent 移除 timeline 与任务绑定 hook。`keepGitHook` 为真(`uninstall -t`)时不动
 * git post-commit 钩子;否则随首个 agent 一并移除。
 */
export async function uninstallAgentHooks(
  clack: Clack,
  projectRoot: string,
  targets: readonly AgentTarget[],
  keepGitHook: boolean,
): Promise<void> {
  const { uninstallTimelineHooks } = await import('../../core/timeline');
  const { uninstallTaskHooks } = await import('../../core/task');

  for (const target of targets) {
    const prefix = hookLogPrefix(targets, target);
    try {
      const tlReport = uninstallTimelineHooks(projectRoot, { agent: target.id, keepGitHook });
      if (tlReport.removedHookEvents.length > 0) {
        clack.log.success(
          `${prefix}Developer Timeline:已移除 hooks(${tlReport.removedHookEvents.join(', ')})`,
        );
      }
      if (tlReport.gitHookRemoved) {
        clack.log.success(`${prefix}Developer Timeline:已移除 git post-commit hook`);
      }
    } catch (err) {
      clack.log.warn(`${prefix}timeline uninstall 失败:${errorMessage(err)}`);
    }
    try {
      const taskReport = uninstallTaskHooks(projectRoot, { agent: target.id });
      if (taskReport.removed.length > 0) {
        clack.log.success(`${prefix}开发任务绑定:已移除 hooks(${taskReport.removed.join(', ')})`);
      }
    } catch (err) {
      clack.log.warn(`${prefix}task hook uninstall 失败:${errorMessage(err)}`);
    }
  }
}

/** 项目中是否还有任一 agent 处于「已装」状态。 */
export function anyAgentInstalled(location: Location): boolean {
  return ALL_TARGETS.some((t) => t.detect(location).installed);
}

/** 日志行中把 home 前缀替换为 `~/`,纯展示用。 */
export function tildify(p: string): string {
  const home = os.homedir();
  if (p.startsWith(home + path.sep)) return '~' + p.substring(home.length);
  return p;
}
