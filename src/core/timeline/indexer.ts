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

type SessionMaxId = { sessionId: string; maxId: number };

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
 * Public wrapper around TimelineStore.getMostRecentPre (B-2).
 *
 * Finds the most recent pre_tool_use matching (turn_id, tool_name, session_id).
 * Used by the post-tool-use enricher to compute duration_ms; exposed publicly
 * so CLI / programmatic callers can do the same lookup.
 */
export async function getMostRecentPre(
  projectRoot: string,
  filter: { turn_id: string; tool_name: string; session_id: string | null },
): Promise<TimelineEvent | null> {
  return readEvents<TimelineEvent | null>(projectRoot, () => null, (store) => store.getMostRecentPre(filter));
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

/** 每个会话的最大事件 id(只读;供 sync 判定增量)。 */
export async function listSessionEventMaxIds(
  projectRoot: string,
): Promise<SessionMaxId[]> {
  return readEvents<SessionMaxId[]>(projectRoot, () => [], (store) => store.listSessionMaxIds());
}

/** 指定几个会话各自的最大事件 id(只读;spec D15:Stop hook 只刷本会话);库里没有事件的会话不出现。 */
export async function listSessionEventMaxIdsFor(
  start: string,
  sessionIds: readonly string[],
): Promise<SessionMaxId[]> {
  return readEvents<SessionMaxId[]>(start, () => [], (store) => store.listSessionMaxIdsFor(sessionIds));
}

/** 指定会话中 id > afterId 的全部事件,id 升序,无上限(只读;供 sync 增量上报)。 */
export async function listSessionEventsAfter(
  projectRoot: string,
  sessionId: string,
  afterId: number,
): Promise<TimelineEvent[]> {
  return readEvents<TimelineEvent[]>(projectRoot, () => [], (store) => store.listSessionEventsAfter(sessionId, afterId));
}

/** 指定会话的全部事件,ts 升序、同 ts 按 id 升序,无上限(只读;spec D28:并过的旧事件 id 不按时间排)。 */
export async function listSessionEventsByTs(start: string, sessionId: string): Promise<TimelineEvent[]> {
  return readEvents<TimelineEvent[]>(start, () => [], (store) => store.listSessionEventsByTs(sessionId));
}

/** 全部 git_commit 事件(含终端 commit),ts、id 升序,无上限(只读;供 sync 上报 commit)。 */
export async function listCommitEvents(projectRoot: string): Promise<TimelineEvent[]> {
  return readEvents<TimelineEvent[]>(projectRoot, () => [], (store) => store.listCommitEvents());
}

export { resolveTimeBound };
