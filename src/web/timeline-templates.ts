/**
 * 开发时间线页模板(纯 HTML 渲染函数,spec §3.3)。
 *
 * 设计与 `overview-templates.ts` 同构:所有数据查询与 URL 拼装在上游
 * (`pages-timeline.ts`)完成,本文件只消费已组装好的视图模型做字符串渲染——
 * 每个 DB / 用户来源值在插值处过 escapeHtml(XSS 契约,基座 §3.2 / spec §5)。
 *
 * 四级分组(日期 > 会话 > 轮次 > 事件)的结构在视图模型里逐层承载;payload
 * 原文经 `highlightJson`(递归发射器,每段字符串先 escape 再入 span)渲染。
 */

import type { EventType } from '../core/timeline';
import type { EventTone } from './constants';
import { escapeHtml, type TimeModel } from './render-utils';

// ----- 视图模型(上游 pages-timeline.ts 组装)------------------------------

/** 概况条第 4 格的近 7 日柱图单柱(进程本地日)。 */
export interface BarModel {
  /** 本地日期 YYYY-MM-DD(datetime(ts,'localtime') 同口径)。 */
  day: string;
  count: number;
  /** x 轴标签(周几,设计稿 v2)。 */
  label: string;
  isToday: boolean;
}

/** 概况条今日最常用工具(当日无工具事件 → null,优雅降级)。 */
export interface TopToolModel {
  tool: string;
  count: number;
}

/** 概况数据条(spec §3.1,仪表盘口径:固定今日 + 7 日,不受用户过滤影响)。 */
export interface StatbarModel {
  todayEvents: number;
  todayActiveSessions: number;
  topTool: TopToolModel | null;
  last7Bars: BarModel[];
  total7d: number;
}

/** 时间范围分段按钮(今天 / 近 7 天)。 */
export interface RangeSegModel {
  label: string;
  href: string;
  active: boolean;
}

/** 事件类型筛选芯片(多选;计数为当前时间范围内各类型事件数)。 */
export interface TlFilterChipModel {
  label: string;
  en: string;
  count: number;
  href: string;
  active: boolean;
  tone: EventTone;
}

/** 工具 / 文件 / 会话三个单值过滤输入框。 */
export interface TlSearchBoxModel {
  name: 'tool' | 'file' | 'session';
  placeholder: string;
  value: string;
}

/** 左侧筛选面板(range seg + 类型多选 chips + 3 个 search-box)。 */
export interface TlFiltersModel {
  rangeSeg: RangeSegModel[];
  typeChips: TlFilterChipModel[];
  searchBoxes: TlSearchBoxModel[];
}

/** 激活筛选 pill(✕ = 移除该值后的 URL)。 */
export interface TlPillModel {
  dimension: string;
  value: string;
  removeHref: string;
}

/** 单事件 payload 展开内容(已解析对象,见记录层数据事实;null = 无可展开字段)。 */
export type Payload = Record<string, unknown> | null;

/** 单事件行(L4)。 */
export interface EventRowModel {
  /** 进程本地时间文本(服务端合规底线;app.js 按浏览器时区重格式化到秒)。 */
  time: TimeModel;
  eventType: EventType;
  /** 中文标签(EVENT_TYPE_LABELS)。 */
  label: string;
  tone: EventTone;
  /** 工具名(工具类事件);非工具事件为 null。 */
  toolName: string | null;
  /** 关联路径(从 tool_args 提取的主文件路径;无则 null)。 */
  path: string | null;
  /** 一行摘要(exit 状态 / 提交 message / prompt 截断预览)。 */
  summary: string | null;
  /** 是否有可展开 payload。 */
  hasPayload: boolean;
  /** 已解析的 payload 对象(无 payload 为 null)。 */
  payload: Payload;
  /** 是否子 agent 专属行型(Agent/Task 的 post_tool_use)。 */
  isSubagent: boolean;
  /** 子 agent 数据约束说明文案(isSubagent 时非 null)。 */
  subagentNote: string | null;
}

