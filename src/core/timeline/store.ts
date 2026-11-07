/**
 * TimelineStore —— timeline 子系统的底层读写(spec §2 数据模型、§3 记事件、§5 查询)。
 *
 * 包着一个 SqliteDatabase(数据位置那份库:没并过的旧库是本地 `.cgraphx/cgraphx.db`,其余是用户目录里这个项目的
 * 库),只碰 `timeline_*` 表。连接由调用方(hook 入口、CLI、门面)打开和关闭;读的一方用只读打开的连接,表在不在
 * 由门面先查(见 indexer.ts)。统计的主体在 stats.ts,这里的 stats 是调它的薄方法。
 *
 * Field-size caps (spec §2.3) are applied here so callers can pass arbitrary
 * payloads without worrying about DB bloat.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';

import { DatabaseConnection, DATABASE_FILENAME, type SqliteDatabase } from '../db';
import {
  RESULT_SUMMARY_MAX_BYTES,
  SUMMARY_FIELD_MAX_BYTES,
  PROMPT_MAX_BYTES,
  COMMIT_MESSAGE_MAX_BYTES,
  COMMIT_FILES_MAX,
  METADATA_MAX_BYTES,
  METADATA_FIELD_MAX_BYTES,
  ARGS_MAX_BYTES,
  ARGS_FIELD_MAX_BYTES,
  DEFAULT_QUERY_LIMIT,
  MAX_QUERY_LIMIT,
} from './constants';
import {
  type EventType,
  type TimelineEvent,
  type TimelineEventInput,
  type TimelineQueryFilter,
  type TimelineStats,
} from './types';
import { StoreInsertError, StoreQueryError } from './errors';
import { capJsonValue, truncateUtf8 } from './json-cap';
import { hasTable } from './roots';
import { computeTimelineStats, parseCommitFiles, tryParseJson } from './stats';

// ─── Field-size enforcement ────────────────────────────────────────────────

/** 纯文本列(prompt / commit message)按字节截断。 */
function truncateText(s: string | undefined, maxBytes: number): string | null {
  if (s === undefined || s === null) return null;
  return truncateUtf8(s, maxBytes);
}

/**
 * 摘要列:能解析且不超限原样写入;超限按字段截断;不能解析写占位对象。
 * 保证写入值永远是合法 JSON(spec R1)。
 */
function capSummary(summary: string | undefined): string | null {
  if (summary === undefined || summary === null) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(summary);
  } catch {
    return JSON.stringify({ _invalid: true });
  }
  if (Buffer.byteLength(summary, 'utf8') <= RESULT_SUMMARY_MAX_BYTES) return summary;
  return capJsonValue(parsed, { maxStringBytes: SUMMARY_FIELD_MAX_BYTES, maxTotalBytes: RESULT_SUMMARY_MAX_BYTES });
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
  /** 来源 agent 原始值;未知值读取侧按默认 agent 处理。 */
  agent?: string | null;
}

function rowToEvent(row: EventRow): TimelineEvent {
  const args = row.tool_args ? tryParseJson(row.tool_args) : null;
  const files = parseCommitFiles(row.commit_files);
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
    agent: (row.agent as TimelineEvent['agent']) ?? null,
  };
}

// ─── Store ─────────────────────────────────────────────────────────────────

export class TimelineStore {
  constructor(private readonly db: SqliteDatabase) {}

