# T-8: 程序——CLI 入口与 web

> 产物: plan
> 依据: spec@68ac94e

- 目标:注册 `replica`、`release` 两组命令;副本的主目录不在时给提示;`cgraphx install` 在钩子没写入、钩子目录被 git 跟踪时给提示;`cgraphx uninstall` 卸掉提交拦截、在副本里说清只删副本自己的数据;web 在副本里知识库用本地库,启动预检查主目录的数据
- 对应 spec 编号:D1(注册命令)、D12(卸载时删拦截)、D24(web 的库)、D31、D33(安装时的提示);全局约束(副本里 uninstall 只删副本自己的)
- 强制引用:`docs/guides/coding-standards.md`、`docs/guides/interface-standards.md`
- 涉及范围:
  - `src/cli/index.ts`
  - `src/cli/installer/index.ts`
  - `src/cli/installer/agent-steps.ts`
  - `src/web/bootstrap.ts`
- 必须严格执行:
  - 按 C-1(`resolveDataDir`、`getDatabasePath`、`getLocalDatabasePath`)、C-5(`registerReplicaCommands` 来自 `../core/replica/cli`)、C-6(`registerReleaseCommands` 来自 `../core/release/cli`,`removeReleaseGuard` 来自 `../core/release`)、C-7(`InstallReport.gitHooks` 与安装提示原文)、C-12(D31 提示原文)
  - web 只读契约不变:不创建库文件、不应用 schema、除启动预检外只有 SELECT
  - `src/web/server.ts` 不改:它的 `ctx.db` 只给知识库查询用(详情页、系统地图、任务详情页里的 `MarkdownQuery`、总览),时间线和任务数据由各页面经 timeline、task 门面自己开库,C-1 已让它们走数据目录
- 允许局部适配:
  - bootstrap 内部辅助函数的拆分与命名
  - 提示判断放在 `main()` 里的具体位置
  - 安装成功那行的措辞;注释与提示措辞(C-7、C-12 原文除外)
- 具体要求:
  1. `src/cli/index.ts`:
     - 照 `registerTaskCommands` 等的写法 import 并调用 `registerReplicaCommands(program)`、`registerReleaseCommands(program)`
     - D31:有子命令参数、且 `process.argv[2]` 不以 `-hook` 结尾、也不是 `sync-worker`(隐藏的后台命令,输出没人看)时,在解析命令前取 `resolveDataDir(resolveProjectRoot(process.cwd()))`;`state === 'main-missing'` → stderr 输出 `[cgraphx] 副本关联的主项目不在 <mainRoot> 了`,命令照常执行;不带参数的交互安装器入口不做这个判断
  2. `src/cli/installer/index.ts` 的卸载:
     - 不带 `-t`(彻底卸载)时,在移除 agent hook 之后调 `removeReleaseGuard(process.cwd())`;状态为 `removed` 时打一行「已移除版本分支提交拦截:<hookPath>」
     - 删 `.cgraphx/` 的确认:`resolveDataDir(process.cwd()).state` 不是 `own` 时,确认文案改成「删除 <dir>?这是副本:只删副本自己的知识库索引和「我的需求」索引,主目录的数据不受影响。」;删除仍走 `removeDirectory`(不跟随链接)
  3. `src/cli/installer/agent-steps.ts`(现在第 132~138 行打印 timeline 的安装报告):
     - 成功那行的 git 部分改按 `report.gitHooks` 写:有 status 为 `installed` / `updated` 的 → ` + git <这些钩子名用 / 连起来>`;全是 `present` → `(git hook 已存在)`;`gitHooks` 为空 → `(非 git 仓库,跳过 git hook)`
     - 之后按 C-7 的安装提示,`unsupported` 的每个钩子 `clack.log.warn(<prefix> + 原文)`;有 `hooksDirTracked` 为 true 的 → `clack.log.warn(<prefix> + 原文)` 一行
  4. `src/web/bootstrap.ts` 的 `openVerifiedConnection`(返回类型、函数名不变,返回的是给 `ctx.db` 用的知识库连接):
     - 第 1 步存在性预检照旧(`isInitialized`,看本地库)
     - 第 2 步:`getLocalDatabasePath(resolved) === getDatabasePath(resolved)`(主目录)→ 与现在完全相同:开这一个库,一条 SELECT 查两张 schema 版本表
     - 否则(在副本里):数据目录的库(`getDatabasePath`)不存在 → 抛 `WebStartupError('uninitialized', …)`,message 用 C-12 的 D31 原文(主目录路径取 `resolveDataDir(resolved).mainRoot`),不 open;存在 → 开它只查 `timeline_schema_versions`,查完关掉;再开本地库(`getLocalDatabasePath`)查 `markdown_schema_versions`,作为返回的连接
     - 任一 schema 缺失照旧抛 `schema-missing`(`missing` 列出缺的那几个),抛之前关掉已开的连接
- 完成条件:
  - 在主目录起 web,打开的库、执行的 SQL、各页面与改动前相同
  - 在主目录已挪走的副本里起 web,报 D31 原文,旧主目录位置没有被建出 `.cgraphx/`
  - `cgraphx --help` 列出 `replica`、`release` 两组命令
  - 每个改动的文件 ≤ 600 行
- 提交点:
  1. `feat: 接入 replica、release 命令——卸载时移除拦截 + 主目录不在时提示 + 钩子没写入时提示`:`src/cli/index.ts`、`src/cli/installer/index.ts`、`src/cli/installer/agent-steps.ts`
  2. `feat(web): 副本里知识库用本地库——启动预检查主目录的数据`:`src/web/bootstrap.ts`
- 风险/注意事项:
  - `src/cli/index.ts` 是组合根,允许 import `src/core/*` 的 cli 模块;`src/core` 下的代码仍不得 import `src/cli`、`src/web`
  - 部分卸载(`-t`)保留 git 钩子,也就不删提交拦截
  - `DatabaseConnection.open` 会在库所在目录不存在时建目录:数据目录的库必须先查存在再开
