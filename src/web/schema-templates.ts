/**
 * schema-knowledge 预览页模板(纯 HTML 渲染函数,spec §3.2-3.6)。
 *
 * 设计:所有数据读取与 URL 拼装在上游(pages-schema.ts)完成,本文件只消费
 * 已组装好的视图模型做字符串渲染 —— 每个文件来源值(工程名/表名/DDL/DISCOVERED/
 * 注释)在插值处过 escapeHtml(XSS 契约,spec §3.2 / §5.2)。href 由上游经
 * encodeURIComponent 编码生成,插值处仍统一转义。
 *
 * DDL 本体与 DISCOVERED 块原文直出(契约 D):escapeHtml 后包进 <pre>,不解析、
 * 不高亮、不重排;markdown-it 不复用于 SQL(DDL 非 markdown)。
 */

import { escapeHtml } from './render-utils';
import { INSIGHT_TAGS, type InsightTag } from './constants';

// ----- 视图模型(上游 pages-schema.ts 组装)------------------------------

/** 工程列表页:单项工程卡。 */
export interface ProjectCardModel {
  /** 工程名(= 目录名)。 */
  name: string;
  /** ✓ 状态表数;INDEX 不可读时为 -1。 */
  tableCount: number;
  /** INDEX.md 是否可解析。 */
  indexReadable: boolean;
  /** 进入表清单页的链接:/schema/<工程>。 */
  href: string;
}

/** 工程列表页视图。 */
export interface ProjectsPageModel {
  /** 工程卡。空 → 空态(目录不存在 / 零工程)。 */
  projects: ProjectCardModel[];
  /** 空态类型:kb-missing(目录不存在)/ no-project(无工程)/ none。 */
  empty: 'kb-missing' | 'no-project' | 'none';
}

/** 表卡片首页:单项表的标签计数。 */
export interface TableTagCount {
  /** 标签。 */
  tag: InsightTag;
  /** 该标签下经验条目数。 */
  count: number;
}

/** 表卡片首页:单项表卡片。 */
export interface TableCardModel {
  /** 表名。 */
  name: string;
  /** 表注释(INDEX.md 第二列);无则空串。 */
  comment: string;
  /** 进入 DDL 详情页的链接:/schema/<工程>/<表>。 */
  href: string;
  /** 各标签经验条目数(展示用,计数徽标)。 */
  tagCounts: TableTagCount[];
  /** 前 N 条经验摘要(已 escapeHtml,展示用;无经验则空数组)。 */
  insightSnippets: string[];
}

/** 侧栏二级菜单子项(模型知识库展开的工程 + 经验沉淀)。 */
export interface NavChildModel {
  /** 显示名(工程名 / "经验沉淀")。 */
  label: string;
  /** 链接:/schema/<工程> 或 /schema/<工程>/insights。 */
  href: string;
  /** 是否当前激活。 */
  active: boolean;
}

/** 侧栏二级菜单视图:父项"模型知识库"下的子项列表。 */
export interface NavChildrenModel {
  /** 子项(各工程 + 经验沉淀项)。 */
  items: NavChildModel[];
}
export interface TablesPageModel {
  /** 工程名(展示用)。 */
  projectName: string;
  /** INDEX 不可读降级标志(展示"INDEX 不可读,已列出 ddl/ 文件")。 */
  indexReadable: boolean;
  /** 表卡片。空 → 空态。 */
  tables: TableCardModel[];
  /** 经验沉淀页链接:/schema/<工程>/insights(顶部入口)。 */
  insightsHref: string;
}

/** DDL 详情页视图。 */
export interface DdlPageModel {
  /** 工程名(展示用)。 */
  projectName: string;
  /** 表名(展示用)。 */
  tableName: string;
  /** DDL 本体原文(已 escapeHtml)。 */
  ddlBody: string;
  /** DISCOVERED 块原文(已 escapeHtml);无块则 null。 */
  discovered: string | null;
  /** 文件缺失标志(展示"DDL 文件缺失")。 */
  missing: boolean;
  /** 返回表清单链接。 */
  backHref: string;
  /** 经验沉淀页链接。 */
  insightsHref: string;
}

