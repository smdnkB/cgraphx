---
name: subagent-implement
description: 复杂 plan 的子 agent 实现流程 — 主 agent 作为 controller,按依赖批次派 implementer 子 agent 实现 + 按风险做 spec 审查,所有任务完成后派 final quality reviewer 整体审查。Use when 执行计划/跑计划/按 plan 实现/派子 agent 实现/复杂实现/多任务实现/系统化实现/subagent 实现。
---

# Subagent-Implement

## 定位

把已确认的 plan(`docs/features/<feature-id>/plan/`)拆成多个独立任务,**主 agent 作为 controller**,按依赖批次派 implementer 子 agent 实现。主 agent 默认负责协调、验证和收口;仅对 reviewer 指出的低风险微修可直接修改。所有任务完成后派 final quality reviewer 整体审查。

**与 implementation 的差别**:
- `implementation` —— 主 agent 在主会话顺序执行,自己改代码。适合**单点改动 / 小范围 / 1-3 文件**
- `subagent-implement`(本 skill)—— 主 agent 以协调为主,派子 agent 在隔离上下文实现。适合**复杂 plan / 多任务 / 跨多文件**

## 何时用(决策树)

```
有 plan(docs/features/<feature-id>/plan/)或明确任务清单?
├── 否 → 不要用本 skill,走 implementation 或先 write-plan
└── 是 → 任务数 ≥ 3 且跨多文件?
    ├── 否(简单任务) → 走 implementation,主会话直接做
    └── 是(复杂 plan) → 走本 skill
        └── 任务能拆成相对独立的子任务?
            ├── 是 → 本 skill 标准模式(按依赖批次执行;默认串行,显式无冲突可并行)
            └── 否(任务高度耦合,后任务依赖前任务实时反馈) → 走 implementation
```

**典型适用场景**:
- feature plan 拆了 5+ 个任务,跨 schema / backend / frontend / test 多个域
- 多个独立工具/命令的实现
- 同时改 N 个 skill 文件(参考 `2026-06-27-exploration-subagent-dispatch` plan)
- 多语言/多框架并行支持

**不适用**:
- 单文件 bug 修复 → `implementation`
- 重构单个模块 → `implementation`
- 任务间强耦合(后任务必须基于前任务实时调整)→ `implementation`

## 核心流程

```
1. 读 plan 一次 → 提取所有任务全文 + context → TodoWrite 跟踪
   (前置:plan 已过 write-plan 的 Plan Review 阶段,完整性 / spec 对齐已审)

2. 按依赖批次执行任务:
   a. 默认一次派 1 个 implementer;只有任务在 plan 中被标为"可并行"且通过无冲突检查时,才同批派多个 implementer
   b. 派 implementer 子 agent(把任务全文 + context 拼进 prompt;可附 index.md 摘要,不让子 agent 读全 plan)
   c. 处理 implementer status(见下文)
   d. **主 agent sanity check**:
      - 看 implementer 报告合理性(改了哪些文件 / 测试是否真绿 / 自审发现是否已修)
      - 不通过 → 派 implementer 修 / 补 context / 主 agent 做低风险微修 / 上报
   e. 通过 → 标记任务完成 → 下个任务或下一批

3. 所有任务完成后:
   - 派 final quality-reviewer 子 agent(整体审查:架构、命名一致性、文件组织、跨任务问题)
   - 不通过 → 按问题大小选择主 agent 低风险微修或派 fix 子 agent 修 → quality-reviewer 重审
   - 通过 → 收尾(提示用户走 commit / PR / finish-feature)

4. 收尾汇报:
   - 完成的任务清单
   - 各阶段审查发现的问题 + 修复情况
   - 剩余风险 / 未覆盖项
```

**审查粒度**(关键设计):
- **spec/plan 忠实度审查按风险派** —— plan 阶段已经审可执行性;执行阶段对高风险、探索性强、跨契约任务再派 spec-reviewer,重点查漏做 / 多做 / 误解 / plan drift。
- **quality 审查仅最终一次** —— 代码质量问题(命名、架构、文件组织、跨任务协同)跨任务才能看出,集中审更经济。
- **implementer 自审** —— 子 agent 完成后自己先 review,主 agent sanity check 看报告和 plan 忠实度即可。

**为什么这样设计**:plan 阶段的 plan-document-reviewer 已经把"plan 是否完整可执行"的问题解决了。执行阶段按风险派 spec-reviewer,避免每个小任务都重复审查,同时保留高风险任务和 plan 偏离风险的独立验证。

## 任务调度策略

**默认串行**:没有明确并行标记时,一次只派 1 个 implementer,避免上下文偏差和代码冲突。

**允许显式无冲突并行**:只有同时满足以下条件,主 agent 才能同批派多个 implementer:

