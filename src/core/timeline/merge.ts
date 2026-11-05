/**
 * 并旧事件(spec:2026-11-05-数据按项目放用户目录 D27、D28、D29 timeline 部分)
 *
 * 把目录本地旧库的 timeline_events 并进用户目录里的项目库,由 project 子系统编排,分两段(D27):
 * ① mergeEventsUpTo:不加锁,旧库 id ≤ 上限的事件按 id 升序分批写进项目库,每批一个项目库写事务;
 * ② mergeTail:调用方已持旧库写锁,并剩下的尾巴(id > afterId),再把归到各根的活动并进项目库 timeline_roots。
 *
 * 去重(D28):除 id 外各列都相同(NULL 用 IS 比)算同一条事件;git_commit 只比 commit_hash,项目库里已有同 hash
 * 的 git_commit 就算重复。重复的不再写,旧 id 对照到项目库已有那条的 id。id 对照与进度换算见 EventIdMapping。
 *
 * 不改旧库:只查询,不碰它的事务。timeline_meta、timeline_schema_versions 不并。两边库都由调用方先应用过 schema。
 */

import * as fs from 'node:fs';
import * as path from 'node:path';

import type { SqliteDatabase } from '../db';
import { createRootMatcher } from '../root-match';
import { TimelineSchemaError } from './errors';
import { addTally, EVENTS_TABLE, hasTable, readRootRows, RootAttribution, type RootTally } from './roots';
import type { EventIdMapping, TimelineMergeStats, TimelineMerger } from './types';

type Statement = ReturnType<SqliteDatabase['prepare']>;

/** 一批读、写的旧事件条数:每批一个项目库写事务,不长时间占着项目库的写锁。 */
const MERGE_BATCH_SIZE = 500;

/** `session_id IN (…)` 一次最多带的参数个数,超过分批查。 */
const SESSION_ID_QUERY_BATCH = 500;

/** 去重、归根、进度对照要用到的列;两边库应用过 timeline schema 就都有。 */
const REQUIRED_COLUMNS = ['ts', 'session_id', 'event_type', 'cwd', 'commit_hash'] as const;

/** 写项目库 timeline_roots:冲突时最早取较早的、最近取较晚的(同记事件时的 upsert)。 */
const UPSERT_ROOT_SQL =
  'INSERT INTO timeline_roots (root, first_ts, last_ts) VALUES (?, ?, ?) ' +
  'ON CONFLICT(root) DO UPDATE SET first_ts = min(first_ts, excluded.first_ts), last_ts = max(last_ts, excluded.last_ts)';

/** 从旧库读出的一行事件:id 加上两边都有的列。 */
interface OldEventRow {
  id: number;
  ts: string;
  session_id: string | null;
  event_type: string;
  cwd: string;
  commit_hash: string | null;
  [column: string]: unknown;
}

/** 一个会话在旧库里的事件 id(升序)和对照到的新 id,给进度换算二分查找。 */
interface SessionTrail {
  oldIds: number[];
  newIds: number[];
}

/** 一批里处理完、等项目库事务提交后才记进对照的一行。 */
interface MergedRow {
  row: OldEventRow;
  newId: number;
  duplicate: boolean;
}

/** 库里最大的事件 id;空表、表不在 → 0。 */
export function maxTimelineEventId(db: SqliteDatabase): number {
  if (!hasTable(db, EVENTS_TABLE)) return 0;
  return maxEventId(db);
}

function maxEventId(db: SqliteDatabase): number {
  const row = db.prepare('SELECT COALESCE(MAX(id), 0) AS id FROM timeline_events').get() as { id: number | bigint };
  return Number(row.id);
}

/**
 * 建并旧事件的合并器。建时先记下项目库里各会话的最大 id(只记旧库里出现的会话,给 projectMaxIdBefore);
 * 调用方已对两边库应用过 timeline schema;合并器不改旧库。
 */
export function createTimelineMerger(oldDb: SqliteDatabase, projectDb: SqliteDatabase): TimelineMerger {
  return new EventMerger(oldDb, projectDb);
}

/** 事件表除 id 外的列,按表定义的顺序;表不在 → []。 */
function eventColumns(db: SqliteDatabase): string[] {
  const cols = db.prepare('PRAGMA table_info(timeline_events)').all() as Array<{ name: string }>;
  return cols.map((c) => c.name).filter((name) => name !== 'id');
}

