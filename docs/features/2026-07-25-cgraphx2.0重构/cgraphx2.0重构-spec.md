# 规格说明: cgraphx2.0重构
> feature-id: 2026-07-25-cgraphx2.0重构
> 状态: 草稿
> 日期: 2026-07-25

## 1. 目标与范围

### 1.1 目标
将现有 codegraph 项目(源码 `/Users/smdnk/objects/ai/codegraph`,即全局发布的 cgraphx 1.x)重构为 **cgraphx 2.0**:一个面向 AI agent 的本地优先开发辅助工具,形态为「**skill 流程 + 程序能力**」。程序为 skill 流程提供不可替代的能力支撑(markdown 知识库检索、数据库查询、开发时间线记录与查询)。

cgraphx 2.0 的本质是**架构重构 + 能力裁剪 + 前端扩展**,不是从零重写:复用 codegraph 的业务逻辑,重新组织项目结构和分层架构,砍掉代码图谱能力,为后续 Web 前端预留。

### 1.2 范围(包含)
- 单包 + `src` 内分层的新项目骨架(`src/core` + `src/cli` + `src/web`)
- 保留并复用三块能力:markdown 知识库(docs)、数据库查询(dbquery)、开发时间线(timeline)
- 精简的 SQLite 基础层(替代 codegraph 带图谱 schema 的 `src/db/`)
- CLI 入口(挂载 docs/db/timeline 命令)
- `assets/claude-template/` 资产(skill + agents + commands + hooks + plugins 的**源**)
- installer 模块(部署 assets + 注册 timeline hooks,去除 MCP 配置)
- 配套 skill 优化(随能力裁剪调整)
- 2.0 breaking change 处理(CHANGELOG/发布说明)

### 1.3 范围(不包含 / 非目标)
- **不做代码图谱**(tree-sitter 符号图、调用链、影响半径、索引/同步)
- **不做 MCP server**
- **Web 前端 MVP 不做**(后续阶段)
- `how-to-use.html` **不作 Web UI 设计参考**(仅作功能/流程参考)

## 2. 术语与业务对象

