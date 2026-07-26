---
name: cgraphx
description: 代码图谱工具集 — 通过 codegraph_explore MCP 或 cgraphx CLI 查代码结构、调用关系、影响半径。Use when 代码结构/调用关系/谁调用/被谁调用/影响范围/调用链/代码搜索/找函数/找类/symbol/function/method/class/impact/affected/重构风险/代码智能/cgraphx。任何代码理解或修改前的"先看一下"场景都该用本 skill 而不是直接 grep。
---

## 何时用 cgraphx(优先于 grep / Read)

任何"理解代码"或"改代码前先看一眼"的场景:
- 这个函数被谁调用?改它会崩哪里?
- X 是怎么调用到 Y 的?(流程/调用链)
- 找 UserService 类 / login 方法在哪个文件
- 改这些文件会影响哪些测试?
- 这个接口的所有实现

<HARD-GATE>
cgraphx 不是百分百可靠, 有些代码关系不一定能扫描, 依然需要结合 grep协同探索
</HARD-GATE>
**优先级**:cgraphx > grep > Read。cgraphx 是 tree-sitter AST 派生的真实符号图,能找到 grep 必漏的(同名方法、interface 实现、跨语言调用、被注解但模式不规则的入口)。grep 只在 cgraphx 索引未覆盖(configs、docs、generated code)时用。

## 工具(由 cgraphx 提供)

### MCP 工具(首选,agent 自动调)

| 工具 | 用途 |
|---|---|
| `codegraph_explore` | **首选**。给一组符号名或自然语言问题,返回相关符号的源码 + 它们之间的调用路径(含动态派生边如 callback / React render / JSX children)+ 影响半径。一次调用通常够答完整问题。 |

MCP 不可用(未配置 / 启动失败 / 在 Claude Code 外)走下面 CLI。

### CLI(走 Bash 调,作为 MCP 的 fallback)

```bash
cgraphx <subcommand> [args]
```

| 操作 | 命令 | 何时用 |
|---|---|---|
| 搜符号 | `cgraphx query "<name>"` | 按名字找 function/method/class/interface |
| 看符号定义 | `codegraph_explore` MCP,或 Bash `cgraphx query <name>` 后看返回 | 拿到完整源码 |
| 谁调用 X | `cgraphx callers <symbol>` | inbound 调用方 |
| X 调用谁 | `cgraphx callees <symbol>` | outbound 被调用方 |
| 改 X 的影响面 | `codegraph_impact(symbol, depth)` MCP | impact radius(BFS 影响传播,基于索引) |
| 改文件的受影响测试 | `cgraphx affected [<files>...]` | 找受影响测试文件 |
| 构建 task 上下文 | `codegraph_explore` MCP | 给 AI 一段任务描述,返回相关代码片段 + 调用路径 |
| 看索引状态 | `cgraphx status` | files/nodes/edges 计数、last_indexed_at |
| 增量同步 | `cgraphx sync` | 文件改了之后 |
| 全量重建 | `cgraphx index` | 出问题或大改动时 |
| 看文件结构 | `cgraphx files [options]` | 项目文件概览 |

## 决策树(给 agent 用)

```
用户问的 / 任务需要的:
├── "X 是怎么工作的" / "找 X" / "X 在哪" / 流程类问题
│   → codegraph_explore MCP(一次拿源码 + 调用路径)
│
├── "改 X 会影响哪里" / "X 的 blast radius" / 重构前评估
│   → codegraph_impact(symbol) MCP(看影响半径)
│   → 或 cgraphx affected <file>(看受影响测试)
│
├── "谁调用 X" / "X 的 caller" / 反向追踪
│   → cgraphx callers <symbol>
│
├── "X 调用什么" / "X 的 callee" / 正向追踪
│   → cgraphx callees <symbol>
│
├── 找配置文件、文档、generated code(cgraphx 不索引的)
│   → grep / Read(cgraphx 在这里无能为力)
│
└── 索引可能 stale(改动后未 sync)
    → cgraphx sync,或 cgraphx status 看新鲜度
```

## 何时派子 agent(让上下文更干净)

