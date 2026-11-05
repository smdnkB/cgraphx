### T-2: 安装器升级清理(死 hook、清数据、兼容空命令)

> 产物: plan
> 依据: spec@1fedd36

- 目标: 已装过旧版的项目升级重装时:agent 配置里的上报/开发任务 hook 被当死 hook 删掉并提示一行;项目数据里的 13 张 `sync_*`/`task_*` 表与 4 个运行文件被删掉并提示一行;清理出错只警告、安装继续。没重装的项目触发旧 hook 时由五个隐藏空命令兜住,不报 unknown command。
- 对应 spec 编号: F3、D5、D6、D8、K2、K3;迁移与兼容表;输出原文表。(执行者据此读 spec 原文,不凭任务转述猜)
- 强制引用: `docs/guides/coding-standards.md`、`docs/guides/interface-standards.md`(「Hook 子命令契约」节)。data-standards 不适用(例外见 index「适用规范」:包内表不走全量/增量约定,spec 全局约束已记)。
- 涉及范围:
  - 修改:`src/cli/installer/targets/agent-target.ts`、`src/cli/installer/index.ts`、`src/cli/index.ts`(只加一行注册)、`src/core/project/index.ts`(门面导出;顺带把文件头注释里「与 timeline、task、sync、replica 的门面」改成终态——T-1 删了 task/sync,不再改此文件)。
  - 新增:`src/core/project/` 下一个清理模块(文件名自定,如 `cleanup.ts`);`src/cli/` 下一个隐藏空命令注册文件(文件名自定,如 `legacy-hook-commands.ts`)。
  - 前置:T-1 已完成(sync/task 子系统已删)。
  - 与同一步同时跑的任务(T-3 features、T-7 文档)不重叠。
- 必须严格执行:
  - **死 hook 扩展(D5)**:`agent-target.ts` 的 `isDeadHookCommand` 按 C-1 扩到八条(原三条 + 五条新子命令名;匹配规则按 C-1,禁止前缀匹配);`cleanupDeadHooks` 在删除时记下被删条目所属的 hook 事件名(事件 key 已在遍历中);install 与 uninstall 两个路径都走它(现状已如此,不改扫描时机、不看勾了哪些子系统)。
  - **死 hook 输出(D5)**:删掉的条目里有五条之一时,按 C-2 第 1 条原文输出(经 `WriteResult.notes` 回传,事件名去重、用 `/` 连);只删 1.x 三条(prompt-hook、mark-dirty、sync-if-dirty)时不出这行。uninstall 路径的 notes 目前不会被 `runUninstaller` 打印——把 notes 打印补上(改 `uninstallTargets` 汇聚或 `runUninstaller` 的反馈循环,取改动最小的方式)。
  - **清数据(D6)**:project 子系统新增清理模块,按 C-4 形态(门面导出、不打印、幂等、不抛);删除范围按 C-3(13 张表 `DROP TABLE IF EXISTS`、子表先删——排序照 `merge.ts` 的 `childFirstOrder` 逻辑,可复用或等价实现;4 个文件在数据位置目录与本地 `.cgraphx/` 两处删)。数据位置经基础层 `locateData`/`getDataDir` 与 `getDatabasePath` 认(与并旧数据同口径);目录/库不在就跳过该项。
  - **调用点**:`src/cli/installer/index.ts` 第 ⑦ 步 `settleProjectData(...)` 之后(仍在 `initOutcome !== 'skipped-unsafe'` 条件内)调用;删了东西 → `clack.log.success` 打 C-2 第 2 条;异常 → `clack.log.warn` 打 C-2 第 3 条,安装继续。
  - **五个隐藏空命令(D8)**:按 C-5——新文件注册五个命令(名字 = C-1 的五条),`{ hidden: true }`,`--agent <id>` 选项收下不解析,action 里把 stdin 读完到 EOF 后直接返回(无输出、无库/文件读写、退出码 0);在 `src/cli/index.ts` 的 `main()` 里与其他子系统注册并列处接入。
- 允许局部适配:
  - 新文件命名与内部组织(如五个命令共用一个工厂函数);
  - 清理模块的返回值形状(只要能区分「删了什么」「什么都没删」「出错」三态);
  - uninstall notes 打印的管道改法。
- 具体要求:
  - 清理模块对文件用「不在就算了」的删除(等价 `fs.rmSync(p, { force: true })`),对表用 `DROP TABLE IF EXISTS`,不因单项不存在报错。
  - 不做备份、不做交互确认(spec D6 已定;并旧数据的备份里有旧库整份)。
  - 五个空命令不读 `CGRAPHX_NO_TIMELINE` 之类开关——它们存在的唯一目的是「读到 EOF、不报错」。
  - `npm test` 全绿;若 `__tests__/cli/installer/dead-hook-cleanup.test.ts` 因新增五条变红或需扩断言,修到绿并补上五条的识别用例(带 `--agent`、带容错后缀、`cgraphx timeline-stop-hook` 不误删)。
- 完成条件:
  - `npm run build`、`npm test` 通过;
  - 五个空命令各跑一次 `node dist/cli/index.js <命令> --agent codebuddy </dev/null; echo $?` → 无输出、`0`;
  - 手工冒烟(临时 HOME,仿 `__tests__/setup-home.ts` 的做法,不写进仓库测试):造一个带 `cgraphx sync-stop-hook --agent codebuddy 2>/dev/null || true` 与 `cgraphx task-session-start-hook` 的 settings.json + 一个带 13 张表的库 + 4 个文件,跑 `node dist/cli/index.js install -y`,看到 C-2 第 1、2 条输出且表/文件被删;再跑一次,两条都不再出。
- 提交点:
  1. `feat(installer): 升级清掉已下掉功能——死 hook 五条+清 sync/task 数据+兼容空命令`:上述全部文件。body 列要点:匹配规则、13 表 4 文件、install 第 ⑦ 步之后调用、五个空命令。
- 风险/注意事项:
  - 升级前拉起的上报 worker 正在跑时可能把 `sync_*` 表建回来——下次 install 再清,不做进程查杀(spec D6 影响面已记)。
  - `agent-target.ts` 的 `isCgraphxHookCommand`(精确卸载用)**不**加这五条。spec D5 把已下掉命令的清理归进 `isDeadHookCommand` 这一条路(install/uninstall 都扫,单一入口);`isCgraphxHookCommand` 保持只认当前版本自己写的 hook 命令。
  - 死 hook 判定必须「完整子命令名」:写完用 `cgraphx timeline-stop-hook`、`cgraphx task-history` 之类的串自查不误删(C-1)。
