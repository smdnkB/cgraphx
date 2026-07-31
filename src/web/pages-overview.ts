/**
 * 知识库总览页(spec §3.3):URL 查询参数模型 + 视图模型组装 + 页面入口。
 *
 * 形态(plan index 第 4 节拍板):服务端渲染 HTML,筛选/排序/分页全部走
 * URL 查询参数(可收藏、刷新不丢状态)。URL ↔ 查询模型的解析/序列化与
 * pill/分页的多值参数增删均为纯函数(单测覆盖,见 knowledge-overview
 * 测试「overview url model」组)——多值参数保留与移除是最易出 bug 处。
 *
 * 只经门面消费 markdown 子系统(门面硬约定):每请求以基座进程级连接
 * 构造 `new MarkdownQuery(db)`(无状态、廉价),不持有额外 DB 连接。
 */

import {
  MarkdownQuery,
  DOCUMENT_TYPES,
  DOCUMENT_STATUSES,
} from '../core/markdown';
import type { DocumentType, DocumentStatus, FindFilter } from '../core/markdown';
import type { SqliteDatabase } from '../core/db';

import {
  PAGE_SIZE,
  CONCEPT_PANEL_TOP,
  TYPE_LABELS,
  STATUS_LABELS,
  TYPE_TONES,
} from './constants';
import { renderShellPage } from './layout';
import {
  renderOverviewContent,
  type CardTagModel,
  type ChipModel,
  type ConceptRowModel,
  type DocCardModel,
  type OverviewContentModel,
  type PillModel,
} from './overview-templates';
import { docTime, epochTime } from './render-utils';

// ----- URL 查询参数模型(纯函数,单测覆盖)--------------------------------

/** 总览页 URL 状态模型(经规范化:非法枚举已剔除、page 已守卫)。 */
export interface OverviewQuery {
  /** 关键词(单值);空串/空白 → undefined。 */
  q?: string;
  types: DocumentType[];
  statuses: DocumentStatus[];
  domains: string[];
  concepts: string[];
  /** updated(默认,映射 findPaged 'recency')| title。 */
  sort: 'updated' | 'title';
  /** ≥1 整数;非法输入按 1。 */
  page: number;
}

/** pill / 增删辅助可作用的维度。 */
export type PillDimension = 'q' | 'types' | 'statuses' | 'domains' | 'concepts';

/** 保序去重。 */
function dedupe(list: string[]): string[] {
  return [...new Set(list)];
}

/**
 * URLSearchParams → 规范化查询模型(plan index §7.5 逐字):
 * type/status 非法枚举值忽略(从激活集剔除,不报错);page 非法按 1;
 * q 空白按未传;各多值维度去重。
 */
export function parseOverviewQuery(params: URLSearchParams): OverviewQuery {
  const qRaw = params.get('q');
  const q = qRaw !== null && qRaw.trim() !== '' ? qRaw.trim() : undefined;

  const types = dedupe(params.getAll('type')).filter((t): t is DocumentType =>
    (DOCUMENT_TYPES as readonly string[]).includes(t),
  );
  const statuses = dedupe(params.getAll('status')).filter((s): s is DocumentStatus =>
    (DOCUMENT_STATUSES as readonly string[]).includes(s),
  );
  const domains = dedupe(params.getAll('domain').map((d) => d.trim())).filter((d) => d !== '');
  const concepts = dedupe(params.getAll('concept').map((c) => c.trim())).filter((c) => c !== '');

  const sort = params.get('sort') === 'title' ? 'title' : 'updated';

  const pageRaw = params.get('page');
  let page = 1;
  if (pageRaw !== null && /^\d+$/.test(pageRaw)) {
    const n = Number(pageRaw);
    if (n >= 1) page = n;
  }

  return { q, types, statuses, domains, concepts, sort, page };
}

/**
 * 查询模型 → 规范化 URL。参数顺序固定(q → type* → status* → domain* →
 * concept* → sort → page);缺省值不出现(sort=updated / page=1 不入 URL)。
 * URLSearchParams 负责百分号编码(中文概念/领域名自动编码)。
 */
