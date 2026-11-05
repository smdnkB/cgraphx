/**
 * recordEvent —— 按已知根定数据位置,写入一条事件,同一事务里记下这个根(timeline_roots)。
 *
 * 各 hook 调用的入口,自己管连接的打开与关闭。根是已知根(会话登记里的根、git 钩子分到的项目根),直接按它定
 * 数据位置(基础层 ensureDataDirAtRoot),不再往上找;按 spec D7 不记(没有根的标识、没装过而项目库不在、git
 * 跑不起来)时返回 null,静默。其余失败(schema 错误、库错误)都抛出,由 hook 层捕获后写 stderr、以 0 退出。
 *
 * 写事件、git_commit 的去重、timeline_roots 的 upsert 在同一个 `BEGIN IMMEDIATE` 写事务里(spec D10):两个 hook
 * 进程同时写时,后拿到写锁的那个看得到先写进的行。
 *
 * 旧库模式(数据还在根的本地 `.cgraphx/`,spec D7、D27):install 并旧数据时先写并过记号、再提交旧库,所以拿到写锁
 * 以后再看一次记号——有了就回滚、关库,从头再走一次,第二次给的是项目库;打开、补 schema、写入出错(并旧数据刚删
 * 掉旧表时会碰上 no such table)也再看一次记号,有了同样重走。最多重走一次。
 *
 * 可选的 `enricher`(B-2,timeline-data-quality):在写事务里、事件写入之前调用,拿到活的 store,可以查之前的
 * 事件(如找最近一条 pre_tool_use 给 post_tool_use 算 duration_ms)。它可以返回新事件、原地改事件,或返回
 * void / undefined(此时沿用原事件)。enricher 抛的异常这里不捕获,回滚后交给调用方(hook-runner 的 try/catch);
 * 各 enricher 内部自己兜住查询失败,退化为「事件照记、增强字段为空」。
 *
 * git_commit 事件按 commit_hash 去重(spec D32):同一提交已有 git_commit 事件就不再写,见 insertCommitOnce。
 */

import * as fs from 'node:fs';
import * as path from 'node:path';

import { DatabaseConnection, DATABASE_FILENAME, type SqliteDatabase } from '../db';
import { ensureDataDirAtRoot, readLocalProjectJson } from '../data-location';
import { getCodeGraphDir } from '../directory';
import { ensureTimelineSchema } from './schema-bootstrap';
import { TimelineStore } from './store';
import type { TimelineEventInput } from './types';

/**
 * 增强回调:recordEvent 在写事务里、写入事件之前调用。
 *
 * @param store   刚打开的连接上的 TimelineStore,可以查之前的事件
 * @param event   调用方传入的事件;可以原地改,返回新对象则替换它
 * @returns       增强后的事件;返回 undefined / void 沿用原事件
 */
export type EventEnricher = (
  store: TimelineStore,
  event: TimelineEventInput,
) => TimelineEventInput | void;

/** 记下项目在本机出现过的根(spec D10):最早取较早的,最近取较晚的。 */
const UPSERT_ROOT_SQL =
  'INSERT INTO timeline_roots (root, first_ts, last_ts) VALUES (?, ?, ?) ' +
  'ON CONFLICT(root) DO UPDATE SET first_ts = min(first_ts, excluded.first_ts), last_ts = max(last_ts, excluded.last_ts)';

/** 旧库模式下恰好并完、要改写项目库:从头再走一次。 */
const RETRY = Symbol('retry');

/** 写进去的事件:id,以及它的 ts(upsert timeline_roots 用)。 */
interface WrittenEvent {
  id: number;
  ts: string;
}

export async function recordEvent(
  root: string,
  event: TimelineEventInput,
  enricher?: EventEnricher,
): Promise<number | null> {
  const first = recordOnce(root, event, enricher, true);
  if (first !== RETRY) return first;
  // 第二次 ensureDataDirAtRoot 看得到并过记号,给的是项目库;不再重走
  const second = recordOnce(root, event, enricher, false);
  return second === RETRY ? null : second;
}

