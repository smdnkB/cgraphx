/**
 * schema-knowledge 预览页面入口(spec §3.2-3.6 / §5.2 / §8)。
 *
 * 只读 SSR:数据经 schema-reader.ts 从 docs/schema-knowledge/ 文件系统读取,
 * 组装视图模型 → schema-templates.ts 渲染 → renderShellPage 套壳。
 *
 * 硬约定(契约 C,与 knowledge/timeline 页的关键差异):schema-knowledge 不进
 * `.cgraphx/cgraphx.db`,本模块**不持有 db 参数**——renderXxxPage 签名只有
 * projectRoot + ctx。每请求现扫目录(无缓存,spec §4.2 直读即最新)。
 *
 * 路径边界分层(契约 B):工程名/表名格式非法(含 ../)由 T-3 路由层拦为 404,
 * 不进 render;本模块仅对"格式合法但工程不存在"返回 404 壳、对"ddl 文件缺失"
 * 返回 status=200 + 缺失提示(spec §3.4 / §8)。
 *
 * XSS(契约 D):DDL 与 DISCOVERED 原文经 escapeHtml 后作 <pre> 内容(非可信 HTML)。
 */

import {
  listProjects,
  listTables,
  readDdlDetail,
  listInsights,
  listInsightsByTable,
  summarizeProject,
  type Insight,
} from './schema-reader';
import { type InsightTag } from './constants';
import { renderShellPage, type ShellActive } from './layout';
import { escapeHtml } from './render-utils';
import {
  renderProjectsContent,
  renderTablesContent,
  renderDdlContent,
  renderInsightsContent,
  renderNavChildren,
  INSIGHT_TAG_ORDER,
  type ProjectsPageModel,
  type TablesPageModel,
  type DdlPageModel,
  type InsightsPageModel,
  type InsightGroupModel,
  type NavChildModel,
  type TableCardModel,
  type TableTagCount,
} from './schema-templates';

/** 页面壳上下文(与 knowledge/timeline 页同构,供 layout 用)。 */
export interface SchemaPageCtx {
  version: string;
  localHost: string;
}

/** 详情页渲染结果:status 仅 200(命中,含文件缺失)/ 404(工程不存在)。 */
export interface SchemaDdlRenderResult {
  status: 200 | 404;
  html: string;
}

/** 导航激活项:schema 模块所有页面均 'schema'。 */
const ACTIVE: ShellActive = 'schema';

/** 拼 /schema/<工程> 链接。 */
function projectHref(projectName: string): string {
  return `/schema/${encodeURIComponent(projectName)}`;
}

/** 拼 /schema/<工程>/<表> 链接。 */
function tableHref(projectName: string, tableName: string): string {
  return `/schema/${encodeURIComponent(projectName)}/${encodeURIComponent(tableName)}`;
}

/** 拼 /schema/<工程>/insights 链接。 */
function insightsHref(projectName: string): string {
  return `/schema/${encodeURIComponent(projectName)}/insights`;
}

/** 表卡片首页经验摘要最多条数(前 N 条)。 */
const CARD_SNIPPET_LIMIT = 3;

/**
 * 组装侧栏二级菜单 HTML(模型知识库展开的子项:各工程 + 经验沉淀)。
 *
 * schema 所有页面调 renderShellPage 时注入。当前工程项 + (若匹配)经验沉淀项高亮。
 * 工程列表获取失败 → 返回空串(不渲染子项,基座不展开)。
 */
function buildNavChildren(
  projectRoot: string,
  currentProject: string | null,
  currentView: 'tables' | 'ddl' | 'insights' | null,
): string {
  const projects = listProjects(projectRoot);
  if (projects === null || projects.length === 0) return '';
  const items: NavChildModel[] = projects.map((p) => ({
    label: p.name,
    href: projectHref(p.name),
    active: currentView !== 'insights' && p.name === currentProject,
  }));
  // 经验沉淀子项:链接指向当前工程(无当前工程时指向首工程)。
  const insightsProject = currentProject ?? projects[0]?.name ?? '';
  if (insightsProject !== '') {
    items.push({
      label: '经验沉淀',
      href: insightsHref(insightsProject),
      active: currentView === 'insights' && currentProject !== null,
    });
  }
  return renderNavChildren({ items });
}

