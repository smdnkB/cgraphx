/**
 * 通用 agent target:由 agent 描述(AgentProfile)生成,承接原 Claude 专属 target 的全部行为。
 *
 * 写入内容(仅项目本地):
 *   - `hooks.UserPromptSubmit`(context-monitor)——仅当 `capabilities.contextMonitor`。
 *   - `statusLine`(claude-hud)——仅当 `capabilities.statusLine`;非 cgraphx 的 statusLine 保留并提示。
 *   - 死 hook 清理:pre-0.8 的 `codegraph mark-dirty` / `sync-if-dirty`、2.0 移除的 `cgraphx prompt-hook`、
 *     2.0.14 下掉的平台同步与开发任务五条 hook(spec:2026-11-05-下掉web与平台同步 D5),以及 2.0.15 撤掉的
 *     七条时间线 hook 与 precommit-check 脚本条目(spec:2026-11-06-会话文件解析替代hooks D17、K21;install
 *     自愈,uninstall 一并清扫;被移除时经 notes 回传一行提示)。
 *   - 配置目录下的模板资产(skills / agents / commands / hooks / plugins),按 agent 替换与能力过滤。
 *   - 资产部署成功后,配置目录下的版本记录 `cgraphx-version.json`(会话提示据此提示 skill 落后)。
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
import { SKILL_VERSION_FILE, getCliVersion, removeSkillVersion, writeSkillVersion } from '../../../core/skill-version';

/** 2.0 已移除的前置 hook 命令:install 不再写,只用于识别残留。 */
const PROMPT_HOOK_COMMAND = 'cgraphx prompt-hook';

/**
 * 2.0.14 下掉的平台同步、开发任务五条 hook 子命令(spec F3 D5):按完整子命令名认(前面是 `cgraphx `),
 * 不按 `cgraphx sync-` / `cgraphx task-` 前缀认——以后同前缀的新命令会被误删。带不带 `--agent <id>`、
 * 带不带容错后缀(` 2>/dev/null || true`)都算:取的是「命令串里含 `cgraphx <完整子命令名>`」。
 */
const REMOVED_FEATURE_HOOK_COMMANDS = [
  'cgraphx sync-session-start-hook',
  'cgraphx sync-stop-hook',
  'cgraphx task-session-start-hook',
  'cgraphx task-stop-hook',
  'cgraphx task-post-tool-use-hook',
] as const;

/**
 * 2.0.15 撤掉的七条时间线 hook 子命令(spec:2026-11-06-会话文件解析替代hooks D17、K21——会话事件改由
 * 会话文件解析补录):匹配口径同上(完整子命令名,带不带 `--agent` / 容错后缀都认)。`timeline-git-commit-hook`
 * 还在(git 钩子调起),不进名单。名单同时是 cli/legacy-hook-commands.ts 空命令的来源。
 */
const TIMELINE_HOOK_COMMANDS = [
  'cgraphx timeline-session-start-hook',
  'cgraphx timeline-session-end-hook',
  'cgraphx timeline-user-prompt-hook',
  'cgraphx timeline-pre-tool-use-hook',
  'cgraphx timeline-post-tool-use-hook',
  'cgraphx timeline-stop-hook',
  'cgraphx timeline-post-tool-use-failure-hook',
] as const;

/** 已废弃的 precommit-check 脚本条目(提交门禁改走 git commit-msg 钩子;脚本不再随包分发)。 */
const DEPRECATED_PRECOMMIT_SCRIPT = '/hooks/precommit-check/precommit-check.cjs';

/** settings 中本模块关心的子集;刻意宽松,只遍历已知数组 / 对象。 */
interface SettingsJson {
  hooks?: Record<string, Array<{ matcher?: string; hooks?: Array<{ type?: string; command?: string; timeout?: number }> }>>;
  statusLine?: { type?: string; command?: string } | null;
  [k: string]: unknown;
}

type FileChange = WriteResult['files'][number];

