---
name: code-impact-markdown
description: 维护可供 cgraphx docs 扫描的 Markdown 知识文件。用于创建、编辑、规范化或提取元数据,将对话、代码探索结果、教程、指南、运维手册、安装说明、决策、经验教训或面向 AI 的项目知识保存为可被本地图谱扫描的 .md 文件。
---

# Code Impact Markdown

当项目知识需要以可被图谱检索的方式持久化时,使用此 skill。

典型输入:
- 有价值的对话摘要
- 代码探索或分析结果
- 架构或实现发现
- Bug 调查笔记
- 项目决策和约定
- 教程、安装指南和操作文档
- 运维手册和操作流程
- 经验教训、警告和未来 AI 指引

## 保存目录

所有可被图谱扫描的 Markdown 知识文件必须保存到:

```text
docs/knowledge/
```

如目录不存在则创建。按主题组织文件 —— 一个文档聚焦一个主题。不要将知识文件保存到此目录之外。

## 必要流程

1. 确定目标 Markdown 路径(在 `docs/knowledge/` 下)。
2. **在命名新概念之前,先查询已有的 concepts、domains、tags**(见下节)。
3. 当含义相同时,复用规范名称。
4. 为替代名称添加 `aliases`,而非创建重复的 concept。
5. 如果是更新已有的 Markdown 文件,先读取并保留当前 frontmatter。
6. 编写简洁的 frontmatter,使文档可被图谱解析。
7. 正文必须包含 `## Summary`(唯一进索引的章节),其他章节按 `document_type` 选模板自由组织。
8. **Write 后立刻 `cgraphx docs validate <file>` 校验**(见下节),非法则修 frontmatter 再 Write 再校验,直到合法。
9. 检查是否已有文档覆盖了相同主题。当三个合并条件全部满足时(见文档合并检查),提示用户是否合并。
10. 编辑后询问是否触发扫描。**未经确认不要运行扫描**。

## 查询已有词汇

扫描已运行过时,先用 CLI 列出已有 concept/domain/tag,避免造重复名:

```bash
cgraphx docs concepts              # 列所有 concept + 关联文档数 + 所属 domain
cgraphx docs domains               # 列所有 domain
cgraphx docs tags                  # 列所有 tag
```

查找特定术语或概念:

```bash
cgraphx docs find --q=Redis         # 关键词子串匹配(LIKE on title + summary)
cgraphx docs find --concept=Redis   # 按 concept 精确过滤
```

如果索引尚未建立(刚 clone 仓库 / 还没跑过 `cgraphx docs index`),直接 grep 本地 Markdown 的 frontmatter:

```bash
grep -rl "concepts:" docs/knowledge/ --include="*.md"
```

## 校验 frontmatter(写文件前必跑)

cgraphx 提供 `docs validate` 子命令,写文件前**必须**跑一遍校验,通过才保存:

```bash
cgraphx docs validate <file>        # 文本输出,exit 0 合法 / 2 非法
cgraphx docs validate <file> --json # JSON 输出 {valid, skipReason, detail}
```

校验内容(规则与 `cgraphx docs index` 扫描时一致,单一事实源 `src/markdown/validator.ts`):

| 字段 | 校验 |
|---|---|
| `title` | 非空字符串 |
| `document_type` | 16 枚举之一(见下) |
| `domains` | 至少 1 项 |
| `concepts` | 至少 1 项 |
| `status` | 4 枚举之一(`draft`/`active`/`superseded`/`deprecated`) |
| `source_type` | 7 枚举之一(见下) |
| `updated` | `YYYY-MM-DD` 格式 |

**流程**:Write 文件 → `cgraphx docs validate <file>` → 非法则**修 frontmatter 再 Write 再校验**,直到合法才告知用户文件已保存。非法文件即使写了,`cgraphx docs index` 扫描时也会整个跳过 —— 所以校验前置不是可选,是必须。

## 命名规则