export function buildOverviewUrl(query: OverviewQuery): string {
  const p = new URLSearchParams();
  if (query.q !== undefined) p.append('q', query.q);
  for (const t of query.types) p.append('type', t);
  for (const s of query.statuses) p.append('status', s);
  for (const d of query.domains) p.append('domain', d);
  for (const c of query.concepts) p.append('concept', c);
  if (query.sort === 'title') p.append('sort', 'title');
  if (query.page > 1) p.append('page', String(query.page));
  const s = p.toString();
  return s === '' ? '/' : `/?${s}`;
}

/** 移除一个激活值(其余参数保留;移除使结果集变宽,page 保持)。 */
export function withoutValue(query: OverviewQuery, dim: PillDimension, value: string): OverviewQuery {
  switch (dim) {
    case 'q':
      return { ...query, q: undefined };
    case 'types':
      return { ...query, types: query.types.filter((v) => v !== value) };
    case 'statuses':
      return { ...query, statuses: query.statuses.filter((v) => v !== value) };
    case 'domains':
      return { ...query, domains: query.domains.filter((v) => v !== value) };
    case 'concepts':
      return { ...query, concepts: query.concepts.filter((v) => v !== value) };
  }
}

/**
 * 追加一个概念筛选(保留其余筛选参数;已存在 → 原样返回)。
 * 追加使结果集变窄,page 重置为 1(避免落在超界页)。
 */
export function withConceptAdded(query: OverviewQuery, name: string): OverviewQuery {
  if (query.concepts.includes(name)) return query;
  return { ...query, concepts: [...query.concepts, name], page: 1 };
}

export function withSort(query: OverviewQuery, sort: 'updated' | 'title'): OverviewQuery {
  return { ...query, sort };
}

export function withPage(query: OverviewQuery, page: number): OverviewQuery {
  return { ...query, page };
}

/** 芯片「添加」链接辅助:保序追加(已存在则原样),page 重置为 1。 */
function added<T extends string>(list: T[], value: T): T[] {
  return list.includes(value) ? list : [...list, value];
}

/** 是否有任何激活筛选(计数徽章 / 空态②判定用)。 */
function hasActiveFilters(query: OverviewQuery): boolean {
  return (
    query.q !== undefined ||
    query.types.length > 0 ||
    query.statuses.length > 0 ||
    query.domains.length > 0 ||
    query.concepts.length > 0
  );
}

// ----- 视图模型组装 --------------------------------------------------------

