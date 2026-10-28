/**
 * timeline 子系统的项目级 hook 安装器。
 *
 * 只写项目自己的 agent 配置(如 `.claude/settings.json`)和 git 钩子目录里的 post-commit、
 * post-merge(经 `../git-hooks` 写入:跟随 core.hooksPath,片段紧跟 shebang),绝不碰用户
 * 全局的 `~/.claude/`(spec §0.2 #4、§7.3、D33)。
 *
 * 幂等:重复安装每个事件只留一条 hook。可逆:卸载只删安装写入的内容,用户自己的 hook 原样保留。
 */

import * as fs from 'node:fs';
import * as path from 'node:path';

import { execSync } from 'node:child_process';

import { agentSettingsPath, DEFAULT_AGENT_ID, hookCommand, requireAgentProfile, type AgentId } from '../agents';
import { DatabaseConnection, getDatabasePath } from '../db';
import { resolveDataDir } from '../directory';
import { installHookSnippet, removeHookSnippet, resolveHooksDir, type HookSnippetResult } from '../git-hooks';
import {
  COMMIT_BRANCH_ENV,
  COMMIT_HOOK_ENV,
  COMMIT_REFLOG_ENV,
  COMMIT_SHA_ENV,
  GIT_COMMIT_SUBCOMMAND,
  HOOK_EVENTS_TO_COMMANDS,
  LEGACY_BINARY_TOLERANT_SUFFIX,
  type HookEventEntry,
} from './constants';
import { cleanDebrisCgraphxDirs } from './debris';
import { LEGACY_TURN_STATE_FILENAME } from './turn-state';

export interface InstallReport {
  projectRoot: string;
  settingsPath: string;
  /** post-commit 钩子文件路径;不在 git 仓库为 null。 */
  gitHookPath: string | null;
  writtenHookEvents: string[];
  /** post-commit 片段本次写了盘(status 为 installed 或 updated)。 */
  gitHookWritten: boolean;
  skipped: string[];
  /** 本次安装顺手清理掉的碎片 `.cgraphx/` 目录(仅含 turn 文件的空壳)。 */
  debrisRemoved: string[];
  /** post-commit、post-merge 片段的写入结果,按此顺序;不在 git 仓库为 []。 */
  gitHooks: HookSnippetResult[];
}

export interface UninstallReport {
  projectRoot: string;
  settingsPath: string;
  /** post-commit 钩子文件路径;不在 git 仓库为 null。 */
  gitHookPath: string | null;
  removedHookEvents: string[];
  /** 本次从 post-commit 钩子删掉了片段。 */
  gitHookRemoved: boolean;
  /** 本次从 post-merge 钩子删掉了片段。 */
  mergeHookRemoved: boolean;
  dataDropped: boolean;
}

interface HookEntry {
  type: 'command';
  command: string;
}

interface HookGroup {
  hooks: HookEntry[];
}

type HooksConfig = Record<string, HookGroup[]>;

interface SettingsJson {
  hooks?: HooksConfig;
  [k: string]: unknown;
}

const TIMELINE_MARKER = 'cgraphx timeline-';

function isTimelineEntry(entry: unknown): boolean {
  if (!entry || typeof entry !== 'object') return false;
  const cmd = (entry as HookEntry).command;
  return typeof cmd === 'string' && cmd.includes(TIMELINE_MARKER);
}

function readSettings(settingsPath: string): SettingsJson {
  if (!fs.existsSync(settingsPath)) return {};
  try {
    const raw = fs.readFileSync(settingsPath, 'utf8');
    const parsed = JSON.parse(raw) as SettingsJson;
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function writeSettings(settingsPath: string, settings: SettingsJson): void {
  fs.mkdirSync(path.dirname(settingsPath), { recursive: true });
  fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2) + '\n', 'utf8');
}

/** Find the project's git toplevel, or null if not a git repo. */
function findGitRoot(projectRoot: string): string | null {
  try {
    const out = execSync('git rev-parse --show-toplevel', {
      cwd: projectRoot,
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'ignore'],
    });
    return out.trim() || null;
  } catch {
    return null;
  }
}

/** 片段每行都带的标记:升级与卸载按行精确删除,不碰用户自己的钩子内容。 */
const GIT_HOOK_MARKER = '# cgraphx-timeline-hook';

/**
 * post-commit 片段:先在前台取得本次提交的 hash 与分支,再把记录进程放到后台。
 * 命令替换带 `|| true`:片段紧跟 shebang,钩子是 `#!/bin/sh -e` 这类写法时,一条命令失败
 * (如 detached HEAD 上的 symbolic-ref)会让整个钩子提前退出,跳过原钩子后面的内容。
 */