- 每个概念或领域使用一个规范名称。
- 优先用 cgraphx 已索引的名称(用 `cgraphx docs concepts` 查)。
- 不要为同一概念创建翻译后的重复项,如 `Redis`、`redis server`、`Redis Installation`。
- 将替代名称放入 `aliases`。
- **concept 用项目实际话语里的规范名**:代码标识符/协议/产品名保留真实形式(多为英文,如 `Redis`、`SqliteStore`),领域/业务/流程概念用项目语言(本项目多为中文,如 `本地开发环境`、`知识图谱`)—— 不要把中文概念硬翻成英文。完整规则见「语言」节。
- 保持 domain 名称稳定且有界,如 `order-service`、`infra`、`cache`、`billing`。
- 使用 `tags` 进行松散分组;不要用 tags 替代 concepts 或 domains。
- **文件名用项目实际话语里的词,不二次翻译**:文件名是主题 slug,跟着项目里实际怎么叫走 —— 常说"流程"就用"流程",常说"redis"就用"redis",不要把"流程"译成 process、把"redis"译成"缓存"。代码组件/架构类主题(本来就是英文标识符)自然用英文(如 `extraction-orchestrator.md`);业务/流程类主题用项目语言(如 `任务办理流程.md`、`redis-安装问题.md`)。中英混排按实际用词,不强制统一。文件名不进索引、不参与检索(只有 title/concept/Summary 进),中文文件名不会影响命中 —— 它只是 slug,中文表达交给 title 和正文。

## Frontmatter 规范

每个可被图谱扫描的 Markdown 文件顶部必须使用 YAML frontmatter:

```yaml
---
title: Redis 本地安装指南
document_type: guide
domains:
  - infra
concepts:
  - Redis
  - 本地开发环境
aliases:
  - Local Development Environment
  - Redis Setup
tags:
  - tutorial
  - cache
status: active
source_type: human_note
owners:
  - platform
related_code:
  - src/main/java/demo/OrderService.java
related_documents:
  - docs/guides/order-flow.md
created: 2026-04-28
updated: 2026-04-28
---
```

**`related_code` 语义**:cgraphx **仅作元数据保存**(JSON 数组存表),**不建立到代码符号的反向链接**(A 范围下的设计决策,文档与代码图完全隔离)。值可以是文件路径、全限定类名或方法引用,作为人类/未来工具的链接提示。

**必填字段(7 个)**:

```text
title
document_type
domains
concepts
status
source_type
updated
```

**时间格式**:`YYYY-MM-DD`(ISO 8601 日期,不含时分)。示例:`2026-04-28`。`created` 字段可选但推荐填写。

**`document_type` 枚举(16 个)**:

```text
conversation     # 对话总结
exploration      # 探索发现
finding          # 调查结论
analysis         # 深度分析
lesson           # 经验教训
warning          # 警告/陷阱
decision         # 决策记录
rule             # 团队规则
architecture     # 架构说明
guide            # 指南
tutorial         # 教程
runbook          # 运维手册
installation     # 安装说明
api              # API 文档
faq              # 常见问题
note             # 笔记
```

**`source_type` 枚举(7 个)**:

```text
ai_session          # AI 对话总结
human_note          # 人写的笔记
code_review         # 代码审查发现
debugging           # 问题排查过程
architecture_review # 架构评审
manual              # 人工撰写(默认)
external_summary    # 外部资料摘录
```

**`status` 枚举(4 个)**:

```text
draft      # 草稿
active     # 当前有效
superseded # 已被替代
deprecated # 已废弃
```

## 稳定标题(只有 Summary 进索引)

**唯一进 cgraphx 索引的章节是 `## Summary`(或中文别名 `## 摘要`)**。其他章节保留在文件里,AI 想看就 Read 文件。

```text
## Summary        ← 唯一进索引(标题大小写敏感,必须正好两个 # + 一个空格)
## 摘要           ← 中文别名,也接受

## Context        ← 不进索引,留文件里供 Read
## Decisions      ← 同上
## Steps          ← 同上
...               ← 任意其他章节,自由组织
```

