/**
 * 开发任务页 HTML 模板(2026-10-14-cgraphx-web开发任务浏览 spec §4、§7;布局以线框 v3 为准)。
 *
 * 纯函数:输入视图模型、输出 HTML 字符串;所有动态文本经 escapeHtml。
 * 视图模型里的数字已由 task 门面算好、文本已由 pages-tasks 格式化,模板不做任何口径计算。
 * 事件行 / 提交行复用时间线页的渲染(renderEventRow / renderCommitRow),样式一致。
 */

import { escapeHtml } from './render-utils';
import {
  renderCommitRow,
  renderEventRow,
  type CommitRowModel,
  type EventRowModel,
} from './timeline-templates';

// ----- 视图模型 -------------------------------------------------------------

/** 可点或不可点的文件 / 页面引用。href 为 null 时只显示文本。 */
export interface LinkModel {
  href: string | null;
  text: string;
  /** 悬停提示(通常为项目相对路径)。 */
  title: string;
}

export interface TaskListRowModel {
  id: number;
  name: string;
  inProgress: boolean;
  source: string;
  status: string;
  sessions: string;
  commits: string;
  active: string;
  lastActivity: string;
}

export interface TaskListModel {
  rows: TaskListRowModel[];
  hasApiTask: boolean;
  truncated: boolean;
}

export interface ArtifactGroupModel {
  label: string;
  /** 默认收起(代码类)。 */
  collapsed: boolean;
  items: LinkModel[];
}

export interface ConceptModel {
  name: string;
  href: string | null;
}

/** 会话块内的一项:轮次组,或无轮次的单行。 */
export type SegmentRowModel = { kind: 'event'; row: EventRowModel } | { kind: 'commit'; row: CommitRowModel };
export type SegmentItemModel = { kind: 'turn'; label: string; rows: SegmentRowModel[] } | SegmentRowModel;

export interface SegmentBlockModel {
  sessionId: string;
  range: string;
  bindSource: string;
  stats: string;
  eventCount: number;
  turnCount: number;
  items: SegmentItemModel[];
  /** 超出显示上限时的提示文案;未超出为 null。 */
  hiddenHint: string | null;
}

export interface TaskDetailModel {
  name: string;
  source: string;
  externalId: string;
  status: string;
  url: LinkModel | null;
  featureDirs: string[];
  /** 从未绑定过会话为 null(只显示任务信息与三栏空态)。 */
  bound: {
    sessions: string;
    bindingNote: string;
    active: string;
    work: string;
    commits: string;
    events: string;
    truncatedNote: string | null;
    outputCount: number;
    outputs: ArtifactGroupModel[];
    references: ArtifactGroupModel[];
    concepts: ConceptModel[];
    overlapCount: number;
    segments: SegmentBlockModel[];
    eventStats: Array<{ label: string; count: number }>;
  } | null;
}

// ----- 列表页 ---------------------------------------------------------------

/** 截断说明(列表页与详情页同一文案)。 */
export const TRUNCATED_NOTE = '部分绑定段事件超过 10000 条,统计基于每段最近 10000 条事件';

function renderListEmpty(): string {
  return `
    <section class="placeholder">
      <h1>暂无开发任务</h1>
      <p>任务有两种来源:</p>
      <p>· 在 Claude Code 会话里执行 <code>cgraphx task use &lt;名称&gt;</code></p>
      <p>· 在需求 spec 头部写 <code>&gt; 任务: &lt;名称&gt;</code>,会话改动该需求目录时自动绑定</p>
    </section>`;
}

