/**
 * 文档详情页测试(T-B-4,spec §3.4/§5.2/§8/§11 #6/#7)。
 *
 * 真实栈(禁 vi.mock):mkdtemp 临时项目 + createDirectory + 真实 SQLite
 * (ensureMarkdownSchema + ensureTimelineSchema)+ 内联写入合法 frontmatter
 * 的 .md + indexMarkdownKnowledgeBase 真实索引 + startWebServer({ port: 0 })
 * + 全局 fetch;afterEach 清理。
 *
 * fixture 构成本身直连子系统内部模块(ensure*Schema / indexer)—— 那是夹具
 * 搭建而非 web 行为;web 生产代码只经门面消费(由 tsc + 代码审查保证)。
 *
 * fixture(3 篇,构成双向引用):
 *   main.md  business-entity active 派单/运力 [派单池,运力] owners[alice] aliases[DP-DECISION]
 *            related_code[src/dispatch/pool.ts] created 2026-07-01 updated 2026-07-10
 *            tags[](空 → 占位) related[other.md];正文含 H2/表格/代码块/引用块/列表
 *            + 原始 HTML(<b>raw</b>、<script>alert(1)</script>)。
 *   other.md business-flow 「其他笔记」     —— main 的出向引用目标。
 *   third.md rule 「第三方引用笔记」 related[main.md] —— main 的入向引用来源。
 */

import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { startWebServer, type WebServer } from '../../src/web';
import { createDirectory } from '../../src/core/directory';
import { DatabaseConnection, getDatabasePath } from '../../src/core/db';
import { ensureMarkdownSchema } from '../../src/core/markdown/schema-bootstrap';
import { ensureTimelineSchema } from '../../src/core/timeline/schema-bootstrap';
import { indexMarkdownKnowledgeBase } from '../../src/core/markdown/indexer';

let tmp: string;
const servers: WebServer[] = [];

/** 文档 ID = sha256(项目相对路径)(与 store.ts 同算法,测试侧确定性推导)。 */
function docId(relPath: string): string {
  return crypto.createHash('sha256').update(relPath).digest('hex');
}

const MAIN_PATH = 'docs/knowledge/main.md';
const OTHER_PATH = 'docs/knowledge/other.md';
const THIRD_PATH = 'docs/knowledge/third.md';

/** 初始化项目骨架(.cgraphx + markdown/timeline schema)。夹具搭建,非 web 行为。 */
function initProject(projectRoot: string): void {
  createDirectory(projectRoot);
  const conn = DatabaseConnection.open(getDatabasePath(projectRoot));
  try {
    ensureMarkdownSchema(conn.getDb());
    ensureTimelineSchema(conn.getDb());
  } finally {
    conn.close();
  }
}

/** 组装一篇合法 frontmatter 文档(支持 created / related_code / 自定义正文)。 */
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
    relatedCode?: string[];
    related?: string[];
    created?: string;
    updated?: string;
    body?: string;
  } = {},
): string {
  const list = (key: string, items: string[]): string[] =>
    items.length > 0 ? [`${key}:`, ...items.map((i) => `  - ${i}`)] : [];
  const lines = [
    '---',
    `title: ${title}`,
    `document_type: ${opts.type ?? 'decision'}`,
    ...list('domains', opts.domains ?? ['派单']),
    ...list('concepts', opts.concepts ?? ['派单池']),
    ...list('tags', opts.tags ?? []),
    ...list('owners', opts.owners ?? []),
    ...list('aliases', opts.aliases ?? []),
    ...list('related_code', opts.relatedCode ?? []),
    ...list('related_documents', opts.related ?? []),
    `status: ${opts.status ?? 'active'}`,
    'source_type: work_context',
    ...(opts.created !== undefined ? [`created: ${opts.created}`] : []),
    `updated: ${opts.updated ?? '2026-06-01'}`,
    '---',
    '',
    opts.body ?? `${title} 正文内容。`,
    '',
  ];
  return lines.join('\n');
}

/** 主文档正文:H2 / 段落 / 表格 / 围栏代码 / 引用块 / 列表 / 原始 HTML。 */
const MAIN_BODY = [
  '## 正文标题',
  '',
  '这是第一段正文,含行内 `inline code`。',
  '',
  '| 列A | 列B |',
  '| --- | --- |',
  '| 1 | 2 |',
  '',
  '```js',
  'const answer = 42;',
  '```',
  '',
  '> 这是一段引用块',
  '',
  '- 列表项甲',
  '- 列表项乙',
  '',
  '原始 HTML 测试:<b>raw</b> 与 <script>alert(1)</script>。',
].join('\n');

function writeDoc(projectRoot: string, fileName: string, content: string): void {
  const dir = path.join(projectRoot, 'docs', 'knowledge');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, fileName), content, 'utf-8');
}

