# 02-backend: cgraphx2.0重构 实现任务

> feature-id: 2026-07-25-cgraphx2.0重构
> 总控: `cgraphx2.0重构-index.md`
> 源码来源: `/Users/smdnk/objects/ai/codegraph/src/*`
> 目标根: `/Users/smdnk/objects/ai/cgraphx`
> 构建: `tsc`(commonjs, outDir dist, rootDir src)+ `copy-assets` + `chmod`;测试: `vitest run`

任务编号 B-1 ~ B-11。测试并入对应实现任务(不单列 T 任务)。每个任务的"完成条件/验证方式"写到 implementer 可直接执行。

---

### B-1: 项目脚手架(单包 + src 分层)

- **目标**:在新项目根建立单 npm 包 + `src/{core,cli,web}` 分层骨架,可编译可装依赖。
- **依赖**:无(一切起点)。
- **涉及范围**:`package.json`、`tsconfig.json`、`.gitignore`、`src/core/`、`src/cli/`、`src/web/`(空骨架,各放占位 `index.ts`)。
- **必须严格执行**:
  - `package.json`:`name=cgraphx`、`version=2.0.0`、`bin={ "cgraphx": "./dist/cli/index.js" }`、`license=MIT`、`engines={ "node": ">=22.5.0 <26.0.0" }`、`type` 不设(沿用 commonjs)。**不设 `main`**(纯 CLI 包;codegraph 的 `src/index.ts` 是图谱类型聚合,不迁移,故无 `dist/index.js`)。
  - `scripts`:`build`(占位 `tsc`,B-10 补全 copy-assets + chmod)、`dev=tsc --watch`、`test=vitest run`、`test:watch=vitest`、`clean`(rm dist)、`prepublishOnly=npm run build`、`preuninstall=node dist/cli/uninstall.js`(B-6 迁移 `uninstall.ts`;路径从 codegraph 的 `dist/bin/` 改为 `dist/cli/`)。
  - `dependencies` 保留:`commander`、`mysql2`、`pg`、`@clack/prompts`;**砍除**:`tree-sitter-wasms`、`web-tree-sitter`。其余(`ignore`/`picomatch`/`jsonc-parser`/`fast-string-width`/`fast-wrap-ansi`/`sisteransi`)先全保留,实现期按实际 import 裁剪。
  - `devDependencies`:`typescript ^5`、`vitest ^2`、`@types/node`、`@types/pg`;**砍除** `@types/better-sqlite3`(改用 `node:sqlite`)。
  - `tsconfig.json`:基于 codegraph(`target ES2022`、`module commonjs`、`strict` 全开、`outDir ./dist`、`rootDir ./src`、`declaration`、`sourceMap`、`esModuleInterop`、`skipLibCheck`),**去掉** `paths.web-tree-sitter`,`include=["src/**/*"]`、`exclude=["node_modules","dist","__tests__"]`。
  - `src/core/`、`src/cli/`、`src/web/` 目录,各放 `index.ts`(空或占位 export)。
- **允许局部适配**:target ES2022 vs ES2023;入口文件名(`cli/index.ts` vs `cli/main.ts`,选定后全局一致);非三块直接依赖的包是否保留。
- **完成条件**:目录结构建立;`package.json`/`tsconfig.json` 就位;`src/{core,cli,web}/index.ts` 存在。
- **验证方式**:
  - `npm install`(无错)
  - `npx tsc --noEmit`(空骨架无错)
- **风险/注意事项**:Node 22.5+ 的 `node:sqlite` 不需要 native 编译;勿引入 better-sqlite3。

---

### B-2: 精简 DB 基础层(src/core/db)

