---
title: agent 适配
document_type: mechanism
domains:
  - 安装接入
concepts:
  - agent 适配
aliases:
  - 多 agent
  - AgentProfile
  - agent 描述
  - CodeBuddy 接入
  - --agent
  - 接新 agent
tags:
  - installer
  - timeline
  - ingest
  - claude-code
  - codebuddy
status: active
source_type: work_context
owners:
  - liulongfei
related_code:
  - src/core/agents/index.ts
  - src/core/agents/profiles.ts
  - src/core/agents/types.ts
  - src/core/timeline/ingest/claude-transcript.ts
  - src/core/timeline/ingest/codebuddy-transcript.ts
  - src/core/timeline/ingest/reader.ts
  - src/cli/installer/targets/agent-target.ts
  - src/cli/installer/agent-steps.ts
  - src/cli/installer/claude-assets.ts
  - src/core/timeline/schema-bootstrap.ts
related_documents:
  - docs/knowledge/开发时间线工具事件契约.md
  - docs/knowledge/会话id来源约束.md
  - docs/features/2026-11-06-会话文件解析替代hooks/会话文件解析替代hooks-spec.md
created: 2026-10-15
updated: 2026-11-06
---

# agent 适配

## Summary

cgraphx 可以装给多个 AI 编码 agent,目前是 Claude Code(`claude-code`)和 CodeBuddy(`codebuddy`),同一项目里可以同时装。各 agent 的差异只集中在一处:`src/core/agents/` 的「agent 描述」(AgentProfile)。差异包括配置目录、指引文件、settings、项目根和会话 id 的环境变量、**会话文件根目录(`sessionsDir` + `sessionsDirEnv`)与读取器标识(`sessionReader`)**、命令名、能力开关、资产替换规则。timeline、安装器、门禁、会话提示都只经 agents 门面取值,不写死 `.claude`。

**接新 agent(比如以后的 WorkBuddy)= 在 `profiles.ts` 里加一份描述 + 在 `timeline/ingest/` 里加一个读取器**;描述字段说明它把会话文件放在哪、行内 sessionId 与时间戳长什么样,读取器把它的会话文件解析成统一「会话事实」(`ingest/types.ts`,只产事实不碰库)。**不再需要支持 hook**:7 条 agent hook(含 precommit-check)已随「会话文件解析替代 hooks」删除,时间线采集、提交门禁、会话提示都不再往 agent 配置里写 hook。CodeBuddy 就是按这条约束接入的:描述 + `codebuddy-transcript` 读取器。

## Context

2026-10-15 的多 agent 适配需求把原先只服务 Claude Code 的安装器、timeline 改造成按 agent 描述工作,并接入了 CodeBuddy。2026-11-06 的「会话文件解析替代 hooks」需求删掉全部 agent hook,采集改为解析会话文件,agent 差异里删掉 `postToolUseFailure` / `writeTools`(消费方已不存在),加进 `sessionsDir` / `sessionsDirEnv` / `sessionReader`。完整契约见各需求 spec。

## Findings

- **agent 描述是唯一差异来源。** 门面 `src/core/agents/index.ts` 对外提供以下能力:
  - 按 id 或别名查描述,`claude` 是 `claude-code` 的别名;
  - 取会话文件根目录 `agentSessionsRoot`(`sessionsDirEnv` 的环境变量设了非空就以它为根拼 `sessionsDir`,否则家目录拼;`sessionsDir` 为 null 时返回 null——Claude Code 的 `CLAUDE_CONFIG_DIR` 优先就是这么生效的);
  - 从环境变量取会话 id(`resolveSessionIdFromEnv`,按登记顺序取第一个非空值);
  - 解析 `-t` 列表;
  - 按「已装 / 检测到」两种口径判断 agent 状态。
  agents 模块不依赖任何其它子系统。
- **「已装」和「检测到」是两个口径。**
  - 「已装」:该 agent 的 settings 里有 cgraphx 写入的条目(statusLine / context-monitor),或者指引文件里有 cgraphx 块标记。hook 退役后 settings 里不再有 hook 条目;一个都没装时只作用于 Claude Code。
  - 「检测到」:项目里有该 agent 的配置目录,或者 PATH 上有它的命令。这个口径只用来决定交互安装时默认勾选哪些 agent。
