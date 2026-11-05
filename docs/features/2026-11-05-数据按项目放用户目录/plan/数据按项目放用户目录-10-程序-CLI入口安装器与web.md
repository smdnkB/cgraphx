# T-10 程序:CLI 入口、安装器与 web

> 产物: plan
> 依据: spec@4d4bf55

- 目标:CLI 注册 `cgraphx project`,删掉「副本关联的主项目不在了」的提示;install 只给本地库建知识库表,装完 hook 后按需问名字、把旧库并进用户目录,再生成 db-query 模板;uninstall 只卸这个目录,删本地 `.cgraphx/` 前先并没并过的旧数据,同一仓库还有装着的目录就留 git 钩子;web 启动预检分本地库和项目库,项目库不在时时间线、任务页按没有数据显示。
- 对应 spec 编号:D8(删提示)、D16、D17(注册)、D25、D31;F4、F5 图 1;K2、K8、K13
- 强制引用:`docs/guides/coding-standards.md`、`docs/guides/interface-standards.md`
- 涉及范围:
  - `src/cli/index.ts`、`src/cli/installer/index.ts`、`src/cli/installer/agent-steps.ts`
  - `src/web/bootstrap.ts`、`src/web/pages-timeline.ts`、`src/web/pages-tasks.ts`
  - 既有测试:`__tests__/cli/installer/` 下的(被本任务弄红时);`__tests__/web/server.test.ts`、`knowledge-overview.test.ts`、`knowledge-detail.test.ts`(它们的夹具用 `getDatabasePath` 建库,T-1 改成 `string | null` 后就会坏,一律由本任务修)
- 必须严格执行:
  - 用到 project 门面 C-12(T-9 本步实现,照签名调用,不等 T-9)、timeline C-8 的 `UninstallReport.gitHookKeptFor`、基础层 C-1、C-2、C-5;文案按 C-14
  - `src/cli/index.ts`:从 `'../core/project/cli'` import `registerProjectCommands`,在 `registerReleaseCommands(program)` 之后调用;删掉 `warnIfMainRootMissing` 函数、它的调用和 `resolveDataDir` 的 import
  - install(`runInstallerWithOptions`)的顺序固定为:① 写各 agent 配置(不变)② `ensureProjectInitialized` ③ `dropLegacyGraphTables` ④ 选子系统(提示文案见具体要求)⑤ docs 索引 ⑥ timeline 等 hook ⑦ 问名字、并旧数据 ⑧ db-query 模板。第 ⑦ 步在 `initOutcome !== 'skipped-unsafe'` 时总做,不受子系统勾选影响
  - `ensureProjectInitialized(projectRoot)`:已装 → `'already'`;危险根 → `'skipped-unsafe'`;否则 `createDirectory`,打开 `getLocalDatabasePath(projectRoot)` 只应用 markdown schema(D8:timeline、task、sync 的表建在项目库,本地库里有了它们会被当成旧库)→ `'initialized'`;成功提示 `已初始化 <.cgraphx 路径>(知识库)`
  - 第 ⑦ 步:`plan = planInstallName(projectRoot)`;`plan.needsName` 时,`-y` 用 `plan.defaultName`,交互用 `clack.text`(message `项目名称(这个项目按名字认,同名的目录记进同一个项目)`,`initialValue` 为默认名,`validate` 用 C-1 `validateProjectName`,不过时返回 reason);取消 → `clack.cancel('安装已取消。')` 后 `process.exit(0)`;`applyInstallName` 的 `notice` 非 null → `clack.log.info(notice)`;抛错 → `clack.log.warn` 后继续。然后:`hasUnmergedLegacyData(projectRoot)` 为真时开 spinner(`把这个目录的旧数据并进用户目录…`)再调 `mergeLegacyData`,否则直接调;结果 `merged` → `clack.log.success(M1)`,`notices` 逐条 `clack.log.warn`;`already` → `clack.log.info(M4)`;`nothing` → 不输出;`failed` → `clack.log.warn(M3)`。install 其余步骤照常(D30)
  - `installAgentHooks`(agent-steps.ts):删掉「已初始化项目先打开库应用 task schema」那段(`openTaskDb(projectRoot).close()` 及 `taskSchemaReady`);项目库的三套 schema 由第 ⑦ 步建
  - uninstall(`runUninstaller`),彻底卸载(没给 `-t`)时顺序:① 各 agent 清扫与 hook 卸载(不变;`uninstallAgentHooks` 返回各 agent 报告里第一个非空的 `gitHookKeptFor`)② 版本分支提交拦截:`listOtherInstalledDirs(process.cwd())` 为空才 `removeReleaseGuard`,非空不动 ③ 本地 `.cgraphx/` 在且没给 `--keep-data` 时:`hasUnmergedLegacyData` 为真 → 先 `mergeLegacyData`;`failed` → `clack.log.warn(M3)` 并 `clack.log.warn('保留 <.cgraphx 路径>:旧数据没并过去,删了会丢;按提示处理后再卸载')`,不删 ④ 删本地 `.cgraphx/` 之前(第 ③ 步并完以后)取 `loc = locateData(process.cwd())`,记下 `projectDirName` 与显示名——删掉本地 `.cgraphx/` 以后这个目录可能就认不出了,并之前取又还是旧库模式、拿不到项目目录;然后照 M11 确认(`-y` 不问)后 `removeDirectory`;`--keep-data` 或本地 `.cgraphx/` 不在时也在这一步取 `loc` ⑤ 收尾:`gitHookKeptFor` 非空 → M13;为空 → M12(项目目录不在时不打)
  - `--keep-data` 的说明改成 `Keep this directory's .cgraphx/ (knowledge index and my-features); project data in ~/.cgraphx/projects/ is never removed by uninstall`;`-y` 的说明里「also deletes .cgraphx/ without confirming」保留
  - 部分卸载(`-t`)行为不变
  - web(D16)`openVerifiedConnection(projectRoot)`:① `isInitialized` 先于 open(不变)② 开本地库(`getLocalDatabasePath`)查 markdown schema ③ `loc = locateData(resolved)`:legacy → 本地库就是数据库,在同一个连接里再查 timeline schema;project 且 `getDatabasePath(resolved)` 非 null 而且文件在 → 先查存在再 `DatabaseConnection.open`,只查 timeline schema,查完关掉;其余(项目库不在)→ 不查、不报错;缺 schema 时照现在抛 `schema-missing`(修复提示:markdown 缺 → `cgraphx docs index <根>`,timeline 缺 → `cgraphx install`)④ 返回本地库连接。删掉 `resolveDataDir` 的 import 与副本分支
  - 页面:`pages-timeline.ts` 渲染前看 `getDatabasePath(projectRoot)`,为 null 或文件不在 → 不调 timeline 门面,按 0 条事件组装(概况条全 0、列表空、筛选计数 0);`pages-tasks.ts` 同样判断:列表页按 0 个任务渲染,详情页按「没有这个任务」处理(和现在查不到任务一样);`TaskNotEnabledError` 的处理不变
  - web 只读:不调 `ensureDataDir`、不建目录、不写任何文件