- **目标**:提供不含图谱 schema 的 SQLite 基础层,供 markdown/timeline 复用。
- **依赖**:B-1。
- **涉及范围**:`src/core/db/`(`sqlite-adapter.ts`、`index.ts`)、`src/core/directory.ts`、`src/core/types.ts`(精简)、`src/core/errors.ts`、`src/core/utils.ts`(通用基础设施,随 DB 层一并迁移)。
- **来源**:codegraph `src/db/sqlite-adapter.ts`(149 行,纯 `node:sqlite`,零外部依赖)、`src/db/index.ts`(`DatabaseConnection`,去掉图谱 schema 应用 + `runMigrations` + 对 `queries.ts` 的引用)、`src/directory.ts`(`getCodeGraphDir` + `CGRAPHX_DIR`;`isInitialized`/`findNearestCodeGraphRoot` 等按 bin/installer 实际 import 精简)、`src/types.ts`(只保留 `SchemaVersion` 等非图谱类型)、`src/errors.ts`(`Logger`/`defaultLogger`/`silentLogger` + 非图谱 Error 子类;**不含** `logDebug`)、`src/utils.ts`(按实际 import 决定迁移或砍 —— 实测 markdown/timeline/dbquery 均不 import `../utils`,大概率砍)。
- **必须严格执行**:
  - 复制 `sqlite-adapter.ts` 不改(纯 `node:sqlite` `DatabaseSync`)。
  - `DatabaseConnection.open()`:打开/创建 `cgraphx.db` + WAL/busy_timeout pragma;**不** `db.exec(图谱 schema.sql)`,**不** `runMigrations`,**不** import `queries.ts`。
  - 保留 `getDatabasePath()` → `getCodeGraphDir(root)/cgraphx.db`;保留 `SqliteDatabase` 类型导出。
  - markdown/timeline 各自的 `ensureSchema` 在自己模块里调用(它们的 `schema-bootstrap.ts` 独立,本任务不动它们)。
- **允许局部适配**:基础层 API 形态(保留 `DatabaseConnection` 类 vs 改函数式 open/getDb/close),但 `SqliteDatabase` 类型和 `getDatabasePath` 签名必须保留(markdown/timeline 依赖)。
- **完成条件**:`src/core/db` 可被 import;`open()` 创建的 `cgraphx.db` 无任何图谱表。
- **验证方式**:
  - 写临时脚本:`node -e "const {DatabaseConnection}=require('./dist/core/db');const c=DatabaseConnection.open('/tmp/cgtest');console.log(c.getDb().prepare(\"SELECT name FROM sqlite_master WHERE type='table'\").all());c.close()"` → 输出表列表**不含** nodes/edges/files(应为空或仅 sqlite 内部表)。
  - `npx tsc --noEmit` 无错。
- **风险/注意事项**:删 `runMigrations` 后,确认 markdown/timeline 的 schema 由各自 `schema-bootstrap` 应用(不依赖基础层的 migration)。

---

### B-3: markdown 迁移 + 测试(src/core/markdown)

- **目标**:整体迁移 markdown 知识库模块,语义不变,改 import 指向新 DB 基础层。
- **依赖**:B-2。
- **涉及范围**:`src/core/markdown/`(14 文件:`cli`、`indexer`、`store`、`query`、`schema-bootstrap`、`schema.sql`、`extractor`、`frontmatter-parser`、`validator`、`summary-extractor`、`constants`、`dedup`、`types`、`errors`)。
- **来源**:codegraph `src/markdown/*`(全复制)。
- **必须严格执行**:
  - 14 文件复制,**业务逻辑不变**。
  - 改 import:3 处对 `'../db'` 的引用(`store.ts`、`query.ts`、`schema-bootstrap.ts`)指向新 `src/core/db`(类型 `SqliteDatabase`、`DatabaseConnection`、`getDatabasePath` 签名不变)。
  - 保留 `schema.sql` + `markdown_schema_versions` + **LIKE 检索(非 FTS5)** + 自实现 frontmatter parser。
  - 保留 `registerDocsCommands(program)` 对外签名(B-6 调用)。
  - 保留 `package.json` 的 `copy-assets` 对 `markdown/schema.sql` 的复制(B-10 对齐新路径 `dist/core/markdown/schema.sql`)。`schema-bootstrap.ts` 的 `path.join(__dirname, 'schema.sql')` 解析需与新 dist 路径一致。
