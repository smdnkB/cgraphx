/**
 * Markdown subsystem schema bootstrap.
 *
 * Owns the lifecycle of the markdown tables inside the shared cgraphx DB:
 *   1. Read `schema.sql` shipped alongside the compiled JS.
 *   2. Apply it (idempotent — every statement uses IF NOT EXISTS).
 *   3. Track applied version in `markdown_schema_versions`.
 *
 * The shared `.cgraphx/cgraphx.db` file is reused (no separate DB file),
 * but tables are strictly isolated by the `markdown_` prefix and never read
 * or written by the (now-removed) code-graph layer.
 */

import fs from 'node:fs';
import path from 'node:path';

import {
  DatabaseConnection,
  getDatabasePath,
  type SqliteDatabase,
} from '../db';
import { ProjectNotInitializedError, SchemaMismatchError } from './errors';

const CURRENT_MARKDOWN_SCHEMA_VERSION = 2;

/**
 * Locate `schema.sql` next to the compiled module.
 *
 * Resolves correctly both under `dist/core/markdown/schema.sql` (production,
 * copied by `npm run copy-assets`) and `src/core/markdown/schema.sql` (when
 * run under tsx/vitest without a build).
 */
function resolveSchemaPath(): string {
  return path.join(__dirname, 'schema.sql');
}

/** Read the current markdown schema version recorded in the DB, or 0 if none. */
export function getCurrentMarkdownSchemaVersion(db: SqliteDatabase): number {
  const row = db
    .prepare(
      'SELECT version FROM markdown_schema_versions ORDER BY version DESC LIMIT 1',
    )
    .get() as { version: number } | undefined;
  return row?.version ?? 0;
}

/**
 * Apply the markdown schema to a DB handle.
 *
 * Idempotent: safe to call on every docs command. The SQL is composed entirely
 * of `CREATE ... IF NOT EXISTS` + a single version-row `INSERT OR IGNORE`.
 *
 * @throws SchemaMismatchError if a recorded version is *newer* than what this
 *   build of the subsystem supports (would happen when a newer cgraphx wrote
 *   the schema and an older one tried to read it).
 */
export function ensureMarkdownSchema(db: SqliteDatabase): void {
  const schemaPath = resolveSchemaPath();
  const sql = fs.readFileSync(schemaPath, 'utf-8');
  db.exec(sql);

  const current = getCurrentMarkdownSchemaVersion(db);
  if (current > CURRENT_MARKDOWN_SCHEMA_VERSION) {
    throw new SchemaMismatchError(CURRENT_MARKDOWN_SCHEMA_VERSION, current);
  }
}

/**
 * Open the shared cgraphx DB for markdown-subsystem use and ensure the
 * markdown schema is applied.
 *
 * Re-uses `DatabaseConnection.open` so WAL/foreign_keys/busy_timeout settings
 * from the main DB layer apply. The returned connection is the caller's
 * responsibility — close it when done with `connection.close()`.
 *
 * @throws ProjectNotInitializedError if `<projectRoot>/.cgraphx/cgraphx.db`
 *   does not exist (i.e. `cgraphx init` was never run).
 */
export function openMarkdownDb(projectRoot: string): DatabaseConnection {
  const resolved = path.resolve(projectRoot);
  const dbPath = getDatabasePath(resolved);

  if (!fs.existsSync(dbPath)) {
    throw new ProjectNotInitializedError(resolved);
  }

  const connection = DatabaseConnection.open(dbPath);
  ensureMarkdownSchema(connection.getDb());
  return connection;
}

export const MARKDOWN_SCHEMA_VERSION = CURRENT_MARKDOWN_SCHEMA_VERSION;
