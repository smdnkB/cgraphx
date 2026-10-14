/**
 * web 渲染辅助。
 *
 * `escapeHtml`:所有 DB / 用户来源字符串插入 HTML 前必须过它(XSS 契约,
 * spec §3.2 全局)。应用壳模板见 `layout.ts`(B-3 起完整视觉壳由 layout
 * 承载,本文件保留跨模板共用的原子能力:转义 + 时间呈现)。
 *
 * 时间呈现(spec §4.2 全站契约):`TimeModel` / `docTime` / `epochTime` 是
 * 总览页与详情页共用的唯一口径,页面侧不得再各自重复定义。
 */

/**
 * 转义 HTML 特殊字符(`& < > " '`)。任何来自 DB 或请求侧的字符串
 * (版本、路径、错误消息、文档标题……)插入 HTML 前一律过此函数。
 */
export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// ----- 时间呈现(spec §4.2 全站契约,总览页与详情页共用同一口径)-----------

/** <time> 元素数据(datetime 供 app.js 本地化,text 为服务端本地时间)。 */
export interface TimeModel {
  datetime: string;
  text: string;
}

export function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

/** epoch ms → 服务进程本地时区「YYYY-MM-DD HH:mm」(本地工具,进程时区 = 用户时区)。 */
export function formatLocalDateTime(ms: number): string {
  const d = new Date(ms);
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

/** frontmatter 字符串时间 → <time> 数据;null/空 → null,不可解析降级原样呈现。 */
export function docTime(raw: string | null): TimeModel | null {
  if (raw === null || raw.trim() === '') return null;
  // 纯日期(frontmatter 常见形态):原样呈现,不做时区换算(日期即时区)。
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return { datetime: raw, text: raw };
  const ms = Date.parse(raw);
  if (Number.isNaN(ms)) return { datetime: raw, text: raw };
  return { datetime: new Date(ms).toISOString(), text: formatLocalDateTime(ms) };
}

/** epoch ms → <time datetime=ISO> 数据(app.js 按浏览器时区重格式化)。 */
export function epochTime(ms: number): TimeModel {
  return { datetime: new Date(ms).toISOString(), text: formatLocalDateTime(ms) };
}

/** 时长显示(开发任务页 spec §3.3):向下取整到分钟;≥1h → `<h>h <m>m`,否则 `<m>m`;0 → `0m`。 */
export function formatDuration(ms: number): string {
  const totalMin = Math.max(0, Math.floor(ms / 60_000));
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

/** 任务页时间(spec §3.3):进程本地时区;与 nowMs 同年 → `MM-DD HH:mm`,否则 `YYYY-MM-DD HH:mm`。 */
export function formatTaskTime(iso: string, nowMs: number): string {
  const d = new Date(Date.parse(iso));
  const md = `${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
  return d.getFullYear() === new Date(nowMs).getFullYear() ? md : `${d.getFullYear()}-${md}`;
}
