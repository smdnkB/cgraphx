/**
 * recordEvent —— 打开 timeline 库,写入一条事件。
 *
 * 各 hook 调用的入口,自己管连接的打开与关闭。任何失败(项目未初始化、schema 错误、
 * 库错误)都抛出,由 hook 层捕获后写 stderr、以 0 退出。
 *
 * 可选的 `enricher`(B-2,timeline-data-quality):在库打开之后、事件写入之前调用,拿到
 * 活的 store,可以查之前的事件(如找最近一条 pre_tool_use 给 post_tool_use 算 duration_ms)。
 * 它可以返回新事件、原地改事件,或返回 void / undefined(此时沿用原事件)。这是通用扩展点,
 * 之后的增强需求(如 B-6 stop 事件的会话汇总)复用同一参数,不改 recordEvent 的签名。
 * enricher 抛的异常这里不捕获,交给调用方(hook-runner 的 try/catch),不阻塞 hook;各
 * enricher 内部自己兜住查询失败,退化为「事件照记、增强字段为空」。
 *
 * git_commit 事件按 commit_hash 去重(spec D32):同一提交已有 git_commit 事件就不再写,
 * 见 insertCommitOnce。
 */

import type { SqliteDatabase } from '../db';
import { openTimelineDb } from './schema-bootstrap';
import { TimelineStore } from './store';
import type { TimelineEventInput } from './types';

/**
 * Enrichment callback invoked inside recordEvent before insert.
 *
 * @param store   Live TimelineStore backed by the just-opened connection.
 * @param event   The original event the caller passed. May be mutated in
 *                place; if a new object is returned, it replaces the event.
 * @returns       The enriched event, OR undefined/void to keep the original.
 */
export type EventEnricher = (
  store: TimelineStore,
  event: TimelineEventInput,
) => TimelineEventInput | void;

export async function recordEvent(
  projectRoot: string,
  event: TimelineEventInput,
  enricher?: EventEnricher,
): Promise<number> {
  const connection = openTimelineDb(projectRoot);
  try {
    const db = connection.getDb();
    const store = new TimelineStore(db);
    if (event.event_type === 'git_commit') return insertCommitOnce(db, store, event, enricher);
    return store.insert(applyEnricher(store, event, enricher));
  } finally {
    connection.close();
  }
}

/** 有 enricher 就先过一遍;`enricher(...) ?? event` 兼顾返回 undefined 与 void,都退回原事件。 */
function applyEnricher(
  store: TimelineStore,
  event: TimelineEventInput,
  enricher: EventEnricher | undefined,
): TimelineEventInput {
  return enricher ? (enricher(store, event) ?? event) : event;
}

/**
 * 写 git_commit 事件,同一 commit_hash 已有 git_commit 事件就返回它的 id、不写。
 *
 * 查和写在同一个 `BEGIN IMMEDIATE` 事务里:post-commit、post-merge 两个钩子进程同时记同一
 * 提交时,后拿到写锁的那个查得到先写进的行。连接的 `transaction()` 用普通 `BEGIN`,两个进程
 * 会都查不到、都写进去,这里不用它。出错先 ROLLBACK 再照旧抛出,由 hook 层吞掉。
 */
function insertCommitOnce(
  db: SqliteDatabase,
  store: TimelineStore,
  event: TimelineEventInput,
  enricher: EventEnricher | undefined,
): number {
  db.exec('BEGIN IMMEDIATE');
  try {
    const existing = db
      .prepare("SELECT id FROM timeline_events WHERE event_type = 'git_commit' AND commit_hash = ? LIMIT 1")
      .get(event.commit_hash ?? null) as { id: number | bigint } | undefined;
    const id = existing !== undefined
      ? Number(existing.id)
      : store.insert(applyEnricher(store, event, enricher));
    db.exec('COMMIT');
    return id;
  } catch (err) {
    try { db.exec('ROLLBACK'); } catch { /* 事务可能已结束 */ }
    throw err;
  }
}
