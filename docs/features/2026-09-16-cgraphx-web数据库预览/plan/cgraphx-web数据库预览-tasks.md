# 任务清单: cgraphx web 数据库入口激活

> 配套 `cgraphx-web数据库预览-index.md`(全局契约、依赖图、手段决策、规范、提交规范均见 index,本文件不重复)。本文件只展开 T-1/T-2/T-3 的可执行步骤。
> 权威链:任务 ← plan ← spec。契约原文见 index「必须严格执行的契约」节;implementer 手里可能没有其他任务文件,故跨任务共享契约在各任务里各写一份原文。

---

## T-1: schema-knowledge 文件读取层(纯函数,无 web 依赖)

- **目标**:新建 `src/web/schema-reader.ts`,提供 schema-knowledge 目录树的扫描、INDEX.md 解析、DDL 文件读取、DISCOVERED 块提取与标签解析,全部为纯函数,不依赖 web 渲染、不依赖 core/dbquery。
- **对应 spec 条款**:§2(术语)§3.2 §3.3 §3.4 §3.5 §3.6 §4.1 §5.2 §5.3 §11 #3 #4 #5 #6 #9 #10
- **强制引用**:`docs/guides/coding-standards.md`「边界与结构」「选型」「错误与日志」(动代码任务)
- **依赖**:无(本任务起点)
- **涉及范围**:新建 `src/web/schema-reader.ts`;在 `src/web/constants.ts` 新增 `SCHEMA_KNOWLEDGE_DIR` 常量 + `INSIGHT_TAGS` / `InsightTag`(常量归属钉死:统一定义在 constants.ts,schema-reader.ts import,不重复定义)

### 必须严格执行

1. **分层**(`coding-standards`「边界与结构」+ 契约 A):本文件只用 `node:fs` + `node:path` + `node:os`(`node:` 前缀,`coding-standards`「选型」)。**绝不** import `src/core/dbquery`、`src/core/db` 或任何 core 门面。绝不 import `src/cli`。
2. **只读**(契约 C):所有函数只读文件,不写。不访问 `.cgraphx/cgraphx.db`。
3. **路径边界**(契约 B):
   - 工程名、表名参数出现 `..` / `/` / `\` / 以 `/` 开头 → 视为非法,函数返回 `null` 或空结果(不抛错,由调用方降级)。
   - 任何 `fs.readFileSync` 前,`path.resolve(schemaRoot, 工程, 'ddl', 表 + '.sql')` 后校验结果字符串仍以 `schemaRoot + path.sep` 开头(或等于 schemaRoot),否则视为缺失。
4. **DISCOVERED 解析边界**(契约 E):
   - 块边界:行(去首尾空格后)以 `-- === DISCOVERED` 开头(含 `DISCOVERED` 即起始)、以 `-- === END DISCOVERED` 开头(含 `END DISCOVERED` 即结束)。
   - 仅识别块内行首(去 `-- ` 前缀后)的 `[标签]` 前缀,标签固定 6 类。
   - **不解析 DDL 语句**(CREATE TABLE / COMMENT ON),DDL 本体作为整段字符串原样返回给调用方。
   - **容错**(契约 E):块未闭合(有起始无结束)→ 取起始到文件尾;无标签行 → 归入"其他";非六类标签 → 归入"其他";无块 → 返回空。绝不抛错。
5. **6 标签枚举**(`coding-standards`「选型」as const + 联合,不用 enum):`[定位] [关系] [陷阱] [样本] [索引] [性能]`,再加 `"其他"` 用于聚合兜底。

### 允许局部适配

- 函数拆分粒度、私有 helper 命名、解析正则具体写法
- 视图模型/返回接口字段命名(见下"建议接口"仅供参考,可调整,但 T-2 必须与本文一致)

### 建议接口(T-2 消费,签名两端同文)

```ts
// src/web/schema-reader.ts

