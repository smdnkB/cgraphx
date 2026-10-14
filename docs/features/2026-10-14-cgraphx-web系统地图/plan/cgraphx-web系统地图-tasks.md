# Tasks: cgraphx web 系统地图

> feature-id: 2026-10-14-cgraphx-web系统地图
> 全局契约、手段决策、提交规范见 `cgraphx-web系统地图-index.md`;spec 见 `../cgraphx-web系统地图-spec.md`。

---

### T-1: codemap-reader——读视图 + 过期判定 + 按概念反查

- 目标:提供纯数据读取层,web 其他文件只经它拿代码地图数据。
- 对应 spec 条款:§2(术语)· §3.2(坏文件、一句话)· §3.5(过期三态)· §4 · §5(路径边界、git 只读)· §7
- 强制引用:`docs/guides/coding-standards.md`
- 依赖:无
- 涉及范围:
  - 新增 `src/web/codemap-reader.ts`
  - 修改 `src/web/constants.ts`(追加常量)
- 必须严格执行:
  - `constants.ts` 追加:
    ```ts
    export const CODE_MAP_DIR = 'docs/code-map';
    export const CODE_MAP_FLOWS_SUBDIR = 'flows';
    export const CODE_MAP_GIT_TIMEOUT_MS = 3000;
    ```
  - 导出类型与函数签名(原文,T-2 / T-4 按此消费):
    ```ts
    export type CodemapKind = 'system' | 'flow';
    export type StaleResult =
      | { state: 'fresh' }
      | { state: 'stale'; changedFiles: string[] }
      | { state: 'unknown' };
    export interface CodemapViewEntry {
      kind: CodemapKind;
      name: string;            // 文件名去 .md,即 URL 中的 <name>
      fileName: string;        // 含 .md,用于坏文件展示
      parseOk: boolean;        // 有 frontmatter 且 title 非空
      title: string | null;
      summary: string | null;  // 正文「## 一句话」节内容(trim,取到下一个 # 标题前)
      generated: string | null;
      sourceCommit: string | null;
      entry: string | null;
      provider: string | null;
      concepts: string[];
      stale: StaleResult;      // parseOk=false 时固定 { state: 'unknown' },不跑 git
    }
    export interface CodemapListing { systems: CodemapViewEntry[]; flows: CodemapViewEntry[] }
    export interface CodemapViewDetail { entry: CodemapViewEntry; body: string } // body = stripFrontmatter 后的正文

    export function isSafeCodemapName(name: string): boolean;
    export function listCodemapViews(projectRoot: string): CodemapListing | null;
    export function readCodemapView(projectRoot: string, kind: CodemapKind, name: string): CodemapViewDetail | null;
    export function findCodemapViewsByConcepts(projectRoot: string, concepts: string[]): CodemapViewEntry[];
    ```
  - 行为表:

    | 函数 | 场景 | 返回 |
    |---|---|---|
    | `listCodemapViews` | `docs/code-map/` 不存在或不是目录 | `null` |
    | | 存在 | `systems` = 根目录下所有 `*.md`(不递归);`flows` = `flows/*.md`(`flows/` 不存在 → `[]`);各自按 `name.localeCompare(other, 'zh-CN')` 排序;坏文件也在列表中(`parseOk:false`) |
    | `readCodemapView` | 名字不安全 / 文件不存在 / `parseOk=false` | `null` |
    | | 正常 | `{ entry, body }` |
    | `findCodemapViewsByConcepts` | 入参为空或目录不存在 | `[]` |
    | | 正常 | `systems` + `flows` 中 `parseOk=true` 且 `concepts` 与入参有交集的条目,顺序 systems 在前 |
    | `isSafeCodemapName` | 空 / `.` / `..` / 含 `/` `\` `\0` / 含 `..` | `false`(与 server.ts 的 `isSafeSchemaName` 同口径) |

  - 过期判定:`execFileSync('git', ['diff', '--name-only', sourceCommit, 'HEAD', '--', ...relatedCode], { cwd: projectRoot, encoding: 'utf-8', timeout: CODE_MAP_GIT_TIMEOUT_MS, stdio: ['ignore', 'pipe', 'ignore'] })`;按行切分去空行,非空 → `stale`,空 → `fresh`;抛错 / `sourceCommit` 为空 / `relatedCode` 为空 → `unknown`。不调用 `git status` 或任何其他 git 子命令。
  - frontmatter 用 `parseFrontmatter` / `stripFrontmatter`(从 `../core/markdown` 门面导入,不得伸进内部模块)。列表字段用文件内私有函数 `toList(v)`:数组 → 原样;字符串 `''` 或 `'[]'` → `[]`;其他字符串 → `[v]`;`undefined` → `[]`。标量字段:字符串非空 → 值;否则 `null`。
  - 不得 import `../core/db`、不得写任何文件。
- 允许局部适配:目录遍历写法、`summary` 提取正则、私有辅助拆分。
- 具体要求:
  - 文件头部中文注释说明职责、只读边界、过期口径来源(code-map-recall skill)。
  - `parseFrontmatter` 抛错时视为 `parseOk:false`,不外抛。
- 完成条件:
  - `npm run build` 通过;`npx vitest run` 既有测试全绿。
- 验证方式:
  - `npm run build && node -e "const r=require('./dist/web/codemap-reader.js');console.log(JSON.stringify(r.listCodemapViews(process.cwd()),null,1))"`:输出 1 个 system(`系统交互`,`concepts: []`)+ 1 个 flow(`开发时间线记录`,`concepts: ['开发时间线']`),两者 `stale.state` 为 `fresh`(HEAD 未变时)。
  - 同上调用 `readCodemapView(cwd,'flow','../系统交互')` → `null`。
- 独立提交:是——新增未被引用的模块,仓库可编译。主题:`feat(web): codemap-reader——读代码地图视图 + git 过期判定`
- 风险/注意事项:
  - `related_code` 中路径是项目相对路径,`cwd` 必须为 `projectRoot`。

---

### T-2: 地图首页 + 视图页 + 路由 + 侧栏入口 + 概念标签

- 目标:用户能从侧栏进入系统地图,浏览首页与两类视图页,看到过期标记与概念标签。
- 对应 spec 条款:§3.1 · §3.2 · §3.3 · §3.5 · §3.6(视图 → 知识库)· §5 · §7;页面布局以 `../cgraphx-web系统地图-线框-v1.html` 为准
- 强制引用:`docs/guides/coding-standards.md`
- 依赖:T-1
- 涉及范围:
  - 新增 `src/web/pages-codemap.ts`、`src/web/codemap-templates.ts`
  - 修改 `src/web/layout.ts`、`src/web/server.ts`、`src/web/public/app.css`
- 必须严格执行:
  - T-1 契约原文(本任务消费):
    ```ts
    export type CodemapKind = 'system' | 'flow';
    export type StaleResult = { state: 'fresh' } | { state: 'stale'; changedFiles: string[] } | { state: 'unknown' };
    export interface CodemapViewEntry { kind; name; fileName; parseOk; title; summary; generated; sourceCommit; entry; provider; concepts: string[]; stale: StaleResult }
    export interface CodemapListing { systems: CodemapViewEntry[]; flows: CodemapViewEntry[] }
    export interface CodemapViewDetail { entry: CodemapViewEntry; body: string }
    export function isSafeCodemapName(name: string): boolean;
    export function listCodemapViews(projectRoot: string): CodemapListing | null;
    export function readCodemapView(projectRoot: string, kind: CodemapKind, name: string): CodemapViewDetail | null;
    ```
  - `layout.ts`:`ShellActive` 增加 `'codemap'`;在「模型知识库」之后加 `navItem('系统地图', '⌖', '/map', 'codemap', active)`。
  - `pages-codemap.ts` 导出:
    ```ts
    export function renderCodemapHomePage(projectRoot: string, ctx: { version: string; localHost: string }): string;
    export function renderCodemapViewPage(
      db: SqliteDatabase, projectRoot: string, kind: CodemapKind, name: string,
      ctx: { version: string; localHost: string },
    ): { status: 200; html: string } | { status: 404 };
    ```
    `readCodemapView` 返回 `null` → `{ status: 404 }`(不渲染 HTML);200 时壳 `active: 'codemap'`。壳 `title`:首页「系统地图」,视图页 `entry.title`。
  - `codemap-templates.ts` 导出(T-4 会在本文件追加 `renderRelatedCodemapSection`):
    ```ts
    export function renderCodemapHomeContent(listing: CodemapListing | null): string;
    export function renderCodemapViewContent(detail: CodemapViewDetail, linkableConcepts: ReadonlySet<string>): string;
    ```
  - `server.ts` 路由:新增 `handleCodemap(res, ctx, pathname)`,在 `GET` 分支中 `pathname === '/map' || pathname.startsWith('/map/')` 时调用:

    | 路径 | 行为 |
    |---|---|
    | `/map`、`/map/` | `renderCodemapHomePage` → 200 |
    | `/map/system/<name>`、`/map/flow/<name>` | `decodeURIComponent` 失败或 `!isSafeCodemapName` → `sendNotFound`;否则 `renderCodemapViewPage`:`status === 404` → `sendNotFound(res, ctx, pathname)`(基座 404 页,spec §7);200 → 写出 html |
    | 其他 | `sendNotFound` |

  - 首页内容(spec §3.2,线框「地图首页」):
    - `listing === null` 或两组都为空 → 空态:「还没有代码地图」+「在 Claude Code 中运行 `/code-map-write` 生成」。
    - 标题下计数行「docs/code-map/ · <N> 份系统交互 · <M> 个流程」(含坏文件)。
    - 「系统交互」区在上、「业务流程」区在下;某区为空显示「暂无」。
    - 每条:`parseOk` → 链接 `/map/<kind>/<encodeURIComponent(name)>`,显示 title、summary(有则显示)、generated、sourceCommit(仅系统区)、`stale.state==='stale'` 时「已过期」标签;`parseOk=false` → 不可点,灰显 `fileName` +「格式无法解析」。
  - 视图页内容(spec §3.3,线框「系统交互」「流程视图」):
    - 外层容器带 `data-codemap` 属性(T-3 据此绘制)。
    - 顶部:title、「生成于 <generated> · commit <sourceCommit> · 取结构方式:<provider>」(缺失项省略;`provider` 来自 T-1 的 `CodemapViewEntry.provider`)、`entry`(有则显示)。
    - 概念行(`concepts` 非空才出现):在 `linkableConcepts` 中的 → `<a>` 指向 `buildOverviewUrl({ q: undefined, types: [], statuses: [], domains: [], concepts: [c], sort: 'updated', page: 1 })`;不在的 → `<span>` 虚线样式,`title="知识库中没有这个概念"`。
    - `stale.state==='stale'` → 顶部提示「已过期:生成之后以下文件有改动,图可能和代码不符」+ `changedFiles` 列表 +「在 Claude Code 中运行 `/code-map-write` 重新生成」;`fresh` / `unknown` 不显示任何东西。
    - 正文:去掉 `detail.body` 中第一个以 `# ` 开头的行(与顶部 title 重复)后,`renderMarkdownBody` 输出(不改 `markdown.ts`)。
    - 返回首页链接「← 系统地图」。
    - 「已过期」标签、提示框、灰显坏文件、虚线概念标签的样式全部在本任务的 `app.css` 中定义(类名 `codemap__stale-tag`、`codemap__stale-box`、`codemap__broken`、`codemap__concept--missing`),T-4 复用。
  - `linkableConcepts` 构造:`new Set(new MarkdownQuery(db).listConcepts({ sort: 'name' }).map(c => c.name))`。
  - 所有动态值过 `escapeHtml`(唯一例外:`renderMarkdownBody` 输出)。
