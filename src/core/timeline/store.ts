/**
 * TimelineStore — low-level persistence for the timeline subsystem.
 *
 * Spec §2 (data model) + §3 (event recording) + §5 (query).
 *
 * Wraps a single SqliteDatabase (the shared .cgraphx/cgraphx.db) and
 * touches only `timeline_*` tables. The DB handle is owned by the caller
 * (hook entry or CLI) and closed when the caller is done.
 *
 * Field-size caps (spec §2.3) are applied here so callers can pass arbitrary
 * payloads without worrying about DB bloat.
 */

import type { SqliteDatabase } from '../db';
import {
  RESULT_SUMMARY_MAX_BYTES,
  PROMPT_MAX_BYTES,
  COMMIT_MESSAGE_MAX_BYTES,
  COMMIT_FILES_MAX,
  METADATA_MAX_BYTES,
  TRUNCATED_SUFFIX,
  DEFAULT_QUERY_LIMIT,
  MAX_QUERY_LIMIT,
  READ_FILE_TOOLS,
  WRITE_FILE_TOOLS,
} from './constants';
import {
  type EventType,
  type TimelineEvent,
  type TimelineEventInput,
  type TimelineQueryFilter,
  type TimelineStats,
} from './types';
import { StoreInsertError, StoreQueryError } from './errors';

// ─── Field-size enforcement (spec §2.3) ────────────────────────────────────

function truncateString(s: string | undefined, maxBytes: number): { value: string | null; truncated: boolean } {
  if (s === undefined || s === null) return { value: null, truncated: false };
  const buf = Buffer.from(s, 'utf8');
  if (buf.length <= maxBytes) return { value: s, truncated: false };
  return {
    value: buf.subarray(0, maxBytes - TRUNCATED_SUFFIX.length).toString('utf8') + TRUNCATED_SUFFIX,
    truncated: true,
  };
}

/** Safe JSON.stringify with cycle protection. */
function safeStringify(value: unknown, maxBytes: number): { value: string | null; truncated: boolean } {
  let json: string;
  try {
    json = JSON.stringify(value);
  } catch {
    // Cyclic or otherwise unserializable — record the failure but don't crash.
    json = JSON.stringify({ _error: 'unserializable payload' });
  }
  return truncateString(json, maxBytes);
}

// ─── Time window parsing (spec §5.2) ───────────────────────────────────────

/**
 * Resolve a relative-or-absolute time string to an ISO 8601 UTC timestamp.
 *
 * Inputs:
 *   - ISO 8601 absolute: '2026-06-01' / '2026-06-01T00:00:00Z'
 *   - Relative: '7d' / '12h' / '30m' / 'now'
 *
 * Date-only strings ('YYYY-MM-DD') are interpreted in the **local** timezone
 * (so `--since=2026-07-01` covers the user's local July 1st, not UTC midnight
 * which would clip the first 0-8h in UTC+N timezones). Strings that carry an
 * explicit zone designator (Z or ±HH:MM) are absolute moments and unaffected.
 *
 * Returns null if input is empty/invalid (caller treats null as "no filter").
 */
export function resolveTimeBound(input: string | undefined, defaultToNow = false): string | null {
  if (!input || !input.trim()) return defaultToNow ? new Date().toISOString() : null;

  const trimmed = input.trim();

  if (trimmed === 'now') return new Date().toISOString();

  // Relative: Nm / Nh / Nd
  const rel = trimmed.match(/^(\d+)([mhd])$/i);
  if (rel) {
    const n = parseInt(rel[1]!, 10);
    const unit = rel[2]!.toLowerCase();
    const ms = n * (unit === 'm' ? 60_000 : unit === 'h' ? 3_600_000 : 86_400_000);
    return new Date(Date.now() - ms).toISOString();
  }

  // Date-only 'YYYY-MM-DD' → interpret as local midnight. new Date('YYYY-MM-DD')
  // spec-parses this as UTC midnight, which would silently shift the window
  // boundary by up to a day in non-UTC zones; build a local Date instead.
  const dateOnly = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (dateOnly) {
    const local = new Date(
      Number(dateOnly[1]),
      Number(dateOnly[2]) - 1,
      Number(dateOnly[3]),
    );
    if (!Number.isNaN(local.getTime())) return local.toISOString();
  }

  // Anything else (ISO 8601 with explicit zone, naive datetime, etc.) — let
  // Date parse it. Naive 'YYYY-MM-DDTHH:MM:SS' already parses as local per spec.
  const parsed = new Date(trimmed);
  if (!Number.isNaN(parsed.getTime())) return parsed.toISOString();

  return defaultToNow ? new Date().toISOString() : null;
}

