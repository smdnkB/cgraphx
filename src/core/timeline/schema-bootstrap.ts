/**
 * timeline 子系统的 schema 应用与库的打开。
 *
 * 写法同 markdown 的 schema-bootstrap:
 *   1. 读与编译产物放在一起的 `schema.sql`
 *   2. 应用它(幂等,每条语句都是 IF NOT EXISTS)
 *   3. 版本记在 `timeline_schema_versions`
 *
 * 库放在数据位置(基础层 data-location.ts):还没并过的旧库是项目本地的 `.cgraphx/cgraphx.db`,其余是用户目录里
 * 这个项目的目录(`~/.cgraphx/projects/<目录名>/cgraphx.db`),只放 timeline 的前缀表。
 * 写的一方(openTimelineDb、recorder)经 ensureDataDir 定位置,要建就建;读的一方(openTimelineDbForRead)只读,
 * 库不在就报错,不建目录、不应用 schema。
 */

import fs from 'node:fs';
import path from 'node:path';

import {
  DatabaseConnection,
  DATABASE_FILENAME,
  getDatabasePath,
  type SqliteDatabase,
} from '../db';
import { ensureDataDir, locateData, missingDataMessage } from '../data-location';
import { TimelineSchemaError } from './errors';
import { TIMELINE_SCHEMA_VERSION } from './constants';
import { classifyAutoMessage, type AutoMessageSource } from './auto-message';
import { DEFAULT_AGENT_ID } from '../agents';

/** Resolve schema.sql path — works in both dist/ and src/ layouts. */
function resolveSchemaPath(): string {
  return path.join(__dirname, 'schema.sql');
}

/** Read the recorded timeline schema version from the DB, or 0 if none. */
export function getCurrentTimelineSchemaVersion(db: SqliteDatabase): number {
  const row = db
    .prepare(
      'SELECT version FROM timeline_schema_versions ORDER BY version DESC LIMIT 1',
    )
    .get() as { version: number } | undefined;
  return row?.version ?? 0;
}

/**
 * 在已打开的连接上应用 timeline schema,每次 hook 触发都会调用(幂等)。
 *
 * 先执行全幂等的 schema.sql,再为旧库补 agent 列(见 ensureAgentColumn)。
 *
 * @throws TimelineSchemaError 库中记录的版本高于本构建支持的版本
 *   (新版 cgraphx 写过的库被旧版打开)。
 */
export function ensureTimelineSchema(db: SqliteDatabase): void {
  const schemaPath = resolveSchemaPath();
  const sql = fs.readFileSync(schemaPath, 'utf-8');
  db.exec(sql);
  ensureAgentColumn(db);
  try {
    ensureAutoMessageMigration(db);
  } catch (err) {
    // 存量改记是增强项:失败不阻塞事件记录;水位没动,下次打开再扫。
    process.stderr.write(
      `[timeline] auto_message 迁移失败:${err instanceof Error ? err.message : String(err)}\n`,
    );
  }

  const current = getCurrentTimelineSchemaVersion(db);
  if (current > TIMELINE_SCHEMA_VERSION) {
    throw new TimelineSchemaError(
      `Timeline schema version ${current} is newer than this build supports ` +
        `(${TIMELINE_SCHEMA_VERSION}). Upgrade cgraphx.`,
      { current, supported: TIMELINE_SCHEMA_VERSION },
    );
  }
}

/** timeline_events 是否已有 agent 列(一次 PRAGMA 查询,不扫表)。 */
function hasAgentColumn(db: SqliteDatabase): boolean {
  const cols = db.prepare('PRAGMA table_info(timeline_events)').all() as Array<{ name: string }>;
  return cols.some((c) => c.name === 'agent');
}

