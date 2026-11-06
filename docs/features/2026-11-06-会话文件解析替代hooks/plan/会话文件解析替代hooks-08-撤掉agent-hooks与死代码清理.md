# T-8: 撤掉 agent hooks 与死代码清理(F5)

> 产物: plan
> 依据: spec@eac0b58

### 目标

install/uninstall 不再写 agent 配置里的采集与门禁 hook,清掉旧配置里的 7 条时间线 hook 与 precommit-check;timeline 的 hook 体系(处理函数、隐藏命令、轮次记录、会话登记)整体删除;门禁片段接入 install/uninstall。

### 对应 spec 编号

D17、D18、K21、K22、F5 行为链与图(①②③)、D19 影响面(死代码清单)

### 强制引用

`docs/guides/coding-standards.md`(契约部分)、`docs/guides/interface-standards.md`(命令面变化)

### 涉及范围(约 18 个文件,强耦合不拆——见下)

- `src/core/agents/types.ts`、`profiles.ts`、`index.ts`
- 删除 `src/core/timeline/hooks.ts`、`hook-runner.ts`、`payload.ts`、`turn-state.ts`、`src/core/session-registry.ts`
- `src/core/timeline/constants.ts`、`cli.ts`、`installer.ts`、`index.ts`、`store.ts`、`indexer.ts`
- `src/cli/legacy-hook-commands.ts`、`src/cli/index.ts`(无改动则不动)
- `src/core/user-data-dir.ts`、`src/core/project/index.ts`(头注释清理:`user-data-dir.ts` 目录树注释去掉 `sessions/ 会话登记` 行、删只有 session-registry 在用的 `sessionsRoot()`;`project/index.ts` 依赖清单注释去掉 session-registry——否则设计验收 13 的 grep 永远红)
- `src/cli/installer/index.ts`、`agent-steps.ts`、`targets/agent-target.ts`
- `assets/claude-template/deprecated-assets.json`、删除 `assets/claude-template/hooks/precommit-check/`
- `__tests__/core/timeline/` 下被弄红的既有用例(同步修正/删除)

> 不拆的原因:删 `HOOK_EVENTS_TO_COMMANDS`(constants)会立刻弄红 `timeline/installer.ts`(settings 写入循环)与 `cli.ts`(隐藏命令注册),而 installer 的重接(D18)又依赖死 hook 名单(agent-target)与门面导出变化——三处必须同一笔改完才能编译,找不到并行边界。

### 必须严格执行

- **兼容空命令(F5 ①)**:`legacy-hook-commands.ts` 的名单加 7 条——`timeline-session-start-hook`、`timeline-session-end-hook`、`timeline-user-prompt-hook`、`timeline-pre-tool-use-hook`、`timeline-post-tool-use-hook`、`timeline-stop-hook`、`timeline-post-tool-use-failure-hook`(行为同现有五条:读完 stdin、退出码 0);`timeline-git-commit-hook` 保留在 timeline/cli.ts。
- **死 hook 清理(K21)**:`agent-target.ts` 的 `REMOVED_FEATURE_HOOK_COMMANDS`/`isDeadHookCommand` 按完整子命令名加上面 7 条(`cgraphx timeline-<…>`,带不带 `--agent`/容错后缀都认),并认子串 `/hooks/precommit-check/precommit-check.cjs`;被移除时 notes 回传 F5 图的原文「时间线和提交门禁改走会话文件和 git 钩子:已移除 hooks(<事件名/连>)」;`writePrecommitHookEntry` 删掉(不再写 precommit-check);`isCgraphxHookCommand` 保留对 precommitCheck 字符串的识别(卸载旧配置仍要精确删)。
- **timeline 侧删除**:`hooks.ts`、`hook-runner.ts`、`payload.ts`、`turn-state.ts`、`session-registry.ts` 删;`constants.ts` 删 `HOOK_EVENTS_TO_COMMANDS`、`HookEventEntry`、`HookEventName`、`LEGACY_BINARY_TOLERANT_SUFFIX`、`WRITE_TOOLS_WHITELIST`,以及 `TASK_TOOLS`(实测无调用方的死常量;`READ_FILE_TOOLS` / `WRITE_FILE_TOOLS` 是 stats 在用,留);`assertEventType` 从 payload.ts 挪进 `timeline/cli.ts`(`--type` 校验还在用);`store.getMostRecentPre`、`indexer.getMostRecentPre` 删(C-10);`timeline/index.ts` 门面相应清理(`TURNS_DIRNAME`、`EventEnricher` 如仍被 recorder 签名引用则保留类型、删导出酌情);`timeline/cli.ts` 删 7 条隐藏命令注册与 `HOOK_HANDLERS`,`install` 描述改为「装提交记录片段」。
- **`timeline/installer.ts` 重写(D18)**:`installTimelineHooks` 不再读写 settings 的 hooks(片段部分照旧:post-commit / post-merge + 碎片清理 `cleanDebrisCgraphxDirs`);`uninstallTimelineHooks` 不再碰 settings(git 片段删除、`gitHookKeptFor`(`listOtherInstalledDirs`)逻辑保留);`InstallReport` / `UninstallReport` 字段精简(去 `writtenHookEvents` / `skipped` / `removedHookEvents`);`LEGACY_TURN_STATE_FILENAME` 引用删。
- **install / uninstall 接线(D18、K22、F5 ②③)**:
  - `agent-steps.ts` 的 `installAgentHooks` 拆开:Developer Timeline 勾选时只装提交记录片段(经 `installTimelineHooks`,与 agent 无关,装一次);**门禁片段**(commit-gate 门面 `installCommitGate`)install 选了 agent 就装、不看勾选,片段没写入时按 F5 ③ 输出警告(`hookNotice` 的原因原文,被跟踪的钩子给出要加的几行);彻底卸载时 `removeCommitGate`(同一仓库还有装着的目录时留着,判断同 `gitHookKeptFor`)。
  - `cli/installer/index.ts` 的勾选提示文案更新(Timeline 项的 hint 改「git 提交记录片段」)。
