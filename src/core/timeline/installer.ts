/**
 * Project-local hook installer for the timeline subsystem.
 *
 * Spec §0.2 #4 + §7.3 — writes ONLY to the project's own `.claude/settings.json`
 * and `.git/hooks/post-commit`. NEVER touches the user's global `~/.claude/`.
 *
 * Idempotent: running twice leaves the same single hook entry per event.
 * Reversible: `uninstall` removes exactly what `install` wrote, leaving any
 * unrelated user hooks intact.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';

import { execSync } from 'node:child_process';

import { DatabaseConnection } from '../db';
import { COMMIT_BRANCH_ENV, COMMIT_SHA_ENV, GIT_COMMIT_SUBCOMMAND, HOOK_EVENTS_TO_COMMANDS } from './constants';
import { cleanDebrisCgraphxDirs } from './debris';
import { LEGACY_TURN_STATE_FILENAME } from './turn-state';

export interface InstallReport {
  projectRoot: string;
  settingsPath: string;
  gitHookPath: string | null;
  writtenHookEvents: string[];
  gitHookWritten: boolean;
  skipped: string[];
  /** 本次安装顺手清理掉的碎片 `.cgraphx/` 目录(仅含 turn 文件的空壳)。 */
  debrisRemoved: string[];
}

export interface UninstallReport {
  projectRoot: string;
  settingsPath: string;
  gitHookPath: string | null;
  removedHookEvents: string[];
  gitHookRemoved: boolean;
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

const GIT_HOOK_MARKER = '# cgraphx-timeline-hook';

/**
 * post-commit 片段:先在前台取得本次提交的 hash 与分支,再把记录进程放到后台。
 * 每行都带 GIT_HOOK_MARKER,升级与卸载按行精确删除,不碰用户自己的钩子内容。
 */
function buildGitPostCommitSnippet(): string {
  return [
    `${GIT_HOOK_MARKER} — record commit events to .cgraphx/cgraphx.db`,
    `__cgx_sha=$(git rev-parse HEAD 2>/dev/null); __cgx_branch=$(git symbolic-ref --short -q HEAD 2>/dev/null) ${GIT_HOOK_MARKER}`,
    `${COMMIT_SHA_ENV}="$__cgx_sha" ${COMMIT_BRANCH_ENV}="$__cgx_branch" cgraphx ${GIT_COMMIT_SUBCOMMAND} >/dev/null 2>&1 & ${GIT_HOOK_MARKER}`,
  ].join('\n');
}

/** 删去 cgraphx 写入的行(带标记的行,以及旧版不带标记的调用行),规整空行。 */
function stripTimelineGitHook(content: string): string {
  return content
    .split('\n')
    .filter(l => !l.includes(GIT_HOOK_MARKER) && !l.includes(GIT_COMMIT_SUBCOMMAND))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/^\n+/, '')
    .replace(/\n+$/, '');
}

function readGitHook(gitHookPath: string): string {
  if (!fs.existsSync(gitHookPath)) return '';
  try {
    return fs.readFileSync(gitHookPath, 'utf8');
  } catch {
    return '';
  }
}

function writeGitHook(gitHookPath: string, content: string, executable: boolean): void {
  fs.mkdirSync(path.dirname(gitHookPath), { recursive: true });
  fs.writeFileSync(gitHookPath, content, { mode: executable ? 0o755 : 0o644 });
  if (executable) {
    try { fs.chmodSync(gitHookPath, 0o755); } catch { /* non-POSIX */ }
  }
}

export function installTimelineHooks(
  projectRoot: string,
  opts: { purgeFirst?: boolean } = {},
): InstallReport {
  const resolvedRoot = path.resolve(projectRoot);
  const settingsPath = path.join(resolvedRoot, '.claude', 'settings.json');
  const gitRoot = findGitRoot(resolvedRoot);
  const gitHookPath = gitRoot ? path.join(gitRoot, '.git', 'hooks', 'post-commit') : null;

  if (opts.purgeFirst) {
    uninstallTimelineHooks(resolvedRoot, { purgeData: false });
  }

  const settings = readSettings(settingsPath);
  const hooks: HooksConfig = (settings.hooks && typeof settings.hooks === 'object')
    ? settings.hooks
    : {};

  const written: string[] = [];
  const skipped: string[] = [];

  for (const { event, subcommand } of HOOK_EVENTS_TO_COMMANDS) {
    const command = `cgraphx ${subcommand}`;
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

  // Git post-commit hook
  let gitHookWritten = false;
  if (gitHookPath) {
    const existing = readGitHook(gitHookPath);
    const snippet = buildGitPostCommitSnippet();
    // 已有旧版片段 → 原地替换为当前版本(升级);内容未变则不写(幂等)。
    const base = existing.includes(GIT_HOOK_MARKER) ? stripTimelineGitHook(existing) : existing.replace(/\n+$/, '');
    const newContent = base.length > 0 && base !== '#!/bin/sh'
      ? `${base}\n\n${snippet}\n`
      : `#!/bin/sh\n${snippet}\n`;
    if (newContent !== existing) {
      writeGitHook(gitHookPath, newContent, true);
      gitHookWritten = true;
    }
  }

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
    gitHookPath,
    writtenHookEvents: written,
    gitHookWritten,
    skipped,
    debrisRemoved,
  };
}

export function uninstallTimelineHooks(
  projectRoot: string,
  opts: { purgeData?: boolean } = {},
): UninstallReport {
  const resolvedRoot = path.resolve(projectRoot);
  const settingsPath = path.join(resolvedRoot, '.claude', 'settings.json');
  const gitRoot = findGitRoot(resolvedRoot);
  const gitHookPath = gitRoot ? path.join(gitRoot, '.git', 'hooks', 'post-commit') : null;

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

  // Git hook
  let gitHookRemoved = false;
  if (gitHookPath && fs.existsSync(gitHookPath)) {
    const content = readGitHook(gitHookPath);
    if (content.includes(GIT_HOOK_MARKER)) {
      const filtered = stripTimelineGitHook(content);
      if (filtered.length === 0 || filtered === '#!/bin/sh') {
        fs.rmSync(gitHookPath, { force: true });
      } else {
        writeGitHook(gitHookPath, filtered + '\n', true);
      }
      gitHookRemoved = true;
    }
  }

  // Optional: drop timeline data
  let dataDropped = false;
  if (opts.purgeData) {
    try {
      const dbPath = path.join(resolvedRoot, '.cgraphx', 'cgraphx.db');
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
    dataDropped,
  };
}