/**
 * 旧库(版本 1)补 agent 列并把存量行回填为默认 agent(Claude Code)。
 *
 * 快路径:已有列直接返回。慢路径在 BEGIN IMMEDIATE 写事务内二次确认后补列 + 回填,
 * 多个 hook 进程并发打开旧库时只有一个真正执行;另一进程抢先补列导致的
 * `duplicate column name` 视为成功。其它错误照常抛出,由 hook 层吞掉。
 */
function ensureAgentColumn(db: SqliteDatabase): void {
  if (hasAgentColumn(db)) return;
  try {
    db.exec('BEGIN IMMEDIATE');
    try {
      if (!hasAgentColumn(db)) {
        db.exec('ALTER TABLE timeline_events ADD COLUMN agent TEXT');
        db.exec(`UPDATE timeline_events SET agent = '${DEFAULT_AGENT_ID}'`);
      }
      db.exec('COMMIT');
    } catch (err) {
      try { db.exec('ROLLBACK'); } catch { /* 事务可能已结束 */ }
      throw err;
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes('duplicate column name')) return;
    throw err;
  }
}

// ─── 存量自动消息改记(2026-10-31)────────────────────────────────────────

/** timeline_meta 里记扫描水位的键。 */
const AUTO_MESSAGE_SCAN_KEY = 'auto_message_scan_id';

/** 一批扫描的行数:一行 prompt_text 最大 64KB,分批读,不一次拉全表。 */
const AUTO_MESSAGE_SCAN_BATCH = 500;

interface AutoMessageScanRow {
  id: number;
  prompt_text: string | null;
  metadata: string | null;
}

/** 库里最大的事件 id;空表为 0。 */
function maxTimelineEventId(db: SqliteDatabase): number {
  const row = db.prepare('SELECT COALESCE(MAX(id), 0) AS id FROM timeline_events').get() as { id: number | bigint };
  return Number(row.id);
}

/** 已扫描到的水位;没记过为 0(从头扫)。 */
function readAutoMessageScanId(db: SqliteDatabase): number {
  const row = db
    .prepare('SELECT value FROM timeline_meta WHERE key = ?')
    .get(AUTO_MESSAGE_SCAN_KEY) as { value: string } | undefined;
  const n = row === undefined ? 0 : Number(row.value);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

function writeAutoMessageScanId(db: SqliteDatabase, id: number): void {
  db.prepare('INSERT OR REPLACE INTO timeline_meta (key, value) VALUES (?, ?)')
    .run(AUTO_MESSAGE_SCAN_KEY, String(id));
}

/** 原 metadata 的其它键保留,补上 source;旧行的 metadata 一般为空。 */
function metadataWithSource(raw: string | null, source: AutoMessageSource): string {
  let meta: Record<string, unknown> = {};
  if (raw !== null) {
    try {
      const parsed: unknown = JSON.parse(raw);
      if (parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)) {
        meta = parsed as Record<string, unknown>;
      }
    } catch {
      // 坏 JSON 当空的处理,不影响改记
    }
  }
  meta.source = source;
  return JSON.stringify(meta);
}

/**
 * 把旧版本记成 user_prompt 的自动消息改记为 auto_message(spec 2026-10-31)。
 *
 * 每次打开库都会调用,所以按 timeline_meta 里的水位只扫新出现的行:本机全局 cgraphx
 * 若比本构建旧,它写进来的自动消息仍是 user_prompt,等新版打开库时再改。水位到表尾后
 * 只剩一条 MAX(id) 查询。不升 schema 版本号——升了旧版全局 cgraphx 打开库会报错,
 * hook 就不再记录(这是本需求锁定的取舍)。
 *
 * BEGIN IMMEDIATE:多个 hook 进程并发打开时只有一个真正扫描,另一个拿到锁后重读水位
 * 直接跳过(写法同 ensureAgentColumn)。扫描期间持写锁,其它写入排队,拿到的是稳定快照。
 */
