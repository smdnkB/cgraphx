/**
 * 通用 agent target:由 agent 描述(AgentProfile)生成,承接原 Claude 专属 target 的全部行为。
 *
 * 写入内容(仅项目本地):
 *   - `hooks.UserPromptSubmit`(context-monitor)——仅当 `capabilities.contextMonitor`。
 *   - `statusLine`(claude-hud)——仅当 `capabilities.statusLine`;非 cgraphx 的 statusLine 保留并提示。
 *   - `hooks.PreToolUse`(precommit-check,matcher `Bash`)——一律写入。
 *   - 死 hook 清理:pre-0.8 的 `codegraph mark-dirty` / `sync-if-dirty` 与 2.0 移除的
 *     `cgraphx prompt-hook`(install 自愈,uninstall 一并清扫)。
 *   - 配置目录下的模板资产(skills / agents / commands / hooks / plugins),按 agent 替换与能力过滤。
 *   - 指引文件中的 cgraphx 标记块(内容取模板根 CLAUDE.md 并按 agent 替换)。
 *
 * 卸载只移除 cgraphx 条目:用户自己的 hook、settings 其他配置、标记块外内容、
 * 不在包清单里的文件全部保留。
 */

import * as fs from 'node:fs';
import {
  CGRAPHX_SECTION_END,
  CGRAPHX_SECTION_START,
  agentConfigDir,
  agentInstructionsPath,
  agentSettingsPath,
  applyAssetReplacements,
  isAgentDetected,
  isAgentInstalled,
  type AgentProfile,
} from '../../../core/agents';
import type {
  AgentTarget,
  DetectionResult,
  InstallOptions,
  Location,
  WriteResult,
} from './types';
import {
  readJsonFile,
  writeJsonFile,
  removeMarkedSection,
  replaceOrAppendMarkedSection,
} from './shared';
import { deployClaudeAssets, readTemplateClaudeMd, removeClaudeAssets } from '../claude-assets';

/** 2.0 已移除的前置 hook 命令:install 不再写,只用于识别残留。 */
const PROMPT_HOOK_COMMAND = 'cgraphx prompt-hook';

/** settings 中本模块关心的子集;刻意宽松,只遍历已知数组 / 对象。 */
interface SettingsJson {
  hooks?: Record<string, Array<{ matcher?: string; hooks?: Array<{ type?: string; command?: string; timeout?: number }> }>>;
  statusLine?: { type?: string; command?: string } | null;
  [k: string]: unknown;
}

type FileChange = WriteResult['files'][number];

/** 某个 agent 下 cgraphx 写入的三条命令(claude-code 下与改造前逐字相同)。 */
interface AgentCommands {
  contextMonitor: string;
  claudeHud: string;
  precommitCheck: string;
}

function commandsFor(profile: AgentProfile): AgentCommands {
  const base = `node $${profile.projectDirEnv}/${profile.configDirName}`;
  return {
    contextMonitor: `${base}/hooks/context-monitor/context-monitor.cjs`,
    claudeHud: `${base}/plugins/claude-hud/dist/index.js`,
    precommitCheck: `${base}/hooks/precommit-check/precommit-check.cjs`,
  };
}

class GenericAgentTarget implements AgentTarget {
  readonly id: AgentProfile['id'];
  readonly displayName: string;
  private readonly commands: AgentCommands;

  constructor(readonly profile: AgentProfile) {
    this.id = profile.id;
    this.displayName = profile.displayName;
    this.commands = commandsFor(profile);
  }

  /** 项目根仍取 process.cwd()(2.0 只支持项目本地安装)。 */
  private root(): string {
    return process.cwd();
  }

  private settingsPath(): string {
    return agentSettingsPath(this.root(), this.profile);
  }

  supportsLocation(_loc: Location): boolean {
    return true;
  }

  detect(_loc: Location): DetectionResult {
    const root = this.root();
    return {
      detected: isAgentDetected(root, this.profile),
      installed: isAgentInstalled(root, this.profile),
      configPath: agentSettingsPath(root, this.profile),
    };
  }

