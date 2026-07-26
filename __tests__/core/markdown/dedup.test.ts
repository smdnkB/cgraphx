import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { normalizeName } from '../../../src/core/markdown/dedup';
import { indexMarkdownKnowledgeBase } from '../../../src/core/markdown/indexer';
import { MarkdownQuery } from '../../../src/core/markdown/query';
import { openMarkdownDb } from '../../../src/core/markdown/schema-bootstrap';

describe('normalizeName', () => {
  it.each([
    ['客户导出 Batch',            '客户导出batch'],
    ['export-customer-batch',     'exportcustomerbatch'],
    ['OrderService.createOrder',  'orderservicecreateorder'], // . 被过滤(spec §4.3 锁定)
    ['  Hello World  ',           'helloworld'],
    ['',                          ''],
    ['已经探索过的功能',             '已经探索过的功能'],          // CJK 全保留
    ['Hello, World; Hello.World', 'helloworldhelloworld'],   // 多种分隔符混用
    ['UPPER',                     'upper'],
    ['Mixed案例 Case',            'mixed案例case'],           // 大小写 + CJK 混合
  ])('normalizeName(%j) === %j', (input, expected) => {
    expect(normalizeName(input)).toBe(expected);
  });

  it('returns empty string for null/undefined', () => {
    expect(normalizeName(null as unknown as string)).toBe('');
    expect(normalizeName(undefined as unknown as string)).toBe('');
  });

  it('throws TypeError for non-string input', () => {
    expect(() => normalizeName(123 as unknown as string)).toThrow(TypeError);
    expect(() => normalizeName({} as unknown as string)).toThrow(TypeError);
  });

  it('drops full-width / CJK punctuation from a CJK string', () => {
    // 全角 ， 。 、 ； ： 都应被过滤,只保留汉字
    expect(normalizeName('你好，世界。、；：')).toBe('你好世界');
  });

  it('keeps CJK Unified Ideographs Extension A (0x3400-0x4DBF)', () => {
    // 㐀 = U+3400, 㔡 = U+3521,都在 Ext A 范围内,应保留
    expect(normalizeName('㐀㔡')).toBe('㐀㔡');
  });
});

// ============================================================
// Layer 2 — MarkdownQuery.checkConceptDedup
// Real SQLite, real indexer. No mocks.
// ============================================================

interface Project {
  root: string;
  docsDir: string;
  dbPath: string;
}

async function makeProject(files: Record<string, string>): Promise<Project> {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cg-md-dedup-'));
  const docsDir = path.join(root, 'docs', 'knowledge');
  fs.mkdirSync(docsDir, { recursive: true });
  for (const [relPath, content] of Object.entries(files)) {
    const abs = path.join(docsDir, relPath);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, content, 'utf-8');
  }
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

function mdDoc(opts: {
  title: string;
  concepts: string[];
  aliases?: string[];
  domains?: string[];
  documentType?: string;
  summary?: string;
}): string {
  const domains = opts.domains ?? ['客户域'];
  const aliases = opts.aliases ?? [];
  const documentType = opts.documentType ?? 'decision';
  const summary = opts.summary ?? `${opts.title}相关决策。`;
  const lines = [
    '---',
    `title: ${opts.title}`,
    `document_type: ${documentType}`,
    'domains:',
    ...domains.map(d => `  - ${d}`),
    'concepts:',
    ...opts.concepts.map(c => `  - ${c}`),
  ];
  // When the doc has no aliases, OMIT the key entirely. The frontmatter parser
  // turns `aliases: []` into the string "[]" (not an empty list), which would
  // trip readList's "expected list, got scalar" check and the doc gets skipped
  // with field_type_error. Optional keys should just be absent, per indexer.test.ts convention.
  if (aliases.length > 0) {
    lines.push('aliases:');
    for (const a of aliases) lines.push(`  - ${a}`);
  }
  lines.push(
    'status: active',
    'source_type: ai_session',
    'updated: 2026-06-27',
    '---',
    '',
    '## Summary',
    summary,
    '',
  );
  return lines.join('\n');
}