**写作建议**(虽不进索引,但让文档更系统):按 `document_type` 选模板(`template-memory.md` / `template-guide.md` / `template-runbook.md`),模板里的章节结构是写作指南,不是索引契约。

## 语言

文档正文必须用**中文**编写。技术术语、代码标识符、文件路径、函数名和类名保留原始英文形式。`## Summary` 标题保留英文(大小写敏感)。

**Concept 与 aliases 的语言**:concept 用项目实际话语里的规范名 —— 代码标识符/协议/产品名保留真实形式(多为英文,如 `Redis`、`SqliteStore`、`FTS5`),领域/业务/流程概念用项目语言(本项目多为中文,如 `本地开发环境`、`知识图谱`、`任务办理流程`)。**不要把中文概念硬翻成英文。** aliases 放这个 concept 的其他语言译名 + 同义词 + 缩写(例:concept `知识图谱` → aliases `[Knowledge Graph, KG]`;concept `SqliteStore` → aliases `[SQLite 存储层]`)。

理由:cgraphx 关键词搜索是 LIKE 子串匹配(concept 名 + title + Summary 都参与),用项目实际用词,中文查询才能直接命中。dedup 不受影响(同名 concept 跨文档自动合并)。

## 文档模板

按 `document_type` 选模板:

| document_type | 模板文件 |
|---|---|
| conversation, exploration, finding, analysis, decision, lesson, warning, rule, architecture | [template-memory.md](template-memory.md) |
| guide, tutorial, installation, api, faq, note | [template-guide.md](template-guide.md) |
| runbook | [template-runbook.md](template-runbook.md) |

**注意**:模板里的章节结构是**写作指南**(让文档更系统),cgraphx **只提取 `## Summary`** 进索引,其他章节留文件里。

## 已有 Markdown 处理

当文件已存在时:
- 首先提取当前 frontmatter。
- 保留未知的元数据字段,除非它们明显有误。
- 将 `domains`、`concepts`、`aliases`、`tags`、`owners`、`related_code`、`related_documents` 规范化为 YAML 列表。
- 添加缺失的必填字段。
- 未检查已有用法前,不要重命名 concepts 或 domains。
- 保留有用的已有标题;仅在能改善可读性时才规范化标题。
- 优先在已有结构下追加带日期的新发现,而非重写历史结论(除非已过时)。

## 文档合并检查

编写新 Markdown 文档后,检查是否已有文档覆盖了相同主题。仅当以下三个条件**同时满足**时才提示用户。

### 三个合并条件

1. **document_type 匹配或兼容** —— 已有文档具有相同的 `document_type`,或类型用途相同(例如 `guide` 和 `installation`、`conversation` 和 `exploration`)。
2. **核心概念高度重叠** —— 新文档的至少一个核心 concept 出现在已有文档的 `concepts` frontmatter 中。仅边缘概念重叠不足以触发。
3. **范围相似** —— 标题或正文范围重叠,不仅仅是提到了相同概念,而是覆盖了相同的知识领域。

当任一条件不满足时,跳过合并提示,继续第 9 步。

### 如何检查

用 cgraphx docs find 查找候选文档(已扫描过):

```bash
cgraphx docs find --concept=<new-doc-core-concept>
cgraphx docs find --q=<keyword-from-title>
```

或当索引未建立时直接 grep 本地:

```bash
grep -rl "concepts:" docs/knowledge/ --include="*.md" | head -20
```

对每个候选文档,把 `document_type`、`concepts` 以及 `title` 和正文与新文档对比。

### 提示

当三个条件全部满足时,展示合并选项:

```text
发现已有文档 [existing-doc.md] 与新文档覆盖相同主题:

- 文档类型: [type](相同/兼容)
- 共享概念: [overlapping concepts]
- 范围重叠: [brief description]

是否将新内容合并到已有文档?合并后会保留已有文档的结构,追加新内容。选择 "否" 将保留两个独立文档。
```