// ─── Row mapping ───────────────────────────────────────────────────────────

interface EventRow {
  id: number;
  ts: string;
  session_id: string | null;
  event_type: string;
  tool_name: string | null;
  tool_args: string | null;
  tool_result_summary: string | null;
  prompt_text: string | null;
  duration_ms: number | null;
  commit_hash: string | null;
  commit_message: string | null;
  commit_files: string | null;
  cwd: string;
  metadata: string | null;
  turn_id: string | null;
  commit_insertions: number | null;
  commit_deletions: number | null;
  /** 来源 agent 原始值;rowToEvent 不映射,读取侧输出不含该字段。 */
  agent?: string | null;
}

function rowToEvent(row: EventRow): TimelineEvent {
  const args = row.tool_args ? tryParseJson(row.tool_args) : null;
  const files = row.commit_files ? tryParseJson<string[]>(row.commit_files) ?? [] : [];
  const metadata = row.metadata ? tryParseJson<Record<string, unknown>>(row.metadata) ?? {} : {};
  return {
    id: row.id,
    ts: row.ts,
    session_id: row.session_id,
    event_type: row.event_type as EventType,
    tool_name: row.tool_name,
    tool_args: args,
    tool_result_summary: row.tool_result_summary,
    prompt_text: row.prompt_text,
    duration_ms: row.duration_ms,
    commit_hash: row.commit_hash,
    commit_message: row.commit_message,
    commit_files: files,
    cwd: row.cwd,
    metadata,
    turn_id: row.turn_id,
    commit_insertions: row.commit_insertions,
    commit_deletions: row.commit_deletions,
  };
}

function tryParseJson<T>(s: string): T | null {
  try { return JSON.parse(s) as T; } catch { return null; }
}

// ─── Store ─────────────────────────────────────────────────────────────────

export class TimelineStore {
  constructor(private readonly db: SqliteDatabase) {}

