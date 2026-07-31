/**
 * MarkdownQuery.findPaged 测试矩阵(spec §3.3:列表不静默截断、呈现匹配总数)。
 *
 * 真实栈:mkdtemp 临时项目 + 写合法 frontmatter 的 .md + 真实索引 +
 * openMarkdownDb 构造 MarkdownQuery,无 mock。
 *
 * 主 fixture(42 篇)分布:
 *   - Doc 01..30: decision/active, concept Cycle, domain Core,
 *     tags 奇 alpha / 偶 beta,updated 2026-06-01..30
 *   - Lesson 01..04: lesson/deprecated, concept Retro, domain Ops,
 *     updated 2026-05-01..04
 *   - Lesson 05: lesson/deprecated, concepts [Cycle, Retro], 2026-05-05
 *   - Twin ×2: 同标题 'Twin',decision/active, concept Cycle,
 *     updated 2026-07-01 / 2026-07-02(title 排序 tie-break 夹具)
 *   - Ref A/B/C: concept Refs,引用链 C → A → B(referencesCount 夹具)
 *   - Zebra Decision(title 含 zebra,score 3)/ Striped Doc(仅 summary
 *     含 zebra,score 1):相关度排序夹具
 *
 * 计数:total 42;decision 37;lesson 5;Cycle 35;Retro 5;Refs 3。
 */

import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import { DatabaseConnection } from '../../../src/core/db/index';
import { indexMarkdownKnowledgeBase } from '../../../src/core/markdown/indexer';
import { MarkdownQuery } from '../../../src/core/markdown/query';
import { openMarkdownDb } from '../../../src/core/markdown/schema-bootstrap';

interface Project {
  root: string;
  docsDir: string;
  dbPath: string;
}

async function makeProject(files: Record<string, string>): Promise<Project> {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cg-md-paged-'));
  const docsDir = path.join(root, 'docs', 'knowledge');
  fs.mkdirSync(docsDir, { recursive: true });
  for (const [relPath, content] of Object.entries(files)) {
    const abs = path.join(docsDir, relPath);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, content, 'utf-8');
  }
  // 引导 .cgraphx/cgraphx.db(openMarkdownDb 要求库文件已存在)
  const dbDir = path.join(root, '.cgraphx');
  fs.mkdirSync(dbDir, { recursive: true });
  const dbPath = path.join(dbDir, 'cgraphx.db');
  const conn = DatabaseConnection.open(dbPath);
  conn.close();
  return { root, docsDir, dbPath };
}

/** 组装一篇合法 frontmatter 文档(字段缺省即走默认值)。 */
function md(
  title: string,
  opts: {
    type?: string;
    status?: string;
    concepts?: string[];
    domains?: string[];
    tags?: string[];
    owners?: string[];
    aliases?: string[];
    related?: string[];
    updated?: string;
    summary?: string;
  } = {},
): string {
  const list = (key: string, items: string[]): string[] =>
    items.length > 0 ? [`${key}:`, ...items.map(i => `  - ${i}`)] : [];
  const lines = [
    '---',
    `title: ${title}`,
    `document_type: ${opts.type ?? 'decision'}`,
    ...list('domains', opts.domains ?? ['Core']),
    ...list('concepts', opts.concepts ?? ['Cycle']),
    ...list('tags', opts.tags ?? []),
    ...list('owners', opts.owners ?? ['team']),
    ...list('aliases', opts.aliases ?? []),
    ...list('related_documents', opts.related ?? []),
    `status: ${opts.status ?? 'active'}`,
    'source_type: work_context',
    `updated: ${opts.updated ?? '2026-06-01'}`,
    '---',
    '',
    '## Summary',
    '',
    opts.summary ?? `${title} summary content.`,
    '',
  ];
  return lines.join('\n');
}

