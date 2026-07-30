/**
 * 知识库总览页模板(纯 HTML 渲染函数,spec §3.3)。
 *
 * 设计:所有数据查询与 URL 拼装在上游(pages-overview.ts)完成,本文件
 * 只消费已组装好的视图模型做字符串渲染 —— 每个 DB / 用户来源值在插值处
 * 过 escapeHtml(XSS 契约,spec §3.2)。href 由上游经 URLSearchParams 编码
 * 生成,插值处仍统一转义。
 */

import type { DocumentStatus } from '../core/markdown';
import type { TypeTone } from './constants';
import { escapeHtml } from './render-utils';

// ----- 视图模型(上游 pages-overview.ts 组装)------------------------------

/** 筛选芯片(类型 / 状态 / 领域):href 为点击后的切换链接。 */
export interface ChipModel {
  /** 中文显示标签(领域芯片无中文映射,label = 领域名)。 */
  label: string;
  /** 英文原值 / 领域名(URL 参数值)。 */
  raw: string;
  count: number;
  href: string;
  active: boolean;
  /** 仅类型芯片有着色。 */
  tone?: TypeTone;
}

/** 概念行(带篇数占比条)。 */
export interface ConceptRowModel {
  name: string;
  count: number;
  /** 占比百分数(0–100,纯 CSS 宽度)。 */
  percent: number;
  href: string;
  active: boolean;
}

/** 激活筛选 pill(✕ = 移除该值后的 URL)。 */
export interface PillModel {
  /** 维度标签:类型 / 状态 / 领域 / 概念 / 关键词。 */
  dimension: string;
  value: string;
  removeHref: string;
}

/** 文档卡上的概念标签链接(点击追加为概念筛选)。 */
export interface CardTagModel {
  name: string;
  href: string;
  active: boolean;
}

/** <time> 元素数据(datetime 供 app.js 本地化,text 为服务端本地时间)。 */
export interface TimeModel {
  datetime: string;
  text: string;
}

/** 文档卡视图模型(字段与 spec §3.3 卡片要素一一对应)。 */
export interface DocCardModel {
  detailHref: string;
  tone: TypeTone;
  typeLabel: string;
  typeRaw: string;
  title: string;
  alias: string | null;
  summary: string;
  conceptTags: CardTagModel[];
  /** 「 / 」连接后的负责人;无负责人为 null。 */
  ownersText: string | null;
  status: DocumentStatus;
  statusLabel: string;
  statusRaw: string;
  /** 「 / 」连接后的领域;无领域为 null。 */
  domainsText: string | null;
  referencesCount: number;
  updated: TimeModel | null;
}

export interface SortLinkModel {
  label: string;
  href: string;
  active: boolean;
}

export interface PagerModel {
  /** 「第 X / Y 页 · 共 N 篇」—— total 始终可见(spec §11 #10)。 */
  info: string;
  prevHref: string | null;
  nextHref: string | null;
  /** 请求页超界时的提示文案;正常为 null。 */
  notice: string | null;
  /** total = 0 时不渲染分页区。 */
  visible: boolean;
}

/** 总览页主区内容全量视图模型。 */
export interface OverviewContentModel {
  stats: {
    documentCount: number;
    conceptCount: number;
    domainCount: number;
    tagCount: number;
    /** 全库最近索引时间;null → 「尚未索引」。 */
    latestIndexed: TimeModel | null;
  };
  search: {
    q: string;
    /** 保留其余筛选的隐藏输入(name/value 原文,模板侧转义)。 */
    hiddenInputs: Array<{ name: string; value: string }>;
  };
  typeChips: ChipModel[];
  statusChips: ChipModel[];
  domainChips: ChipModel[];
  topConcepts: ConceptRowModel[];
  moreConcepts: ConceptRowModel[];
  /** 概念总数(details summary 文案用)。 */
  conceptTotal: number;
  /** 列表头计数徽章:有筛选 「M / N」,无筛选 「N 篇」。 */
  countBadge: string;
  sortLinks: SortLinkModel[];
  pills: PillModel[];
  /** 激活条件 ≥2 → 清除全部。 */
  clearAllVisible: boolean;
  cards: DocCardModel[];
  /** 空状态:kb-empty = 全库为空;no-match = 筛选 0 命中(spec §8 两态)。 */
  empty: 'none' | 'kb-empty' | 'no-match';
  pager: PagerModel;
}

// ----- 局部渲染 ------------------------------------------------------------

/** 筛选芯片组。 */
function renderChips(chips: ChipModel[], withEnglish: boolean): string {
  return chips
    .map((c) => {
      const toneCls = c.tone !== undefined ? ` chip--${c.tone}` : '';
      const activeCls = c.active ? ' chip--on' : '';
      const en = withEnglish ? `<span class="chip__en">${escapeHtml(c.raw)}</span>` : '';
      return `<a class="chip${toneCls}${activeCls}" href="${escapeHtml(c.href)}"><span class="chip__zh">${escapeHtml(c.label)}</span>${en}<span class="chip__n">${c.count}</span></a>`;
    })
    .join('\n            ');
}

