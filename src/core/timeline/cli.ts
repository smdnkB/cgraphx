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
 * Hidden hook entry points (spec §3.3):
 *   - cgraphx timeline-user-prompt-hook
 *   - cgraphx timeline-pre-tool-use-hook
 *   - cgraphx timeline-post-tool-use-hook
 *   - cgraphx timeline-stop-hook
 *   - cgraphx timeline-git-commit-hook
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
import { TimelineSchemaError, StoreQueryError } from './errors';
import { assertEventType } from './payload';
import type { EventType, TimelineEvent, TimelineStats } from './types';
import {
  userPromptHook,
  preToolUseHook,
  postToolUseHook,
  stopHook,
  gitCommitHook,
} from './hooks';

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

export function describeEvent(e: TimelineEvent): string {
  switch (e.event_type) {
    case 'user_prompt':
      return truncate(e.prompt_text ?? '', 120);
    case 'pre_tool_use':
    case 'post_tool_use':
      return describeToolArgs(e.tool_name, e.tool_args);
    case 'git_commit': {
      const parts: string[] = [];
      if (e.commit_hash) parts.push(e.commit_hash.slice(0, 7));
      if (e.commit_message) parts.push(truncate(e.commit_message, 100));
      if (e.commit_files.length > 0) parts.push(`(${e.commit_files.length} files)`);
      return parts.join(' ');
    }
    case 'stop':
      return e.duration_ms !== null ? `session ended (${e.duration_ms}ms)` : 'session ended';
  }
}

function describeToolArgs(toolName: string | null, args: unknown): string {
  if (!toolName || !args || typeof args !== 'object') return '';
  const r = args as Record<string, unknown>;
  if (typeof r.file_path === 'string') return r.file_path;
  if (typeof r.path === 'string') return r.path;
  if (typeof r.command === 'string') return truncate(r.command, 120);
  if (typeof r.url === 'string') return r.url;
  if (typeof r.query === 'string') return truncate(r.query, 120);
  return '';
}

function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return s.slice(0, max - 1) + '…';
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
    .option('--type <type>', 'Event type: user_prompt | pre_tool_use | post_tool_use | stop | git_commit')
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
      const projectRoot = process.cwd();
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
      const projectRoot = process.cwd();
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
      const projectRoot = process.cwd();
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
      const projectRoot = process.cwd();
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
    .action(async (opts: { purgeFirst?: boolean }) => {
      const projectRoot = process.cwd();
      try {
        const report = installTimelineHooks(projectRoot, { purgeFirst: opts.purgeFirst === true });
        process.stdout.write(JSON.stringify(report, null, 2) + '\n');
      } catch (err) {
        renderError(err);
        process.exitCode = exitCodeForError(err);
      }
    });

  timeline
    .command('uninstall')
    .description('Remove timeline hooks from this project')
    .option('--purge', 'Also DROP all timeline_* tables (data loss)')
    .action(async (opts: { purge?: boolean }) => {
      const projectRoot = process.cwd();
      try {
        const report = uninstallTimelineHooks(projectRoot, { purgeData: opts.purge === true });
        process.stdout.write(JSON.stringify(report, null, 2) + '\n');
      } catch (err) {
        renderError(err);
        process.exitCode = exitCodeForError(err);
      }
    });

  // ─── Hidden hook entry points (spec §3) ────────────────────────────────
  // All async — fire-and-forget on hook trigger; exit 0 when the work is done.

  program
    .command('timeline-user-prompt-hook', { hidden: true })
    .action(async () => { await userPromptHook(); });

  program
    .command('timeline-pre-tool-use-hook', { hidden: true })
    .action(async () => { await preToolUseHook(); });

  program
    .command('timeline-post-tool-use-hook', { hidden: true })
    .action(async () => { await postToolUseHook(); });

  program
    .command('timeline-stop-hook', { hidden: true })
    .action(async () => { await stopHook(); });

  program
    .command('timeline-git-commit-hook', { hidden: true })
    .action(async () => { await gitCommitHook(); });
}

function parseType(s: string | undefined): EventType | undefined {
  if (!s) return undefined;
  const t = assertEventType(s);
  if (!t) throw new ArgError(`Invalid --type: ${s}. Must be one of user_prompt, pre_tool_use, post_tool_use, stop, git_commit`);
  return t;
}

// `path" is used by installer.ts (project-local paths); kept imported here so
// the module compiles cleanly without an unused-imports linter firing.
void path;