/** 主 fixture 文件表(42 篇)。 */
function mainFixture(): Record<string, string> {
  const files: Record<string, string> = {};
  for (let i = 1; i <= 30; i++) {
    const nn = String(i).padStart(2, '0');
    files[`d${nn}.md`] = md(`Doc ${nn}`, {
      tags: i % 2 === 1 ? ['alpha'] : ['beta'],
      updated: `2026-06-${nn}`,
      // owners/aliases 夹具:仅 Doc 01 携带(test 14)
      owners: i === 1 ? ['alice', 'bob'] : undefined,
      aliases: i === 1 ? ['first-doc'] : undefined,
    });
  }
  for (let i = 1; i <= 4; i++) {
    const nn = String(i).padStart(2, '0');
    files[`l${nn}.md`] = md(`Lesson ${nn}`, {
      type: 'lesson',
      status: 'deprecated',
      concepts: ['Retro'],
      domains: ['Ops'],
      updated: `2026-05-0${i}`,
    });
  }
  files['l05.md'] = md('Lesson 05', {
    type: 'lesson',
    status: 'deprecated',
    concepts: ['Cycle', 'Retro'],
    domains: ['Ops'],
    updated: '2026-05-05',
  });
  files['twin-a.md'] = md('Twin', { updated: '2026-07-01' });
  files['twin-b.md'] = md('Twin', { updated: '2026-07-02' });
  files['ref-a.md'] = md('Ref A', {
    concepts: ['Refs'],
    related: ['./ref-b.md'],
    updated: '2026-04-01',
  });
  files['ref-b.md'] = md('Ref B', { concepts: ['Refs'], updated: '2026-04-02' });
  files['ref-c.md'] = md('Ref C', {
    concepts: ['Refs'],
    related: ['./ref-a.md'],
    updated: '2026-04-03',
  });
  files['zebra.md'] = md('Zebra Decision', { updated: '2026-03-01' });
  files['striped.md'] = md('Striped Doc', {
    updated: '2026-03-02',
    // 与查询词 'Zebra' 同大小写:暴露分(computeScore 的 includes 区分大小写)
    // 才能与 SQL 相关度排序口径一致
    summary: 'About Zebra stripes.',
  });
  return files;
}

