/**
 * T-5 — concepts --sort/--limit tests.
 *
 * Verifies `MarkdownQuery.listConcepts({ sort, limit })` behavior, including
 * the strict limit validation that B-4 introduced:
 *   - default sort: doc_count DESC, name ASC
 *   - sort='name': name ASC
 *   - limit=N caps results, limit=0 returns empty
 *   - sort + limit combined
 *   - invalid sort throws TypeError
 *   - backward compat: limit=undefined / limit=null return all
 *   - strict limit validation: NaN / 5.5 / -1 / Infinity / string / SQL
 *     injection attempt all throw TypeError (the SQL-injection boundary is
 *     `Number.isInteger`, which rejects typeof === 'string' before the value
 *     ever reaches the SQL string).
 *
 * Test convention mirrors indexer.test.ts / seen-names.test.ts — real
 * docs/knowledge/*.md files, real SQLite, no mocking.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { indexMarkdownKnowledgeBase } from '../../../src/core/markdown/indexer';
import { MarkdownQuery } from '../../../src/core/markdown/query';
import { openMarkdownDb } from '../../../src/core/markdown/schema-bootstrap';

interface Project {
  root: string;
  docsDir: string;
  dbPath: string;
}

/**
 * Build a throwaway project root with a docs/knowledge tree and a bootstrapped
 * .cgraphx/cgraphx.db. Mirrors the convention in indexer.test.ts — real
 * SQLite, no mocking.
 */
async function makeProject(files: Record<string, string>): Promise<Project> {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cg-md-sort-'));
  const docsDir = path.join(root, 'docs', 'knowledge');
  fs.mkdirSync(docsDir, { recursive: true });
  for (const [relPath, content] of Object.entries(files)) {
    const abs = path.join(docsDir, relPath);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, content, 'utf-8');
  }
  // Bootstrap a codegraph DB — the docs subsystem needs an existing
  // .cgraphx/cgraphx.db before openMarkdownDb will touch it.
  const { DatabaseConnection } = await import('../../../src/core/db/index');
  const dbDir = path.join(root, '.cgraphx');
  fs.mkdirSync(dbDir, { recursive: true });
  const dbPath = path.join(dbDir, 'cgraphx.db');
  const conn = DatabaseConnection.open(dbPath);
  conn.close();
  return { root, docsDir, dbPath };
}

/**
 * Generate a valid markdown doc with frontmatter. Uses `decision` as the
 * document_type (matches DOCUMENT_TYPES) and `active` as the status (matches
 * DOCUMENT_STATUSES), so the doc passes validation and is indexed.
 */
function mdDoc(title: string, concepts: string[]): string {
  return [
    '---',
    `title: ${title}`,
    'document_type: decision',
    'domains:',
    '  - test',
    'concepts:',
    ...concepts.map(c => `  - ${c}`),
    'status: active',
    'source_type: ai_session',
    'updated: 2026-06-27',
    '---',
    '',
    '## Summary',
    '',
    `${title} summary content.`,
    '',
  ].join('\n');
}

