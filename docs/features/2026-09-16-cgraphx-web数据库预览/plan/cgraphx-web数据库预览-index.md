# Plan: cgraphx web 数据库入口激活为模型知识库预览

> feature-id: 2026-09-16-cgraphx-web数据库预览
> 负责人: liulongfei
> 日期: 2026-09-16
> 来源 spec: `../cgraphx-web数据库预览-spec.md`(唯一契约,本 plan 不重新定义)

## 目标与范围

激活 cgraphx web 应用壳第三导航入口(现「数据库」灰置占位),新增 schema 模块:`docs/schema-knowledge/` 模型知识库的本地只读浏览器预览——工程列表 → 表清单 → 单表 DDL 详情(原文 + DISCOVERED 分区)+ 经验沉淀页(当前工程内按 6 标签跨表聚合 DISCOVERED 块)。纯文件系统派生,不连库、不进 SQLite。

## 明确不包含

- 不连库、不读 `.cgraphx/db-profiles.json`、不调 core/dbquery(spec §1.3)
- 不解析 DDL 语句为字段表/索引表、不做 SQL 语法高亮(spec §1.3)
- 不跨工程全局搜表、不跨工程聚合经验(spec §1.3)
- 不呈现 pending-comments.sql(spec §1.3)
- 不改基座机制(预检/回环/错误态/静态资产服务/时区口径),仅改 `layout.ts` 第三入口 href 与文案
- 不改 core/markdown、core/dbquery、core/timeline;不改 CLI 行为
- 不写新测试(测试是代码完成后的独立流程:write-unit-test-spec → write-unit-test-code)

## 计划文件清单

- `cgraphx-web数据库预览-index.md`(本文件)— 全局契约 + 手段决策 + 规范 + 提交规范 + 任务总表
- `cgraphx-web数据库预览-tasks.md` — T-1/T-2/T-3 可执行步骤(签名原文、完成条件、验证方式)
- 不拆 `-01-schema` / `-02-backend` / `-03-frontend`:本需求单 web 模块、规模小,前端 SSR 与文件读取逻辑在同一批文件内强耦合,拆开反而增加跨文件契约同步成本。

## 总任务清单

| 任务 | 标题 | 对应 spec | 独立提交 |
|---|---|---|---|
| T-1 | schema-knowledge 文件读取层(纯函数,无 web 依赖) | §2 §3.2-3.5 §4.1 §5.2 §5.3 | 是 |
| T-2 | schema 模块 SSR 页面(模板 + 页面入口) | §3.2 §3.3 §3.4 §3.5 §3.6 §9 | 否(随 T-3) |
| T-3 | 路由接入 + 第三入口激活 + 样式 + 资产登记 | §3.1 §6 §7 | 是 |

依赖:T-1 → T-2 → T-3(T-2 消费 T-1 的读取层契约;T-3 接 T-2 的页面入口)。串行,无并行批次。

## 全局依赖图

```
T-1 (读取层 schema-reader.ts)
   │ 产出:工程/INDEX/DDL/DISCOVERED 读取 + 解析的纯函数契约
   ▼
T-2 (页面 schema-templates.ts + pages-schema.ts)
   │ 消费 T-1 契约;产出 4 个 renderXxxPage 入口
   ▼
T-3 (server.ts 路由 + layout.ts 第三入口 href + sendHtml 类型 + app.css + copy-assets.cjs)
   │ 消费 T-2 的 renderXxxPage;激活第三入口
```

## 推荐执行顺序

T-1 → T-2 → T-3(严格串行)。

## 必须严格执行的契约

### A. 分层铁律(spec §6 / §10 / coding-standards「边界与结构」)

- web 仅依赖 `src/core/`;本需求**不引 core 新依赖**——schema-knowledge 文件读取只用 `node:fs` + `node:path`,**绝不** import `src/core/dbquery` 或任何 core 门面。
- `src/core/` 不得因本需求出现对 `src/cli` / `src/web` 的 import(检查点:git-standards 提交前检查点之一)。
- `src/cli/index.ts` wiring 例外不变(不经本需求)。

### B. 路径边界硬契约(spec §5.2 / §11 #9)

