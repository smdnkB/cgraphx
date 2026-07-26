# 设计文档 HTML 模板

适用于 feature 实现完成后沉淀的设计文档,面向研发、技术负责人和后续维护者。由 `code-impact-docgen` skill 在自测通过后生成,默认输出到 `docs/features/<feature-id>/<文件前缀>-设计文档.md`(HTML 内容嵌入 markdown 文件,或直接 `.html`)。

内容来源:`docs/knowledge/` 中与主题相关的 AI 知识文档 + 当前 feature 目录下的 spec/plan。

## 完整 HTML 结构

```html
<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>{文档标题} — {项目名称}</title>
  <style>
    :root {
      --bg: #ffffff;
      --surface: #f8f9fa;
      --text: #1d1d1f;
      --text-secondary: #6e6e73;
      --accent: #0071e3;
      --accent-light: #e8f0fe;
      --border: #d2d2d7;
      --code-bg: #f5f5f7;
      --font-sans: -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif;
      --font-mono: "SF Mono", "Fira Code", "Cascadia Code", "Source Code Pro", monospace;
      --max-width: 800px;
    }

    *, *::before, *::after { margin: 0; padding: 0; box-sizing: border-box; }

    body {
      font-family: var(--font-sans);
      font-size: 16px;
      line-height: 1.7;
      color: var(--text);
      background: var(--bg);
    }

    .container {
      max-width: var(--max-width);
      margin: 0 auto;
      padding: 2rem 1.5rem;
    }

    h1 {
      font-size: 2rem;
      font-weight: 700;
      letter-spacing: -0.02em;
      margin-bottom: 0.5em;
      padding-bottom: 0.5em;
      border-bottom: 2px solid var(--border);
    }

    .meta {
      color: var(--text-secondary);
      font-size: 0.875rem;
      margin-bottom: 2em;
    }

    h2 {
      font-size: 1.5rem;
      font-weight: 600;
      margin-top: 2.5em;
      margin-bottom: 0.75em;
      padding-bottom: 0.3em;
      border-bottom: 1px solid var(--border);
    }

    h3 {
      font-size: 1.2rem;
      font-weight: 600;
      margin-top: 1.5em;
      margin-bottom: 0.5em;
    }

    p { margin-bottom: 1em; }

    ul, ol {
      margin-bottom: 1em;
      padding-left: 1.5em;
    }

    li { margin-bottom: 0.3em; }

    strong { font-weight: 600; }

    code {
      font-family: var(--font-mono);
      background: var(--code-bg);
      padding: 0.15em 0.4em;
      border-radius: 4px;
      font-size: 0.9em;
    }

    pre {
      background: var(--code-bg);
      border: 1px solid var(--border);
      border-radius: 8px;
      padding: 1em;
      margin-bottom: 1em;
      overflow-x: auto;
    }

    pre code {
      background: none;
      padding: 0;
      font-size: 0.875em;
    }

    table {
      width: 100%;
      border-collapse: collapse;
      margin-bottom: 1em;
      font-size: 0.95em;
    }

    th, td {
      padding: 0.6em 1em;
      text-align: left;
      border-bottom: 1px solid var(--border);
    }

    thead th {
      font-weight: 600;
      color: var(--accent);
      background: var(--surface);
    }

    tbody tr:nth-child(even) { background: var(--surface); }

    .toc {
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: 8px;
      padding: 1em 1.5em;
      margin-bottom: 2em;
    }

    .toc h3 {
      margin-top: 0;
      margin-bottom: 0.5em;
      font-size: 1rem;
    }

    .toc ul { list-style: none; padding-left: 0; }
    .toc li { margin-bottom: 0.25em; }
    .toc a { color: var(--accent); text-decoration: none; }
    .toc a:hover { text-decoration: underline; }
    .toc ul ul { padding-left: 1.5em; margin-top: 0.25em; }

    .callout {
      background: var(--accent-light);
      border-left: 4px solid var(--accent);
      padding: 0.75em 1em;
      border-radius: 0 8px 8px 0;
      margin-bottom: 1em;
    }

    .diagram {
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: 8px;
      padding: 1.5em;
      margin-bottom: 1em;
      font-family: var(--font-mono);
      font-size: 0.875em;
      white-space: pre;
      overflow-x: auto;
      line-height: 1.5;
    }

    .tag {
      display: inline-block;
      font-size: 0.8em;
      background: var(--accent-light);
      color: var(--accent);
      border: 1px solid rgba(0, 113, 227, 0.2);
      padding: 0.15em 0.6em;
      border-radius: 12px;
    }

    .api-method {
      font-family: var(--font-mono);
      font-weight: 600;
    }

    .decision-block {
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: 8px;
      padding: 1em 1.5em;
      margin-bottom: 1em;
    }

    .decision-block h4 {
      margin-top: 0;
      margin-bottom: 0.5em;
      color: var(--accent);
    }

    .decision-block dl {
      display: grid;
      grid-template-columns: auto 1fr;
      gap: 0.3em 1em;
      font-size: 0.95em;
    }

    .decision-block dt {
      font-weight: 600;
      color: var(--text-secondary);
    }

    .decision-block dd {
      margin: 0;
    }

    .limit-table td:first-child {
      white-space: nowrap;
      font-weight: 600;
      color: var(--text-secondary);
    }

    @media print {
      body { font-size: 12pt; }
      .container { max-width: 100%; padding: 0; }
      .toc { break-after: page; }
      h2 { break-after: avoid; }
    }
  </style>
</head>
<body>
  <div class="container">
    <h1>{文档标题}</h1>
    <p class="meta">生成日期：YYYY-MM-DD | 主题范围：{范围描述} | feature-id: {feature-id}</p>

    <nav class="toc">
      <h3>目录</h3>
      <ul>
        <li><a href="#概述">概述</a></li>
        <li><a href="#架构设计">架构设计</a></li>
        <li><a href="#核心模块">核心模块</a>
          <ul>
            <li><a href="#模块A">模块 A</a></li>
            <li><a href="#模块B">模块 B</a></li>
          </ul>
        </li>
        <li><a href="#技术决策">技术决策</a></li>
        <li><a href="#已知限制">已知限制</a></li>
        <li><a href="#扩展方向">扩展方向</a></li>
      </ul>
    </nav>

    <article>
      <section id="概述">
        <h2>概述</h2>
        <p>系统概述和技术定位。来源:spec 目标与范围 + knowledge Summary。</p>
      </section>

      <section id="架构设计">
        <h2>架构设计</h2>
        <p>系统架构和数据流描述。来源:spec 系统行为/接口边界 + knowledge Summary + Read 原文。</p>
        <pre class="diagram">组件 A ──→ 组件 B ──→ 组件 C
              │
              ↕
           外部服务</pre>
      </section>

      <section id="核心模块">
        <h2>核心模块</h2>

        <section id="模块A">
          <h3>模块 A</h3>
          <p>职责描述和关键接口。来源:plan 任务拆分 + knowledge Summary。</p>
        </section>

        <section id="模块B">
          <h3>模块 B</h3>
          <p>职责描述和关键接口。</p>
        </section>
      </section>

      <section id="技术决策">
        <h2>技术决策</h2>
        <div class="decision-block">
          <h4>决策标题</h4>
          <dl>
            <dt>选择</dt>
            <dd>xxx</dd>
            <dt>原因</dt>
            <dd>xxx</dd>
            <dt>替代方案</dt>
            <dd>xxx</dd>
          </dl>
        </div>
        <p>来源:spec 不可留实现期决策 + knowledge Decisions。</p>
      </section>

      <section id="已知限制">
        <h2>已知限制</h2>
        <table class="limit-table">
          <thead>
            <tr><th>限制</th><th>影响范围</th><th>应对措施</th></tr>
          </thead>
          <tbody>
            <tr><td>限制描述</td><td>影响范围</td><td>应对措施</td></tr>
          </tbody>
        </table>
        <p>来源:spec 待确认项 + knowledge Findings/Risks。</p>
      </section>

      <section id="扩展方向">
        <h2>扩展方向</h2>
        <ol>
          <li><strong>方向 A</strong> — 描述和优先级</li>
          <li><strong>方向 B</strong> — 描述和优先级</li>
        </ol>
        <p>来源:knowledge Outlook。</p>
      </section>
    </article>
  </div>
</body>
</html>
```