/** 经验沉淀页:单条经验。 */
export interface InsightItemModel {
  /** 标签。 */
  tag: InsightTag;
  /** 标签后内容(已 escapeHtml)。 */
  text: string;
  /** 归属表名。 */
  table: string;
  /** 跳转该表 DDL 详情的链接。 */
  tableHref: string;
}

/** 经验沉淀页:按标签分区的单组。 */
export interface InsightGroupModel {
  /** 标签。 */
  tag: InsightTag;
  /** 该分区经验条目。 */
  items: InsightItemModel[];
}

/** 经验沉淀页视图。 */
export interface InsightsPageModel {
  /** 工程名(展示用)。 */
  projectName: string;
  /** 按标签聚合的分组(六类 + 其他,仅含有条目的标签)。 */
  groups: InsightGroupModel[];
  /** 总经验数。 */
  totalCount: number;
  /** 返回表清单链接。 */
  backHref: string;
}

// ----- 渲染 ----------------------------------------------------------------

/** 空态区块。 */
function renderEmpty(message: string, hint: string): string {
  return `
    <section class="placeholder">
      <h1>${escapeHtml(message)}</h1>
      <p>${escapeHtml(hint)}</p>
      <p><a href="/">返回知识库首页</a></p>
    </section>`;
}

/** 工程列表页主区。 */
export function renderProjectsContent(m: ProjectsPageModel): string {
  if (m.empty !== 'none') {
    if (m.empty === 'kb-missing') {
      return renderEmpty(
        '未导出 schema-knowledge',
        '运行 export-table-ddl skill 建立基线,导出 DDL 快照到 docs/schema-knowledge/ 后即可在此浏览。',
      );
    }
    return renderEmpty('暂无工程', 'docs/schema-knowledge/ 目录下尚无工程子目录,运行 export-table-ddl skill 建基线。');
  }
  const cards = m.projects
    .map((p) => {
      const countText = p.indexReadable
        ? `${p.tableCount} 张表`
        : 'INDEX.md 不可读';
      return `
        <a class="proj-card" href="${escapeHtml(p.href)}">
          <span class="proj-card__name">${escapeHtml(p.name)}</span>
          <span class="proj-card__count">${escapeHtml(countText)}</span>
        </a>`;
    })
    .join('');
  return `
    <section class="schema-list">
      <div class="schema-list__head">
        <h1>模型知识库</h1>
        <p class="schema-list__hint">浏览 docs/schema-knowledge/ 下各工程的 DDL 与团队沉淀的 DISCOVERED 经验。本地只读,不连库。</p>
      </div>
      <div class="proj-grid">${cards}
      </div>
    </section>`;
}

/** 侧栏二级菜单(模型知识库展开的子项)。 */
export function renderNavChildren(m: NavChildrenModel): string {
  return m.items
    .map((c) => {
      const cls = c.active ? 'nav__child nav__child--active' : 'nav__child';
      const aria = c.active ? ' aria-current="page"' : '';
      return `<a class="${cls}" href="${escapeHtml(c.href)}"${aria}>${escapeHtml(c.label)}</a>`;
    })
    .join('');
}

/** 表卡片首页主区。 */
export function renderTablesContent(m: TablesPageModel): string {
  const indexNotice = m.indexReadable
    ? ''
    : '<p class="schema-notice">INDEX.md 不可读,已按 ddl/ 目录文件名列出(无表注释)。</p>';
  if (m.tables.length === 0) {
    return `
    <section class="schema-list">
      <div class="schema-list__head">
        <h1>${escapeHtml(m.projectName)}</h1>
      </div>
      ${indexNotice}
      <p class="schema-notice">该工程下未发现 DDL 文件。</p>
    </section>`;
  }
  const cards = m.tables
    .map((t) => {
      // 标签计数徽标(仅 count>0 的标签)。
      const badges = t.tagCounts
        .filter((c) => c.count > 0)
        .map((c) => `<span class="tcard__badge tcard__badge--${c.tag}">${escapeHtml(c.tag)} ${c.count}</span>`)
        .join('');
      const badgesHtml = badges === '' ? '' : `<div class="tcard__badges">${badges}</div>`;
      // 前 N 条经验摘要(无经验则空)。
      const snippetsHtml = t.insightSnippets.length === 0
        ? ''
        : `<ul class="tcard__snippets">${t.insightSnippets
            .map((s) => `<li>${s}</li>`)
            .join('')}</ul>`;
      const commentHtml = t.comment === '' ? '' : `<p class="tcard__comment">${escapeHtml(t.comment)}</p>`;
      return `
        <a class="tcard" href="${escapeHtml(t.href)}">
          <div class="tcard__head">
            <span class="tcard__name">${escapeHtml(t.name)}</span>
          </div>
          ${commentHtml}
          ${badgesHtml}
          ${snippetsHtml}
        </a>`;
    })
    .join('');
  return `
    <section class="schema-list">
      <div class="schema-list__head">
        <h1>${escapeHtml(m.projectName)}</h1>
      </div>
      ${indexNotice}
      <div class="tcard-grid">${cards}
      </div>
    </section>`;
}

