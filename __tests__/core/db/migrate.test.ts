/**
 * Tests for dropLegacyGraphTables — the 1.x → 2.0 cleanup that drops the
 * orphaned code-graph tables (nodes/edges/files) while preserving the 2.0
 * markdown_* / timeline_* data.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';

import { DatabaseConnection, getDatabasePath } from '../../../src/core/db';
import { dropLegacyGraphTables } from '../../../src/core/db/migrate';

function tmpProject(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'cg-migrate-'));
}

function tableExists(project: string, table: string): boolean {
  const conn = DatabaseConnection.open(getDatabasePath(project));
  try {
    const row = conn.getDb().prepare(
      `SELECT name FROM sqlite_master WHERE type = 'table' AND name = '${table}'`,
    ).get() as { name: string } | undefined;
    return !!row;
  } finally {
    conn.close();
  }
}

describe('dropLegacyGraphTables', () => {
  let project: string;
  beforeEach(() => { project = tmpProject(); });
  afterEach(() => { fs.rmSync(project, { recursive: true, force: true }); });

  it('drops all 1.x graph tables (incl. FTS5 + shadow tables), preserves 2.0 data', () => {
    // Simulate an upgrading 1.x project: the full graph-layer schema (from the
    // removed src/db/schema.sql) + a populated 2.0 markdown table.
    const conn = DatabaseConnection.open(getDatabasePath(project));
    conn.getDb().exec(`
      CREATE TABLE schema_versions (version INTEGER PRIMARY KEY, applied_at INTEGER, description TEXT);
      CREATE TABLE nodes (id INTEGER PRIMARY KEY, name TEXT);
      CREATE TABLE edges (source INTEGER, target INTEGER, kind TEXT);
      CREATE TABLE files (path TEXT, language TEXT);
      CREATE TABLE unresolved_refs (from_node_id INTEGER, reference_name TEXT);
      CREATE VIRTUAL TABLE nodes_fts USING fts5(name);
      CREATE TABLE project_metadata (key TEXT PRIMARY KEY, value TEXT, updated_at INTEGER);
      CREATE TABLE markdown_documents (id INTEGER PRIMARY KEY, path TEXT);
      INSERT INTO markdown_documents (path) VALUES ('docs/a.md');
    `);
    conn.close();

    const cleanup = dropLegacyGraphTables(project);
    expect(cleanup.dropped.sort()).toEqual(
      ['edges', 'files', 'nodes', 'nodes_fts', 'project_metadata', 'schema_versions', 'unresolved_refs'],
    );

    // Every 1.x graph table is gone.
    for (const t of ['nodes', 'edges', 'files', 'unresolved_refs', 'nodes_fts', 'project_metadata', 'schema_versions']) {
      expect(tableExists(project, t), `${t} should be dropped`).toBe(false);
    }
    // The FTS5 virtual-table drop cascades to its shadow tables.
    const shadowConn = DatabaseConnection.open(getDatabasePath(project));
    const shadows = shadowConn.getDb().prepare(
      `SELECT name FROM sqlite_master WHERE name LIKE 'nodes_fts_%'`,
    ).all() as Array<{ name: string }>;
    shadowConn.close();
    expect(shadows).toEqual([]);

    // The 2.0 table and its rows survive.
    expect(tableExists(project, 'markdown_documents')).toBe(true);
    const conn2 = DatabaseConnection.open(getDatabasePath(project));
    const rows = conn2.getDb().prepare('SELECT path FROM markdown_documents').all() as Array<{ path: string }>;
    conn2.close();
    expect(rows.map((r) => r.path)).toEqual(['docs/a.md']);
  });

  it('is idempotent: a second run drops nothing', () => {
    const conn = DatabaseConnection.open(getDatabasePath(project));
    conn.getDb().exec('CREATE TABLE nodes (id INTEGER);');
    conn.close();

    dropLegacyGraphTables(project);
    expect(dropLegacyGraphTables(project).dropped).toEqual([]);
  });

  it('is a no-op for a 2.0-native project (no graph tables)', () => {
    const conn = DatabaseConnection.open(getDatabasePath(project));
    conn.getDb().exec('CREATE TABLE markdown_documents (id INTEGER);');
    conn.close();
    expect(dropLegacyGraphTables(project).dropped).toEqual([]);
  });

  it('returns empty when there is no .cgraphx/cgraphx.db yet', () => {
    expect(dropLegacyGraphTables(project).dropped).toEqual([]);
  });
});