  install(loc: Location, _opts: InstallOptions): WriteResult {
    const files: FileChange[] = [];
    const notes: string[] = [];
    const caps = this.profile.capabilities;

    // 1. context-monitor hook + statusLine(按能力);用户其他 hook 与非 cgraphx statusLine 保留
    if (caps.contextMonitor || caps.statusLine) {
      const hookResult = this.writeHooksAndStatusLineEntry();
      files.push(hookResult.file);
      if (hookResult.notes.length > 0) notes.push(...hookResult.notes);
    }

    // 2. precommit-check(PreToolUse / Bash),一律写入
    files.push(this.writePrecommitHookEntry());

    // 3. 清理已移除子命令留下的死 hook,升级即自愈;有移除才上报
    const hookCleanup = this.cleanupDeadHooks();
    if (hookCleanup.action === 'removed') files.push(hookCleanup);

    // 4. 指引文件标记块 upsert(同一标记,旧 1.x 块原位替换)
    const instructions = this.writeInstructionsEntry();
    if (instructions.action !== 'kept') files.push(instructions);

    // 5. 部署模板资产到该 agent 的配置目录(同名无条件覆盖,用户自加文件保留)
    if (loc === 'local') {
      const assetChanges = deployClaudeAssets(agentConfigDir(this.root(), this.profile), this.profile);
      for (const change of assetChanges) {
        if (change.action === 'not-found') continue; // 未内置模板
        files.push(change);
      }
    }

    return notes.length > 0 ? { files, notes } : { files };
  }

  uninstall(_loc: Location): WriteResult {
    const files: FileChange[] = [];

    // 1. 精确移除 cgraphx hook 命令;statusLine 仅当指向 claude-hud 时移除
    files.push(this.removeCgraphxSettings());

    // 2. 死 hook 清扫(与 install 自愈共用)
    const hookCleanup = this.cleanupDeadHooks();
    if (hookCleanup.action === 'removed') files.push(hookCleanup);

    // 3. 剥离指引文件标记块
    const file = agentInstructionsPath(this.root(), this.profile);
    files.push({ path: file, action: removeMarkedSection(file, CGRAPHX_SECTION_START, CGRAPHX_SECTION_END) });

    // 4. 按模板清单移除包自带资产;清单外的用户文件保留
    const assetChanges = removeClaudeAssets(agentConfigDir(this.root(), this.profile), undefined, this.profile);
    for (const change of assetChanges) {
      if (change.action === 'not-found') continue;
      files.push(change);
    }

    return { files };
  }

  describePaths(_loc: Location): string[] {
    return [this.settingsPath(), agentInstructionsPath(this.root(), this.profile)];
  }

  /** settings 中由 cgraphx 拥有的命令:检测与精确卸载共用。 */
  private isCgraphxHookCommand(command: string): boolean {
    return (
      command.includes(this.commands.contextMonitor) ||
      command.includes(this.commands.precommitCheck) ||
      command.includes(PROMPT_HOOK_COMMAND) ||
      command.includes('codegraph mark-dirty') ||
      command.includes('codegraph sync-if-dirty')
    );
  }

