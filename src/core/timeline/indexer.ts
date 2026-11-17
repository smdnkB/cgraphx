/**
 * 门面的读函数:打开库 → 调 store → 关库,经 index.ts 导出。
 *
 * 读路径一律只读打开(openTimelineDbForRead:按数据位置找库,库文件不在抛 TimelineSchemaError),不应用 schema、
 * 不建目录、不写表(spec D16)。旧库可能还没被新版写过:库在但没有 timeline_events 表时按没有事件返回(空数组、
 * null、零计数);统计自己处理表不在(见 stats.ts)。参数 start 是起点,当前目录、项目根都行(按数据位置认根)。
 */

import { hasTable, EVENTS_TABLE } from './roots';
import { openTimelineDbForRead } from './schema-bootstrap';
import { TimelineStore, resolveTimeBound } from './store';
import { encodePageCursor, normalizePagedFilter, statDbIdentity, type PageCursor } from './page-cursor';
import type {
  TimelineEvent,
  TimelineQueryFilter,
  TimelinePagedResult,
  TimelineStats,
  PagedQueryFilter,
} from './types';

type SessionStats = {
  event_count: number;
  first_ts: string | null;
  last_user_prompt: string | null;
  duration_ms: number | null;
};

/** 只读打开数据位置那份库读事件;timeline_events 不在 → empty()。 */
function readEvents<T>(start: string, empty: () => T, read: (store: TimelineStore) => T): T {
  const conn = openTimelineDbForRead(start);
  try {
    const db = conn.getDb();
    if (!hasTable(db, EVENTS_TABLE)) return empty();
    return read(new TimelineStore(db));
  } finally {
    conn.close();
  }
}

export async function queryEvents(projectRoot: string, filter: TimelineQueryFilter): Promise<TimelineEvent[]> {
  return readEvents<TimelineEvent[]>(projectRoot, () => [], (store) => store.query(filter));
}

// ─── 历史查询分页(spec:2026-11-16-Codex历史会话补录 D9)────────────────────────

/**
 * 分页读取一页:首页(carry 空)在同一只读连接上取快照上界(最大事件 id)与库文件身份,
 * 再取数据;续页(carry 是游标)沿用游标里的上界、身份与过滤,从上一页末尾继续——不重取
 * 身份,整轮翻页都绑在首页那份库上。表不在(旧库还没写过 timeline_events)按没有事件处理,
 * 与 readEvents 的空态一致。多取一条判断是否存在后续记录,空页/末页 nextCursor 为 null。
 */
function pagedRead(start: string, filter: PagedQueryFilter, carry?: PageCursor): TimelinePagedResult {
  const conn = openTimelineDbForRead(start);
  try {
    const db = conn.getDb();
    if (!hasTable(db, EVENTS_TABLE)) return { events: [], nextCursor: null };
    const store = new TimelineStore(db);
    const snapshotMaxId = carry !== undefined ? carry.snapshot_max_id : store.maxEventId();
    const dbIdentity = carry !== undefined ? carry.db : statDbIdentity(conn.getPath());
    const after = carry !== undefined ? { ts: carry.last_ts, id: carry.last_id } : undefined;
    // 多取一条以区分满页的末页和确有后续记录的页。
    const rows = store.queryPage({ ...filter, limit: filter.limit + 1 }, snapshotMaxId, after);
    const events = rows.slice(0, filter.limit);
    if (rows.length <= filter.limit) return { events, nextCursor: null };
    const last = events[events.length - 1]!;
    return {
      events,
      nextCursor: encodePageCursor({
        v: 1,
        last_ts: last.ts,
        last_id: last.id,
        snapshot_max_id: snapshotMaxId,
        db: dbIdentity,
        filter,
      }),
    };
  } finally {
    conn.close();
  }
}

/** 分页首页(spec D9):过滤在此规范化后连同快照上界封进游标;首页与数据同一连接取。 */
export async function queryEventsFirstPage(
  start: string,
  filter: TimelineQueryFilter,
): Promise<TimelinePagedResult> {
  return pagedRead(start, normalizePagedFilter(filter));
}

/** 分页续页(spec D9):过滤、页大小、快照上界全部来自游标;调用方先过 page-cursor 的校验。 */
export async function queryEventsNextPage(
  start: string,
  cursor: PageCursor,
): Promise<TimelinePagedResult> {
  return pagedRead(start, cursor.filter, cursor);
}

export async function getEventById(projectRoot: string, id: number): Promise<TimelineEvent | null> {
  return readEvents<TimelineEvent | null>(projectRoot, () => null, (store) => store.getById(id));
}

export async function getEventStats(projectRoot: string, filter: TimelineQueryFilter): Promise<TimelineStats> {
  // 统计自己查表在不在:timeline_events 不在给零统计,时间窗照填
  const conn = openTimelineDbForRead(projectRoot);
  try {
    return new TimelineStore(conn.getDb()).stats(filter);
  } finally {
    conn.close();
  }
}

/**
 * Public wrapper around TimelineStore.getSessionStats (B-6).
 *
 * Aggregates the per-session stats the stop-hook enricher attaches to the
 * stop event: total event count, first event ts, last user_prompt text, and
 * the duration from the first event to the last user_prompt. Exposed publicly
 * so CLI / programmatic callers can fetch the same summary on demand.
 */
export async function getSessionStats(
  projectRoot: string,
  session_id: string,
): Promise<SessionStats> {
  return readEvents<SessionStats>(
    projectRoot,
    () => ({ event_count: 0, first_ts: null, last_user_prompt: null, duration_ms: null }),
    (store) => store.getSessionStats(session_id),
  );
}

export { resolveTimeBound };
