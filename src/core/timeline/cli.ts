/**
 * CLI wiring for the Developer Timeline subsystem.
 *
 * Public subcommands (spec §5.1):
 *   - cgraphx timeline query
 *   - cgraphx timeline show <id>
 *   - cgraphx timeline stats
 *   - cgraphx timeline recent
 *   - cgraphx timeline install
 *   - cgraphx timeline uninstall
 *
 * 隐藏 hook 入口(spec §3.3):Claude Code hook 子命令按 HOOK_EVENTS_TO_COMMANDS
 * 逐项注册(user-prompt / pre-tool-use / post-tool-use / stop / session-start /
 * session-end),另加 git post-commit 用的 timeline-git-commit-hook。
 *
 * Exit codes (spec §5.5):
 *   0  success (incl. "no matching events")
 *   2  config error (project not initialized)
 *   3  argument error
 *   4  DB error (schema / query failure)
 */

import path from 'node:path';

import type { Command } from 'commander';

import { queryEvents, getEventById, getEventStats } from './indexer';
import { installTimelineHooks, uninstallTimelineHooks } from './installer';
import { resolveProjectRoot } from '../directory';
import { TimelineSchemaError, StoreQueryError } from './errors';
import { assertEventType } from './payload';
import { HOOK_EVENTS_TO_COMMANDS, GIT_COMMIT_SUBCOMMAND, type HookEventName } from './constants';
import { describeEvent, truncate } from './describe';
import type { EventType, TimelineEvent, TimelineStats } from './types';
import {
  getAgentProfile,
  isAgentInstalled,
  listAgentProfiles,
  resolveHookAgent,
  type AgentId,
  type AgentProfile,
} from '../agents';
import {
  userPromptHook,
  preToolUseHook,
  postToolUseHook,
  stopHook,
  sessionStartHook,
  sessionEndHook,
  gitCommitHook,
} from './hooks';

// 摘要逻辑已移至 describe.ts(门面同源导出);此处保留再导出,兼容既有直接引用。
export { describeEvent } from './describe';

/**
 * Claude Code hook 事件名 → 处理函数;子命令名只从 HOOK_EVENTS_TO_COMMANDS 取。
 * 键类型由 HOOK_EVENTS_TO_COMMANDS 推出,新增事件漏配处理函数时编译期报错。
 */
const HOOK_HANDLERS: Record<HookEventName, (agent: AgentId) => Promise<void>> = {
  UserPromptSubmit: userPromptHook,
  PreToolUse: preToolUseHook,
  PostToolUse: postToolUseHook,
  Stop: stopHook,
  SessionStart: sessionStartHook,
  SessionEnd: sessionEndHook,
};

/** `--type` 可接受的事件类型(帮助文本与报错共用)。 */
const EVENT_TYPES_HELP = 'user_prompt | pre_tool_use | post_tool_use | stop | git_commit | session_start | session_end';

class ArgError extends Error {}

/**
 * Format an ISO 8601 (UTC) timestamp as a local 'YYYY-MM-DD HH:MM:SS' string
 * for human-readable table output. The DB stores UTC; tables show local time
 * so users read their own wall-clock time, not UTC. Returns null for empty /
 * unparseable input so callers can render a '-' placeholder.
 *
 * JSON output paths do NOT use this — they preserve the raw UTC ISO string
 * as a machine-readable contract for downstream consumers.
 */
function formatLocalTs(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} `
    + `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

export function renderEventsTable(events: TimelineEvent[]): string {
  if (events.length === 0) return '(no events)';
  const rows = events.map(e => {
    const summary = describeEvent(e);
    const turn = e.turn_id ? e.turn_id.slice(0, 8) : '-';
    return [
      String(e.id),
      formatLocalTs(e.ts) ?? '-',
      e.event_type,
      e.tool_name ?? '',
      turn,
      summary,
    ];
  });
  const header = ['id', 'ts(local)', 'event_type', 'tool_name', 'turn', 'summary'];
  const all = [header, ...rows];
  const widths = header.map((_, i) => Math.max(...all.map(r => String(r[i] ?? '').length)));
  return all.map(r => r.map((c, i) => String(c).padEnd(widths[i]!)).join('  ')).join('\n');
}

function renderStats(s: TimelineStats): string {
  return JSON.stringify(s, null, 2);
}