- **测试**:迁移 codegraph `__tests__/markdown/*`(vitest)到新项目 `__tests__/core/markdown/`,改 import 路径,确保通过。
- **完成条件**:markdown 编译通过;`npm test` markdown 测试全绿。
- **验证方式**:
  - `npm test -- core/markdown`(vitest)
  - 临时脚本:在含 `docs/knowledge/*.md` 的临时项目跑 `indexMarkdownKnowledgeBase`,再 `MarkdownQuery.listConcepts()` 有返回。
- **风险/注意事项**:schema.sql 资产路径(见 index 风险 1);`related_documents` 双路径约定整体保留。

---

### B-4: dbquery 迁移 + 测试(src/core/dbquery)

- **目标**:整体迁移数据库查询子系统,零耦合,近乎零修改。
- **依赖**:B-1(不依赖 B-2,本模块自洽)。
- **涉及范围**:`src/core/dbquery/`(`index`、`cli`、`executor`、`config`、`safety`、`queries`、`drivers/{mysql,postgres}`、`format`、`logging`、`init`、`constants`、`types`、`errors`、`identifiers`)。
- **来源**:codegraph `src/dbquery/*`(全复制)。
- **必须严格执行**:
  - 整目录复制,**业务逻辑不变**。
  - 零图谱依赖,无需改父目录 import(模块自洽,父引用都是自身兄弟文件)。
  - 保留 `.cgraphx/` 目录约定(`db-profiles.json` POSIX 0600、`db-query.log` 10MB rotate)。
  - 保留 `registerDbCommands(program)` 签名;保留安全契约(关键字黑名单 20 词、多语句检测、LIMIT 强制、密码 redaction、超时 30s)。
  - 保留 exit code 映射(0/2/3/4/5)。
- **测试**:迁移 codegraph `__tests__/dbquery/*` 到 `__tests__/core/dbquery/`。
- **完成条件**:dbquery 编译通过;`npm test` dbquery 测试全绿。
- **验证方式**:
  - `npm test -- core/dbquery`
  - `node dist/cli/index.js db profiles`(无 profile 时提示 `cgraphx db init`)。
- **风险/注意事项**:低(最干净模块);只读保护靠客户端黑名单,部署文档强调 DB 账号只读(spec 已记)。

---

### B-5: timeline 迁移 + 测试(src/core/timeline)

- **目标**:整体迁移开发时间线模块,语义不变,改 import 指向新 DB 基础层。
- **依赖**:B-2。
- **涉及范围**:`src/core/timeline/`(15 文件 + `schema.sql`:`index`、`cli`、`store`、`schema-bootstrap`、`schema.sql`、`recorder`、`hook-runner`、`hooks`、`post-tool-summary`、`bash-semantics`、`indexer`、`installer`、`payload`、`constants`、`types`、`errors`)。
- **来源**:codegraph `src/timeline/*`(全复制)。
- **必须严格执行**:
  - 15 文件 + `schema.sql` 复制,**业务逻辑不变**。
  - 改 import:3 处对 `'../db'` 的引用(`store.ts`、`schema-bootstrap.ts`、`installer.ts`)指向新 `src/core/db`。
  - 保留 hook 不变量:永不阻塞(try/catch + exit 0 + 空 stdout,50ms 预算)、`CGRAPHX_NO_TIMELINE` kill-switch、exit codes(0/2/3/4)、`tool_args` 不截断。
  - 保留 5 个 hidden hook 入口(`timeline-user-prompt-hook` 等)、`install/uninstall`(注册 `.claude/settings.json` hooks + `.git/hooks/post-commit`)、per-turn 状态文件 `.cgraphx/timeline-current-turn.json`。
  - 保留 `registerTimelineCommands(program)` + `installTimelineHooks`/`uninstallTimelineHooks` 签名(B-6/B-9 调用)。
  - `schema-bootstrap.ts` 的 `__dirname/schema.sql` 解析需与 B-10 的 `dist/core/timeline/schema.sql` 对齐。