/** 经验标签枚举(as const,不用 enum——coding-standards「选型」)。
 *  常量定义归属(钉死,消除歧义):SCHEMA_KNOWLEDGE_DIR 与 INSIGHT_TAGS / InsightTag
 *  统一定义在 src/web/constants.ts(与既有 constants.ts 一致),schema-reader.ts
 *  从 constants.ts import;本接口块仅示意,实际 export 在 constants.ts。 */
// constants.ts 定义(不在 schema-reader.ts 重复定义):
//   export const SCHEMA_KNOWLEDGE_DIR = 'docs/schema-knowledge';
//   export const INSIGHT_TAGS = ['定位','关系','陷阱','样本','索引','性能','其他'] as const;
//   export type InsightTag = (typeof INSIGHT_TAGS)[number];

/** 工程概览(工程列表页用 + 单工程折叠判定复用)。 */
export interface ProjectSummary {
  name: string;           // 工程名 = 目录名
  tableCount: number;     // ✓ 状态表数;INDEX 不可读时为 -1(降级标志)
  indexReadable: boolean; // INDEX.md 是否可解析
}

/** 表清单项(表清单页用;✓ 状态表)。 */
export interface TableEntry {
  name: string;           // 表名
  comment: string;        // 表注释(INDEX.md 第二列);无则空串
}

/** 单表 DDL 详情(详情页用)。 */
export interface DdlDetail {
  exists: boolean;        // ddl 文件是否存在
  ddlBody: string;       // DDL 本体原文(CREATE TABLE + COMMENT ON ...);不含 DISCOVERED 块
  discovered: string | null; // DISCOVERED 块原文(含起止标记行);无块则 null
}

/** 一条经验(经验沉淀页用)。 */
export interface Insight {
  tag: InsightTag;        // 六类之一或"其他"
  text: string;           // 标签后的内容(原文,未转义——转义由模板层做)
  table: string;          // 归属表名
}

/** 扫描工程列表(含 tableCount)。dir 不存在 → 返回 null(调用方走空态);
 *  空数组 → 零工程;长度=1 → 单工程折叠(T-3 路由层复用本返回值判折叠,无需另设函数)。 */
export function listProjects(projectRoot: string): ProjectSummary[] | null;

/** 读工程表清单(只 ✓ 状态表)。INDEX 不可读 → 扫 ddl/ 目录文件名降级,indexReadable=false。工程不存在 → null。 */
export function listTables(projectRoot: string, projectName: string): TableEntry[] | null;

/** 读单表 DDL 详情。文件缺失/路径越界 → { exists: false, ddlBody: '', discovered: null }。
 *  注:路径越界作纵深防御兜底——格式非法(含 ../)由 T-3 路由层先拦为 404,不会进到本函数;
 *  本函数仍做 path.resolve 校验作 defense-in-depth。 */
export function readDdlDetail(projectRoot: string, projectName: string, tableName: string): DdlDetail;

