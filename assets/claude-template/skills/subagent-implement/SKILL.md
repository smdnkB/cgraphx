---
name: subagent-implement
description: 复杂 plan 的子 agent 实现流程 — 主 agent 作为 controller,按依赖批次派 implementer 子 agent 实现 + 按风险做 spec 审查,所有任务完成后派 final quality reviewer 整体审查。Use when 执行计划/跑计划/按 plan 实现/派子 agent 实现/复杂实现/多任务实现/系统化实现/subagent 实现。
---

# Subagent-Implement

## 定位

- **主 agent 是统帅不是先锋**:只协调、把关、收口;实现全部派隔离上下文的 implementer 子 agent。
- **质量靠结构,不靠自觉**:四件套注入让执行者无法漂移,sanity check 把每任务关,quality-reviewer 把最终关。
- **门槛**:有 plan(或明确任务清单)+ ≥3 个任务 + 跨多文件域,或主 agent 上下文装不下。单文件/单模块/1-2 个任务 → 走 `implementation`;任务强耦合(后任务依赖前任务实时反馈)→ 走 `implementation`。

## 流程

```
1. 读 plan 一次 → 提取所有任务全文 → TodoWrite 跟踪
   (前置:plan 已过 write-plan 的 Plan Review)

2. 按依赖批次执行(默认串行;并行条件见红线①):
   派 implementer(四件套)→ 处理 status → sanity check → 标记完成

3. 全部完成 → 派 quality-reviewer 整体审查(必派、仅一次、在自审+sanity check 之后)
   → 不通过:主 agent 微修或派 fix 子 agent → 重审

4. 收尾:汇报 + 沉淀提示 + 交用户决定 commit/PR
```

### 派任:四件套注入

不把整套 plan 丢给 implementer。每个子 agent 的 prompt 只装:

1. **任务全文**(含 必须严格执行 / 允许局部适配 / 完成条件 / 对应 spec 条款)
2. **index.md 契约节** —— 该任务引用的跨任务共享契约,原文注入(不是"见 index"的指涉)
3. **任务引用的 spec 条款** —— 原文,不转述
4. **任务「强制引用」的规范** —— plan 标注的 docs/guides/ 文件 + 章节标题(schema 任务 → ddl.md + model-standards.md;接口 → interface-standards.md;动码 → coding-standards.md),要求 implementer 开工前读;controller 不自行补齐(标注是 plan 的职责,缺标注是 plan 质量问题)

另给:依赖任务的完成摘要、相关代码上下文、验证命令。**不给**:无关子计划、其他任务的实现细节、会诱导扩范围的背景材料。implementer 觉得不够 → 返回 `NEEDS_CONTEXT`;可允许它只读 `index.md`,仍不读完整 plan 目录。

### status 协议

| Status | 主 agent 处理 |
|---|---|
| **DONE** | sanity check → 进下个任务 |
| **DONE_WITH_CONCERNS** | concerns 关于 correctness/scope/plan drift → 先解决;关于 observation(如"文件偏大")→ 记录后进 sanity check |
| **NEEDS_CONTEXT** | 补 context 重派 |
| **PLAN_CONFLICT** | 暂停,回到用户/plan/spec 确认。小偏差(实现细节/行号/变量名)implementer 自行调整并报告;大偏差(架构/模块缺失/业务规则/数据口径/API/权限/schema/验收要变)必须上报,不得让 implementer 自行换方案 |
| **BLOCKED** | 辨因:context 不够 → 补;推理不够 → 换更强 model;任务太大 → 拆分;plan 错了 → 上报。不许同 model 原地重试 |

### sanity check(每任务)

看:改了哪些文件 / 测试是否真绿 / 自审发现是否已修 / 契约与引用的规范条目是否被遵循。不通过 → 派 implementer 修 / 补 context / 主 agent 微修 / 上报。

### 主 agent 微修(仅低风险)

同时满足才可亲自动手:问题已定位到具体文件/行 + 不碰业务规则/公共契约/schema/权限/安全/范围 + ≤2 文件 + 改完能立刻验证。否则派子 agent。

### spec-reviewer(可选,默认不派)

plan 完整性已在 Plan Review 审过。仅这些情况派:任务探索性强(实际行为 plan 无法预知)/ 跨多文件耦合(如改公共类型签名)/ plan-reviewer 标了高风险 / 用户要求 / plan 没过 Plan Review。用 `spec-reviewer-prompt.md` 模板。

### 并行收口

同批任一任务返回 BLOCKED / NEEDS_CONTEXT / DONE_WITH_CONCERNS(correctness/scope)→ 暂停同批后续合并,先解决。同批完成后必须看整体 `git diff`:无文件冲突、无重复实现、无命名分叉,才进下一批。实际发生冲突 → 改串行。

### 派任模板

Read 模板 + 任务/审查目标拼成 prompt,派 `general-purpose`:

- `./implementer-prompt.md` —— 每任务必派
- `./spec-reviewer-prompt.md` —— 可选
- `./quality-reviewer-prompt.md` —— 最终必派一次

## 收尾

1. 汇报:完成清单 / 修复历史 / 剩余风险 / plan 忠实度(`PLAN_FOLLOWED` / `PLAN_ADAPTED` / 是否出现并解决过 `PLAN_CONFLICT`)
2. 知识沉淀提示(确有内容才问):本次交付让某业务实体参与了新业务或出现新实体(实体 = 名词可指代、有属性和生命周期的业务对象)→ 新建/更新 `concept` 主条目,流程条目在 concepts 声明该实体;或踩坑/隐式约束/取舍决策/跨文件关系值得复用。列候选清单问用户;确认 → 走 `code-impact-markdown` 完整流程。不要自己直接 Write .md
3. 提示 commit / PR,停下等用户

## 红线(绝对不能做)

1. ❌ **未证明无冲突不得并行**:并行须同时满足——plan 标"可并行"且无依赖、文件集不重叠(同目录也要改动对象分离)、不共享 schema/公共类型/API/配置/fixture/锁/生成物、验证命令不互染状态、prompt 写明本批清单与"禁碰他任务文件"。默认串行。
2. ❌ **不让 implementer 读完整 plan** —— 只拿四件套,防跑偏、省 Read。
3. ❌ **quality-reviewer 最终必派且仅一次** —— 不跳过、不每任务派、不在自审 + sanity check 通过前派。
4. ❌ **不忽略 BLOCKED 同 model 重试** —— 卡住必有原因。
5. ❌ **不忽略 PLAN_CONFLICT 让子 agent 临场换方案** —— 契约级冲突必须回到 controller/用户/spec-plan。
6. ❌ **主 agent 不绕过子 agent 做实质实现** —— 微修可以,接手不行(主 agent 上下文要留给协调)。
7. ❌ **不在主分支直接派 implementer** —— 先有 feature 分支或 worktree。
8. ❌ **不自动 commit / push** —— 收尾后停下,归用户决定。
