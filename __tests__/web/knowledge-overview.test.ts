/**
 * 知识库总览页测试(T-B-3,spec §3.2/§3.3/§4.2/§8/§11 #4/#5/#10/#12)。
 *
 * 真实栈(禁 vi.mock):mkdtemp 临时项目 + createDirectory + 真实 SQLite
 * (ensureMarkdownSchema + ensureTimelineSchema)+ 内联写入合法 frontmatter
 * 的 .md + indexMarkdownKnowledgeBase 真实索引 + startWebServer({ port: 0 })
 * + 全局 fetch;afterEach 清理。
 *
 * fixture 构成本身会直连子系统内部模块(ensure*Schema / indexer)—— 那是
 * 夹具搭建而非 web 行为;web 生产代码只经门面消费(由 tsc + 代码审查保证)。
 *
 * 主 fixture(9 篇)分布:
 *   d1 decision active 派单 [派单池, 运力] tags[dispatch] owners[alice]
 *      aliases[DP-DECISION] 2026-07-10 「派单池分配策略决策」
 *   d2 decision active 派单 [派单池] owners[alice, bob] 2026-07-09
 *      「高峰期派单降级决策」 related[d1.md]
 *   d3 decision draft  订单 [派单池, 订单] 2026-07-08 「订单派单灰度决策」
 *   d4 lesson   active 派单 [派单池] tags[dispatch, incident] 2026-07-07
 *      「派单超时事故复盘教训」
 *   d5 business-entity active 订单 [订单] 2026-07-12 「订单实体概念」(摘要含「履约」)
 *   d6 guide    draft  订单 [订单] 2026-07-05 「订单查询接口」
 *   d7 mechanism deprecated 基础设施 [缓存] 2026-06-30 「缓存穿透风险警示」
 *   d8 rule     draft  基础设施 [缓存] 2026-07-01 「<script>alert(1)</script> 安全笔记」
 *   d9 guide    superseded 基础设施 [缓存, 派单池] 2026-07-15 「缓存运维指南」
 *
 * 计数:文档 9 / 概念 4(派单池 5、订单 3、缓存 3、运力 1)/ 领域 3 / 标签 2;
 * byType decision=3(最高)、guide=2、lesson/business-entity/mechanism/rule 各 1、
 * business-flow=0(0 计数芯片仍渲染)/ byStatus active=4、draft=3、deprecated=1、superseded=1。
 */

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
import { DOCUMENT_TYPES } from '../../src/core/markdown';
import {
  buildOverviewUrl,
  parseOverviewQuery,
  withConceptAdded,
  withoutValue,
  type OverviewQuery,
} from '../../src/web/pages-overview';

let tmp: string;
const servers: WebServer[] = [];

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

/** 组装一篇合法 frontmatter 文档(与 find-paged.test.ts 同构)。 */
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

function writeDoc(projectRoot: string, fileName: string, content: string): void {
  const dir = path.join(projectRoot, 'docs', 'knowledge');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, fileName), content, 'utf-8');
}

