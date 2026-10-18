/**
 * task hook 的项目级接入与移除(spec §10、§12)。
 *
 * 只读写目标项目中该 agent 的项目共享 settings(Claude Code 为 `<projectRoot>/.claude/settings.json`),
 * 不碰全局配置。
 *   - 幂等:同一事件已有相同命令就跳过,重复安装不产生重复项;
 *   - 升级:写入前移除本 settings 中所有 task hook 条目里命令不在新集合里的项
 *     (含旧的 PostToolUse 条目与不带容错后缀的旧 SessionStart 条目);
 *   - 可逆:卸载只移除命令里带 `cgraphx task-` 标记的项,不碰用户其它 hook,
 *     清掉因此变空的组和事件键。
 *
 * settings 读写写法参照 timeline installer,按分层约束只经 timeline 门面取常量。
 */

import fs from 'node:fs';
import path from 'node:path';

import { agentSettingsPath, DEFAULT_AGENT_ID, hookCommand, requireAgentProfile } from '../agents';
import type { AgentId, AgentProfile } from '../agents';
import { LEGACY_BINARY_TOLERANT_SUFFIX } from '../timeline';

interface HookEntry {
  type: 'command';
  command: string;
}

interface HookGroup {
  matcher?: string;
  hooks: HookEntry[];
}

type HooksConfig = Record<string, HookGroup[]>;

interface SettingsJson {
  hooks?: HooksConfig;
  [k: string]: unknown;
}

/** 卸载识别标记:命令里包含它的 hook 项属于 task。 */
const TASK_HOOK_MARKER = 'cgraphx task-';

/**
 * task 接入的 hook:SessionStart 只注入会话 id,Stop 在每轮结束刷新自动绑定派生。
 * 两条命令都带旧版二进制容错后缀,PATH 命中不识别新子命令的全局 cgraphx 时不显示报错。
 */
function taskHookGroups(profile: AgentProfile): ReadonlyArray<{ event: string; group: HookGroup }> {
  const commandFor = (subcommand: string): string =>
    hookCommand(`cgraphx ${subcommand}`, profile) + LEGACY_BINARY_TOLERANT_SUFFIX;
  return [
    {
      event: 'SessionStart',
      group: { hooks: [{ type: 'command', command: commandFor('task-session-start-hook') }] },
    },
    {
      event: 'Stop',
      group: { hooks: [{ type: 'command', command: commandFor('task-stop-hook') }] },
    },
  ];
}

/** 取 agent 描述:缺省为默认 agent;未登记的 id 抛错(不静默回退,避免写错 agent 的配置)。 */
function profileOf(agent: AgentId | undefined): AgentProfile {
  return requireAgentProfile(agent ?? DEFAULT_AGENT_ID);
}

/**
 * 写入前移除本 settings 中所有 task hook 条目里命令不在新集合里的项。
 * 返回是否有改动;清空的组与事件键一并删除,不碰其它 hook。
 */
function pruneStaleTaskHooks(hooks: HooksConfig, desiredCommands: ReadonlySet<string>): boolean {
  let pruned = false;
  for (const event of Object.keys(hooks)) {
    const groups = hooks[event];
    if (!Array.isArray(groups)) continue;
    let touched = false;
    const kept: HookGroup[] = [];
    for (const group of groups) {
      if (!group || !Array.isArray(group.hooks)) {
        kept.push(group);
        continue;
      }
      const remaining = group.hooks.filter((h) => {
        const command = taskCommandOf(h);
        return command === null || desiredCommands.has(command);
      });
      if (remaining.length === group.hooks.length) {
        kept.push(group);
        continue;
      }
      touched = true;
      if (remaining.length > 0) kept.push({ ...group, hooks: remaining });
    }
    if (!touched) continue;
    pruned = true;
    if (kept.length > 0) hooks[event] = kept;
    else delete hooks[event];
  }
  return pruned;
}