/** fixture:3 篇(main + 出向目标 other + 入向来源 third)。 */
async function makeProject(): Promise<void> {
  initProject(tmp);
  writeDoc(tmp, 'main.md', md('派单池分配策略决策', {
    type: 'business-entity', status: 'active', domains: ['派单', '运力'],
    concepts: ['派单池', '运力'], tags: [], owners: ['alice'], aliases: ['DP-DECISION'],
    relatedCode: ['src/dispatch/pool.ts'], related: ['other.md'],
    created: '2026-07-01', updated: '2026-07-10', body: MAIN_BODY,
  }));
  writeDoc(tmp, 'other.md', md('其他笔记', {
    type: 'business-flow', status: 'active', domains: ['派单'], concepts: ['派单池'], updated: '2026-07-09',
  }));
  writeDoc(tmp, 'third.md', md('第三方引用笔记', {
    type: 'rule', status: 'active', domains: ['派单'], concepts: ['派单池'],
    related: ['main.md'], updated: '2026-07-08',
  }));

  const report = await indexMarkdownKnowledgeBase(tmp);
  expect(report.indexedDocuments).toBe(3); // fixture sanity
  expect(report.skippedFiles).toBe(0);
  expect(report.danglingReferences).toBe(0); // 引用边均解析成功
}

async function startServer(): Promise<WebServer> {
  const srv = await startWebServer({ projectRoot: tmp, port: 0 });
  servers.push(srv);
  return srv;
}

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'web-detail-test-'));
});

