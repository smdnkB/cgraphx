# CLAUDE.md

本文件为 Claude Code (claude.ai/code) 在本仓库中工作时提供指引。

## 本仓库是什么

这是 **cgraphx 2.0 的源码仓库** —— 单个 npm 包(`cgraphx`,bin → `dist/cli/index.js`),通过一个 CLI 为 AI 编码 agent 提供四个相互独立、项目本地的工具:`docs`(基于 `docs/knowledge/*.md` 的 markdown 知识库)、`db`(MySQL/PostgreSQL 只读内省)、`timeline`(Claude Code 开发事件)、`features`(`docs/features/` 需求目录实时索引,按负责人/关键词定位;无 DB,纯文件系统派生)。TypeScript,CommonJS 输出,Node `>=22.5 <27`(依赖内置的 `node:sqlite`;无原生依赖、无 wasm)。

2.0 是一次破坏性重构:1.x 得名所由来代码图谱层已被**整体移除**(没有 `explore`/`query`/`callers`/`index`/`sync`,没有 MCP server,没有遥测)。在假设任何 1.x 行为之前,请先看 `CHANGELOG.md`。由此带来的本仓库现状:

- 根目录下的 `.cgraphx/` 只是运行时数据;`.claude/` 和 `.mcp.json` 是被 gitignore 的 1.x 使用环境产物。
- `src/web/` 是刻意保留的占位(未来的 `cgraphx web` 本地服务);MVP 阶段不要在这里构建 UI。
- 1.* 版本源代码在 ` /Users/smdnk/objects/ai/codegraph `

- 没有配置 lint 脚本。
- 从构建产物直接跑 CLI:`node dist/cli/index.js <command>`(不带参数直接执行 `node dist/cli/index.js` 会启动交互式安装器)。
- vitest 固定了 `TZ=UTC`(见 `vitest.config.ts` 中的注释),以保证日期/时区相关断言可复现;跨时区行为通过派生带显式 `TZ` 的子进程来验证(`__tests__/core/timeline/store.timezone.test.ts`)。不要为了迁就本机时区去改 TZ 处理逻辑。
- 测试位于 `__tests__/core/<子系统>/`,与 `src/core/` 的结构镜像对应。

## 产品全貌:skill 流程 + 程序能力

cgraphx 的本质是一套**面向 AI agent 的通用辅助研发系统**,不是一个单纯的 CLI 工具。skill(markdown 指引)是主体,定义研发流程;程序(cgraphx CLI)为流程提供不可替代的能力支撑(知识库检索、数据库查询、时间线)。**agent 读 skill → 按流程调程序能力**,改任何一侧前先理解这个分工(spec §1.2)。

**skill 主线**(`assets/claude-template/skills/` 下共 20+ 个 skill,流程全景见 `cgraphx-guide` skill 的 `how-to-use.html`):

- 需求主线:`/clarify-requirements`(必经,澄清意图/业务边界/技术边界)→ `/write-spec`(核心,技术规格契约)→ `/write-plan`(可选,大需求)→ `/implementation`(简单任务)或 `/subagent-implement`(复杂多任务)。日常默认两步:澄清 + 实现。
- 平行支线:接口测试(`/write-api` → `/run-api-test`,写接口必须查 DB 验数据)、单元测试(`/write-unit-test-spec` → `/write-unit-test-code`)、知识沉淀(`/knowledge-write` 触发,`knowledge-recall` / `knowledge-api` 由 agent 自动召回)、DB schema 知识(`/export-table-ddl` 导出 + `db-query` 探索回写)。

**`docs/` 目录约定(skill 与程序的契约,目标项目内):**

