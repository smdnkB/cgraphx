# 接口文档 HTML 模板

适用于 feature 接口开发完毕后,由 `write-api-doc` skill 从 spec + 代码反向提取生成。默认输出到 `docs/features/<feature-id>/<文件前缀>-接口文档.html`。

复用 `template-design-html.md` 的 CSS 变量(`:root` 里的颜色 / 字体 / 间距变量)以保持视觉一致;额外增加 `.api-method`、`.endpoint`、`.endpoint-list`、`.error-table` 等接口文档专用样式。

## 完整 HTML 结构

```html
<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>{feature 标题} — 接口文档</title>
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
      --max-width: 900px;

      /* HTTP 方法色 */
      --method-get: #2ea44f;
      --method-get-bg: #e6f4ea;
      --method-post: #0071e3;
      --method-post-bg: #e8f0fe;
      --method-put: #b08800;
      --method-put-bg: #fff8e1;
      --method-patch: #8b41c9;
      --method-patch-bg: #f5eafa;
      --method-delete: #c0392b;
      --method-delete-bg: #fdedec;
    }

    *, *::before, *::after { margin: 0; padding: 0; box-sizing: border-box; }

    body {
      font-family: var(--font-sans);
      font-size: 15px;
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
      font-size: 1.8rem;
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
      font-size: 1.4rem;
      font-weight: 600;
      margin-top: 2.5em;
      margin-bottom: 0.75em;
      padding-bottom: 0.3em;
      border-bottom: 1px solid var(--border);
    }

    h3 {
      font-size: 1.15rem;
      font-weight: 600;
      margin-top: 1.5em;
      margin-bottom: 0.5em;
    }

    h4 {
      font-size: 0.95rem;
      font-weight: 600;
      color: var(--text-secondary);
      text-transform: uppercase;
      letter-spacing: 0.05em;
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
      font-size: 0.85em;
    }

    table {
      width: 100%;
      border-collapse: collapse;
      margin-bottom: 1em;
      font-size: 0.92em;
    }

    th, td {
      padding: 0.55em 0.9em;
      text-align: left;
      border-bottom: 1px solid var(--border);
      vertical-align: top;
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

    /* HTTP 方法标签 */
    .api-method {
      display: inline-block;
      font-family: var(--font-mono);
      font-weight: 700;
      font-size: 0.75em;
      letter-spacing: 0.05em;
      padding: 0.2em 0.6em;
      border-radius: 4px;
      text-transform: uppercase;
      vertical-align: middle;
    }
    .api-method.get { color: var(--method-get); background: var(--method-get-bg); }
    .api-method.post { color: var(--method-post); background: var(--method-post-bg); }
    .api-method.put { color: var(--method-put); background: var(--method-put-bg); }
    .api-method.patch { color: var(--method-patch); background: var(--method-patch-bg); }
    .api-method.delete { color: var(--method-delete); background: var(--method-delete-bg); }

    /* 接口详情容器 */
    .endpoint {
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: 8px;
      padding: 1.5em;
      margin-bottom: 1.5em;
    }

    .endpoint h3 {
      margin-top: 0;
      display: flex;
      align-items: center;
      gap: 0.6em;
      flex-wrap: wrap;
    }

    .endpoint h3 code {
      font-size: 0.95em;
      background: var(--code-bg);
      padding: 0.2em 0.5em;
    }

    .endpoint-desc {
      color: var(--text-secondary);
      font-style: italic;
      margin-bottom: 1em;
    }

    /* 接口清单表专用 */
    .endpoint-list td:nth-child(1) { white-space: nowrap; width: 1%; }
    .endpoint-list td:nth-child(2) { font-family: var(--font-mono); font-size: 0.9em; }

    /* 错误码表专用 */
    .error-table td:nth-child(1) {
      font-family: var(--font-mono);
      font-weight: 600;
      color: var(--method-delete);
      white-space: nowrap;
    }

    /* 待补充/待确认标记 */
    .placeholder {
      display: inline-block;
      background: #fff3cd;
      color: #856404;
      padding: 0.1em 0.5em;
      border-radius: 4px;
      font-size: 0.85em;
      font-style: italic;
    }
    .pending-review {
      display: inline-block;
      background: #f8d7da;
      color: #721c24;
      padding: 0.1em 0.5em;
      border-radius: 4px;
      font-size: 0.85em;
      font-style: italic;
    }

    @media print {
      body { font-size: 11pt; }
      .container { max-width: 100%; padding: 0; }
      .toc { break-after: page; }
      h2, .endpoint { break-inside: avoid; }
    }
  </style>
</head>
<body>
  <div class="container">
    <h1>{feature 标题} — 接口文档</h1>
    <p class="meta">feature-id: {feature-id} | 生成日期: YYYY-MM-DD | 接口总数: N | 范围: 本次 feature 新增</p>

    <nav class="toc">
      <h3>目录</h3>
      <ul>
        <li><a href="#概览">概览</a></li>
        <li><a href="#接口清单">接口清单</a></li>
        <li><a href="#接口详情">接口详情</a>
          <ul>
            <li><a href="#endpoint-1">GET /api/users/:id</a></li>
            <li><a href="#endpoint-2">POST /api/users</a></li>
          </ul>
        </li>
      </ul>
    </nav>

    <section id="概览">
      <h2>概览</h2>
      <p>本 feature 新增接口的业务背景,从 spec 摘录的一段简述。</p>
      <table>
        <tr><th>Base URL</th><td>/api/v1 <span class="placeholder">若不可推断填"待补充"</span></td></tr>
        <tr><th>鉴权方式</th><td>Bearer Token <span class="placeholder">若不可推断填"待补充"</span></td></tr>
        <tr><th>主要变化</th><td>新增了用户查询和创建接口</td></tr>
        <tr><th>spec 来源</th><td>docs/features/&lt;feature-id&gt;/&lt;文件前缀&gt;-spec.md</td></tr>
      </table>
    </section>

    <section id="接口清单">
      <h2>接口清单</h2>
      <table class="endpoint-list">
        <thead>
          <tr><th>方法</th><th>路径</th><th>简述</th></tr>
        </thead>
        <tbody>
          <tr>
            <td><span class="api-method get">GET</span></td>
            <td>/api/users/:id</td>
            <td>查询用户详情</td>
          </tr>
          <tr>
            <td><span class="api-method post">POST</span></td>
            <td>/api/users</td>
            <td>创建新用户</td>
          </tr>
        </tbody>
      </table>
    </section>

    <section id="接口详情">
      <h2>接口详情</h2>

      <section id="endpoint-1" class="endpoint">
        <h3>
          <span class="api-method get">GET</span>
          <code>/api/users/:id</code>
        </h3>
        <p class="endpoint-desc">查询用户详情。返回指定 ID 的用户基础信息和关联角色。</p>

        <h4>请求参数</h4>
        <table>
          <thead>
            <tr><th>位置</th><th>参数</th><th>类型</th><th>必填</th><th>说明</th></tr>
          </thead>
          <tbody>
            <tr><td>path</td><td>id</td><td>string</td><td>是</td><td>用户 ID</td></tr>
            <tr><td>query</td><td>expand</td><td>string</td><td>否</td><td>展开关联字段,如 <code>expand=role,dept</code></td></tr>
            <tr><td>header</td><td>Authorization</td><td>string</td><td>是</td><td>Bearer Token</td></tr>
          </tbody>
        </table>

        <h4>响应示例</h4>
        <pre><code>{
  "id": "u_001",
  "name": "张三",
  "role": "admin",
  "createdAt": "2026-07-04T10:00:00Z"
}</code></pre>

        <h4>错误码</h4>
        <table class="error-table">
          <thead>
            <tr><th>状态码</th><th>含义</th><th>触发场景</th></tr>
          </thead>
          <tbody>
            <tr><td>401</td><td>未授权</td><td>token 无效或过期</td></tr>
            <tr><td>404</td><td>用户不存在</td><td>id 无效或已删除</td></tr>
          </tbody>
        </table>
      </section>

      <section id="endpoint-2" class="endpoint">
        <h3>
          <span class="api-method post">POST</span>
          <code>/api/users</code>
        </h3>
        <p class="endpoint-desc">创建新用户。需要管理员权限。</p>

        <h4>请求参数</h4>
        <table>
          <thead>
            <tr><th>位置</th><th>参数</th><th>类型</th><th>必填</th><th>说明</th></tr>
          </thead>
          <tbody>
            <tr><td>body</td><td>name</td><td>string</td><td>是</td><td>用户名,1-32 字符</td></tr>
            <tr><td>body</td><td>role</td><td>string</td><td>是</td><td>角色,<code>admin</code> / <code>member</code></td></tr>
            <tr><td>header</td><td>Authorization</td><td>string</td><td>是</td><td>Bearer Token,需 admin 角色</td></tr>
          </tbody>
        </table>

        <h4>响应示例</h4>
        <pre><code>{
  "id": "u_002",
  "name": "李四",
  "role": "member",
  "createdAt": "2026-07-04T11:00:00Z"
}</code></pre>

        <h4>错误码</h4>
        <table class="error-table">
          <thead>
            <tr><th>状态码</th><th>含义</th><th>触发场景</th></tr>
          </thead>
          <tbody>
            <tr><td>400</td><td>参数错误</td><td>name 为空 / role 不在枚举内</td></tr>
            <tr><td>403</td><td>无权限</td><td>非 admin 角色调用</td></tr>
            <tr><td>409</td><td>用户名冲突</td><td>name 已存在</td></tr>
          </tbody>
        </table>
      </section>
    </section>
  </div>
</body>
</html>
```

