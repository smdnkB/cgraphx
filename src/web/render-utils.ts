/**
 * web 渲染辅助。
 *
 * - `escapeHtml`:所有 DB / 用户来源字符串插入 HTML 前必须过它(XSS 契约,
 *   spec §3.2 全局);占位页即执行此约束。
 * - `renderShellPage`:最小应用壳骨架(左侧三入口导航 + 顶栏只读标识 +
 *   主内容区,spec §3.2 / §11 #12)。完整视觉基线(配色/字体/卡片)在 B-3
 *   的 layout 层落地,此处仅提供结构化骨架与占位页所需版式。
 */

/** 当前导航激活项。'none' 表示错误页等非导航页面。 */
export type ShellActive = 'knowledge' | 'timeline' | 'none';

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

/**
 * 渲染应用壳骨架 + 主内容。`contentHtml` 为调用方已组装好的可信 HTML
 * (其中的动态值由调用方自行 escapeHtml);title / version 在此统一转义。
 */
export function renderShellPage(opts: {
  title: string;
  active: ShellActive;
  contentHtml: string;
  version: string;
}): string {
  const { title, active, contentHtml, version } = opts;

  // 三入口导航:知识库 / 开发时间线 / 数据库(后续,灰置不可点击)。
  const navItem = (label: string, href: string | null, key: ShellActive): string => {
    const isActive = active === key;
    const cls = isActive ? 'nav__item nav__item--active' : 'nav__item';
    if (href === null) {
      // 「后续」灰置占位:不可点击。
      return `<span class="nav__item nav__item--disabled">${escapeHtml(label)}<em class="nav__soon">后续</em></span>`;
    }
    const aria = isActive ? ' aria-current="page"' : '';
    return `<a class="${cls}" href="${escapeHtml(href)}"${aria}>${escapeHtml(label)}</a>`;
  };

  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)} · cgraphx web</title>
<link rel="stylesheet" href="/assets/app.css">
</head>
<body>
<div class="shell">
  <nav class="shell__nav">
    <div class="nav__brand">cgraphx</div>
    ${navItem('知识库', '/', 'knowledge')}
    ${navItem('开发时间线', '/timeline', 'timeline')}
    ${navItem('数据库', null, 'none')}
  </nav>
  <div class="shell__body">
    <header class="shell__topbar">
      <span class="readonly-pill">本地只读</span>
      <span class="topbar__version">cgraphx v${escapeHtml(version)}</span>
    </header>
    <main class="shell__main">
      ${contentHtml}
    </main>
  </div>
</div>
</body>
</html>
`;
}
