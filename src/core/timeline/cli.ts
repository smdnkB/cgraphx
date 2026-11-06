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
 * 隐藏 hook 入口只剩 git post-commit、post-merge 共用的 timeline-git-commit-hook;
 * 7 条 agent hook 子命令已随会话文件解析替代 hooks 撤掉(spec:2026-11-06-会话文件解析替代hooks
 * D17),空命令兼容在 cli/legacy-hook-commands.ts。
 *
 * Exit codes (spec §5.5):
 *   0  success (incl. "no matching events")
 *   2  config error (project not initialized)
 *   3  argument error
 *   4  DB error (schema / query failure)
 */

import type { Command } from 'commander';

import { queryEvents, getEventById, getEventStats } from './indexer';
import { ensureTimelineUpToDate, describeSyncOutcome } from './ingest/ingest';
import { installTimelineHooks, uninstallTimelineHooks, type InstallReport } from './installer';
import { locateData } from '../data-location';
import { resolveProjectRoot } from '../directory';
import { hookNotice } from '../git-hooks';
import { TimelineSchemaError, StoreQueryError } from './errors';
import { GIT_COMMIT_SUBCOMMAND } from './constants';
import { describeEvent, truncate } from './describe';
import type { EventType, TimelineEvent, TimelineStats } from './types';
import { gitCommitHook } from './git-commit';

// 摘要逻辑已移至 describe.ts(门面同源导出);此处保留再导出,兼容既有直接引用。
export { describeEvent } from './describe';

/**
 * `--type` 校验(原 payload.ts,随 hook 体系删除挪进本文件):pre_tool_use / session_end
 * 不再写新数据(spec C-10),类型仍认——旧数据照查,只是查不到新的。
 */
function assertEventType(s: string): EventType | null {
  const valid: EventType[] = [
    'user_prompt',
    'auto_message',
    'pre_tool_use',
    'post_tool_use',
    'stop',
    'git_commit',
    'session_start',
    'session_end',
  ];
  return (valid as string[]).includes(s) ? (s as EventType) : null;
}

/** `--type` 可接受的事件类型(帮助文本与报错共用)。 */
const EVENT_TYPES_HELP = 'user_prompt | auto_message | pre_tool_use | post_tool_use | stop | git_commit | session_start | session_end';

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

/**
 * 查询前自动补录(spec F1):四个查询命令在查询之前调,会话文件里新增的部分先解析进库。
 * 补录的任何失败只写 stderr——不碰查询的退出码与 stdout,`--json` 的结果不混提示
 * (ensureTimelineUpToDate 自己不抛,这里再兜一层)。
 */
async function backfillBeforeQuery(): Promise<void> {
  try {
    const outcome = await ensureTimelineUpToDate(process.cwd());
    for (const line of describeSyncOutcome(outcome)) process.stderr.write(`[timeline] ${line}\n`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    process.stderr.write(`[timeline] 时间线补录失败:${msg},结果可能缺最近的\n`);
  }
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
      await backfillBeforeQuery();
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
      await backfillBeforeQuery();
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
      await backfillBeforeQuery();
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
      await backfillBeforeQuery();
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
    .description('装 git 提交记录片段(post-commit / post-merge);会话事件改由会话文件解析补录,不再接 agent hook')
    .option('--purge-first', '先删已有片段再装(clean slate)')
    // 保留选项,旧脚本带着它不报错(片段与 agent 无关,装一次)
    .option('-t, --target <ids>', '兼容保留:片段与 agent 无关,参数被忽略')
    .action(async (opts: { purgeFirst?: boolean; target?: string }) => {
      void opts.target;
      // 项目根向上回溯(spec 2026-08-13):从子目录运行也能找到根库。
      const projectRoot = resolveProjectRoot(process.cwd());
      try {
        const report = installTimelineHooks(projectRoot, { purgeFirst: opts.purgeFirst === true });
        writeReports([report]);
        writeGitHookNotices([report]);
      } catch (err) {
        renderError(err);
        process.exitCode = exitCodeForError(err);
      }
    });

  timeline
    .command('uninstall')
    .description('卸掉 git 提交记录片段(post-commit / post-merge)')
    // 保留选项,旧脚本带着它不报错(spec D31)
    .option('--purge', '已不再删数据;项目的数据用 cgraphx project remove 删')
    .option('-t, --target <ids>', '兼容保留:给了 -t 视为部分卸载,不动 git 片段;不给才删片段')
    .action(async (opts: { purge?: boolean; target?: string }) => {
      // 项目根向上回溯(spec 2026-08-13):从子目录运行也能找到根库。
      const projectRoot = resolveProjectRoot(process.cwd());
      try {
        // 给了 -t 视为部分卸载,不动 git 片段(spec §5)
        const report = uninstallTimelineHooks(projectRoot, { keepGitHook: opts.target !== undefined });
        // stdout 照旧只有 JSON 报告,提示一律打在 stderr
        writeReports([report]);
        for (const line of report.gitHookNotices) process.stderr.write(`[timeline] ${line}\n`);
        if (report.gitHookKeptFor.length > 0) {
          process.stderr.write(`[timeline] ${report.gitHookKeptFor.join('、')} 还装着 cgraphx,git 钩子留着\n`);
        }
        if (opts.purge === true) process.stderr.write(`[timeline] ${purgeNotice(projectRoot)}\n`);
      } catch (err) {
        renderError(err);
        process.exitCode = exitCodeForError(err);
      }
    });

  // ─── 隐藏 hook 入口 ────────────────────────────────────────────────────
  // git post-commit、post-merge 片段后台调起;await 到写库完成再退出,退出码恒为 0。

  program
    .command(GIT_COMMIT_SUBCOMMAND, { hidden: true })
    .action(async () => { await gitCommitHook(); });
}

/**
 * `--purge` 不再删数据(spec D31,M14):告诉人项目的数据在哪、用什么删。目录名取这个目录数据位置的项目目录名;
 * 项目目录还不在(含没并过的旧库)时不写路径。
 */
function purgeNotice(projectRoot: string): string {
  let dirName: string | null = null;
  try {
    dirName = locateData(projectRoot).projectDirName;
  } catch {
    // 认不出数据位置只影响提示里写不写路径
  }
  return dirName !== null
    ? `项目的数据在 ~/.cgraphx/projects/${dirName}/,要删用 cgraphx project remove`
    : '项目的数据要删用 cgraphx project remove';
}

/** 单个 agent 输出单个报告对象(与改造前一致);多个输出报告数组。 */
function writeReports(reports: readonly unknown[]): void {
  const out = reports.length === 1 ? reports[0] : reports;
  process.stdout.write(JSON.stringify(out, null, 2) + '\n');
}

/**
 * git 钩子的安装提示往 stderr 打:没写入的说原因,链接、被跟踪的还给要加的几行(hookNotice)。
 * 多个 agent 的报告里是同一批钩子,同一句话只打一次。
 */
function writeGitHookNotices(reports: readonly InstallReport[]): void {
  const printed = new Set<string>();
  const notice = (line: string): void => {
    if (printed.has(line)) return;
    printed.add(line);
    process.stderr.write(`[timeline] ${line}\n`);
  };
  for (const report of reports) {
    for (const hook of report.gitHooks) {
      const text = hookNotice(hook);
      if (text !== null) notice(text);
    }
  }
}

function parseType(s: string | undefined): EventType | undefined {
  if (!s) return undefined;
  const t = assertEventType(s);
  if (!t) throw new ArgError(`Invalid --type: ${s}. Must be one of ${EVENT_TYPES_HELP.split(' | ').join(', ')}`);
  return t;
}
