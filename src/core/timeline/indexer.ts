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
import type { TimelineEvent, TimelineQueryFilter, TimelineStats } from './types';

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