- plan 的 `index.md` 把这些任务列为可并行,且任务之间没有依赖关系。
- 涉及文件集合不重叠;如果改同一目录,改动对象也必须清楚分离。
- 不共享 schema、公共类型、公共 API、全局配置、测试 fixture、锁文件或生成物。
- 验证命令不会互相污染状态(例如共享数据库、快照、临时文件)。
- 每个并行任务的 prompt 都写明"本批并行任务列表"和"禁止触碰其他任务文件"。

**并行收口**:

- 任一并行任务返回 `BLOCKED` / `NEEDS_CONTEXT` / `DONE_WITH_CONCERNS(correctness/scope)` 时,暂停同批后续合并判断,先解决该任务。
- 同批任务完成后,主 agent 必须看整体 `git diff`,确认没有文件冲突、重复实现或概念命名分叉,再进入下一批。
- 如果发现同批任务实际发生文件重叠或公共契约冲突,停止并行模式,改为串行修复。

## 何时该派 spec-reviewer(可选)

**默认不派**:低风险任务的 plan 完整性已经在 plan-document-reviewer 阶段审过,implementer 报告 + 主 agent sanity check + 跑测试通常足以判断完成。

**例外允许派**(主 agent 判断或用户要求):

| 场景 | 为什么派 |
|---|---|
| **任务探索性强** —— plan 阶段无法预知实际行为(如外部 API 输出字段、第三方库行为) | 实际实现可能跟 plan 假设不一致,需要独立验证 |
| **跨多文件耦合** —— 一个改动影响多处(如改公共类型签名) | 影响范围大,扩散代价高 |
| **plan-document-reviewer 标了"高风险"任务** | 主 agent 在 plan 阶段已知风险,执行时复查 |
| **用户主动要求** | 用户判断需要 |
| **plan 没经过 Plan Review**(write-plan 跳过了) | 没有 plan 阶段审查兜底,建议派(非强制,主 agent 判断) |

**派的方法**:用同目录下 `spec-reviewer-prompt.md` 模板,把任务全文 + implementer 报告 + 工作目录拼成 prompt,派 `general-purpose` 子 agent。

## 主 agent 是 controller(默认不是 implementer)

主 agent 在本 skill 中默认只做协调,但允许处理低风险微修:

- ✅ 读 plan、提取任务全文、构造子 agent prompt
- ✅ 处理子 agent status、回答子 agent 提问
- ✅ 跟踪任务进度(TodoWrite)
- ✅ sanity check 审查结论、决定是否进入下个任务
- ✅ 对 reviewer 指出的低风险微修可直接 Edit/Write
- ❌ 不绕过子 agent 自己实现

**为什么**:子 agent 在隔离上下文实现,主 agent 上下文保持干净,用于协调多任务;但对拼写、导入、格式、明显小逻辑漏改这类微修,再派 fix agent 会增加延迟和 token。

### 主 agent 可直接微修的条件

必须同时满足:

- reviewer 或测试报告已经把问题定位到具体文件 / 行 / 小范围。
- 修复不改变业务规则、公共契约、schema、权限、安全逻辑或任务范围。
- 预计改动不超过 1-2 个文件,且不需要重新理解大段上下文。
- 修复后能立刻运行相关验证。

不满足以上条件时,仍派 implementer/fix 子 agent。

## 子 agent status 协议

implementer 子 agent 必须返回以下 status 之一:

| Status | 含义 | 主 agent 处理 |
|---|---|---|
| **DONE** | 实现完成,自审通过,无未经批准偏离 | 主 agent sanity check(跑测试 + 看报告)→ 通过则进入下个任务 |
| **DONE_WITH_CONCERNS** | 实现完成但有疑虑 | 读 concerns:关于 correctness/scope/plan drift → 先解决;关于 observation(如"文件有点大")→ 记录,进入 sanity check |
| **NEEDS_CONTEXT** | 缺少必要信息 | 补 context,重新派 implementer |
| **PLAN_CONFLICT** | plan 与代码现实或更优方案冲突,继续做会改变已锁定契约 | 主 agent 暂停该任务,回到用户/plan/spec 确认;不能让 implementer 自行改方案 |
| **BLOCKED** | 无法完成 | 评估:context 不够 → 补 context 重派;需更强推理 → 换更强 model;任务太大 → 拆分;plan 错了 → 上报用户 |

**红线**:**不要**忽略 BLOCKED 直接重试同 model;**不要**忽略 PLAN_CONFLICT 让子 agent 自行换方案;**不要**让卡住的子 agent"再试一次";**不要**绕过子 agent 自己实现。

## 模板路径

主 agent 派子 agent 时,Read 对应模板,把模板内容 + 当前任务 / 审查目标 拼成 prompt:

- `./implementer-prompt.md` — 实现单个任务的子 agent prompt(**每任务必派**;并行批次中每个任务各派一个)
- `./spec-reviewer-prompt.md` — 单任务 spec 审查的子 agent prompt(**执行结束可选派一次,默认不派**,见"何时该派 spec-reviewer")
- `./quality-reviewer-prompt.md` — 最终整体质量审查的子 agent prompt(**执行结束必派一次**)

派的方法(参考三个探索 skill 的派子 agent 机制):
```
Agent({
  subagent_type: "general-purpose",
  prompt: <模板全文> + "\n\n" + <任务 / 审查目标的具体描述>
})
```

## context 给法:任务全文 + index 摘要

主 agent 不把整套 plan 丢给 implementer,但应该给足局部任务所需的全局约束:

- 必给:当前任务全文、依赖任务完成摘要、相关代码上下文、验证命令。
- 建议给:`index.md` 中的目标、明确不包含、全局依赖图、当前任务所在批次、必须严格执行的契约、允许局部适配范围、Plan 冲突上报规则、与当前任务相关的风险/待确认项。
- 不给:无关子计划全文、其他任务的实现细节、会诱导 implementer 扩大范围的背景材料。

如果 implementer 认为 `index.md` 摘要不够,可以返回 `NEEDS_CONTEXT`;主 agent 补充摘要或允许其只读 `index.md`,但仍不读完整 plan 目录。

## 何时派 vs 不派(主 agent 判断)

| 场景 | 不派(走 implementation) | 派(走本 skill) |
|---|---|---|
| 任务量 | 1-2 个简单任务 | ≥3 个任务 |
| 文件域 | 单文件 / 单模块 | 跨 schema/backend/frontend/test 多域 |
| 上下文压力 | 主 agent 上下文够用 | 实现过程会挤爆主 agent 上下文 |
| 隔离价值 | 任务太简单,派反而费 token | 任务复杂,隔离后主 agent 能聚焦协调 |

## 跟其他 skill 的关系

| 阶段 | skill |
|---|---|
| 澄清需求 | `clarify-requirements` |
| 写 PRD | `write-prd` |
| 写 spec | `write-spec` |
| 写 plan | `write-plan` |
| **执行 plan(派子 agent)** | **`subagent-implement`(本 skill)** |
| 执行 plan(主会话顺序) | `implementation` |
| 收尾 | `finish-feature` / `commit` / PR |

## 处理 plan 与代码现实的冲突

子 agent 实现时发现 plan 与代码现实冲突(如 plan 引用的文件不存在 / 函数签名变了 / 模块结构改了):

- **小偏差**(实现细节、行号、变量名)→ implementer 自行调整,在报告里说明
- **大偏差**(架构变了、模块不存在、业务规则/数据口径/API/权限/schema/验收要变)→ implementer 返回 `PLAN_CONFLICT`,主 agent 决定:
  - 修 plan → 重派 implementer
  - 改任务范围 → 重新拆分
  - 上报用户

## 红线(不能做)

- ❌ **不在未证明无冲突时并行派多个 implementer**—— 默认串行;只有 plan 明确可并行且通过无冲突检查才同批并行
- ❌ **不让 implementer 子 agent 自己读完整 plan 目录**(主 agent 把任务全文 + 必要 index 摘要塞 prompt,节省子 agent Read + 防止子 agent 跑偏到其他任务)
- ❌ **不跳过 quality-reviewer**(整体质量审查是最后一道关卡,跨任务问题只有这里能发现)
- ❌ **不每任务派 quality reviewer**(质量集中审更经济;每任务派是浪费)
- ❌ **不忽略 BLOCKED**(子 agent 卡住必有原因,不能强行 retry 同 model)
- ❌ **不忽略 PLAN_CONFLICT**(plan 冲突必须回到 controller / 用户 / spec-plan 修改,不能让子 agent 临场改方案)
- ❌ **不让 quality reviewer 在 implementer 自审之前派**(implementer 自审 + sanity check 没过的实现,quality 审没意义)
- ❌ **不在主分支直接派 implementer**(应有 feature 分支或 worktree 隔离)
- ❌ **不让主 agent 绕过子 agent 实现实质任务**(低风险微修例外,但不能扩大为主 agent 接手实现)

## 收尾

所有任务 + quality 审查通过后:

1. 汇报:完成清单 / 修复历史 / 剩余风险
   - 说明 plan 忠实度:`PLAN_FOLLOWED` / `PLAN_ADAPTED` / 是否出现并解决过 `PLAN_CONFLICT`
2. 提示用户下一步:
   - 走 `finish-feature` 收尾?
   - 直接 commit?
   - 创建 PR?

不要自动 commit / push —— 主 agent 收尾汇报后停下,等用户决定。