function ensureAutoMessageMigration(db: SqliteDatabase): void {
  if (maxTimelineEventId(db) === readAutoMessageScanId(db)) return;
  db.exec('BEGIN IMMEDIATE');
  try {
    const stored = readAutoMessageScanId(db);
    const maxId = maxTimelineEventId(db);
    if (maxId === stored) {
      // 并发的另一个进程拿到锁前已扫完
      db.exec('COMMIT');
      return;
    }
    // 水位比表尾还大:旧版 `timeline uninstall --purge` 删了 events 表、不认识 timeline_meta,
    // id 从头开始 —— 从头重扫。
    const scanId = stored > maxId ? 0 : stored;
    if (maxId > scanId) reclassifyAutoMessages(db, scanId);
    writeAutoMessageScanId(db, maxId);
    db.exec('COMMIT');
  } catch (err) {
    try { db.exec('ROLLBACK'); } catch { /* 事务可能已结束 */ }
    throw err;
  }
}

/** 从 scanId 往后逐批扫 user_prompt 行,文本开头命中的改成 auto_message。 */
function reclassifyAutoMessages(db: SqliteDatabase, scanId: number): void {
  const select = db.prepare(
    `SELECT id, prompt_text, metadata FROM timeline_events
     WHERE id > ? AND event_type = 'user_prompt'
     ORDER BY id LIMIT ?`,
  );
  const update = db.prepare(
    "UPDATE timeline_events SET event_type = 'auto_message', metadata = ? WHERE id = ?",
  );
  let cursor = scanId;
  for (;;) {
    const rows = select.all(cursor, AUTO_MESSAGE_SCAN_BATCH) as AutoMessageScanRow[];
    const last = rows[rows.length - 1];
    if (last === undefined) return;
    for (const row of rows) {
      const source = row.prompt_text !== null ? classifyAutoMessage(row.prompt_text) : null;
      if (source !== null) update.run(metadataWithSource(row.metadata, source), row.id);
    }
    cursor = last.id;
  }
}

/**
 * 拿不到库时的错误:原因和修法取自数据位置(missingDataMessage)。数据目录在而库文件还没建(项目目录建好、还没
 * 记过事件)时数据位置不报原因,按「还没有数据」说。
 */
function missingDatabaseError(start: string): TimelineSchemaError {
  const loc = locateData(start);
  const message = missingDataMessage(loc.unavailable === null ? { ...loc, unavailable: 'not-created' as const } : loc);
  return new TimelineSchemaError(message, { projectRoot: path.resolve(start) });
}

/**
 * 写的一方打开 timeline 库:按起点经 ensureDataDir 定数据位置(要建就建),打开那里的 `cgraphx.db` 并应用 schema。
 *
 * 用 `DatabaseConnection.open`,沿用基础层的 WAL、busy_timeout。返回的连接由调用方关闭。
 *
 * @throws TimelineSchemaError 拿不到数据位置(没有根、认不出项目、git 跑不起来、没装过而项目库不在),或 schema
 *   版本比本构建新;hook 层捕获后以 0 退出,不阻塞宿主。
 */
export function openTimelineDb(start: string): DatabaseConnection {
  const dir = ensureDataDir(start);
  if (dir === null) throw missingDatabaseError(start);
  const connection = DatabaseConnection.open(path.join(dir, DATABASE_FILENAME));
  try {
    ensureTimelineSchema(connection.getDb());
  } catch (err) {
    connection.close();
    throw err;
  }
  return connection;
}

/**
 * 读的一方打开 timeline 库:按起点取数据位置的库(getDatabasePath),库文件不在就报错。只读:不建目录、不应用
 * schema、不写表。返回的连接由调用方关闭。
 *
 * @throws TimelineSchemaError 数据位置拿不到,或那里还没有库文件
 */
export function openTimelineDbForRead(start: string): DatabaseConnection {
  const dbPath = getDatabasePath(start);
  if (dbPath === null || !fs.existsSync(dbPath)) throw missingDatabaseError(start);
  return DatabaseConnection.open(dbPath);
}

export { TIMELINE_SCHEMA_VERSION };
