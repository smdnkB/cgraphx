---
name: code-impact-api
description: 项目文档知识库查询入口 — 通过 cgraphx docs CLI 查询 docs/knowledge/ 下的业务决策、概念定义、历史教训。Use when 任务开始时 / 查业务概念 / 查历史决策 / 对齐术语 / 找相关文档 / 探索既有知识。
---

## 这个 skill 解决什么问题

新任务开始时,**先查现有知识库**,在既有决策和概念基础上推进工作,而不是从零推断业务背景。

典型场景:
- "实现订单退订功能" → 先看是否已有退订决策文档,有则直接采纳
- "对齐业务概念命名" → 看 concept 列表,用团队已有命名,避免造新词
- "找相关文档" → 按 concept/domain/tag 过滤,定位最相关决策

## 工具(由 cgraphx 提供,通过 CLI 调用)

```bash
cgraphx docs <subcommand> [options] [project-path]
```

| 操作 | 命令 |
|---|---|
| 全量扫描入库 | `cgraphx docs index [project-path]` |
| 列出所有 concept | `cgraphx docs concepts [project-path]` |
| 列出所有 domain | `cgraphx docs domains [project-path]` |
| 列出所有 tag | `cgraphx docs tags [project-path]` |
| 多维过滤查询 | `cgraphx docs find [project-path] --concept=X --domain=Y --tag=Z --status=active --type=decision --q=关键词 --limit=20` |
| 文档引用关系 | `cgraphx docs refs <doc-id-or-path> [project-path]` |
| 文档详情(摘要+元数据) | `cgraphx docs show <doc-id-or-path> [project-path]` |

所有命令支持 `--json` 切换为机器可读格式。

## 工作流(任务开始时)

```
1. cgraphx docs concepts
   → 列出所有业务 concept(跨文档去重 + 关联文档数 + 所属 domain)
   → 用语义匹配判断任务涉及的 concept 是否已存在

2. 命中 concept 后:
   cgraphx docs find --concept=<name>
   → 返回该 concept 关联的所有文档,含:
     - title / type / status / updated
     - summary(Summary 章节内容,作为"是否需要读全文"的依据)
     - path(项目根相对,用 Read 工具看全文)

3. summary 够用 → 直接采纳,开始开发
   summary 不够 → Read 返回的 path 原文,再判断
```

## 何时派子 agent(让上下文更干净)

主 agent **直接调 cgraphx docs 工具时,大段原文(文档 Summary、find 返回的文档列表、docs/show 输出)会进自己的上下文**,挤占决策与待办的空间。本 skill 工具适合精确查询,但**模糊意图的重探索型任务**适合派子 agent 在隔离上下文里跑。

### 判断规则(R4:目标精度)

主 agent **已知精确目标**(具体 concept / 文档 id / 关键词)→ **不派**,直接调上面工具;主 agent **只有模糊意图**(系统理解 / 梳理 / 调研型)→ **派**。

具体例子:

| 场景 | 不派(直接调工具) | 派(派子 agent) |
|---|---|---|
| 找具体决策 | "订单退订的决策文档有没有" → `cgraphx docs find --q=退订` | "调研订单业务的全部决策" |
| 看 concept | "X concept 在哪些文档里" → `cgraphx docs find --concept=X` | "梳理 X 业务的所有 concept 和它们的关系" |
| 单文档详情 | "show 一下 decision-001.md" → `cgraphx docs show decision-001.md` | "系统理解这块业务为什么这么做,把所有相关决策串起来" |

### 派的方法(决定派时执行)

1. **Read** 本 skill 目录下的 `./agent-prompt.md`
2. **Agent tool 调用**:
   ```
   Agent({
     subagent_type: "general-purpose",
     prompt: <agent-prompt.md 文件内容> + "\n\n当前任务: " + <用户原话或你的转述>
   })
   ```
3. **直接采纳**子 agent 返回的提炼结论 —— 不要再自己调 `cgraphx docs find/show` 重新查(那是浪费)
4. 结论不够 → 再派一次(换 prompt 重点,如"重点看 decision 之间的关系")或回头自己调工具补

### 代价

- **不派的代价**:大段 Summary / find 列表进主上下文,后续决策可用 budget 变小
- **派的代价**:子 agent 本身耗 token,简单查询派反而更贵
- **R4 是平衡点**:只在"模糊意图 + 主 agent 无法精确判断目标"时派

## 工作流(查文档间引用)

```
cgraphx docs refs docs/knowledge/decision-001.md
→ 输出双向引用:
  Outgoing: 这份文档引用了哪些
  Incoming: 哪些文档引用了这份
```

适合"这个决策被谁引用了"、"还有哪些相关文档"。

## 索引管理

文档变更后**必须重新触发扫描**(覆盖式重建,不走增量):

```bash
cgraphx docs index              # 全量扫 docs/knowledge/,事务性覆盖
```

什么时候跑:
- 写了新 .md 到 docs/knowledge/
- 修改了已有 .md 的 frontmatter 或 Summary
- 删除了 .md
- 重新 clone 仓库后

不需要跑:
- 改了 .md 的非 Summary 章节(那些不进索引,改完直接 Read 就行)

## 文档规范要点(写新文档时遵守,详见 knowledge-write skill)

frontmatter **7 必填**(缺一即被跳过):`title` / `document_type` / `domains` / `concepts` / `status` / `source_type` / `updated`

**章节**:**只有 `## Summary`(或 `## 摘要`)进索引**,其他章节留文件里,AI 想看就 Read。

详细 frontmatter 枚举值、稳定标题、命名规则、模板 → 见 `knowledge-write` skill。

## 关键词搜索(中文友好)

`cgraphx docs find --q=关键词` 走 **LIKE 子串匹配**(不用 FTS5,因为 SQLite 默认 tokenizer 对中文不友好)。任何中文/英文 substring 都能命中 title 或 Summary。

## 排除范围(明确不做)

- ❌ 不扫 `docs/knowledge/` 之外(README、CHANGELOG、第三方文档一律忽略)
- ❌ 不存文档全文(只存 title + Summary + 元数据 + 关系;其他章节 AI 自己 Read)
- ❌ 不修改文档(变更只能由人/AI 写文件后重新 `docs index`)
- ❌ 不与代码索引打通(文档不会自动建立到代码符号的反向链接)
- ❌ 不预计算 concept↔concept 关联(AI 从 find 返回的 concepts 列表自己推断)

## 探索结果收口(给 clarify/spec/plan)

只有当本 skill 用于需求澄清、spec 或 plan 前置探索时,才做简短收口。简单精确查询(如"有没有某个决策文档")可以直接回答,不套模板。

按需使用以下 4 项,无内容可省略:

- **查到的关键事实**:历史决策、状态、适用范围、关键规则、引用路径、团队已有术语。
- **对决策的影响**:哪些规则应继承、排除、更新,哪些需要领导/业务方重新拍板。
- **应进入 PRD/spec/plan 的内容**:已确认业务规则、非目标、兼容性要求、不可改动旧行为、必须复用机制等。
- **仍不确定/需确认**:历史文档过期、状态非 active、概念冲突或需要用户确认的部分。