- **测试**:迁移 codegraph `__tests__/timeline/*`(10 文件)到 `__tests__/core/timeline/`,改 import,确保通过。
- **完成条件**:timeline 编译通过;`npm test` 10 个 timeline 测试全绿。
- **验证方式**:
  - `npm test -- core/timeline`
  - 临时项目:`cgraphx timeline install` 后,模拟 hook stdin payload,`cgraphx timeline recent` 有事件。
- **风险/注意事项**:timeline 自带 `installer.ts` 写 hooks,与 B-9 installer 模块职责区分(见 index 风险 4);B-9 调 `installTimelineHooks`,不重复写。

---

### B-6: bin 主入口 + 命令注册 + telemetry 清理(src/cli)

- **目标**:建立 2.0 主 CLI,注册命令集,砍除图谱/serve/telemetry 命令,清理所有 telemetry 引用。
- **依赖**:B-3, B-4, B-5。
- **涉及范围**:`src/cli/index.ts`(主入口)、`src/cli/uninstall.ts`(迁移自 codegraph `src/bin/uninstall.ts`,preuninstall 清理脚本)、`src/cli/ui/`(迁移自 codegraph `src/ui/`:`shimmer-progress.ts`、`glyphs.ts` 等,bin 引用)、`src/cli/node-version-check.ts`(迁移自 codegraph `src/bin/node-version-check.ts`,Node 22.5 门控)。
- **来源**:codegraph `src/bin/codegraph.ts`(参考命令注册结构,**不**复制图谱命令;参考其 commander 设置、ANSI helper、resolveProjectPath、version 处理)。
- **必须严格执行**:
  - 主 CLI:`program.name('cgraphx').description('...').version('2.0.0')`。
  - 注册命令:`docs`(调 B-3 `registerDocsCommands`)、`db`(B-4 `registerDbCommands`)、`timeline`(B-5 `registerTimelineCommands`)、`init`(创建空 cgraphx.db:调 B-2 `DatabaseConnection.open` + `ensureMarkdownSchema(db)`(`src/core/markdown/schema-bootstrap.ts`)+ `ensureTimelineSchema(db)`(`src/core/timeline/schema-bootstrap.ts`),**不**建图谱索引)、`status`(B-7)、`upgrade`(**内联**注册:`.command('upgrade [version]')` + `await import('../cli/upgrade')`,与 codegraph bin 一致,**不**依赖 register 函数)、`version`、`install`/`uninstall`(B-9)。
  - **砍除**(不得注册):`explore`/`query`/`node`/`callers`/`callees`/`affected`/`index`/`sync`/`search` 等所有图谱命令、`serve`、`telemetry`、`uninit`(并入 uninstall 或保留,见允许适配)。
  - **telemetry 清理**(grep 全量定位,逐一删):`preAction` hook 里的 `getTelemetry().recordUsage/maybeFlush`、`TELEMETRY_FLUSH_COMMANDS`、`recordIndexTelemetry`、`recordIndexEvent`、`getTelemetry` import、任何 `../telemetry` import。确保无残留引用(否则编译错)。
  - 无参数运行(`process.argv.length===2`):沿用 codegraph 行为调 `runInstaller`(B-9),或改为显示 help(二选一,全局一致)。
  - 保留 `installFatalHandlers`、`relaunchWithWasmRuntimeFlagsIfNeeded` 等——**注意**:后者是 tree-sitter WASM 相关,砍图谱后**删除**该调用(无 WASM)。