/** 概念行(名称 + 篇数 + 占比条,spec §3.3)。 */
function renderConceptRows(rows: ConceptRowModel[]): string {
  return rows
    .map((r) => {
      const activeCls = r.active ? ' con-row--on' : '';
      return `<a class="con-row${activeCls}" href="${escapeHtml(r.href)}">
          <span class="con-row__name">${escapeHtml(r.name)}</span>
          <span class="con-row__cnt">${r.count} 篇 · ${r.percent}%</span>
          <span class="con-row__bar"><i style="width:${r.percent}%"></i></span>
        </a>`;
    })
    .join('\n        ');
}

/** 左侧筛选面板(五维:关键词 / 类型 / 状态 / 领域 / 概念)。 */
function renderFiltersPanel(m: OverviewContentModel): string {
  const hidden = m.search.hiddenInputs
    .map(
      (h) =>
        `<input type="hidden" name="${escapeHtml(h.name)}" value="${escapeHtml(h.value)}">`,
    )
    .join('\n        ');

  const conceptMore =
    m.moreConcepts.length > 0
      ? `
        <details class="con-more">
          <summary>展开全部 ${m.conceptTotal} 个概念</summary>
          ${renderConceptRows(m.moreConcepts)}
        </details>`
      : '';

  return `
    <aside class="filters">
      <div class="filters__head"><b>筛选</b></div>
      <form class="filters__search" action="/" method="get">
        ${hidden}
        <label class="search-box">
          <span class="search-box__glyph">⌕</span>
          <input id="search-input" name="q" type="search" placeholder="搜索标题 / 摘要…" value="${escapeHtml(m.search.q)}" autocomplete="off">
        </label>
        <div class="filters__hint">回车搜索 · 按 / 聚焦搜索框</div>
      </form>
      <div class="filters__group">
        <div class="filters__lab">文档类型 <i>TYPE</i></div>
        <div class="filters__chips">
          ${renderChips(m.typeChips, true)}
        </div>
      </div>
      <div class="filters__group">
        <div class="filters__lab">状态 <i>STATUS</i></div>
        <div class="filters__chips">
          ${renderChips(m.statusChips, true)}
        </div>
      </div>
      <div class="filters__group">
        <div class="filters__lab">领域 <i>DOMAIN</i></div>
        <div class="filters__chips">
          ${renderChips(m.domainChips, false)}
        </div>
      </div>
      <div class="filters__group">
        <div class="filters__lab">热门概念 <i>CONCEPTS</i></div>
        <div class="filters__concepts">
          ${renderConceptRows(m.topConcepts)}${conceptMore}
        </div>
      </div>
    </aside>`;
}

/** 统计条:四数 + 最近索引时间(spec §3.3 / §4.2)。 */
function renderStatbar(m: OverviewContentModel): string {
  const s = m.stats;
  const indexed =
    s.latestIndexed === null
      ? `<span class="statbar__indexed-value">尚未索引</span>`
      : `<time class="statbar__indexed-value" datetime="${escapeHtml(s.latestIndexed.datetime)}" data-local-time>${escapeHtml(s.latestIndexed.text)}</time>`;

  const cell = (num: number, zh: string, en: string): string =>
    `<div class="stat"><div class="stat__num">${num}</div><div class="stat__lab">${zh}<i>${en}</i></div></div>`;

  return `
    <div class="statbar">
      ${cell(s.documentCount, '文档', 'DOCUMENTS')}
      ${cell(s.conceptCount, '概念', 'CONCEPTS')}
      ${cell(s.domainCount, '领域', 'DOMAINS')}
      ${cell(s.tagCount, '标签', 'TAGS')}
    </div>
    <div class="statbar__indexed">最近索引 ${indexed}</div>`;
}

/** 激活筛选 pill 区(无激活不渲染;≥2 追加「清除全部」)。 */
function renderActivePills(m: OverviewContentModel): string {
  if (m.pills.length === 0) return '';
  const pills = m.pills
    .map(
      (p) =>
        `<span class="apill"><b>${escapeHtml(p.dimension)}:</b>${escapeHtml(p.value)}<a class="apill__x" href="${escapeHtml(p.removeHref)}" title="移除该筛选">✕</a></span>`,
    )
    .join('\n        ');
  const clearAll = m.clearAllVisible
    ? `\n        <a class="apill apill--clear" href="/">清除全部</a>`
    : '';
  return `
    <div class="active-pills">
        ${pills}${clearAll}
    </div>`;
}