export function renderTaskListContent(m: TaskListModel): string {
  if (m.rows.length === 0) return renderListEmpty();
  const rows = m.rows
    .map((r) => {
      const tag = r.inProgress ? ' <span class="tasks__tag">进行中</span>' : '';
      return `<tr>
          <td><a class="tasks__name" href="/tasks/${r.id}">${escapeHtml(r.name)}</a>${tag}</td>
          <td>${escapeHtml(r.source)}</td>
          <td>${escapeHtml(r.status)}</td>
          <td class="tasks__num">${escapeHtml(r.sessions)}</td>
          <td class="tasks__num">${escapeHtml(r.commits)}</td>
          <td class="tasks__num">${escapeHtml(r.active)}</td>
          <td class="tasks__mono">${escapeHtml(r.lastActivity)}</td>
        </tr>`;
    })
    .join('\n        ');
  const truncated = m.truncated ? `<p class="tasks__note">${TRUNCATED_NOTE}</p>` : '';
  const apiNote = m.hasApiTask
    ? '<p class="tasks__hint">接口任务显示的是上次 <code>cgraphx task list</code> 拉取的缓存</p>'
    : '';
  return `
    <div class="tasks">
      <div class="schema-list__head">
        <h1>开发任务</h1>
        <p class="schema-list__hint">${m.rows.length} 个任务 · 按最近活动倒序</p>
      </div>
      ${truncated}
      <div class="tasks__tablewrap">
      <table class="tasks__table">
        <thead><tr><th>任务</th><th>来源</th><th>状态</th><th class="tasks__num">会话</th><th class="tasks__num">commit</th><th class="tasks__num">活跃时长</th><th>最近活动</th></tr></thead>
        <tbody>
        ${rows}
        </tbody>
      </table>
      </div>
      ${apiNote}
    </div>`;
}

/** 项目没有 task 表(spec §10 首行)。 */
export function renderTaskNotEnabledContent(): string {
  return `
    <section class="placeholder">
      <h1>本项目尚未启用开发任务</h1>
      <p>运行 <code>cgraphx install</code> 后可用。其它页面不受影响。</p>
    </section>`;
}

// ----- 详情页 ---------------------------------------------------------------

function renderLink(l: LinkModel): string {
  if (l.href === null) return `<span class="tasks__path" title="${escapeHtml(l.title)}">${escapeHtml(l.text)}</span>`;
  return `<a class="tasks__link" href="${escapeHtml(l.href)}" title="${escapeHtml(l.title)}">${escapeHtml(l.text)}</a>`;
}

function renderGroups(groups: ArtifactGroupModel[]): string {
  return groups
    .map((g) => {
      const items = g.items.map((l) => `<li>${renderLink(l)}</li>`).join('');
      const head = `<b>${escapeHtml(g.label)}</b> <span class="tasks__count">${g.items.length}</span>`;
      if (g.collapsed) {
        return `<div class="tasks__group"><details><summary>${head}</summary><ul class="tasks__files">${items}</ul></details></div>`;
      }
      return `<div class="tasks__group">${head}<ul class="tasks__files">${items}</ul></div>`;
    })
    .join('\n');
}

function renderSegmentRow(r: SegmentRowModel): string {
  return r.kind === 'commit' ? renderCommitRow(r.row) : renderEventRow(r.row);
}

function renderSegmentItems(items: SegmentItemModel[]): string {
  return items
    .map((it) => {
      if (it.kind !== 'turn') return `<div class="evlist">${renderSegmentRow(it)}</div>`;
      return `<div class="turn">${escapeHtml(it.label)}</div>
          <div class="evlist">
          ${it.rows.map(renderSegmentRow).join('\n          ')}
          </div>`;
    })
    .join('\n');
}

function renderSegment(s: SegmentBlockModel): string {
  const hint = s.hiddenHint !== null ? `<p class="tasks__note">${escapeHtml(s.hiddenHint)}</p>` : '';
  return `
      <div class="tasks__seg">
        <div class="tasks__seghead">
          <span class="tasks__mono" title="${escapeHtml(s.sessionId)}">${escapeHtml(s.sessionId.slice(0, 8))}</span>
          <span>${escapeHtml(s.range)}</span>
          <span class="tasks__tag tasks__tag--plain">${escapeHtml(s.bindSource)}</span>
          <span class="tasks__segstats">${escapeHtml(s.stats)}</span>
        </div>
        <details class="tasks__segbody">
          <summary>事件(${s.eventCount})· ${s.turnCount} 轮</summary>
          ${renderSegmentItems(s.items)}
          ${hint}
        </details>
      </div>`;
}

function renderSection(title: string, body: string): string {
  return `
      <section class="tasks__box">
        <div class="detail__seclab">${title}</div>
        ${body}
      </section>`;
}