- **允许局部适配**:命令组织(单文件 vs `src/cli/commands/` 子目录);无参数行为;ANSI helper 是否沿用。
- **完成条件**:`cgraphx --help` 显示 2.0 命令集(无图谱/serve/telemetry);图谱命令报 unknown;telemetry 无残留引用。
- **验证方式**:
  - `npm run build && node dist/cli/index.js --help`(命令集正确)
  - `node dist/cli/index.js explore` → "unknown command 'explore'"
  - `node dist/cli/index.js callers foo` → unknown
  - `grep -ri "telemetry\|getTelemetry\|recordIndexTelemetry\|TELEMETRY_FLUSH" src/` → 无命中
  - `npx tsc --noEmit` 无错(验证 telemetry 清理彻底)
- **风险/注意事项**:telemetry 引用散落 bin 各处(index 风险 2);`relaunchWithWasmRuntimeFlagsIfNeeded` 与 WASM/tree-sitter 一起删;`installFatalHandlers`(通用进程崩溃兜底,不依赖图谱)**保留**,需迁移 codegraph 对应的 fatal-handler 模块到 `src/cli/` 或 `src/core/`;`init` 不得含图谱索引逻辑。

---

### B-7: status 改造(查三块状态)

- **目标**:`cgraphx status` 显示 markdown/timeline 表状态 + dbquery 配置,不查任何图谱表。
- **依赖**:B-6(命令注册位置), B-3, B-5, B-4。
- **涉及范围**:`src/cli/`(status 命令实现,可在 index.ts 或 `commands/status.ts`)。
- **必须严格执行**:
  - 查 markdown:`markdown_documents` 行数、`markdown_concepts`/`domains`/`tags` 计数、`markdown_schema_versions` 当前版本、last_indexed。
  - 查 timeline:`timeline_events` 总数、最近事件 ts、按 `event_type` 计数。
  - 查 dbquery:`.cgraphx/db-profiles.json` 是否存在、profile 数量。
  - 查初始化:`.cgraphx/cgraphx.db` 是否存在。
  - **不得**查询 nodes/edges/files 等图谱表(已不存在)。
  - 未初始化时提示 `cgraphx init`,exit code 2(沿用约定)。
- **允许局部适配**:输出格式(表格 vs 列表);具体展示字段。
- **完成条件**:`cgraphx status` 输出三块状态 + 初始化状态,无图谱字段。
- **验证方式**:
  - 临时项目:`cgraphx init` → `cgraphx docs index`(建一些文档)→ `cgraphx status` 显示 markdown 文档数 > 0、timeline 事件数、dbquery 配置状态。
  - `cgraphx status`(未 init)→ 提示 init,exit 2。
- **风险/注意事项**:无(全新逻辑);复用 B-3/B-5 的查询 API(`MarkdownQuery`、`queryEvents`/`getEventStats`)。

---

### B-8: upgrade 迁移(src/cli/upgrade)

- **目标**:沿用 CLI 自更新能力。
- **依赖**:B-1。
- **涉及范围**:`src/cli/upgrade/`(整目录;codegraph `src/upgrade/` 迁移)。
- **来源**:codegraph `src/upgrade/*`(全复制)。
- **必须严格执行**:
  - 复制 upgrade 模块整目录,**业务逻辑不变**。
  - `REPO='smdnkB/cgraphx'`、`NPM_PACKAGE='cgraphx'` 沿用(2.0 沿用名)。
  - 保留安装方式检测(`detectInstallMethod`:bundle/npm/npx/source)+ 对应升级执行。
  - **不新增 register 包装函数**(codegraph upgrade 无此函数);命令注册由 B-6 内联完成。
