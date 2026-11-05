/**
 * timeline 统计(spec §5;spec:2026-11-05-数据按项目放用户目录 D12)
 *
 * 时间窗内的事件总数、按类型、按工具、按天,以及读、写文件排行。文件排行在计数前把路径换算成项目内路径:根列表取
 * 同一个库 timeline_roots 的全部根,用 createRootMatcher 取最长的根——工具参数里的绝对路径落在根下的,取根下的
 * 相对路径;提交的每个文件(仓库相对路径)先拼上提交的 cwd 再匹配,中了取相对路径;都不中照原样计(项目外的
 * 路径、相对路径不动)。同一项目几个 clone、worktree 里动的同一个文件因此计成一个。
 *
 * 只读:不应用 schema、不写表;timeline_events 不在按零统计,timeline_roots 不在按没有根(路径不换算)。
 * `TimelineStore.stats` 是调用这里的薄方法。commit_files 列的解析也放在这里,store 读行时共用,免得两边互相 import。
 */

import * as path from 'node:path';

import type { SqliteDatabase } from '../db';
import { createRootMatcher } from '../root-match';
import { READ_FILE_TOOLS, WRITE_FILE_TOOLS } from './constants';
import { StoreQueryError } from './errors';
import { EVENTS_TABLE, hasTable, readRootRows } from './roots';
import type { EventType, TimelineStats } from './types';

/** 统计的时间窗:已解析成 ISO UTC,null 为不限。 */
export interface StatsWindow {
  since: string | null;
  until: string | null;
}

export function tryParseJson<T>(s: string): T | null {
  try { return JSON.parse(s) as T; } catch { return null; }
}

/**
 * commit_files 列:一般是路径数组;超过 COMMIT_FILES_MAX 截断时存成 `{ files, _truncated_count }`
 * (见 TimelineStore.insert),读的一方都按数组用,这里统一成数组。
 */
export function parseCommitFiles(raw: string | null): string[] {
  if (!raw) return [];
  const parsed = tryParseJson<unknown>(raw);
  const list = Array.isArray(parsed)
    ? parsed
    : parsed !== null && typeof parsed === 'object' && Array.isArray((parsed as { files?: unknown }).files)
      ? (parsed as { files: unknown[] }).files
      : [];
  return list.filter((f): f is string => typeof f === 'string');
}

function zeroByType(): Record<EventType, number> {
  return {
    user_prompt: 0,
    auto_message: 0,
    pre_tool_use: 0,
    post_tool_use: 0,
    stop: 0,
    git_commit: 0,
    session_start: 0,
    session_end: 0,
  };
}

function emptyStats(window: StatsWindow): TimelineStats {
  return {
    totalEvents: 0,
    byType: zeroByType(),
    byTool: [],
    byDay: [],
    topFilesRead: [],
    topFilesWritten: [],
    windowStart: window.since,
    windowEnd: window.until,
  };
}

/** 文件路径换成项目内路径的两种写法(工具参数里的、提交里的);库里没有记下的根时原样返回。 */
interface ProjectPathMapper {
  toolPath(file: string): string;
  commitPath(cwd: string, file: string): string;
}

function projectPathMapper(db: SqliteDatabase): ProjectPathMapper {
  const roots = readRootRows(db).map((r) => r.root);
  if (roots.length === 0) return { toolPath: (file) => file, commitPath: (_cwd, file) => file };
  const matcher = createRootMatcher(roots);
  return {
    toolPath: (file) => (path.isAbsolute(file) ? (matcher.match(file)?.rel ?? file) : file),
    commitPath: (cwd, file) => (path.isAbsolute(cwd) ? (matcher.match(path.join(cwd, file))?.rel ?? file) : file),
  };
}

interface FileRow {
  event_type: string;
  tool_name: string | null;
  tool_args: string | null;
  commit_files: string | null;
  cwd: string;
}

function countFile(counts: Map<string, number>, file: string): void {
  counts.set(file, (counts.get(file) ?? 0) + 1);
}

