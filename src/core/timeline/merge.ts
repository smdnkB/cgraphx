/**
 * 并旧数据(spec:2026-11-05-数据按项目放用户目录 D27、D28 timeline 部分;
 * 2026-11-06-会话文件解析替代hooks D20、K24)
 *
 * 把目录本地旧库的 timeline_events 并进用户目录里的项目库,由 project 子系统编排,分两段(D27):
 * ① mergeEventsUpTo:不加锁,旧库 id ≤ 上限的提交记录按 id 升序分批写进项目库,每批一个项目库写事务;
 * ② mergeTail:调用方已持旧库写锁,并剩下的尾巴(id > afterId),再把归到各根的活动并进项目库 timeline_roots。
 *
 * 只并提交记录与 timeline_roots(D20):hook 记的事件升级后按会话文件全量重建(F6,ingest/rebuild.ts),
 * 并进来就是白并——项目重建过之后,另一个目录再 install 也不会把旧事件带回来。id 对照与进度换算
 * 已随「只并提交」删掉,没有消费方。
 *
 * 去重(D28):git_commit 只比 commit_hash,项目库里已有同 hash 的就算重复,不再写(同一仓库多个目录
 * 各自的旧库记着同样的提交);没有 hash 的提交记录按除 id 外各列比(NULL 用 IS 比)。重复的条数进统计。
 *
 * 不改旧库:只查询,不碰它的事务。timeline_meta、timeline_schema_versions 不并。两边库都由调用方先应用过 schema。
 */

import * as fs from 'node:fs';
import * as path from 'node:path';

import type { SqliteDatabase } from '../db';
import { createRootMatcher } from '../root-match';
import { TimelineSchemaError } from './errors';
import { addTally, EVENTS_TABLE, hasTable, readRootRows, RootAttribution, type RootTally } from './roots';
import type { TimelineMergeStats, TimelineMerger } from './types';

type Statement = ReturnType<SqliteDatabase['prepare']>;

/** 一批读、写的旧提交条数:每批一个项目库写事务,不长时间占着项目库的写锁。 */
const MERGE_BATCH_SIZE = 500;

/** 去重、归根要用到的列;两边库应用过 timeline schema 就都有。 */
const REQUIRED_COLUMNS = ['ts', 'session_id', 'event_type', 'cwd', 'commit_hash'] as const;

/** 写项目库 timeline_roots:冲突时最早取较早的、最近取较晚的(同记事件时的 upsert)。 */
const UPSERT_ROOT_SQL =
  'INSERT INTO timeline_roots (root, first_ts, last_ts) VALUES (?, ?, ?) ' +
  'ON CONFLICT(root) DO UPDATE SET first_ts = min(first_ts, excluded.first_ts), last_ts = max(last_ts, excluded.last_ts)';

