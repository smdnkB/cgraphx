/**
 * markdown 子系统公共门面(src/core/markdown/index.ts)测试。
 *
 * 覆盖:
 *   - 门面条目可导入且类型正确(值导出 + 类型导出的编译期检查);
 *   - 导出面"不增不减":精确键集合,且不含 MarkdownStore /
 *     MarkdownDocumentRow(防 Row 外泄回归,data-standards「ORM 映射约定」);
 *   - getStats:计数与 fixture 一致;byType 全 7 键(缺省 0);
 *     byStatus 全 4 键;空库 latestIndexedAt 为 null。
 *
 * 真实栈:mkdtemp 临时项目 + 真实索引 + openMarkdownDb,无 mock。
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import * as facade from '../../../src/core/markdown';
import {
  DOCUMENT_STATUSES,
  DOCUMENT_TYPES,
  DocumentNotFoundError,
  KNOWLEDGE_DIR,
  MARKDOWN_SCHEMA_VERSION,
  MarkdownIndexError,
  MarkdownQuery,
  ProjectNotInitializedError,
  SchemaMismatchError,
  SOURCE_TYPES,
  getCurrentMarkdownSchemaVersion,
  openMarkdownDb,
  parseFrontmatter,
  stripFrontmatter,
} from '../../../src/core/markdown';
import type {
  ConceptSummary,
  DocumentDescriptor,
  DocumentDetail,
  DocumentStatus,
  DocumentType,
  DomainSummary,
  FindFilter,
  FindPagedResult,
  KnowledgeStats,
  ReferenceTarget,
  ReferenceView,
  SourceType,
  TagSummary,
} from '../../../src/core/markdown';
import { DatabaseConnection } from '../../../src/core/db/index';
import { indexMarkdownKnowledgeBase } from '../../../src/core/markdown/indexer';

// ----- 类型导出的编译期检查(赋值即断言,运行时为零成本)-----------------

const typeChecks = (): void => {
  const dt: DocumentType = 'decision';
  const ds: DocumentStatus = 'active';
  const st: SourceType = 'work_context';
  const filter: FindFilter = {
    concept: 'x',
    concepts: ['x', 'y'],
    statuses: [ds],
    documentTypes: [dt],
  };
  const paged: FindPagedResult = { total: 0, items: [] as DocumentDescriptor[] };
  const stats: KnowledgeStats = {
    documentCount: 0,
    conceptCount: 0,
    domainCount: 0,
    tagCount: 0,
    latestIndexedAt: null,
    byType: Object.fromEntries(DOCUMENT_TYPES.map(t => [t, 0])) as Record<DocumentType, number>,
    byStatus: Object.fromEntries(DOCUMENT_STATUSES.map(s => [s, 0])) as Record<DocumentStatus, number>,
  };
  const summaries: Array<ConceptSummary | DomainSummary | TagSummary> = [];
  const detail: DocumentDetail | null = null;
  const view: ReferenceView = {
    documentId: 'i',
    documentTitle: 't',
    documentPath: 'p',
    outgoing: [] as ReferenceTarget[],
    incoming: [],
  };
  void [dt, ds, st, filter, paged, stats, summaries, detail, view];
};

describe('markdown subsystem facade', () => {
  it('exports exactly the contracted surface (no more, no less)', () => {
    expect(Object.keys(facade).sort()).toEqual([
      'DOCUMENT_STATUSES',
      'DOCUMENT_TYPES',
      'DocumentNotFoundError',
      'KNOWLEDGE_DIR',
      'MARKDOWN_SCHEMA_VERSION',
      'MarkdownIndexError',
      'MarkdownQuery',
      'ProjectNotInitializedError',
      'SchemaMismatchError',
      'SOURCE_TYPES',
      'getCurrentMarkdownSchemaVersion',
      'openMarkdownDb',
      'parseFrontmatter',
      'stripFrontmatter',
    ].sort());
  });

  it('does not leak MarkdownStore or MarkdownDocumentRow (Row 不外泄)', () => {
    const keys = Object.keys(facade);
    expect(keys).not.toContain('MarkdownStore');
    expect(keys).not.toContain('MarkdownDocumentRow');
    expect(keys).not.toContain('documentIdFromPath');
  });

  it('value exports are callable/constructable with correct types', () => {
    expect(typeof MarkdownQuery).toBe('function');
    expect(typeof openMarkdownDb).toBe('function');
    expect(typeof getCurrentMarkdownSchemaVersion).toBe('function');
    expect(typeof parseFrontmatter).toBe('function');
    expect(typeof stripFrontmatter).toBe('function');
    expect(typeof MarkdownIndexError).toBe('function');
    expect(typeof SchemaMismatchError).toBe('function');
    expect(typeof DocumentNotFoundError).toBe('function');
    expect(typeof ProjectNotInitializedError).toBe('function');
    expect(Array.isArray(DOCUMENT_TYPES)).toBe(true);
    expect(DOCUMENT_TYPES).toHaveLength(7);
    expect(DOCUMENT_STATUSES).toHaveLength(4);
    expect(SOURCE_TYPES.length).toBeGreaterThan(0);
    expect(KNOWLEDGE_DIR).toBe('docs/knowledge');
    expect(Number.isInteger(MARKDOWN_SCHEMA_VERSION)).toBe(true);
    expect(MARKDOWN_SCHEMA_VERSION).toBeGreaterThanOrEqual(1);
    // 错误层级:子类 instanceof 基类
    expect(new DocumentNotFoundError('x')).toBeInstanceOf(MarkdownIndexError);
    expect(new SchemaMismatchError(1, 2)).toBeInstanceOf(MarkdownIndexError);
    expect(new ProjectNotInitializedError('/p')).toBeInstanceOf(MarkdownIndexError);
    typeChecks();
  });
});

describe('MarkdownQuery.getStats via facade (spec §3.3)', () => {
  interface Project {
    root: string;
  }

  /** 3 篇 fixture:2 × decision/active + 1 × lesson/deprecated。 */
  function statsDoc(
    title: string,
    type: string,
    status: string,
    concepts: string[],
    domains: string[],
    tags: string[],
  ): string {
    return [
      '---',
      `title: ${title}`,
      `document_type: ${type}`,
      'domains:',
      ...domains.map(d => `  - ${d}`),
      'concepts:',
      ...concepts.map(c => `  - ${c}`),
      ...(tags.length > 0 ? ['tags:', ...tags.map(t => `  - ${t}`)] : []),
      `status: ${status}`,
      'source_type: work_context',
      'updated: 2026-06-27',
      '---',
      '',
      '## Summary',
      '',
      `${title} summary.`,
      '',
    ].join('\n');
  }

  async function makeProject(files: Record<string, string>): Promise<Project> {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cg-md-facade-'));
    const docsDir = path.join(root, 'docs', 'knowledge');
    fs.mkdirSync(docsDir, { recursive: true });
    for (const [relPath, content] of Object.entries(files)) {
      fs.writeFileSync(path.join(docsDir, relPath), content, 'utf-8');
    }
    const dbDir = path.join(root, '.cgraphx');
    fs.mkdirSync(dbDir, { recursive: true });
    const conn = DatabaseConnection.open(path.join(dbDir, 'cgraphx.db'));
    conn.close();
    return { root };
  }

  let project: Project;
  let q: MarkdownQuery;
  const tempRoots: string[] = [];

  beforeAll(async () => {
    project = await makeProject({
      'a.md': statsDoc('Stat A', 'decision', 'active', ['Alpha', 'Beta'], ['Core'], ['t1']),
      'b.md': statsDoc('Stat B', 'decision', 'active', ['Alpha'], ['Core', 'Web'], ['t1', 't2']),
      'c.md': statsDoc('Stat C', 'lesson', 'deprecated', ['Gamma'], ['Web'], []),
    });
    await indexMarkdownKnowledgeBase(project.root);
    const conn = openMarkdownDb(project.root);
    q = new MarkdownQuery(conn.getDb());
  });

  afterAll(() => {
    fs.rmSync(project.root, { recursive: true, force: true });
  });

  afterEach(() => {
    while (tempRoots.length > 0) {
      fs.rmSync(tempRoots.pop()!, { recursive: true, force: true });
    }
  });

  it('counts match the fixture', () => {
    const s = q.getStats();
    expect(s.documentCount).toBe(3);
    expect(s.conceptCount).toBe(3); // Alpha, Beta, Gamma
    expect(s.domainCount).toBe(2);  // Core, Web
    expect(s.tagCount).toBe(2);     // t1, t2
    expect(typeof s.latestIndexedAt).toBe('number');
    expect(s.latestIndexedAt).toBeGreaterThan(0);
  });

  it('byType carries all 7 keys with 0 defaults', () => {
    const s = q.getStats();
    expect(Object.keys(s.byType).sort()).toEqual([...DOCUMENT_TYPES].sort());
    expect(Object.keys(s.byType)).toHaveLength(7);
    expect(s.byType.decision).toBe(2);
    expect(s.byType.lesson).toBe(1);
    // 未出现的类型计数为 0
    for (const t of DOCUMENT_TYPES) {
      if (t !== 'decision' && t !== 'lesson') {
        expect(s.byType[t]).toBe(0);
      }
    }
  });

  it('byStatus carries all 4 keys with 0 defaults', () => {
    const s = q.getStats();
    expect(Object.keys(s.byStatus).sort()).toEqual([...DOCUMENT_STATUSES].sort());
    expect(s.byStatus.active).toBe(2);
    expect(s.byStatus.deprecated).toBe(1);
    expect(s.byStatus.draft).toBe(0);
    expect(s.byStatus.superseded).toBe(0);
  });

  it('empty knowledge base: zero counts and latestIndexedAt = null', async () => {
    const empty = await makeProject({});
    tempRoots.push(empty.root);
    const conn = openMarkdownDb(empty.root);
    try {
      const s = new MarkdownQuery(conn.getDb()).getStats();
      expect(s.documentCount).toBe(0);
      expect(s.conceptCount).toBe(0);
      expect(s.domainCount).toBe(0);
      expect(s.tagCount).toBe(0);
      expect(s.latestIndexedAt).toBeNull();
      expect(Object.keys(s.byType)).toHaveLength(7);
      for (const t of DOCUMENT_TYPES) expect(s.byType[t]).toBe(0);
      for (const st of DOCUMENT_STATUSES) expect(s.byStatus[st]).toBe(0);
    } finally {
      conn.close();
    }
  });
});