主 agent **直接调 cgraphx 工具时,大段原文(源码、callers/callees 链、impact 半径)会进自己的上下文**,挤占决策与待办的空间。本 skill 工具适合精确查询,但**模糊意图的重探索型任务**适合派子 agent 在隔离上下文里跑。

### 判断规则(R4:目标精度)

主 agent **已知精确目标**(具体符号名 / 文件名)→ **不派**,直接调上面工具;主 agent **只有模糊意图**(系统理解 / 梳理 / 调研型)→ **派**。

具体例子:

| 场景 | 不派(直接调工具) | 派(派子 agent) |
|---|---|---|
| 找符号位置 | "login 函数被谁调" → `cgraphx callers login` | "梳理 timeline 子系统的全貌" |
| 改动影响 | "改 work_order.ts 影响哪些测试" → `cgraphx affected work_order.ts` | "系统理解 hook 触发到事件落库的完整流程" |
| 调用链 | "X 调用什么" → `cgraphx callees X` | "调研 cgraphx 的 MCP 工具是怎么从 initialize 一路走到 explore 的" |

### 派的方法(决定派时执行)

1. **Read** 本 skill 目录下的 `./agent-prompt.md`
2. **Agent tool 调用**:
   ```
   Agent({
     subagent_type: "general-purpose",
     prompt: <agent-prompt.md 文件内容> + "\n\n当前任务: " + <用户原话或你的转述>
   })
   ```
3. **直接采纳**子 agent 返回的提炼结论 —— 不要再自己调 codegraph_explore / callers / callees 重新查(那是浪费)
4. 结论不够 → 再派一次(换 prompt 重点,如"重点看 X 的副作用")或回头自己调工具补

### 代价

- **不派的代价**:大段源码 / 调用链进主上下文,后续决策可用 budget 变小
- **派的代价**:子 agent 本身耗 token,简单查询派反而更贵
- **R4 是平衡点**:只在"模糊意图 + 主 agent 无法精确判断目标"时派

## 何时不用 cgraphx

- **产品需求 / UX / 业务逻辑**:cgraphx 是代码智能,不管业务(用 `code-impact-api` skill 查 docs/knowledge/)
- **数据库数据**:`cgraphx db` 子系统(见 db-query skill)
- **开发历史 / 最近做了什么**:`cgraphx timeline` 子系统(见 developer-timeline skill)
- **配置文件 / 文档 / 日志**:grep 更直接

## 前置条件

- 项目必须先跑过 `cgraphx init`(建索引)
- MCP 配置:`cgraphx install` 已写到 `.claude/settings.json`(项目级,默认 local)
- 索引新鲜度:文件改动后会有 ~1s 同步延迟;长时间未 sync 时跑 `cgraphx sync`

## 性能特征

- 单次 explore 调用:小仓库 1 次、中型 2-3 次、大型(vscode 量级)3-5 次
- 响应延迟:sub-second(SQLite + WAL + FTS5)
- 工具调用次数目标:flow 问题 1-3 次 cgraphx 调用 + 0 Read/Grep(理想状态)

## 失败处理

- **`cgraphx status` 报未初始化** → 提示用户跑 `cgraphx init`,不要 silent 跑(索引是用户决定)
- **MCP 未连上** → CLI fallback;两者都不可用 → 退化 grep(精度损失)
- **结果为空** → 可能符号名拼错 / 不在索引里;试 `cgraphx query` 模糊搜

## 探索结果收口(给 clarify/spec/plan)

只有当本 skill 用于需求澄清、spec 或 plan 前置探索时,才做简短收口。简单精确查询(如"函数在哪")可以直接回答,不套模板。

按需使用以下 4 项,无内容可省略:

- **查到的关键事实**:入口、调用方、被调用方、数据流、测试、配置或影响范围。
- **对决策的影响**:哪些选择应被锁定、排除或上报用户确认。
- **应进入 PRD/spec/plan 的内容**:接口行为、兼容性、权限、异常、受影响文件、任务依赖、验证命令等。
- **仍不确定/需确认**:需要继续查代码、查数据库、问用户或留到后续阶段的点。
