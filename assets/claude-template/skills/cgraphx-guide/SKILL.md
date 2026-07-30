---
name: cgraphx-guide
description: cgraphx 应用整体使用指南 — 安装、项目接入、日常做需求的工作流(skill 串联)、agent 自动加载的上下文工具。Use when 用户问 cgraphx 怎么用/怎么安装/怎么接入项目/有哪些 skill/日常工作流/onboarding/新手入门/使用流程/安装步骤/skill 怎么配合/cgraphx 能干什么/cgraphx 和别的工具区别。问单个知识库/数据库/时间线工具怎么调走对应专责 skill(code-impact-api/db-query/developer-timeline),不是本 skill。
---

# cgraphx 应用使用指南

cgraphx 是本地优先的 AI agent 研发工具,把**markdown 知识库 + 数据库查询 + 开发时间线**打包给 AI agent 用。本 skill 是**整体使用导航**——用户问"怎么用 / 怎么装 / 日常工作流 / 有哪些 skill"时调这里。

视觉版介绍页(给人类用户看):`how-to-use.html`(本 skill 目录内,随 skill 分发,`cgraphx install` 时部署到项目 `.claude/skills/cgraphx-guide/`)。

## 何时用 / 不用本 skill

**用本 skill**:
- 用户问 cgraphx 怎么安装 / 怎么接入项目
- 用户问日常怎么用 / 有哪些 skill / 工作流
- 用户是新手要 onboarding
- 用户问 cgraphx 整体能干什么、和别的工具区别

**不要用本 skill**(走对应专责 skill):
- 查业务知识(`docs/knowledge/`)→ `code-impact-api` skill
- 查数据库 → `db-query` skill
- 生成开发时间线 / 日报 / 周报 → `developer-timeline` skill
- 写 PRD / spec / plan → 各自 skill
- 探索陌生项目建知识库 → `code-impact-init` skill
- 查代码结构 / 调用链 / 影响半径 → 用 `grep` / `Read` 等编辑器自带工具(2.0 起不再提供代码图谱)

本 skill 只做整体导航,不重复各 skill 的内部规范。

## 整体使用流程

| 阶段 | 命令 / skill |
|---|---|
| **机器级 · 每机器一次** | `npm install -g cgraphx` |
| **项目级 · 每项目一次** | `cgraphx install`(建 `.cgraphx/` 数据目录 + 部署 skills/commands 到 `.claude/` + 写 hooks/statusLine)、`/code-impact-init`(接手陌生项目时建业务知识库) |
| **日常做需求 · 必经 2 步** | `/clarify-requirements` 澄清 → `/implementation`(简单)或 `/subagent-implement`(复杂)实现 |
| **日常做需求 · 复杂按需** | `/write-prd`、`/write-spec`、`/write-plan`、`/code-impact-markdown`(沉淀到 `docs/knowledge/`) |
| **工作回顾 · 按需** | `/developer-timeline`(日/周/月报)、`/write-design-doc`(发布后合成设计文档) |
| **卸载 · 可选** | `cgraphx uninstall`(清项目 `.claude/` 内包自带的 skills/配置 + 删 `.cgraphx/`)、`npm uninstall -g cgraphx` |

## 各 skill 导航

### 用户主动触发(在 Claude Code 里敲 `/skill-name`)

| skill | 何时建议用户调 |
|---|---|
| `/clarify-requirements` | 接到模糊需求,先澄清意图、业务边界、技术边界 |
| `/write-prd` | 要给业务方 / 领导确认业务文档 |
| `/write-spec` | 写技术规格(归档业务行为 / 规则 / 接口 / 数据,作为 plan 的稳定输入) |
| `/write-plan` | 拆执行计划(给 agent 执行) |
| `/implementation` | 简单任务实现(主会话顺序做) |
| `/subagent-implement` | 复杂多任务实现(派子 agent,隔离上下文) |
| `/code-impact-init` | 接手陌生项目,派子 agent 自动探索、建业务知识库 |
| `/code-impact-markdown` | 把业务决策 / 概念沉淀成 md 到 `docs/knowledge/` |
| `/write-design-doc` | 发布后按需,从知识库合成面向人类阅读的设计文档(HTML 或 Markdown) |
| `/developer-timeline` | 生成日报 / 周报 / 月报 / 阶段总结 / 交付汇报 |

### agent 自动调用(用户不主动敲,agent 用来加载项目上下文)

| skill / 工具 | agent 何时自动调 |
|---|---|
| `code-impact-api` | 任务开始时查 `docs/knowledge/` 业务决策 / 概念 / 历史教训 |
| `db-query` | 验证数据假设 / 查表结构 / 找测试数据(查 MySQL / PostgreSQL,沉淀 schema 到 `docs/schema-knowledge/`) |

## 安装与接入(两步)

```bash
npm install -g cgraphx               # 装 CLI(Node ≥ 20 且 < 25)
cd /your/project && cgraphx install  # 建 .cgraphx/ + 部署 skills/commands 到 .claude/ + 写 hooks/statusLine
```

`cgraphx install` 只作用于当前项目(项目级,写项目内 `.claude/` 与 `.cgraphx/`);升级 CLI(`cgraphx upgrade`)后到各项目重跑一次即可刷新。

接手陌生项目时可选第四步:`/code-impact-init` 派子 agent 自动探索、建业务知识库到 `docs/knowledge/`。

## 背后自动(agent 跑的,用户无感)

- timeline 自动记录开发事件(无需手动跑)
- agent 经 `code-impact-api` 自动查业务知识
- agent 经 `db-query` 自动查数据库
- `status` / `docs` / `db` / `timeline` 等 CLI 子命令由 agent / skill 调用,人类日常不主动跑

## 卸载

```bash
npm uninstall -g cgraphx             # preuninstall 钩子自动清所有 agent 的 MCP 配置
# 需要清数据时,手动删项目目录下的 .cgraphx/
```

## 视觉版

给人类用户看介绍页时,指向 `how-to-use.html`(本 skill 目录内,部署后在 `.claude/skills/cgraphx-guide/how-to-use.html`)——分阶段卡片布局,一眼看清完整使用流程。