/** 轮次(L3):一个轮次 = prompt → 工具序列 → stop;turn_id 为 null 归「未分轮次」。 */
export interface TurnGroupModel {
  /** 轮次标签(「轮 N · HH:mm」或「未分轮次」);turnId 为 null 时归尾桶。 */
  label: string;
  events: EventRowModel[];
}

/** 会话卡(L2,固定子分组维度;跨天会话在每日出现一张,内仅当日事件)。 */
export interface SessionCardModel {
  sessionId: string;
  /** 会话标题(首条 user_prompt 截断预览;无则 tool_name 或 session_id)。 */
  title: string;
  /** 轮次数(turn_id 去重计数)。 */
  turnCount: number;
  /** 该会话当日事件数。 */
  eventCount: number;
  /** 跨天会话:全天事件总数(跨所有 fetched 日期);非跨天为 null。 */
  fullCount: number | null;
  /** 跨天会话:全天轮次数(全 turn_id 去重);非跨天为 null。 */
  fullTurnCount: number | null;
  isCrossDay: boolean;
  /** 当前会话(最新事件为今日)→ live 标记。 */
  isLive: boolean;
  firstTs: TimeModel | null;
  lastTs: TimeModel | null;
  turns: TurnGroupModel[];
}

/** git_commit 独立栏单条(无 session_id,不猜归属)。 */
export interface CommitRowModel {
  time: TimeModel;
  hash: string;
  message: string;
  insertions: number;
  deletions: number;
  files: string[];
}

/** 日期分组(L1):今天 / 昨天 / 具体日期。 */
export interface DayGroupModel {
  /** 大号日期标题(「今天」/「昨天」/「7月28日」)。 */
  label: string;
  /** 日期副标(「8月2日 周日」)。 */
  dateLabel: string;
  /** 当日 meta(「3 个会话 · 96 条事件 · 0 提交」)。 */
  meta: string;
  sessionCards: SessionCardModel[];
  commits: CommitRowModel[];
}

/** 时间线页主区内容全量视图模型。 */
export interface TimelineContentModel {
  statbar: StatbarModel;
  filters: TlFiltersModel;
  pills: TlPillModel[];
  /** 激活条件 ≥2 → 清除全部。 */
  clearAllVisible: boolean;
  /** 清除全部过滤的 URL(无 range/type/tool/file/session)。 */
  clearAllHref: string;
  /** 列表头计数徽章(「N 条 · M 会话」或「10,000+ 条」)。 */
  countBadge: string;
  /** 截断提示(事件列表 === 10000 时非 null;不静默截断)。 */
  truncationNotice: string | null;
  dayGroups: DayGroupModel[];
  /**
   * 空状态(spec §3.4 三态):
   * - timeline-empty:全库 0 事件(从未安装/使用 hooks)→ 引导 install;
   * - today-empty:今天 0 事件(无筛选激活,仅当日无活动);
   * - no-match:筛选组合 0 命中(有 type/tool/file/session 激活)→ 重置入口。
   */
  empty: 'none' | 'timeline-empty' | 'today-empty' | 'no-match';
}

// ----- JSON 语法高亮(递归发射器,XSS 安全)----------------------------------

/**
 * 把已解析的 JS 值渲染为带语法着色的 JSON 文本(2 空格缩进)。
 *
 * 安全契约:每个字符串片段(字符串值、对象键)先经 `JSON.stringify`
 * (加引号 + 转义内部引号/反斜杠)再 `escapeHtml` 包进 `<span class="js|jk">`;
 * 数字/布尔为 JSON 字面量,不产生 HTML 特殊字符。不存在 regex 误注入路径。
 * 畸形入参(非 JSON 原生类型)降级为 `null` 着色,不崩溃(§6 兜底)。
 */
