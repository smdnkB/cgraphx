### T-7: 仓库文档(CLAUDE.md、CHANGELOG.md)

> 产物: plan
> 依据: spec@1fedd36

- 目标: 本仓库 CLAUDE.md 的自我描述与终态一致(无 web、sync、task 子系统);CHANGELOG 在 Unreleased 下记 2.0.14 去掉的能力。
- 对应 spec 编号: D1、D2、D9 影响面里的「CLAUDE.md 跟着改」;全局约束「CHANGELOG 写明去掉的命令和 skill」。(执行者据此读 spec 原文,不凭任务转述猜)
- 强制引用: `docs/guides/coding-standards.md`(文档无代码;守中文与事实准确)
- 涉及范围:
  - 修改:`CLAUDE.md`、`CHANGELOG.md`。
  - 前置:T-1、T-2、T-3、T-5 已完成(描述终态)。
  - 与同一步同时跑的任务(T-2、T-3)不重叠。
- 必须严格执行:
  - **`CHANGELOG.md`**:按 C-9——在现有 `## Unreleased` 节下追加一节(沿用该文件英文条目风格,标题形如 `### Removed — local web viewer, platform sync, and dev-task tracking`),写明:去掉的命令 `cgraphx web` / `cgraphx sync`(含隐藏 `sync-worker`)/ `cgraphx task`(体验:只报 unknown command);去掉的 skill `/dev-handoff` 与 task-history agent(install 清理已部署副本);install 时的升级清理(agent 配置死 hook、13 张 `sync_*`/`task_*` 表与运行文件、五个兼容空命令);`features check` 只认内置产物类型、「平台环节」改「需求环节」;spec 头部 `> 任务:` 不再读写;replica 一个需求只开一个副本;`/dev-end` 历时只留立项/完成/日历跨度;数据只留在本机。
  - **`CLAUDE.md`**(按落点逐条改,改完全文不得再有把 web/sync/task 当现状的说法):
    1. 「本仓库是什么」:工具清单去掉 web 浏览服务与 `task`(会话↔开发任务绑定)整句;`project` 的描述里「timeline、task、sync、replica 的门面」改「timeline、replica 的门面」;「`src/web/` 是 `cgraphx web` 本地只读浏览服务的实现……」整句删。
    2. 「易踩的坑」:「`src/web/`」相关与分层「cli 和 web 只依赖 core」——坑段里如有 web 专属条目删掉;分层说法统一成「cli 只依赖 core」。
    3. 「架构」:分层约定;命令注册列表去 `registerTaskCommands` / `registerSyncCommands` / web 门面;子系统形态段——sync、task 两个子系统的描述删,replica/task 依赖、`task → timeline / features` 依赖方向、「会话登记的读取方」只剩 timeline 的说法同步;「共享 DB」段——「timeline、task、sync 的表」改「timeline 的表」,「`markdown_*`、`timeline_*`、`task_*`、`sync_*`」前缀表列举收口,「未初始化退出码 2 的约定由 web 启动错误沿用」句删;「timeline」段七个 hook 不变,但其中提到 task/sync hook 同时触发的说法如有则收口;「安装器」段「接入 timeline 与 task hook」改「接入 timeline hook」。
    4. 「产品全貌」:「33 个 skill」改「32 个」;主线/平行支线/版本流程文字里 dev-handoff、平台上报、任务的说法收口(dev-merge 里「任务归属」讲法如有一并去掉)。
    5. 「我们解决什么问题」:如引用了 web/上报/任务作为卖点(如平台对接相关),删或改成「数据只在本机」的说法;第 7 条 timeline 自动记录保留。
    6. 全文检查 `grep -n "web\|sync\|task\|平台\|上报" CLAUDE.md`,逐条判断:讲历史的(如「2.0 是破坏性重构」)保留,讲现状的必须与终态一致。
- 允许局部适配:
  - 英文条目的行文组织;CLAUDE.md 各段改写后的行文(事实准确、风格一致即可)。
- 具体要求:
  - CHANGELOG 的 Unreleased 已有「data lives per project」一节——新节追加在其后,不改已有内容。
  - 不动 README.md、README.en.md、我们的流程解决的问题.md(spec 文档改动表未列)。
- 完成条件:
  - `CLAUDE.md` 与 `CHANGELOG.md` 改完;`grep` 自查通过(见上 6);`npm run build` 不受影响(纯文档)。
- 提交点:
  1. `docs: CLAUDE.md 去 web/sync/task——CHANGELOG 记 2.0.14 移除项`:两个文件。
- 风险/注意事项:
  - CLAUDE.md 是本仓库 Claude 的工作指引——改完以「新会话读到它不会去找 `cgraphx task` / web / sync」为验收标准;历史性描述(CHANGELOG、重构背景)不算违规。
