# 交接: timeline 区分自动消息

> 产物: handoff
> feature-id: 2026-10-31-timeline区分自动消息
> 负责人: liulongfei
> 日期: 2026-10-31
> 主任务: 本任务

## 本任务范围

- 修 timeline 把后台任务通知(`<task-notification>`)和子 agent 交回结果(`<agent-message>`)记成用户提问(`user_prompt`)的问题：这两类改记成新的事件类型 `auto_message`,本机库里已有的这类记录一并改过来
- 不含：平台协议加新事件类型(平台要区分时另开需求);`<system-reminder>` 开头的提问(全库 8 条，提醒后面都跟着真提问，照旧算提问)

## 已锁定决策

以下是 2026-10-31 在主目录会话里给出、用户认可的方案:

- 新增事件类型 `auto_message`,web 上显示「自动消息」;metadata 的 `source` 写 `task_notification` 或 `agent_message`。判定：提问文本去掉开头的空白后，以 `<task-notification>` 开头算后台任务通知，以 `<agent-message` 开头算子 agent 交回。
- 自动消息照样开启新的一轮(照旧生成、写入 turn_id),照样计入活跃时长和工作时长——收到通知后 agent 确实在干活;只是不再算用户提问。之后按 `user_prompt` 查到的就只有真正的提问,`/doc-report`、task-history 现在都按 `--type=user_prompt` 取提问，不用改就对了;web 上的会话标题也不会再被通知占掉。
- 本机库里已有的这类记录改过来，不升 timeline schema 版本号(升了，比它旧的全局 cgraphx 打开库会报错,hook 就不再记录)。
- 平台上报仍按 `user_prompt` 报：平台协议(`docs/features/2026-10-16-cgraphx接入研发管理平台/cgraphx接入研发管理平台-spec.md` §5.2)列的是固定 7 种类型，平台看到的和以前一样。
- 配套：类型清单、`cgraphx timeline query --type` 的帮助和校验、事件摘要、web 的标签和计数一起补;`assets/claude-template/skills/doc-report/SKILL.md` 补一句「`auto_message` 不是用户提的，统计提问时不算」;timeline 补测试。

## 共享背景

2026-10-31 核对 2.0.11 副本的数据采集时发现：副本里的提问、执行过的工具调用、提交和合并都记全了，但 timeline 把自动消息也记成了用户提问。2.0.11 的 7 个副本会话共 105 条 user_prompt,真正的提问只有 43 条，其余是 38 条后台任务通知、24 条子 agent 交回;全库以 `<task-notification>` 开头的 99 条、以 `<agent-message` 开头的 188 条(2026-10-14 起)。

探索时已核实(实现时不用重查):

- 记录:`src/core/timeline/hooks.ts` 的 `userPromptHook` 先生成 turn_id、写 turn 状态文件，再写 user_prompt 事件;宿主的 UserPromptSubmit 输入里没有来源字段，只能看文本开头判断。
- 类型清单散在这些地方:`src/core/timeline/types.ts` 的 `EventType`;`payload.ts` 的 `assertEventType`(`--type` 校验);`cli.ts` 的 `EVENT_TYPES_HELP`;`describe.ts` 的 `describeEvent`(switch);`store.ts` 按类型计数的 `byType`(写死 7 个键)和会话摘要(取最后一条 user_prompt)。
- schema:`schema-bootstrap.ts` 的 `ensureTimelineSchema` 每次 hook 都会调;库里记的版本高于 `TIMELINE_SCHEMA_VERSION` 就抛错。改历史记录要有便宜的「已改过」判断，并发参照同文件 `ensureAgentColumn` 的 BEGIN IMMEDIATE 写法。
- 全局 cgraphx 比仓库旧：本机 `/opt/homebrew/bin/cgraphx` 是 2.0.10,仓库是 2.0.11,hook 跑的是全局那个。旧版本会继续把自动消息记成 user_prompt,所以改历史记录不能只改一次了事，旧版本之后写进来的也要能改到(比如记下已经扫到的事件 id,每次只往后扫);全局 cgraphx 更新之前，新记录还是旧分类。
- 上报:`src/core/sync/payload.ts` 的 `toIngestEvent` 把 event_type 原样当 `type` 报给平台;`skillNameOf` 只从 user_prompt 里解析斜杠命令。
- web:`src/web/constants.ts` 的 `TIMELINE_EVENT_TYPES`(chip 只列 5 种)、`EVENT_TYPE_LABELS`、`EVENT_TYPE_CHIP_TONE`(都是 `Record<EventType, …>`);`timeline-event-rows.ts` 两处 switch;`pages-timeline.ts` 的 `todayByType` 写死键，会话标题取最后一条 user_prompt;`pages-tasks.ts` 取一轮里的 prompt。
- 投入时长(知识库「开发任务投入时长口径」)按归属的全部事件算，和事件类型无关，这次不受影响。
- 测试:`__tests__/core/timeline/` 下的 turn-id、stop-event、store、cli-format 都有 user_prompt 的用例可以参照。
- 另一个副本 `cgraphx@monthly-report迁移到流程中` 里 `assets/claude-template/skills/doc-report/SKILL.md` 有没提交的改动，两边合入时可能撞上;改 doc-report 那一句时留意。

## 下一步

`/dev-impl`