  /**
   * 写一条事件。带 source_key 的行按部分唯一索引去重:键撞上时静默跳过(INSERT OR IGNORE,
   * 补录重读同一事实不多记,spec 2026-11-06-会话文件解析替代hooks D5);不带键的行(hook 路径、
   * git_commit)不进部分索引,行为与原来相同。被跳过时返回的 id 是连接上最近一次成功写入的 id,
   * 只作信息用。
   */
  insert(input: TimelineEventInput): number {
    const ts = input.ts ?? new Date().toISOString();
    const cwd = input.cwd ?? process.cwd();

    // 三个 JSON 列统一收口:超长只截字段的值,整串永远合法(spec R1)。
    const argsValue = input.tool_args !== undefined
      ? capJsonValue(input.tool_args, { maxStringBytes: ARGS_FIELD_MAX_BYTES, maxTotalBytes: ARGS_MAX_BYTES })
      : null;
    const summaryValue = capSummary(input.tool_result_summary);
    const promptValue = truncateText(input.prompt_text, PROMPT_MAX_BYTES);
    const msgValue = truncateText(input.commit_message, COMMIT_MESSAGE_MAX_BYTES);

    let filesJson: string | null = null;
    if (input.commit_files && input.commit_files.length > 0) {
      const trimmed = input.commit_files.slice(0, COMMIT_FILES_MAX);
      const payload = trimmed.length < input.commit_files.length
        ? JSON.stringify({ files: trimmed, _truncated_count: input.commit_files.length - trimmed.length })
        : JSON.stringify(trimmed);
      filesJson = payload;
    }

    const metaValue = input.metadata
      ? capJsonValue(input.metadata, { maxStringBytes: METADATA_FIELD_MAX_BYTES, maxTotalBytes: METADATA_MAX_BYTES })
      : null;

    try {
      const result = this.db
        .prepare(
          `INSERT OR IGNORE INTO timeline_events (
             ts, session_id, event_type, tool_name, tool_args,
             tool_result_summary, prompt_text, duration_ms,
             commit_hash, commit_message, commit_files, cwd, metadata,
             turn_id, commit_insertions, commit_deletions, agent, source_key
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          ts,
          input.session_id ?? null,
          input.event_type,
          input.tool_name ?? null,
          argsValue,
          summaryValue,
          promptValue,
          input.duration_ms ?? null,
          input.commit_hash ?? null,
          msgValue,
          filesJson,
          cwd,
          metaValue,
          input.turn_id ?? null,
          input.commit_insertions ?? null,
          input.commit_deletions ?? null,
          input.agent ?? null,
          input.source_key ?? null,
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

  /** 时间窗内的统计(主体在 stats.ts;文件排行按项目根换算路径,spec D12)。 */
  stats(filter: TimelineQueryFilter): TimelineStats {
    return computeTimelineStats(this.db, {
      since: resolveTimeBound(filter.since),
      until: resolveTimeBound(filter.until, true),
    });
  }
}

// ─── 会话标题(spec 2026-11-06-agent看板 D8)──────────────────────────────────

/** 标题种类:custom = 用户起的(claude custom-title 行)、ai = 自动起的(claude ai-title 行)、agent = deepseek 起的。 */
export type SessionTitleKind = 'custom' | 'ai' | 'agent';

/** 一个会话的标题(plan C-5 的 titles 形状;kind 在读取侧放宽成 string,容忍库里将来的新种类)。 */
export interface SessionTitle {
  readonly sessionId: string;
  readonly title: string;
  readonly kind: string;
  readonly ts: string;
}

/** 标题表写入行(ts 是 ISO 字符串,补录管线换算好;标题截断在写入时做)。 */
export interface SessionTitleUpsert {
  readonly sessionId: string;
  readonly title: string;
  readonly kind: SessionTitleKind;
  readonly ts: string;
}

/** 库里的原始行(列名与表列一一对应,snake_case)。 */
interface SessionTitleRow {
  session_id: string;
  title: string;
  kind: string;
  ts: string;
}

/** kind 的优先级表达式(custom > ai > agent,数字大者胜);col 传 'excluded.kind' 或表列。 */
const kindRank = (col: string): string => `CASE ${col} WHEN 'custom' THEN 2 WHEN 'ai' THEN 1 ELSE 0 END`;

/**
 * 写一个会话的标题,一个会话只留一行(D8):优先级 custom > ai > agent(用户起的永远不被自动起的
 * 盖掉);同级 ts 新者胜,相等也覆盖——claude 的标题行在同一文件里反复追加,后读到的算新。
 * 条件不满足时 ON CONFLICT 静默跳过(不抛错,补录的事实批次不受影响)。标题按摘要预览字段同款
 * 上限截断(json-cap 的 truncateUtf8),不让一行超长标题撑爆库。
 */
const UPSERT_TITLE_SQL =
  'INSERT INTO timeline_session_titles (session_id, title, kind, ts) VALUES (?, ?, ?, ?) ' +
  'ON CONFLICT(session_id) DO UPDATE SET title = excluded.title, kind = excluded.kind, ts = excluded.ts ' +
  `WHERE ${kindRank('excluded.kind')} > ${kindRank('timeline_session_titles.kind')} ` +
  `   OR (${kindRank('excluded.kind')} = ${kindRank('timeline_session_titles.kind')} ` +
  '       AND excluded.ts >= timeline_session_titles.ts)';

export function upsertSessionTitle(db: SqliteDatabase, row: SessionTitleUpsert): void {
  try {
    db.prepare(UPSERT_TITLE_SQL).run(
      row.sessionId,
      truncateUtf8(row.title, SUMMARY_FIELD_MAX_BYTES),
      row.kind,
      row.ts,
    );
  } catch (err) {
    throw new StoreInsertError(
      `Session title upsert failed: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

/** 标题表全表(按会话编号排序,结果稳定),给拿着库连接的调用方(并库前核对、看板读取)。 */
export function readSessionTitles(db: SqliteDatabase): SessionTitle[] {
  try {
    const rows = db
      .prepare('SELECT session_id, title, kind, ts FROM timeline_session_titles ORDER BY session_id')
      .all() as SessionTitleRow[];
    return rows.map((r) => ({ sessionId: r.session_id, title: r.title, kind: r.kind, ts: r.ts }));
  } catch (err) {
    throw new StoreQueryError(
      `Session titles read failed: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

/**
 * 按数据目录只读读标题(看板用,D8 / plan C-5):库文件不在 → 空数组;不应用 schema、不建目录、
 * 不写表(打开写法同 roots.ts 的 readDbFile);旧库可能还没有这张表,表不在按空,不报错。
 */
export function readSessionTitlesInDataDir(dataDir: string): SessionTitle[] {
  const dbPath = path.join(dataDir, DATABASE_FILENAME);
  if (!fs.existsSync(dbPath)) return [];
  const conn = DatabaseConnection.open(dbPath);
  try {
    const db = conn.getDb();
    return hasTable(db, 'timeline_session_titles') ? readSessionTitles(db) : [];
  } finally {
    try {
      conn.close();
    } catch {
      // 关不上不影响结果(句柄随进程退出释放)
    }
  }
}