const NEVER_BOUND = '<p class="tasks__empty">尚未绑定任何会话</p>';

export function renderTaskDetailContent(m: TaskDetailModel): string {
  const dash = '<span class="tasks__dim">—</span>';
  const info = `
      <dl class="tasks__info">
        <dt>来源</dt><dd>${escapeHtml(m.source)}</dd>
        <dt>外部编号</dt><dd>${m.externalId !== '' ? escapeHtml(m.externalId) : dash}</dd>
        <dt>状态</dt><dd>${m.status !== '' ? escapeHtml(m.status) : dash}</dd>
        <dt>链接</dt><dd>${m.url === null ? dash : m.url.href !== null ? `<a class="tasks__link" href="${escapeHtml(m.url.href)}" target="_blank" rel="noopener noreferrer">${escapeHtml(m.url.text)}</a>` : escapeHtml(m.url.text)}</dd>
        <dt>关联需求目录</dt><dd>${m.featureDirs.length > 0 ? m.featureDirs.map((d) => `<span class="tasks__path">${escapeHtml(d)}</span>`).join('<br>') : dash}</dd>
      </dl>`;

  const head = `
      <a class="schema-back" href="/tasks">← 返回任务列表</a>
      <div class="schema-list__head"><h1>${escapeHtml(m.name)}</h1></div>`;

  const b = m.bound;
  if (b === null) {
    return `
    <div class="tasks">
      ${head}
      ${info}
      ${renderSection('产出', NEVER_BOUND)}
      ${renderSection('参考', NEVER_BOUND)}
      ${renderSection('会话', NEVER_BOUND)}
    </div>`;
  }

  const totals = `
      <div class="tasks__stats">
        <div class="tasks__stat"><b>${escapeHtml(b.sessions)}</b><span>会话(${escapeHtml(b.bindingNote)})</span></div>
        <div class="tasks__stat"><b>${escapeHtml(b.active)}</b><span>活跃时长</span></div>
        <div class="tasks__stat"><b>${escapeHtml(b.work)}</b><span>工作时长</span></div>
        <div class="tasks__stat"><b>${escapeHtml(b.commits)}</b><span>commit</span></div>
        <div class="tasks__stat"><b>${escapeHtml(b.events)}</b><span>事件</span></div>
      </div>
      ${b.truncatedNote !== null ? `<p class="tasks__note">${escapeHtml(b.truncatedNote)}</p>` : ''}`;

  const outputs = b.outputs.length > 0 ? renderGroups(b.outputs) : '<p class="tasks__empty">暂无产出</p>';

  const conceptTags = b.concepts
    .map((c) =>
      c.href !== null
        ? `<a class="codemap__concept" href="${escapeHtml(c.href)}">${escapeHtml(c.name)}</a>`
        : `<span class="codemap__concept codemap__concept--missing" title="知识库中没有这个概念">${escapeHtml(c.name)}</span>`,
    )
    .join('');
  const refParts = [
    b.references.length > 0 ? renderGroups(b.references) : '',
    b.concepts.length > 0 ? `<div class="codemap__concepts"><span class="codemap__concepts-lab">查询过知识库概念:</span>${conceptTags}</div>` : '',
    b.overlapCount > 0 ? `<p class="tasks__hint">另有 ${b.overlapCount} 个文件既被参考也是本任务产出,只在产出栏显示</p>` : '',
  ].filter((s) => s !== '');
  const references = refParts.length > 0 ? refParts.join('\n') : '<p class="tasks__empty">未识别到参考</p>';

  const segments = b.segments.map(renderSegment).join('\n');
  const eventStats = b.eventStats
    .map((s) => `<div class="tasks__stat"><b>${s.count}</b><span>${escapeHtml(s.label)}</span></div>`)
    .join('');

  return `
    <div class="tasks">
      ${head}
      ${info}
      ${renderSection('合计', totals)}
      ${renderSection(`产出 · ${b.outputCount} 个文件`, outputs)}
      ${renderSection('参考 · 按命令记录推断', references)}
      ${renderSection('会话', segments)}
      ${renderSection('事件类型统计', `<div class="tasks__stats">${eventStats}</div>`)}
    </div>`;
}