- 允许局部适配:
  - spinner 与日志的排版;`uninstallAgentHooks` 返回值的形状
  - 页面空态复用现有组装函数还是另写空模型
- 具体要求:
  1. `src/cli/index.ts`:按「必须严格执行」
  2. `src/cli/installer/index.ts`:按「必须严格执行」;第 ④ 步多选里 db 那一项的 hint 改成 `生成 db-profiles.json 模板(在项目数据目录)`;第 ⑧ 步 `initDbProfiles` 的调用与提示照旧(路径已由 T-5 按数据位置算);卸载的确认文案改成 M11(删掉原来按 own / 副本分的两种说法)
  3. `src/cli/installer/agent-steps.ts`:按「必须严格执行」;`uninstallAgentHooks` 在 timeline 报告 `gitHookKeptFor` 非空时不打「已移除 git post-commit hook」
  4. `src/web/bootstrap.ts`、`pages-timeline.ts`、`pages-tasks.ts`:按「必须严格执行」;`bootstrap.ts` 文件头注释改写成「知识库读本地库;时间线、任务读项目库(旧库模式下两者是同一个文件)」
  5. 既有测试:`ensureProjectInitialized` 相关断言改成本地库只有 markdown schema;web 三个测试的夹具里 `getDatabasePath(projectRoot)` 一律换成 `getLocalDatabasePath(projectRoot)`;要时间线数据的临时项目,让本地库带 timeline 表(旧库模式,数据位置就是本地库)。`server.test.ts` 里「缺 timeline schema → 启动报错」的用例改成新口径:本地库没有 timeline 等表就是项目库模式,项目库不在 → 不报错;要测报错,在临时 HOME 下建出项目库(`ensureProjectDir` + 空库,不建 timeline 表)再启动,断言 `schema-missing` 且提示 `cgraphx install`;其余断言意图不变
- 完成条件:
  - `grep -rn "warnIfMainRootMissing\|resolveDataDir" src/cli src/web` 无输出
  - `grep -n "registerProjectCommands" src/cli/index.ts` 有两处命中(import 与调用)
  - `grep -n "ensureTimelineSchema\|ensureTaskSchema" src/cli/installer/index.ts` 无输出
  - `grep -n "openTaskDb" src/cli/installer/agent-steps.ts` 无输出
  - `grep -n "ensureDataDir" src/web` 无输出
- 提交点:
  1. `feat(installer): install 并旧数据进用户目录——本地库只建知识库表,按需问项目名称`:`src/cli/installer/index.ts`(install 部分与 uninstall 部分写在同一个文件,一并提交)、`src/cli/installer/agent-steps.ts`、`src/cli/index.ts`,以及改过的 `__tests__/cli/installer/` 测试
  2. `feat(web): 启动预检分本地库与项目库——项目库不在时时间线、任务页按没有数据显示`:`src/web/bootstrap.ts`、`src/web/pages-timeline.ts`、`src/web/pages-tasks.ts`,以及改过的 `__tests__/web/` 测试
- 风险/注意事项:
  - 第 ⑦ 步必须在第 ⑧ 步(db-query 模板)之前:模板写进数据位置会先写上并过记号,之后再并就成了「已经并过」
  - 卸载时 `locateData` 要在并完旧数据之后、删本地 `.cgraphx/` 之前取:早了拿不到项目目录(还是旧库模式),晚了这个目录可能就没有根了
  - 不在本仓库里跑 `node dist/cli/index.js install`:本仓库是副本,跑了会把真实数据写进真实家目录(统一验证在临时 HOME 下做)