  /**
   * 移除全部 cgraphx hook 命令与 claude-hud statusLine,并修剪清空的 group / event /
   * `hooks` 键。有移除报 `removed`,无 cgraphx 内容报 `not-found`,文件不存在报 `kept`。
   */
  private removeCgraphxSettings(): FileChange {
    const file = this.settingsPath();
    if (!fs.existsSync(file)) return { path: file, action: 'kept' };

    const settings = readJsonFile(file) as SettingsJson;
    let changed = false;

    const hooks = settings.hooks;
    if (hooks && typeof hooks === 'object' && !Array.isArray(hooks)) {
      for (const event of Object.keys(hooks)) {
        const groups = hooks[event];
        if (!Array.isArray(groups)) continue;
        for (const group of groups) {
          const inner = group?.hooks;
          if (!Array.isArray(inner)) continue;
          const before = inner.length;
          // 原位重建数组,只丢弃 cgraphx 命令
          const filtered = inner.filter(
            (h) => !(h && typeof h === 'object' && typeof h.command === 'string' && this.isCgraphxHookCommand(h.command)),
          );
          if (filtered.length !== before) {
            group.hooks = filtered;
            changed = true;
          }
        }
        // 先修剪空 group,再修剪空 event
        hooks[event] = groups.filter(
          (g) => g && Array.isArray(g.hooks) && g.hooks.length > 0,
        );
        if (hooks[event].length === 0) delete hooks[event];
      }
      if (Object.keys(hooks).length === 0) {
        delete settings.hooks;
      } else {
        settings.hooks = hooks;
      }
    }

    const sl = settings.statusLine;
    if (sl && typeof sl === 'object' && typeof sl.command === 'string' && sl.command.includes('claude-hud')) {
      delete settings.statusLine;
      changed = true;
    }

    if (!changed) return { path: file, action: 'not-found' };

    writeJsonFile(file, settings);
    return { path: file, action: 'removed' };
  }

  /** 移除死 hook(见 isDeadHookCommand);install 与 uninstall 共用。 */
  private cleanupDeadHooks(): FileChange {
    const file = this.settingsPath();
    if (!fs.existsSync(file)) return { path: file, action: 'not-found' };

    const settings = readJsonFile(file) as SettingsJson;
    const hooks = settings.hooks;
    if (!hooks || typeof hooks !== 'object' || Array.isArray(hooks)) {
      return { path: file, action: 'unchanged' };
    }

    let removedAny = false;
    for (const event of Object.keys(hooks)) {
      const groups = hooks[event];
      if (!Array.isArray(groups)) continue;
      for (const group of groups) {
        if (!group || !Array.isArray(group.hooks)) continue;
        const before = group.hooks.length;
        group.hooks = group.hooks.filter((h) => !isDeadHookCommand((h as { command?: unknown })?.command));
        if (group.hooks.length !== before) removedAny = true;
      }
    }
    if (!removedAny) return { path: file, action: 'unchanged' };

    for (const event of Object.keys(hooks)) {
      const groups = hooks[event];
      if (!Array.isArray(groups)) continue;
      hooks[event] = groups.filter(
        (g) => !(g && Array.isArray(g.hooks) && g.hooks.length === 0),
      );
      if (hooks[event].length === 0) delete hooks[event];
    }
    if (Object.keys(hooks).length === 0) delete settings.hooks;

    writeJsonFile(file, settings);
    return { path: file, action: 'removed' };
  }

  /**
   * 追加 context-monitor 到 `hooks.UserPromptSubmit`、statusLine 指向 claude-hud(各按能力)。
   * 只追加不破坏:按 command 去重,重复安装为空操作;非 cgraphx statusLine 保留并给出提示。
   */
  private writeHooksAndStatusLineEntry(): { file: FileChange; notes: string[] } {
    const file = this.settingsPath();
    const settings = readJsonFile(file) as SettingsJson;
    const created = !fs.existsSync(file);
    const notes: string[] = [];
    let changed = false;
    const caps = this.profile.capabilities;
    const { contextMonitor, claudeHud } = this.commands;

    if (caps.contextMonitor) {
      if (!settings.hooks || typeof settings.hooks !== 'object') settings.hooks = {};
      if (!Array.isArray(settings.hooks.UserPromptSubmit)) settings.hooks.UserPromptSubmit = [];

      const alreadyHasContextMonitor = settings.hooks.UserPromptSubmit.some((entry) => {
        if (!entry || typeof entry !== 'object') return false;
        const inner = entry.hooks;
        if (!Array.isArray(inner)) return false;
        return inner.some(
          (h) => h && typeof h === 'object' && (h as { command?: unknown }).command === contextMonitor,
        );
      });

      if (!alreadyHasContextMonitor) {
        settings.hooks.UserPromptSubmit.push({
          hooks: [{
            type: 'command',
            command: contextMonitor,
            timeout: 5000,
          }],
        });
        changed = true;
      }
    }

    if (caps.statusLine) {
      const existing = settings.statusLine;
      if (existing && typeof existing === 'object') {
        const cmd = existing.command;
        const isOurs = typeof cmd === 'string' && cmd.includes('claude-hud');
        if (!isOurs) {
          notes.push(
            `statusLine already set to a non-cgraphx command ("${typeof cmd === 'string' ? cmd : '<unknown>'}"); not overwritten. To use claude-hud, set statusLine.command to "${claudeHud}".`,
          );
        }
      } else {
        settings.statusLine = {
          type: 'command',
          command: claudeHud,
        };
        changed = true;
      }
    }

    if (!changed && !created) {
      return { file: { path: file, action: 'unchanged' }, notes };
    }

    writeJsonFile(file, settings);
    return {
      file: { path: file, action: created ? 'created' : 'updated' },
      notes,
    };
  }