/** 组装总览页全量视图模型。所有 href 在此计算,模板侧只做字符串渲染。 */
function assembleOverviewModel(db: SqliteDatabase, query: OverviewQuery): OverviewContentModel {
  const queryApi = new MarkdownQuery(db);
  const stats = queryApi.getStats();

  // 查询模型 → FindFilter(复数字段,维度内 OR、维度间 AND;空数组不传)。
  const filter: FindFilter = {};
  if (query.q !== undefined) filter.q = query.q;
  if (query.types.length > 0) filter.documentTypes = query.types;
  if (query.statuses.length > 0) filter.statuses = query.statuses;
  if (query.domains.length > 0) filter.domains = query.domains;
  if (query.concepts.length > 0) filter.concepts = query.concepts;

  // URL sort=updated → 显式 recency(有 q 时亦不走相关度,plan index §7.5)。
  const sort = query.sort === 'title' ? ('title' as const) : ('recency' as const);

  let result = queryApi.findPaged(filter, {
    offset: (query.page - 1) * PAGE_SIZE,
    limit: PAGE_SIZE,
    sort,
  });

  // 超界页:渲染末页 + 提示(spec §11 #10;仅超界时多一次查询)。
  const totalPages = result.total === 0 ? 1 : Math.ceil(result.total / PAGE_SIZE);
  let effectivePage = query.page;
  let notice: string | null = null;
  if (result.total > 0 && query.page > totalPages) {
    effectivePage = totalPages;
    notice = `第 ${query.page} 页不存在,已显示第 ${totalPages} 页(共 ${totalPages} 页)`;
    result = queryApi.findPaged(filter, {
      offset: (effectivePage - 1) * PAGE_SIZE,
      limit: PAGE_SIZE,
      sort,
    });
  }

  // ---- 筛选面板(计数为全库口径,不随筛选联动,plan index 第 4 节)----
  const typeChips: ChipModel[] = DOCUMENT_TYPES.map((t) => ({
    type: t,
    count: stats.byType[t],
  }))
    .sort((a, b) => b.count - a.count || (a.type < b.type ? -1 : a.type > b.type ? 1 : 0))
    .map(({ type, count }) => {
      const active = query.types.includes(type);
      const href = active
        ? buildOverviewUrl(withoutValue(query, 'types', type))
        : buildOverviewUrl({ ...query, types: added(query.types, type), page: 1 });
      return { label: TYPE_LABELS[type], raw: type, count, active, tone: TYPE_TONES[type], href };
    });

  const statusChips: ChipModel[] = DOCUMENT_STATUSES.map((s) => {
    const active = query.statuses.includes(s);
    const href = active
      ? buildOverviewUrl(withoutValue(query, 'statuses', s))
      : buildOverviewUrl({ ...query, statuses: added(query.statuses, s), page: 1 });
    return { label: STATUS_LABELS[s], raw: s, count: stats.byStatus[s], active, href };
  });

  const domainChips: ChipModel[] = queryApi.listDomains().map((d) => {
    const active = query.domains.includes(d.name);
    const href = active
      ? buildOverviewUrl(withoutValue(query, 'domains', d.name))
      : buildOverviewUrl({ ...query, domains: added(query.domains, d.name), page: 1 });
    return { label: d.name, raw: d.name, count: d.documentCount, active, href };
  });

  // 概念行:篇数占比条宽度 = documentCount / 全库文档数(纯 CSS 宽度)。
  const conceptRow = (name: string, count: number): ConceptRowModel => {
    const active = query.concepts.includes(name);
    const percent =
      stats.documentCount > 0 ? Math.round((count / stats.documentCount) * 100) : 0;
    const href = active
      ? buildOverviewUrl(withoutValue(query, 'concepts', name))
      : buildOverviewUrl(withConceptAdded(query, name));
    return { name, count, percent, active, href };
  };
  const allConcepts = queryApi.listConcepts();
  const topConcepts = allConcepts.slice(0, CONCEPT_PANEL_TOP).map((c) => conceptRow(c.name, c.documentCount));
  const moreConcepts = allConcepts.slice(CONCEPT_PANEL_TOP).map((c) => conceptRow(c.name, c.documentCount));

  // ---- 激活筛选 pill(每激活值一个;≥2 追加「清除全部」)----
  const pills: PillModel[] = [];
  if (query.q !== undefined) {
    pills.push({ dimension: '关键词', value: query.q, removeHref: buildOverviewUrl(withoutValue(query, 'q', query.q)) });
  }
  for (const t of query.types) {
    pills.push({ dimension: '类型', value: TYPE_LABELS[t], removeHref: buildOverviewUrl(withoutValue(query, 'types', t)) });
  }
  for (const s of query.statuses) {
    pills.push({ dimension: '状态', value: STATUS_LABELS[s], removeHref: buildOverviewUrl(withoutValue(query, 'statuses', s)) });
  }
  for (const d of query.domains) {
    pills.push({ dimension: '领域', value: d, removeHref: buildOverviewUrl(withoutValue(query, 'domains', d)) });
  }
  for (const c of query.concepts) {
    pills.push({ dimension: '概念', value: c, removeHref: buildOverviewUrl(withoutValue(query, 'concepts', c)) });
  }

  // ---- 文档卡(referencesCount/owners/aliases 由 findPaged hydrate 填出,
  //      页面侧不逐卡查询,禁 N+1)----
  const cards: DocCardModel[] = result.items.map((d) => {
    const alias = d.aliases?.[0];
    const conceptTags: CardTagModel[] = d.concepts.map((name) => ({
      name,
      active: query.concepts.includes(name),
      href: buildOverviewUrl(withConceptAdded(query, name)),
    }));
    return {
      detailHref: `/doc/${encodeURIComponent(d.id)}`,
      tone: TYPE_TONES[d.documentType],
      typeLabel: TYPE_LABELS[d.documentType],
      typeRaw: d.documentType,
      title: d.title,
      alias: alias ?? null,
      summary: d.summary,
      conceptTags,
      ownersText: d.owners !== undefined && d.owners.length > 0 ? d.owners.join(' / ') : null,
      status: d.status,
      statusLabel: STATUS_LABELS[d.status],
      statusRaw: d.status,
      domainsText: d.domains.length > 0 ? d.domains.join(' / ') : null,
      referencesCount: d.referencesCount ?? 0,
      updated: docTime(d.updatedAt),
    };
  });

  // ---- 空状态(spec §8 两态,文案严格区分)----
  const empty: OverviewContentModel['empty'] =
    stats.documentCount === 0 ? 'kb-empty' : result.total === 0 ? 'no-match' : 'none';

  const active = hasActiveFilters(query);
  const countBadge = active ? `${result.total} / ${stats.documentCount}` : `${stats.documentCount} 篇`;

  const searchHidden: Array<{ name: string; value: string }> = [];
  for (const t of query.types) searchHidden.push({ name: 'type', value: t });
  for (const s of query.statuses) searchHidden.push({ name: 'status', value: s });
  for (const d of query.domains) searchHidden.push({ name: 'domain', value: d });
  for (const c of query.concepts) searchHidden.push({ name: 'concept', value: c });
  if (query.sort === 'title') searchHidden.push({ name: 'sort', value: 'title' });

  return {
    stats: {
      documentCount: stats.documentCount,
      conceptCount: stats.conceptCount,
      domainCount: stats.domainCount,
      tagCount: stats.tagCount,
      latestIndexed: stats.latestIndexedAt === null ? null : epochTime(stats.latestIndexedAt),
    },
    search: { q: query.q ?? '', hiddenInputs: searchHidden },
    typeChips,
    statusChips,
    domainChips,
    topConcepts,
    moreConcepts,
    conceptTotal: allConcepts.length,
    countBadge,
    sortLinks: [
      { label: '最近更新', active: query.sort === 'updated', href: buildOverviewUrl(withSort(query, 'updated')) },
      { label: '名称', active: query.sort === 'title', href: buildOverviewUrl(withSort(query, 'title')) },
    ],
    pills,
    clearAllVisible: pills.length >= 2,
    cards,
    empty,
    pager: {
      visible: result.total > 0,
      info: `第 ${effectivePage} / ${totalPages} 页 · 共 ${result.total} 篇`,
      prevHref: effectivePage > 1 ? buildOverviewUrl(withPage(query, effectivePage - 1)) : null,
      nextHref: effectivePage < totalPages ? buildOverviewUrl(withPage(query, effectivePage + 1)) : null,
      notice,
    },
  };
}

// ----- 页面入口 ------------------------------------------------------------

/**
 * 渲染知识库总览页完整 HTML(壳 + 主区)。
 *
 * @param db 基座进程级单连接(每请求 new MarkdownQuery(db),只读 SELECT)。
 * @param params 请求 URL 的查询参数。
 */
export function renderOverviewPage(
  db: SqliteDatabase,
  params: URLSearchParams,
  ctx: { version: string; localHost: string },
): string {
  const query = parseOverviewQuery(params);
  const model = assembleOverviewModel(db, query);
  return renderShellPage({
    title: '知识库',
    active: 'knowledge',
    contentHtml: renderOverviewContent(model),
    version: ctx.version,
    localHost: ctx.localHost,
  });
}