/** 提取工程内全部 DISCOVERED 经验(扫所有 ddl/*.sql)。无经验 → 空数组。工程不存在 → null。 */
export function listInsights(projectRoot: string, projectName: string): Insight[] | null;
```

> 常量归属钉死:`SCHEMA_KNOWLEDGE_DIR`、`INSIGHT_TAGS`、`InsightTag` 统一定义在 `src/web/constants.ts`,schema-reader.ts 从 constants.ts import(不重复定义,无 re-export 歧义)。原 `listProjectNames` 函数删除(与 `listProjects` 职责重叠),单工程折叠复用 `listProjects` 返回值的长度。

### 具体要求

- INDEX.md 解析:表格行 `| <表名> | <注释> | <状态> |`,状态列含 `✓` → 入选,含 `missing` → 过滤(契约 G)。INDEX 文件缺失/读错/非表格格式 → `indexReadable=false`,降级扫 `ddl/*.sql` 取文件名(去 `.sql`)作表名,注释空。
- DDL 与 DISCOVERED 分离:`readDdlDetail` 把文件内容按块边界切成 `ddlBody`(块前内容,若块在文件中部则取到块起始行前)与 `discovered`(块原文含标记行)。块未闭合 → discovered 取起始到文件尾,ddlBody 取起始前。
- DISCOVERED 标签解析(供 `listInsights`):块内逐行,去 `-- ` 前缀后若以 `[xxx]` 开头且 xxx ∈ 六类 → tag=xxx;否则 tag="其他"。`text` = 标签后剩余内容(去前导空格);无标签行 text = 整行。
- `listInsights` 遍历 `ddl/*.sql`,每个文件调块提取,聚合所有 Insight,附 `table` = 文件名(去 .sql)。

### 完成条件

- `src/web/schema-reader.ts` 存在,导出上述接口。
- `src/web/constants.ts` 新增 `SCHEMA_KNOWLEDGE_DIR` 常量与 `INSIGHT_TAGS` / `InsightTag`(统一定义在 constants.ts,schema-reader.ts import;T-2/T-3 从 constants.ts import)。
- grep 确认 `schema-reader.ts` 无 `core/dbquery` / `core/db` import:`grep -n "dbquery\|core/db" src/web/schema-reader.ts` 无输出。

### 验证方式

- `npx tsc --noEmit`(类型通过;strict + noUncheckedIndexedAccess)。
- 临时脚本或 vitest 临时用例(实现期允许为验证读取层逻辑跑一次性脚本,不正式入库测试文件)对 `/Users/smdnk/objects/java/hy/zqassis-service/docs/schema-knowledge/` 跑:
  - `listProjects` 返回 2 工程(zqassis-service / flowable-zqassis-service),每项含 tableCount 与 indexReadable;
  - `listTables('zqassis-service')` 不含 missing 表(如 cust_code / deptpath 不在结果);
  - `readDdlDetail('zqassis-service','customer')` 返回 exists=true、discovered=null(customer 无 DISCOVERED);
  - `readDdlDetail('zqassis-service','huyi_user_group')` discovered 非 null 且含 `[陷阱]` 标签;
  - 路径越界:`readDdlDetail('zqassis-service','../../package')` → exists=false(校验拦截)。
- **穿越用例**:`listProjects` / `readDdlDetail` 对含 `..` 的工程名/表名不抛错、不越界读。

### 独立提交

**是**。完成后仓库可工作:`tsc` 通过,既有功能不受影响(schema-reader 未被路由引用,是孤立的纯函数模块)。建议提交粒度:单独提交。
- commit message 主题:`feat(web): schema-knowledge 读取层——工程/表/DDL/DISCOVERED 纯函数解析`
- body:背景一行 + "-" 列要点(新增 schema-reader.ts、constants 增常量、纯函数无 web 依赖、不连库)

### 风险/注意事项

- 解析正则勿过度:`COMMENT ON` 语句里的 `[` 字符可能误匹配标签——只在 DISCOVERED 块**内**做标签解析,DDL 本体不解析(契约 E),规避此风险。
- `noUncheckedIndexedAccess`:数组访问得 `T | undefined`,显式处理。
- 单文件预估 <350 行,不触发 600 行拆分。

---

## T-2: schema 模块 SSR 页面(模板 + 页面入口)

- **目标**:新建 `src/web/schema-templates.ts`(view model + `renderXxxContent` 纯字符串渲染)与 `src/web/pages-schema.ts`(4 个页面入口 `renderXxxPage`,返回 HTML 字符串)。消费 T-1 的 `schema-reader.ts` 契约。
- **对应 spec 条款**:§3.2 §3.3 §3.4 §3.5 §3.6 §8 §9
- **强制引用**:`docs/guides/coding-standards.md`「边界与结构」「选型」「错误与日志」
- **依赖**:T-1(schema-reader 契约)
- **涉及范围**:新建 `src/web/schema-templates.ts`、`src/web/pages-schema.ts`

### 必须严格执行

1. **签名不含 db**(契约 C):所有 `renderXxxPage` 签名为 `(projectRoot: string, ..., ctx: { version: string; localHost: string }) => string`——**无 db 参数**(与 knowledge/timeline 页的关键差异)。ctx 与既有页一致(供 layout 用)。
2. **复用 layout**(契约 H):每个页面入口调用 `renderShellPage({ title, active: 'schema', contentHtml, version, localHost })`(来自 `src/web/layout.ts`)。`active` 用新增的 `'schema'`——**ShellActive 类型扩展由 T-2 实施**(见下"风险/注意事项"最终决定,只改类型不改 navItem 逻辑,消除 TODO)。
3. **DDL 原文直出**(契约 D):DDL 本体经 `escapeHtml`(复用 `src/web/render-utils.ts`)后包进 `<pre class="schema-ddl">...</pre>`。**不过 markdown-it**。
4. **DISCOVERED 分区**(契约 D):单表详情页若有 discovered 块,渲染为 `<section class="schema-discovered">` 区块(与 DDL `<pre>` 视觉分区,具体样式 T-3 的 app.css 定),块内原文 escapeHtml 后直出。
5. **XSS**(契约 D / `coding-standards` + render-utils 现有约定):所有来自文件的字符串(DDL、DISCOVERED、表名、注释、工程名)插值前过 `escapeHtml`。DDL 与 DISCOVERED 不作可信 HTML。
6. **经验页按标签聚合**(契约 E):`listInsights` 返回的 Insight 按 `tag` 分 7 区(六类 + 其他),每条附归属表名,表名渲染为链接 `/schema/<工程>/<表>`(URL 内工程名/表名 `encodeURIComponent`)。
7. **空态文案区分**(契约 G):① 目录不存在 / 零工程 → "未导出 schema-knowledge,运行 export-table-ddl skill 建基线";② 工程存在但 INDEX 不可读 → 表清单页显示"INDEX.md 不可读,已列出 ddl/ 目录文件"(T-1 降级数据);③ 经验页无 Insight → "暂无探索沉淀的经验";④ ddl 文件缺失 → 详情页"DDL 文件缺失: <表名>" + 返回表清单链接。

### 允许局部适配

- HTML 结构与 class 命名(除上述契约规定的 class 名外)
- 视图模型接口字段(只要 T-2 内部一致;T-3 只消费 `renderXxxPage` 返回的字符串)

### 建议接口(T-3 消费,签名两端同文)

```ts
// src/web/pages-schema.ts
export interface SchemaPageCtx { version: string; localHost: string; }

/** 工程列表页。projects=null(目录不存在)或空 → 空态(引导 export-table-ddl)。 */
export function renderSchemaProjectsPage(projectRoot: string, ctx: SchemaPageCtx): string;