function buildGitPostCommitSnippet(): string[] {
  return [
    `${GIT_HOOK_MARKER} — record commit events to .cgraphx/cgraphx.db`,
    `__cgx_sha=$(git rev-parse HEAD 2>/dev/null || true); __cgx_branch=$(git symbolic-ref --short -q HEAD 2>/dev/null || true) ${GIT_HOOK_MARKER}`,
    `${COMMIT_SHA_ENV}="$__cgx_sha" ${COMMIT_BRANCH_ENV}="$__cgx_branch" cgraphx ${GIT_COMMIT_SUBCOMMAND} >/dev/null 2>&1 & ${GIT_HOOK_MARKER}`,
  ];
}

/**
 * post-merge 片段:`$1` 为 1 是 squash 合并(不产生提交),跳过;其余同 post-commit,另传
 * COMMIT_HOOK_ENV=post-merge,并当场取 reflog 最新一行经 COMMIT_REFLOG_ENV 传过去,记录进程据此跳过快进
 * (快进不产生新提交)。
 */
function buildGitPostMergeSnippet(): string[] {
  return [
    `${GIT_HOOK_MARKER} — record merge commits to .cgraphx/cgraphx.db`,
    `if [ "$1" != "1" ]; then __cgx_sha=$(git rev-parse HEAD 2>/dev/null || true); __cgx_branch=$(git symbolic-ref --short -q HEAD 2>/dev/null || true); __cgx_reflog=$(git reflog -1 --format=%gs HEAD 2>/dev/null || true); ${COMMIT_HOOK_ENV}=post-merge ${COMMIT_REFLOG_ENV}="$__cgx_reflog" ${COMMIT_SHA_ENV}="$__cgx_sha" ${COMMIT_BRANCH_ENV}="$__cgx_branch" cgraphx ${GIT_COMMIT_SUBCOMMAND} >/dev/null 2>&1 & fi ${GIT_HOOK_MARKER}`,
  ];
}

export function installTimelineHooks(
  projectRoot: string,
  opts: { purgeFirst?: boolean; agent?: AgentId } = {},
): InstallReport {
  const agent = opts.agent ?? DEFAULT_AGENT_ID;
  const profile = requireAgentProfile(agent);
  const resolvedRoot = path.resolve(projectRoot);
  const settingsPath = agentSettingsPath(resolvedRoot, profile);
  const gitRoot = findGitRoot(resolvedRoot);

  if (opts.purgeFirst) {
    uninstallTimelineHooks(resolvedRoot, { purgeData: false, agent });
  }

  const settings = readSettings(settingsPath);
  const hooks: HooksConfig = (settings.hooks && typeof settings.hooks === 'object')
    ? settings.hooks
    : {};

  const written: string[] = [];
  const skipped: string[] = [];

  for (const entry of HOOK_EVENTS_TO_COMMANDS as readonly HookEventEntry[]) {
    const { event, subcommand } = entry;
    // agent 没有该 hook 事件(如 CodeBuddy 无 PostToolUseFailure):不写,也不计入报告
    if (entry.requiresCapability !== undefined && profile.capabilities[entry.requiresCapability] !== true) continue;
    const command = hookCommand(`cgraphx ${subcommand}`, profile)
      + (entry.tolerateLegacyBinary === true ? LEGACY_BINARY_TOLERANT_SUFFIX : '');
    const existing = hooks[event] ?? [];

    // Idempotent: skip if any group already has this exact command.
    const alreadyThere = existing.some(group =>
      group?.hooks?.some(h => h?.command === command),
    );
    if (alreadyThere) {
      skipped.push(event);
      continue;
    }

    existing.push({ hooks: [{ type: 'command', command }] });
    hooks[event] = existing;
    written.push(event);
  }

  settings.hooks = hooks;
  writeSettings(settingsPath, settings);

  // 旧版全项目共享的 turn 状态文件:新逻辑按会话隔离、不再读写它,安装时顺手清理。
  // 失败只报 stderr,不中断安装。
  const legacyTurnFile = path.join(resolvedRoot, '.cgraphx', LEGACY_TURN_STATE_FILENAME);
  try {
    if (fs.existsSync(legacyTurnFile)) fs.rmSync(legacyTurnFile, { force: true });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    process.stderr.write(`[timeline] legacy turn-state remove failed: ${msg}\n`);
  }

  // git 钩子:post-commit 记普通提交和冲突后用 git commit 收尾的合并,post-merge 记 git merge
  // 直接生成的合并提交。已装的片段(含旧版写在文件末尾的、更早不带标记的调用行)先删掉,
  // 再插到 shebang 之后;内容未变则不写盘(幂等)。
  let commitHook: HookSnippetResult | null = null;
  let mergeHook: HookSnippetResult | null = null;
  if (gitRoot) {
    commitHook = installHookSnippet(gitRoot, 'post-commit', GIT_HOOK_MARKER, buildGitPostCommitSnippet(), {
      legacyMatch: GIT_COMMIT_SUBCOMMAND,
    });
    mergeHook = installHookSnippet(gitRoot, 'post-merge', GIT_HOOK_MARKER, buildGitPostMergeSnippet());
  }
  const gitHooks = [commitHook, mergeHook].filter((r): r is HookSnippetResult => r !== null);
  const gitHookWritten = commitHook !== null && (commitHook.status === 'installed' || commitHook.status === 'updated');

  // 存量碎片清理(spec §3.4):按签名精确匹配删除 cwd 漂移 bug 时代散落的
  // 空壳 `.cgraphx/`。幂等;失败只报 stderr,绝不中断安装。
  let debrisRemoved: string[] = [];
  try {
    debrisRemoved = cleanDebrisCgraphxDirs(resolvedRoot);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    process.stderr.write(`[timeline] debris clean failed: ${msg}\n`);
  }

  return {
    projectRoot: resolvedRoot,
    settingsPath,
    gitHookPath: commitHook?.hookPath ?? null,
    writtenHookEvents: written,
    gitHookWritten,
    skipped,
    debrisRemoved,
    gitHooks,
  };
}