function highlightJson(value: unknown, indent = 0): string {
  const pad = '  '.repeat(indent);
  const padInner = '  '.repeat(indent + 1);
  if (value === null || value === undefined) return '<span class="jb">null</span>';
  if (typeof value === 'boolean') return `<span class="jb">${value}</span>`;
  if (typeof value === 'number') return Number.isFinite(value) ? `<span class="jn">${value}</span>` : '<span class="jb">null</span>';
  if (typeof value === 'string') return `<span class="js">${escapeHtml(JSON.stringify(value))}</span>`;
  if (Array.isArray(value)) {
    if (value.length === 0) return '[]';
    const items = value.map((v) => `${padInner}${highlightJson(v, indent + 1)}`);
    return `[\n${items.join(',\n')}\n${pad}]`;
  }
  if (typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>);
    if (entries.length === 0) return '{}';
    const pairs = entries.map(
      ([k, v]) => `${padInner}<span class="jk">${escapeHtml(JSON.stringify(k))}</span>: ${highlightJson(v, indent + 1)}`,
    );
    return `{\n${pairs.join(',\n')}\n${pad}}`;
  }
  return '<span class="jb">null</span>';
}

// ----- 局部渲染 ------------------------------------------------------------

/** 概况数据条(spec §3.1):四格 + 近 7 日柱图。 */
function renderStatbar(m: TimelineContentModel): string {
  const s = m.statbar;
  const topNum = s.topTool !== null ? escapeHtml(s.topTool.tool) : '—';
  const topLab = s.topTool !== null ? `TOP TOOL · ${s.topTool.count} 次` : 'TOP TOOL · —';

  const maxCount = Math.max(1, ...s.last7Bars.map((b) => b.count));
  const bars = s.last7Bars
    .map((b) => {
      const h = b.count === 0 ? 3 : Math.max(4, Math.round((b.count / maxCount) * 46));
      const cls = b.count === 0 ? 'bars__b bars__b--zero' : b.isToday ? 'bars__b bars__b--today' : 'bars__b';
      return `<span class="${cls}" style="height:${h}px" title="${escapeHtml(b.label)} · ${b.count} 条"></span>`;
    })
    .join('');
  const labs = s.last7Bars.map((b) => `<span class="${b.isToday ? 'on' : ''}">${escapeHtml(b.label)}</span>`).join('');

  return `
    <div class="statbar">
      <div class="stat"><div class="stat__num">${s.todayEvents}</div><div class="stat__lab">今日事件数<i>TODAY EVENTS</i></div></div>
      <div class="stat"><div class="stat__num">${s.todayActiveSessions}</div><div class="stat__lab">今日活跃会话<i>ACTIVE SESSIONS</i></div></div>
      <div class="stat"><div class="stat__num stat__num--tool">${topNum}</div><div class="stat__lab">今日最常用工具<i>${escapeHtml(topLab)}</i></div></div>
      <div class="stat">
        <div class="bars">${bars}</div>
        <div class="bars__labs">${labs}</div>
        <div class="stat__lab">近 7 日事件量<i>LAST 7 DAYS · 共 ${s.total7d} 条</i></div>
      </div>
    </div>`;
}

