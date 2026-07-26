/**
 * High-level query + stats + getEventById — wraps the store with connection
 * lifecycle (open + close). These are the functions exported via index.ts.
 */

import { openTimelineDb } from './schema-bootstrap';
import { TimelineStore, resolveTimeBound } from './store';
import type { TimelineEvent, TimelineQueryFilter, TimelineStats } from './types';

export async function queryEvents(projectRoot: string, filter: TimelineQueryFilter): Promise<TimelineEvent[]> {
  const conn = openTimelineDb(projectRoot);
  try {
    return new TimelineStore(conn.getDb()).query(filter);
  } finally {
    conn.close();
  }
}

export async function getEventById(projectRoot: string, id: number): Promise<TimelineEvent | null> {
  const conn = openTimelineDb(projectRoot);
  try {
    return new TimelineStore(conn.getDb()).getById(id);
  } finally {
    conn.close();
  }
}

export async function getEventStats(projectRoot: string, filter: TimelineQueryFilter): Promise<TimelineStats> {
  const conn = openTimelineDb(projectRoot);
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
  const conn = openTimelineDb(projectRoot);
  try {
    return new TimelineStore(conn.getDb()).getMostRecentPre(filter);
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
): Promise<{
  event_count: number;
  first_ts: string | null;
  last_user_prompt: string | null;
  duration_ms: number | null;
}> {
  const conn = openTimelineDb(projectRoot);
  try {
    return new TimelineStore(conn.getDb()).getSessionStats(session_id);
  } finally {
    conn.close();
  }
}

export { resolveTimeBound };