/**
 * 走一次:定位置、打开库、写事务里写事件和根。`mayRetry` 为真时,旧库模式下看到并过记号返回 RETRY。
 */
function recordOnce(
  root: string,
  event: TimelineEventInput,
  enricher: EventEnricher | undefined,
  mayRetry: boolean,
): number | null | typeof RETRY {
  const resolved = path.resolve(root);
  const dir = ensureDataDirAtRoot(resolved);
  if (dir === null) return null;
  // ensureDataDirAtRoot 给本地 `.cgraphx/` 就是旧库模式
  const legacy = path.resolve(dir) === path.resolve(getCodeGraphDir(resolved));
  const watchMark = legacy && mayRetry;

  let connection: DatabaseConnection | null = null;
  try {
    connection = DatabaseConnection.open(path.join(dir, DATABASE_FILENAME));
    const db = connection.getDb();
    ensureTimelineSchema(db);
    db.exec('BEGIN IMMEDIATE');
    try {
      if (watchMark && hasMergedMark(resolved)) {
        db.exec('ROLLBACK');
        return RETRY;
      }
      const store = new TimelineStore(db);
      const written = event.event_type === 'git_commit'
        ? insertCommitOnce(db, store, event, enricher)
        : insertEvent(store, event, enricher);
      db.prepare(UPSERT_ROOT_SQL).run(realRootOf(resolved), written.ts, written.ts);
      db.exec('COMMIT');
      return written.id;
    } catch (err) {
      try { db.exec('ROLLBACK'); } catch { /* 事务可能已结束 */ }
      throw err;
    }
  } catch (err) {
    if (watchMark) {
      // 先关库(并旧数据可能正等着这个库),再看记号:并完了就改写项目库
      closeQuietly(connection);
      connection = null;
      if (hasMergedMark(resolved)) return RETRY;
    }
    throw err;
  } finally {
    closeQuietly(connection);
  }
}

/** 本地 `.cgraphx/project.json` 有并过记号(每次现读)。 */
function hasMergedMark(root: string): boolean {
  return (readLocalProjectJson(root)?.mergedAt ?? null) !== null;
}

/** timeline_roots 记的根:取 realpath,失败用 path.resolve。 */
function realRootOf(root: string): string {
  try {
    return fs.realpathSync(root);
  } catch {
    return path.resolve(root);
  }
}

function closeQuietly(connection: DatabaseConnection | null): void {
  try {
    connection?.close();
  } catch {
    // 关不上不盖住原来的结果
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

/** 写一条事件;ts 在这里定下(没给就取现在),和 timeline_roots 记的一致。 */
function insertEvent(
  store: TimelineStore,
  event: TimelineEventInput,
  enricher: EventEnricher | undefined,
): WrittenEvent {
  const enriched = applyEnricher(store, event, enricher);
  const ts = enriched.ts ?? new Date().toISOString();
  return { id: store.insert({ ...enriched, ts }), ts };
}

/**
 * 写 git_commit 事件,同一 commit_hash 已有 git_commit 事件就返回它的 id、不写。
 *
 * 在调用方已开的 `BEGIN IMMEDIATE` 事务里查和写:post-commit、post-merge 两个钩子进程同时记同一提交时,后拿到
 * 写锁的那个查得到先写进的行。连接的 `transaction()` 用普通 `BEGIN`,两个进程会都查不到、都写进去,所以不用它。
 */
function insertCommitOnce(
  db: SqliteDatabase,
  store: TimelineStore,
  event: TimelineEventInput,
  enricher: EventEnricher | undefined,
): WrittenEvent {
  const existing = db
    .prepare("SELECT id FROM timeline_events WHERE event_type = 'git_commit' AND commit_hash = ? LIMIT 1")
    .get(event.commit_hash ?? null) as { id: number | bigint } | undefined;
  if (existing !== undefined) return { id: Number(existing.id), ts: event.ts ?? new Date().toISOString() };
  return insertEvent(store, event, enricher);
}