/** 从旧库读出的一行提交记录:id 加上两边都有的列。 */
interface OldEventRow {
  id: number;
  ts: string;
  session_id: string | null;
  event_type: string;
  cwd: string;
  commit_hash: string | null;
  [column: string]: unknown;
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
 * 建并旧数据的合并器(只并提交记录与 timeline_roots,D20)。调用方已对两边库应用过 timeline schema;
 * 合并器不改旧库。
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
 * 「同一条提交记录」的条件,列按 columns 的顺序:ts = ? 放第一个、走 timeline_events_ts_idx;其余列 NULL 用
 * IS 比,并加一元 `+`,不让查询计划改走会话、类型、工具、轮次的索引(一个会话的事件成千上万,同一毫秒的只有几条)。
 */
function sameEventWhere(columns: readonly string[]): string {
  return columns.map((c) => (c === 'ts' ? `${quoteIdent(c)} = ?` : `+${quoteIdent(c)} IS ?`)).join(' AND ');
}

function isHashedCommit(row: OldEventRow): row is OldEventRow & { commit_hash: string } {
  return row.event_type === 'git_commit' && typeof row.commit_hash === 'string';
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
  /** 两边都有的列(除 id),插入用这个顺序 */
  private readonly columns: string[];
  /** 去重比较用的列顺序:ts 在前 */
  private readonly matchColumns: string[];
  private readonly selectUpTo: Statement;
  private readonly selectAfter: Statement;
  private readonly findSame: Statement;
  private readonly insertEvent: Statement;
  /** 已处理过的旧事件 id(两段的范围有重叠时不重复处理) */
  private readonly processedIds = new Set<number>();
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
          `并旧数据:旧库或项目库的 timeline_events 缺 ${required} 列;两边库都先应用 timeline schema 再并`,
        );
      }
    }
    this.matchColumns = ['ts', ...this.columns.filter((c) => c !== 'ts')];
    const cols = this.columns.map(quoteIdent).join(', ');
    // 只并提交记录(D20):其余事件升级后按会话文件全量重建,不并
    this.selectUpTo = oldDb.prepare(
      `SELECT id, ${cols} FROM timeline_events WHERE event_type = 'git_commit' AND id > ? AND id <= ? ORDER BY id LIMIT ?`,
    );
    this.selectAfter = oldDb.prepare(
      `SELECT id, ${cols} FROM timeline_events WHERE event_type = 'git_commit' AND id > ? ORDER BY id LIMIT ?`,
    );
    this.findSame = projectDb.prepare(
      `SELECT id FROM timeline_events WHERE ${sameEventWhere(this.matchColumns)} ORDER BY id LIMIT 1`,
    );
    this.insertEvent = projectDb.prepare(
      `INSERT INTO timeline_events (${cols}) VALUES (${placeholders(this.columns.length)})`,
    );
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
    return { events: this.events, duplicates: this.duplicates };
  }

  /**
   * 一批旧提交在项目库一个 BEGIN IMMEDIATE 事务里逐条去重或插入;提交成功后才记进统计。
   * 已处理过的旧 id 跳过(两段的范围有重叠时不重复处理)。
   */
  private writeBatch(rows: readonly OldEventRow[]): void {
    const fresh = rows.filter((r) => !this.processedIds.has(r.id));
    if (fresh.length === 0) return;
    let duplicates = 0;
    this.projectDb.exec('BEGIN IMMEDIATE');
    try {
      if (fresh.some(isHashedCommit)) this.refreshCommitIds();
      for (const row of fresh) {
        if (this.findExisting(row) === undefined) this.insertRow(row);
        else duplicates += 1;
      }
      this.projectDb.exec('COMMIT');
    } catch (err) {
      try { this.projectDb.exec('ROLLBACK'); } catch { /* 事务可能已结束 */ }
      // 回滚掉的插入可能已进了 hash 表:下次从头重读
      this.commitIds = null;
      throw err;
    }
    for (const row of fresh) {
      this.processedIds.add(row.id);
      this.attribution.add(row);
    }
    this.events += fresh.length;
    this.duplicates += duplicates;
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

  /** 项目库里已有的同一条提交记录的 id;没有 → undefined。 */
  private findExisting(row: OldEventRow): number | undefined {
    if (isHashedCommit(row)) return this.commitIds?.get(row.commit_hash);
    // 没有 hash 的提交记录(正常不会出现):按除 id 外各列比
    const hit = this.findSame.get(...this.matchColumns.map((c) => row[c])) as { id: number | bigint } | undefined;
    return hit === undefined ? undefined : Number(hit.id);
  }

  /** 插入除 id 外的全部列,返回新 id,顺手补进 hash 表。 */
  private insertRow(row: OldEventRow): number {
    const result = this.insertEvent.run(...this.columns.map((c) => row[c]));
    const id = Number(result.lastInsertRowid);
    if (isHashedCommit(row) && this.commitIds !== null && !this.commitIds.has(row.commit_hash)) {
      this.commitIds.set(row.commit_hash, id);
    }
    return id;
  }

  /**
   * 并 timeline_roots:候选根 = attributionRoots ∪ 旧库 timeline_roots 的根;处理过的旧提交按自己的 cwd
   * 归到候选根(含等于根),该根的最早、最近活动取归到它的提交 ts 的最小、最大;旧库已有的行一并取
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
