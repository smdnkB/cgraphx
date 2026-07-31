// Tests for v1 → v2 markdown schema migration.
//
// Validates that a `.cgraphx/cgraphx.db` created under the v1 markdown
// schema is upgraded to v2 (new `markdown_explored_entry_names` table) when
// re-opened by the current build, without losing any v1 data
// (documents / concepts / domains / tags / references).
//
// makeProject helper convention from `__tests__/markdown/indexer.test.ts`.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { DatabaseConnection } from '../../../src/core/db';
import { indexMarkdownKnowledgeBase } from '../../../src/core/markdown/indexer';
import { openMarkdownDb } from '../../../src/core/markdown/schema-bootstrap';

interface Project {
  root: string;
  docsDir: string;
  dbPath: string;
}

async function makeProject(files: Record<string, string>): Promise<Project> {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cg-md-migration-'));
  const docsDir = path.join(root, 'docs', 'knowledge');
  fs.mkdirSync(docsDir, { recursive: true });
  for (const [relPath, content] of Object.entries(files)) {
    const abs = path.join(docsDir, relPath);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, content, 'utf-8');
  }
  // Bootstrap a codegraph DB (the docs subsystem needs an existing .cgraphx/cgraphx.db)
  const dbDir = path.join(root, '.cgraphx');
  fs.mkdirSync(dbDir, { recursive: true });
  const dbPath = path.join(dbDir, 'cgraphx.db');
  const conn = DatabaseConnection.open(dbPath);
  conn.close();
  return { root, docsDir, dbPath };
}

const validDoc = [
  '---',
  'title: 测试决策',
  'document_type: decision',
  'domains:',
  '  - 测试域',
  'concepts:',
  '  - 测试概念',
  'status: active',
  'source_type: work_context',
  'updated: 2026-06-27',
  'owners:',
  '  - team',
  '---',
  '',
  '## Summary',
  '测试文档摘要。',
  '',
].join('\n');

/** Drop the v2 portion of the schema, leaving a v1-only DB. */
function stripV2(dbPath: string): void {
  const conn = DatabaseConnection.open(dbPath);
  const db = conn.getDb();
  // Remove the v2 version row (the v1 row stays).
  db.prepare('DELETE FROM markdown_schema_versions WHERE version = 2').run();
  // Drop the v2 table + its index.
  db.exec('DROP INDEX IF EXISTS idx_entry_names_norm');
  db.exec('DROP TABLE IF EXISTS markdown_explored_entry_names');
  conn.close();
}

function getRecordedVersions(dbPath: string): number[] {
  const conn = DatabaseConnection.open(dbPath);
  try {
    const rows = conn
      .getDb()
      .prepare('SELECT version FROM markdown_schema_versions ORDER BY version')
      .all() as Array<{ version: number }>;
    return rows.map(r => r.version);
  } finally {
    conn.close();
  }
}

