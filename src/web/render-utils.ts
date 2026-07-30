/**
 * web 渲染辅助。
 *
 * `escapeHtml`:所有 DB / 用户来源字符串插入 HTML 前必须过它(XSS 契约,
 * spec §3.2 全局)。应用壳模板见 `layout.ts`(B-3 起完整视觉壳由 layout
 * 承载,本文件仅保留转义这一处跨模板共用的原子能力)。
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
