/**
 * Timeline subsystem schema bootstrap.
 *
 * Pattern mirrors src/markdown/schema-bootstrap.ts:
 *   1. Read `schema.sql` shipped alongside the compiled JS.
 *   2. Apply it (idempotent — every statement uses IF NOT EXISTS).
 *   3. Track applied version in `timeline_schema_versions`.
 *
 * The shared `.cgraphx/cgraphx.db` file is reused (no separate DB file),
 * but tables are strictly isolated by the `timeline_` prefix and never read
 * or written by the (now-removed) code-graph layer.
 */

import fs from 'node:fs';
import path from 'node:path';

import {
  DatabaseConnection,
  getDatabasePath,
  type SqliteDatabase,
} from '../db';
import { TimelineSchemaError } from './errors';
import { TIMELINE_SCHEMA_VERSION } from './constants';

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
 * 旧库(版本 1)补 agent 列并把存量行回填为 'claude-code'。
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
        db.exec("UPDATE timeline_events SET agent = 'claude-code'");
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

/**
 * Open the shared cgraphx DB for timeline-subsystem use and ensure the
 * timeline schema is applied.
 *
 * Re-uses `DatabaseConnection.open` so WAL / busy_timeout from the main DB
 * layer apply. The returned connection is the caller's responsibility — close
 * it when done with `connection.close()`.
 *
 * @throws TimelineSchemaError if `<projectRoot>/.cgraphx/cgraphx.db` does
 *   not exist (project not initialized) — the caller (hook layer) catches
 *   and exits 0 so Claude is never blocked.
 */
export function openTimelineDb(projectRoot: string): DatabaseConnection {
  const resolved = path.resolve(projectRoot);
  const dbPath = getDatabasePath(resolved);

  if (!fs.existsSync(dbPath)) {
    throw new TimelineSchemaError(
      `Cgraphx not initialized at ${resolved} — run \`cgraphx install\` first.`,
      { projectRoot: resolved },
    );
  }

  const connection = DatabaseConnection.open(dbPath);
  ensureTimelineSchema(connection.getDb());
  return connection;
}

export { TIMELINE_SCHEMA_VERSION };