- **agents 描述(D17 影响面)**:`capabilities.postToolUseFailure` 与 `writeTools` 删(没人用了);`agents/index.ts` 删 `resolveHookAgent`、`hookCommand`(仅 timeline hook 链路在用);`CGRAPHX_HOOK_MARKERS` 不动(isAgentInstalled 对旧装法的识别仍靠它)。
- **废弃清单**:`deprecated-assets.json` 的 `paths` 加 `hooks/precommit-check`;删 `assets/claude-template/hooks/precommit-check/` 目录。
- 既有测试:被上述删除弄红的用例同步删除/修正(hooks、hook-runner、payload、turn-state、session-registry、installer 的 settings 断言、store.getMostRecentPre);**不新增测试**。

### 允许局部适配

- `installTimelineHooks` 精简后的报告形状与日志文案;agent-steps 里门禁片段的日志行措辞。
- `timeline/index.ts` 门面导出的取舍(以「外部还有调用方的必须留、没有的删」为准,编译器兜底)。

### 具体要求

1. 按上述五块顺序改:timeline 删除 → installer 重写 → cli 空命令与注册清理 → agent-target 死 hook → install/uninstall 接线;每块改完保持可编译。
2. `grep -rn "session-registry\|turn-state" src/` 无输出;`grep -n "HOOK_EVENTS_TO_COMMANDS" src/` 无输出。
3. 全量 `npm test` 通过。

### 完成条件

- `npm run build`、`npm test` 通过。
- 手工冒烟(spec 设计验收 10,行为口径):
  - 造一份带 7 条时间线 hook + precommit-check 的旧 settings.json,`cgraphx install -y` 后条目被清、输出「时间线和提交门禁改走会话文件和 git 钩子:已移除 hooks(…)」,agent 再触发旧 hook 显示空命令不报错;
  - 不勾 Developer Timeline 重装:旧 hook 照清、门禁片段照装;
  - 清完 hook 的项目 `isAgentInstalled` 仍为真(靠指引块兜底);
  - `cgraphx uninstall`:门禁片段与提交记录片段按「同一仓库还有装着的目录」判断去留。

### 提交点

1. `refactor(timeline): 撤掉 7 条 agent hook——处理函数/隐藏命令/轮次记录/会话登记删除,留空命令兼容`:timeline 删除五文件、constants、cli、store、indexer、legacy-hook-commands
2. `refactor(installer): 装卸只走 git 钩子——死 hook 清理加 7 条、门禁片段接 install/uninstall`:agent-target、agent-steps、installer/index、timeline/installer、agents 三文件、deprecated-assets.json、assets 删除、测试修正

### 风险/注意事项

- 本任务必须在 T-3/T-4/T-6/T-7 之后:删掉的提示、补录、提交链路全部已有替代。
- `merge-files.ts` 在 T-4 已把 `TURNS_DIRNAME` 解耦;若还有残留 import 一并清理。
- 别动 `debris.ts`(碎片清理仍用)、`git-commit.ts`(T-6 已改好)、`recorder.ts`(git_commit 记录仍用;`enricher` 参数没人传了,保留签名)。
- 卸载语义不变:只卸这个目录;`--keep-data`、`-t` 部分卸载的行为照旧。