- DDL 文件路径**只从工程目录扫描结果解析**:工程名 + 表名 → `docs/schema-knowledge/<工程>/ddl/<表>.sql`。
- 路由**不接受任意文件路径参数**;工程名、表名仅作目录/文件名,出现 `..` / `/` / `\` / 以 `/` 开头的输入**一律拒绝**。
- **越界分层钉死(消除 status 歧义)**:
  - **格式非法(含 `..`/`/`)** → T-3 路由层直接 404(`sendNotFound`),**不调 renderXxxPage**;
  - **格式合法但工程不存在** → T-2 渲染 404 内容(`renderSchemaDdlPage` 返回 `status:404`;工程列表/表清单/经验页对不存在工程渲染 404 壳);
  - **格式合法、工程存在、ddl 文件缺失** → T-1 `readDdlDetail` 返回 `exists:false` → T-2 `renderSchemaDdlPage` 返回 `status:200` + 缺失提示(spec §3.4 / §8)。
- **纵深防御**:T-1 `readDdlDetail` 仍做 `path.resolve` 后校验在 schema-knowledge 根内(defense-in-depth;理论上路由层已拦截格式非法,不会进到 T-1,但保留校验)。
- 不存在"给路径就渲染"的端点。

### C. 只读契约(spec §11 #10 / §9 #7)

- schema 模块所有操作只读:不写 DB、不写源文件、不应用 schema、不连库。
- schema 模块**不访问** `.cgraphx/cgraphx.db`(spec §4.1)——schema 视图的 `renderXxxPage` 签名**不含 db 参数**(与 knowledge/timeline 页不同,这是关键差异)。

### D. DDL 呈现契约(spec §3.4 / §11 #3)

- DDL 本体(CREATE TABLE + COMMENT ON 等)**原文转义直出**于 `<pre>` 区块:先过 `escapeHtml`(复用 `src/web/render-utils.ts` 现有 `escapeHtml`),绝不解析、不高亮、不重排。
- markdown-it(`src/web/markdown.ts`)**不复用于 SQL**——DDL 不是 markdown。
- DISCOVERED 块(若存在)以视觉分区与 DDL 本体隔开,块内原文同样 escapeHtml 后直出。

### E. DISCOVERED 解析边界(spec §3.5 / §5.3 / §11 #4 #5)

- **仅解析** DISCOVERED 块内行首 `-- [标签]` 前缀,用于经验沉淀页聚合索引。
- 块边界识别:`-- === DISCOVERED` 至 `-- === END DISCOVERED ===`(行首包含 `DISCOVERED` 即为起始标记,包含 `END DISCOVERED` 即为结束标记)。
- 经验标签固定 6 类:`[定位]` / `[关系]` / `[陷阱]` / `[样本]` / `[索引]` / `[性能]`(枚举,`as const` 数组 + 联合类型,不用 enum——coding-standards「选型」)。
- **不解析 DDL 语句**(CREATE TABLE / COMMENT ON)。
- **容错优先**:DISCOVERED 块未闭合 / 无标签行 / 标签非六类 / 块缺失 → 优雅降级,不抛错、不崩;非六类标签或无标签行归入"其他"分区(见 T-1 契约)。

### F. 页面层级契约(spec §3.2 / §11 #2)

- 三级 + 经验视图:工程列表 → 表清单 → 单表 DDL;外加经验沉淀页。
- **单工程自动折叠**:`docs/schema-knowledge/` 下仅一个工程目录时,工程列表页跳过,直达该工程表清单页。

### G. 过滤与空态契约(spec §3.3 / §3.6 / §11 #6 #11)

- 表清单页**只呈现 ✓ 状态表**(有 ddl 文件),missing 表过滤掉。
- 空态文案严格区分:① 目录不存在 / 无工程 → 引导 export-table-ddl;② 工程存在但 INDEX.md 缺失/损坏 → 该工程项降级提示(不崩);③ 经验页无 DISCOVERED → "暂无探索沉淀的经验";④ ddl 文件被删 → 详情页"DDL 文件缺失"提示 + 返回入口,HTTP 200。

### H. 基座机制不动(spec §3.1 / §7 / §11)

- `server.ts` 的 `startWebServer` / `openVerifiedConnection` / `tryServeAsset` / `sendNotFound` / `sendInternalError` / 路由骨架结构不变;只在 `createRequestHandler` 内**新增** schema 路由分支(不改正文已有分支)。
- **`sendHtml` 连带改动点(契约 H 例外,必做)**:`server.ts` L82 `sendHtml` 的 `opts.active` 当前是内联字面量 `'knowledge' | 'timeline' | 'none'`(未引用 `ShellActive`),扩展 `ShellActive` 不会自动传导。T-3 须把该内联类型改为引用 `ShellActive`(import type from layout),使 `active:'schema'` 可用。**仅改类型层,writeHead/end 行为不动。**
- `layout.ts`:`ShellActive` 类型扩展加 `'schema'`(T-2 做类型扩展,消除 TODO);第三入口 navItem 的 `href` 从 `null` → `'/schema'`、`key` 从 `'none'` → `'schema'`(T-3 做);`navItem` 机制不动。
- 不改 CLI、不改 core。

### I. 零构建链 + 资产分发(spec §7 / §10)

- 不引前端框架/语法高亮库;SSR HTML + 极少 JS(URL 即状态),复用现有 `app.js` 模式。
- 若新增静态资产须登记 `scripts/copy-assets.cjs`(检查点:git-standards 之一)。预计复用 `app.css`,可能新增样式类——新增的 CSS 写进现有 `src/web/public/app.css`,**不新建** css 文件(避免新增资产登记)。
- 不引 chalk。

## 实现手段决策(自主项)

spec 未锁定、无业务可观察后果的工程手段,plan 拍板:

1. **文件组织**(自主,选 B):
   - 选项 A:单 `pages-schema.ts` 装读取+模板+页面(可能 >600 行,违反 coding-standards「单文件 >600 行须拆」)
   - 选项 B(推荐):三文件——`schema-reader.ts`(纯读取/解析,无 web 依赖)+ `schema-templates.ts`(view model + `renderXxxContent` 纯字符串)+ `pages-schema.ts`(页面入口 `renderXxxPage`)。与既有 `pages-overview.ts` + `overview-templates.ts` 模式同构,职责清晰。
   - 理由:与既有 web 模块模式一致;读取层纯函数可独立单测;避免单文件超限。

2. **导航文案与图标**(自主,选保持):第三入口文案保持「数据库」、图标保持 `⛁`(layout.ts 现值)。spec §11 #8 定语义为"模型知识库预览,连库另议",但文案不改——「数据库」作为入口名仍贴切(预览的是数据库模型),且避免改既有视觉。文案不改 = 不动用户已有认知。

3. **路由路径命名**(自主,选 `/schema`):
   - 工程列表:`GET /schema`(单工程时重定向到 `/schema/<工程>`)
   - 表清单:`GET /schema/<工程>`
   - 单表 DDL:`GET /schema/<工程>/<表>`
   - 经验沉淀:`GET /schema/<工程>/insights`
   - 理由:`/schema` 简短、与 `/doc` 同级语义;`insights` 作经验页路径,表名不可能与 `insights` 冲突(表名走 ddl 文件名,`insights` 不是文件)。单工程重定向用 302(可收藏性弱于直链,但单工程时工程列表本就无意义)。

4. **文件扫描策略**(自主,选每请求扫):每次请求现扫 `docs/schema-knowledge/` 目录树,不引入进程级缓存。理由:本地工具、文件量小(百级文件)、读即最新(spec §4.2 无新鲜度 SLA,直读即最新是特性);缓存会引入失效复杂度,YAGNI。性能足够(本地 fs,百级文件 ms 级)。

5. **表清单工程内搜索**(自主,选不做):131 张表在工程内用浏览器 ctrl-F 足够,不引入服务端搜索/分页。理由:spec §10 列为 plan 自定项;YAGNI,单页 131 行可接受;若后续表数膨胀再加。

6. **DISCOVERED 标签缺失行归并**(自主,选"其他"分区):经验沉淀页设第七个分区"其他",收纳无标签行 / 非六类标签 / 块未闭合残余。理由:不丢信息、不崩;spec §3.5 允许"归入其他或原样保留"。

7. **INDEX.md 损坏降级**(自主,选跳过该工程):工程列表页扫描时,某工程 INDEX.md 缺失或无法解析 → 该工程项仍列出(工程名来自目录名),但表数量显示"INDEX 不可读"且点击进入表清单页时走降级(直接扫 ddl/ 目录列文件名,无表注释)。理由:不崩、信息尽量保留;表清单页本身可仅靠 ddl/ 目录派生(INDEX 是元数据加速,非唯一来源)。

8. **单工程自动折叠判定时机**(自主,选路由层):`GET /schema` 处理时调 `listProjects`(T-1,返回 `ProjectSummary[] | null`),返回 null/空 → 空态;长度=1 → 302 重定向 `/schema/<工程>`;长度>1 → 用同一返回值渲染列表(**不重复扫描,不另设 `listProjectNames` 函数**——删除原冗余函数,折叠判定复用 `listProjects` 长度)。理由:在路由入口判定,页面函数只管渲染给定工程,职责清晰;消除冗余扫描函数。

> 以上均无 spec 信封外业务可观察后果,plan 拍板锁定,implementer 不得自行更改。若实施期发现 7(INDEX 损坏降级)实际行为不符预期,回跳 spec 补 §3.6 口径——此条接近信封边缘。

## 执行方式建议

**`/implementation`**。判据:预估变更 ~6 文件(`schema-reader.ts` / `schema-templates.ts` / `pages-schema.ts` 新增,`layout.ts` / `server.ts` / `constants.ts` / `app.css` / `scripts/copy-assets.cjs` 改),全部在**单 web 模块**内,不跨 ≥3 独立模块,任务间串行强耦合(后任务消费前任务契约),不适合独立派 subagent。规模小、单模块 → `/implementation`。

## 适用规范

- `docs/guides/coding-standards.md` —「边界与结构」(分层/门面/资产登记)、「选型」(禁 chalk / as const 不用 enum / node: 前缀 / 中文注释 / 单文件 >600 拆)、「错误与日志」(类型化错误 / 消息带修复提示)
- `docs/guides/git-standards.md` —「提交消息规范」、「提交前检查点」(结晶见下)

本需求**不涉及** schema 建表(无 `-01-schema`)、不涉及对外接口(无 `interface-standards.md` 强制引用——web 路由是面向浏览器的 SSR,非对外 API 契约)。

## 提交规范(从 git-standards.md 结晶)

**提交消息格式**:`type(scope): 中文描述`(Conventional Commits + 中文)

- type:feat / refactor / fix / docs;scope 常用 `web`;仓库级改动省 scope
- 补充说明用"——",并列用"+",数值对比用"→"
- 正例:`feat(web): 数据库入口激活为模型知识库预览——schema-knowledge 浏览 + DISCOVERED 经验聚合`
- body:非琐碎写 body——背景一行 + "-" 列要点
- **无票据关联**:需求追踪走 `docs/features/` 目录,不进标题

**提交前检查点**(实施期 `git diff --cached` 逐项自查,precommit 门禁仅兜底):

- 与 TS 同放的运行时资产未登记 `scripts/copy-assets.cjs` —— 不随包发布(本需求:若新增 public/ 资产必查)
- `src/core` 出现对 `src/cli` / `src/web` 的 import —— 分层破坏(本需求:确认 schema-reader/pages-schema 未误引 core/dbquery)
- `vitest.config.ts` 的 `TZ: 'UTC'` 钦死被改 —— 不动
- 被注释掉的命令注册 / 路由分支 —— 功能静默失效
- 写死的魔法值:绝对路径、密钥、版本号写进源码(schema-knowledge 根目录名 `docs/schema-knowledge` 用常量,不内联字符串散落)
- 新增 TODO / FIXME —— 确认是否应转任务

## 允许局部工程适配的范围

- `schema-reader.ts` 内部函数拆分、私有命名、解析正则具体写法
- `schema-templates.ts` 的 HTML 结构与 class 命名(除契约 D 规定的 `<pre>` 直出 + 分区外)
- `app.css` 内 DISCOVERED 分区与经验页的具体样式(颜色/边距/布局)
- 视图模型接口字段命名(只要 T-2 输出与 T-3 消费一致)
- 错误降级的具体提示文案(除 §3.6 空态文案区分要求外)

## Plan 冲突上报规则

权威链:任务 ← plan ← spec。任务与 spec 冲突 → 以 spec 为准并按 `PLAN_CONFLICT` 上报(不静默改 spec 契约)。implementer 发现 spec 未覆盖的边界 → 不自行补契约,上报。

## 关键风险与防跑偏约束

1. **误连库**:implementer 可能顺手 import `core/dbquery` 做"真 DDL 查询"。防:契约 A/C 明禁;T-1 验证方式含 grep 确认无 dbquery import。
2. **路径穿越**:工程名/表名未校验导致 `/schema/../etc/passwd`。防:契约 B 强制校验;T-1 完成条件含穿越用例。
3. **XSS**:DDL 含 `<script>` 等内容未转义直出。防:契约 D 强制 escapeHtml;T-2 完成条件含注入用例。
4. **误改基座**:改 `startWebServer` 预检或既有路由分支。防:契约 H 只允许新增分支;T-3 完成条件含基座既有测试不红。
5. **DISCOVERED 解析过度**:implementer 膨胀成 DDL 字段表解析。防:契约 E 明限仅标签行;T-1 范围不含 DDL 语句解析。
6. **超 600 行**:单文件膨胀。防:手段决策 1 拆三文件;各文件预估 <400 行。

## 待确认项

无阻塞项。spec §12 已列 plan 范畴项,本 plan 已拍板(见「实现手段决策」)。若实施期发现 INDEX.md 损坏降级行为与 spec §3.6 预期不符,回跳 spec 补口径。