/** 主 fixture:9 篇(≥3 类型、含 draft、≥2 领域、共享概念)。 */
async function makeMainProject(): Promise<void> {
  initProject(tmp);
  writeDoc(tmp, 'd1.md', md('派单池分配策略决策', {
    type: 'decision', status: 'active', domains: ['派单'], concepts: ['派单池', '运力'],
    tags: ['dispatch'], owners: ['alice'], aliases: ['DP-DECISION'], updated: '2026-07-10',
  }));
  writeDoc(tmp, 'd2.md', md('高峰期派单降级决策', {
    type: 'decision', status: 'active', domains: ['派单'], concepts: ['派单池'],
    owners: ['alice', 'bob'], related: ['d1.md'], updated: '2026-07-09',
  }));
  writeDoc(tmp, 'd3.md', md('订单派单灰度决策', {
    type: 'decision', status: 'draft', domains: ['订单'], concepts: ['派单池', '订单'],
    updated: '2026-07-08',
  }));
  writeDoc(tmp, 'd4.md', md('派单超时事故复盘教训', {
    type: 'lesson', status: 'active', domains: ['派单'], concepts: ['派单池'],
    tags: ['dispatch', 'incident'], updated: '2026-07-07',
  }));
  writeDoc(tmp, 'd5.md', md('订单实体概念', {
    type: 'business-entity', status: 'active', domains: ['订单'], concepts: ['订单'],
    updated: '2026-07-12', summary: '订单实体概念,覆盖履约全流程。',
  }));
  writeDoc(tmp, 'd6.md', md('订单查询接口', {
    type: 'guide', status: 'draft', domains: ['订单'], concepts: ['订单'], updated: '2026-07-05',
  }));
  writeDoc(tmp, 'd7.md', md('缓存穿透风险警示', {
    type: 'mechanism', status: 'deprecated', domains: ['基础设施'], concepts: ['缓存'],
    updated: '2026-06-30',
  }));
  writeDoc(tmp, 'd8.md', md('<script>alert(1)</script> 安全笔记', {
    type: 'rule', status: 'draft', domains: ['基础设施'], concepts: ['缓存'], updated: '2026-07-01',
  }));
  writeDoc(tmp, 'd9.md', md('缓存运维指南', {
    type: 'guide', status: 'superseded', domains: ['基础设施'], concepts: ['缓存', '派单池'],
    updated: '2026-07-15',
  }));

  const report = await indexMarkdownKnowledgeBase(tmp);
  expect(report.indexedDocuments).toBe(9); // fixture sanity
  expect(report.skippedFiles).toBe(0);
}

/** 分页 fixture:31 篇同构文档。 */
async function makePagedProject(): Promise<void> {
  initProject(tmp);
  for (let i = 1; i <= 31; i++) {
    const nn = String(i).padStart(2, '0');
    writeDoc(tmp, `b${nn}.md`, md(`批量文档 ${nn}`, {
      type: 'business-flow', status: 'active', domains: ['批量'], concepts: ['批量概念'],
      updated: `2026-05-${nn}`,
    }));
  }
  const report = await indexMarkdownKnowledgeBase(tmp);
  expect(report.indexedDocuments).toBe(31);
}

async function startServer(): Promise<WebServer> {
  const srv = await startWebServer({ projectRoot: tmp, port: 0 });
  servers.push(srv);
  return srv;
}

/** 文档卡数量(markup 锚点:`class="doc doc--<tone>"`)。 */
function countCards(html: string): number {
  return (html.match(/class="doc doc--/g) ?? []).length;
}

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'web-overview-test-'));
});