/**
 * Human-readable stats summary (B-7).
 *
 * Lays out the high-signal fields a developer scans at a glance:
 *   - totalEvents / window
 *   - per-event-type counts
 *   - top tools
 *   - top files read / written (timeline-data-quality)
 *   - commit insertions / deletions aggregated over the window's git_commit events
 *
 * The Commit Lines section sums commit_insertions / commit_deletions across
 * all git_commit events in the window — passed in by the caller (cli.ts
 * stats action) which fetches those events via queryEvents(type:'git_commit').
 * Storing the sum in TimelineStats would require touching store.ts (out of
 * B-7 scope); computing it here keeps the stats renderer self-contained.
 */
export function renderStatsTable(
  s: TimelineStats,
  commitLines: { insertions: number; deletions: number } = { insertions: 0, deletions: 0 },
): string {
  const lines: string[] = [];
  lines.push(`Total Events:           ${s.totalEvents}`);
  lines.push(`Window (local):         ${formatLocalTs(s.windowStart) ?? '-'} → ${formatLocalTs(s.windowEnd) ?? '-'}`);
  lines.push('');
  lines.push('By Event Type:');
  for (const [t, n] of Object.entries(s.byType)) {
    lines.push(`  ${t.padEnd(22)} ${n}`);
  }
  lines.push('');
  if (s.byTool.length > 0) {
    lines.push('Top Tools:');
    for (const { tool, count } of s.byTool.slice(0, 10)) {
      lines.push(`  ${tool.padEnd(22)} ${count}`);
    }
    lines.push('');
  }
  if (s.topFilesRead.length > 0) {
    lines.push('Top Files Read:');
    for (const { file, count } of s.topFilesRead.slice(0, 10)) {
      lines.push(`  ${truncate(file, 60).padEnd(62)} ${count}`);
    }
    lines.push('');
  }
  if (s.topFilesWritten.length > 0) {
    lines.push('Top Files Written:');
    for (const { file, count } of s.topFilesWritten.slice(0, 10)) {
      lines.push(`  ${truncate(file, 60).padEnd(62)} ${count}`);
    }
    lines.push('');
  }
  lines.push(`Commit Lines (INS/DEL): ${commitLines.insertions} / ${commitLines.deletions}`);
  return lines.join('\n');
}

function exitCodeForError(err: unknown): number {
  if (err instanceof ArgError) return 3;
  if (err instanceof TimelineSchemaError) return 2;
  if (err instanceof StoreQueryError) return 4;
  return 1;
}

function renderError(err: unknown): void {
  if (err instanceof TimelineSchemaError || err instanceof StoreQueryError) {
    process.stderr.write(`[timeline] ${err.message}\n`);
  } else if (err instanceof ArgError) {
    process.stderr.write(`[timeline] ${err.message}\n`);
  } else {
    const msg = err instanceof Error ? err.message : String(err);
    process.stderr.write(`[timeline] unexpected error: ${msg}\n`);
  }
}