## 设计文档 HTML 章节内容指南

| 章节 | 主来源 | 辅来源 | 改写方向 |
|------|------------------------|----------|----------|
| 概述 | spec 目标与范围 | knowledge Summary | 保留技术精确度,增加架构上下文 |
| 架构设计 | spec 系统行为/接口边界 | knowledge Summary + Read 原文 | 补充系统级架构图(文本框图)、数据流描述 |
| 核心模块 | plan 任务拆分 | knowledge Summary | 按模块分组,说明职责和交互关系 |
| 数据模型 | plan schema 任务 | spec 数据口径 + Read 原文 | 用表格展示节点类型、属性、关系 |
| 技术决策 | spec 不可留实现期决策 | knowledge Decisions + Read 原文 | 保留决策理由,补充替代方案对比 |
| API 参考 | spec 接口边界 | plan backend 任务 + Read 原文 | 按 endpoint 分组,包含请求/响应示例 |
| 性能特征 | knowledge Findings | Read 原文 | 用表格展示瓶颈和优化方向 |
| 已知限制 | spec 待确认项 | knowledge Findings/Risks + Read 原文 | 按严重程度排序,说明影响范围 |
| 扩展方向 | knowledge Outlook | Read 原文 | 按优先级排序,说明实现复杂度 |
| 运维指南 | knowledge Operations | Read 原文 | 按"部署 / 监控 / 排障"分组 |

## HTML 格式要点

- 所有 CSS 内联在 `<style>` 标签中,不引用外部样式表
- `<title>` 包含文档标题和项目名称
- 使用 `<nav class="toc">` 作为目录容器
- 每个章节使用 `<section id="章节锚点">` 包裹
- 章节锚点使用中文 ID(如 `id="架构设计"`)
- 重要提示或注意事项使用 `<div class="callout">` 样式
- 代码示例使用 `<pre><code>` 标签
- 表格使用 `<thead>` + `<tbody>` 结构
- 架构图使用 `<pre class="diagram">` 包裹 ASCII 文本框图
- 技术决策使用 `<div class="decision-block">` 结构,包含 `<dl>` 列表
- 已知限制使用表格,按严重程度降序排列
- 模块描述使用 `<section id="模块名">` + `<h3>` 子标题
- API 端点使用 `<span class="api-method">GET</span>` 标注 HTTP 方法
- 技术标签使用 `<span class="tag">标签名</span>` 样式