- 允许局部适配:HTML 结构与 `codemap__*` 类名;CSS 细节沿用既有视觉令牌。
- 具体要求:
  - `server.ts` 顶部路由注释补 `/map` 三行。
- 完成条件:
  - `npm run build` 通过;`npx vitest run` 全绿。
  - 单文件不超 600 行。
- 验证方式:
  - `node dist/cli/index.js web --port 2470`,浏览器访问:
    - `/map`:列出「系统交互」「开发时间线记录」;侧栏「系统地图」高亮。
    - `/map/flow/开发时间线记录`:概念「开发时间线」为虚线不可点;正文含两个 mermaid 代码块(本任务尚未绘制,显示原文)。
    - `/map/flow/..%2F系统交互`、`/map/flow/不存在`、`/map/other` → 404。
    - 临时把 `docs/code-map` 改名后访问 `/map` → 空态;改回。
    - 临时在 `docs/code-map/flows/` 放一个无 frontmatter 的 `坏.md` → 首页灰显「格式无法解析」,`/map/flow/坏` → 404;删除。
- 独立提交:是。主题:`feat(web): 系统地图首页与视图页——侧栏第四入口 + /map 路由`
- 风险/注意事项:
  - 不在 `renderShellPage` 增加参数;不动 `navChildren` 机制。

