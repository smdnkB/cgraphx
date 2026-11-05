### T-1: 撤掉 web、sync、task 三个子系统与依赖处

> 产物: plan
> 依据: spec@1fedd36

- 目标: `cgraphx web` / `sync` / `task` 都变成 `error: unknown command`;`src/core/` 与 `src/cli/` 里不再有任何对 web、sync、task 的引用;构建与既有测试通过。并旧数据不再并 task/sync 表,会话开始的提示由时间线 hook 独自出。
- 对应 spec 编号: F1、D1;F2、D2、D7;F4、D9、D10;全局约束「`src/core/` 里不再有任何对 sync、task、web 的引用」。(执行者据此读 spec 原文,不凭任务转述猜)
- 强制引用: `docs/guides/coding-standards.md`、`docs/guides/interface-standards.md`(命令注册)
- 涉及范围:
  - 删除目录:`src/web/`(25 个文件,含 `public/`)、`src/core/sync/`(26 个文件,含 `schema.sql`)、`src/core/task/`(22 个文件,含 `schema.sql`)、`__tests__/web/`(3 个测试)、`__tests__/core/sync/`(1 个测试 `protocol-version.test.ts`)。task 无独立测试目录,确认后无需删测试。
  - 修改文件:`src/cli/index.ts`、`src/cli/installer/agent-steps.ts`、`src/cli/installer/index.ts`(仅注释)、`src/core/markdown/cli.ts`、`src/core/project/merge.ts`、`src/core/project/merge-files.ts`、`src/core/project/remove.ts`、`src/core/timeline/hooks.ts`、`src/core/skill-version/index.ts`、`src/core/skill-version/constants.ts`、`scripts/copy-assets.cjs`、`package.json`(连带 `package-lock.json`)。
  - 与同一步同时跑的任务(T-4 replica、T-5 assets、T-6 knowledge)不重叠。
- 必须严格执行:
  - **`src/cli/index.ts`**:删 `registerWebCommand` 的 import、注册(`registerWebCommand(program)`)和它上面那段「组合根例外(仅此一处)」注释;删 `registerTaskCommands`、`registerSyncCommands`、`readCachedProjectArtifactTypes` 的 import 与注册;`registerFeaturesCommands(program, { readProjectArtifactTypes: ... })` 改回不传第二参(T-3 会把签名收掉,这里只去掉注入)。
  - **`src/cli/installer/agent-steps.ts`**(D9 影响面):`installAgentHooks` 只装 timeline——删 `installTaskHooks`、`installSyncHooks` 的动态 import、try 块与两行成功输出(「开发任务绑定已装」「平台同步 hook 已装」);`uninstallAgentHooks` 只卸 timeline——删 `uninstallTaskHooks`、`uninstallSyncHooks` 的动态 import、try 块与输出;文件头注释与 `installAgentHooks` 头注释里「任务绑定与平台同步 hook」「timeline、task、sync 三套 schema」的说法改成只有 timeline 的说法。
  - **`src/cli/installer/index.ts`**:只改注释,不动逻辑——文件头「timeline 与任务绑定 hook 对每个选中 agent 接入」、`ensureProjectInitialized` 的 doc 注释里「timeline、task、sync 的表建在项目库」改为与事实一致(项目库只建 timeline 的表;本地旧库里的 `timeline_*`/`task_*`/`sync_*` 表都算「没并过的旧数据」这个判定不变)。D6 清理的调用是 T-2 的事,本任务不加。
  - **`src/core/markdown/cli.ts`**:按 C-7——删 `import { recordReferenceHit } from '../sync'` 与两处调用(`docs find` 处、`docs show` 处);`find` 与 `show` 的 `--session` 选项保留、照收(参数解析不动),帮助文字两处改成「已不起作用,只为兼容旧用法保留」。
  - **`src/core/project/merge.ts`**(D7):删 `import { ensureSyncSchema, mergeSyncTables } from '../sync'` 与 `import { ensureTaskSchema, mergeTaskTables } from '../task'`;`applyProjectSchemas` 只留 `ensureTimelineSchema`;`mergeTailLocked` 里删 `mergeTaskTables(...)` 调用与整个 `mergeSyncTables({...})` 调用块,`notices` 只剩 `mergeLegacyFiles` 的返回;`LEGACY_TABLES_SQL` 与 `hasUnmergedLegacyData` 的「还有没并过去的旧数据」判定**保持**含 `timeline_*`、`task_*`、`sync_*` 任一张表不变;`dropLegacyTables`(删旧表那一步)照旧删三类表、`childFirstOrder` 不动;文件头注释把「task、sync 的数据」「task 表、sync 表与平台连接」的描述改为:只并 timeline,task/sync 表不并、随删旧表一起删。
  - **`src/core/project/merge-files.ts`**:删 `import { TASK_SOURCE_CONFIG_FILENAME } from '../task'`,在文件内定义同值常量 `'task-source.json'`(值与命名不变);`BACKUP_FILENAMES` 照旧含它(备份照旧);`removeMergedLocalFiles` 照旧删它;开头注释「(`task-source.json` 归 sync 并)」改为「不再并入,残留由升级清理删」。
  - **`src/core/project/remove.ts`**(D7):删 `import { TASK_SOURCE_CONFIG_FILENAME } from '../task'`;`CONFIG_FILENAMES` 去掉该文件(项目目录里的残留 `task-source.json` 由升级清理删,预览不再列)。
  - **`src/core/timeline/hooks.ts`**(D10):按 C-6——`isAutoMemoryOff`、`autoMemoryOffContext` 与 `CLAUDE_LOCAL_SETTINGS_FILE` 常量从 `src/core/task/hooks.ts` 原样挪入(判断逻辑、限定只对 claude-code 生效、文案逐字不变);`sessionStartHook` 的提示数组改为 [skill 版本落后, 自动记忆去向, ...git 钩子补回提示],每条独立 try/catch;删 `skillVersionNoticeWithoutTaskHook` 包装,直接调 `skillVersion` 门面的 `skillVersionNotice`(保留原有的压缩后重开不出、版本比较逻辑);函数 doc 注释同步改(去掉「没接 task 会话开始 hook 时」「接了 task hook 时提示跟 task hook 走」的分支描述)。
  - **`src/core/skill-version/`**:`index.ts` 删 `hasTaskSessionStartHook` 整个函数(含 doc 注释),文件头注释里「task / timeline 的会话开始 hook」的调用方说法改为只有 timeline;`constants.ts` 删 `TASK_SESSION_START_COMMAND`;确认门面无该导出残留。
  - **`scripts/copy-assets.cjs`**:删 `src/core/task/schema.sql`、`src/core/sync/schema.sql` 两条 `copyFile` 与第 3 段 web public 拷贝(`src/web/public` → `dist/web/public`);文件头注释的拷贝清单同步收口;末尾 `console.log` 的说法同步。
  - **`package.json`**:dependencies 删 `markdown-it`,devDependencies(或 dependencies,以实际位置为准)删 `@types/markdown-it`;跑 `npm install` 让 `package-lock.json` 同步。
