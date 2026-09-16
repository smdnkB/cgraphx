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

/** 表清单页:单项表。 */
export interface TableItemModel {
  /** 表名。 */
  name: string;
  /** 表注释(INDEX.md 第二列);无则空串。 */
  comment: string;
  /** 进入 DDL 详情页的链接:/schema/<工程>/<表>。 */
  href: string;
}

/** 工程切换 tab(表清单页顶部,多工程时出现)。 */
export interface ProjectTabModel {
  /** 工程名。 */
  name: string;
  /** 该工程的表清单链接:/schema/<工程>。 */
  href: string;
  /** 是否当前激活工程。 */
  active: boolean;
}

/** 表清单页视图。 */
export interface TablesPageModel {
  /** 工程名(展示用)。 */
  projectName: string;
  /** INDEX 不可读降级标志(展示"INDEX 不可读,已列出 ddl/ 文件")。 */
  indexReadable: boolean;
  /** 表清单。空 → 空态。 */
  tables: TableItemModel[];
  /** 经验沉淀页链接:/schema/<工程>/insights。 */
  insightsHref: string;
  /** 返回工程列表链接(空态/兜底用;多工程 tab 时一般不显示)。 */
  backHref: string;
  /** 工程切换 tab 列表。仅多工程时填充(单工程为空数组 → 不渲染 tab 区)。 */
  projectTabs: ProjectTabModel[];
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

/** 表清单页主区。 */
export function renderTablesContent(m: TablesPageModel): string {
  // 工程切换 tab:仅多工程时渲染(单工程 projectTabs 为空 → 不渲染,页面更净)。
  const tabsHtml = m.projectTabs.length === 0
    ? ''
    : `<nav class="proj-tabs">${m.projectTabs
        .map((t) => {
          const cls = t.active ? 'proj-tabs__tab proj-tabs__tab--active' : 'proj-tabs__tab';
          return `<a class="${cls}" href="${escapeHtml(t.href)}">${escapeHtml(t.name)}</a>`;
        })
        .join('')}</nav>`;
  const indexNotice = m.indexReadable
    ? ''
    : '<p class="schema-notice">INDEX.md 不可读,已按 ddl/ 目录文件名列出(无表注释)。</p>';
  const items = m.tables
    .map((t) => `
        <a class="table-row" href="${escapeHtml(t.href)}">
          <span class="table-row__name">${escapeHtml(t.name)}</span>
          <span class="table-row__comment">${escapeHtml(t.comment)}</span>
        </a>`)
    .join('');
  const listHtml = m.tables.length === 0
    ? '<p class="schema-notice">该工程下未发现 DDL 文件。</p>'
    : `<div class="table-list">${items}
      </div>`;
  return `
    <section class="schema-list">
      <div class="schema-list__head">
        <h1>${escapeHtml(m.projectName)}</h1>
        <a class="schema-insights-link" href="${escapeHtml(m.insightsHref)}">经验沉淀 →</a>
      </div>
      ${tabsHtml}
      ${indexNotice}
      ${listHtml}
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