/** 左侧筛选面板:时间范围 seg + 类型多选 chips + 工具/文件/会话 search-box。 */
function renderTlFilters(m: TimelineContentModel): string {
  const f = m.filters;
  const seg = f.rangeSeg
    .map((r) => `<a class="seg__btn${r.active ? ' seg__btn--on' : ''}" href="${escapeHtml(r.href)}">${escapeHtml(r.label)}</a>`)
    .join('');

  const chips = f.typeChips
    .map(
      (c) =>
        `<a class="chip chip--${c.tone}${c.active ? ' chip--on' : ''}" href="${escapeHtml(c.href)}"><span>${escapeHtml(c.label)}</span><span class="chip__en">${escapeHtml(c.en)}</span><span class="chip__n">${c.count}</span></a>`,
    )
    .join('\n          ');

  // search-box 提交时保留 range + 已激活类型(隐藏输入)。
  const hidden: string[] = [];
  const rangeActive = f.rangeSeg.find((r) => r.active);
  if (rangeActive && rangeActive.label !== '今天') {
    // range=7d 时需保留;range=today 是默认,不入 URL(由 buildTimelineUrl 处理,但表单提交需显式)。
    hidden.push(`<input type="hidden" name="range" value="7d">`);
  }
  for (const c of f.typeChips) {
    if (c.active) hidden.push(`<input type="hidden" name="type" value="${escapeHtml(c.en)}">`);
  }
  const hiddenHtml = hidden.join('\n        ');

  const boxes = f.searchBoxes
    .map(
      (b) =>
        `<div class="filters__group">
          <div class="filters__lab">${b.name === 'tool' ? '工具 <i>TOOL · 精确匹配</i>' : b.name === 'file' ? '文件 <i>FILE · 子串匹配</i>' : '会话 <i>SESSION</i>'}</div>
          <label class="search-box"><span class="search-box__glyph">⌕</span><input name="${b.name}" type="search" placeholder="${b.name === 'tool' ? 'tool_name,如 Bash' : b.name === 'file' ? '路径片段' : 'session_id'}" value="${escapeHtml(b.value)}" autocomplete="off"></label>
        </div>`,
    )
    .join('');

  return `
    <aside class="filters">
      <div class="filters__head"><b>筛选</b><div class="filters__hint">各维度可组合 · 类型全不选 = 不过滤</div></div>
      <div class="filters__group">
        <div class="filters__lab">时间范围 <i>TIME RANGE</i></div>
        <div class="seg">${seg}</div>
      </div>
      <div class="filters__group">
        <div class="filters__lab">事件类型 · 多选 <i>EVENT TYPE</i></div>
        <div class="filters__chips">
          ${chips}
        </div>
      </div>
      <form class="filters__search" action="/timeline" method="get">
        ${hiddenHtml}
        ${boxes}
      </form>
    </aside>`;
}

/** 激活筛选 pill 区(无激活不渲染;≥2 追加「清除全部」)。 */
function renderTlPills(m: TimelineContentModel): string {
  if (m.pills.length === 0) return '';
  const pills = m.pills
    .map(
      (p) =>
        `<span class="apill"><b>${escapeHtml(p.dimension)}:</b>${escapeHtml(p.value)}<a class="apill__x" href="${escapeHtml(p.removeHref)}" title="移除该筛选">✕</a></span>`,
    )
    .join('\n        ');
  const clearAll = m.clearAllVisible
    ? `\n        <a class="apill apill--clear" href="${escapeHtml(m.clearAllHref)}">清除全部</a>`
    : '';
  return `
    <div class="active-pills">
        ${pills}${clearAll}
    </div>`;
}

/** 单事件行(L4):有 payload 用 <details> 展开,无则静态行。 */
function renderEventRow(e: EventRowModel): string {
  const toneCls = e.isSubagent ? 'agent' : e.tone;
  const badgeLabel = e.isSubagent ? '▸▸ 子Agent' : escapeHtml(e.label);
  const badge = `<span class="evbadge evbadge--${toneCls}">${badgeLabel}</span>`;
  const toolLine = e.toolName !== null ? `<b class="ev__tool">${escapeHtml(e.toolName)}</b>` : '';
  const pathLine = e.path !== null ? `<span class="ev__path">${escapeHtml(e.path)}</span>` : '';
  const summary = e.summary !== null ? `<p class="ev__sum">${escapeHtml(e.summary)}</p>` : '';
  const body = `<div class="ev__body"><div class="ev__line">${toolLine}${pathLine}</div>${summary}</div>`;
  const time = `<time class="ev__time" datetime="${escapeHtml(e.time.datetime)}">${escapeHtml(e.time.text)}</time>`;
  const chev = '<span class="ev__chev">▶</span>';
  const row = `${time}${badge}${body}${chev}`;

  if (!e.hasPayload) {
    return `<div class="ev ev--${toneCls} ev--static ev--noexp"><div class="ev__row">${row}</div></div>`;
  }
  const note =
    e.isSubagent && e.subagentNote !== null
      ? `<div class="ev__payload-note">${escapeHtml(e.subagentNote)}</div>`
      : '';
  return `<details class="ev ev--${toneCls}">
        <summary class="ev__row">${row}</summary>
        <div class="ev__payload">
          <div class="ev__payload-lab">PAYLOAD · 原文</div>
<pre class="ev__json">${e.payload !== null ? highlightJson(e.payload) : 'null'}</pre>
          ${note}
        </div>
      </details>`;
}