- 允许局部适配:
  - 挪入 timeline 的两个函数在 `hooks.ts` 内的位置与章节组织;
  - `merge-files.ts` 里替代常量的定义位置(文件内 const 或 `project/constants.ts`);
  - 注释措辞(在事实准确的前提下);
  - import 排序、无用的 type import 清理等顺带整理。
- 具体要求:
  - 删目录用 `git rm -r`(或删后确保 git status 干净);`src/web/` 下的 `errors.ts` 一起没了——全局约束确认「未初始化退出码 2」的 web 沿用说法只在本仓库 CLAUDE.md(T-7 改),代码里无其他引用即可。
  - `timeline/hooks.ts` 改完后,行为等价于 F4 的活动图:记会话开始事件 →(非压缩)skill 版本落后 →(claude-code 且关了自动记忆)记忆去向 → 按登记补 git 钩子片段 → 补不上的提示 → 有提示则合成一段 `additionalContext`(条与条空一行),没有则 stdout 为空。
  - `sessionEndHook` 的 doc 注释里「同时触发的 task、sync hook 还要读,7 天后由会话开始 hook 清理」改成与终态一致(只剩时间线的 hook)。
  - `npm test` 跑全量;若 `__tests__/cli/installer/dead-hook-cleanup.test.ts`、`__tests__/core/timeline/installer.test.ts`、`__tests__/core/features/scanner.test.ts`、`__tests__/core/markdown/facade.test.ts` 等因本任务变红,修到绿(它们不测被删功能本身,只可能因共享夹具/导出变化红)。
- 完成条件:
  - `npm run clean && npm run build` 干净构建通过(tsc 不清 dist,不清就查不出残留产物);`npm test` 全绿;
  - `node dist/cli/index.js web` / `sync` / `task` 均输出 `error: unknown command '<名>'` 且退出码 1;
  - `grep -rn "core/sync\|core/task\|from '\.\./web" src/` 无命中;`ls dist/web dist/core/sync dist/core/task` 均不存在;
  - `node -e "…markdown-it…"`(见 index 统一验证 ③)输出 `undefined undefined`;
  - `node dist/cli/index.js timeline-session-start-hook` 喂一段 `{"session_id":"x","cwd":"<本仓库>"}` 的 stdin,不报错、退出码 0(不验证提示内容,提示逻辑由后续测试流程覆盖)。
- 提交点:
  1. `refactor: 下掉 web、平台同步、开发任务子系统——cli 入口+并旧数据+会话开始提示一并收口`:上述全部删除与修改(含 `package.json`、`package-lock.json`、`scripts/copy-assets.cjs`)。body 列要点:三子系统删除、依赖处清单、markdown-it 出依赖。
- 风险/注意事项:
  - `merge.ts` 是并旧数据的关键路径,只删调用不改事务/锁/备份结构;判定口径(还有没有旧数据)保持含 task/sync 表——只剩 task/sync 表的旧库也要能被认出来并掉。
  - 本任务先于 T-2/T-3 落地;提交时允许 `features/cli.ts` 的 `FeaturesCommandDeps` 还在(默认空,不注入)。
  - 时间线 hook 每次会话都跑:挪入的自动记忆检查只是读一个 JSON 文件,不得引入任何会抛错未吞的路径。
