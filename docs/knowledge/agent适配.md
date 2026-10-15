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
tags:
  - installer
  - timeline
  - task
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
  - src/cli/installer/targets/agent-target.ts
  - src/cli/installer/agent-steps.ts
  - src/cli/installer/claude-assets.ts
  - src/core/timeline/schema-bootstrap.ts
related_documents:
  - docs/knowledge/会话id来源约束.md
  - docs/knowledge/开发任务绑定.md
  - docs/features/2026-10-15-多agent适配/多agent适配-spec.md
created: 2026-10-15
updated: 2026-10-15
---

# agent 适配

## Summary

cgraphx 可以装给多个 AI 编码 agent,目前是 Claude Code(`claude-code`)和 CodeBuddy(`codebuddy`),同一项目里可以同时装。各 agent 的差异只集中在一处:`src/core/agents/` 的「agent 描述」(AgentProfile)。差异包括配置目录、指引文件、settings、项目根和会话 id 的环境变量、写类工具、能力开关、资产替换规则。timeline、task、安装器都只经 agents 门面取值,不写死 `.claude`。

**新增一个 agent(比如以后的 WorkBuddy),只需要在 `profiles.ts` 里加一份描述**;hook 输入格式和已有 agent 不同时,再加转换。CodeBuddy 就是按这条约束接入的,代码改动只落在 `profiles.ts`。

hook 命令末尾的 `--agent <id>` 标明来源,不带就视为 Claude Code。所以 Claude 侧的 settings、资产、命令输出和多 agent 改造前逐字节一致。

## Context

2026-10-15 的多 agent 适配需求把原先只服务 Claude Code 的安装器、timeline、task 改造成按 agent 描述工作,并接入了 CodeBuddy。完整契约见需求 spec。

## Findings

- **agent 描述是唯一差异来源。** 门面 `src/core/agents/index.ts` 对外提供以下能力:
  - 按 id 或别名查描述,`claude` 是 `claude-code` 的别名;
  - 拼 hook 命令;
  - 从环境变量取会话 id;
  - 解析 `-t` 列表;
  - 按「已装 / 检测到」两种口径判断 agent 状态。
  agents 模块不依赖任何其它子系统。
- **「已装」和「检测到」是两个口径。**
  - 「已装」:该 agent 的 settings 里有 cgraphx 写入的 hook,或者指引文件里有 `CGRAPHX_START` 标记。`install -y`、`upgrade`、`timeline install` 只作用于已装的 agent,一个都没装时只作用于 Claude Code。
  - 「检测到」:项目里有该 agent 的配置目录,或者 PATH 上有它的命令。这个口径只用来决定交互安装时默认勾选哪些 agent。
- **git post-commit 钩子属于项目,不属于某个 agent。** 每个项目只写一份。`uninstall -t <agent>` 不删它,也不删 `.cgraphx/`。
- **timeline 事件带来源 agent。** `timeline_events.agent` 列从 schema v2 开始有。旧库在第一次被打开时补上这一列,存量数据回填为 `claude-code`。读取侧(各类输出和页面)不暴露这一列。
- **资产按 agent 部署。**
  - claude-code 逐字节拷贝。
  - 其它 agent 按描述里的替换规则改写文本里的路径和变量名,比如 `.claude/` 改成 `.codebuddy/`。
  - 不支持的能力不部署,比如 CodeBuddy 没有 statusLine(claude-hud)和 context-monitor。
- **CodeBuddy 与 Claude Code 同构。** 2026-10-15 在 CodeBuddy 2.167.0 实测:
  - hook 事件名、stdin 字段、settings 里 hooks 的结构、`hookSpecificOutput.additionalContext` 都与 Claude Code 一致;
  - 项目记忆可以放在 `.codebuddy/CODEBUDDY.md`;
  - 写类工具名与 Claude 相同,另有别名 `NotebookWrite`。

## Evidence

- 描述登记:`src/core/agents/profiles.ts`。
- 通用安装 target:`src/cli/installer/targets/agent-target.ts`。按 agent 执行的编排步骤在 `src/cli/installer/agent-steps.ts`。
- 资产替换与能力过滤:`src/cli/installer/claude-assets.ts`。
- agent 列迁移:`src/core/timeline/schema-bootstrap.ts`(`ensureAgentColumn`)。
- 契约与实测记录:`docs/features/2026-10-15-多agent适配/` 下的 spec 和 plan。

## Impact For Future Changes

- **不要在 timeline、task、安装器里写死 agent 名、目录或环境变量,一律经 agents 门面取。** 只要出现一处写死,「新增 agent 只改描述」这条约束就破了。
- **改 Claude 侧的任何输出前,先确认零变化。** 已部署项目的 settings 认的是不带 `--agent` 的命令。验证方法:分别用新旧 dist 在空 git 仓库里跑 `install -y` 和 `uninstall -y`,对比 `.claude/`、post-commit 钩子和 stdout。
- **timeline 的 schema 已是 v2。** 降级到旧版 cgraphx 时,旧版会因为版本检查拒开数据库,timeline 会静默停止记录。
- **只装了 CodeBuddy 的项目,卸载时 git 钩子的移除日志带的是「Claude Code」前缀。** 这是归属文案的小瑕疵,功能正确。

## Reuse Guidance

在这些场景下先看这份文档:
- 接入新 agent;
- 排查某个 agent 的 hook 不触发、来源记错、资产路径没替换;
- 改动安装器、timeline 或 task 的 hook 安装逻辑。

## Open Questions

- CodeBuddy 的写类工具别名 `NotebookWrite` 没有纳入任务自动绑定。如果需求目录里会编辑 notebook,需要补上。
- WorkBuddy 的目录和插件机制(据第三方资料使用 `.workbuddy/` 和插件市场)还没有核实,接入前先实测。