describe('MarkdownQuery.checkConceptDedup', () => {
  let project: Project;

  // Shared project — every case runs against the same indexed vocabulary.
  // doc1: Customer Export + aliases [客户导出, CustExp]
  // doc2: Order Service  + aliases [订单服务]
  // doc3: Payment Gateway (no aliases)
  // doc4: Foo Bar        + aliases [Shared Term]            ← exact-vs-alias setup
  // doc5: Other Thing    + aliases [Foo Bar]                ← 'Foo Bar' is both a concept (doc4) and an alias (doc5)
  beforeAll(async () => {
    project = await makeProject({
      'doc1-customer-export.md': mdDoc({
        title: '客户导出决策',
        concepts: ['Customer Export'],
        aliases: ['客户导出', 'CustExp'],
      }),
      'doc2-order-service.md': mdDoc({
        title: '订单服务决策',
        concepts: ['Order Service'],
        aliases: ['订单服务'],
      }),
      'doc3-payment-gateway.md': mdDoc({
        title: '支付网关决策',
        concepts: ['Payment Gateway'],
        // no aliases
      }),
      'doc4-foo-bar.md': mdDoc({
        title: 'Foo Bar 决策',
        concepts: ['Foo Bar'],
        aliases: ['Shared Term'],
      }),
      'doc5-other-thing.md': mdDoc({
        title: 'Other Thing 决策',
        concepts: ['Other Thing'],
        aliases: ['Foo Bar'],
      }),
    });
    const report = await indexMarkdownKnowledgeBase(project.root);
    expect(report.error).toBeUndefined();
    expect(report.indexedDocuments).toBe(5);
  });

  afterAll(() => {
    fs.rmSync(project.root, { recursive: true, force: true });
  });

  it('exact match: normalize(candidate) === normalize(concept.name)', () => {
    const resp = withQuery(project, q =>
      q.checkConceptDedup(['customer export', 'CUSTOMER EXPORT']),
    );
    expect(resp.results).toHaveLength(2);
    expect(resp.results[0]).toMatchObject({
      is_duplicate: true,
      matched_concept: 'Customer Export',
      matched_alias: null,
      matched_via: 'exact',
    });
    expect(resp.results[1]).toMatchObject({
      is_duplicate: true,
      matched_concept: 'Customer Export',
      matched_alias: null,
      matched_via: 'exact',
    });
  });

  it('alias match: normalize(candidate) === normalize(alias)', () => {
    const resp = withQuery(project, q =>
      q.checkConceptDedup(['客户导出', 'CustExp']),
    );
    expect(resp.results).toHaveLength(2);
    // alias match returns the doc's PRIMARY concept name (Customer Export),
    // not the alias string itself — this is the locked behavior from B-2 / spec §3.2
    expect(resp.results[0]).toMatchObject({
      is_duplicate: true,
      matched_concept: 'Customer Export',
      matched_alias: '客户导出',
      matched_via: 'alias',
    });
    expect(resp.results[1]).toMatchObject({
      is_duplicate: true,
      matched_concept: 'Customer Export',
      matched_alias: 'CustExp',
      matched_via: 'alias',
    });
  });

  it('exact wins over alias when both match the same normalized form', () => {
    // 'Foo Bar' is the primary concept of doc4 AND an alias of doc5.
    // Candidate 'Foo Bar' must resolve via 'exact' to doc4's concept,
    // NOT via 'alias' to doc5's primary concept (Other Thing).
    const resp = withQuery(project, q => q.checkConceptDedup(['Foo Bar']));
    expect(resp.results).toHaveLength(1);
    expect(resp.results[0]).toMatchObject({
      name: 'Foo Bar',
      is_duplicate: true,
      matched_concept: 'Foo Bar', // doc4's primary concept, NOT 'Other Thing'
      matched_alias: null,
      matched_via: 'exact',
    });
    // Sanity: 'Other Thing' (doc5's primary) must NOT leak into matched_concept
    expect(resp.results[0]?.matched_concept).not.toBe('Other Thing');
  });

  it('returns is_duplicate=false for an unknown name', () => {
    const resp = withQuery(project, q => q.checkConceptDedup(['完全新的功能']));
    expect(resp.results).toHaveLength(1);
    expect(resp.results[0]).toMatchObject({
      name: '完全新的功能',
      is_duplicate: false,
      matched_concept: null,
      matched_alias: null,
      matched_via: null,
    });
    // normalized should still be populated for non-duplicates
    expect(resp.results[0]?.normalized).toBe('完全新的功能');
  });

  it('batch-checks multiple candidates in one call (exact + alias + unknown)', () => {
    const resp = withQuery(project, q =>
      q.checkConceptDedup(['customer export', '新功能', '订单服务']),
    );
    expect(resp.results).toHaveLength(3);
    // First: exact hit on Customer Export
    expect(resp.results[0]).toMatchObject({
      name: 'customer export',
      is_duplicate: true,
      matched_concept: 'Customer Export',
      matched_via: 'exact',
    });
    // Second: no match
    expect(resp.results[1]).toMatchObject({
      name: '新功能',
      is_duplicate: false,
      matched_concept: null,
      matched_via: null,
    });
    // Third: alias hit on Order Service (订单服务 is the alias, doc's primary concept is Order Service)
    expect(resp.results[2]).toMatchObject({
      name: '订单服务',
      is_duplicate: true,
      matched_concept: 'Order Service',
      matched_alias: '订单服务',
      matched_via: 'alias',
    });
  });

  it('filters out candidates that normalize to empty (with warnings)', () => {
    // '---' and ' , . : ' all normalize to '' (only separators / punctuation)
    const resp = withQuery(project, q =>
      q.checkConceptDedup(['---', ' , . : ', 'valid name']),
    );
    // Only the valid candidate survives into results
    expect(resp.results.map(r => r.name)).toEqual(['valid name']);
    expect(resp.results[0]?.is_duplicate).toBe(false);
    // Each empty-normalized candidate produces one warning
    expect(resp.warnings).toBeDefined();
    expect(resp.warnings!.length).toBe(2);
    for (const w of resp.warnings!) {
      expect(w).toMatch(/empty normalized form/);
    }
  });

  it('isolates by project: an empty project B has no concepts from project A', async () => {
    // Fresh project with no docs/knowledge contents — its index should be empty
    const projectB = await makeProject({});
    try {
      const report = await indexMarkdownKnowledgeBase(projectB.root);
      // No files to index; the run succeeds with zero documents
      expect(report.scannedFiles).toBe(0);
      expect(report.indexedDocuments).toBe(0);

      const resp = withQuery(projectB, q =>
        q.checkConceptDedup(['customer export']),
      );
      expect(resp.results).toHaveLength(1);
      expect(resp.results[0]?.is_duplicate).toBe(false);
      expect(resp.results[0]?.matched_concept).toBeNull();
      expect(resp.results[0]?.matched_via).toBeNull();
    } finally {
      fs.rmSync(projectB.root, { recursive: true, force: true });
    }
  });
});