---

### T-3: 浏览器端绘制与降级

- 目标:视图页的 mermaid 代码块联网时绘制成图,断网或写法错时保留原文并提示。
- 对应 spec 条款:§3.4 · §5(外部脚本版本固定、内容不执行)
- 强制引用:`docs/guides/coding-standards.md`
- 依赖:T-2(`data-codemap` 容器)
- 涉及范围:修改 `src/web/public/app.js`、`src/web/public/app.css`
- 必须严格执行:
  - `app.js` 顶部常量:`var MERMAID_SRC = 'https://cdn.jsdelivr.net/npm/mermaid@11.4.1/dist/mermaid.min.js';`
  - 仅当 `document.querySelector('[data-codemap] code.language-mermaid')` 存在时插入 `<script src=MERMAID_SRC async>`;其他页面不插入。
  - `onerror` → 每个 mermaid 块所在 `<pre>` 前插入提示「未联网,图无法绘制,显示原文」,原文保持可见。
  - `onload` → `mermaid.initialize({ startOnLoad: false, securityLevel: 'strict', suppressErrorRendering: true })`(防止 mermaid 在 body 末尾追加错误图);逐块 `mermaid.render(<唯一 id>, code.textContent)`:成功 → 在 `<pre>` 前插入包含 SVG 的容器并隐藏 `<pre>`;失败(Promise reject 或抛错)→ 保留 `<pre>`,前插提示「图的写法有误,无法绘制」;单块失败不影响其他块。
  - 维持既有 IIFE + `'use strict'` + ES5 风格(无构建链),失败静默降级,不向页面抛未处理错误。
