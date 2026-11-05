/**
 * timeline 记下的根(spec:2026-11-05-数据按项目放用户目录 D10、D11、D19、D32、D33)
 *
 * - 项目在本机出现过的根:数据位置那份库的 timeline_roots(hook 每记一条事件 upsert 一次)
 * - 按数据目录的汇总:列出、删除项目时显示的事件数、会话数和根
 * - 受影响的根下的事件数:改名后提示「之前记的 N 条还在 <旧显示名> 下」
 *
 * 全部只读:不应用 schema、不建目录、不写表。旧库可能还没被新版写过,读表前先查 sqlite_master,表不在按空。
 * 归根(会话按第一条事件的 cwd、提交按自己的 cwd)由 RootAttribution 累计,并旧事件的合并器也用它。
 */

import * as fs from 'node:fs';
import * as path from 'node:path';

import { DATABASE_FILENAME, DatabaseConnection, type SqliteDatabase } from '../db';
import { createRootMatcher, type RootMatcher } from '../root-match';
import { StoreQueryError } from './errors';
import { openTimelineDbForRead } from './schema-bootstrap';
import type { TimelineDataSummary, TimelineRoot } from './types';

export const EVENTS_TABLE = 'timeline_events';
export const ROOTS_TABLE = 'timeline_roots';

/** 库里有没有这张表(只查 sqlite_master,不碰表本身)。 */
export function hasTable(db: SqliteDatabase, name: string): boolean {
  return db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ? LIMIT 1").get(name) !== undefined;
}

interface RootRow {
  root: string;
  first_ts: string;
  last_ts: string;
}

/** 这份库的 timeline_roots,按 lastTs 降序(同一时间按根排);表不在 → []。 */
export function readRootRows(db: SqliteDatabase): TimelineRoot[] {
  if (!hasTable(db, ROOTS_TABLE)) return [];
  const rows = db
    .prepare('SELECT root, first_ts, last_ts FROM timeline_roots ORDER BY last_ts DESC, root ASC')
    .all() as RootRow[];
  return rows.map((r) => ({ root: r.root, firstTs: r.first_ts, lastTs: r.last_ts }));
}

/**
 * spec D10、D11:数据位置那份库记下的根,按 lastTs 降序。打开失败(库不在、认不出项目)、表不在、查询出错 → []。
 * 同步函数:task 的 Stop hook 每轮经它取根列表,只查 sqlite_master 和 timeline_roots,不扫事件表。
 */
export function listTimelineRoots(start: string): TimelineRoot[] {
  try {
    const conn = openTimelineDbForRead(start);
    try {
      return readRootRows(conn.getDb());
    } finally {
      conn.close();
    }
  } catch {
    // 根列表只用来换算路径:读不出来按没有记下的根,调用方退回当前根
    return [];
  }
}