/** 工程列表页。projects=null(目录不存在)或空 → 空态(引导 export-table-ddl)。 */
export function renderSchemaProjectsPage(projectRoot: string, ctx: SchemaPageCtx): string {
  const projects = listProjects(projectRoot);
  let model: ProjectsPageModel;
  if (projects === null) {
    model = { projects: [], empty: 'kb-missing' };
  } else if (projects.length === 0) {
    model = { projects: [], empty: 'no-project' };
  } else {
    model = {
      projects: projects.map((p) => ({
        name: p.name,
        tableCount: p.tableCount,
        indexReadable: p.indexReadable,
        href: projectHref(p.name),
      })),
      empty: 'none',
    };
  }
  return renderShellPage({
    title: '模型知识库',
    active: ACTIVE,
    contentHtml: renderProjectsContent(model),
    version: ctx.version,
    localHost: ctx.localHost,
  });
}

/**
 * 表卡片首页(= 工程详情页)。
 *
 * 每张卡片:表名 + 表注释 + 标签计数徽标 + 前 N 条经验摘要,点击进 DDL 详情页。
 * 工程切换器移至侧栏二级菜单(模型知识库展开的工程子项)。projectName 格式非法
 * 由路由层拦(不进本函数);工程不存在 → 渲染 404 壳(路由层应已先判,此为兜底)。
 */
export function renderSchemaTablesPage(
  projectRoot: string,
  projectName: string,
  ctx: SchemaPageCtx,
): string {
  const tables = listTables(projectRoot, projectName);
  const projectMeta = summarizeProject(projectRoot, projectName);
  const indexReadable = projectMeta.indexReadable;

  // 按表聚合经验(表卡片的标签计数 + 摘要数据源)。
  const insightsByTable = listInsightsByTable(projectRoot, projectName) ?? [];
  const insightsMap = new Map<string, Insight[]>();
  for (const g of insightsByTable) {
    insightsMap.set(g.table, g.insights);
  }

  // 表卡片排序:有 DISCOVERED 经验的表排前面,经验条目多的更前(更值得关注);
  // 同经验数按表名稳定排序(字母升序,可预测)。
  const sortedTables = (tables ?? []).slice().sort((a, b) => {
    const ac = insightsMap.get(a.name)?.length ?? 0;
    const bc = insightsMap.get(b.name)?.length ?? 0;
    return bc - ac || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0);
  });

  const tableModels: TableCardModel[] = sortedTables.map((t) => {
    const insights = insightsMap.get(t.name) ?? [];
    // 标签计数:按 INSIGHT_TAG_ORDER 顺序,统计每个标签条目数。
    const tagCounts: TableTagCount[] = INSIGHT_TAG_ORDER.map((tag) => ({
      tag,
      count: insights.filter((i) => i.tag === tag).length,
    }));
    // 前 N 条经验摘要(escapeHtml,展示用)。
    const insightSnippets = insights
      .slice(0, CARD_SNIPPET_LIMIT)
      .map((i) => `<em class="tcard__tag tcard__tag--${i.tag}">${escapeHtml(i.tag)}</em> ${escapeHtml(i.text)}`);
    return {
      name: t.name,
      comment: t.comment,
      href: tableHref(projectName, t.name),
      tagCounts,
      insightSnippets,
    };
  });

  const model: TablesPageModel = {
    projectName,
    indexReadable,
    tables: tableModels,
    insightsHref: insightsHref(projectName),
  };
  return renderShellPage({
    title: projectName,
    active: ACTIVE,
    contentHtml: renderTablesContent(model),
    version: ctx.version,
    localHost: ctx.localHost,
    navChildren: buildNavChildren(projectRoot, projectName, 'tables'),
  });
}