### 合并行为

当用户选择合并时:
- 完整读取已有文档。
- 在带日期的标题下或相应章节中追加新内容。
- 更新 `updated` 日期,合并 `concepts`、`aliases`、`tags`、`related_code`、`related_documents`。
- 如果新文件已写入磁盘,则删除新创建的文件。
- 保留已有文档的 `title`,除非用户提供了更好的名称。

## 质量规则

知识文档的目的是记录代码、配置文件和 LLM 通用知识**无法提供**的内容。创建文档前,应用以下过滤标准。

### 应当记录的内容

记录至少满足以下**任一**条件的内容:
- **非显而易见的业务逻辑** —— 代码中隐含但仅阅读代码无法直接看出的规则、约束或工作流。
- **决策原因** —— 为什么做出了某个技术或架构选择,尤其是存在替代方案时。
- **执行流程和运维操作** —— 跨多个系统的步骤流程或需要特定顺序的操作。
- **陷阱、坑点和非显而易见的约束** —— 阅读代码的人会感到意外的事情。
- **跨系统依赖** —— 组件如何跨越从单个文件无法看到的边界进行交互。
- **历史背景** —— 过去的事故、变通方案或遗留约束,解释代码为什么是现在这样。

### 不应记录的内容

跳过属于以下类别的内容:
- **已在代码或配置中记录的内容** —— 默认值、连接字符串、环境变量。代码是事实来源。
- **通用编程知识** —— 任何合格开发者或 LLM 已知的内容。
- **已应用的一次性修复** —— 如果修复已在代码/配置中,commit 历史会说明一切。
- **逐字记录** —— 未经提炼的原始对话日志。提取持久性结论,而非得出结论的过程。
- **工具使用说明** —— 如何使用 curl、git、npm 等。这些是通用知识。
- **可从文件结构推导的信息** —— 模块角色、文件位置、API 端点列表。

### 通用规则

- 优先记录持久性知识而非对话式日志。
- 保留足够的证据,使另一个 AI 无需重复整个探索即可信任该文档。
- 用 `Open Questions` 章节或 `status: draft` 显式标记不确定性。
- 对已知的陷阱、回归或意外约束使用 `warning` 类型文档。
- 当文档被替代时使用 `superseded` 状态;在 `related_documents` 中链接替代文档。
- 教程和指南尽可能包含 `Validation` 和 `Troubleshooting` 章节。

## 文档拆分

当内容在单个文档中覆盖多个不相关的概念时(例如一次对话讨论了几个不同的问题,用户要求记录整个会话),**拆分为独立文档**而非创建一个庞大的文件。

拆分规则:
- 每个文档应聚焦于**一个核心概念或一个连贯主题**。
- 如果两个章节不共享 concepts、domains 或 `document_type`,它们应分别放入不同文件。
- 当章节相关但目的不同(例如一个发现和由其触发的决策),如果 `concepts` 和 `domains` 显著重叠,可以保留在同一文档中。
- 以主要主题命名每个文件。
- 在 frontmatter 中使用 `related_documents` 交叉链接拆分后的文档。

示例:一次涵盖"Redis 安装问题"和"order-service API 设计"的对话应生成两个文档:

```text
docs/knowledge/redis-installation-issues.md   (document_type: lesson, concepts: [Redis])
docs/knowledge/order-service-api-design.md    (document_type: decision, concepts: [OrderService, API])
```

## 扫描提示

创建或编辑 Markdown 元数据后,询问:

```text
是否需要触发一次扫描,把新的 Markdown 知识写入索引?
```

仅在用户同意后运行:

```bash
cgraphx docs index
```

扫描为**全量覆盖式重建**。运行后会清空旧索引,从 `docs/knowledge/` 下所有合规 `.md` 重建。事务性:任一步骤失败则回滚,旧索引不破坏。