- `docs/features/<日期>-<编号>-<前缀>/` —— 单次需求工作目录,`<前缀>-spec.md` 必有(头部声明 `> 负责人:`),其余产物(plan/、单元测试规格与报告、api 测试规格与报告、设计文档)由各 skill 按流程写入。按人找需求:`cgraphx features list --mine`(本地个人索引由 `features sync` 生成于 `.cgraphx/my-features.md`)。
- `docs/knowledge/*.md` —— 跨需求共享的业务知识库,**`cgraphx docs` 的索引对象**;写文件前必须过 `cgraphx docs validate`,非法文件会被索引跳过。
- `docs/bruno/` —— 接口测试产物(write-api + run-api-test 维护,bruno app 可直接打开)。
- `docs/schema-knowledge/<工程>/` —— DDL 快照(INDEX.md + ddl/*.sql + pending-comments.sql);`db-query` 首选读本地 DDL,文件不存在才连 DB 兜底,探索发现 append 到对应表的 DISCOVERED 块(重 dump 时保留)。

## 架构

**分层(约定强制,见 spec §3.1):** `src/core/` 承载全部业务逻辑与基础设施,且永远不得依赖 `src/cli/` 或 `src/web/`;`cli` 和 `web` 都只依赖 `core`。

**CLI 入口(`src/cli/index.ts`):** Node 版本下限硬拦截(可用 `CGRAPHX_ALLOW_UNSAFE_NODE` 覆盖)、fatal handler、无参数时进入交互式安装器,然后构建 commander 程序。四个子系统通过各自 `cli.ts` 导出的 `registerDocsCommands` / `registerDbCommands` / `registerTimelineCommands` / `registerFeaturesCommands` 自行注册。新的顶层命令(`init`、`status`、`uninit`、`upgrade`、`install`、`uninstall`)在 `index.ts` 内联注册;子系统子命令归各自子系统的 `cli.ts`。ANSI 颜色是手写的转义序列("避免 chalk 的 ESM 问题")—— 不要引入 chalk。

**子系统形态(docs/db/timeline 三个遵循):** 公共门面 `index.ts`(外部调用方必须用它 —— 不得直接伸手进内部模块)、`cli.ts`、`types.ts`、`errors.ts` 中的类型化错误层级、`constants.ts`,以及用于幂等 schema 应用的 `schema.sql` + `schema-bootstrap.ts`。`features` 是轻形态:无 DB、无 schema,索引是 `docs/features/` 目录树的实时派生视图(`list` 查询 / `sync` 全量重写本地个人索引 `.cgraphx/my-features.md`,负责人取 git 用户,write-spec/write-plan 创建时在头部声明 `> 负责人:`)。

**共享 DB(`src/core/db/`):** 每个目标项目一个 SQLite 文件 `.cgraphx/cgraphx.db`,将 `node:sqlite` 的 `DatabaseSync` 包装成 better-sqlite3 风格的接口(`prepare/exec/pragma/transaction`,statement 提供 `run/get/all/iterate`)。基础层与 schema 无关;每个子系统拥有自己的前缀表(`markdown_*`、`timeline_*`)并自行应用 schema。`cgraphx init` 应用 markdown + timeline 两套 schema,已初始化时为空操作;`cgraphx status` 只读、从不应用 schema、从不读 1.x 的图表(`nodes`/`edges`/`files`),未初始化时退出码为 2。

**docs:** 索引带 frontmatter 的 markdown;查询用 LIKE 而非 FTS5,以兼容 CJK。流水线:`frontmatter-parser` → `validator` → `extractor`/`summary-extractor` → `indexer` → `store`/`query`;去重分两层(入口名、概念名)。

**db:** 从构造上保证只读 —— `safety.ts` 在 mysql/postgres 驱动(`drivers/`)执行前拦截每一条 SQL(剥离注释但保留字符串字面量 → 拒绝多语句 → 禁用关键字扫描 → 强制 LIMIT)。连接 profile 存放在目标项目的 `.cgraphx/db-profiles.json`。

**timeline:** 通过五个**隐藏的**顶层 hook 子命令记录 Claude Code 事件(`timeline-user-prompt-hook`、`timeline-pre-tool-use-hook`、`timeline-post-tool-use-hook`、`timeline-stop-hook`、`timeline-git-commit-hook`),由 `cgraphx timeline install` 接入目标项目。每个 hook 都是短生命周期进程(打开 DB → INSERT → 退出,约 5ms,必须 await —— 绝不 fire-and-forget);`turn_id` 通过 `.cgraphx/timeline-current-turn.json` 状态文件在各自独立的 hook 进程间传递,读取方必须容忍该文件缺失/损坏(优雅降级,绝不阻塞 hook)。

**安装器(`src/cli/installer/`)+ 资产:** `cgraphx install` 将 `assets/claude-template/`(skills/agents/commands/hooks/plugins)部署进目标项目的 `.claude/`(全局或本地)并接入 timeline hook;2.0 刻意**不**写 `.mcp.json`。模板通过在构建时拷贝到 `dist/.claude-template/` 随包分发。

## 易踩的坑

- **skill 的修改入口是 `assets/claude-template/`(源,随包分发,`cgraphx install` 部署),不是本仓库根目录的 `.claude/`。** 后者是被 gitignore 的已部署运行环境,内容可能滞后——按 spec §1.3,它只作功能/流程参考,不作 Web UI 设计参考,更不要照着它假设 1.x 行为。
- **`scripts/copy-assets.cjs` 是构建期的资产清单。** `tsc` 只产出 JS;任何与 TS 源码放在一起的新运行时资产(例如另一个 `schema.sql`)必须加进这个脚本,否则不会随包发布。运行时 schema 路径是相对编译后的模块文件解析的,所以 dist 的目录结构必须与 `src/` 镜像一致。
- 严格 TS,含 `noUncheckedIndexedAccess` —— 索引访问得到的是 `T | undefined`,代码库中对此有显式处理。
- 版本号在 `cli/index.ts` 中于运行时从 `package.json` 读取(`npm version` 的版本号唯一事实来源)。
- `src/cli/uninstall.ts` 通过 npm 的 `preuninstall` 钩子执行。
- `docs/features/` 下是 2.0 重构的 spec 与 plan(中文)—— 各子系统预期行为(§3)与分层约束的权威描述。

## 我们解决什么问题

cgraphx 的 skill 流程针对 AI 辅助研发中反复出现的几类浪费,逐个给出流程级解法:

**1. 文档漂移导致返工。** 传统链路 PRD → Spec → Plan → Code,改一条业务规则要回归所有上游文档——三份文档的一致性靠人维护,实际项目中必然漂移,最终「三份都在,没一份能信」。核心取舍:**前期文档越少,变更时的回归成本越低。**

- Spec 是唯一契约——「没有任何业务义务存在于 spec 之外」。clarify 是对话(锁定决策但不产生需要维护的文档),spec 是唯一的权威源;变更时只改 spec 一处,plan / implementation 从这一处重新派生。
- PRD(`/write-prd`)、设计文档(`/write-design-doc`)、接口文档(`/write-api-doc`)都不在开发主链上,推荐发布后按需执行——发布后写的是实际交付的行为,不存在文档与系统漂移的问题。流程全景和时机标注见 `assets/claude-template/FLOW-MAP.md`。
- 这也匹配 agent 的能力结构:维持 N 份文档互相一致很差(上下文有限、顾此失彼),从单一权威源派生很强。

**2. 业务知识随会话消失。** 和 agent 聊出来的业务理解(概念定义、决策理由、踩过的坑、隐式约束)随会话结束就丢了;下次开发同一模块,agent 从零开始,人再解释一遍。解法是**沉淀 → 召回的闭环**:开发收尾由交付提示触发 `/knowledge-write` 把有价值的知识写入 `docs/knowledge/`(双层结构:实体主条目 + 流程条目);下次开发前 `/knowledge-recall` 先召回相关概念再动手——用得越多,agent 的项目上下文越厚,重复解释和重复踩坑越少。

**3. 数据模型每次从零理解。** agent 要查数据或改表,要么连库拿结构(贵:要凭据、要网络、要 LIMIT 保护),要么凭空猜字段含义;上次探索发现的隐式关系(如 `assignee_id` 实际对应 `users.staff_code`)下次又不知道。解法是**本地 DDL 知识库 + 探索回写的闭环**(全景见 `export-table-ddl` skill 的 `closed-loop.html`):`/export-table-ddl` 建基线(按工程分目录,一表一文件)→ `/db-query` 首选读本地 DDL(便宜),只在知识库没有或要实际数据时才连库(贵,兜底)→ 探索中发现的字段含义、隐式关系 append 到对应表的 DISCOVERED 块(双向引用)→ 重跑 export 刷新 DDL 但**保留 DISCOVERED 块**。agent 默认走本地知识库,积累才生效,闭环才转得起来。

**4. 需求理解偏差。** 拿到模糊需求直接开写,做完发现理解错了,是另一种返工。`/clarify-requirements` 在写任何文档和代码之前先锁业务边界和技术约束——像员工接领导任务:先确认意图、识别任务类型、针对性提问,必要时挑战假设,而不是拿到一句话就开始干。

**5. 规范靠人记。** 编码规范、接口规范、数据规范、提交规范,写了没人看、看了记不住。解法是**规范在执行期自动送达**:`/init-project-guides` 生成 `docs/guides/` → `/write-plan` 按任务类型打「强制引用」标注(schema → data-standards.md;接口 → interface-standards.md;动码 → coding-standards.md;测试 → testing-standards.md)→ implementation / subagent-implement 执行时只读标注的规范,不需要人主动想起来;commit 门禁(precommit-check hook)在 `git commit` 前拦截,指向 `git-standards.md` 自查。

**6. 开发流程到「写完代码」就断了。** 市面上的 AI 辅助研发工具(包括开源的)基本只覆盖到代码生成为止——接口写完、代码提交,流程就结束了;测试是人的事,手动录接口、手动跑、手动验。cgraphx 把接口测试织进了 skill 流程:`/write-api` 从 spec 的接口章节自动生成 bruno 测试用例(.bru + 内嵌断言 + 真实参数),`/run-api-test` 跑测试并强制核实写接口的 DB 副作用(HTTP 200 ≠ 通过,不查数据等于没测)。从 spec → 代码 → 测试用例生成 → 执行 → DB 验证 → 出报告,是闭环而不是断链。

**7. 工作不可追溯。** 过了两周领导问「这个月做了什么」,只能翻 git log 和聊天记录拼凑;agent 会话里的操作(改了哪些文件、跑了什么命令、卡在哪一步)更是无痕。解法是**自动记录 + 按需汇报**:timeline 通过五个隐藏 hook 子命令自动记录 Claude Code 事件(每次约 5ms,不阻塞工作流),落到 `.cgraphx/cgraphx.db` 的 `timeline_*` 表;需要时 `/developer-timeline` 从事件流生成日报、周报、月报、阶段总结、使用习惯分析——不用回忆,不用拼凑,数据一直在。

**8. 工具升级留残渣。** skill 改名或移除后,旧目录在已部署项目中永久残留,agent 仍能触发过时的旧 skill。`deprecated-assets.json`(模板根目录)列出已废弃路径,`cgraphx install` / `uninstall` 时自动清理(`src/cli/installer/claude-assets.ts` 的 `cleanDeprecatedAssets`)。新增废弃路径只需往清单加一行。

## 工作内容和准则
- 我们这个项目主要是用来开发和优化skill, 由于AI的模仿能力极强, 因此我们写skill时尽量直接展示最好案例, 避免啰嗦半天的介绍. 
- 对于禁止内容, 主要目的是避免AI做了我们未提到的内容,倒不是怕把我们已经提出案例的内容做错