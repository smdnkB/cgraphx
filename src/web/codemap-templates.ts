/**
 * 系统地图 HTML 模板(spec §3.2 / §3.3 / §3.5 / §3.6,线框 v1,2026-10-14-cgraphx-web系统地图)。
 *
 * 纯函数:视图模型 → 主区 HTML(不含壳)。所有动态值过 escapeHtml;唯一直出的
 * 可信 HTML 是 renderMarkdownBody 的输出(markdown-it `html:false`)。
 *
 * mermaid 代码块不在服务端处理:正文照常输出为 `code.language-mermaid`,视图页
 * 外层带 `data-codemap`,由 app.js 在浏览器端按需绘制(契约 2 / 6)。
 */

import type { CodemapListing, CodemapViewDetail, CodemapViewEntry } from './codemap-reader';
import { renderMarkdownBody } from './markdown';
import { buildOverviewUrl } from './pages-overview';
import { escapeHtml } from './render-utils';

/** 视图页链接 `/map/<kind>/<name>`。 */
export function codemapViewHref(e: Pick<CodemapViewEntry, 'kind' | 'name'>): string {
  return `/map/${e.kind}/${encodeURIComponent(e.name)}`;
}

/** 「已过期」小标签(仅 stale 时输出)。 */
function staleTag(e: CodemapViewEntry): string {
  return e.stale.state === 'stale' ? ' <span class="codemap__stale-tag">已过期</span>' : '';
}

/** 首页单条:可解析 → 链接卡;坏文件 → 灰显不可点。 */
function renderListItem(e: CodemapViewEntry, showCommit: boolean): string {
  if (!e.parseOk) {
    return `
        <li class="codemap__item codemap__broken">
          <span class="codemap__item-title">${escapeHtml(e.fileName)}</span>
          <span class="codemap__item-meta">格式无法解析</span>
        </li>`;
  }
  const meta = [
    e.generated !== null ? `生成于 ${escapeHtml(e.generated)}` : '',
    showCommit && e.sourceCommit !== null ? `commit ${escapeHtml(e.sourceCommit)}` : '',
  ].filter((s) => s !== '').join(' · ');
  const summary = e.summary !== null ? `<p class="codemap__item-summary">${escapeHtml(e.summary)}</p>` : '';
  return `
        <li class="codemap__item">
          <a class="codemap__item-link" href="${escapeHtml(codemapViewHref(e))}">
            <span class="codemap__item-title">${escapeHtml(e.title ?? e.name)}</span>${staleTag(e)}
            ${summary}
            ${meta !== '' ? `<span class="codemap__item-meta">${meta}</span>` : ''}
          </a>
        </li>`;
}

/** 首页一个分区;为空显示「暂无」。 */
function renderSection(label: string, entries: CodemapViewEntry[], showCommit: boolean): string {
  const body = entries.length === 0
    ? '<p class="codemap__none">暂无</p>'
    : `<ul class="codemap__list">${entries.map((e) => renderListItem(e, showCommit)).join('')}
      </ul>`;
  return `
    <section class="codemap__section">
      <div class="detail__seclab">${escapeHtml(label)}</div>
      ${body}
    </section>`;
}

/** 地图首页主区。listing=null 或两组都为空 → 空态引导 /code-map-write。 */
export function renderCodemapHomeContent(listing: CodemapListing | null): string {
  if (listing === null || (listing.systems.length === 0 && listing.flows.length === 0)) {
    return `
    <section class="placeholder">
      <h1>还没有代码地图</h1>
      <p>在 Claude Code 中运行 <code>/code-map-write</code> 生成,生成后刷新本页即可浏览。</p>
    </section>`;
  }
  return `
    <div class="codemap">
      <div class="schema-list__head">
        <h1>系统地图</h1>
        <p class="schema-list__hint">docs/code-map/ · ${listing.systems.length} 份系统交互 · ${listing.flows.length} 个流程</p>
      </div>
      ${renderSection('系统交互', listing.systems, true)}
      ${renderSection('业务流程', listing.flows, false)}
    </div>`;
}

/** 概念行:对上的可点(跳知识库首页按概念筛选),对不上的虚线不可点。 */
function renderConcepts(concepts: string[], linkable: ReadonlySet<string>): string {
  if (concepts.length === 0) return '';
  const tags = concepts
    .map((c) => {
      if (linkable.has(c)) {
        const href = buildOverviewUrl({ types: [], statuses: [], domains: [], concepts: [c], sort: 'updated', page: 1 });
        return `<a class="codemap__concept" href="${escapeHtml(href)}">${escapeHtml(c)}</a>`;
      }
      return `<span class="codemap__concept codemap__concept--missing" title="知识库中没有这个概念">${escapeHtml(c)}</span>`;
    })
    .join('');
  return `<div class="codemap__concepts"><span class="codemap__concepts-lab">概念</span>${tags}</div>`;
}

/** 过期提示框(仅 stale)。 */
function renderStaleBox(e: CodemapViewEntry): string {
  if (e.stale.state !== 'stale') return '';
  const files = e.stale.changedFiles.map((f) => `<li><code>${escapeHtml(f)}</code></li>`).join('');
  return `
      <div class="codemap__stale-box">
        <strong>已过期:生成之后以下文件有改动,图可能和代码不符</strong>
        <ul>${files}</ul>
        <p>在 Claude Code 中运行 <code>/code-map-write</code> 重新生成</p>
      </div>`;
}

/** 去掉正文第一个 `# ` 一级标题行(与页头 title 重复)。 */
function dropFirstH1(body: string): string {
  const lines = body.split('\n');
  const idx = lines.findIndex((l) => l.startsWith('# '));
  if (idx !== -1) lines.splice(idx, 1);
  return lines.join('\n');
}

/** 视图页主区(系统交互 / 流程共用)。外层带 data-codemap 供 app.js 绘图。 */
export function renderCodemapViewContent(detail: CodemapViewDetail, linkableConcepts: ReadonlySet<string>): string {
  const e = detail.entry;
  const meta = [
    e.generated !== null ? `生成于 ${escapeHtml(e.generated)}` : '',
    e.sourceCommit !== null ? `commit ${escapeHtml(e.sourceCommit)}` : '',
    e.provider !== null ? `取结构方式:${escapeHtml(e.provider)}` : '',
  ].filter((s) => s !== '').join(' · ');
  const entryLine = e.entry !== null
    ? `<p class="codemap__meta">入口 <code>${escapeHtml(e.entry)}</code></p>`
    : '';
  return `
    <div class="codemap codemap--view" data-codemap>
      <a class="schema-back" href="/map">← 系统地图</a>
      <div class="schema-list__head">
        <h1>${escapeHtml(e.title ?? e.name)}</h1>
        ${meta !== '' ? `<p class="codemap__meta">${meta}</p>` : ''}
        ${entryLine}
        ${renderConcepts(e.concepts, linkableConcepts)}
      </div>
      ${renderStaleBox(e)}
      <div class="prose">${renderMarkdownBody(dropFirstH1(detail.body))}</div>
    </div>`;
}
