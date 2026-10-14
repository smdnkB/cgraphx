/**
 * 知识库文档详情页(spec §3.4 / §5.2 / §8 / §11 #6/#7)。
 *
 * 只读 SSR:GET /doc/<ident> → 元数据网格 + 摘要块 + 源文件 markdown 全文
 * 服务端渲染 + 双向引用导航 + 文档 ID/路径展示;未找到与源文件缺失各自有
 * 明确状态(spec §8)。
 *
 * 数据消费硬约定:只经 markdown 子系统门面(MarkdownQuery / stripFrontmatter /
 * DocumentNotFoundError),不伸手进内部模块。每请求以基座进程级连接构造
 * `new MarkdownQuery(db)`(无状态、廉价,只读 SELECT)。
 *
 * 转义边界(XSS 契约,spec §3.2):所有元数据字段 / 路径 / 引用标题插值前过
 * escapeHtml;**仅** markdown-it 输出(renderMarkdownBody)作为可信 HTML 直出。
 */

import * as fs from 'node:fs';
import * as path from 'node:path';

import {
  MarkdownQuery,
  stripFrontmatter,
  DocumentNotFoundError,
} from '../core/markdown';
import type { DocumentDetail, ReferenceTarget, ReferenceView } from '../core/markdown';
import type { SqliteDatabase } from '../core/db';

import { TYPE_LABELS, STATUS_LABELS, TYPE_TONES } from './constants';
import { renderShellPage } from './layout';
import { escapeHtml, docTime, epochTime, type TimeModel } from './render-utils';
import { renderMarkdownBody } from './markdown';
import { findCodemapViewsByConcepts } from './codemap-reader';
import { renderRelatedCodemapSection } from './codemap-templates';

// ----- 局部渲染 ------------------------------------------------------------

/** 文档未找到内容区(spec §8:未找到状态 + 返回列表入口)。 */
function renderNotFoundContent(ident: string): string {
  return `
    <section class="placeholder">
      <h1>文档未找到</h1>
      <p>没有与 <code>${escapeHtml(ident)}</code> 匹配的文档。</p>
      <p><a href="/">返回知识库首页</a></p>
    </section>`;
}

/** 列表型元数据值;空数组 → 「—」占位(spec §3.4,不崩)。 */
function renderListValue(items: string[], opts: { mono?: boolean } = {}): string {
  if (items.length === 0) return '<span class="meta__empty">—</span>';
  return items
    .map((i) =>
      opts.mono === true
        ? `<code class="meta__code">${escapeHtml(i)}</code>`
        : `<span class="meta__item">${escapeHtml(i)}</span>`,
    )
    .join(' ');
}

/** 时间型元数据值;null → 「—」占位。纯日期不挂 data-local-time(避免 UTC 解析偏移)。 */
function renderTimeValue(t: TimeModel | null): string {
  if (t === null) return '<span class="meta__empty">—</span>';
  const localAttr = /^\d{4}-\d{2}-\d{2}$/.test(t.datetime) ? '' : ' data-local-time';
  return `<time datetime="${escapeHtml(t.datetime)}"${localAttr}>${escapeHtml(t.text)}</time>`;
}

/** 头部:类型徽标 + 大标题 + alias/领域/状态辅助行(spec §3.4)。 */
function renderDetailHeader(doc: DocumentDetail): string {
  const tone = TYPE_TONES[doc.documentType];
  const alias =
    doc.aliases.length > 0
      ? `<span class="detail__alias">${escapeHtml(doc.aliases.join(' / '))}</span>`
      : '';
  const domains =
    doc.domains.length > 0
      ? `<span class="detail__domains">${escapeHtml(doc.domains.join(' / '))}</span>`
      : '';
  return `
    <header class="detail__head">
      <div class="tbadge tbadge--${tone}"><b>${escapeHtml(TYPE_LABELS[doc.documentType])}</b><i>${escapeHtml(doc.documentType.toUpperCase())}</i></div>
      <h1 class="detail__title">${escapeHtml(doc.title)}</h1>
      <div class="detail__aux">
        ${alias}
        ${domains}
        <span class="status status--${doc.status}"><b></b>${escapeHtml(STATUS_LABELS[doc.status])} ${escapeHtml(doc.status)}</span>
      </div>
    </header>`;
}

