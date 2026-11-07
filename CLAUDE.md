# CLAUDE.md

本文件为 Claude Code (claude.ai/code) 在本仓库中工作时提供指引。

## 本仓库是什么

这是 **cgraphx 2.0 的源码仓库** —— 单个 npm 包(`cgraphx`,bin → `dist/cli/index.js`),通过一个 CLI 为 AI 编码 agent 提供六个相互独立、项目本地的工具:`docs`(基于 `docs/knowledge/*.md` 的 markdown 知识库)、`db`(MySQL/PostgreSQL 只读内省)、`timeline`(开发事件:补录解析各家 agent 的会话文件,含只读来源 DeepSeek)、`features`(`docs/features/` 需求目录实时索引,按负责人/关键词定位;无 DB,纯文件系统派生)、`board`(本机只读任务看板:任意目录 `cgraphx board` 先逐项目补录再开本机网页,左栏任务、右栏会话,复制编号回对应软件找回;轻门面形态,页面 `page.html` 经 copy-assets 随包分发),以及 `project`(项目数据的查看、改名、列出、删除,install 时把旧库并进用户目录;`cgraphx project show / name / list / remove`;无表,只经基础层与 timeline、replica 的门面)。本地 web 浏览服务、平台上报与开发任务绑定已在 2.0.14 整体下掉——数据只留在本机,不向任何平台上报(见 CHANGELOG)。TypeScript,CommonJS 输出,Node `>=22.5 <27`(依赖内置的 `node:sqlite`;无原生依赖、无 wasm)。

2.0 是一次破坏性重构:1.x 得名所由来代码图谱层已被**整体移除**(没有 `explore`/`query`/`callers`/`index`/`sync`,没有 MCP server,没有遥测)。在假设任何 1.x 行为之前,请先看 `CHANGELOG.md`。由此带来的本仓库现状:

- 根目录下的 `.cgraphx/` 只是运行时数据;`.claude/` 和 `.mcp.json` 是被 gitignore 的 1.x 使用环境产物。
- 1.* 版本源代码在 ` /Users/smdnk/objects/ai/codegraph `

- 没有配置 lint 脚本。
- 从构建产物直接跑 CLI:`node dist/cli/index.js <command>`(不带参数直接执行 `node dist/cli/index.js` 会启动交互式安装器)。
- vitest 固定了 `TZ=UTC`(见 `vitest.config.ts` 中的注释),以保证日期/时区相关断言可复现;跨时区行为通过派生带显式 `TZ` 的子进程来验证(`__tests__/core/timeline/store.timezone.test.ts`)。不要为了迁就本机时区去改 TZ 处理逻辑。
- 测试位于 `__tests__/core/<子系统>/`,与 `src/core/` 的结构镜像对应。

## 产品全貌:skill 流程 + 程序能力

cgraphx 的本质是一套**面向 AI agent 的通用辅助研发系统**,不是一个单纯的 CLI 工具。skill(markdown 指引)是主体,定义研发流程;程序(cgraphx CLI)为流程提供不可替代的能力支撑(知识库检索、数据库查询、时间线)。**agent 读 skill → 按流程调程序能力**,改任何一侧前先理解这个分工(spec §1.2)。

**skill 主线**(`assets/claude-template/skills/` 下共 32 个 skill,流程全景见 `cgraphx-guide` skill 的 `how-to-use.html`):