describe('MarkdownQuery.findPaged (spec §3.3)', () => {
  let project: Project;
  let q: MarkdownQuery;
  /** 用例内临时项目(afterEach 统一清理) */
  const tempRoots: string[] = [];

  beforeAll(async () => {
    project = await makeProject(mainFixture());
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

  // 1. total = 匹配总数,与 items.length 可不同(不静默截断)
  it('total equals match count and differs from items.length (limit=30, 42 docs)', () => {
    const res = q.findPaged({}, { limit: 30 });
    expect(res.total).toBe(42);
    expect(res.items).toHaveLength(30);
  });

  // 2. offset 切片:页间无重叠,拼起来等于全量有序集
  it('offset slicing: pages are disjoint and concatenate to the full ordered set', () => {
    const p1 = q.findPaged({}, { offset: 0, limit: 20 });
    const p2 = q.findPaged({}, { offset: 20, limit: 20 });
    const p3 = q.findPaged({}, { offset: 40, limit: 20 });
    expect(p1.total).toBe(42);
    expect(p2.total).toBe(42);
    expect(p1.items).toHaveLength(20);
    expect(p2.items).toHaveLength(20);
    expect(p3.items).toHaveLength(2);

    const ids1 = p1.items.map(d => d.id);
    const ids2 = p2.items.map(d => d.id);
    expect(ids1.filter(id => ids2.includes(id))).toEqual([]); // 无重叠

    // 与 find 全量(同一有序列表,默认 recency)逐序一致
    const all = q.find({ limit: 100 }).map(d => d.id);
    expect(all).toHaveLength(42);
    expect([...ids1, ...ids2, ...p3.items.map(d => d.id)]).toEqual(all);
  });

  // 3. 复数 documentTypes = 维度内 OR(并集)
  it("plural documentTypes ['decision','lesson'] equals union of singular queries", () => {
    const union = q.findPaged({ documentTypes: ['decision', 'lesson'] }, { limit: 100 });
    expect(union.total).toBe(42);
    const decisions = q.find({ documentType: 'decision', limit: 100 }).map(d => d.id);
    const lessons = q.find({ documentType: 'lesson', limit: 100 }).map(d => d.id);
    expect(decisions).toHaveLength(37);
    expect(lessons).toHaveLength(5);
    expect([...union.items.map(d => d.id)].sort()).toEqual([...decisions, ...lessons].sort());
  });

  // 4. 维度间 AND(类型 × 概念组合)
  it('cross-dimension AND: documentTypes × concepts intersects', () => {
    // (decision OR lesson) AND Cycle = 35(30 Doc + Twin×2 + Zebra + Striped + Lesson 05)
    expect(q.findPaged({ documentTypes: ['decision', 'lesson'], concepts: ['Cycle'] }).total).toBe(35);
    // lesson AND Cycle = 仅 Lesson 05
    const only = q.findPaged({ documentTypes: ['lesson'], concepts: ['Cycle'] });
    expect(only.total).toBe(1);
    expect(only.items[0]!.title).toBe('Lesson 05');
    // Retro 单维度 = 5
    expect(q.findPaged({ concepts: ['Retro'] }).total).toBe(5);
  });

  // 5. 单值 + 同维度复数共存 = 该维度两个约束取交
  it('singular + plural on same dimension intersect', () => {
    // concept Cycle AND concepts[Retro] → 同时含两个概念 → 仅 Lesson 05
    const both = q.findPaged({ concept: 'Cycle', concepts: ['Retro'] });
    expect(both.total).toBe(1);
    expect(both.items[0]!.title).toBe('Lesson 05');
    // documentType lesson AND documentTypes[decision,lesson] → lesson 全集
    expect(q.findPaged({ documentType: 'lesson', documentTypes: ['decision', 'lesson'] }).total).toBe(5);
  });

  // 6. 非法枚举值 → 空结果(与现有单值行为一致)
  it('illegal enum values yield empty result', () => {
    const badStatus = q.findPaged({ statuses: ['bogus' as never] });
    expect(badStatus).toEqual({ total: 0, items: [] });
    // 复数中夹一个非法值 → 整个维度空候选集 → 空结果
    // (exploration 为废除枚举值,新枚举契约下非法,见 spec §3.1)
    const mixed = q.findPaged({ documentTypes: ['decision', 'exploration' as never] });
    expect(mixed).toEqual({ total: 0, items: [] });
  });

  // 7. sort 'title':title ASC,并列 updated DESC(稳定)
  it("sort 'title' orders title ASC with updated DESC tie-break", () => {
    const res = q.findPaged({}, { sort: 'title', limit: 100 });
    const titles = res.items.map(d => d.title);
    expect(titles).toEqual([...titles].sort());
    // Twin 并列:updated 大者在前
    const i = titles.indexOf('Twin');
    expect(i).toBeGreaterThan(-1);
    expect(titles[i + 1]).toBe('Twin');
    expect(res.items[i]!.updatedAt).toBe('2026-07-02');
    expect(res.items[i + 1]!.updatedAt).toBe('2026-07-01');
  });

  // 8. 有 q 时缺省排序 = 相关度(score 保留)
  it('default sort with q is relevance and keeps score', () => {
    const res = q.findPaged({ q: 'Zebra' });
    expect(res.total).toBe(2);
    // title 命中(+2)+ summary 命中(+1)= 3,排在仅 summary 命中(1)之前
    expect(res.items[0]!.title).toBe('Zebra Decision');
    expect(res.items[0]!.score).toBe(3);
    expect(res.items[1]!.title).toBe('Striped Doc');
    expect(res.items[1]!.score).toBe(1);
  });

  // 9. offset 非整数 / 负数 → TypeError(注入边界)
  it('non-integer or negative offset throws TypeError', () => {
    expect(() => q.findPaged({}, { offset: 1.5 })).toThrow(TypeError);
    expect(() => q.findPaged({}, { offset: -1 })).toThrow(TypeError);
    expect(() => q.findPaged({}, { offset: '5' as never })).toThrow(TypeError);
  });

  // 10. limit 钳制:超 100 → 100;低于 1 → 1
  it('limit clamps to [1, 100]', async () => {
    // 105 篇的独立项目验证上限钳制
    const files: Record<string, string> = {};
    for (let i = 1; i <= 105; i++) {
      files[`m${i}.md`] = md(`Mass ${String(i).padStart(3, '0')}`, { concepts: ['Bulk'] });
    }
    const big = await makeProject(files);
    tempRoots.push(big.root);
    await indexMarkdownKnowledgeBase(big.root);
    const conn = openMarkdownDb(big.root);
    try {
      const bq = new MarkdownQuery(conn.getDb());
      const res = bq.findPaged({}, { limit: 500 });
      expect(res.total).toBe(105);
      expect(res.items).toHaveLength(100);
    } finally {
      conn.close();
    }

    // 下限钳制:limit 0 → 1
    expect(q.findPaged({}, { limit: 0 }).items).toHaveLength(1);
  });

  // 11. 空库 → total 0 / items []
  it('empty knowledge base returns total=0 and empty items', async () => {
    const empty = await makeProject({});
    tempRoots.push(empty.root);
    const conn = openMarkdownDb(empty.root); // 应用 schema,表为空
    try {
      const eq = new MarkdownQuery(conn.getDb());
      expect(eq.findPaged({})).toEqual({ total: 0, items: [] });
    } finally {
      conn.close();
    }
  });

  // 12. CLI 回归基线:同参数 find 输出 JSON 化后逐字段相等(spec §7)
  it('find output stays byte-stable: exact keys and field values (spec §7)', () => {
    const rows = q.find({ concept: 'Retro', limit: 1 });
    expect(rows).toHaveLength(1);
    const first = rows[0]!;

    // 键集合逐字节不变:12 个键(score 恒在、无 q 时为 undefined,
    // 与重构前一致);无 referencesCount/owners/aliases
    expect(Object.keys(first)).toEqual([
      'id', 'path', 'title', 'documentType', 'status', 'sourceType',
      'updatedAt', 'summary', 'concepts', 'domains', 'tags', 'score',
    ]);
    expect(first.score).toBeUndefined();

    // id = sha256(项目相对路径)
    const expectedId = crypto
      .createHash('sha256')
      .update('docs/knowledge/l05.md')
      .digest('hex');

    // JSON 化后与预期逐字段相等(score 为 undefined,序列化后无此键)
    expect(JSON.parse(JSON.stringify(first))).toEqual({
      id: expectedId,
      path: 'docs/knowledge/l05.md',
      title: 'Lesson 05',
      documentType: 'lesson',
      status: 'deprecated',
      sourceType: 'work_context',
      updatedAt: '2026-05-05',
      summary: 'Lesson 05 summary content.',
      concepts: ['Cycle', 'Retro'],
      domains: ['Ops'],
      tags: [],
    });
  });

  // 13. referencesCount = 出向 + 入向(当页一条 IN 聚合查询)
  it('referencesCount sums outgoing and incoming references', () => {
    // 引用链:Ref C → Ref A → Ref B
    const res = q.findPaged({ concepts: ['Refs'] }, { sort: 'title' });
    expect(res.total).toBe(3);
    const byTitle = Object.fromEntries(res.items.map(d => [d.title, d]));
    expect(byTitle['Ref A']!.referencesCount).toBe(2); // 出 1(→B)+ 入 1(C→)
    expect(byTitle['Ref B']!.referencesCount).toBe(1); // 入 1(A→)
    expect(byTitle['Ref C']!.referencesCount).toBe(1); // 出 1(→A)

    // 无引用文档 → 0(而非 undefined)
    const cycle = q.findPaged({ concepts: ['Cycle'] }, { limit: 5 });
    for (const item of cycle.items) {
      expect(item.referencesCount).toBe(0);
    }
  });

  // 14. owners/aliases:findPaged 填充;find 输出不含这三个扩展键
  it('findPaged fills owners/aliases; find output omits extension keys', () => {
    const res = q.findPaged({ concepts: ['Cycle'] }, { sort: 'title', limit: 1 });
    expect(res.items[0]!.title).toBe('Doc 01');
    expect(res.items[0]!.owners).toEqual(['alice', 'bob']);
    expect(res.items[0]!.aliases).toEqual(['first-doc']);

    // find 输出:扩展键不出现(CLI 面逐字节不变)
    const cliFirst = q.find({ concepts: ['Cycle'], limit: 1 })[0]!;
    const cliDoc01 = q.find({ concept: 'Cycle', limit: 100 })
      .find(d => d.title === 'Doc 01')!;
    for (const key of ['referencesCount', 'owners', 'aliases'] as const) {
      expect(cliFirst).not.toHaveProperty(key);
      expect(cliDoc01).not.toHaveProperty(key);
    }
    // JSON 面同样干净(score 为 undefined,序列化时被丢弃)
    const json = JSON.parse(JSON.stringify(cliDoc01));
    expect(Object.keys(json)).toEqual([
      'id', 'path', 'title', 'documentType', 'status', 'sourceType',
      'updatedAt', 'summary', 'concepts', 'domains', 'tags',
    ]);
  });
});