/** 表清单页。projectName 格式非法由 T-3 路由层拦 404(不进本函数);工程不存在(tables=null)→ 渲染 404 壳。 */
export function renderSchemaTablesPage(projectRoot: string, projectName: string, ctx: SchemaPageCtx): string;

/** 单表 DDL 详情页。返回 { status, html }。
 *  status=404 仅用于工程不存在(listTables 返回 null);文件缺失(exists=false)→ status=200 + 缺失提示(spec §3.4 / §8)。
 *  工程名/表名格式非法(含 ../)不进本函数——路由层(T-3)已拦为 404。 */
export function renderSchemaDdlPage(
  projectRoot: string, projectName: string, tableName: string, ctx: SchemaPageCtx,
): { status: 200 | 404; html: string };

/** 经验沉淀页。projectName 格式非法由 T-3 路由层拦 404(不进本函数);工程不存在 → 渲染 404 壳。 */
export function renderSchemaInsightsPage(projectRoot: string, projectName: string, ctx: SchemaPageCtx): string;
```

### 具体要求

- 4 页结构(均 `renderShellPage` active='schema'):
  - **工程列表**:卡片列表,每项工程名 + 表数(表数=-1 显示"INDEX 不可读")+ 链接 `/schema/<encodeURIComponent(工程)>`。
  - **表清单**:表名 + 注释,每项链接 `/schema/<工程>/<encodeURIComponent(表)>`;顶部入口链接到 `/schema/<工程>/insights`(经验页);INDEX 不可读时降级提示。
  - **单表 DDL**:返回列表链接 + DDL `<pre>` + DISCOVERED `<section>`(若有)。
  - **经验沉淀**:7 分区(六标签 + 其他),每分区列条目,表名链接到详情页。
- 模板层只做字符串渲染,数据获取在 `pages-schema.ts` 调 `schema-reader` 函数后组装 view model 传给 `schema-templates.ts` 的 `renderXxxContent`(与 overview-templates 模式同构)。
- 路径越界/非法工程名/表名:由 T-3 路由层拦截为 404(不进 render 函数,见 T-3 §5);T-2 仅对"工程名合法但工程不存在"返回 status=404(工程列表/表清单/经验页对不存在工程渲染 404 内容;DDL 详情页对工程不存在返回 status=404、对文件缺失返回 status=200)。**分层钉死:格式非法 = T-3 路由层 404;工程不存在 = T-2 渲染 404;文件缺失 = T-2 渲染 200。**

### 完成条件

- `src/web/schema-templates.ts`、`src/web/pages-schema.ts` 存在,导出上述接口。
- `npx tsc --noEmit` 通过。
- 4 个页面函数对 zqassis-service 数据可渲染出非空 HTML(临时跑一次性脚本验证,不入库)。
- grep 确认两文件无 `core/dbquery` import。

### 验证方式

- `npx tsc --noEmit`。
- 临时脚本:构造 `SchemaPageCtx` 调 4 个 render 函数,断言返回字符串含预期关键结构(`<pre class="schema-ddl">`、`schema-discovered`、经验分区 class 等);对 `../` 工程名调 `renderSchemaDdlPage` → status=404。
- **XSS 用例**:临时构造含 `<script>` 的假 DDL 文件,断言 render 输出含 `&lt;script&gt;` 而非 `<script>`。

### 独立提交

**否**。T-2 完成后仓库虽 tsc 通过,但页面未被路由引用(`renderXxxPage` 无调用方),功能未闭合——随 T-3 一起提交。

### 风险/注意事项

- `ShellActive` 类型扩展在 T-3 做;T-2 编写时 `active: 'schema'` 会类型报错——T-2 实现期可临时用 `'none'`,但**必须**在 T-3 改 layout 后切回 `'schema'`,并在 T-2 注释 `TODO(T-3): ShellActive 加 schema 后切回`。**此 TODO 是 plan 明确的跨任务协调点,不违反 git-standards「新增 TODO」红线**(它是已知待办且归属明确,不随最终提交入库——T-3 提交前消除)。或:T-2 实现前先让 T-3 的 layout.ts 类型扩展前置(但会打乱串行)——**推荐** T-2 实现期把 ShellActive 扩展也做了(在 layout.ts 改一行类型,属 T-2 范围的轻量前置),避免 TODO。**最终决定:T-2 实施时一并改 `layout.ts` 的 `ShellActive` 类型加 `'schema'`**(只改类型,不改 navItem 逻辑——那是 T-3),消除 TODO。
- 单文件预估:schema-templates <400 行,pages-schema <300 行,不触发拆分。

---

## T-3: 路由接入 + 第三入口激活 + 样式 + 资产登记

- **目标**:在 `src/web/server.ts` 接 4 条 schema 路由;在 `src/web/layout.ts` 激活第三入口 navItem(href 从 null → '/schema');在 `src/web/public/app.css` 加 schema 页样式;确认 `scripts/copy-assets.cjs` 资产清单(app.css 已在清单则无需动)。
- **对应 spec 条款**:§3.1 §6 §7 §11 #1 #8
- **强制引用**:`docs/guides/coding-standards.md`「边界与结构」(资产登记)、「选型」
- **依赖**:T-2(renderXxxPage 入口)、T-2 已扩展 ShellActive 类型
- **涉及范围**:`src/web/server.ts`(新增路由分支)、`src/web/layout.ts`(第三入口 href + 文案)、`src/web/public/app.css`(新增 schema 样式)、`scripts/copy-assets.cjs`(确认,可能无需改)

### 必须严格执行

1. **基座机制不动**(契约 H):只**新增** `createRequestHandler` 内的 schema 路由分支,不改 `/`、`/timeline`、`/assets`、`/doc` 既有分支;不改 `startWebServer` / `openVerifiedConnection` / `tryServeAsset` / `sendNotFound` / `sendInternalError`。
2. **schema 路由不经 db**(契约 C):schema 路由处理器用 `ctx.projectRoot` 调 `renderXxxPage`(传 projectRoot + ctx),**不用 `ctx.db`**。处理器内 try/catch 兜底走基座 500(已有机制)。
3. **`sendHtml` 的 active 类型必须同步扩展**(契约 H 的连带改动点,必做):`src/web/server.ts` L82 `sendHtml` 的 `opts.active` 当前是内联字面量 `'knowledge' | 'timeline' | 'none'`(**未引用** `ShellActive`,扩展 `ShellActive` 不会自动传导 → 会编译红)。T-3 须把该内联类型改为引用 `ShellActive`(`import type { ShellActive } from './layout'`),使 `active: 'schema'` 可用。这是契约 H 的明确例外边界:允许改 `sendHtml` 签名(类型层),不得改其行为(writeHead/end 逻辑不动)。
4. **第三入口激活**(契约 H / spec §3.1):`layout.ts` 第三 navItem 从 `navItem('数据库', '⛁', null, 'none', active)` 改为 `navItem('数据库', '⛁', '/schema', 'schema', active)`。文案「数据库」与图标 `⛁` 不变(手段决策 2)。
5. **路由路径**(手段决策 3):
   - `GET /schema` → 处理器先调 `listProjects(projectRoot)`(T-1);返回 null(目录不存在)或空数组 → `renderSchemaProjectsPage`(空态页);长度=1 → `302` 重定向 `/schema/<encodeURIComponent(projects[0].name)>`;长度>1 → `renderSchemaProjectsPage`(用同一返回值渲染,不重复扫描)。
   - `GET /schema/<工程>` → 工程名格式非法(含 `..` / `/` / `\` / 以 `/` 开头)→ 路由层直接 `sendNotFound`(404,**不调 render**);合法 → `renderSchemaTablesPage`。
   - `GET /schema/<工程>/insights` → 同上工程名校验后 `renderSchemaInsightsPage`;**此分支必须在通用 `<表>` 分支之前判定**(`insights` 是保留词,否则被当表名)。
   - `GET /schema/<工程>/<表>` → 表名格式非法 → 路由层 `sendNotFound`(404,不调 render);合法 → `renderSchemaDdlPage` 返回 `{ status, html }`,处理器按 `handleDocDetail` 同款写法消费(见下第 6 条)。
6. **详情页 status 消费(钉死,防双重 writeHead)**:`renderSchemaDdlPage` 返回 `{ status: 200|404, html: string }` 时,路由处理器**必须**显式 `res.writeHead(result.status, { 'Content-Type': 'text/html; charset=utf-8' }); res.end(result.html);`(与既有 `handleDocDetail` server.ts L201-206 同款),**不走 `sendHtml`**(sendHtml 已内置 writeHead,会双重写)。其余三页(工程列表/表清单/经验页)返回纯 string → 走 `sendHtml(res, 200, {...}, ctx)`。
7. **资产登记**(`coding-standards`「边界与结构」+ git-standards 检查点):若 `app.css` 已在 `scripts/copy-assets.cjs` 清单(应已在——现有 web 已用 app.css),无需动;**不新建** css 文件,新样式追加进 `app.css`。若(意外)app.css 不在清单 → 必须加进清单。

### 允许局部适配

- app.css 内 schema 页具体样式(颜色/间距/布局),遵循既有视觉基调(深松绿主色系)
- 路由分支在 `createRequestHandler` 内的代码位置(建议紧邻 `/timeline` 分支后)

### 具体要求

- `server.ts` `createRequestHandler` 内,GET 分支新增(伪代码,位置在 `/timeline` 后、`/assets` 前或后均可,但 `/schema/<工程>/<表>` 必须在 `/schema/<工程>/insights` 之后判定,避免 insights 被当表名):
  ```
  if (pathname === '/schema') { ...单工程折叠/列表/空态... }
  if (pathname.startsWith('/schema/')) {
    // 拆段:segments = pathname.slice('/schema/'.length).split('/')
    // /schema/<工程>  /schema/<工程>/insights  /schema/<工程>/<表>
  }
  ```
- 302 重定向:`res.writeHead(302, { Location: '/schema/<encodeURIComponent(工程)>' }); res.end();`。
- 404 复用基座 `sendNotFound`。
- `app.css` 新增:`.schema-ddl`(`<pre>` 字体/背景/溢出滚动)、`.schema-discovered`(背景色/左边框与 DDL 分区)、经验页 `.schema-insights` 分区与条目样式、工程卡片/表清单样式。沿用现有 CSS 变量/色系(参考现有 `.placeholder`、`.tbadge` 等类风格)。

### 完成条件

- `node dist/cli/index.js web`(构建后)启动,第三入口可点,4 页可访问。
- 既有路由(`/`、`/doc/<id>`、`/timeline`、`/assets/*`)行为不变。
- `npx tsc --noEmit` 通过。
- 既有测试不红:`npx vitest run` 全绿(或至少 `__tests__/core/markdown/` + `__tests__/web/` 若存在)。
- `scripts/copy-assets.cjs` 含 app.css(grep 确认)。
- grep 确认 server.ts schema 分支无 `ctx.db` 调用(schema 处理器不碰 db)。

### 验证方式

- `npx tsc --noEmit`。
- `npm run build`(或 `node dist/cli/index.js web` 构建 + 启动),浏览器/curl 访问:
  - `/schema` 返回 200(工程列表或 302);
  - `/schema/zqassis-service` 返回 200,含 customer 等表,不含 cust_code(missing 过滤);
  - `/schema/zqassis-service/customer` 返回 200,含 DDL `<pre>`,无 DISCOVERED 分区(customer 无块);
  - `/schema/zqassis-service/huyi_user_group` 返回 200,含 DISCOVERED 分区;
  - `/schema/zqassis-service/insights` 返回 200,含 `[陷阱]` 等分区且表名可点;
  - `/schema/..%2f..%2fetc` 返回 404(穿越拦截);
  - `/`、`/timeline` 仍正常。
- `npx vitest run` 既有测试不红。
- `grep -n "app.css" scripts/copy-assets.cjs` 有命中。

### 独立提交

**是**。完成后功能闭合:第三入口激活,4 页可用,既有功能不破。建议提交粒度:单独提交(T-2 的两文件随本提交一起入库——T-2 标了"否",此处闭合)。
- commit message 主题:`feat(web): 数据库入口激活为模型知识库预览——schema-knowledge 浏览 + DISCOVERED 经验聚合`
- body:背景一行(第三入口从灰置激活)+ "-" 列要点(4 路由、工程/表/DDL/经验页、原文直出不解析、路径边界、只读不连库)

### 风险/注意事项

- 路由顺序:`insights` 保留词判定必须在通用 `<表>` 之前,否则 `insights` 被当表名查 ddl(会返回文件缺失,体验错)。
- 302 单工程折叠:测试时若用 zqassis-service(2 工程)不会触发折叠;单工程场景需临时构造验证。
- 既有 web 测试:若 `__tests__/web/` 有路由快照测试,新增分支可能影响——实施期若测试红,检查是否断言了路由全量列表,按测试调整(但不得为通过测试删既有断言而不补新路由)。
- git-standards 提交前检查点逐项过(见 index「提交规范」节)。