function quoteIdent(name: string): string {
  return `"${name.replace(/"/g, '""')}"`;
}

function placeholders(n: number): string {
  return Array.from({ length: n }, () => '?').join(', ');
}

/**
 * 「同一条事件」的条件,列按 columns 的顺序:ts = ? 放第一个、走 timeline_events_ts_idx;其余列 NULL 用 IS 比,并加
 * 一元 `+`,不让查询计划改走会话、类型、工具、轮次的索引(一个会话的事件成千上万,同一毫秒的只有几条)。
 */
function sameEventWhere(columns: readonly string[]): string {
  return columns.map((c) => (c === 'ts' ? `${quoteIdent(c)} = ?` : `+${quoteIdent(c)} IS ?`)).join(' AND ');
}

function isHashedCommit(row: OldEventRow): row is OldEventRow & { commit_hash: string } {
  return row.event_type === 'git_commit' && typeof row.commit_hash === 'string';
}

/** 有序数组里不大于 value 的最后一个下标;没有 → -1。 */
function lastIndexAtMost(sorted: readonly number[], value: number): number {
  let lo = 0;
  let hi = sorted.length - 1;
  let found = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const v = sorted[mid];
    if (v !== undefined && v <= value) {
      found = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return found;
}

/** 写进 timeline_roots 的根:目录在取 realpath,失败用 path.resolve(同记事件时的写法)。 */
function realRoot(root: string): string {
  try {
    return fs.realpathSync(root);
  } catch {
    return path.resolve(root);
  }
}

class EventMerger implements TimelineMerger {
  readonly mapping: EventIdMapping;
  /** 两边都有的列(除 id),插入用这个顺序 */
  private readonly columns: string[];
  /** 去重比较用的列顺序:ts 在前 */
  private readonly matchColumns: string[];
  private readonly selectUpTo: Statement;
  private readonly selectAfter: Statement;
  private readonly findSame: Statement;
  private readonly insertEvent: Statement;
  /** 旧 id → 新 id(重复的是项目库已有那条的 id) */
  private readonly idMap = new Map<number, number>();
  /** 会话 → 它在旧库里的事件 id 与新 id;处理顺序是 id 升序,oldIds 自然有序 */
  private readonly trails = new Map<string, SessionTrail>();
  /** 会话 → 并之前它在项目库里的最大 id(没有为 null) */
  private readonly projectMaxBefore = new Map<string, number | null>();
  private readonly attribution = new RootAttribution();
  /** 项目库里 git_commit 的 hash → id;第一次遇到旧提交时从头读,之后每个写事务开头补读新写进来的 */
  private commitIds: Map<string, number> | null = null;
  private commitScanId = 0;
  private events = 0;
  private duplicates = 0;

  constructor(
    private readonly oldDb: SqliteDatabase,
    private readonly projectDb: SqliteDatabase,
  ) {
    const oldColumns = new Set(eventColumns(oldDb));
    this.columns = eventColumns(projectDb).filter((c) => oldColumns.has(c));
    for (const required of REQUIRED_COLUMNS) {
      if (!this.columns.includes(required)) {
        throw new TimelineSchemaError(
          `并旧事件:旧库或项目库的 timeline_events 缺 ${required} 列;两边库都先应用 timeline schema 再并`,
        );
      }
    }
    this.matchColumns = ['ts', ...this.columns.filter((c) => c !== 'ts')];
    const cols = this.columns.map(quoteIdent).join(', ');
    this.selectUpTo = oldDb.prepare(
      `SELECT id, ${cols} FROM timeline_events WHERE id > ? AND id <= ? ORDER BY id LIMIT ?`,
    );
    this.selectAfter = oldDb.prepare(`SELECT id, ${cols} FROM timeline_events WHERE id > ? ORDER BY id LIMIT ?`);
    this.findSame = projectDb.prepare(
      `SELECT id FROM timeline_events WHERE ${sameEventWhere(this.matchColumns)} ORDER BY id LIMIT 1`,
    );
    this.insertEvent = projectDb.prepare(
      `INSERT INTO timeline_events (${cols}) VALUES (${placeholders(this.columns.length)})`,
    );

    const oldSessions = oldDb
      .prepare('SELECT DISTINCT session_id FROM timeline_events WHERE session_id IS NOT NULL')
      .all() as Array<{ session_id: string }>;
    this.recordProjectMaxIds(oldSessions.map((r) => r.session_id));

    this.mapping = {
      get: (oldId) => this.idMap.get(oldId),
      mapProgress: (sessionId, oldId) => this.mapProgress(sessionId, oldId),
      projectMaxIdBefore: (sessionId) => this.projectMaxBefore.get(sessionId) ?? null,
    };
  }

  mergeEventsUpTo(upToId: number): void {
    let cursor = 0;
    for (;;) {
      const rows = this.selectUpTo.all(cursor, upToId, MERGE_BATCH_SIZE) as OldEventRow[];
      const last = rows[rows.length - 1];
      if (last === undefined) return;
      this.writeBatch(rows);
      cursor = last.id;
    }
  }

  mergeTail(afterId: number, attributionRoots: readonly string[]): void {
    let cursor = afterId;
    for (;;) {
      const rows = this.selectAfter.all(cursor, MERGE_BATCH_SIZE) as OldEventRow[];
      const last = rows[rows.length - 1];
      if (last === undefined) break;
      this.writeBatch(rows);
      cursor = last.id;
    }
    this.mergeRoots(attributionRoots);
  }

  stats(): TimelineMergeStats {
    return { events: this.events, sessions: this.trails.size, duplicates: this.duplicates };
  }

  /**
   * 进度换算(K12:平台不重报、不漏报):旧值在对照里取对应新 id;不在取这个会话里不大于它的最大旧 id 对应的
   * 新 id(不能取 0,取 0 会全部重报);都没有 → 0。会话在旧库里没有事件(sync 自己的会话 id)→ get(oldId) ?? 0。
   */
  private mapProgress(sessionId: string, oldId: number): number {
    const direct = this.idMap.get(oldId);
    const trail = this.trails.get(sessionId);
    if (trail === undefined || direct !== undefined) return direct ?? 0;
    const i = lastIndexAtMost(trail.oldIds, oldId);
    return i < 0 ? 0 : (trail.newIds[i] ?? 0);
  }

  /** 查项目库这些会话的最大 id,记成「并之前」的值;已记过的不再查。在写入这些会话的事件之前调。 */
  private recordProjectMaxIds(sessionIds: Iterable<string>): void {
    const missing = [...new Set(sessionIds)].filter((id) => !this.projectMaxBefore.has(id));
    for (let i = 0; i < missing.length; i += SESSION_ID_QUERY_BATCH) {
      const batch = missing.slice(i, i + SESSION_ID_QUERY_BATCH);
      for (const id of batch) this.projectMaxBefore.set(id, null);
      const rows = this.projectDb
        .prepare(
          `SELECT session_id, MAX(id) AS max_id FROM timeline_events WHERE session_id IN (${placeholders(batch.length)}) GROUP BY session_id`,
        )
        .all(...batch) as Array<{ session_id: string; max_id: number | bigint }>;
      for (const r of rows) this.projectMaxBefore.set(r.session_id, Number(r.max_id));
    }
  }

  /**
   * 一批旧事件在项目库一个 BEGIN IMMEDIATE 事务里逐条去重或插入;提交成功后才记进对照与统计。
   * 已处理过的旧 id 跳过(两段的范围有重叠时不重复处理)。
   */
  private writeBatch(rows: readonly OldEventRow[]): void {
    const fresh = rows.filter((r) => !this.idMap.has(r.id));
    if (fresh.length === 0) return;
    const merged: MergedRow[] = [];
    this.projectDb.exec('BEGIN IMMEDIATE');
    try {
      // 第一次出现的会话(尾巴里新开的)在写它的事件之前记下并之前的最大 id
      const sessions: string[] = [];
      for (const r of fresh) if (r.session_id !== null) sessions.push(r.session_id);
      this.recordProjectMaxIds(sessions);
      if (fresh.some(isHashedCommit)) this.refreshCommitIds();
      for (const row of fresh) {
        const existing = this.findExisting(row);
        merged.push({ row, newId: existing ?? this.insertRow(row), duplicate: existing !== undefined });
      }
      this.projectDb.exec('COMMIT');
    } catch (err) {
      try { this.projectDb.exec('ROLLBACK'); } catch { /* 事务可能已结束 */ }
      // 回滚掉的插入可能已进了 hash 表:下次从头重读
      this.commitIds = null;
      throw err;
    }
    for (const m of merged) this.remember(m);
  }

  /** 在项目库写事务里调:补读上次以后新写进项目库的 git_commit(第一次从头读);同一 hash 留最早那条的 id。 */
  private refreshCommitIds(): void {
    if (this.commitIds === null) {
      this.commitIds = new Map();
      this.commitScanId = 0;
    }
    // `+event_type`:按主键范围扫新写进来的行,不走类型索引把全部提交再扫一遍
    const rows = this.projectDb
      .prepare(
        "SELECT id, commit_hash FROM timeline_events WHERE id > ? AND +event_type = 'git_commit' AND commit_hash IS NOT NULL ORDER BY id",
      )
      .all(this.commitScanId) as Array<{ id: number | bigint; commit_hash: string }>;
    for (const r of rows) {
      if (!this.commitIds.has(r.commit_hash)) this.commitIds.set(r.commit_hash, Number(r.id));
    }
    this.commitScanId = maxEventId(this.projectDb);
  }

  /** 项目库里已有的同一条事件的 id;没有 → undefined。 */
  private findExisting(row: OldEventRow): number | undefined {
    if (isHashedCommit(row)) return this.commitIds?.get(row.commit_hash);
    const hit = this.findSame.get(...this.matchColumns.map((c) => row[c])) as { id: number | bigint } | undefined;
    return hit === undefined ? undefined : Number(hit.id);
  }

  /** 插入除 id 外的全部列,返回新 id。 */
  private insertRow(row: OldEventRow): number {
    const result = this.insertEvent.run(...this.columns.map((c) => row[c]));
    const id = Number(result.lastInsertRowid);
    if (isHashedCommit(row) && this.commitIds !== null && !this.commitIds.has(row.commit_hash)) {
      this.commitIds.set(row.commit_hash, id);
    }
    return id;
  }

  private remember({ row, newId, duplicate }: MergedRow): void {
    this.idMap.set(row.id, newId);
    this.events += 1;
    if (duplicate) this.duplicates += 1;
    if (row.session_id !== null) {
      let trail = this.trails.get(row.session_id);
      if (trail === undefined) {
        trail = { oldIds: [], newIds: [] };
        this.trails.set(row.session_id, trail);
      }
      trail.oldIds.push(row.id);
      trail.newIds.push(newId);
    }
    this.attribution.add(row);
  }

  /**
   * 并 timeline_roots:候选根 = attributionRoots ∪ 旧库 timeline_roots 的根;处理过的旧事件按会话第一条事件的 cwd、
   * 提交按自己的 cwd 归到候选根(含等于根),该根的最早、最近活动取归到它的事件 ts 的最小、最大;旧库已有的行一并取
   * 较早的 first_ts、较晚的 last_ts;按 realpath 合成一行,upsert 进项目库。
   */
  private mergeRoots(attributionRoots: readonly string[]): void {
    const oldRoots = readRootRows(this.oldDb);
    const candidates = [...attributionRoots, ...oldRoots.map((r) => r.root)];
    const byRoot = new Map<string, RootTally>();
    if (candidates.length > 0) {
      for (const [root, t] of this.attribution.attribute(createRootMatcher(candidates))) {
        addTally(byRoot, realRoot(root), t.firstTs, t.lastTs, t.events);
      }
    }
    for (const r of oldRoots) addTally(byRoot, realRoot(r.root), r.firstTs, r.lastTs, 0);
    if (byRoot.size === 0) return;
    this.projectDb.exec('BEGIN IMMEDIATE');
    try {
      const upsert = this.projectDb.prepare(UPSERT_ROOT_SQL);
      for (const [root, t] of byRoot) upsert.run(root, t.firstTs, t.lastTs);
      this.projectDb.exec('COMMIT');
    } catch (err) {
      try { this.projectDb.exec('ROLLBACK'); } catch { /* 事务可能已结束 */ }
      throw err;
    }
  }
}
