/**
 * 系统地图页面入口(spec §3.2 / §3.3 / §3.6,2026-10-14-cgraphx-web系统地图)。
 *
 * 只读 SSR:数据经 codemap-reader.ts 读文件 + git,模板经 codemap-templates.ts
 * 渲染,renderShellPage 套壳。视图页需要 db 仅为一件事:查知识库索引中的概念名,
 * 判断概念标签能否点击(契约 4,经 core/markdown 门面,只读 SELECT)。
 *
 * 404 不在本模块渲染(契约 8):视图不存在 / 坏文件 → 返回 `{ status: 404 }`,
 * 由 server.ts 走基座 sendNotFound。
 */

import type { SqliteDatabase } from '../core/db';
import { MarkdownQuery } from '../core/markdown';
import { listCodemapViews, readCodemapView, type CodemapKind } from './codemap-reader';
import { renderCodemapHomeContent, renderCodemapViewContent } from './codemap-templates';
import { renderShellPage } from './layout';

/** 页面壳上下文。 */
export interface CodemapPageCtx {
  version: string;
  localHost: string;
}

/** 地图首页完整 HTML。 */
export function renderCodemapHomePage(projectRoot: string, ctx: CodemapPageCtx): string {
  return renderShellPage({
    title: '系统地图',
    active: 'codemap',
    contentHtml: renderCodemapHomeContent(listCodemapViews(projectRoot)),
    version: ctx.version,
    localHost: ctx.localHost,
  });
}

/** 视图页:命中 → 200 + html;不存在 / 格式无法解析 → 404(由路由层出基座 404 页)。 */
export function renderCodemapViewPage(
  db: SqliteDatabase,
  projectRoot: string,
  kind: CodemapKind,
  name: string,
  ctx: CodemapPageCtx,
): { status: 200; html: string } | { status: 404 } {
  const detail = readCodemapView(projectRoot, kind, name);
  if (detail === null) return { status: 404 };
  const linkable = new Set(new MarkdownQuery(db).listConcepts({ sort: 'name' }).map((c) => c.name));
  return {
    status: 200,
    html: renderShellPage({
      title: detail.entry.title ?? detail.entry.name,
      active: 'codemap',
      contentHtml: renderCodemapViewContent(detail, linkable),
      version: ctx.version,
      localHost: ctx.localHost,
    }),
  };
}