export function registerTimelineCommands(program: Command): void {
  const timeline = program
    .command('timeline')
    .description('Developer Timeline — record and query Claude Code development events');

  timeline
    .command('query')
    .description('Query timeline events by time window, type, tool, file, or session')
    .option('--since <date>', 'Start time (ISO 8601 or relative like 7d/12h/30m/now)')
    .option('--until <date>', 'End time (ISO 8601 or relative)')
    .option('--type <type>', `Event type: ${EVENT_TYPES_HELP}`)
    .option('--tool <name>', 'Exact tool_name (Edit/Bash/Read/...)')
    .option('--file <path>', 'Substring match on tool_args.file_path or commit_files')
    .option('--session <id>', 'Exact session_id')
    .option('--turn <id>', 'Exact turn_id (UUID) match')
    .option('--limit <n>', 'Max results (1-10000; default 100)', v => parseInt(v, 10))
    .option('--format <format>', 'json (default) | table', 'json')
    .action(async (opts: {
      since?: string;
      until?: string;
      type?: string;
      tool?: string;
      file?: string;
      session?: string;
      turn?: string;
      limit?: number;
      format?: string;
    }) => {
      // 项目根向上回溯(spec 2026-08-13):从子目录运行也能找到根库。
      const projectRoot = resolveProjectRoot(process.cwd());
      try {
        const format = opts.format === 'table' ? 'table' : 'json';
        const filter = {
          since: opts.since,
          until: opts.until,
          type: parseType(opts.type),
          tool: opts.tool,
          file: opts.file,
          session: opts.session,
          turn: opts.turn,
          limit: opts.limit,
        };
        const events = await queryEvents(projectRoot, filter);
        if (format === 'table') {
          process.stdout.write(renderEventsTable(events) + '\n');
        } else {
          process.stdout.write(JSON.stringify(events, null, 2) + '\n');
        }
      } catch (err) {
        renderError(err);
        process.exitCode = exitCodeForError(err);
      }
    });

  timeline
    .command('show <id>')
    .description('Show full detail for one event by id')
    .action(async (idArg: string) => {
      // 项目根向上回溯(spec 2026-08-13):从子目录运行也能找到根库。
      const projectRoot = resolveProjectRoot(process.cwd());
      try {
        const id = parseInt(idArg, 10);
        if (!Number.isFinite(id) || id <= 0) throw new ArgError(`Invalid id: ${idArg}`);
        const event = await getEventById(projectRoot, id);
        if (!event) {
          process.stderr.write(`[timeline] event ${id} not found\n`);
          process.exitCode = 0;
          return;
        }
        process.stdout.write(JSON.stringify(event, null, 2) + '\n');
      } catch (err) {
        renderError(err);
        process.exitCode = exitCodeForError(err);
      }
    });

  timeline
    .command('stats')
    .description('Aggregate stats over a time window')
    .option('--since <date>', 'Start time (default: 30d)')
    .option('--until <date>', 'End time')
    .option('--by <field>', 'Group by: day | event_type | tool_name (default: all)')
    .option('--format <format>', 'json (default) | table', 'json')
    .action(async (opts: { since?: string; until?: string; by?: string; format?: string }) => {
      // 项目根向上回溯(spec 2026-08-13):从子目录运行也能找到根库。
      const projectRoot = resolveProjectRoot(process.cwd());
      try {
        const format = opts.format === 'table' ? 'table' : 'json';
        const filter = {
          since: opts.since ?? '30d',
          until: opts.until,
        };
        const stats = await getEventStats(projectRoot, filter);
        if (format === 'table') {
          // Aggregate commit_insertions / commit_deletions across all
          // git_commit events in the same window. Stored separately from
          // TimelineStats (which would need store.ts changes — out of B-7
          // scope), so the table renderer is fed the totals alongside stats.
          const commitEvents = await queryEvents(projectRoot, {
            ...filter,
            type: 'git_commit',
            limit: 10000,
          });
          let insertions = 0;
          let deletions = 0;
          for (const e of commitEvents) {
            insertions += e.commit_insertions ?? 0;
            deletions += e.commit_deletions ?? 0;
          }
          process.stdout.write(renderStatsTable(stats, { insertions, deletions }) + '\n');
        } else {
          process.stdout.write(renderStats(stats) + '\n');
        }
      } catch (err) {
        renderError(err);
        process.exitCode = exitCodeForError(err);
      }
    });

  timeline
    .command('recent')
    .description('Most recent N events (quick shortcut)')
    .option('--limit <n>', 'Default 20', v => parseInt(v, 10))
    .option('--format <format>', 'json (default) | table', 'json')
    .action(async (opts: { limit?: number; format?: string }) => {
      // 项目根向上回溯(spec 2026-08-13):从子目录运行也能找到根库。
      const projectRoot = resolveProjectRoot(process.cwd());
      try {
        const format = opts.format === 'table' ? 'table' : 'json';
        const events = await queryEvents(projectRoot, { limit: opts.limit ?? 20 });
        if (format === 'table') {
          process.stdout.write(renderEventsTable(events) + '\n');
        } else {
          process.stdout.write(JSON.stringify(events, null, 2) + '\n');
        }
      } catch (err) {
        renderError(err);
        process.exitCode = exitCodeForError(err);
      }
    });

  timeline
    .command('install')
    .description('Install timeline hooks into this project\'s .claude/settings.json and .git/hooks/')
    .option('--purge-first', 'Remove existing timeline hooks before installing (clean slate)')
    .option('-t, --target <ids>', 'Comma-separated agent ids (default: installed agents, else claude-code)')
    .action(async (opts: { purgeFirst?: boolean; target?: string }) => {
      // 项目根向上回溯(spec 2026-08-13):从子目录运行也能找到根库。
      const projectRoot = resolveProjectRoot(process.cwd());
      try {
        const profiles = selectAgents(projectRoot, opts.target);
        const reports = profiles.map((p) =>
          installTimelineHooks(projectRoot, { purgeFirst: opts.purgeFirst === true, agent: p.id }),
        );
        writeReports(reports);
      } catch (err) {
        renderError(err);
        process.exitCode = exitCodeForError(err);
      }
    });

  timeline
    .command('uninstall')
    .description('Remove timeline hooks from this project')
    .option('--purge', 'Also DROP all timeline_* tables (data loss)')
    .option('-t, --target <ids>', 'Comma-separated agent ids (default: installed agents, else claude-code)')
    .action(async (opts: { purge?: boolean; target?: string }) => {
      // 项目根向上回溯(spec 2026-08-13):从子目录运行也能找到根库。
      const projectRoot = resolveProjectRoot(process.cwd());
      try {
        const profiles = selectAgents(projectRoot, opts.target);
        // 给了 -t 只卸指定 agent 的配置,不动 git post-commit 钩子(spec §5)
        const keepGitHook = opts.target !== undefined;
        const reports = profiles.map((p) =>
          uninstallTimelineHooks(projectRoot, { purgeData: opts.purge === true, agent: p.id, keepGitHook }),
        );
        writeReports(reports);
      } catch (err) {
        renderError(err);
        process.exitCode = exitCodeForError(err);
      }
    });

  // ─── 隐藏 hook 入口(spec §3) ─────────────────────────────────────────
  // 全部 await 到写库完成再退出,退出码恒为 0。

  for (const { event, subcommand } of HOOK_EVENTS_TO_COMMANDS) {
    const handler = HOOK_HANDLERS[event];
    program
      .command(subcommand, { hidden: true })
      .option('--agent <id>', 'Source agent id (unknown → claude-code)')
      // --agent 缺省或无法识别时按 claude-code 处理,不报错(spec §12)
      .action(async (opts: { agent?: string }) => { await handler(resolveHookAgent(opts.agent).id); });
  }

  program
    .command(GIT_COMMIT_SUBCOMMAND, { hidden: true })
    .action(async () => { await gitCommitHook(); });
}