afterEach(async () => {
  for (const srv of servers) {
    await srv.close().catch(() => {});
  }
  servers.length = 0;
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe('knowledge overview page (integration)', () => {
  it('1. renders statbar counts from the index and the latest indexed time (spec §3.3, §4.2, §11 #5)', async () => {
    await makeMainProject();
    const srv = await startServer();

    const res = await fetch(`${srv.url}/`);
    expect(res.status).toBe(200);
    const html = await res.text();

    // 统计条四数与 fixture 一致:文档 9 / 概念 4 / 领域 3 / 标签 2。
    expect(html).toContain('stat__num">9</div>');
    expect(html).toContain('stat__num">4</div>');
    expect(html).toContain('stat__num">3</div>');
    expect(html).toContain('stat__num">2</div>');

    // 最近索引时间可见(<time datetime=...> + 本地化挂点)。
    expect(html).toContain('最近索引');
    expect(html).toMatch(/statbar__indexed-value" datetime="[^"]+" data-local-time/);
    // findPaged hydrate 的引用数呈现(d1/d2 互为引用 → 引用 1)。
    expect(html).toContain('引用 1');
  });

  it('2. renders all 7 new enum type chips sorted by count desc (spec §3.3, §11 #4)', async () => {
    await makeMainProject();
    const srv = await startServer();
    const html = await (await fetch(`${srv.url}/`)).text();

    // 7 种类型英文原值全部渲染(0 计数也显示)。
    for (const t of DOCUMENT_TYPES) {
      expect(html).toContain(`chip__en">${t}</span>`);
    }
    // 按计数降序:类型组首个芯片为最高计数类型 decision(3 篇)。
    const from = html.indexOf('文档类型 <i>TYPE</i>');
    const to = html.indexOf('状态 <i>STATUS</i>');
    expect(from).toBeGreaterThan(-1);
    expect(to).toBeGreaterThan(from);
    const block = html.slice(from, to);
    const first = /chip__en">([a-z]+)</.exec(block);
    expect(first?.[1]).toBe('decision');
  });

  it('3. filters by type; repeated type params form a union (spec §3.3)', async () => {
    await makeMainProject();
    const srv = await startServer();

    const one = await (await fetch(`${srv.url}/?type=decision`)).text();
    expect(countCards(one)).toBe(3);
    expect(one).toContain('派单池分配策略决策');
    expect(one).toContain('高峰期派单降级决策');
    expect(one).toContain('订单派单灰度决策');
    expect(one).not.toContain('订单实体概念');
    expect(one).not.toContain('缓存运维指南');

    const union = await (await fetch(`${srv.url}/?type=decision&type=lesson`)).text();
    expect(countCards(union)).toBe(4);
    expect(union).toContain('派单超时事故复盘教训');
  });

  it('4. filters by status / domain / concept; cross-dimension is AND (spec §3.3)', async () => {
    await makeMainProject();
    const srv = await startServer();

    const draft = await (await fetch(`${srv.url}/?status=draft`)).text();
    expect(countCards(draft)).toBe(3);
    expect(draft).toContain('订单派单灰度决策');
    expect(draft).toContain('订单查询接口');

    const domain = await (await fetch(`${srv.url}/?domain=${encodeURIComponent('订单')}`)).text();
    expect(countCards(domain)).toBe(3);
    expect(domain).toContain('订单实体概念');
    expect(domain).not.toContain('派单池分配策略决策');

    const concept = await (await fetch(`${srv.url}/?concept=${encodeURIComponent('订单')}`)).text();
    expect(countCards(concept)).toBe(3);

    // 类型 × 概念 = AND:decision ∩ 派单池 = d1/d2/d3(不含 lesson 的 d4)。
    const and = await (
      await fetch(`${srv.url}/?type=decision&concept=${encodeURIComponent('派单池')}`)
    ).text();
    expect(countCards(and)).toBe(3);
    expect(and).toContain('订单派单灰度决策');
    expect(and).not.toContain('派单超时事故复盘教训');
  });

  it('5. keyword search hits title/summary; combines with type as AND (spec §3.3)', async () => {
    await makeMainProject();
    const srv = await startServer();

    const byTitle = await (await fetch(`${srv.url}/?q=${encodeURIComponent('灰度')}`)).text();
    expect(countCards(byTitle)).toBe(1);
    expect(byTitle).toContain('订单派单灰度决策');

    const bySummary = await (await fetch(`${srv.url}/?q=${encodeURIComponent('履约')}`)).text();
    expect(countCards(bySummary)).toBe(1);
    expect(bySummary).toContain('订单实体概念');

    const and = await (
      await fetch(`${srv.url}/?q=${encodeURIComponent('灰度')}&type=decision`)
    ).text();
    expect(countCards(and)).toBe(1);

    // q × type = AND:灰度 ∩ lesson = 0 命中 → 空态②。
    const none = await (
      await fetch(`${srv.url}/?q=${encodeURIComponent('灰度')}&type=lesson`)
    ).text();
    expect(countCards(none)).toBe(0);
    expect(none).toContain('没有匹配的文档');
  });

  it('6. sort=title differs from default updated order, both ordered (spec §3.3)', async () => {
    await makeMainProject();
    const srv = await startServer();

    // 缺省 = updated 降序:d9(2026-07-15)先于 d1(2026-07-10)。
    const byUpdated = await (await fetch(`${srv.url}/`)).text();
    expect(byUpdated.indexOf('缓存运维指南')).toBeGreaterThan(-1);
    expect(byUpdated.indexOf('缓存运维指南')).toBeLessThan(
      byUpdated.indexOf('派单池分配策略决策'),
    );

    // title 升序(SQL 码点序):「<script>…」(0x3C)最先,派(6D3E) 先于 订(8BA2)。
    const byTitle = await (await fetch(`${srv.url}/?sort=title`)).text();
    expect(byTitle.indexOf('alert(1)')).toBeGreaterThan(-1);
    expect(byTitle.indexOf('alert(1)')).toBeLessThan(byTitle.indexOf('派单池分配策略决策'));
    expect(byTitle.indexOf('派单池分配策略决策')).toBeLessThan(
      byTitle.indexOf('订单查询接口'),
    );
    // 两种排序输出确实不同。
    expect(byTitle.indexOf('缓存运维指南')).toBeGreaterThan(
      byTitle.indexOf('派单池分配策略决策'),
    );
  });

  it('7. paginates 31 docs: 30 per page, total visible, out-of-range clamps to last (spec §11 #10)', async () => {
    await makePagedProject();
    const srv = await startServer();

    const p1 = await (await fetch(`${srv.url}/`)).text();
    expect(countCards(p1)).toBe(30);
    expect(p1).toContain('共 31 篇');
    expect(p1).toContain('第 1 / 2 页');
    expect(p1).toContain('href="/?page=2"'); // 下一页链接
    expect(p1).toContain('pager__btn--disabled'); // 首页上一页禁用

    const p2 = await (await fetch(`${srv.url}/?page=2`)).text();
    expect(countCards(p2)).toBe(1);
    expect(p2).toContain('第 2 / 2 页');
    expect(p2).toContain('共 31 篇');

    // 超界 → 渲染末页 + 提示。
    const p99 = await (await fetch(`${srv.url}/?page=99`)).text();
    expect(countCards(p99)).toBe(1);
    expect(p99).toContain('第 99 页不存在');
    expect(p99).toContain('第 2 / 2 页');
  });

  it('8. active filters render pills with remove links; >=2 adds clear-all (spec §7.5)', async () => {
    await makeMainProject();
    const srv = await startServer();

    const two = await (
      await fetch(`${srv.url}/?type=decision&concept=${encodeURIComponent('派单池')}`)
    ).text();
    expect(two).toContain('<b>类型:</b>决策');
    expect(two).toContain('<b>概念:</b>派单池');
    expect(two).toContain('清除全部');
    // ✕ 链接 = 移除该值后的 URL(其余参数保留):移除类型 → 仅剩概念。
    expect(two).toContain(`href="/?concept=${encodeURIComponent('派单池')}"`);

    const one = await (await fetch(`${srv.url}/?type=decision`)).text();
    expect(one).toContain('<b>类型:</b>决策');
    expect(one).not.toContain('清除全部');
  });

  it('9. distinguishes empty KB vs zero-match empty states (spec §8)', async () => {
    // 空态①:已初始化但 0 文档 → 「知识库为空」+ docs index 引导,计数 0 不报错。
    initProject(tmp);
    const srv = await startServer();
    const empty = await (await fetch(`${srv.url}/`)).text();
    expect(empty).toContain('知识库为空');
    expect(empty).toContain('cgraphx docs index');
    expect(empty).toContain('stat__num">0</div>');
    expect(empty).toContain('尚未索引');
    expect(empty).not.toContain('没有匹配的文档');
    await srv.close();
    servers.length = 0;

    // 空态②:有文档但筛选 0 命中 → 「没有匹配的文档」+ 重置链接。
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'web-overview-test-'));
    await makeMainProject();
    const srv2 = await startServer();
    const noMatch = await (await fetch(`${srv2.url}/?q=nope-no-match`)).text();
    expect(noMatch).toContain('没有匹配的文档');
    expect(noMatch).toContain('重置全部筛选');
    expect(noMatch).not.toContain('知识库为空');
  });

  it('10. shell navigation: three entries, database entry not clickable (spec §3.2, §11 #12)', async () => {
    await makeMainProject();
    const srv = await startServer();
    const html = await (await fetch(`${srv.url}/`)).text();

    expect(html).toContain('知识库</a>');
    expect(html).toContain('href="/timeline"');
    expect(html).toContain('开发时间线');
    expect(html).toContain('数据库');
    expect(html).toContain('后续');
    // 数据库项为灰置 span(无 <a> 包裹)。
    expect(html).toContain('nav__item--disabled');
    expect(html).not.toMatch(/<a[^>]*>[^<]*数据库/);
    // 顶栏只读标识:本地地址 + 只读性质。
    expect(html).toContain('本地 · 127.0.0.1:');
    expect(html).toContain('只读');
  });

  it('11. escapes document-sourced HTML (XSS, spec §3.2)', async () => {
    await makeMainProject();
    const srv = await startServer();
    const html = await (await fetch(`${srv.url}/`)).text();

    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(html).not.toContain('<script>alert(1)</script>');
  });

  it('12. tolerates invalid params: bogus enum ignored, non-integer page -> 1 (spec §7.5)', async () => {
    await makeMainProject();
    const srv = await startServer();

    const bogus = await (await fetch(`${srv.url}/?type=bogus`)).text();
    expect(bogus).not.toContain('出错了');
    expect(countCards(bogus)).toBe(9); // 非法枚举忽略 → 全量

    const badPage = await (await fetch(`${srv.url}/?page=abc`)).text();
    expect(badPage).toContain('第 1 / 1 页 · 共 9 篇');
    expect(countCards(badPage)).toBe(9);
  });
});

describe('overview url model (unit)', () => {
  const empty: OverviewQuery = {
    types: [],
    statuses: [],
    domains: [],
    concepts: [],
    sort: 'updated',
    page: 1,
  };

  it('parses defaults from empty params (spec §7.5)', () => {
    expect(parseOverviewQuery(new URLSearchParams(''))).toEqual({ q: undefined, ...empty });
  });

  it('builds canonical urls and omits default-valued params (spec §7.5)', () => {
    expect(buildOverviewUrl(empty)).toBe('/');
    expect(buildOverviewUrl({ ...empty, q: undefined })).toBe('/');

    const url = buildOverviewUrl({
      q: '灰度',
      types: ['decision', 'lesson'],
      statuses: [],
      domains: [],
      concepts: ['派单池'],
      sort: 'title',
      page: 2,
    });
    expect(url).toBe(
      `/?q=${encodeURIComponent('灰度')}&type=decision&type=lesson&concept=${encodeURIComponent('派单池')}&sort=title&page=2`,
    );
  });

  it('removes one value while keeping the rest (pill ✕ contract, spec §7.5)', () => {
    const q: OverviewQuery = {
      ...empty,
      types: ['decision', 'lesson'],
      concepts: ['派单池'],
      page: 2,
    };
    const removed = withoutValue(q, 'types', 'decision');
    expect(removed.types).toEqual(['lesson']);
    expect(removed.concepts).toEqual(['派单池']);
    expect(removed.page).toBe(2); // 移除保留 page
    expect(buildOverviewUrl(removed)).toContain('type=lesson');
    expect(buildOverviewUrl(removed)).not.toContain('type=decision');

    const removedQ = withoutValue({ ...q, q: '灰度' }, 'q', '灰度');
    expect(removedQ.q).toBeUndefined();
  });

  it('adds a concept resetting page, dedup-safe (spec §7.5)', () => {
    const q: OverviewQuery = { ...empty, types: ['decision'], page: 3 };
    const added = withConceptAdded(q, '派单池');
    expect(added.concepts).toEqual(['派单池']);
    expect(added.page).toBe(1); // 追加使结果集变窄 → page 归 1
    expect(added.types).toEqual(['decision']);
    // 已存在 → 原样返回。
    expect(withConceptAdded(added, '派单池')).toBe(added);
  });

  it('ignores invalid enum values and non-integer pages (spec §7.5)', () => {
    const q = parseOverviewQuery(
      new URLSearchParams('type=bogus&type=decision&status=nope&status=draft&page=abc'),
    );
    expect(q.types).toEqual(['decision']);
    expect(q.statuses).toEqual(['draft']);
    expect(q.page).toBe(1);
  });

  it('dedupes repeated multi-values and trims blanks (spec §7.5)', () => {
    const q = parseOverviewQuery(
      new URLSearchParams('type=decision&type=decision&concept= 派单池 &concept=派单池&q=   '),
    );
    expect(q.types).toEqual(['decision']);
    expect(q.concepts).toEqual(['派单池']);
    expect(q.q).toBeUndefined();
  });

  it('guards page: 0 and negatives fall back to 1 (spec §7.5)', () => {
    expect(parseOverviewQuery(new URLSearchParams('page=0')).page).toBe(1);
    expect(parseOverviewQuery(new URLSearchParams('page=-3')).page).toBe(1);
    expect(parseOverviewQuery(new URLSearchParams('page=7')).page).toBe(7);
  });
});