- **git 钩子(post-commit / post-merge 提交记录、commit-msg 门禁)属于项目,不属于某个 agent。** 每个项目只写一份;门禁片段会话变量名单取全部 agent 描述的 `sessionIdEnv`。`uninstall -t <agent>` 不删它们,也不删 `.cgraphx/`。
- **timeline 事件带来源 agent。** `timeline_events.agent` 列从 schema v2 开始有;旧库第一次被打开时补列,存量数据回填为 `claude-code`。解析事件的 `source_key` 前缀也带 agent id。
- **资产按 agent 部署。**
  - claude-code 逐字节拷贝。
  - 其它 agent 按描述里的替换规则改写文本里的路径和变量名,比如 `.claude/` 改成 `.codebuddy/`。
  - 不支持的能力不部署,比如 CodeBuddy 没有 statusLine(claude-hud)和 context-monitor。
- **两家会话文件格式完全不同**(实测核对结论见「开发时间线工具事件契约」的格式差异节)。概要:CodeBuddy 只有六种行类型、epoch 毫秒时间戳、usage 行即轮次结束、子 agent 文件行内是独立子会话编号(按 `subagents/` 目录布局归主会话)、skipRun=true 不算提问;Claude Code 行类型 20 多种、ISO 时间戳、`end_turn` 行即轮次结束、子 agent 文件行内就是主会话编号、子 agent 交回 user 行带 `Another Claude session sent a message:` 前缀且 isMeta、queued_command 附件是排队未送达的提问。这正是「每家一个读取器」的原因。
- **hook 时代的同构结论已过时**:CodeBuddy 的 hook 事件名、stdin 字段曾与 Claude Code 一致——hook 体系整体删除后这条不再相关,别再按它假设新 agent「hook 同构就能接」。

## Evidence

- 描述登记:`src/core/agents/profiles.ts`(claude-code 的取值即改造前的行为基线,改动会破坏零变化保证)。
- 会话文件根目录与读取器标识:`src/core/agents/index.ts`(`agentSessionsRoot`)、`src/core/agents/types.ts`(`sessionReader`,读取器标识经 `timeline/ingest/reader.ts` 分发)。
- 读取器:`src/core/timeline/ingest/claude-transcript.ts`、`codebuddy-transcript.ts`(只产事实,不打开任何库、不知道项目归属)。
- 通用安装 target:`src/cli/installer/targets/agent-target.ts`。按 agent 执行的编排步骤在 `src/cli/installer/agent-steps.ts`。
- 资产替换与能力过滤:`src/cli/installer/claude-assets.ts`。
- agent 列迁移:`src/core/timeline/schema-bootstrap.ts`(`ensureAgentColumn`)。
- 契约与实测记录:`docs/features/2026-10-15-多agent适配/`、`docs/features/2026-11-06-会话文件解析替代hooks/` 下的 spec 和 plan。

## Impact For Future Changes

- **不要在 timeline、门禁、安装器里写死 agent 名、目录或环境变量,一律经 agents 门面取。** 只要出现一处写死,「接新 agent 只改描述 + 加读取器」这条约束就破了。
- **改 Claude 侧的任何输出前,先确认零变化。** 验证方法:分别用新旧 dist 在空 git 仓库里跑 `install -y` 和 `uninstall -y`,对比 `.claude/`、git 钩子和 stdout。
- **timeline 的 schema 已是 v2。** 降级到旧版 cgraphx 时,旧版会因为版本检查拒开数据库。
- **接新 agent 前先实测它的会话文件**(布局、行类型、时间戳形态、会话编号、子 agent 归属),别照 Claude Code 的格式猜;读取器不认识的行按「跳过、不算错误」处理。

## Reuse Guidance

在这些场景下先看这份文档:

- 接入新 agent(加描述 + 加读取器);
- 排查某个 agent 的资产路径没替换、来源记错、会话文件没补录;
- 改动安装器、timeline 或门禁的按 agent 取值逻辑。

## Open Questions

- WorkBuddy 的目录和插件机制(据第三方资料使用 `.workbuddy/` 和插件市场)还没有核实,接入前先实测。
- Claude Code 子 agent 的 type 在 `.meta.json 里,读取器不读——subagent.type 只有 CodeBuddy 侧从行内取到。
