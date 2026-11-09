import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { DatabaseConnection } from '../../../src/core/db/index';
import { ProjectNotInitializedError } from '../../../src/core/markdown/errors';
import { ensureKnowledgeIndexFresh, indexMarkdownKnowledgeBase } from '../../../src/core/markdown/indexer';
import { MarkdownQuery } from '../../../src/core/markdown/query';
import { openMarkdownDb } from '../../../src/core/markdown/schema-bootstrap';

const roots: string[] = [];

function doc(title: string, concept: string): string {
  return [
    '---',
    `title: ${title}`,
    'document_type: decision',
    'domains:',
    '  - 订单域',
    'concepts:',
    `  - ${concept}`,
    'status: active',
    'source_type: work_context',
    'updated: 2026-11-09',
    'owners:',
    '  - team',
    '---',
    '',
    '## Summary',
    `${title}的规则。`,
    '',
  ].join('\n');
}

function makeProject(files: Record<string, string>, opts: { db?: boolean; knowledge?: boolean } = {}): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cg-md-fresh-'));
  roots.push(root);
  if (opts.knowledge !== false) {
    const dir = path.join(root, 'docs', 'knowledge');
    fs.mkdirSync(dir, { recursive: true });
    for (const [name, content] of Object.entries(files)) fs.writeFileSync(path.join(dir, name), content, 'utf-8');
  }
  if (opts.db !== false) {
    fs.mkdirSync(path.join(root, '.cgraphx'), { recursive: true });
    DatabaseConnection.open(path.join(root, '.cgraphx', 'cgraphx.db')).close();
  }
  return root;
}

function titles(root: string): string[] {
  const conn = openMarkdownDb(root);
  try {
    return new MarkdownQuery(conn.getDb())
      .find({ limit: 100 })
      .map(d => d.title)
      .sort();
  } finally {
    conn.close();
  }
}

/** 把文件的修改时间往后拨,避免同一毫秒内的两次写入指纹相同。 */
function touchLater(file: string, seconds: number): void {
  const t = new Date(Date.now() + seconds * 1000);
  fs.utimesSync(file, t, t);
}

afterEach(() => {
  while (roots.length > 0) fs.rmSync(roots.pop()!, { recursive: true, force: true });
});

describe('ensureKnowledgeIndexFresh', () => {
  it('从没建过索引:第一次查询前建好', async () => {
    const root = makeProject({ 'a.md': doc('退订决策', '退订') });
    const result = await ensureKnowledgeIndexFresh(root);
    expect(result.refreshed).toBe(true);
    expect(result.report?.indexedDocuments).toBe(1);
    expect(titles(root)).toEqual(['退订决策']);
  });

  it('知识文件没变:不重建', async () => {
    const root = makeProject({ 'a.md': doc('退订决策', '退订') });
    await ensureKnowledgeIndexFresh(root);
    expect((await ensureKnowledgeIndexFresh(root)).refreshed).toBe(false);
  });

  it('改了、加了、删了知识文件:各重建一次,查到的是新内容', async () => {
    const root = makeProject({ 'a.md': doc('退订决策', '退订'), 'b.md': doc('调账规则', '调账') });
    await ensureKnowledgeIndexFresh(root);
    const dir = path.join(root, 'docs', 'knowledge');

    fs.writeFileSync(path.join(dir, 'a.md'), doc('退订决策(修订)', '退订'), 'utf-8');
    touchLater(path.join(dir, 'a.md'), 10);
    expect((await ensureKnowledgeIndexFresh(root)).refreshed).toBe(true);
    expect(titles(root)).toEqual(['调账规则', '退订决策(修订)']);

    fs.writeFileSync(path.join(dir, 'c.md'), doc('积分发放', '积分'), 'utf-8');
    expect((await ensureKnowledgeIndexFresh(root)).refreshed).toBe(true);
    expect(titles(root)).toEqual(['积分发放', '调账规则', '退订决策(修订)']);

    fs.rmSync(path.join(dir, 'b.md'));
    expect((await ensureKnowledgeIndexFresh(root)).refreshed).toBe(true);
    expect(titles(root)).toEqual(['积分发放', '退订决策(修订)']);
  });

  it('手动 docs index 之后:查询前不再重建', async () => {
    const root = makeProject({ 'a.md': doc('退订决策', '退订') });
    await indexMarkdownKnowledgeBase(root);
    expect((await ensureKnowledgeIndexFresh(root)).refreshed).toBe(false);
  });

  it('重建不清已探索入口名(seen-names 不是派生数据)', async () => {
    const root = makeProject({ 'a.md': doc('退订决策', '退订') });
    const conn = openMarkdownDb(root);
    try {
      new MarkdownQuery(conn.getDb()).addSeenNames(['OrderController']);
    } finally {
      conn.close();
    }
    expect((await ensureKnowledgeIndexFresh(root)).refreshed).toBe(true);
    const conn2 = openMarkdownDb(root);
    try {
      expect(new MarkdownQuery(conn2.getDb()).listSeenNames().names.map(n => n.original)).toEqual(['OrderController']);
    } finally {
      conn2.close();
    }
  });

  it('没有 docs/knowledge/:不动索引', async () => {
    const root = makeProject({}, { knowledge: false });
    expect(await ensureKnowledgeIndexFresh(root)).toEqual({ refreshed: false });
  });

  it('本地库不在:照旧报没装过', async () => {
    const root = makeProject({ 'a.md': doc('退订决策', '退订') }, { db: false });
    await expect(ensureKnowledgeIndexFresh(root)).rejects.toBeInstanceOf(ProjectNotInitializedError);
  });
});