- 允许局部适配:提示元素类名、SVG 容器样式、id 生成方式。
- 具体要求:更新 `app.js` 文件头注释「仅两件事」为三件事,补第 3 条说明。
- 完成条件:`npm run build` 通过;`npx vitest run` 全绿。
- 验证方式:
  - 联网访问 `/map/flow/开发时间线记录`:两张图绘制成功;`/` 知识库页 Network 面板无 mermaid 请求。
  - 浏览器 DevTools 设为 Offline 后硬刷新:两块显示原文 + 「未联网」提示,节点索引表正常。
  - 临时把视图中一张图的 `sequenceDiagram` 改为 `sequenceDiagramX`:该块显示原文 + 「写法有误」,另一张正常;改回。
- 独立提交:是。主题:`feat(web): 系统地图视图页浏览器端绘制 mermaid——断网/写法错退回原文`
- 风险/注意事项:mermaid 渲染异步,提示插入需在各自 Promise 回调中完成。

---

### T-4: 知识库详情页「相关代码地图」一栏

- 目标:从知识库条目跳到关联的代码地图视图。
- 对应 spec 条款:§3.6(知识库条目页 → 视图)· §6(既有内容不变);线框「知识库条目页」
- 强制引用:`docs/guides/coding-standards.md`
- 依赖:T-1;在 T-2 创建的 `src/web/codemap-templates.ts` 中追加函数
- 涉及范围:修改 `src/web/pages-detail.ts`、`src/web/codemap-templates.ts`
- 必须严格执行:
  - T-1 契约原文(本任务消费):
    ```ts
    export interface CodemapViewEntry { kind: 'system' | 'flow'; name: string; title: string | null; stale: StaleResult; /* 其余字段见 T-1 */ }
    export function findCodemapViewsByConcepts(projectRoot: string, concepts: string[]): CodemapViewEntry[];
    ```
  - `codemap-templates.ts` 追加:`export function renderRelatedCodemapSection(entries: CodemapViewEntry[]): string;`——`entries` 为空返回 `''`;否则输出「相关代码地图」一栏,每项链接 `/map/<kind>/<encodeURIComponent(name)>`,显示 title,`stale` 时带「已过期」。
  - `renderDetailPage` 中:`findCodemapViewsByConcepts(projectRoot, doc.concepts)`,结果经 `renderRelatedCodemapSection` 插在 `renderSummary(doc)` 之后、正文 `section.detail__fulltext` 之前。
  - 详情页其余输出(元数据、摘要、引用分区、正文、404 分支)一字不改。
- 允许局部适配:栏目 HTML 结构。
- 样式:复用 T-2 在 `app.css` 定义的 `codemap__stale-tag` 等类,以及既有 `refs__*` 列表样式;**不改 `app.css`**(T-3 在改该文件,保证可并行)。
- 具体要求:无其他。
- 完成条件:`npm run build` 通过;`npx vitest run` 全绿(`knowledge-detail.test.ts` 不需修改即通过)。
- 验证方式:
  - 访问任一知识库条目(如 `cgraphx web`):不出现「相关代码地图」。
  - 临时在 `docs/code-map/flows/开发时间线记录.md` 的 `concepts` 加 `cgraphx web` → 刷新该条目页出现一栏,含「开发时间线记录 · 代码地图」,点击进入视图页;视图页中「cgraphx web」标签可点并跳到 `/?concept=cgraphx+web`;改回。
- 独立提交:是。主题:`feat(web): 知识库详情页加「相关代码地图」一栏——与系统地图双向跳转`
- 风险/注意事项:`doc.concepts` 字段名以 `getDocumentDetail` 返回类型为准(`pages-detail.ts` 第 108 行已在用 `doc.concepts`)。