/** 可用 agent id 列表(含 legacy 别名),用于 -t 报错提示。 */
function availableAgentIdsHelp(): string {
  return listAgentProfiles()
    .map((p) => (p.legacyIds.length > 0 ? `${p.id} (${p.legacyIds.join(', ')})` : p.id))
    .join(', ');
}

/**
 * 选出 timeline install/uninstall 作用的 agent(spec §4.3):
 * 给了 -t 用列出的 agent(未知 id 报参数错误);没给则取已装的 agent,一个都没装时只取 claude-code。
 */
function selectAgents(projectRoot: string, target: string | undefined): AgentProfile[] {
  if (target !== undefined) {
    const ids = target.split(',').map((s) => s.trim()).filter(Boolean);
    if (ids.length === 0) throw new ArgError(`Invalid --target: empty. Available: ${availableAgentIdsHelp()}`);
    const selected: AgentProfile[] = [];
    for (const id of ids) {
      const profile = getAgentProfile(id);
      if (!profile) throw new ArgError(`Unknown agent: ${id}. Available: ${availableAgentIdsHelp()}`);
      if (!selected.includes(profile)) selected.push(profile);
    }
    return selected;
  }
  const installed = listAgentProfiles().filter((p) => isAgentInstalled(projectRoot, p));
  if (installed.length > 0) return installed;
  const fallback = getAgentProfile('claude-code');
  return fallback ? [fallback] : [];
}

/** 单个 agent 输出单个报告对象(与改造前一致);多个输出报告数组。 */
function writeReports(reports: readonly unknown[]): void {
  const out = reports.length === 1 ? reports[0] : reports;
  process.stdout.write(JSON.stringify(out, null, 2) + '\n');
}

function parseType(s: string | undefined): EventType | undefined {
  if (!s) return undefined;
  const t = assertEventType(s);
  if (!t) throw new ArgError(`Invalid --type: ${s}. Must be one of ${EVENT_TYPES_HELP.split(' | ').join(', ')}`);
  return t;
}

// `path" is used by installer.ts (project-local paths); kept imported here so
// the module compiles cleanly without an unused-imports linter firing.
void path;
