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

async function makeProject(files: Record<string, string>): Promise<Project> {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cg-md-e2e-'));
  const docsDir = path.join(root, 'docs', 'knowledge');
  fs.mkdirSync(docsDir, { recursive: true });
  for (const [relPath, content] of Object.entries(files)) {
    const abs = path.join(docsDir, relPath);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, content, 'utf-8');
  }
  // Bootstrap a codegraph DB (the docs subsystem needs an existing .cgraphx/cgraphx.db)
  const { DatabaseConnection } = await import('../../../src/core/db/index');
  const dbDir = path.join(root, '.cgraphx');
  fs.mkdirSync(dbDir, { recursive: true });
  const dbPath = path.join(dbDir, 'cgraphx.db');
  const conn = DatabaseConnection.open(dbPath);
  conn.close();
  return { root, docsDir, dbPath };
}

function withQuery<T>(project: Project, fn: (q: MarkdownQuery) => T): T {
  const conn = openMarkdownDb(project.root);
  try {
    return fn(new MarkdownQuery(conn.getDb()));
  } finally {
    conn.close();
  }
}

const validDocA = [
  '---',
  'title: 退订功能决策',
  'document_type: decision',
  'domains:',
  '  - 订单域',
  '  - 计费域',
  'concepts:',
  '  - 退订',
  '  - 调账',
  'status: active',
  'source_type: work_context',
  'updated: 2026-06-26',
  'tags:',
  '  - high',
  'related_documents:',
  '  - ./order-lifecycle.md',
  '---',
  '',
  '## Summary',
  '退订功能的核心规则。',
  '',
].join('\n');

const validDocB = [
  '---',
  'title: 订单生命周期',
  'document_type: business-flow',
  'domains:',
  '  - 订单域',
  'concepts:',
  '  - 新装',
  '  - 退订',
  '  - 续费',
  'status: active',
  'source_type: manual',
  'updated: 2026-06-20',
  '---',
  '',
  '## Summary',
  '订单完整生命周期说明。',
  '',
].join('\n');

const invalidDoc = [
  '---',
  'title: 缺字段',
  'document_type: lesson',
  'status: draft',
  'source_type: manual',
  '---',
  '',
  '## Summary',
  '这个文档缺 updated, domains, concepts,会被跳过。',
].join('\n');

describe('indexMarkdownKnowledgeBase end-to-end', () => {
  let project: Project;

  beforeAll(async () => {
    project = await makeProject({
      'decision-001.md': validDocA,
      'order-lifecycle.md': validDocB,
      'drafts/wip.md': invalidDoc,
    });
  });

  afterAll(() => {
    fs.rmSync(project.root, { recursive: true, force: true });
  });

  it('reports correct counts and skips', async () => {
    const report = await indexMarkdownKnowledgeBase(project.root);
    expect(report.error).toBeUndefined();
    expect(report.scannedFiles).toBe(3);
    expect(report.indexedDocuments).toBe(2);
    expect(report.skippedFiles).toBe(1);
    expect(report.skipBreakdown.missing_required_field).toBe(1);
    expect(report.conceptsCreated).toBe(4); // 退订, 调账, 新装, 续费 (去重)
    expect(report.domainsCreated).toBe(2);
    expect(report.tagsCreated).toBe(1);
    expect(report.referencesCreated).toBe(1);
  });

  it('supports listConcepts with cross-document domain aggregation', () => {
    const concepts = withQuery(project, q => q.listConcepts());
    const tuiding = concepts.find(c => c.name === '退订');
    expect(tuiding).toBeDefined();
    expect(tuiding?.documentCount).toBe(2);
    expect(tuiding?.domains.sort()).toEqual(['计费域', '订单域']);
  });

  it('supports find by concept returning path + summary', () => {
    const docs = withQuery(project, q => q.find({ concept: '退订' }));
    expect(docs.length).toBe(2);
    expect(docs.every(d => d.path.includes('docs/knowledge/'))).toBe(true);
    expect(docs.every(d => d.summary.length > 0)).toBe(true);
  });

  it('supports find by keyword q (substring on title/summary)', () => {
    const docs = withQuery(project, q => q.find({ q: '订单' }));
    expect(docs.length).toBe(1);
    expect(docs[0]?.title).toBe('订单生命周期');
  });

  it('supports getReferences bidirectionally', () => {
    const view = withQuery(project, q =>
      q.getReferences('docs/knowledge/order-lifecycle.md'),
    );
    expect(view.documentTitle).toBe('订单生命周期');
    expect(view.outgoing.length).toBe(0);
    expect(view.incoming.length).toBe(1);
    expect(view.incoming[0]?.title).toBe('退订功能决策');
  });

  it('is idempotent on re-index (same data → same counts)', async () => {
    const r1 = await indexMarkdownKnowledgeBase(project.root);
    const r2 = await indexMarkdownKnowledgeBase(project.root);
    expect(r2.indexedDocuments).toBe(r1.indexedDocuments);
    expect(r2.conceptsCreated).toBe(r1.conceptsCreated);
  });

  it('is cover-the-table: deleting a file removes it from the index', async () => {
    fs.unlinkSync(path.join(project.docsDir, 'decision-001.md'));
    await indexMarkdownKnowledgeBase(project.root);
    const docs = withQuery(project, q => q.find({ concept: '退订' }));
    expect(docs.length).toBe(1);
    expect(docs[0]?.title).toBe('订单生命周期');
  });

  it('returns error report (not throw) when docs/knowledge does not exist', async () => {
    const empty = await makeProject({});
    fs.rmSync(empty.docsDir, { recursive: true, force: true });
    const report = await indexMarkdownKnowledgeBase(empty.root);
    expect(report.error).toBeDefined();
    expect(report.scannedFiles).toBe(0);
    fs.rmSync(empty.root, { recursive: true, force: true });
  });
});
