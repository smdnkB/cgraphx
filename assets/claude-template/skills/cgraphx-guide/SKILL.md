---
name: cgraphx-guide
description: cgraphx 应用整体使用指南 — 安装、项目接入、日常做需求的工作流(skill 串联)、agent 自动加载的上下文工具。Use when 用户问 cgraphx 怎么用/怎么安装/怎么接入项目/有哪些 skill/日常工作流/onboarding/新手入门/使用流程/安装步骤/skill 怎么配合/cgraphx 能干什么/cgraphx 和别的工具区别。问单个知识库/数据库/时间线工具怎么调走对应专责 skill(knowledge-recall、db-query、doc-report),不是本 skill。
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
- 查业务知识(`docs/knowledge/`)→ `knowledge-recall` skill
- 查数据库 → `db-query` skill
- 生成开发时间线 / 日报 / 周报 → `doc-report` skill
- 写 PRD / spec / plan → 各自 skill
- 探索陌生项目建知识库 → `init-knowledge` skill
- 查代码结构 / 调用链 / 影响半径 → 用 `grep` / `Read` 等编辑器自带工具

本 skill 只做整体导航,不重复各 skill 的内部规范。

## 整体使用流程

| 阶段 | 命令 / skill |
|---|---|
| **机器级 · 每机器一次** | `npm install -g cgraphx` |
| **项目级 · 每项目一次** | `cgraphx install`(建 `.cgraphx/` 数据目录 + 部署 skills/commands 到 `.claude/` + 写 hooks/statusLine)、`/init-guides`(立项目规范)、`/init-knowledge`(接手陌生项目时建业务知识库) |
| **日常做需求 · 必经两步** | `/dev-clarify` 澄清(先定业务口径,再出功能点提案,人审稿式改稿,结束时给《需求功能方案》),然后 `/dev-impl`;大需求先 `/dev-plan`,再 `/dev-impl-subagent` 一个会话跑完,最后 `/code-review`;哪里没看懂,说「画个图讲讲」出一页图解 |
| **日常做需求 · 复杂按需** | `/dev-wireframe`(涉及界面时画线框)、`/dev-handoff`(探索或澄清结束、要开新会话继续时)、`/dev-spec`(写技术规格)、`/dev-plan`(大需求拆执行计划)、`/knowledge-write`(沉淀到 `docs/knowledge/`) |
| **测试按需 · 三条线** | 接口:`/api-case` → `/api-run`;单元:`/unit-spec` → `/unit-code`;UI:`/ui-case` → `/ui-run` |
| **安全审计按需** | `/audit-login-security`(登录/认证安全审计:枚举全部认证入口 + 画认证链路,查绕过、越权、凭据、会话、爆破;只报告不修代码,默认不落盘) |
| **收尾按需** | `/dev-end`(写收口档案,已上线时写发布记录)、`/doc-backfill`(老需求补头部、补单测产物和收口档案) |
| **发布后按需** | `/doc-delivery`(需求文档、设计文档、接口文档,运行时选) |
| **工作回顾按需** | `/doc-report`(日/周/月报)、`/doc-workload`(工作量汇报) |
| **卸载 · 可选** | `cgraphx uninstall`(按清单清 `.claude/` 内包自带 skills 和配置 + 删 `.cgraphx/`,`--keep-data` 保留数据)、`npm uninstall -g cgraphx` |

## 各 skill 导航

### 用户主动触发(在 Claude Code 里敲 `/skill-name`)

