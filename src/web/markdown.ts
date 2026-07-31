/**
 * markdown 正文渲染器(spec §3.4 全文渲染 / §5.2 数据源边界 / §11 #7)。
 *
 * 进程级 markdown-it 单例,选项**固定** `{ html: false, linkify: false,
 * typographer: false }`:
 *   - html:false → 正文内的原始 HTML 一律转义为文本(XSS 契约,spec §3.2);
 *   - linkify:false → 裸 URL 不自动转链接(避免意外出站);
 *   - typographer:false → 不做排版替换(保留原文标点)。
 * 内置规则(标题层级 / 段落 / 列表 / 行内与围栏代码 / 表格 / 引用块)默认
 * 启用,不引入任何插件(YAGNI:内置规则已覆盖 spec §3.4 的呈现清单)。
 *
 * 边界:本模块只做「markdown 文本 → 可信 HTML」的纯转换,不感知文件路径——
 * 数据源(源文件路径解析 / 读取 / frontmatter 剥离)由 pages-detail.ts 承担,
 * 从构造上杜绝「给个路径就渲染」的端点(spec §5.2 / §11 #7)。
 */

import MarkdownIt from 'markdown-it';

/** 单例:选项固定、渲染无状态,可安全跨请求复用。 */
const renderer = new MarkdownIt({
  html: false,
  linkify: false,
  typographer: false,
});

/**
 * 渲染 markdown 正文为 HTML 片段(不含壳)。
 *
 * 返回值是本系统中**唯一**作为可信 HTML 直出的内容;其余一切插值(元数据、
 * 路径、引用标题……)由调用方过 escapeHtml。
 */
export function renderMarkdownBody(markdown: string): string {
  return renderer.render(markdown);
}