/** 文档标识区:文档 ID(等宽)+ 项目相对路径(spec §3.4,便于回 CLI/编辑器定位)。 */
function renderIdentity(doc: DocumentDetail): string {
  return `
    <section class="detail__identity">
      <div class="detail__seclab">文档标识 <i>IDENT</i></div>
      <dl class="detail__ids">
        <dt>文档 ID</dt><dd><code class="detail__docid">${escapeHtml(doc.id)}</code></dd>
        <dt>项目相对路径</dt><dd><code class="detail__path">${escapeHtml(doc.path)}</code></dd>
      </dl>
    </section>`;
}

/** 元数据网格八组(spec §3.4:负责人/领域/创建/更新/概念/标签/相关代码/索引时间)。 */
function renderMetaGrid(doc: DocumentDetail): string {
  const cell = (zh: string, en: string, body: string): string =>
    `<div class="meta__cell"><div class="meta__lab">${escapeHtml(zh)} <i>${escapeHtml(en)}</i></div><div class="meta__val">${body}</div></div>`;
  return `
    <div class="meta-grid">
      ${cell('负责人', 'OWNERS', renderListValue(doc.owners))}
      ${cell('领域', 'DOMAINS', renderListValue(doc.domains))}
      ${cell('创建时间', 'CREATED', renderTimeValue(docTime(doc.createdAt)))}
      ${cell('更新时间', 'UPDATED', renderTimeValue(docTime(doc.updatedAt)))}
      ${cell('概念', 'CONCEPTS', renderListValue(doc.concepts))}
      ${cell('标签', 'TAGS', renderListValue(doc.tags))}
      ${cell('相关代码', 'RELATED CODE', renderListValue(doc.relatedCode, { mono: true }))}
      ${cell('索引时间', 'INDEXED', renderTimeValue(epochTime(doc.indexedAt)))}
    </div>`;
}

/** 摘要块:索引中的 summary_text(spec §3.4;空摘要不渲染)。 */
function renderSummary(doc: DocumentDetail): string {
  if (doc.summary.trim() === '') return '';
  return `
    <section class="detail__summary">
      <div class="detail__seclab">摘要 <i>SUMMARY</i></div>
      <p>${escapeHtml(doc.summary)}</p>
    </section>`;
}

/** 源文件缺失/不可读提示(spec §8:转义路径,HTTP 200 下的全文区状态)。 */
function renderMissingSource(docPath: string): string {
  return `<div class="detail__missing">源文件缺失或不可读: <code>${escapeHtml(docPath)}</code></div>`;
}

/**
 * 读取源文件并渲染全文(spec §5.2 路径边界 / §8 源文件缺失)。
 *
 * 数据源 = path.join(projectRoot, doc.path),doc.path **只取自 getDocumentDetail
 * 返回值**,路由侧不接受任何文件路径参数。纵深防御:path.resolve 后校验仍在
 * projectRoot 内,否则按源文件缺失处理(绝不越界读取)。readFileSync 抛错
 * (被删/无权限)→ 缺失提示,详情页其余部分照常渲染,HTTP 200。
 */
function renderSourceBody(projectRoot: string, doc: DocumentDetail): string {
  const root = path.resolve(projectRoot);
  const absPath = path.resolve(root, doc.path);
  // 纵深防御:解析后必须仍在项目根内,否则视为源文件缺失。
  const withinRoot = absPath === root || absPath.startsWith(root + path.sep);
  if (!withinRoot) {
    return renderMissingSource(doc.path);
  }
  let raw: string;
  try {
    raw = fs.readFileSync(absPath, 'utf-8');
  } catch {
    return renderMissingSource(doc.path);
  }
  return `<div class="prose">${renderMarkdownBody(stripFrontmatter(raw))}</div>`;
}

