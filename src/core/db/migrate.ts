/**
 * One-time data migrations for the shared `.cgraphx/cgraphx.db`.
 *
 * 2.0 removed the code-graph layer that gave cgraphx its 1.x name. Projects
 * initialized under 1.x still carry the graph tables — now orphaned, and often
 * large: `nodes` / `edges` / `files` / `unresolved_refs`, the `nodes_fts` FTS5
 * index (and its shadow tables), plus the graph layer's `project_metadata` and
 * bare `schema_versions`. `dropLegacyGraphTables` removes exactly those,
 * preserving the 2.0 `markdown_*` / `timeline_*` data (2.0 versioning uses the
 * prefixed `markdown_schema_versions` / `timeline_schema_versions`, never the
 * bare `schema_versions`).
 */

import * as fs from 'fs';
import { DatabaseConnection, getDatabasePath } from './index';

/**
 * The 1.x code-graph tables, orphaned by the 2.0 rebuild (from the removed
 * `src/db/schema.sql`). `nodes_fts` is an FTS5 virtual table — listed FIRST so
 * it's dropped before its content table (`nodes`); DROP TABLE on it cascades to
 * its shadow tables (nodes_fts_data / _idx / _content / _docsize / _config).
 */
const LEGACY_GRAPH_TABLES = [
  'nodes_fts',
  'nodes',
  'edges',
  'files',
  'unresolved_refs',
  'project_metadata',
  'schema_versions',
] as const;

export interface LegacyGraphCleanup {
  /** Graph tables that actually existed and were dropped. */
  dropped: string[];
}

/**
 * Drop the orphaned 1.x code-graph tables from a project's `.cgraphx/cgraphx.db`.
 *
 * Idempotent and cheap — a no-op once the tables are gone, and a no-op for
 * projects 2.0 created (they never had them). Only the known graph table names
 * are ever dropped (never a blanket "drop everything non-2.0"), so current and
 * future `markdown_*` / `timeline_*` / subsystem tables are safe.
 *
 * @returns The graph tables that were present and dropped (empty when none,
 *          or when the project has no `.cgraphx/cgraphx.db` yet).
 */
export function dropLegacyGraphTables(projectRoot: string): LegacyGraphCleanup {
  const dbPath = getDatabasePath(projectRoot);
  if (!fs.existsSync(dbPath)) return { dropped: [] };

  const conn = DatabaseConnection.open(dbPath);
  try {
    const db = conn.getDb();
    const dropped: string[] = [];
    for (const table of LEGACY_GRAPH_TABLES) {
      // `table` comes from the fixed LEGACY_GRAPH_TABLES const — safe to inline
      // (no user input, no injection surface).
      const row = db.prepare(
        `SELECT name FROM sqlite_master WHERE type = 'table' AND name = '${table}'`,
      ).get() as { name: string } | undefined;
      if (row) {
        db.prepare(`DROP TABLE "${table}"`).run();
        dropped.push(table);
      }
    }
    return { dropped };
  } finally {
    conn.close();
  }
}