- 新项目启动(按需):`/init-tech-stack`(12 层决策树定技术栈,ADR 落 `docs/adr/`)→ `/init-guides` → `/init-ddl` / `/init-knowledge`;换栈/迁移由 `/dev-migrate` 提示用户跑。
- 需求主线:`/dev-clarify`(必经,澄清意图/业务边界/技术边界)→ `/dev-spec`(核心,技术规格契约)→ `/dev-plan`(大需求必走:index 加一个任务一个文件)→ `/dev-impl`(小需求)或 `/dev-impl-subagent`(大需求:一个会话按任务派子 agent,全部做完统一验证,最后 `/code-review`;判据是需求规模——≥10 文件且 ≥3 独立模块,不是任务量)。日常默认两步:澄清 + 实现。可选的版本流程:`/release-start` 开版本(打 tag、拉版本分支 `dev/<版本号>`、装提交拦截)→ 每个需求 `/dev-start` 开 worktree 副本 `<主目录名>@<文件前缀>`(只带 agent 配置和 `.worktreeinclude` 清单里的文件,依赖默认不带)、在副本里做 → `/dev-merge` 合入版本分支 → 发版前 `/release-review` 出审核报告,说「发」合入主干;不跑就照旧在当前分支上开发。
- 系统迁移(按需):`/dev-migrate`(换技术栈重写整个系统:旧系统当标准答案,盘点行为清单 → 定目标与表映射 → 按切片走需求主线 → 新旧对拍 + 数据对账 → 切换清单;配方按 `references/配方-<旧栈>-to-<新栈>.md` 积累)。
- 平行支线:接口测试(`/api-case` → `/api-run`,写接口必须查 DB 验数据)、单元测试(`/unit-spec` → `/unit-code`)、知识沉淀(`/knowledge-write` 触发,`knowledge-recall` 由 agent 自动召回,`/knowledge-migrate` 把 Claude Code 自动记忆迁进来)、DB schema 知识(`/init-ddl` 导出 + `db-query` 探索回写)、认证安全审计(`/audit-login-security`,白盒为主、只报告不修)。
- 工作回顾(按需):`/doc-report`(日/周/月报)、`/doc-workload`(工作量汇报)、`/doc-monthly-report`(月底填报表,从工作台日报出,不是 timeline)。
- 命名:skill 名按使用阶段加前缀——`init-` 项目接入、`dev-` 做需求主线、`release-` 发版流程、`api-` / `ui-` / `unit-` 三条测试线、`doc-` 事后文档与汇报;每个阶段都会用的(knowledge-*、db-query、audit-*、cgraphx-guide)不加。新增 skill 照此命名;改名时旧路径登记进 `deprecated-assets.json`。

**`docs/` 目录约定(skill 与程序的契约,目标项目内):**