- **允许局部适配**:模块内部子文件结构(若 codegraph upgrade 多文件,一并迁移)。
- **完成条件**:upgrade 编译通过;B-6 内联注册后 `cgraphx upgrade --help` 可用。
- **验证方式**:
  - `node dist/cli/index.js upgrade --help`(codegraph 不支持 `--dry-run`,不验证该 flag)
  - `node -e "const {detectInstallMethod}=require('./dist/cli/upgrade');console.log(detectInstallMethod({filename:__filename,platform:process.platform,cwd:process.cwd()}))"`(检测安装方式不抛错)。
- **风险/注意事项**:低;upgrade 不依赖图谱。

---

### B-9: installer 调整(去 MCP,部署 assets + timeline hooks)

- **目标**:迁移 installer,去掉 MCP 配置写入,保留 assets 部署 + timeline hooks 注册。
- **依赖**:B-1(模块基础), B-5(协作 timeline hooks)。
- **涉及范围**:`src/cli/installer/`**全模块**(codegraph `src/installer/` 实测:`index.ts`、`clack.d.ts`、`claude-assets.ts`、`config-writer.ts`、`instructions-template.ts` + `targets/` 子目录 `antigravity/claude/codex/cursor/gemini/hermes/kiro/opencode/registry/shared/toml/types.ts`)。整体迁移,按砍除点改。
- **来源**:codegraph `src/installer/*`(全目录)。
- **必须严格执行**:
  - 部署 `assets/claude-template/*` → 目标项目 `.claude/`(skills/agents/commands/hooks/plugins),walk 复制逻辑在 `claude-assets.ts`,沿用(跳过 node_modules/.DS_Store)。
  - 注册 timeline hooks:调 B-5 的 `installTimelineHooks`(codegraph `installer/index.ts` 已有此调用模式,复用)—— **不**重复写 hooks。
  - **砍除 MCP 写入**(分散在 `config-writer.ts` + `targets/{claude,cursor,codex,gemini,hermes,kiro,opencode,antigravity}.ts`):grep 这些文件里写 `.mcp.json` 或 MCP server 注册的逻辑,逐一删/跳过。**不得只改 `index.ts`**。
  - 暴露 `runInstaller`(无参数入口)、`install`/`uninstall` 命令实现,供 B-6 注册。
  - install/uninstall 对称、idempotent;`offerWatchFallback` 等(若有图谱 watcher 相关)删除。
- **允许局部适配**:installer 内部结构;交互提示文案。
- **完成条件**:`cgraphx install` 部署 `.claude/{skills,agents,commands,hooks,plugins}` + 注册 timeline hooks + **不**写 `.mcp.json`;`uninstall` 清理对称。
- **验证方式**:
  - 临时项目跑 `cgraphx install`,检查:`.claude/skills/` 存在、`.claude/settings.json` 有 4 个 timeline hook 条目、`.git/hooks/post-commit` 存在、**无** `.mcp.json` 新增/修改。
  - `cgraphx uninstall` 后上述清理。
- **风险/注意事项**:timeline hooks 注册归属(installer 调 timeline,不重复);去掉 MCP 写入要彻底(grep 确认无 `.mcp.json` 写入)。

---

### B-10: assets 迁移 + 构建脚本(copy-assets)+ 命名替换

- **目标**:迁移 assets 资产;精简 copy-assets 构建脚本;统一 2.0 命名。
- **依赖**:B-6(构建脚本含主入口 chmod;命名涉 bin)。
- **涉及范围**:`assets/claude-template/`(全复制)、`package.json` 的 `build`/`copy-assets`/`files`、错误文案/env/CLI 描述/hook subcommand 命名。
- **必须严格执行**:
  - 复制 codegraph `assets/claude-template/*` → 新项目 `assets/claude-template/`(**skill 内容不改**,优化延后)。
  - `copy-assets` 脚本(在 `package.json` scripts 或独立 `scripts/copy-assets.cjs`)精简为:
    - 复制 `src/core/markdown/schema.sql` → `dist/core/markdown/schema.sql`
    - 复制 `src/core/timeline/schema.sql` → `dist/core/timeline/schema.sql`
    - 复制 `assets/claude-template` → `dist/.claude-template`(walk,跳过 node_modules/.DS_Store)
    - **不**复制 `db/schema.sql`(图谱)、**不**复制 `extraction/wasm`
  - `build` 脚本:`tsc && npm run copy-assets && node -e "require('fs').chmodSync('dist/cli/index.js', 0o755)"`。
  - `files` 字段:`["dist","scripts","README.md"]`(assets 经 copy-assets 进 `dist/.claude-template`)。
  - 命名替换(沿用 cgraphx,改动小):错误文案保持 `cgraphx init`/`cgraphx install` 等措辞;`CGRAPHX_*` env 沿用(spec 待确认,倾向保留);timeline hook subcommand `cgraphx timeline-*-hook` 沿用;CLI description 更新(去掉"code graph"语义,改为知识库/数据/时间线)。