/** 单张文档卡(spec §3.3 卡片要素)。 */
function renderDocCard(c: DocCardModel): string {
  const alias =
    c.alias !== null ? `<span class="doc__alias">${escapeHtml(c.alias)}</span>` : '';
  const tags = c.conceptTags
    .map(
      (t) =>
        `<a class="doc__tag${t.active ? ' doc__tag--on' : ''}" href="${escapeHtml(t.href)}">${escapeHtml(t.name)}</a>`,
    )
    .join('');
  const owners =
    c.ownersText !== null
      ? `<span class="doc__owners">负责人 <b>${escapeHtml(c.ownersText)}</b></span>`
      : '';
  const domains =
    c.domainsText !== null
      ? `<span class="doc__domain">${escapeHtml(c.domainsText)}</span>`
      : `<span class="doc__domain doc__domain--none">—</span>`;
  const updated =
    c.updated !== null
      ? `<time class="doc__time" datetime="${escapeHtml(c.updated.datetime)}">${escapeHtml(c.updated.text)}</time>`
      : `<span class="doc__time doc__time--none">—</span>`;

  return `
    <article class="doc doc--${c.tone}">
      <div class="tbadge tbadge--${c.tone}"><b>${escapeHtml(c.typeLabel)}</b><i>${escapeHtml(c.typeRaw.toUpperCase())}</i></div>
      <div class="doc__body">
        <div class="doc__titlerow">
          <a class="doc__title" href="${escapeHtml(c.detailHref)}">${escapeHtml(c.title)}</a>${alias}
        </div>
        <p class="doc__sum">${escapeHtml(c.summary)}</p>
        <div class="doc__tagrow">${tags}${owners}</div>
      </div>
      <div class="doc__side">
        <span class="status status--${c.status}"><b></b>${escapeHtml(c.statusLabel)} ${escapeHtml(c.statusRaw)}</span>
        ${domains}
        <span class="doc__refs">引用 ${c.referencesCount}</span>
        ${updated}
      </div>
    </article>`;
}

/** 空状态(spec §8:两态文案严格区分)。 */
function renderEmpty(kind: 'kb-empty' | 'no-match'): string {
  if (kind === 'kb-empty') {
    return `
    <div class="empty">
      <span class="empty__glyph">▦</span>
      <h3 class="empty__title">知识库为空</h3>
      <p class="empty__text">尚未索引任何文档。</p>
      <p class="empty__hint">run <code>cgraphx docs index</code> to build the index</p>
    </div>`;
  }
  return `
    <div class="empty">
      <span class="empty__glyph">⌕</span>
      <h3 class="empty__title">没有匹配的文档</h3>
      <p class="empty__text">当前筛选组合没有命中任何文档。</p>
      <a class="empty__reset" href="/">重置全部筛选</a>
    </div>`;
}

/** 分页区(上一页 / 下一页 + 「第 X / Y 页 · 共 N 篇」,边界禁用)。 */
function renderPager(p: PagerModel): string {
  if (!p.visible) return '';
  const prev =
    p.prevHref !== null
      ? `<a class="pager__btn" href="${escapeHtml(p.prevHref)}">‹ 上一页</a>`
      : `<span class="pager__btn pager__btn--disabled">‹ 上一页</span>`;
  const next =
    p.nextHref !== null
      ? `<a class="pager__btn" href="${escapeHtml(p.nextHref)}">下一页 ›</a>`
      : `<span class="pager__btn pager__btn--disabled">下一页 ›</span>`;
  const notice =
    p.notice !== null ? `<p class="pager__notice">${escapeHtml(p.notice)}</p>` : '';
  return `
    <nav class="pager">
      ${notice}
      <div class="pager__bar">
        ${prev}
        <span class="pager__info">${escapeHtml(p.info)}</span>
        ${next}
      </div>
    </nav>`;
}

// ----- 页面主区 ------------------------------------------------------------

/** 渲染总览页主区内容(壳由 layout.renderShellPage 提供)。 */
export function renderOverviewContent(m: OverviewContentModel): string {
  const sortSeg = m.sortLinks
    .map(
      (s) =>
        `<a class="seg__btn${s.active ? ' seg__btn--on' : ''}" href="${escapeHtml(s.href)}">${escapeHtml(s.label)}</a>`,
    )
    .join('');

  const listBody =
    m.empty !== 'none'
      ? renderEmpty(m.empty)
      : `<div class="doclist">${m.cards.map(renderDocCard).join('\n')}</div>${renderPager(m.pager)}`;

  return `
  <div class="kb-layout">
    ${renderFiltersPanel(m)}
    <div class="kb-main">
      ${renderStatbar(m)}
      <div class="list-head">
        <h2>文档 <span class="count-badge">${escapeHtml(m.countBadge)}</span></h2>
        <div class="seg">${sortSeg}</div>
      </div>${renderActivePills(m)}
      ${listBody}
    </div>
  </div>`;
}