  /**
   * 写入 precommit-check 的 PreToolUse hook(matcher `Bash`):agent 执行 `git commit`
   * 且暂存区非空时拦截,指向 `docs/guides/git-standards.md` 自查后带
   * `CGRAPHX_PRECOMMIT_REVIEWED=1` 重试。按 command 去重,同事件下其他 hook 保留。
   */
  private writePrecommitHookEntry(): FileChange {
    const file = this.settingsPath();
    const settings = readJsonFile(file) as SettingsJson;
    const created = !fs.existsSync(file);
    const { precommitCheck } = this.commands;

    if (!settings.hooks || typeof settings.hooks !== 'object') settings.hooks = {};
    if (!Array.isArray(settings.hooks.PreToolUse)) settings.hooks.PreToolUse = [];

    const alreadyHas = settings.hooks.PreToolUse.some((entry) => {
      if (!entry || typeof entry !== 'object') return false;
      const inner = entry.hooks;
      if (!Array.isArray(inner)) return false;
      return inner.some(
        (h) => h && typeof h === 'object' && (h as { command?: unknown }).command === precommitCheck,
      );
    });

    if (alreadyHas && !created) {
      return { path: file, action: 'unchanged' };
    }

    if (!alreadyHas) {
      settings.hooks.PreToolUse.push({
        matcher: 'Bash',
        hooks: [{
          type: 'command',
          command: precommitCheck,
          timeout: 10000,
        }],
      });
    }

    writeJsonFile(file, settings);
    return { path: file, action: created ? 'created' : 'updated' };
  }

  /**
   * upsert 指引块:内容取模板根 CLAUDE.md 并按 agent 替换,标记包围,幂等、保留块外内容。
   * 模板缺失(源码未构建)时返回 `kept`,由调用方从报告中丢弃。
   */
  private writeInstructionsEntry(): FileChange {
    const file = agentInstructionsPath(this.root(), this.profile);
    const content = readTemplateClaudeMd();
    if (content === null) {
      return { path: file, action: 'kept' };
    }
    const action = replaceOrAppendMarkedSection(
      file,
      CGRAPHX_SECTION_START,
      CGRAPHX_SECTION_END,
      applyAssetReplacements(content, this.profile),
    );
    return { path: file, action };
  }
}

/**
 * hook 命令是否指向已不存在的子命令(只会在运行时报错的「死 hook」):
 * pre-0.8 自动同步对(子串匹配,兼容 `npx …` 形式)与 2.0 移除的 `cgraphx prompt-hook`。
 */
function isDeadHookCommand(command: unknown): boolean {
  if (typeof command !== 'string') return false;
  return (
    command.includes('codegraph mark-dirty') ||
    command.includes('codegraph sync-if-dirty') ||
    command.includes(PROMPT_HOOK_COMMAND)
  );
}

/** 由 agent 描述生成 target。 */
export function createAgentTarget(profile: AgentProfile): AgentTarget {
  return new GenericAgentTarget(profile);
}