function topFiles(counts: Map<string, number>): Array<{ file: string; count: number }> {
  return Array.from(counts.entries())
    .map(([file, count]) => ({ file, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 20);
}

/** 时间窗内的统计;timeline_events 不在 → 零统计(时间窗照填)。 */
export function computeTimelineStats(db: SqliteDatabase, window: StatsWindow): TimelineStats {
  const { since, until } = window;

  const baseClauses: string[] = [];
  const baseParams: Array<string | number> = [];
  if (since) { baseClauses.push('ts >= ?'); baseParams.push(since); }
  if (until) { baseClauses.push('ts <= ?'); baseParams.push(until); }
  const where = baseClauses.length ? `WHERE ${baseClauses.join(' AND ')}` : '';

  try {
    if (!hasTable(db, EVENTS_TABLE)) return emptyStats(window);

    const totalRow = db
      .prepare(`SELECT COUNT(*) AS c FROM timeline_events ${where}`)
      .get(...baseParams) as { c: number } | undefined;
    const totalEvents = totalRow?.c ?? 0;

    const byTypeRows = db
      .prepare(
        `SELECT event_type, COUNT(*) AS c FROM timeline_events ${where} GROUP BY event_type`,
      )
      .all(...baseParams) as Array<{ event_type: string; c: number }>;
    const byType = zeroByType();
    for (const r of byTypeRows) {
      byType[r.event_type as EventType] = r.c;
    }

    const byToolRows = db
      .prepare(
        `SELECT tool_name, COUNT(*) AS c FROM timeline_events
         ${where} ${where ? 'AND' : 'WHERE'} tool_name IS NOT NULL
         GROUP BY tool_name ORDER BY c DESC LIMIT 20`,
      )
      .all(...baseParams) as Array<{ tool_name: string; c: number }>;

    const byDayRows = db
      .prepare(
        // Group by *local* day. ts is stored as UTC ISO TEXT; datetime(ts,
        // 'localtime') shifts it to the process timezone before substr takes
        // the YYYY-MM-DD prefix. Without this, work in local hours 00:00–08:00
        // (UTC+N) gets bucketed into the previous UTC day.
        `SELECT substr(datetime(ts, 'localtime'), 1, 10) AS day, COUNT(*) AS c
         FROM timeline_events ${where} GROUP BY day ORDER BY day DESC LIMIT 366`,
      )
      .all(...baseParams) as Array<{ day: string; c: number }>;

    // Top files, split into read vs written. Pulls event_type/tool_name/
    // tool_args/commit_files for every row in the window and classifies in
    // JS — simpler and more reliable than per-row SQL LIKE, and lets us keep
    // READ_FILE_TOOLS / WRITE_FILE_TOOLS as the single source of truth.
    //
    // Read: Read/Grep/Glob pre/post events. Only Read actually carries a
    // single file_path worth counting; Grep's tool_args is {pattern, path}
    // (a directory, not a file) and Glob's is a glob pattern — extractRead-
    // FileRefs therefore returns [] for those tools, so they contribute no
    // entries to topFilesRead even though READ_FILE_TOOLS.has() is true.
    // Written: Edit/Write/MultiEdit/NotebookEdit pre/post + commit_files
    // (files in a git commit were modified, hence written).
    // cwd 给提交的文件拼绝对路径用(提交的文件是仓库相对路径,cwd 是提交所在的工作区根)。
    const fileRows = db
      .prepare(
        `SELECT event_type, tool_name, tool_args, commit_files, cwd
         FROM timeline_events ${where}`,
      )
      .all(...baseParams) as FileRow[];
    const paths = projectPathMapper(db);
    const readCounts = new Map<string, number>();
    const writeCounts = new Map<string, number>();
    for (const r of fileRows) {
      if (r.tool_name && READ_FILE_TOOLS.has(r.tool_name)) {
        for (const f of extractReadFileRefs(r.tool_name, r.tool_args)) countFile(readCounts, paths.toolPath(f));
      }
      if (r.tool_name && WRITE_FILE_TOOLS.has(r.tool_name)) {
        for (const f of extractWrittenFileRefs(r.tool_name, r.tool_args)) countFile(writeCounts, paths.toolPath(f));
      }
      for (const f of parseCommitFiles(r.commit_files)) countFile(writeCounts, paths.commitPath(r.cwd, f));
    }

    return {
      totalEvents,
      byType,
      byTool: byToolRows.map(r => ({ tool: r.tool_name, count: r.c })),
      byDay: byDayRows.map(r => ({ day: r.day, count: r.c })),
      topFilesRead: topFiles(readCounts),
      topFilesWritten: topFiles(writeCounts),
      windowStart: since,
      windowEnd: until,
    };
  } catch (err) {
    throw new StoreQueryError(
      `Timeline stats failed: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

/**
 * Extract file references for read-counting from a tool_args JSON blob.
 *
 * Only Read carries a single concrete file (`file_path`). Grep's tool_args is
 * `{ pattern, path }` where `path` is a *directory* (not a file), and Glob's
 * is `{ pattern }` (a glob, not a file) — neither is counted as a read file,
 * so this function returns [] for them even though READ_FILE_TOOLS lists them.
 *
 * @param toolName the tool that produced the args (drives extraction logic).
 */
function extractReadFileRefs(toolName: string, argsJson: string | null): string[] {
  if (toolName !== 'Read' || !argsJson) return [];
  const parsed = tryParseJson<Record<string, unknown>>(argsJson);
  if (!parsed) return [];
  const fp = parsed['file_path'];
  return typeof fp === 'string' && fp.length > 0 ? [fp] : [];
}

/**
 * Extract the target file reference for write-counting from a tool_args JSON blob.
 *
 * Edit/Write/MultiEdit/NotebookEdit all carry a top-level `file_path` that is
 * the file being modified. Only that field is counted — MultiEdit's inner
 * `edits[]` array holds old_string/new_string pairs, not additional files.
 *
 * @param toolName the tool that produced the args (drives extraction logic).
 */
function extractWrittenFileRefs(toolName: string, argsJson: string | null): string[] {
  if (!WRITE_FILE_TOOLS.has(toolName) || !argsJson) return [];
  const parsed = tryParseJson<Record<string, unknown>>(argsJson);
  if (!parsed) return [];
  const fp = parsed['file_path'];
  return typeof fp === 'string' && fp.length > 0 ? [fp] : [];
}