/** 轮次(L3):轮次标签 + 事件列表。 */
function renderTurnGroup(t: TurnGroupModel): string {
  const events = t.events.map(renderEventRow).join('\n          ');
  return `
          <div class="turn">${escapeHtml(t.label)}</div>
          <div class="evlist">
          ${events}
          </div>`;
}

/** 会话卡(L2):头部 + 展开后轮次。 */
function renderSessionCard(s: SessionCardModel): string {
  const liveCls = s.isLive ? ' sess--live' : '';
  const openAttr = s.isLive ? ' open' : '';
  const sidShort = s.sessionId.length > 8 ? s.sessionId.slice(0, 8) : s.sessionId;
  const liveTag = s.isLive ? '<span class="sess__tag sess__tag--live">● 当前会话</span>' : '';
  const crossTag = s.isCrossDay ? '<span class="sess__tag sess__tag--cross">跨天 · 示当日事件</span>' : '';
  const crossMeta =
    s.isCrossDay && s.fullCount !== null && s.fullTurnCount !== null
      ? `<span>全天 <b>${s.fullCount}</b> 条 / <b>${s.fullTurnCount}</b> 轮</span>`
      : '';
  const first = s.firstTs !== null ? `<time datetime="${escapeHtml(s.firstTs.datetime)}">${escapeHtml(s.firstTs.text)}</time>` : '';
  const last = s.lastTs !== null ? `<time datetime="${escapeHtml(s.lastTs.datetime)}">${escapeHtml(s.lastTs.text)}</time>` : '';
  const timeRange = first !== '' || last !== '' ? `<span>${first}${first !== '' && last !== '' ? ' – ' : ''}${last}</span>` : '';
  const turns = s.turns.map(renderTurnGroup).join('');

  return `
        <details class="sess${liveCls}"${openAttr}>
          <summary class="sess__head">
            <span class="sess__dot"></span>
            <div class="sess__titlewrap">
              <span class="sess__title">${escapeHtml(s.title)}</span>
              <span class="sess__id">${escapeHtml(sidShort)}</span>
              ${liveTag}${crossTag}
            </div>
            <div class="sess__meta">
              ${timeRange}<span><b>${s.turnCount}</b> 轮</span><span><b>${s.eventCount}</b> 条</span>${crossMeta}
              <span class="sess__chev">▶</span>
            </div>
          </summary>
          <div class="sess__body">${turns}
          </div>
        </details>`;
}

/** git_commit 独立栏(无会话归属,不猜归属;当日 0 提交 → 空态一行)。 */
function renderCommitsBar(commits: CommitRowModel[]): string {
  if (commits.length === 0) {
    return `
        <div class="commits">
          <div class="commits__head"><b>Git 提交</b><em>无会话归属 · 独立呈现</em><span class="count-badge">0</span></div>
          <div class="commits__empty">当日还没有提交。</div>
        </div>`;
  }
  const rows = commits
    .map(
      (c) => `<div class="commit">
            <time class="commit__time" datetime="${escapeHtml(c.time.datetime)}">${escapeHtml(c.time.text)}</time>
            <span class="commit__hash" title="${escapeHtml(c.hash)}">${escapeHtml(c.hash)}</span>
            <span class="commit__msg" title="${escapeHtml(c.message)}">${escapeHtml(c.message)}</span>
            <span class="commit__diff"><span class="add">+${c.insertions}</span> <span class="del">-${c.deletions}</span></span>
          </div>`,
    )
    .join('\n          ');
  return `
        <div class="commits">
          <div class="commits__head"><b>Git 提交</b><em>无会话归属 · 独立呈现</em><span class="count-badge">${commits.length}</span></div>
          ${rows}
        </div>`;
}

