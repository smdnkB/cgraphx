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
 * Apply the timeline schema to an open DB handle.
 *
 * Idempotent: safe to call on every hook trigger. The SQL is composed entirely
 * of `CREATE ... IF NOT EXISTS` + a single version-row `INSERT OR IGNORE`.
 *
 * @throws TimelineSchemaError if a recorded version is *newer* than what this
 *   build supports (would happen when a newer cgraphx wrote the schema and
 *   an older one tried to read it).
 */
export function ensureTimelineSchema(db: SqliteDatabase): void {
  const schemaPath = resolveSchemaPath();
  const sql = fs.readFileSync(schemaPath, 'utf-8');
  db.exec(sql);

  const current = getCurrentTimelineSchemaVersion(db);
  if (current > TIMELINE_SCHEMA_VERSION) {
    throw new TimelineSchemaError(
      `Timeline schema version ${current} is newer than this build supports ` +
        `(${TIMELINE_SCHEMA_VERSION}). Upgrade cgraphx.`,
      { current, supported: TIMELINE_SCHEMA_VERSION },
    );
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