| skill | 何时建议用户调 |
|---|---|
| `/dev-clarify` | 接到模糊需求,先探索项目现实、定业务口径,再以功能点为单位给行为链提案、人审稿式改稿,结束时给《需求功能方案》(经对抗审核;多功能点需求另写一份带 mermaid 流程图的讨论稿) |
| `/dev-wireframe` | 需求涉及界面时画低保真 HTML 线框,看着界面确认布局交互或发现业务问题 |
| `/dev-handoff` | 探索或澄清结束、要开新会话继续时,确认产出目录、写交接文件(带功能方案或指向讨论稿,拆多个会话按功能点分)、给出启动语 |
| `/dev-spec` | 环节二:第一节原样收录功能方案,主体写怎么实现——每个功能点出设计决策表(机制选型/数据模型/接口契约)供人评审,🔒 难回头的等确认 |
| `/dev-plan` | 大需求拆执行计划:index 加一个任务一个文件,给一句 `/dev-impl-subagent` 启动语 |
| `/dev-impl` | 小需求按 plan 或当前上下文实现代码 |
| `/dev-impl-subagent` | 大需求按 plan 执行:一个会话按任务派子 agent,主会话提交、统一验证和修复,最后提示 `/code-review` |
| `/api-case` | 从 spec 接口契约生成 bruno 测试接口(.bru + 断言 + 真实参数 + 多环境配置) |
| `/api-run` | 跑接口测试 + 核实写接口 DB 副作用 + 出报告(写接口必查 DB;失败只报告不修代码) |
| `/unit-spec` | 从 spec 派生单元测试规格(零代码依赖) |
| `/unit-code` | 填实单元测试代码、跑测试、出报告 |
| `/ui-case` | 从 spec 派生 UI 功能测试用例 |
| `/ui-run` | 用 Playwright MCP 跑 UI 功能测试,截图并出报告 |
| `/audit-login-security` | 登录/认证安全审计:枚举全部认证入口,再沿认证链路五段查绕过、越权、凭据、会话、爆破,给 file:line 证据链的 bug/风险清单;只报告不修、默认不落盘 |
| `/knowledge-write` | 把业务决策、概念、坑沉淀到 `docs/knowledge/` |
| `/init-knowledge` | 接手陌生项目,派子 agent 批量探索、建业务知识库 |
| `/init-ddl` | 按工程批量导出 DDL 基线(一表一文件) |
| `/init-guides` | 生成 `docs/guides/` 五份项目规范 |
| `/doc-delivery` | 发布后按需写需求文档、设计文档、接口文档(运行时选) |
| `/doc-backfill` | 老需求补头部、补单测产物和收口档案 |
| `/doc-report` | 生成日报、周报、月报、阶段总结、使用习惯分析 |
| `/doc-workload` | 产出需求工作量汇报,按功能点 × 工作内容拆工时(内部对账、甲方结款依据) |
| `/visual-explain` | 哪里没看懂,把对话内容或指定的文件、话题画成一页图解 |

### 命令

| 命令 | 何时用 |
|---|---|
| `/dev-end` | 需求做完收口:写收口档案,确认已上线时写发布记录 |
| `/my-query` | 评估当前会话是否需要 knowledge-recall、db-query 等工具补充收集上下文 |

### agent 自动调用(用户不主动敲,agent 用来加载项目上下文)

| skill / 工具 | agent 何时自动调 |
|---|---|
| `knowledge-recall` | 任务开始时召回 `docs/knowledge/` 业务概念、对齐术语 |
| `db-query` | 验证数据假设、查表结构、找测试数据(查 MySQL / PostgreSQL,沉淀 schema 到 `docs/schema-knowledge/`) |

## 安装与接入(两步)

```bash
npm install -g cgraphx               # 装 CLI(Node ≥ 22.5 且 < 27)
cd /your/project && cgraphx install  # 建 .cgraphx/ + 部署 skills/commands 到 .claude/ + 写 hooks/statusLine
```

`cgraphx install` 只作用于当前项目(项目级,写项目内 `.claude/` 与 `.cgraphx/`);升级用 `cgraphx upgrade`,在项目目录内执行——自动更新 CLI 并刷新当前项目;其他项目各自 cd 进去跑一次。

接手陌生项目时可选第四步:`/init-knowledge` 派子 agent 自动探索、建业务知识库到 `docs/knowledge/`。

## 背后自动(agent 跑的,用户无感)

- timeline 自动记录开发事件(无需手动跑)
- agent 经 knowledge-recall 自动查业务知识
- agent 经 `db-query` 自动查数据库
- `status` / `docs` / `db` / `timeline` 等 CLI 子命令由 agent / skill 调用,人类日常不主动跑

## 卸载

```bash
cgraphx uninstall         # 按清单清 .claude/ 内包自带 skills/配置 + 删 .cgraphx/
npm uninstall -g cgraphx  # 卸载 CLI
```

`cgraphx uninstall` 在项目目录内执行;加 `--keep-data` 保留 `.cgraphx/` 数据。

## 视觉版

给人类用户看介绍页时,指向 `how-to-use.html`(本 skill 目录内,部署后在 `.claude/skills/cgraphx-guide/how-to-use.html`)——分阶段卡片布局,一眼看清完整使用流程。

用户想查某个 skill 怎么用、有哪些 skill 时,指向同目录 `skills.html`——一个 skill 一行,默认折叠,能搜名字、用途和产物;`skills.html#<skill 名>` 直接展开那一行(如 `skills.html#doc-workload`)。