describe('markdown schema v1 → v2 migration', () => {
  let project: Project;

  beforeAll(async () => {
    project = await makeProject({
      'decision-001.md': validDoc,
    });
  });

  afterAll(() => {
    fs.rmSync(project.root, { recursive: true, force: true });
  });

  it('fresh DB applies both v1 and v2 schema on first open', () => {
    // A brand-new .cgraphx/cgraphx.db that has never been opened by the
    // markdown subsystem should get the full v1 + v2 schema in one pass.
    const conn = openMarkdownDb(project.root);
    const db = conn.getDb();
    try {
      // Both version rows recorded.
      const versions = db
        .prepare('SELECT version FROM markdown_schema_versions ORDER BY version')
        .all() as Array<{ version: number }>;
      expect(versions.map(v => v.version)).toEqual([1, 2]);

      // The v2 table exists.
      const v2Table = db
        .prepare(
          "SELECT name FROM sqlite_master WHERE type='table' AND name='markdown_explored_entry_names'",
        )
        .get();
      expect(v2Table).toBeDefined();

      // The v2 index exists.
      const v2Index = db
        .prepare(
          "SELECT name FROM sqlite_master WHERE type='index' AND name='idx_entry_names_norm'",
        )
        .get();
      expect(v2Index).toBeDefined();
    } finally {
      conn.close();
    }
  });

  it('upgrades a v1-only DB to v2 without losing v1 data', async () => {
    // Build an isolated project so we can mutate the DB freely.
    const v1Project = await makeProject({
      'decision-001.md': validDoc,
    });

    try {
      // 1. Open once → schema applied at v1 + v2.
      // 2. Index docs → populates v1 data (documents, concepts, etc.).
      // 3. Strip the v2 portion → DB is now in the "v1-only" state a real
      //    user would be in after upgrading codegraph from a v1-only build.
      let preIndexCounts: { docs: number; concepts: number };
      {
        const conn = openMarkdownDb(v1Project.root);
        try {
          // sanity: both versions recorded pre-strip
          const versions = conn
            .getDb()
            .prepare('SELECT version FROM markdown_schema_versions ORDER BY version')
            .all() as Array<{ version: number }>;
          expect(versions.map(v => v.version)).toEqual([1, 2]);
        } finally {
          conn.close();
        }
      }

      await indexMarkdownKnowledgeBase(v1Project.root);

      {
        const conn = openMarkdownDb(v1Project.root);
        try {
          const db = conn.getDb();
          const docs = db
            .prepare('SELECT count(*) as n FROM markdown_documents')
            .get() as { n: number };
          const concepts = db
            .prepare('SELECT count(*) as n FROM markdown_concepts')
            .get() as { n: number };
          preIndexCounts = { docs: docs.n, concepts: concepts.n };
        } finally {
          conn.close();
        }
      }
      expect(preIndexCounts.docs).toBeGreaterThan(0);
      expect(preIndexCounts.concepts).toBeGreaterThan(0);

      // Now simulate a v1-only DB: strip the v2 version row + drop the v2 table.
      stripV2(v1Project.dbPath);

      // Sanity-check we really are back at v1-only.
      expect(getRecordedVersions(v1Project.dbPath)).toEqual([1]);

      // Re-index — this routes through openMarkdownDb, which re-applies the
      // schema and should bring v2 back without touching v1 data.
      const report = await indexMarkdownKnowledgeBase(v1Project.root);
      expect(report.error).toBeUndefined();
      expect(report.indexedDocuments).toBeGreaterThan(0);

      const conn = openMarkdownDb(v1Project.root);
      try {
        const db = conn.getDb();

        // v1 data is intact.
        const docs = db
          .prepare('SELECT count(*) as n FROM markdown_documents')
          .get() as { n: number };
        const concepts = db
          .prepare('SELECT count(*) as n FROM markdown_concepts')
          .get() as { n: number };
        expect(docs.n).toBe(preIndexCounts.docs);
        expect(concepts.n).toBe(preIndexCounts.concepts);

        // v2 schema has been re-created.
        const v2Table = db
          .prepare(
            "SELECT name FROM sqlite_master WHERE type='table' AND name='markdown_explored_entry_names'",
          )
          .get();
        expect(v2Table).toBeDefined();

        // Both version rows present again.
        const versions = db
          .prepare('SELECT version FROM markdown_schema_versions ORDER BY version')
          .all() as Array<{ version: number }>;
        expect(versions.map(v => v.version)).toEqual([1, 2]);
      } finally {
        conn.close();
      }
    } finally {
      fs.rmSync(v1Project.root, { recursive: true, force: true });
    }
  });

  it('re-opening an already-v2 DB is idempotent (versions stable, data intact)', async () => {
    const idempProject = await makeProject({
      'decision-001.md': validDoc,
    });

    try {
      // First open: builds schema at v1 + v2 and indexes the document.
      await indexMarkdownKnowledgeBase(idempProject.root);

      let firstOpenCounts: { docs: number; concepts: number; versions: number[] };
      {
        const conn = openMarkdownDb(idempProject.root);
        try {
          const db = conn.getDb();
          const docs = db
            .prepare('SELECT count(*) as n FROM markdown_documents')
            .get() as { n: number };
          const concepts = db
            .prepare('SELECT count(*) as n FROM markdown_concepts')
            .get() as { n: number };
          const versions = db
            .prepare('SELECT version FROM markdown_schema_versions ORDER BY version')
            .all() as Array<{ version: number }>;
          firstOpenCounts = {
            docs: docs.n,
            concepts: concepts.n,
            versions: versions.map(v => v.version),
          };
        } finally {
          conn.close();
        }
      }
      expect(firstOpenCounts.versions).toEqual([1, 2]);
      expect(firstOpenCounts.docs).toBeGreaterThan(0);

      // Second open on an already-v2 DB: must be a no-op.
      const conn = openMarkdownDb(idempProject.root);
      try {
        const db = conn.getDb();
        const docs = db
          .prepare('SELECT count(*) as n FROM markdown_documents')
          .get() as { n: number };
        const concepts = db
          .prepare('SELECT count(*) as n FROM markdown_concepts')
          .get() as { n: number };
        const versions = db
          .prepare('SELECT version FROM markdown_schema_versions ORDER BY version')
          .all() as Array<{ version: number }>;

        expect(docs.n).toBe(firstOpenCounts.docs);
        expect(concepts.n).toBe(firstOpenCounts.concepts);
        expect(versions.map(v => v.version)).toEqual([1, 2]);
      } finally {
        conn.close();
      }
    } finally {
      fs.rmSync(idempProject.root, { recursive: true, force: true });
    }
  });
});