- **允许局部适配**:copy-assets 实现方式(inline `node -e` vs 独立 `.cjs` 文件,后者更可读,推荐)。
- **完成条件**:`npm run build` 产出 `dist/` + `dist/core/markdown/schema.sql` + `dist/core/timeline/schema.sql` + `dist/.claude-template/skills/`。
- **验证方式**:
  - `npm run build`(无错)
  - `ls dist/core/markdown/schema.sql dist/core/timeline/schema.sql dist/.claude-template/skills/`(都存在)
  - `ls dist/extraction 2>/dev/null`(应不存在)
- **风险/注意事项**:schema.sql 的 `__dirname` 解析路径(B-3/B-5 schema-bootstrap 与 dist 路径必须对齐,index 风险 1);copy-assets 脚本正确性。

---

### B-11: 端到端验收 + CHANGELOG breaking

- **目标**:整体验收 2.0 可用 + 标注 breaking change。
- **依赖**:B-1 ~ B-10 全部。
- **涉及范围**:`CHANGELOG.md`、整包验证。
- **必须严格执行**:
  - `npm run build` 成功。
  - `npm test` 全绿(markdown/dbquery/timeline 测试)。
  - 本地装包:`npm install -g .`(或 `npm link`),`cgraphx --version` 输出 `2.0.0`。
  - 在干净的临时项目逐项验证:
    - `cgraphx init` → 创建 `.cgraphx/cgraphx.db`,**无** nodes/edges/files 表
    - `cgraphx docs index`(放几篇 docs/knowledge/*.md)→ 成功;`cgraphx docs concepts` 有返回
    - `cgraphx db profiles` → 提示 init 或列出 profile
    - `cgraphx timeline install` + 模拟 hook → `cgraphx timeline recent` 有事件
    - `cgraphx status` → 显示 markdown/timeline/dbquery 三块状态
    - `cgraphx install` → 部署 `.claude/{skills,...}` + 注册 timeline hooks + **不**写 `.mcp.json`
    - `cgraphx upgrade --help` → 可用
  - **砍除验证**(都应报 unknown command 或不存在):`cgraphx explore`、`cgraphx callers <sym>`、`cgraphx index`、`cgraphx sync`、`cgraphx serve`、`cgraphx telemetry`。
  - `CHANGELOG.md`:新增 `## 2.0.0` 条目,显式标 **BREAKING**:砍代码图谱(列出消失命令 explore/query/node/callers/callees/affected/index/sync/search)、砍 MCP server(列出消失的 codegraph_explore 等 MCP 工具)、砍 telemetry;提示 1.x 残留图谱表不再读写。
- **允许局部适配**:CHANGELOG 措辞;验收临时项目的具体操作脚本。
- **完成条件**:以上全过;CHANGELOG 2.0.0 条目就位。
- **验证方式**:实际执行上述命令清单(逐条记录输出);`cgraphx --version` = 2.0.0。
- **风险/注意事项**:端到端集成(schema 路径、bin 注册、install 部署、Node 22.5);发现的问题回溯对应任务修复。
