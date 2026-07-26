/**
 * T-4 — Layer 1 seen-names tests.
 *
 * Verifies the 4 MarkdownQuery seen-name operations (add / check / list / clear)
 * behave per contract: idempotency, batch > 500 at the query layer, normalize
 * consistency across add+check, and cross-project isolation (each project has
 * its own .cgraphx/cgraphx.db, so seen-names never leak between projects).
 *
 * This test only exercises the query layer — the CLI batching/chunking lives
 * in src/markdown/cli.ts and is out of scope here.
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
 * Build a throwaway project root with an empty docs/knowledge tree and a
 * bootstrapped .cgraphx/cgraphx.db. Mirrors the convention in
 * indexer.test.ts — real SQLite, no mocking.
 */
async function makeProject(files: Record<string, string> = {}): Promise<Project> {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cg-md-seen-'));
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

describe('MarkdownQuery seen-names operations', () => {
  let project: Project;
  let q: MarkdownQuery;

  beforeAll(async () => {
    project = await makeProject({});
    // Trigger schema apply (creates markdown_explored_entry_names) + an empty
    // docs index pass. openMarkdownDb is then safe to call.
    await indexMarkdownKnowledgeBase(project.root);
    const conn = openMarkdownDb(project.root);
    q = new MarkdownQuery(conn.getDb());
  });

  afterAll(() => {
    fs.rmSync(project.root, { recursive: true, force: true });
  });

  describe('addSeenNames', () => {
    it('adds new names', () => {
      const r = q.addSeenNames(['客户导出 Batch', 'Feature-Y']);
      // Order of `added` is not part of the contract — compare as a set.
      expect(r.added).toHaveLength(2);
      expect(r.added).toEqual(expect.arrayContaining(['客户导出batch', 'featurey']));
      expect(r.skipped_already_present).toEqual([]);
      expect(r.total_seen).toBe(2);
    });

    it('is idempotent: re-adding the same name goes to skipped, total does not grow', () => {
      const r = q.addSeenNames(['客户导出 Batch']);
      expect(r.added).toEqual([]);
      expect(r.skipped_already_present).toEqual(['客户导出batch']);
      expect(r.total_seen).toBe(2); // unchanged from the previous add
    });

    it('normalizes consistently across add and check', () => {
      q.addSeenNames(['HelloWorld']);
      // 'hello world' and 'HELLOWORLD' both normalize to 'helloworld',
      // matching the already-stored 'HelloWorld' → 'helloworld'.
      const checkResp = q.checkSeenNames(['hello world', 'HELLOWORLD']);
      expect(checkResp.results[0]!.is_seen).toBe(true);
      expect(checkResp.results[1]!.is_seen).toBe(true);
    });

    it('filters out empty-normalized names (no insert, no error)', () => {
      const before = q.listSeenNames().total;
      const r = q.addSeenNames(['---', 'valid']);
      expect(r.added).toEqual(['valid']);
      expect(r.total_seen).toBe(before + 1);
    });
  });

  describe('checkSeenNames', () => {
    it('returns is_seen=true for known names, false for unknown', () => {
      // 'featurey' was added in the addSeenNames suite above.
      const resp = q.checkSeenNames(['featurey', 'definitely-unknown-name']);
      expect(resp.results[0]!.is_seen).toBe(true);
      expect(resp.results[1]!.is_seen).toBe(false);
    });

    it('handles batch > 500 names at the query layer (CLI chunking is separate)', () => {
      const big = Array.from({ length: 600 }, (_, i) => `name-${i}`);
      // Query layer accepts 600 candidates in one call and returns one
      // result row per candidate. All are new → all is_seen=false.
      const resp = q.checkSeenNames(big);
      expect(resp.results).toHaveLength(600);
      expect(resp.results.every(r => r.is_seen === false)).toBe(true);
    });
  });

  describe('listSeenNames', () => {
    it('returns all seen names with original + normalized + added_at', () => {
      const resp = q.listSeenNames();
      expect(resp.total).toBeGreaterThan(0);
      const first = resp.names[0]!;
      expect(first).toHaveProperty('original');
      expect(first).toHaveProperty('normalized');
      expect(first).toHaveProperty('added_at');
      expect(typeof first.added_at).toBe('number');
    });
  });

  describe('clearSeenNames', () => {
    it('removes every row and returns the count removed', () => {
      const before = q.listSeenNames().total;
      expect(before).toBeGreaterThan(0); // sanity: we accumulated names above
      const r = q.clearSeenNames();
      expect(r.removed).toBe(before);
      expect(q.listSeenNames().total).toBe(0);
    });
  });

  describe('cross-project isolation', () => {
    it('project B does not see project A names (separate .cgraphx/cgraphx.db)', async () => {
      // Project A (the shared `q` from beforeAll) — add a marker name.
      q.addSeenNames(['隔离测试']);

      // Fresh project B: brand-new root, brand-new DB, brand-new query handle.
      const projectB = await makeProject({});
      await indexMarkdownKnowledgeBase(projectB.root);
      const connB = openMarkdownDb(projectB.root);
      const qB = new MarkdownQuery(connB.getDb());
      try {
        expect(qB.listSeenNames().total).toBe(0);
        const checkResp = qB.checkSeenNames(['隔离测试']);
        expect(checkResp.results[0]!.is_seen).toBe(false);
      } finally {
        connB.close();
        fs.rmSync(projectB.root, { recursive: true, force: true });
      }
    });
  });
});