  insert(input: TimelineEventInput): number {
    const ts = input.ts ?? new Date().toISOString();
    const cwd = input.cwd ?? process.cwd();

    // tool_args: store full JSON without truncation. Field-size caps for
    // tool_args were dropped from MVP (spec §2.3 amendment) — truncating a
    // JSON blob mid-string corrupts it past JSON.parse, losing the structure
    // callers depend on. Most real tool_args fit comfortably under 64KB;
    // when they don't (a Read of a huge file), the user opted into the
    // payload by calling the tool.
    let argsValue: string | null = null;
    if (input.tool_args !== undefined) {
      const r = safeStringify(input.tool_args, Number.MAX_SAFE_INTEGER);
      argsValue = r.value;
    }

    const summaryRes = truncateString(input.tool_result_summary, RESULT_SUMMARY_MAX_BYTES);
    const promptRes = truncateString(input.prompt_text, PROMPT_MAX_BYTES);
    const msgRes = truncateString(input.commit_message, COMMIT_MESSAGE_MAX_BYTES);

    let filesJson: string | null = null;
    if (input.commit_files && input.commit_files.length > 0) {
      const trimmed = input.commit_files.slice(0, COMMIT_FILES_MAX);
      const payload = trimmed.length < input.commit_files.length
        ? JSON.stringify({ files: trimmed, _truncated_count: input.commit_files.length - trimmed.length })
        : JSON.stringify(trimmed);
      filesJson = payload;
    }

    const metaRes = input.metadata ? safeStringify(input.metadata, METADATA_MAX_BYTES) : { value: null };

    try {
      const result = this.db
        .prepare(
          `INSERT INTO timeline_events (
             ts, session_id, event_type, tool_name, tool_args,
             tool_result_summary, prompt_text, duration_ms,
             commit_hash, commit_message, commit_files, cwd, metadata,
             turn_id, commit_insertions, commit_deletions, agent
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          ts,
          input.session_id ?? null,
          input.event_type,
          input.tool_name ?? null,
          argsValue,
          summaryRes.value,
          promptRes.value,
          input.duration_ms ?? null,
          input.commit_hash ?? null,
          msgRes.value,
          filesJson,
          cwd,
          metaRes.value,
          input.turn_id ?? null,
          input.commit_insertions ?? null,
          input.commit_deletions ?? null,
          input.agent ?? null,
        );
      const id = (result as unknown as { lastInsertRowid: number }).lastInsertRowid;
      return typeof id === 'number' ? id : Number(id);
    } catch (err) {
      throw new StoreInsertError(
        `Timeline insert failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  query(filter: TimelineQueryFilter): TimelineEvent[] {
    const since = resolveTimeBound(filter.since);
    const until = resolveTimeBound(filter.until);
    const limit = Math.min(Math.max(filter.limit ?? DEFAULT_QUERY_LIMIT, 1), MAX_QUERY_LIMIT);

    const clauses: string[] = [];
    const params: Array<string | number> = [];

    if (since) { clauses.push('ts >= ?'); params.push(since); }
    if (until) { clauses.push('ts <= ?'); params.push(until); }
    if (filter.type) { clauses.push('event_type = ?'); params.push(filter.type); }
    if (filter.tool) { clauses.push('tool_name = ?'); params.push(filter.tool); }
    if (filter.session) { clauses.push('session_id = ?'); params.push(filter.session); }
    if (filter.turn) { clauses.push('turn_id = ?'); params.push(filter.turn); }
    if (filter.file) {
      // Substring against tool_args (Edit/Write/Read file_path) AND commit_files JSON.
      clauses.push("(tool_args LIKE ? OR commit_files LIKE ?)");
      const needle = `%${filter.file}%`;
      params.push(needle, needle);
    }

    const where = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '';
    const sql = `SELECT * FROM timeline_events ${where} ORDER BY ts DESC, id DESC LIMIT ?`;
    params.push(limit);

    try {
      const rows = this.db.prepare(sql).all(...params) as EventRow[];
      return rows.map(rowToEvent);
    } catch (err) {
      throw new StoreQueryError(
        `Timeline query failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  getById(id: number): TimelineEvent | null {
    try {
      const row = this.db
        .prepare('SELECT * FROM timeline_events WHERE id = ?')
        .get(id) as EventRow | undefined;
      return row ? rowToEvent(row) : null;
    } catch (err) {
      throw new StoreQueryError(
        `Timeline getById failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  /** 每个会话的最大事件 id(session_id 为空的事件不计)。 */
  listSessionMaxIds(): Array<{ sessionId: string; maxId: number }> {
    try {
      const rows = this.db
        .prepare(
          'SELECT session_id, max(id) AS max_id FROM timeline_events WHERE session_id IS NOT NULL GROUP BY session_id',
        )
        .all() as Array<{ session_id: string; max_id: number }>;
      return rows.map((r) => ({ sessionId: r.session_id, maxId: Number(r.max_id) }));
    } catch (err) {
      throw new StoreQueryError(
        `Timeline 会话水位查询失败:${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  /** 指定会话中 id 大于 afterId 的全部事件,按 id 升序,不设上限(不同于 query 的 limit + ts 倒序)。 */
  listSessionEventsAfter(sessionId: string, afterId: number): TimelineEvent[] {
    try {
      const rows = this.db
        .prepare('SELECT * FROM timeline_events WHERE session_id = ? AND id > ? ORDER BY id ASC')
        .all(sessionId, afterId) as EventRow[];
      return rows.map(rowToEvent);
    } catch (err) {
      throw new StoreQueryError(
        `Timeline 会话增量事件查询失败:${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  /** 全部 git_commit 事件(含 session_id 为空的终端 commit),按 ts、id 升序,不设上限。 */
  listCommitEvents(): TimelineEvent[] {
    try {
      const rows = this.db
        .prepare("SELECT * FROM timeline_events WHERE event_type = 'git_commit' ORDER BY ts ASC, id ASC")
        .all() as EventRow[];
      return rows.map(rowToEvent);
    } catch (err) {
      throw new StoreQueryError(
        `Timeline commit 事件查询失败:${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  /**
   * Find the most recent pre_tool_use event matching the given filter.
   *
   * Used by B-2's duration_ms enricher to compute post.ts - pre.ts for
   * write-tool post events within a turn. Filters on turn_id + tool_name +
   * session_id; session_id null is matched via `IS NULL` (the schema allows
   * NULL session_id for events Claude Code couldn't attribute to a session).
   *
   * Uses idx_timeline_turn_id (turn_id index) plus the ORDER BY ts DESC
   * LIMIT 1 pattern to keep the lookup sub-millisecond at scale.
   *
   * @returns the matching event, or null if none exists.
   */
  getMostRecentPre(filter: {
    turn_id: string;
    tool_name: string;
    session_id: string | null;
  }): TimelineEvent | null {
    const sessionClause = filter.session_id === null
      ? 'AND session_id IS NULL'
      : 'AND session_id = ?';
    const sql = `SELECT * FROM timeline_events
                 WHERE turn_id = ? AND tool_name = ? ${sessionClause}
                   AND event_type = 'pre_tool_use'
                 ORDER BY ts DESC, id DESC LIMIT 1`;
    const params = filter.session_id === null
      ? [filter.turn_id, filter.tool_name]
      : [filter.turn_id, filter.tool_name, filter.session_id];
    try {
      const row = this.db.prepare(sql).get(...params) as EventRow | undefined;
      return row ? rowToEvent(row) : null;
    } catch (err) {
      throw new StoreQueryError(
        `Timeline getMostRecentPre failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  /**
   * Aggregate stats for a single session (B-6).
   *
   * Used by the stop-hook enricher to summarize the session at its end:
   * total event count, first event ts, last user_prompt text preview, and
   * the duration from the first event to the last user_prompt. Two SELECTs
   * (one aggregate, one for the prompt text) keep this sub-millisecond on
   * the stop hook's 50ms budget.
   *
   * @returns counts and timestamps; null fields when the session has no
   *   events or no user_prompt events.
   */
  getSessionStats(session_id: string): {
    event_count: number;
    first_ts: string | null;
    last_user_prompt: string | null;
    duration_ms: number | null;
  } {
    try {
      const row = this.db.prepare(`
        SELECT
          COUNT(*) AS event_count,
          MIN(ts) AS first_ts,
          MAX(CASE WHEN event_type='user_prompt' THEN ts END) AS last_prompt_ts
        FROM timeline_events WHERE session_id = ?
      `).get(session_id) as { event_count: number; first_ts: string | null; last_prompt_ts: string | null };

      const lastPromptRow = this.db.prepare(`
        SELECT prompt_text FROM timeline_events
        WHERE session_id = ? AND event_type = 'user_prompt'
        ORDER BY ts DESC LIMIT 1
      `).get(session_id) as { prompt_text: string | null } | undefined;

      const duration_ms = row.first_ts && row.last_prompt_ts
        ? new Date(row.last_prompt_ts).getTime() - new Date(row.first_ts).getTime()
        : null;

      return {
        event_count: row.event_count,
        first_ts: row.first_ts,
        last_user_prompt: lastPromptRow?.prompt_text ?? null,
        duration_ms,
      };
    } catch (err) {
      throw new StoreQueryError(
        `Timeline getSessionStats failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  stats(filter: TimelineQueryFilter): TimelineStats {
    const since = resolveTimeBound(filter.since);
    const until = resolveTimeBound(filter.until, true);

    const baseClauses: string[] = [];
    const baseParams: Array<string | number> = [];
    if (since) { baseClauses.push('ts >= ?'); baseParams.push(since); }
    if (until) { baseClauses.push('ts <= ?'); baseParams.push(until); }
    const where = baseClauses.length ? `WHERE ${baseClauses.join(' AND ')}` : '';

    try {
      const totalRow = this.db
        .prepare(`SELECT COUNT(*) AS c FROM timeline_events ${where}`)
        .get(...baseParams) as { c: number } | undefined;
      const totalEvents = totalRow?.c ?? 0;

      const byTypeRows = this.db
        .prepare(
          `SELECT event_type, COUNT(*) AS c FROM timeline_events ${where} GROUP BY event_type`,
        )
        .all(...baseParams) as Array<{ event_type: string; c: number }>;
      const byType: Record<EventType, number> = {
        user_prompt: 0,
        pre_tool_use: 0,
        post_tool_use: 0,
        stop: 0,
        git_commit: 0,
        session_start: 0,
        session_end: 0,
      };
      for (const r of byTypeRows) {
        byType[r.event_type as EventType] = r.c;
      }

      const byToolRows = this.db
        .prepare(
          `SELECT tool_name, COUNT(*) AS c FROM timeline_events
           ${where} ${where ? 'AND' : 'WHERE'} tool_name IS NOT NULL
           GROUP BY tool_name ORDER BY c DESC LIMIT 20`,
        )
        .all(...baseParams) as Array<{ tool_name: string; c: number }>;

      const byDayRows = this.db
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
      const fileRows = this.db
        .prepare(
          `SELECT event_type, tool_name, tool_args, commit_files
           FROM timeline_events ${where}`,
        )
        .all(...baseParams) as Array<{
          event_type: string;
          tool_name: string | null;
          tool_args: string | null;
          commit_files: string | null;
        }>;
      const readCounts = new Map<string, number>();
      const writeCounts = new Map<string, number>();
      for (const r of fileRows) {
        if (r.tool_name && READ_FILE_TOOLS.has(r.tool_name)) {
          for (const f of extractReadFileRefs(r.tool_name, r.tool_args)) {
            readCounts.set(f, (readCounts.get(f) ?? 0) + 1);
          }
        }
        if (r.tool_name && WRITE_FILE_TOOLS.has(r.tool_name)) {
          for (const f of extractWrittenFileRefs(r.tool_name, r.tool_args)) {
            writeCounts.set(f, (writeCounts.get(f) ?? 0) + 1);
          }
        }
        if (r.commit_files) {
          const parsed = tryParseJson<string[] | { files: string[] }>(r.commit_files);
          if (Array.isArray(parsed)) {
            for (const f of parsed.filter((s): s is string => typeof s === 'string')) {
              writeCounts.set(f, (writeCounts.get(f) ?? 0) + 1);
            }
          } else if (parsed && Array.isArray(parsed.files)) {
            for (const f of parsed.files.filter((s): s is string => typeof s === 'string')) {
              writeCounts.set(f, (writeCounts.get(f) ?? 0) + 1);
            }
          }
        }
      }

      const topFilesRead = Array.from(readCounts.entries())
        .map(([file, count]) => ({ file, count }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 20);
      const topFilesWritten = Array.from(writeCounts.entries())
        .map(([file, count]) => ({ file, count }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 20);

      return {
        totalEvents,
        byType,
        byTool: byToolRows.map(r => ({ tool: r.tool_name, count: r.c })),
        byDay: byDayRows.map(r => ({ day: r.day, count: r.c })),
        topFilesRead,
        topFilesWritten,
        windowStart: since,
        windowEnd: until,
      };
    } catch (err) {
      throw new StoreQueryError(
        `Timeline stats failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
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