/** 引用分区条目:标题 + 项目相对路径(小字),整条为 /doc/<target.id> 链接。 */
function renderRefList(targets: ReferenceTarget[], emptyText: string): string {
  if (targets.length === 0) return `<p class="refs__empty">${escapeHtml(emptyText)}</p>`;
  const items = targets
    .map(
      (t) => `
        <li class="refs__item">
          <a class="refs__link" href="/doc/${encodeURIComponent(t.id)}">
            <span class="refs__title">${escapeHtml(t.title)}</span>
            <span class="refs__path">${escapeHtml(t.path)}</span>
          </a>
        </li>`,
    )
    .join('');
  return `<ul class="refs__list">${items}
      </ul>`;
}

/**
 * 双向引用栏(spec §3.4):出向(本文档 → 其他)与入向(其他 → 本文档)分区。
 * 引用条目不含类型徽标(避免对每条引用回查类型造成 N+1,已记录的设计偏差)。
 */
function renderReferences(refs: ReferenceView): string {
  return `
    <aside class="refs">
      <div class="refs__group">
        <div class="refs__lab">引用 →(${refs.outgoing.length})</div>
        ${renderRefList(refs.outgoing, '无出向引用')}
      </div>
      <div class="refs__group">
        <div class="refs__lab">← 被引用(${refs.incoming.length})</div>
        ${renderRefList(refs.incoming, '无入向引用')}
      </div>
    </aside>`;
}

// ----- 页面入口 ------------------------------------------------------------

/** 详情页渲染结果:status 仅 200(命中,含源文件缺失)/ 404(文档未找到)。 */
export interface DetailRenderResult {
  status: 200 | 404;
  html: string;
}

/**
 * 渲染文档详情页完整 HTML(壳 + 主区)。
 *
 * @param db 基座进程级单连接(每请求 new MarkdownQuery(db),只读 SELECT)。
 * @param projectRoot 项目根(源文件读取基准;源文件路径仅从索引 DB 解析)。
 * @param ident decodeURIComponent 后的 64 位十六进制 ID 或项目相对路径。
 */
export function renderDetailPage(
  db: SqliteDatabase,
  projectRoot: string,
  ident: string,
  ctx: { version: string; localHost: string },
): DetailRenderResult {
  const query = new MarkdownQuery(db);

  const doc = query.getDocumentDetail(ident);
  if (doc === null) {
    return {
      status: 404,
      html: renderShellPage({
        title: '文档未找到',
        active: 'knowledge',
        contentHtml: renderNotFoundContent(ident),
        version: ctx.version,
        localHost: ctx.localHost,
      }),
    };
  }

  // 引用视图与详情同一 ident 取(门面硬约定);doc 已存在 ⇒ 正常路径不抛错,
  // 仍以 try/catch 兜底 DocumentNotFoundError(防御性),其余错误原样上抛由
  // 基座 500 兜底。
  let refs: ReferenceView;
  try {
    refs = query.getReferences(ident);
  } catch (err) {
    if (err instanceof DocumentNotFoundError) {
      return {
        status: 404,
        html: renderShellPage({
          title: '文档未找到',
          active: 'knowledge',
          contentHtml: renderNotFoundContent(ident),
          version: ctx.version,
          localHost: ctx.localHost,
        }),
      };
    }
    throw err;
  }

  const contentHtml = `
  <div class="detail">
    <a class="detail__back" href="/">‹ 返回知识库</a>
    <div class="detail__layout">
      <div class="detail__main">
        ${renderDetailHeader(doc)}
        ${renderIdentity(doc)}
        ${renderMetaGrid(doc)}
        ${renderSummary(doc)}
        ${renderRelatedCodemapSection(findCodemapViewsByConcepts(projectRoot, doc.concepts))}
        <section class="detail__fulltext">
          <div class="detail__seclab">正文 <i>FULL TEXT</i></div>
          ${renderSourceBody(projectRoot, doc)}
        </section>
      </div>
      ${renderReferences(refs)}
    </div>
  </div>`;

  return {
    status: 200,
    html: renderShellPage({
      title: doc.title,
      active: 'knowledge',
      contentHtml,
      version: ctx.version,
      localHost: ctx.localHost,
    }),
  };
}