/** DDL 详情页主区。 */
export function renderDdlContent(m: DdlPageModel): string {
  const head = `
    <div class="schema-list__head">
      <a class="schema-back" href="${escapeHtml(m.backHref)}">‹ 返回表清单</a>
      <h1>${escapeHtml(m.tableName)}</h1>
      <span class="schema-project-tag">${escapeHtml(m.projectName)}</span>
      <a class="schema-insights-link" href="${escapeHtml(m.insightsHref)}">经验沉淀 →</a>
    </div>`;
  if (m.missing) {
    return `
    <section class="schema-list">
      ${head}
      <p class="schema-notice">DDL 文件缺失: <code>${escapeHtml(m.tableName)}</code></p>
    </section>`;
  }
  const discoveredSection = m.discovered === null
    ? ''
    : `
      <section class="schema-discovered">
        <div class="schema-discovered__lab">DISCOVERED <i>探索沉淀(非 DB 原生)</i></div>
        <pre class="schema-discovered__body">${m.discovered}</pre>
      </section>`;
  return `
    <section class="schema-list">
      ${head}
      <section class="schema-ddl-wrap">
        <div class="schema-ddl__lab">DDL <i>${escapeHtml(m.tableName)}</i></div>
        <pre class="schema-ddl">${m.ddlBody}</pre>
      </section>
      ${discoveredSection}
    </section>`;
}

/** 经验沉淀页主区。 */
export function renderInsightsContent(m: InsightsPageModel): string {
  if (m.groups.length === 0) {
    return `
    <section class="schema-list">
      <div class="schema-list__head">
        <a class="schema-back" href="${escapeHtml(m.backHref)}">‹ 返回表清单</a>
        <h1>经验沉淀</h1>
        <span class="schema-project-tag">${escapeHtml(m.projectName)}</span>
      </div>
      <p class="schema-notice">暂无探索沉淀的经验——db-query 探索发现可在 DDL 文件的 DISCOVERED 块补充。</p>
    </section>`;
  }
  const groups = m.groups
    .map((g) => {
      const items = g.items
        .map((i) => `
          <li class="insight-item">
            <a class="insight-item__table" href="${escapeHtml(i.tableHref)}">${escapeHtml(i.table)}</a>
            <span class="insight-item__text">${i.text}</span>
          </li>`)
        .join('');
      return `
        <section class="insight-group insight-group--${g.tag}">
          <h2 class="insight-group__lab">${escapeHtml(g.tag)} <i>(${g.items.length})</i></h2>
          <ul class="insight-list">${items}
          </ul>
        </section>`;
    })
    .join('');
  return `
    <section class="schema-list">
      <div class="schema-list__head">
        <a class="schema-back" href="${escapeHtml(m.backHref)}">‹ 返回表清单</a>
        <h1>经验沉淀</h1>
        <span class="schema-project-tag">${escapeHtml(m.projectName)}</span>
      </div>
      <p class="schema-list__hint">共 ${m.totalCount} 条经验,来自 ${escapeHtml(m.projectName)} 各表 DISCOVERED 块,按标签聚合。</p>
      <div class="insight-grid">${groups}
      </div>
    </section>`;
}

/** 经验标签显示顺序(六类 + 其他)。模板层只读,不修改常量。 */
export const INSIGHT_TAG_ORDER: readonly InsightTag[] = INSIGHT_TAGS;