| 术语 | 含义 |
|---|---|
| **codegraph** | 现有项目 `/Users/smdnk/objects/ai/codegraph`,cgraphx 1.x 的 TS 源码,本次重构的复用起点 |
| **cgraphx 2.0** | 本次重构产物,npm 包名 `cgraphx`,版本 `2.0.0` |
| **新项目** | 重构后的代码基,位于 `/Users/smdnk/objects/ai/cgraphx`(与现有 `.claude` 使用环境并存) |
| **三块能力** | docs(markdown 知识库)、db(dbquery 数据库查询)、timeline(开发时间线) |
| **skill 流程 + 程序** | 工具本质。skill(markdown 指引)是主体,定义研发流程;程序(TS+Node CLI)为流程提供不可替代的能力支撑。agent 读 skill → 调程序能力 |
| **assets/claude-template/** | 随程序分发的资产**源**,含 skills/agents/commands/hooks/plugins;`cgraphx install` 部署到目标项目 `.claude/` |
| **目标项目** | 安装 cgraphx 的用户项目(区别于"新项目"= cgraphx 自身代码基) |

## 3. 系统行为规格

### 3.1 整体架构(单包分层)
- 新项目为**单个 npm 包**(`cgraphx` 2.0.0),**不用 monorepo / workspaces**。
- `src` 内分层:
  - `src/core/`:三块能力的业务逻辑 + 通用基础设施(DB 基础层、directory、types、utils)。**被 cli 和 web 复用**。
  - `src/cli/`:CLI 入口(commander),MVP 核心。`bin → src/cli`。
  - `src/web/`:Web 本地服务(后续阶段,MVP 留空骨架)。作为 `cgraphx web` 子命令起本地只读服务。
- **解耦约束**:core 不反向依赖 cli/web;cli 和 web 都只依赖 core。

### 3.2 三块能力的行为规格

#### 3.2.1 docs(markdown 知识库)
- **职责**:索引并查询目标项目 `docs/knowledge/` 下的 markdown 文档(带 frontmatter)。
- **必须保留的能力**(沿用 codegraph `src/markdown`):索引(全量重建)、多维查询(concept/domain/tag/status/type/关键词)、文档间双向引用、去重(Layer 1 入口名 + Layer 2 概念名)、单文件校验(validate)。
- **CLI 子命令**(`cgraphx docs <sub>`):`index / concepts / domains / tags / find / refs / dedup / seen-names / show / validate`。沿用 codegraph 现有接口。
- **存储**:cgraphx.db 的 `markdown_*` 前缀表;自有 `schema.sql` + 版本表 `markdown_schema_versions`;**不使用 FTS5**(用 LIKE,中文兼容)。
- **约束**:不读不写代码图谱表(nodes/edges/files 等)。

#### 3.2.2 db(dbquery 数据库查询)
- **职责**:对 MySQL/PostgreSQL 执行只读 SQL 查询 + schema 探查 + profile 管理。
- **必须保留的能力**(沿用 codegraph `src/dbquery`):`runQuery`(只读、自动 LIMIT、关键字黑名单、超时 30s)、`runSchema`(tables/ddl/indexes/table-comment)、`listProfiles`(不返回 password)、`db init`(写 profile 模板)。
- **CLI 子命令**(`cgraphx db <sub>`):`query / schema / profiles / init`。沿用 codegraph 现有接口。
- **存储**:不碰 cgraphx.db,只用 `.cgraphx/` 放 `db-profiles.json`(POSIX 0600)+ `db-query.log`(10MB rotate)。
- **安全约束**:只读保护靠客户端关键字黑名单 + 多语句检测;**DB 账号本身应只读**(部署文档强调);密码 redaction 必须保留。
- **约束**:与代码图谱零耦合(本就是独立子系统)。

#### 3.2.3 timeline(开发时间线)
- **职责**:通过 Claude Code hooks 记录开发事件(user_prompt / pre_tool_use / post_tool_use / stop / git_commit),并提供查询。
- **必须保留的能力**(沿用 codegraph `src/timeline`):5 个 hook 子命令(hidden,转发到 hooks 处理)、记录(recordEvent)、查询(queryEvents / getEventById / getEventStats 等)、安装(install/uninstall hooks)。
- **CLI 子命令**(`cgraphx timeline <sub>`):`query / show / stats / recent / install / uninstall` + 5 个 hidden hook 入口。
- **存储**:cgraphx.db 的 `timeline_events` + `timeline_schema_versions` 表;per-turn 状态文件 `.cgraphx/timeline-current-turn.json`。
- **不变量(必须保留)**:
  - hook 永不阻塞 Claude(try/catch 吞错 + exit 0 + 空 stdout,50ms 预算)。
  - kill-switch 环境变量(沿用 `CGRAPHX_NO_TIMELINE` 或按命名规范调整)。
  - CLI exit codes(0/2/3/4)契约不重排。
  - `tool_args` 故意不截断(保 JSON 完整)。
- **对 Claude Code 依赖**:仅靠 hook 子命令 + stdin JSON 契约,**不依赖 SDK**。
- **注**:日/周/月报由 developer-timeline skill 产,timeline 模块只存原始事件、提供查询 API。

### 3.3 installer 行为
- **职责(2.0)**:部署 `assets/claude-template/*` 到目标项目 `.claude/` + 注册 timeline hooks(`.claude/settings.json` 的 hook 条目 + `.git/hooks/post-commit`)。
- **砍除(相对 1.x)**:不再写 MCP 配置(`.mcp.json` / agent MCP 注册)——因 2.0 无 MCP server。
- install/uninstall 必须**对称、可重复(idempotent)**。

### 3.4 CLI 接口规格
- **主命令**:`cgraphx`。
- **顶层命令(2.0)**:`docs`、`db`、`timeline`、`install`、`uninstall`、`init`(创建空 cgraphx.db)、`status`、`upgrade`、`version`、(后续)`web`。
- **砍除(相对 1.x)**:`explore / query / node / callers / callees / affected / index / sync / search` 等**所有代码图谱命令**;`serve`(无 MCP server);`telemetry` 命令(匿名遥测砍除,连带 bin 的 preAction 遥测 hook、`TELEMETRY_FLUSH_COMMANDS`、`recordIndexTelemetry` 引用一并清理)。
- **接口策略**:docs/db/timeline 子命令**沿用 codegraph 现有接口**(`registerDocsCommands` / `registerDbCommands` / `registerTimelineCommands`);`upgrade` **沿用**(复用,安装方式检测 + 升级执行);其他命令按 2.0 形态重组。
- **status 命令(改造)**:2.0 砍图谱,status 改为查 **markdown/timeline 表状态**(文档数 / 概念数 / 时间线事件数 / last_indexed) + **dbquery 配置状态**(profile 是否存在),不再查任何图谱表。
- **命名替换**:错误文案、env 变量(`CGRAPHX_*`)、CLI 描述、timeline hook subcommand 字符串中涉及"cgraphx"的,统一到 2.0 命名规范。【待确认:`CGRAPHX_*` env 前缀是否保留】

## 4. 数据、状态与口径

### 4.1 存储架构
- **目录**:`.cgraphx/` 沿用(由 `directory.ts` 的 `getCodeGraphDir` 解析,支持 `CGRAPHX_DIR` 覆盖)。
- **DB 文件**:markdown + timeline **共用** `.cgraphx/cgraphx.db`(SQLite,WAL 模式,busy_timeout)。
- **表隔离**:`markdown_*` 前缀表(markdown 模块独占)+ `timeline_events` / `timeline_schema_versions`(timeline 模块独占);各自独立 schema 版本表,版本号独立演进。
- dbquery 不碰 cgraphx.db。
- **ID 策略**:markdown 用 `sha256(path)` / `sha256(name)`;timeline 用自增 id。

### 4.2 DB 基础层(精简 src/db/)
- **必须提供**:`DatabaseConnection`(open/getDb/close)+ `SqliteDatabase` 类型 + `getDatabasePath` + WAL/busy_timeout pragma + `sqlite-adapter`(node:sqlite,零外部依赖)。
- **必须不包含**:代码图谱的 `schema.sql` 应用、`runMigrations`(图谱迁移)、`db/queries.ts`(图谱查询,引用 extraction/search)。
- **open() 行为**:打开/创建 cgraphx.db,应用 markdown + timeline 的 schema(各自 ensureSchema 幂等),**不创建任何图谱表**。

## 5. 接口、模块与系统边界

### 5.1 src 模块映射(砍/留)
**🔴 砍(从 codegraph 迁移时丢弃)**:
`graph`、`extraction`、`search`、`sync`、`reasoning`、`resolution`、`context`(图谱上下文构建,强耦合 `GraphTraverser`+`QueryBuilder`+FTS)、`telemetry`、`db/queries.ts`、`mcp/`(整体)。

**🟢 迁移到新项目**:
| codegraph 模块 | 新项目归属 |
|---|---|
| `markdown` | `src/core/markdown` |
| `dbquery` | `src/core/dbquery` |
| `timeline` | `src/core/timeline` |
| 精简后的 `db` | `src/core/db`(SQLite 基础层) |
| `directory.ts`、`types.ts`(精简去图谱类型)、`utils.ts` | `src/core/` |
| `installer` | `src/cli/installer` |
| `bin` | `src/cli/`(主入口) |
| `ui` | `src/cli/ui` |
| `upgrade` | `src/cli/upgrade`(自更新,复用;`REPO=smdnkB/cgraphx`、`NPM_PACKAGE=cgraphx` 沿用) |

三块对图谱模块**零依赖**(已验证),迁移不需解耦图谱。

### 5.2 对外暴露边界
- **CLI**:`docs / db / timeline / install / uninstall / init / version / web`。
- **无 MCP**(2.0 不提供任何 MCP 工具)。
- **skill**:通过 `assets/claude-template/skills/` 分发,agent 在目标项目经 skill 指引调 CLI。

### 5.3 assets 资产结构
- `assets/claude-template/skills/`:24 个 skill 源(2.0 按能力裁剪优化,见 5.4)。
- `assets/claude-template/{agents,commands,hooks,plugins}`:随 skill 分发的配套 Claude Code 配置。
- installer 部署 `assets/claude-template/*` → 目标项目 `.claude/`。

### 5.4 skill 优化范围
- **原则**:随能力裁剪(代码图谱砍除)和架构变化(无 MCP)调整 skill 源。
- **必须处理**:
  - `cgraphx` skill(代码图谱工具集)→ 失效,需废弃或重写为"非图谱"上下文工具集。
  - 依赖 `codegraph_explore` MCP 的 skill 引用 → 移除/改写。
  - `cgraphx-guide` skill → 更新工具能力描述(去图谱、去 MCP)。
  - 保留并适配(不依赖图谱的):clarify-requirements、write-prd、write-spec、write-plan、implementation、subagent-implement、code-impact-* 、db-query、developer-timeline、knowledge-recall、export-table-ddl、write-api(-doc)、run-api-test、write-unit-test-* 、write-workload、precommit-review、init-project-guides 等。
- **本重构阶段不细化每个 skill 的处置**:skill 优化(保留/改写/废弃清单)**延后到重构完成后的独立任务**。本阶段只保证 skill 源随程序分发(`assets/claude-template/` 结构完整),不阻塞程序重构。

## 6. 兼容性、迁移与存量数据

### 6.1 2.0 Breaking Change
- 2.0 相对 1.4.7 是 **breaking**:代码图谱命令(explore/query/node/callers/callees/affected/index/sync/search)和 `codegraph_explore` 等 MCP 工具**全部消失**。
- 用户从 1.x 升级到 2.0 后,代码图谱能力不可用;`.cgraphx/cgraphx.db` 里残留的图谱表(nodes/edges/files)不再被读写。
- **必须**在 CHANGELOG 和 2.0 发布说明中显式标注 breaking。
- 【待确认:是否提供 1.x→2.0 的数据迁移/清理工具,还是仅文档提示】

### 6.2 迁移策略(从 codegraph 到 cgraphx 2.0)
**方式**:手动重构(非 git 拆分,非从零重写)。从 `/Users/smdnk/objects/ai/codegraph/src` 复制保留模块,调整 import 指向新 DB 基础层,重组到新分层结构。

**必须满足的迁移约束**:
1. 三块能力(markdown/dbquery/timeline)的业务逻辑和对外行为**保持等价**(沿用,不重写语义)。
2. 唯一结构性改动:`src/db/` 精简(去图谱 schema 应用)。
3. import 调整:markdown/timeline 对 `../db` 的引用指向新精简 DB 基础层;dbquery 零改动。
4. bin 注册迁移:`registerDocsCommands` / `registerDbCommands` / `registerTimelineCommands` 挂到新 `src/cli` 主入口。
5. 构建脚本:`copy-assets` 必须复制 `markdown/schema.sql` + `timeline/schema.sql` 到 dist(**否则运行时找不到 schema 会崩**)。
6. 命名替换:错误文案、env、CLI 描述、hook subcommand 中的 cgraphx 引用统一到 2.0 规范。
7. 砍除图谱模块 + `mcp/` 整体。
8. 测试:timeline 的 10 个测试一并迁移;markdown/dbquery 的测试按需迁移。

### 6.3 schema-knowledge 写回
- **约束**:`docs/schema-knowledge/` 的写回是 **skill 层行为**(db-query / export-table-ddl skill 指引 agent 用 Write 落盘),**不是程序代码行为**。新项目 src 不实现 schema-knowledge 写回逻辑。

## 7. 异常与边界场景
- **DB 未初始化**:docs/timeline 命令遇到 cgraphx.db 不存在 → 报"项目未初始化,请先 `cgraphx init`"并退出码 2(init 命令创建空 db)。
- **hook 失败**:timeline hooks 任何异常都不阻塞 Claude(吞错 + exit 0 + 空 stdout)。
- **dbquery 安全拒绝**:写关键字/多语句 → SafetyRejectionError,退出码 3;连接超时 → 退出码 4;配置缺失 → 退出码 2。
- **dbquery 无 profile** → 提示 `cgraphx db init`。
- **并发**:timeline hooks 多进程写 cgraphx.db(短连接 + WAL);dbquery 每次查询新连接。【待确认:是否需要连接池优化】
- **markdown LIKE 关键词**:中文兼容(LIKE on title+summary_text),百级文档内 100ms 预算。

## 8. 验收标准与测试关注点

### 8.1 验收
- cgraphx 2.0 作为单包可 `npm install -g cgraphx@2.0.0` 安装。
- `cgraphx docs / db / timeline` 三组命令在目标项目可用,行为与 codegraph 1.x 等价(语义不回归)。
- `cgraphx install` 部署 `assets/claude-template/` + 注册 timeline hooks 到目标项目 `.claude/`,**不写 MCP 配置**。
- `cgraphx init` 创建空 cgraphx.db(**无图谱表**)。
- 代码图谱命令(explore/callers/...)和 MCP server **不存在**(已砍)。
- 三块能力的现有测试(timeline 10 个 + markdown/dbquery 按需)在新项目通过。

### 8.2 测试关注点
- 三块能力的行为等价性(迁移不引入回归)。
- DB 基础层不创建图谱表。
- installer 部署完整性 + 不写 MCP。
- timeline hook 不变量(不阻塞、exit 0、kill-switch、exit codes)。
- dbquery 安全(redaction、关键字黑名单、超时)。
- 2.0 breaking:旧命令不存在。

## 9. 不可留到实现期的决策
- **能力范围**:砍代码图谱 + 砍 MCP,不可在实现期恢复。
- **架构**:单包 + `src` 内分层(core/cli/web),不引入 workspaces。
- **存储**:`.cgraphx/` 沿用 + markdown/timeline 共用 cgraphx.db(前缀隔离),不可拆分 DB 或改目录名。
- **包名版本**:`cgraphx` 2.0.0。
- **三块 CLI 接口**:沿用 codegraph 现有子命令语义,不可在实现期重设计核心语义。
  > **2026-07-31 注**:知识库分类体系重设计(《2026-07-31-知识库分类体系重设计-spec》)对 frontmatter 枚举内容做换血式变更——document_type 17→7 值、source_type 7→5 值、domains 语义转向业务域;CLI 子命令行为语义不变(本承诺保持),枚举内容变更是显式破坏性变更,无双轨期,配套 knowledge-migrate 迁移 skill 与 hx 存量迁移。
- **skill 源位置**:`assets/claude-template/`(程序分发资产),不可放 `.claude/skills/`(那是产物)。
- **DB 基础层**:不含图谱 schema / migrations / queries.ts。
- **timeline hook 不变量、dbquery 安全契约**:不可在实现期放宽。
- **模块去留已定**:`telemetry` 砍、`context` 砍(强耦合图谱)、`upgrade` 留;`status` 改造为查 markdown/timeline/dbquery 状态。不可在实现期反复。

## 10. Plan 编写约束
- plan 必须基于"手动重构 + 复用 codegraph 逻辑",**不得重写三块业务逻辑**。
- plan 的迁移任务必须覆盖第 6.2 节 8 项迁移约束。
- plan 必须保证三块能力语义不回归(测试等价)。
- plan 必须处理构建脚本(copy-assets 复制 schema.sql),否则运行时崩。
- plan 不得引入代码图谱、MCP 相关任务。
- plan 的 Web 相关任务标为"后续阶段",不进 MVP。
- 大规模重构,推荐 `/subagent-implement`(派子 agent,隔离上下文)。

## 11. 待确认项
- 【待确认】`CGRAPHX_*` 环境变量前缀是否保留(cgraphx 2.0 沿用名,倾向保留;但需统一)。
- 【待确认】CLI"部分优化"的具体痛点清单(spec 定基线为"沿用 codegraph 现有接口",优化点由 plan/实现细化)。
- 【待确认】1.x→2.0 是否提供数据迁移/清理工具(图谱残留表)。
- 【待确认】dbquery 是否引入连接池(MVP 沿用短连接)。
- 【待确认】Node 引擎约束写法(目标 Node 22+,是否设 engines 字段严格限制)。

> **已决策(移出待确认)**:
> - skill 优化清单 → 延后到重构完成后的独立任务。
> - `telemetry` → 砍;`upgrade` → 保留;`context` → 砍(强耦合图谱)。
> - `status` 命令 → 改造(查 markdown/timeline/dbquery 状态)。