/** 按数据目录打开 `<dataDir>/cgraphx.db` 读(不应用 schema);库文件不在 → null。 */
function readDbFile<T>(dataDir: string, read: (db: SqliteDatabase) => T): T | null {
  const dbPath = path.join(dataDir, DATABASE_FILENAME);
  if (!fs.existsSync(dbPath)) return null;
  const conn = DatabaseConnection.open(dbPath);
  try {
    return read(conn.getDb());
  } finally {
    conn.close();
  }
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** spec D32、D33:按目录只读打开 `<dataDir>/cgraphx.db` 汇总 timeline;库不在 → null;表不在按 0 和空。 */
export function readTimelineSummary(dataDir: string): TimelineDataSummary | null {
  try {
    return readDbFile(dataDir, (db) => {
      const roots = readRootRows(db);
      if (!hasTable(db, EVENTS_TABLE)) return { events: 0, sessions: 0, roots };
      const row = db
        .prepare('SELECT COUNT(*) AS events, COUNT(DISTINCT session_id) AS sessions FROM timeline_events')
        .get() as { events: number; sessions: number };
      return { events: Number(row.events), sessions: Number(row.sessions), roots };
    });
  } catch (err) {
    throw new StoreQueryError(`读 ${dataDir} 的 timeline 汇总失败:${errorMessage(err)}`);
  }
}

/**
 * spec D19:受影响的根下记的事件数(改名提示里的 N)。会话按第一条事件(ts 最早,同 ts 按 id)的 cwd、提交按自己的
 * cwd 归根(见 RootAttribution),落在任一根下(含等于根)的都算;库不在、表不在 → 0。
 */
export function countEventsUnderRoots(dataDir: string, roots: readonly string[]): number {
  if (roots.length === 0) return 0;
  try {
    const counted = readDbFile(dataDir, (db) => {
      if (!hasTable(db, EVENTS_TABLE)) return 0;
      const tally = new RootAttribution();
      const rows = db
        .prepare('SELECT id, ts, session_id, event_type, cwd FROM timeline_events')
        .iterate() as IterableIterator<AttributionRow>;
      for (const row of rows) tally.add(row);
      let total = 0;
      for (const t of tally.attribute(createRootMatcher(roots)).values()) total += t.events;
      return total;
    });
    return counted ?? 0;
  } catch (err) {
    throw new StoreQueryError(`数 ${dataDir} 里这些目录下的事件失败:${errorMessage(err)}`);
  }
}

// ─── 归根 ─────────────────────────────────────────────────────────────────

/** 归根用到的事件列。 */
export interface AttributionRow {
  id: number;
  ts: string;
  session_id: string | null;
  event_type: string;
  cwd: string;
}

/** 归到一个根的事件:最早、最近一次活动的时间,以及条数。 */
export interface RootTally {
  firstTs: string;
  lastTs: string;
  events: number;
}

interface SessionTally {
  firstTs: string;
  firstId: number;
  firstCwd: string;
  lastTs: string;
  events: number;
}

/** 把一段活动并进 key 的汇总:最早取较早的、最近取较晚的,条数相加。 */
export function addTally(map: Map<string, RootTally>, key: string, firstTs: string, lastTs: string, events: number): void {
  const cur = map.get(key);
  if (cur === undefined) {
    map.set(key, { firstTs, lastTs, events });
    return;
  }
  if (firstTs < cur.firstTs) cur.firstTs = firstTs;
  if (lastTs > cur.lastTs) cur.lastTs = lastTs;
  cur.events += events;
}

/**
 * 归根累计(spec D19、D28):有会话 id 的事件按会话第一条事件(ts 最早,同 ts 按 id)的 cwd 归根——会话 cd 到哪都
 * 记在开始的地方;git_commit 按自己的 cwd(提交所在的工作区根),带会话 id 的也一样;没有会话 id 的事件(payload
 * 没给会话 id)按自己的 cwd。事件按任意顺序 add,最后 attribute;只累计每个会话、每个 cwd 的汇总,不留整行。
 */
export class RootAttribution {
  private readonly sessions = new Map<string, SessionTally>();
  private readonly byCwd = new Map<string, RootTally>();

  add(row: AttributionRow): void {
    if (row.event_type === 'git_commit' || row.session_id === null) {
      addTally(this.byCwd, row.cwd, row.ts, row.ts, 1);
      return;
    }
    const s = this.sessions.get(row.session_id);
    if (s === undefined) {
      this.sessions.set(row.session_id, {
        firstTs: row.ts,
        firstId: row.id,
        firstCwd: row.cwd,
        lastTs: row.ts,
        events: 1,
      });
      return;
    }
    if (row.ts < s.firstTs || (row.ts === s.firstTs && row.id < s.firstId)) {
      s.firstTs = row.ts;
      s.firstId = row.id;
      s.firstCwd = row.cwd;
    }
    if (row.ts > s.lastTs) s.lastTs = row.ts;
    s.events += 1;
  }

  /** 按根汇总,键是 matcher 返回的根;根等于 cwd 也算落上;一个根都没落上的事件不出现。 */
  attribute(matcher: RootMatcher): Map<string, RootTally> {
    const out = new Map<string, RootTally>();
    for (const s of this.sessions.values()) {
      const hit = matcher.match(s.firstCwd, { allowSelf: true });
      if (hit !== null) addTally(out, hit.root, s.firstTs, s.lastTs, s.events);
    }
    for (const [cwd, t] of this.byCwd) {
      const hit = matcher.match(cwd, { allowSelf: true });
      if (hit !== null) addTally(out, hit.root, t.firstTs, t.lastTs, t.events);
    }
    return out;
  }
}