/**
 * 某个 agent 下 cgraphx 相关的三条命令:contextMonitor / claudeHud 是 install 会写的;
 * precommitCheck 自 2.0.15 起不再写(提交门禁改走 git commit-msg 钩子),保留只为识别与
 * 精确卸载旧配置里的条目(死 hook 清理按脚本路径删,卸载按 command 精确删)。
 */
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

    // 2. 清理已移除子命令 / 已废弃脚本留下的死 hook,升级即自愈;有移除才上报。已下掉的 hook 被移除时
    //    多一行 note(平台同步、开发任务一批;时间线与提交门禁一批)
    const hookCleanup = this.cleanupDeadHooks();
    if (hookCleanup.file.action === 'removed') files.push(hookCleanup.file);
    notes.push(...hookCleanup.notes);

    // 3. 指引文件标记块 upsert(同一标记,旧 1.x 块原位替换)
    const instructions = this.writeInstructionsEntry();
    if (instructions.action !== 'kept') files.push(instructions);

    // 4. 部署模板资产到该 agent 的配置目录(同名无条件覆盖,用户自加文件保留)
    if (loc === 'local') {
      const assetChanges = deployClaudeAssets(agentConfigDir(this.root(), this.profile), this.profile);
      let deployed = false;
      for (const change of assetChanges) {
        if (change.action === 'not-found') continue; // 未内置模板
        deployed = true;
        files.push(change);
      }

      // 5. 资产部署成功后写版本记录;没有内置模板或读不到本机版本时不写。
      //    记录文件不进文件变更列表,只多一行 note,安装输出只多这一行(skill版本落后提示 spec D2)
      const version = deployed ? getCliVersion() : null;
      if (version !== null) {
        writeSkillVersion(this.root(), this.profile, version);
        notes.push(`项目 skill 已对齐到 ${version}`);
      }
    }

    return notes.length > 0 ? { files, notes } : { files };
  }

  uninstall(_loc: Location): WriteResult {
    const files: FileChange[] = [];
    const notes: string[] = [];

    // 1. 精确移除 cgraphx hook 命令;statusLine 仅当指向 claude-hud 时移除
    files.push(this.removeCgraphxSettings());

    // 2. 死 hook 清扫(与 install 自愈共用);已下掉的 hook 被移除时同样回传 note
    const hookCleanup = this.cleanupDeadHooks();
    if (hookCleanup.file.action === 'removed') files.push(hookCleanup.file);
    notes.push(...hookCleanup.notes);

    // 3. 剥离指引文件标记块
    const file = agentInstructionsPath(this.root(), this.profile);
    files.push({ path: file, action: removeMarkedSection(file, CGRAPHX_SECTION_START, CGRAPHX_SECTION_END) });

    // 4. 按模板清单移除包自带资产;清单外的用户文件保留
    const assetChanges = removeClaudeAssets(agentConfigDir(this.root(), this.profile), undefined, this.profile);
    for (const change of assetChanges) {
      if (change.action === 'not-found') continue;
      files.push(change);
    }

    // 5. 版本记录随自带资产一并删除(skill版本落后提示 spec D3)
    if (removeSkillVersion(this.root(), this.profile)) {
      files.push({ path: `${this.profile.configDirName}/${SKILL_VERSION_FILE}`, action: 'removed' });
    }

    return notes.length > 0 ? { files, notes } : { files };
  }

  describePaths(_loc: Location): string[] {
    return [this.settingsPath(), agentInstructionsPath(this.root(), this.profile)];
  }

  /**
   * settings 中由 cgraphx 拥有的命令:检测与精确卸载共用。precommitCheck 虽已不再写,
   * 识别保留——卸载旧配置时仍要按 command 精确删掉它的条目。
   */
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

  /**
   * 移除死 hook(见 isDeadHookCommand);install 与 uninstall 共用。移除的条目里有已下掉的子命令 / 已废弃的
   * precommit-check 脚本条目时,notes 各带一行(事件去重,取实际删掉条目所属的 hook 事件;只删 1.x 那三条
   * 死 hook 时都不出):
   *   - 平台同步、开发任务一批:`平台同步、开发任务已下掉:已移除 hooks(<事件名 / 连>)`
   *   - 时间线与提交门禁一批:`时间线和提交门禁改走会话文件和 git 钩子:已移除 hooks(<事件名 / 连>)`
   */
  private cleanupDeadHooks(): { file: FileChange; notes: string[] } {
    const file = this.settingsPath();
    if (!fs.existsSync(file)) return { file: { path: file, action: 'not-found' }, notes: [] };

    const settings = readJsonFile(file) as SettingsJson;
    const hooks = settings.hooks;
    if (!hooks || typeof hooks !== 'object' || Array.isArray(hooks)) {
      return { file: { path: file, action: 'unchanged' }, notes: [] };
    }

    let removedAny = false;
    const removedFeatureEvents: string[] = [];
    const removedTimelineEvents: string[] = [];
    const cmd = (h: unknown): unknown => (h as { command?: unknown })?.command;
    for (const event of Object.keys(hooks)) {
      const groups = hooks[event];
      if (!Array.isArray(groups)) continue;
      for (const group of groups) {
        if (!group || !Array.isArray(group.hooks)) continue;
        const removed = group.hooks.filter((h) => isDeadHookCommand(cmd(h)));
        if (removed.length === 0) continue;
        removedAny = true;
        group.hooks = group.hooks.filter((h) => !isDeadHookCommand(cmd(h)));
        if (!removedFeatureEvents.includes(event) && removed.some((h) => isRemovedFeatureHookCommand(cmd(h)))) {
          removedFeatureEvents.push(event);
        }
        if (!removedTimelineEvents.includes(event) && removed.some((h) => isTimelineRemovalCommand(cmd(h)))) {
          removedTimelineEvents.push(event);
        }
      }
    }
    if (!removedAny) return { file: { path: file, action: 'unchanged' }, notes: [] };

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
    const notes: string[] = [];
    if (removedFeatureEvents.length > 0) {
      notes.push(`平台同步、开发任务已下掉:已移除 hooks(${removedFeatureEvents.join('/')})`);
    }
    if (removedTimelineEvents.length > 0) {
      notes.push(`时间线和提交门禁改走会话文件和 git 钩子:已移除 hooks(${removedTimelineEvents.join('/')})`);
    }
    return { file: { path: file, action: 'removed' }, notes };
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
 * hook 命令是否指向已不存在的子命令 / 已废弃的脚本(只会在运行时报错的「死 hook」):
 * pre-0.8 自动同步对(子串匹配,兼容 `npx …` 形式)、2.0 移除的 `cgraphx prompt-hook`、
 * 2.0.14 下掉的平台同步与开发任务五条子命令(见 REMOVED_FEATURE_HOOK_COMMANDS)、
 * 2.0.15 撤掉的七条时间线子命令(见 TIMELINE_HOOK_COMMANDS)与 precommit-check 脚本条目
 * (DEPRECATED_PRECOMMIT_SCRIPT)。
 */
function isDeadHookCommand(command: unknown): boolean {
  if (typeof command !== 'string') return false;
  return (
    command.includes('codegraph mark-dirty') ||
    command.includes('codegraph sync-if-dirty') ||
    command.includes(PROMPT_HOOK_COMMAND) ||
    command.includes(DEPRECATED_PRECOMMIT_SCRIPT) ||
    isRemovedFeatureHookCommand(command) ||
    isTimelineHookCommand(command)
  );
}

/** 命令是否调已下掉的平台同步、开发任务子命令(完整子命令名匹配,不按前缀)。 */
function isRemovedFeatureHookCommand(command: unknown): boolean {
  if (typeof command !== 'string') return false;
  return REMOVED_FEATURE_HOOK_COMMANDS.some((c) => command.includes(c));
}

/** 命令是否调已撤掉的时间线 hook 子命令(完整子命令名匹配;timeline-git-commit-hook 不在名单)。 */
function isTimelineHookCommand(command: unknown): boolean {
  if (typeof command !== 'string') return false;
  return TIMELINE_HOOK_COMMANDS.some((c) => command.includes(c));
}

/** 命令属于「时间线 + 提交门禁」这一批死 hook(撤掉的七条时间线子命令或废弃的 precommit-check 脚本)。 */
function isTimelineRemovalCommand(command: unknown): boolean {
  if (typeof command !== 'string') return false;
  return isTimelineHookCommand(command) || command.includes(DEPRECATED_PRECOMMIT_SCRIPT);
}

/** 由 agent 描述生成 target。 */
export function createAgentTarget(profile: AgentProfile): AgentTarget {
  return new GenericAgentTarget(profile);
}