- `docs/features/<feature-id>/`(命名见 `docs/guides/feature-standards.md`,没有就按 `YYYY-MM-DD-[业务ID-]<标题>`) —— 单次需求工作目录,`<前缀>-spec.md` 必有(头部声明 `> 负责人:`),其余产物(plan/、单元测试规格与报告、api 测试规格与报告、设计文档)由各 skill 按流程写入。按人找需求:`cgraphx features list --mine`(本地个人索引由 `features sync` 生成于 `.cgraphx/my-features.md`)。
- `docs/knowledge/*.md` —— 跨需求共享的业务知识库,**`cgraphx docs` 的索引对象**;写文件前必须过 `cgraphx docs validate`,非法文件会被索引跳过。
- `docs/bruno/` —— 接口测试产物(api-case + api-run 维护,bruno app 可直接打开)。
- `docs/schema-knowledge/<工程>/` —— DDL 快照(INDEX.md + ddl/*.sql + pending-comments.sql);`db-query` 首选读本地 DDL,文件不存在才连 DB 兜底,探索发现 append 到对应表的 DISCOVERED 块(重 dump 时保留)。

## 架构

**分层(约定强制,见 spec §3.1):** `src/core/` 承载全部业务逻辑与基础设施,且永远不得依赖 `src/cli/`;`cli` 只依赖 `core`。

**CLI 入口(`src/cli/index.ts`):** Node 版本下限硬拦截(可用 `CGRAPHX_ALLOW_UNSAFE_NODE` 覆盖)、fatal handler、无参数时进入交互式安装器,然后构建 commander 程序。子系统命令组(docs/db/timeline/features/board/report/replica/release/project/commit-gate)通过各自 `cli.ts` 导出的 `registerDocsCommands` / `registerDbCommands` / `registerTimelineCommands` / `registerFeaturesCommands` / `registerBoardCommands` / `registerReportCommands` / `registerReplicaCommands` / `registerReleaseCommands` / `registerProjectCommands` / `registerCommitGateCommands` 自行注册;另有十二个兼容旧配置的隐藏空命令(5 条 sync/task 旧 hook + 7 条 timeline 旧 hook,不属任何子系统,读完 stdin 静默退出,见 `cli/legacy-hook-commands.ts`)单独注册。根命令挂了 commander `postAction`,会话提示(`core/session-notices.ts`:skill 版本、自动记忆去向、补 git 钩子片段三条)经它输出 stderr,隐藏命令与 git 钩子调起的命令不算一条。`index.ts` 内联注册的顶层命令只有 `upgrade` / `version` / `install` / `uninstall` —— `init` / `status` / `uninit` 已折叠进 `install` / `uninstall`,不存在独立的数据层命令;子系统子命令归各自子系统的 `cli.ts`。ANSI 颜色是手写的转义序列("避免 chalk 的 ESM 问题")—— 不要引入 chalk。

**子系统形态(docs/db/timeline 三个遵循):** 公共门面 `index.ts`(外部调用方必须用它 —— 不得直接伸手进内部模块)、`cli.ts`、`types.ts`、`errors.ts` 中的类型化错误层级、`constants.ts`,以及用于幂等 schema 应用的 `schema.sql` + `schema-bootstrap.ts`。`features` 是轻形态:无 DB、无 schema,索引是 `docs/features/` 目录树的实时派生视图(`list` 查询 / `sync` 全量重写本地个人索引 `.cgraphx/my-features.md`,负责人取 git 用户,dev-spec/dev-plan 创建时在头部声明 `> 负责人:`)。`replica` 与 `release` 是另两个轻形态子系统(门面 + cli + errors + types + constants,无库表),只依赖基础层(directory、db、`git-hooks.ts`、`repo-projects.ts`)与 agents 门面:副本是 git worktree(主目录旁 `<主目录名>@<文件前缀>`,只带 agent 配置与 `.worktreeinclude` 清单里的文件;带进来的文件用副本自己的 `core.excludesFile` 藏起来,合入、同步直接读同一个仓库的 `refs/heads/<分支>`);`replica` 管需求副本的开、列、删与登记(`cgraphx replica create / list / remove`),登记是主目录 `.cgraphx/replicas/<副本目录名>.json` 文件,一个副本一个,删副本只填 `removedAt`;features 依赖它(只经门面);「是不是副本、主目录在哪」(`replicaLinkOf`)只给版本流程、features 与 project 的重名判断用;根汇总由调用方传入 timeline 记下的根和当前根,replica 挂上这些根上的副本登记。`release` 管版本分支(`dev/x.y.z`)的提交拦截(`cgraphx release guard`:commit-msg 钩子片段,只由 `/release-start` 装,每次装都记「按版本走」的本地 git 配置 `cgraphx.releaseFlow`,`cgraphx uninstall` 一并删除)。`commit-gate` 是轻形态子系统(门面 + cli + errors + constants,无库表),只依赖基础层 git-hooks 与 release、agents 门面:agent 提交的 commit-msg 门禁(`cgraphx commit-gate-hook <说明文件>`,隐藏命令,由 `cgraphx install` 装的 commit-msg 片段经 PATH 调起;版本分支 → 合并收尾 → 无暂存 → 产物检查(子进程跑 `cgraphx features check`,15 秒超时) → 提交说明自查;退出码只有 0 放行 / 3 打回,打回只来自退出码 3,`command not found`、超时、自身异常一律放行——git 钩子片段不得让提交失败);没打回就把 `git write-tree` 结果写进 `<git 目录>/cgraphx/commit-gate-pass` 记号,post-commit 片段前台读删、经 `CGRAPHX_GATE_TREE` 传给后台记录进程;片段先看会话变量(名单来自 agents 描述的 `sessionIdEnv`),一个都没有(人手动提交)就不起 node;`--no-verify` 跳得过门禁,跳过的 agent 提交记 `metadata.gate='skipped'`(人读摘要标「跳过门禁」)。git 钩子片段统一经基础层 `src/core/git-hooks.ts`(文件级辅助在 `git-hooks-files.ts`)写进 `git rev-parse --git-path hooks`(跟随 core.hooksPath),timeline、release、commit-gate 三家共用;只写不被 git 跟踪的钩子文件:仓库外的共用钩子目录、非 shell、链接、被跟踪的钩子都不写(被跟踪的:工作区那份有片段就算已装上;卸载时团队提交的不删、本机没提交的删),工作区里新建的钩子文件进 `.git/info/exclude`;装上的片段连同写进过的文件登记在 `<git 公共目录>/cgraphx/hook-snippets.json`(文件归属按 git 判断,别的仓库的不碰),换钩子目录后再装迁走旧片段,按登记补回缺了的片段的时机是 post-commit 后台进程与会话提示(命令输出),补不上的提示一次并删登记;只保证高频场景,多个 worktree、子模块、链接等情况记作已知限制(spec F8 细节方案末尾)。`project` 是轻形态子系统(门面 + cli + errors + types + constants,无库表),只依赖基础层与 timeline、replica 的门面,并承载已下掉功能的数据清理(install 时删 `sync_*`/`task_*` 表与运行文件);重名提示(F3)也在这里:首次进目录判断一次,记录在 sessions.db 的 `dirs_checked`,命令末尾与 install 两处提示。`board` 也是轻形态子系统(门面 + cli + errors + types + constants,无库表,只经 project、timeline、features、replica、agents 五个门面取数):`cgraphx board` 任意目录可跑,先逐项目补录再开本机只读网页(只听 127.0.0.1、随机端口 + 随机令牌,令牌/Host/Origin 任一不过 403),左栏任务、右栏会话,认任务是补录后现算的纯函数(按副本目录、需求分支、提交与写需求目录、流程命令等依据把会话挂到需求,不写绑定),除补录外不写任何东西;页面 `page.html` 与 TS 同放,经 copy-assets 随包分发。

**共享 DB(`src/core/db/`):** 每个项目一个库 `~/.cgraphx/projects/<目录名>/cgraphx.db`(timeline 的表),知识库是各目录本地 `.cgraphx/cgraphx.db` 的 `markdown_*`(`getLocalDatabasePath`)。本层将 `node:sqlite` 的 `DatabaseSync` 包装成 better-sqlite3 风格的接口(`prepare/exec/pragma/transaction`,statement 提供 `run/get/all/iterate`)。基础层与 schema 无关;每个子系统拥有自己的前缀表(`markdown_*`、`timeline_*`)并自行应用 schema。另有用户级 `~/.cgraphx/sessions.db`(基础层 `session-index.ts`,0600,五表:补录进度 `session_files`、开始目录归属 `start_dirs`、删除记录 `removed_projects`、提示记录 `notices_shown`、判断过重名的目录 `dirs_checked`;是 cgraphx 自身基础设施,不走 data-standards):进度跟着会话文件走、不随项目数据删——`project remove` 只写 `removed_projects`、偏移不动,改名只清受影响根的 `start_dirs`;提示频控也存这里(30 天前的行打开时删)。基础层的项目定位(`project-identity.ts`、`repo-projects.ts`、`user-data-dir.ts`、`session-index.ts`、`data-location.ts`、`root-match.ts`,不 import 任何子系统):提交按工作区根认出项目根,按项目名称认项目(记下的名字 → 工作区根有 origin 取仓库名 → 装过取目录名),项目目录名就是名字;`identity.json` 版本 2 带 `origins`,地址只用于取默认名字和重名提示;`removed_projects` 的键是名字;会话文件按 start_cwd(开始目录)认归属,目录还在就现认、不在了才用 `start_dirs` 缓存(旧会话登记目录 `~/.cgraphx/sessions/` 已废弃,时间线重建时删)。timeline 的库与 db-query 的项目级配置与日志经 `getDataDir`(`data-location.ts`)/ `getDatabasePath`(`db/index.ts`)落在项目目录;项目目录只经 `ensureProjectDir` 建(调它的只有写数据的入口 `ensureDataDir` 和并旧数据),别处目录不在就不建、不写,没装过的目录只在项目目录已在时记进去。知识库库文件、`my-features.md`、副本登记、`shared` 链接(数据位置不再看它)和并过记号 `.cgraphx/project.json` 留在本地。本地库里还有 timeline/task/sync 旧表、没有并过记号的目录走旧库模式,数据照旧记在本地库(升级后还没在这里跑过 install 的目录)。`cgraphx install` 本地只建 markdown 表,装完 git 钩子片段后经 project 门面把旧库并进用户目录(先备份进项目目录的 `backups/`;只并 git_commit 与 `timeline_roots`,并完顺势从会话文件重建时间线,每项目一次),再清掉已下掉功能留下的 `sync_*`/`task_*` 表与运行文件;`cgraphx uninstall` 只卸这个目录、项目数据留着(删用 `cgraphx project remove <目录名>`),同一仓库还有装着的目录时 git 钩子留着,`--keep-data` 保留本地 `.cgraphx/`。`~/.cgraphx/` 根下不放 `cgraphx.db`;测试一律经 `__tests__/setup-home.ts` 用临时 HOME。1.x 遗留的图表表(`nodes`/`edges`/`files`)由 `db/migrate.ts` 一次性清除,别处无人读写。

**docs:** 索引带 frontmatter 的 markdown;查询用 LIKE 而非 FTS5,以兼容 CJK。流水线:`frontmatter-parser` → `validator` → `extractor`/`summary-extractor` → `indexer` → `store`/`query`;去重分两层(入口名、概念名)。

**db:** 从构造上保证只读 —— `safety.ts` 在 mysql/postgres 驱动(`drivers/`)执行前拦截每一条 SQL(剥离注释但保留字符串字面量 → 拒绝多语句 → 禁用关键字扫描 → 强制 LIMIT)。项目级连接 profile 存放在项目数据目录的 `db-profiles.json`(用户级在 `~/.cgraphx/db-profiles.json`)。

**timeline:** 事件采集**不依赖 agent hook**——查时间线的四个查询命令(query / show / stats / recent)、git 提交后的后台进程、install 并旧数据之后、`cgraphx board` 启动与刷新时逐项目,都先经补录入口 `ensureTimelineUpToDate`(`timeline/ingest/`)把各家 agent 自己留下的会话文件里新增的部分解析进项目库,再查询。补录层:`ingest/types.ts` 的会话事实模型(prompt / tool / turn_end / session_head / session_title,读取器只产事实、不打开任何库、不知道项目归属)+ 三家读取器(claude-transcript / codebuddy-transcript / deepseek-session;来源统一经 agents 门面 `listSessionSources()` 枚举——前两家派生自 AGENT_PROFILES,deepseek 是**只读会话来源**(读 `~/.dsh/sessions/` 的 zstd 帧式 jsonl,`DSH_HOME` 设了以它为家目录;要 Node 22.15+,低了跳过并提示;不进安装器、副本与门禁);接新 agent = 描述字段 + 一个读取器)+ `ingest.ts`(增量补录:归属判定、事实 → 事件、`ingest.lock`、K11 解析不出提示)+ `rebuild.ts`(全量重建)。事件去重走 `timeline_events.source_key` 部分唯一索引(`INSERT OR IGNORE`;schema 版本号不升);`pre_tool_use` / `session_end` 不再有新数据,`--type` 与显示照旧认;工具事件 `ts` 取结果行、`cwd` 取调用行、时长为两行差(`duration_source:'transcript'`),轮次编号取提问 uuid。会话标题(claude 的 custom/ai、deepseek 的 agent 标题;codebuddy 没有)存项目库 `timeline_session_titles`——一个会话一行,custom > ai > agent、同级取新,只加表不升 schema 版本号;老会话在补录入口一次回填(只写标题、不写事件、不推进偏移,记号 `timeline_meta.session_titles_at`)。归属:开始目录还在就现认,不在了才用 `sessions.db` 的 `start_dirs` 缓存,再退到 `timeline_roots` 与副本登记兜底;开始目录不是本机绝对路径(如 `D:\...`)的不归任何项目,也不读写 `start_dirs`;每写一批事件同一事务 upsert `timeline_roots`。升级后第一次 install 或第一次查时间线,清掉 hook 记的旧事件、按解析全量重建(每项目一次,记号 `timeline_meta.rebuilt_at`;提交记录保留)。提交记录照旧由 git post-commit / post-merge 片段后台调起的 `timeline-git-commit-hook` 记(hash 与分支由片段在提交当下固定),记完顺带补钩子片段、判跳过门禁、补录;`cgraphx timeline install` 只装这两个提交记录片段(commit-msg 门禁片段由 `cgraphx install` 装)。会话开始的三条提示改由根命令 postAction 输出 stderr(`core/session-notices.ts`)。`CGRAPHX_NO_TIMELINE` 管采集(补录与重建停)不管门禁;补录失败只产 stderr 提示,查询退出码与 stdout 不受影响。7 条旧 timeline hook 子命令留成隐藏空命令兼容,agent 配置里的死条目由 install/uninstall 清掉。

**安装器(`src/cli/installer/`)+ 资产:** `cgraphx install` 将 `assets/claude-template/`(skills/agents/commands/plugins)部署进目标项目的 `.claude/`(全局或本地;模板 `hooks/` 下只剩 context-monitor,提交门禁不再走 agent hook)、装 git 钩子片段(timeline 的 post-commit / post-merge 提交记录片段 + commit-gate 的 commit-msg 门禁片段——不再往 agent 配置里写任何 hook)、创建本地 `.cgraphx/`(只建知识库表,即被折叠的旧 `init`)、每个项目都问一次名字并记下(`-y` 用默认名字并写回)、把旧库并进用户目录(只并提交记录与 `timeline_roots`,并完从会话文件重建时间线),并做升级清理——agent 配置里已下掉功能的死 hook(`sync-*` / `task-*` 五条 + timeline 七条,按完整子命令名认)、`hooks/precommit-check` 目录、库里的 `sync_*`/`task_*` 表与运行文件一并删掉;2.0 刻意**不**写 `.mcp.json`。模板通过在构建时拷贝到 `dist/.claude-template/` 随包分发。

## 易踩的坑

- **skill 的修改入口是 `assets/claude-template/`(源,随包分发,`cgraphx install` 部署),不是本仓库根目录的 `.claude/`。** 后者是被 gitignore 的已部署运行环境,内容可能滞后——按 spec §1.3,它只作功能/流程参考,更不要照着它假设 1.x 行为。
- **`scripts/copy-assets.cjs` 是构建期的资产清单。** `tsc` 只产出 JS;任何与 TS 源码放在一起的新运行时资产(例如另一个 `schema.sql`)必须加进这个脚本,否则不会随包发布。运行时 schema 路径是相对编译后的模块文件解析的,所以 dist 的目录结构必须与 `src/` 镜像一致。
- 严格 TS,含 `noUncheckedIndexedAccess` —— 索引访问得到的是 `T | undefined`,代码库中对此有显式处理。
- 版本号在 `cli/index.ts` 中于运行时从 `package.json` 读取(`npm version` 的版本号唯一事实来源)。
- `src/cli/uninstall.ts` 通过 npm 的 `preuninstall` 钩子执行。
- `docs/features/` 下是 2.0 重构的 spec 与 plan(中文)—— 各子系统预期行为(§3)与分层约束的权威描述。

## 我们解决什么问题

cgraphx 的 skill 流程针对 AI 辅助研发中反复出现的几类浪费,逐个给出流程级解法:

**1. 文档漂移导致返工。** 传统链路 PRD → Spec → Plan → Code,改一条业务规则要回归所有上游文档——三份文档的一致性靠人维护,实际项目中必然漂移,最终「三份都在,没一份能信」。核心取舍:**前期文档越少,变更时的回归成本越低。**

- Spec 是唯一契约——「没有任何业务义务存在于 spec 之外」。clarify 是对话(锁定决策但不产生需要维护的文档),spec 是唯一的权威源;变更时只改 spec 一处,plan / dev-impl 从这一处重新派生。
- 需求文档、设计文档、接口文档(`/doc-delivery`)都不在开发主链上,推荐发布后按需执行——发布后写的是实际交付的行为,不存在文档与系统漂移的问题。流程全景和时机标注见 `assets/claude-template/FLOW-MAP.md`。
- 这也匹配 agent 的能力结构:维持 N 份文档互相一致很差(上下文有限、顾此失彼),从单一权威源派生很强。

**2. 业务知识随会话消失。** 和 agent 聊出来的业务理解(概念定义、决策理由、踩过的坑、隐式约束)随会话结束就丢了;下次开发同一模块,agent 从零开始,人再解释一遍。解法是**沉淀 → 召回的闭环**:开发收尾由交付提示触发 `/knowledge-write` 把有价值的知识写入 `docs/knowledge/`(双层结构:实体主条目 + 流程条目);下次开发前 `/knowledge-recall` 先召回相关概念再动手——用得越多,agent 的项目上下文越厚,重复解释和重复踩坑越少。

**3. 数据模型每次从零理解。** agent 要查数据或改表,要么连库拿结构(贵:要凭据、要网络、要 LIMIT 保护),要么凭空猜字段含义;上次探索发现的隐式关系(如 `assignee_id` 实际对应 `users.staff_code`)下次又不知道。解法是**本地 DDL 知识库 + 探索回写的闭环**(全景见 `init-ddl` skill 的 `closed-loop.html`):`/init-ddl` 建基线(按工程分目录,一表一文件)→ `/db-query` 首选读本地 DDL(便宜),只在知识库没有或要实际数据时才连库(贵,兜底)→ 探索中发现的字段含义、隐式关系 append 到对应表的 DISCOVERED 块(双向引用)→ 重跑 export 刷新 DDL 但**保留 DISCOVERED 块**。agent 默认走本地知识库,积累才生效,闭环才转得起来。

**4. 需求理解偏差。** 拿到模糊需求直接开写,做完发现理解错了,是另一种返工。`/dev-clarify` 在写任何文档和代码之前先锁业务边界和技术约束——像员工接领导任务:先确认意图、识别任务类型、针对性提问,必要时挑战假设,而不是拿到一句话就开始干。

**5. 规范靠人记。** 编码规范、接口规范、数据规范、提交规范,写了没人看、看了记不住。解法是**规范在执行期自动送达**:`/init-guides` 生成 `docs/guides/` → `/dev-plan` 按任务类型打「强制引用」标注(schema → data-standards.md;接口 → interface-standards.md;动码 → coding-standards.md;测试规范不进 plan,由 unit-code 执行前自读)→ dev-impl 执行时只读标注的规范,不需要人主动想起来;commit 门禁(commit-gate 的 git commit-msg 钩子片段)在 `git commit` 时拦截,指向 `git-standards.md` 自查——`--no-verify` 跳得过,跳过的提交在时间线上标出来、发版审核时列出。

**6. 开发流程到「写完代码」就断了。** 市面上的 AI 辅助研发工具(包括开源的)基本只覆盖到代码生成为止——接口写完、代码提交,流程就结束了;测试是人的事,手动录接口、手动跑、手动验。cgraphx 把接口测试织进了 skill 流程:`/api-case` 从 spec 的接口章节自动生成 bruno 测试用例(.bru + 内嵌断言 + 真实参数),`/api-run` 跑测试并强制核实写接口的 DB 副作用(HTTP 200 ≠ 通过,不查数据等于没测)。从 spec → 代码 → 测试用例生成 → 执行 → DB 验证 → 出报告,是闭环而不是断链。

**7. 工作不可追溯。** 过了两周领导问「这个月做了什么」,只能翻 git log 和聊天记录拼凑;agent 会话里的操作(改了哪些文件、跑了什么命令、卡在哪一步)更是无痕。解法是**自动记录 + 按需汇报**:timeline 不占 agent 的工作流——事件在查时间线、提交后、install 时从 agent 自己留下的会话文件(Claude Code、CodeBuddy)解析补录,落到用户目录里这个项目的库(`~/.cgraphx/projects/<目录名>/cgraphx.db`)的 `timeline_*` 表,同一项目的各个目录记在一起;升级后第一次查时间线会清掉 hook 时代的事件、按解析全量重建一次(提交记录保留)。需要时 `/doc-report` 从事件流生成日报、周报、月报、阶段总结、使用习惯分析——不用回忆,不用拼凑,数据一直在。

**8. 工具升级留残渣。** skill 改名或移除后,旧目录在已部署项目中永久残留,agent 仍能触发过时的旧 skill。`deprecated-assets.json`(模板根目录)列出已废弃路径,`cgraphx install` / `uninstall` 时自动清理(`src/cli/installer/claude-assets.ts` 的 `cleanDeprecatedAssets`)。新增废弃路径只需往清单加一行。

## 工作内容和准则
- 我们这个项目主要是用来开发和优化skill, 由于AI的模仿能力极强, 因此我们写skill时尽量直接展示最好案例, 避免啰嗦半天的介绍. 
- 对于禁止内容, 主要目的是避免AI做了我们未提到的内容,倒不是怕把我们已经提出案例的内容做错