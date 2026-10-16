/**
 * sync hook 的项目级接入与移除(spec §4.1 自动、§8「旧版 cgraphx 共存」「已安装项目」)。
 *
 * 只读写目标项目中该 agent 的项目共享 settings,不碰全局配置。
 *   - 命令统一带 ` 2>/dev/null || true` 后缀:PATH 命中不认识新命令的旧版全局 cgraphx 时
 *     不出错误输出、退出码 0(代价是 hook 自身的 stderr 告警不可见);
 *   - 幂等:同一事件已有完整命令串相同的项就跳过;
 *   - 可逆:卸载只移除命令里带 `cgraphx sync-` 标记的项,不碰其它 hook,清掉因此变空的组和事件键。
 *
 * 写法参照 task installer,按分层约束不 import 其内部模块。
 */

import fs from 'node:fs';
import path from 'node:path';

import { agentSettingsPath, DEFAULT_AGENT_ID, hookCommand, requireAgentProfile } from '../agents';
import type { AgentId, AgentProfile } from '../agents';
import { SYNC_HOOK_MARKER } from './constants';

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

/** 旧版二进制兜底:吞掉 stderr 与非零退出码。 */
function silent(cmd: string): string {
  return `${cmd} 2>/dev/null || true`;
}

/** sync 接入的 hook:SessionStart 提示 + 拉起;Stop / SessionEnd 拉起。 */
function syncHookGroups(profile: AgentProfile): ReadonlyArray<{ event: string; group: HookGroup }> {
  const start = silent(hookCommand('cgraphx sync-session-start-hook', profile));
  const stop = silent(hookCommand('cgraphx sync-stop-hook', profile));
  return [
    { event: 'SessionStart', group: { hooks: [{ type: 'command', command: start }] } },
    { event: 'Stop', group: { hooks: [{ type: 'command', command: stop }] } },
    { event: 'SessionEnd', group: { hooks: [{ type: 'command', command: stop }] } },
  ];
}

/** 取 agent 描述:缺省为默认 agent;未登记的 id 抛错(不静默回退,避免写错 agent 的配置)。 */
function profileOf(agent: AgentId | undefined): AgentProfile {
  return requireAgentProfile(agent ?? DEFAULT_AGENT_ID);
}

/** 写入 sync hook;返回本次写入的事件与因已存在而跳过的事件。 */
export function installSyncHooks(
  projectRoot: string,
  opts: { agent?: AgentId } = {},
): { written: string[]; skipped: string[] } {
  const profile = profileOf(opts.agent);
  const settingsPath = agentSettingsPath(projectRoot, profile);
  const settings = readSettings(settingsPath);
  const hooks: HooksConfig = settings.hooks && typeof settings.hooks === 'object' ? settings.hooks : {};

  const written: string[] = [];
  const skipped: string[] = [];
  for (const { event, group } of syncHookGroups(profile)) {
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

  if (written.length > 0) {
    settings.hooks = hooks;
    writeSettings(settingsPath, settings);
  }
  return { written, skipped };
}

/** 移除命令里带 `cgraphx sync-` 的 hook 项;返回有项被移除的事件。 */
export function uninstallSyncHooks(
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
      const remaining = group.hooks.filter((h) => !isSyncEntry(h));
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

function isSyncEntry(entry: unknown): boolean {
  if (!entry || typeof entry !== 'object') return false;
  const cmd = (entry as HookEntry).command;
  return typeof cmd === 'string' && cmd.includes(SYNC_HOOK_MARKER);
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