describe('MarkdownQuery.listConcepts (sort + limit)', () => {
  let project: Project;
  let q: MarkdownQuery;

  beforeAll(async () => {
    // 5 docs that produce an observable distribution for sorting:
    //   ConceptA: doc1 + doc2 + doc3 = 3
    //   ConceptB: doc1 + doc3       = 2
    //   ConceptC: doc1              = 1
    //   ConceptD: doc4              = 1
    //   ConceptE: doc5              = 1
    project = await makeProject({
      'doc1.md': mdDoc('Doc 1', ['ConceptA', 'ConceptB', 'ConceptC']),
      'doc2.md': mdDoc('Doc 2', ['ConceptA']),
      'doc3.md': mdDoc('Doc 3', ['ConceptA', 'ConceptB']),
      'doc4.md': mdDoc('Doc 4', ['ConceptD']),
      'doc5.md': mdDoc('Doc 5', ['ConceptE']),
    });
    await indexMarkdownKnowledgeBase(project.root);
    const conn = openMarkdownDb(project.root);
    q = new MarkdownQuery(conn.getDb());
  });

  afterAll(() => {
    fs.rmSync(project.root, { recursive: true, force: true });
  });

  // ----- default sort --------------------------------------------------------

  it('default (no opts): sort by doc_count DESC, name ASC', () => {
    const rows = q.listConcepts();
    expect(rows.length).toBeGreaterThanOrEqual(5);
    // ConceptA.doc_count=3 should be first
    expect(rows[0]!.name).toBe('ConceptA');
    expect(rows[0]!.documentCount).toBe(3);
    // doc_count=1 (ConceptC/D/E) at the end, sorted name ASC
    const lastThree = rows.slice(-3).map(r => r.name);
    expect([...lastThree].sort()).toEqual(lastThree);
  });

  // ----- sort=name -----------------------------------------------------------

  it('sort=name returns alphabetically (name ASC)', () => {
    const rows = q.listConcepts({ sort: 'name' });
    const names = rows.map(r => r.name);
    const sorted = [...names].sort();
    expect(names).toEqual(sorted);
  });

  it("sort='doc-count' is explicit and matches default ordering", () => {
    const explicit = q.listConcepts({ sort: 'doc-count' });
    const byDefault = q.listConcepts();
    expect(explicit.map(r => r.name)).toEqual(byDefault.map(r => r.name));
  });

  // ----- limit ---------------------------------------------------------------

  it('limit=N caps the result count', () => {
    const rows = q.listConcepts({ limit: 3 });
    expect(rows).toHaveLength(3);
  });

  it('limit=0 returns empty array', () => {
    const rows = q.listConcepts({ limit: 0 });
    expect(rows).toHaveLength(0);
  });

  // ----- sort + limit combined ----------------------------------------------

  it('sort + limit combined: doc-count top 2', () => {
    const rows = q.listConcepts({ sort: 'doc-count', limit: 2 });
    expect(rows).toHaveLength(2);
    // top 2 by doc_count: ConceptA (3), ConceptB (2)
    expect(rows[0]!.name).toBe('ConceptA');
    expect(rows[0]!.documentCount).toBe(3);
    expect(rows[1]!.name).toBe('ConceptB');
    expect(rows[1]!.documentCount).toBe(2);
  });

  it('sort + limit combined: name top 2', () => {
    const rows = q.listConcepts({ sort: 'name', limit: 2 });
    expect(rows).toHaveLength(2);
    // first 2 alphabetically == first 2 of the full name-sorted list
    const allNames = q.listConcepts({ sort: 'name' }).map(r => r.name);
    expect(rows[0]!.name).toBe(allNames[0]);
    expect(rows[1]!.name).toBe(allNames[1]);
  });

  // ----- invalid sort --------------------------------------------------------

  it('invalid sort value throws TypeError', () => {
    expect(() => q.listConcepts({ sort: 'invalid' as never })).toThrow(TypeError);
    expect(() => q.listConcepts({ sort: 'invalid' as never })).toThrow(/invalid sort/);
  });

  // ----- backward compat -----------------------------------------------------

  it('limit=undefined returns all (backward compat)', () => {
    const rows = q.listConcepts({ limit: undefined });
    expect(rows.length).toBeGreaterThanOrEqual(5);
  });

  it('limit=null returns all (backward compat)', () => {
    const rows = q.listConcepts({ limit: null as never });
    expect(rows.length).toBeGreaterThanOrEqual(5);
  });

  it('no-arg call still works (back-compat with indexer.test.ts callers)', () => {
    const rows = q.listConcepts();
    expect(rows.length).toBeGreaterThanOrEqual(5);
    // ConceptA must still surface with doc_count=3
    const a = rows.find(r => r.name === 'ConceptA');
    expect(a).toBeDefined();
    expect(a?.documentCount).toBe(3);
  });

  // ----- strict limit validation (B-4 fix) ----------------------------------
  //
  // Number.isInteger is the SQL-injection boundary: it requires typeof ===
  // 'number', integer, and (per the >= 0 check) non-negative. Anything else
  // is rejected before it can reach the SQL string interpolation.
  describe('strict limit validation (B-4 fix)', () => {
    it('limit=NaN throws TypeError', () => {
      expect(() => q.listConcepts({ limit: NaN })).toThrow(TypeError);
      expect(() => q.listConcepts({ limit: NaN })).toThrow(/invalid limit/);
    });

    it('limit=5.5 throws TypeError (non-integer)', () => {
      expect(() => q.listConcepts({ limit: 5.5 })).toThrow(TypeError);
      expect(() => q.listConcepts({ limit: 5.5 })).toThrow(/invalid limit/);
    });

    it('limit=-1 throws TypeError (negative)', () => {
      expect(() => q.listConcepts({ limit: -1 })).toThrow(TypeError);
      expect(() => q.listConcepts({ limit: -1 })).toThrow(/invalid limit/);
    });

    it('limit=Infinity throws TypeError', () => {
      // Number.isInteger(Infinity) === false
      expect(() => q.listConcepts({ limit: Infinity })).toThrow(TypeError);
      expect(() => q.listConcepts({ limit: Infinity })).toThrow(/invalid limit/);
    });

    it('limit="5" throws TypeError (string, even though numeric-looking)', () => {
      // Number.isInteger("5") === false (typeof string), so rejected
      expect(() => q.listConcepts({ limit: '5' as never })).toThrow(TypeError);
      expect(() => q.listConcepts({ limit: '5' as never })).toThrow(/invalid limit/);
    });

    it('limit="5; DROP TABLE markdown_concepts" throws TypeError (SQL injection attempt)', () => {
      // spec red-line: rejected at the query layer (not the CLI layer) so
      // library users are also protected. The check is type-of based, so a
      // crafted string never reaches the LIMIT interpolation.
      expect(() =>
        q.listConcepts({ limit: '5; DROP TABLE markdown_concepts' as never }),
      ).toThrow(TypeError);
    });

    it('concept table is intact after the SQL-injection attempt', () => {
      // belt-and-suspenders: run the bad call (catching), then confirm the
      // concepts table is unchanged.
      const before = q.listConcepts().length;
      try {
        q.listConcepts({ limit: '5; DROP TABLE markdown_concepts' as never });
      } catch {
        // expected
      }
      const after = q.listConcepts().length;
      expect(after).toBe(before);
      expect(after).toBeGreaterThanOrEqual(5);
    });
  });
});