export function uninstallTimelineHooks(
  projectRoot: string,
  opts: { purgeData?: boolean; agent?: AgentId; keepGitHook?: boolean } = {},
): UninstallReport {
  const profile = requireAgentProfile(opts.agent ?? DEFAULT_AGENT_ID);
  const resolvedRoot = path.resolve(projectRoot);
  // 副本里共用库在主目录,会删共用数据的操作直接拒绝:先判断,什么都不动(spec 全局约束)
  if (opts.purgeData) {
    const dataDir = resolveDataDir(resolvedRoot);
    if (dataDir.state !== 'own') {
      throw new Error(
        `这是副本,数据在主目录 ${dataDir.mainRoot};要清数据,到主目录执行 cgraphx timeline uninstall --purge(这次什么都没动)`,
      );
    }
  }
  const settingsPath = agentSettingsPath(resolvedRoot, profile);
  const gitRoot = findGitRoot(resolvedRoot);
  const hooksDir = gitRoot ? resolveHooksDir(gitRoot) : null;
  const gitHookPath = hooksDir ? path.join(hooksDir, 'post-commit') : null;

  const settings = readSettings(settingsPath);
  const hooks = settings.hooks ?? {};

  const removed: string[] = [];
  for (const event of Object.keys(hooks)) {
    const groups = hooks[event];
    if (!Array.isArray(groups)) continue;
    for (const group of groups) {
      if (group && Array.isArray(group.hooks)) {
        const before = group.hooks.length;
        group.hooks = group.hooks.filter(h => !isTimelineEntry(h));
        if (group.hooks.length < before) {
          if (!removed.includes(event)) removed.push(event);
        }
      }
    }
    // Drop groups whose hooks array is now empty.
    hooks[event] = groups.filter(g => g && Array.isArray(g.hooks) && g.hooks.length > 0);
    if (hooks[event].length === 0) {
      delete hooks[event];
    }
  }

  if (Object.keys(hooks).length === 0) {
    delete settings.hooks;
  } else {
    settings.hooks = hooks;
  }
  if (fs.existsSync(settingsPath)) {
    writeSettings(settingsPath, settings);
  }

  // git 钩子:keepGitHook(只卸指定 agent)时保留;post-commit 连同旧版不带标记的调用行一起删
  let gitHookRemoved = false;
  let mergeHookRemoved = false;
  if (!opts.keepGitHook && gitRoot) {
    gitHookRemoved = removeHookSnippet(gitRoot, 'post-commit', GIT_HOOK_MARKER, {
      legacyMatch: GIT_COMMIT_SUBCOMMAND,
    }) !== null;
    mergeHookRemoved = removeHookSnippet(gitRoot, 'post-merge', GIT_HOOK_MARKER) !== null;
  }

  // 可选:删 timeline 数据(在副本里已在开头拒绝)
  let dataDropped = false;
  if (opts.purgeData) {
    try {
      const dbPath = getDatabasePath(resolvedRoot);
      if (fs.existsSync(dbPath)) {
        const conn = DatabaseConnection.open(dbPath);
        conn.getDb().exec('DROP TABLE IF EXISTS timeline_events');
        conn.getDb().exec('DROP TABLE IF EXISTS timeline_schema_versions');
        conn.close();
        dataDropped = true;
      }
    } catch (err) {
      process.stderr.write(
        `[timeline] --purge failed: ${err instanceof Error ? err.message : String(err)}\n`,
      );
    }
  }

  return {
    projectRoot: resolvedRoot,
    settingsPath,
    gitHookPath,
    removedHookEvents: removed,
    gitHookRemoved,
    mergeHookRemoved,
    dataDropped,
  };
}