/** 写入 task hook;返回本次写入的事件与因已存在而跳过的事件。 */
export function installTaskHooks(
  projectRoot: string,
  opts: { agent?: AgentId } = {},
): { written: string[]; skipped: string[] } {
  const profile = profileOf(opts.agent);
  const settingsPath = agentSettingsPath(projectRoot, profile);
  const settings = readSettings(settingsPath);
  const hooks: HooksConfig = settings.hooks && typeof settings.hooks === 'object' ? settings.hooks : {};
  const groups = taskHookGroups(profile);

  // 先清掉旧命令(例如 PostToolUse、无容错后缀的 SessionStart),再按幂等逻辑追加。
  const desiredCommands = new Set(groups.flatMap(({ group }) => group.hooks.map((h) => h.command)));
  const pruned = pruneStaleTaskHooks(hooks, desiredCommands);

  const written: string[] = [];
  const skipped: string[] = [];
  for (const { event, group } of groups) {
    const existing = Array.isArray(hooks[event]) ? hooks[event] : [];
    const commands = group.hooks.map((h) => h.command);
    const alreadyThere = existing.some((g) =>
      Array.isArray(g?.hooks) && g.hooks.some((h) => commands.includes(h?.command)),
    );
    if (alreadyThere) {
      skipped.push(event);
      continue;
    }
    hooks[event] = [...existing, structuredClone(group)];
    written.push(event);
  }

  if (written.length > 0 || pruned) {
    settings.hooks = hooks;
    writeSettings(settingsPath, settings);
  }
  return { written, skipped };
}

/** 移除命令里带 `cgraphx task-` 的 hook 项;返回有项被移除的事件。 */
export function uninstallTaskHooks(
  projectRoot: string,
  opts: { agent?: AgentId } = {},
): { removed: string[] } {
  const settingsPath = agentSettingsPath(projectRoot, profileOf(opts.agent));
  if (!fs.existsSync(settingsPath)) return { removed: [] };

  const settings = readSettings(settingsPath);
  const hooks = settings.hooks;
  if (!hooks || typeof hooks !== 'object') return { removed: [] };

  const removed: string[] = [];
  for (const event of Object.keys(hooks)) {
    const groups = hooks[event];
    if (!Array.isArray(groups)) continue;
    let touched = false;
    const kept: HookGroup[] = [];
    for (const group of groups) {
      if (!group || !Array.isArray(group.hooks)) {
        kept.push(group);
        continue;
      }
      const remaining = group.hooks.filter((h) => !isTaskEntry(h));
      if (remaining.length === group.hooks.length) {
        kept.push(group);
        continue;
      }
      touched = true;
      if (remaining.length > 0) kept.push({ ...group, hooks: remaining });
    }
    if (!touched) continue;
    removed.push(event);
    if (kept.length > 0) hooks[event] = kept;
    else delete hooks[event];
  }

  if (removed.length > 0) {
    if (Object.keys(hooks).length === 0) delete settings.hooks;
    writeSettings(settingsPath, settings);
  }
  return { removed };
}

// ─── settings 读写 ──────────────────────────────────────────────────────────

/** task 条目的命令串;非 task 条目录返回 null。 */
function taskCommandOf(entry: unknown): string | null {
  if (!entry || typeof entry !== 'object') return null;
  const cmd = (entry as HookEntry).command;
  return typeof cmd === 'string' && cmd.includes(TASK_HOOK_MARKER) ? cmd : null;
}

function isTaskEntry(entry: unknown): boolean {
  return taskCommandOf(entry) !== null;
}

function readSettings(settingsPath: string): SettingsJson {
  if (!fs.existsSync(settingsPath)) return {};
  try {
    const parsed = JSON.parse(fs.readFileSync(settingsPath, 'utf8')) as unknown;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as SettingsJson) : {};
  } catch {
    return {};
  }
}

function writeSettings(settingsPath: string, settings: SettingsJson): void {
  fs.mkdirSync(path.dirname(settingsPath), { recursive: true });
  fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2) + '\n', 'utf8');
}