afterEach(async () => {
  for (const srv of servers) {
    await srv.close().catch(() => {});
  }
  servers.length = 0;
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe('knowledge detail page (integration)', () => {
  it('1. renders the full markdown body: headings/table/code/blockquote/list, frontmatter stripped (spec §3.4)', async () => {
    await makeProject();
    const srv = await startServer();

    const res = await fetch(`${srv.url}/doc/${encodeURIComponent(MAIN_PATH)}`);
    expect(res.status).toBe(200);
    const html = await res.text();

    // 正文要素:标题层级 / 表格 / 行内与围栏代码 / 引用块 / 列表。
    expect(html).toContain('<h2>正文标题</h2>');
    expect(html).toContain('<table>');
    expect(html).toContain('<code>inline code</code>');
    expect(html).toContain('<pre><code class="language-js">');
    expect(html).toContain('<blockquote>');
    expect(html).toContain('<li>列表项甲</li>');

    // frontmatter 块已剥离:YAML 键只存在于 frontmatter,模板从不输出它们。
    expect(html).not.toContain('document_type:');
    expect(html).not.toContain('source_type:');
    expect(html).not.toContain('related_documents:');
  });

  it('2. renders all eight metadata groups with fixture values; empty tags -> placeholder (spec §3.4)', async () => {
    await makeProject();
    const srv = await startServer();
    const html = await (await fetch(`${srv.url}/doc/${docId(MAIN_PATH)}`)).text();

    // 八组标签齐全。
    for (const lab of ['负责人', '领域', '创建时间', '更新时间', '概念', '标签', '相关代码', '索引时间']) {
      expect(html).toContain(lab);
    }
    // 值与 fixture frontmatter 一致。
    expect(html).toContain('alice'); // owners
    expect(html).toContain('派单'); // domains
    expect(html).toContain('运力'); // domains
    expect(html).toContain('派单池'); // concepts
    expect(html).toContain('src/dispatch/pool.ts'); // related_code(等宽)
    expect(html).toContain('2026-07-01'); // created(纯日期原样)
    expect(html).toContain('2026-07-10'); // updated(纯日期原样)
    // 索引时间:epoch ms → <time data-local-time>(浏览器本地化挂点,spec §11 #6)。
    expect(html).toMatch(/索引时间[\s\S]*?<time datetime="[^"]+" data-local-time>/);

    // 空 tags 渲染占位(负责人单元格有值,标签单元格为占位)。
    const ownersFrom = html.indexOf('负责人 <i>OWNERS</i>');
    const ownersTo = html.indexOf('领域 <i>DOMAINS</i>');
    expect(html.slice(ownersFrom, ownersTo)).toContain('alice');
    expect(html.slice(ownersFrom, ownersTo)).not.toContain('meta__empty');
    const tagsFrom = html.indexOf('标签 <i>TAGS</i>');
    const tagsTo = html.indexOf('相关代码 <i>RELATED CODE</i>');
    expect(html.slice(tagsFrom, tagsTo)).toContain('meta__empty');
    expect(html.slice(tagsFrom, tagsTo)).toContain('—');
  });

  it('3. resolves ident by both document ID and project-relative path, same output (spec §3.4)', async () => {
    await makeProject();
    const srv = await startServer();

    const byPathRes = await fetch(`${srv.url}/doc/${encodeURIComponent(MAIN_PATH)}`);
    expect(byPathRes.status).toBe(200);
    const byPath = await byPathRes.text();
    // 文档标识区展示该文档的 64 位十六进制 ID。
    expect(byPath).toContain(`detail__docid">${docId(MAIN_PATH)}</code>`);
    expect(byPath).toContain(`<code class="detail__path">${MAIN_PATH}</code>`);

    const byIdRes = await fetch(`${srv.url}/doc/${docId(MAIN_PATH)}`);
    expect(byIdRes.status).toBe(200);
    const byId = await byIdRes.text();

    // 两种 ident 解析到同一文档 → 输出逐字节一致。
    expect(byId).toBe(byPath);
  });

  it('4. partitions bidirectional references and links each to /doc/<id> (spec §3.4)', async () => {
    await makeProject();
    const srv = await startServer();
    const html = await (await fetch(`${srv.url}/doc/${docId(MAIN_PATH)}`)).text();

    const otherId = docId(OTHER_PATH);
    const thirdId = docId(THIRD_PATH);

    // 分区计数:出向 1(other)、入向 1(third)。
    expect(html).toContain('引用 →(1)');
    expect(html).toContain('← 被引用(1)');

    // 切分出向区(「引用 →」与「← 被引用」之间)与入向区(「← 被引用」之后)。
    const outFrom = html.indexOf('引用 →(1)');
    const inFrom = html.indexOf('← 被引用(1)');
    expect(outFrom).toBeGreaterThan(-1);
    expect(inFrom).toBeGreaterThan(outFrom);
    const outgoing = html.slice(outFrom, inFrom);
    const incoming = html.slice(inFrom);

    // 出向区:链接指向 other,标题/路径呈现;不含入向目标。
    expect(outgoing).toContain(`href="/doc/${otherId}"`);
    expect(outgoing).toContain('其他笔记');
    expect(outgoing).toContain(OTHER_PATH);
    expect(outgoing).not.toContain(thirdId);

    // 入向区:链接指向 third,标题呈现;不含出向目标。
    expect(incoming).toContain(`href="/doc/${thirdId}"`);
    expect(incoming).toContain('第三方引用笔记');
    expect(incoming).not.toContain(otherId);
  });

  it('5. unknown ident -> 404 page with escaped ident echo and a home link (spec §8)', async () => {
    await makeProject();
    const srv = await startServer();

    const res = await fetch(`${srv.url}/doc/no-such-doc`);
    expect(res.status).toBe(404);
    const html = await res.text();
    expect(html).toContain('文档未找到');
    expect(html).toContain('no-such-doc'); // ident 回显
    expect(html).toContain('href="/"'); // 回首页入口

    // 回显经转义:HTML 形态的 ident 不产生可执行标签。
    const xss = await (await fetch(`${srv.url}/doc/%3Cb%3Eboom`)).text();
    expect(xss).toContain('&lt;b&gt;boom');
    expect(xss).not.toContain('<b>boom');
  });

  it('6. missing source file -> 200 with metadata intact and a missing-source notice (spec §8, §5.2)', async () => {
    await makeProject();
    const srv = await startServer();

    const before = await (await fetch(`${srv.url}/doc/${docId(MAIN_PATH)}`)).text();
    expect(before).toContain('<h2>正文标题</h2>'); // 源文件在 → 全文渲染

    fs.rmSync(path.join(tmp, 'docs', 'knowledge', 'main.md'));

    const res = await fetch(`${srv.url}/doc/${docId(MAIN_PATH)}`);
    expect(res.status).toBe(200); // 不是错误页
    const html = await res.text();
    // 元数据照常渲染。
    expect(html).toContain('派单池分配策略决策');
    expect(html).toContain('alice');
    // 全文区呈现缺失提示 + 项目相对路径(转义)。
    expect(html).toContain('源文件缺失或不可读');
    expect(html).toContain(MAIN_PATH);
    // 全文不再渲染。
    expect(html).not.toContain('<h2>正文标题</h2>');
  });

  it('7. path boundary: traversal ident -> 404 never serving file content; body XSS escaped (spec §5.2, §3.2)', async () => {
    await makeProject();
    const srv = await startServer();

    // %2f 编码的穿越 ident:解析后不是索引中的文档 → 404,绝不返回文件内容。
    const trav = await fetch(`${srv.url}/doc/..%2f..%2fpackage.json`);
    expect(trav.status).toBe(404);
    const travBody = await trav.text();
    expect(travBody).toContain('文档未找到');
    expect(travBody).not.toContain('"name": "cgraphx"'); // package.json 内容未泄漏

    // 正文内 <script>:html:false → 转义文本,无可执行 script 标签。
    const html = await (await fetch(`${srv.url}/doc/${docId(MAIN_PATH)}`)).text();
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
  });

  it('8. escapes raw HTML in markdown (html:false takes effect, spec §3.2)', async () => {
    await makeProject();
    const srv = await startServer();
    const html = await (await fetch(`${srv.url}/doc/${docId(MAIN_PATH)}`)).text();

    expect(html).toContain('&lt;b&gt;raw&lt;/b&gt;');
    expect(html).not.toContain('<b>raw</b>');
  });
});