/** 日期分组(L1):标题 + 会话卡 + git 栏。 */
function renderDayGroup(d: DayGroupModel): string {
  const cards = d.sessionCards.map(renderSessionCard).join('');
  return `
      <div class="tl-daywrap">
        <div class="tl-day"><b>${escapeHtml(d.label)}</b><em>${escapeHtml(d.dateLabel)}</em><span class="daymeta">${escapeHtml(d.meta)}</span></div>
${cards}
${renderCommitsBar(d.commits)}
      </div>`;
}

/** 空状态(spec §3.4 三态;复用基座 .empty 结构,不新增类避免知识库页回归)。 */
function renderTlEmpty(kind: 'timeline-empty' | 'today-empty' | 'no-match', clearAllHref: string): string {
  if (kind === 'timeline-empty') {
    return `
    <div class="empty">
      <span class="empty__glyph">≡</span>
      <h3 class="empty__title">尚未记录任何事件</h3>
      <p class="empty__text">在目标项目接入 timeline hooks,事件将自动落入 .cgraphx/cgraphx.db:</p>
      <p class="empty__hint"><code>cgraphx timeline install</code></p>
    </div>`;
  }
  if (kind === 'today-empty') {
    return `
    <div class="empty">
      <span class="empty__glyph">≡</span>
      <h3 class="empty__title">今天还没有开发事件</h3>
      <p class="empty__text">timeline hooks 在你使用 Claude Code 时自动记录事件——开始工作后刷新页面即可看到。</p>
    </div>`;
  }
  return `
    <div class="empty">
      <span class="empty__glyph">⌕</span>
      <h3 class="empty__title">没有符合筛选条件的事件</h3>
      <p class="empty__text">当前筛选组合没有命中任何会话或事件。</p>
      <a class="empty__reset" href="${escapeHtml(clearAllHref)}">重置筛选</a>
    </div>`;
}

// ----- 页面主区 ------------------------------------------------------------

/** 渲染时间线页主区内容(壳由 layout.renderShellPage 提供)。 */
export function renderTimelineContent(m: TimelineContentModel): string {
  const truncation =
    m.truncationNotice !== null
      ? `<div class="tl-contract">${escapeHtml(m.truncationNotice)}</div>`
      : '';

  const body =
    m.empty !== 'none'
      ? renderTlEmpty(m.empty, m.clearAllHref)
      : m.dayGroups.map(renderDayGroup).join('\n');

  return `
  <div class="tl-layout">
    ${renderTlFilters(m)}
    <div class="tl-main">
      ${renderStatbar(m)}
      <div class="list-head">
        <h2>事件流 <span class="count-badge">${escapeHtml(m.countBadge)}</span></h2>
        <div class="legend">
          <span><i style="background:var(--blue)"></i>Prompt</span>
          <span><i style="background:var(--pine-2)"></i>工具调用</span>
          <span><i style="background:#7FA98F"></i>工具完成</span>
          <span><i style="background:var(--ink-3)"></i>Stop</span>
          <span><i style="background:var(--orange)"></i>Git 提交</span>
          <span><i style="background:var(--gold);border-radius:50%"></i>▸▸ 子Agent(仅完成行)</span>
        </div>
      </div>
      ${renderTlPills(m)}
      ${truncation}
      ${body}
    </div>
  </div>`;
}
