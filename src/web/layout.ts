/**
 * 应用壳模板(spec §3.2 / §11 #12,视觉基线 plan index §7.7)。
 *
 * 深松绿侧栏四入口(知识库 / 开发时间线 / 模型知识库 / 系统地图)+
 * 顶栏(页面标题 + 只读 pill「本地 · <host:port> · 只读」)。
 * 字体经 Google Fonts 引入(Space Grotesk / Noto Sans SC / JetBrains Mono,
 * display=swap),字体栈尾部系统字体兜底(离线仅视觉降级)。
 *
 * B-2 的 renderShellPage 最小骨架在本文件升级为完整视觉壳(任务允许:
 * 「renderShellPage 可重构进 layout.ts」);404/500 错误页复用本壳,
 * 其行为(状态码 + 文案要素)保持不变。
 */

import { escapeHtml } from './render-utils';

/** 当前导航激活项。'none' 表示错误页等非导航页面。 */
export type ShellActive = 'knowledge' | 'timeline' | 'schema' | 'codemap' | 'none';

/** 侧栏导航条目。href 为 null → 「后续」灰置占位(不可点击)。 */
function navItem(label: string, glyph: string, href: string | null, key: ShellActive, active: ShellActive): string {
  if (href === null) {
    // 「后续」灰置占位:渲染为 span(无 href ⇒ 不可点击,spec §3.2)。
    return `<span class="nav__item nav__item--disabled"><span class="nav__glyph">${escapeHtml(glyph)}</span>${escapeHtml(label)}<em class="nav__soon">后续</em></span>`;
  }
  const isActive = active === key;
  const cls = isActive ? 'nav__item nav__item--active' : 'nav__item';
  const aria = isActive ? ' aria-current="page"' : '';
  return `<a class="${cls}" href="${escapeHtml(href)}"${aria}><span class="nav__glyph">${escapeHtml(glyph)}</span>${escapeHtml(label)}</a>`;
}

/**
 * 渲染应用壳 + 主内容,返回完整 HTML 文档。
 *
 * `contentHtml` 为调用方已组装好的可信 HTML(其中的动态值由调用方自行
 * escapeHtml);title / version / localHost 在此统一转义。
 *
 * `navChildren`:某一级项的二级子菜单 HTML(调用方预渲染,基座只做容器)。
 * 当前仅 schema 模块用——「模型知识库」激活时,子项(各工程 + 经验沉淀)
 * 在侧栏该项下方展开。基座不感知子项数据(分层:基座不依赖 schema-reader)。
 *
 * @param localHost 顶栏只读 pill 展示的本地地址(形如 `127.0.0.1:2468`,
 *        port 0 启动时取实际端口)。
 */
export function renderShellPage(opts: {
  title: string;
  active: ShellActive;
  contentHtml: string;
  version: string;
  localHost: string;
  /** 「模型知识库」项下的二级子菜单 HTML(schema 模块预渲染;其他页不传)。 */
  navChildren?: string;
}): string {
  const { title, active, contentHtml, version, localHost, navChildren } = opts;
  const schemaChildren = navChildren !== undefined && navChildren !== ''
    ? `<div class="nav__children">${navChildren}</div>`
    : '';

  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)} · cgraphx web</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@500;700&family=Noto+Sans+SC:wght@400;500;700&family=JetBrains+Mono:wght@400;600&display=swap" rel="stylesheet">
<link rel="stylesheet" href="/assets/app.css">
</head>
<body>
<div class="shell">
  <aside class="shell__nav">
    <div class="nav__brand">cgraphx <span class="nav__brand-tag">WEB</span></div>
    <div class="nav__label">LOCAL DATA</div>
    <nav class="nav">
      ${navItem('知识库', '◈', '/', 'knowledge', active)}
      ${navItem('开发时间线', '≡', '/timeline', 'timeline', active)}
      ${navItem('模型知识库', '⛁', '/schema', 'schema', active)}
      ${schemaChildren}
      ${navItem('系统地图', '⌖', '/map', 'codemap', active)}
    </nav>
    <div class="nav__foot">cgraphx v${escapeHtml(version)}<br>local · read-only viewer</div>
  </aside>
  <div class="shell__body">
    <header class="shell__topbar">
      <div class="topbar__title">${escapeHtml(title)}</div>
      <span class="readonly-pill"><span class="readonly-pill__dot"></span>本地 · ${escapeHtml(localHost)} · 只读</span>
    </header>
    <main class="shell__main">
      ${contentHtml}
    </main>
  </div>
</div>
<script src="/assets/app.js" defer></script>
</body>
</html>
`;
}