## 章节内容指南

| 章节 | 主来源 | 改写方向 |
|------|--------|----------|
| 文档头 | feature-id 推断 | 自动填,接口总数在文档生成后写入 |
| 概览 | spec 目标与范围 + 接口边界 | 一段话写业务背景;Base URL / 鉴权从代码或 spec 推断,推断不出标"待补充" |
| 接口清单 | grep + Read 命中的新增路由 | 一行一个接口,方法标签着色 |
| 接口详情 — 业务说明 | spec 接口章节 + handler 代码 | 一句话写接口做什么,关联 spec 哪条业务规则 |
| 请求参数 | handler 签名 + DTO / 类型注解 + 路由模板 | 表格化:位置 / 参数 / 类型 / 必填 / 说明;提取不到标"待补充" |
| 响应示例 | handler return + 序列化 + 类型注解 | 写出典型成功响应 JSON 示例;复杂对象给 1-2 个字段即可,不堆全表 |
| 错误码 | handler 异常处理 + spec 异常章节 | 表格化:状态码 / 含义 / 触发场景;spec 声明优先,代码补充 |

## 格式要点

- HTTP 方法用 `<span class="api-method {method-lowercase}">` 标签着色(GET 绿 / POST 蓝 / PUT 黄 / PATCH 紫 / DELETE 红)
- 接口详情用 `<section class="endpoint">` 容器,有底色和圆角边框,视觉上和清单表区分
- 路径用 `<code>` 包裹,字体等宽
- 待补充字段用 `<span class="placeholder">` 标黄;与 spec 冲突用 `<span class="pending-review">` 标红
- 错误码列用 `.error-table` 着色,状态码列等宽红色
- 响应示例代码块不标语言类型(JSON 视觉清爽即可)
- 表格行支持自动斑马纹,无需手写
- 移动端友好:`flex-wrap` 让方法标签 + 路径在窄屏自动换行