/**
 * 单表 DDL 详情页。返回 { status, html }。
 * status=404 仅用于工程不存在(listTables 返回 null);文件缺失(exists=false)
 * → status=200 + 缺失提示(spec §3.4 / §8)。
 * 工程名/表名格式非法(含 ../)不进本函数——路由层(T-3)已拦为 404。
 */
export function renderSchemaDdlPage(
  projectRoot: string,
  projectName: string,
  tableName: string,
  ctx: SchemaPageCtx,
): SchemaDdlRenderResult {
  // 工程不存在 → 404。
  const tables = listTables(projectRoot, projectName);
  if (tables === null) {
    return {
      status: 404,
      html: renderShellPage({
        title: '工程未找到',
        active: ACTIVE,
        contentHtml: renderNotFoundContent(`工程 ${projectName} 不存在`),
        version: ctx.version,
        localHost: ctx.localHost,
        navChildren: buildNavChildren(projectRoot, null, null),
      }),
    };
  }

  const detail = readDdlDetail(projectRoot, projectName, tableName);
  const model: DdlPageModel = {
    projectName,
    tableName,
    ddlBody: escapeHtml(detail.ddlBody),
    discovered: detail.discovered === null ? null : escapeHtml(detail.discovered),
    missing: !detail.exists,
    backHref: projectHref(projectName),
    insightsHref: insightsHref(projectName),
  };
  return {
    status: 200,
    html: renderShellPage({
      title: tableName,
      active: ACTIVE,
      contentHtml: renderDdlContent(model),
      version: ctx.version,
      localHost: ctx.localHost,
      navChildren: buildNavChildren(projectRoot, projectName, 'ddl'),
    }),
  };
}

/** 经验沉淀页。projectName 格式非法由路由层拦(不进本函数);工程不存在 → 渲染 404 壳。 */
export function renderSchemaInsightsPage(
  projectRoot: string,
  projectName: string,
  ctx: SchemaPageCtx,
): string {
  const insights = listInsights(projectRoot, projectName);
  if (insights === null) {
    // 工程不存在 → 404 壳(路由层应已先判,此为兜底)。
    return renderShellPage({
      title: '工程未找到',
      active: ACTIVE,
      contentHtml: renderNotFoundContent(`工程 ${projectName} 不存在`),
      version: ctx.version,
      localHost: ctx.localHost,
      navChildren: buildNavChildren(projectRoot, null, null),
    });
  }

  // 按标签聚合(六类 + 其他,按 INSIGHT_TAG_ORDER 顺序,仅含有条目的标签)。
  const byTag = new Map<InsightTag, InsightGroupModel>();
  for (const tag of INSIGHT_TAG_ORDER) {
    byTag.set(tag, { tag, items: [] });
  }
  for (const ins of insights) {
    const group = byTag.get(ins.tag);
    if (group === undefined) continue;
    group.items.push({
      tag: ins.tag,
      text: escapeHtml(ins.text),
      table: ins.table,
      tableHref: tableHref(projectName, ins.table),
    });
  }
  const groups = INSIGHT_TAG_ORDER
    .map((tag) => byTag.get(tag))
    .filter((g): g is InsightGroupModel => g !== undefined && g.items.length > 0);

  const model: InsightsPageModel = {
    projectName,
    groups,
    totalCount: insights.length,
    backHref: projectHref(projectName),
  };
  return renderShellPage({
    title: '经验沉淀',
    active: ACTIVE,
    contentHtml: renderInsightsContent(model),
    version: ctx.version,
    localHost: ctx.localHost,
    navChildren: buildNavChildren(projectRoot, projectName, 'insights'),
  });
}

/** 未找到内容区(404 壳用)。 */
function renderNotFoundContent(message: string): string {
  return `
    <section class="placeholder">
      <h1>未找到</h1>
      <p>${escapeHtml(message)}</p>
      <p><a href="/schema">返回工程列表</a></p>
    </section>`;
}
