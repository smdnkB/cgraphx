/**
 * task hook 的项目级接入与移除(spec §10、§12)。
 *
 * 只读写目标项目的 `<projectRoot>/.claude/settings.json`,不碰全局 `~/.claude/`。
 *   - 幂等:同一事件已有相同命令就跳过,重复安装不产生重复项;
 *   - 可逆:卸载只移除命令里带 `cgraphx task-` 标记的项,不碰用户其它 hook,
 *     清掉因此变空的组和事件键。
 *
 * settings 读写写法参照 timeline installer,按分层约束不 import 其内部模块。
 */

import fs from 'node:fs';
import path from 'node:path';

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

/** task 接入的 hook:SessionStart 全量触发,PostToolUse 用 matcher 限定写类工具。 */
const TASK_HOOK_GROUPS: ReadonlyArray<{ event: string; group: HookGroup }> = [
  {
    event: 'SessionStart',
    group: { hooks: [{ type: 'command', command: 'cgraphx task-session-start-hook' }] },
  },
  {
    event: 'PostToolUse',
    group: {
      matcher: 'Edit|Write|MultiEdit|NotebookEdit',
      hooks: [{ type: 'command', command: 'cgraphx task-post-tool-use-hook' }],
    },
  },
];

/** 写入 task hook;返回本次写入的事件与因已存在而跳过的事件。 */
export function installTaskHooks(projectRoot: string): { written: string[]; skipped: string[] } {
  const settingsPath = settingsPathOf(projectRoot);
  const settings = readSettings(settingsPath);
  const hooks: HooksConfig = settings.hooks && typeof settings.hooks === 'object' ? settings.hooks : {};

  const written: string[] = [];
  const skipped: string[] = [];
  for (const { event, group } of TASK_HOOK_GROUPS) {
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

/** 移除命令里带 `cgraphx task-` 的 hook 项;返回有项被移除的事件。 */
export function uninstallTaskHooks(projectRoot: string): { removed: string[] } {
  const settingsPath = settingsPathOf(projectRoot);
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

function settingsPathOf(projectRoot: string): string {
  return path.join(path.resolve(projectRoot), '.claude', 'settings.json');
}

function isTaskEntry(entry: unknown): boolean {
  if (!entry || typeof entry !== 'object') return false;
  const cmd = (entry as HookEntry).command;
  return typeof cmd === 'string' && cmd.includes(TASK_HOOK_MARKER);
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
