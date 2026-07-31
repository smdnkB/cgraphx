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
   → 任务标了「独立提交」且 sanity check 通过 → 按 plan「提交规范」节提交(小步原子提交)

3. 全部完成 → 派 quality-reviewer 整体审查(必派、仅一次、在自审+sanity check 之后)
   → 不通过:主 agent 微修或派 fix 子 agent → 重审

4. 收尾:汇报 + 沉淀提示 + 未提交任务的 commit/PR 交用户决定(push 永远归用户)
```

### 派任:四件套注入

不把整套 plan 丢给 implementer。每个子 agent 的 prompt 只装:

1. **任务全文**(含 必须严格执行 / 允许局部适配 / 完成条件 / 对应 spec 条款)
2. **index.md 契约节** —— 该任务引用的跨任务共享契约,原文注入(不是"见 index"的指涉)
3. **任务引用的 spec 条款** —— 原文,不转述
4. **任务「强制引用」的规范** —— plan 标注的 docs/guides/ 文件 + 章节标题(schema → data-standards.md;接口 → interface-standards.md;动码 → coding-standards.md;测试 → testing-standards.md),要求 implementer 开工前读;controller 不自行补齐(标注是 plan 的职责,缺标注是 plan 质量问题)

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

### 独立提交(按 plan 标注,小步原子提交)

任务标了「独立提交:是」且 sanity check 通过 → 主 agent 提交该任务(不等到全部完成)。这是**用户批准 plan 时一并批准的提交**,不是擅自提交——plan 里写了提交粒度与 message 主题,用户过审 plan 即认可。

- **谁提交:主 agent(controller),不是 implementer**。决定性理由是**验证时序**:单任务时序是「派 implementer → 处理 status → sanity check → 标记完成」,sanity check 发生在 implementer 返回**之后**。若 implementer 自己提交,它是在「自报完工」时提交,controller 的 sanity check 还没跑——一旦不过(测试没真绿、契约被违反),就落了个坏提交得 amend/revert 去擦。提交点必须和验证闸门同侧,而闸门在 controller 手里,所以只有 controller 能保证「只提交验证过的东西」。次要理由:一个写手 = 一种 message 风格(N 个子 agent 各写各的会漂移);controller 手里本来就有 plan 的「提交规范」节。提交是 git 收纳动作,不是「实质实现」,不违反红线⑥。
- **stage 范围**:implementer 在 DONE 摘要里**报告它改动的确切文件清单**,controller 精确 stage 这些文件后提交。默认串行下这很干净——前面任务都已提交,工作区只剩当前任务的改动。implementer 只改文件、不 `git add`/`commit`(职责边界见 `implementer-prompt.md`)。
- **并行批的边界**:「独立提交」是**串行流程**的特性。并行批次里,现有流程要求「同批完成后看整体 git diff、确认无冲突」才收口,所以并行批的提交单位是「批」不是「单任务」——批内任务即便标了独立提交,也是批末验证无冲突后统一提交。
- **怎么写**:按 plan「提交规范」节(从 `git-standards.md` 结晶的提交消息格式 + 提交前检查点)写 message、过检查点。规范已在 plan 上下文里,不必现场重读 `git-standards.md`。
- **与 precommit 门禁的关系**:门禁仍会拦,但规范已结晶——自查按 plan 已列的检查点过即可,然后 `CGRAPHX_PRECOMMIT_REVIEWED=1 git commit` 重试。门禁退化为兜底,不再是每次提交的学习成本。
- **没标「独立提交」的任务**:不擅自提交,改动累积,收尾时连同未提交部分一起交用户决定。
- **push 永远归用户**:即使任务已提交,是否 push、何时 push 由用户定。

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
2. 知识沉淀提示(确有内容才问):本次交付让某业务实体参与了新业务或出现新实体(实体 = 名词可指代、有属性和生命周期的业务对象)→ 新建/更新实体主条目(`business-entity`),流程条目在 concepts 声明该实体;或踩坑/隐式约束/取舍决策/跨文件关系值得复用。列候选清单问用户;确认 → 走 `knowledge-write` 完整流程。不要自己直接 Write .md
3. 提示收尾:已按 plan「独立提交」标注提交的任务清单 + 未提交任务的 commit / PR 交用户决定;push 永远归用户。停下等用户

## 红线(绝对不能做)

1. ❌ **未证明无冲突不得并行**:并行须同时满足——plan 标"可并行"且无依赖、文件集不重叠(同目录也要改动对象分离)、不共享 schema/公共类型/API/配置/fixture/锁/生成物、验证命令不互染状态、prompt 写明本批清单与"禁碰他任务文件"。默认串行。
2. ❌ **不让 implementer 读完整 plan** —— 只拿四件套,防跑偏、省 Read。
3. ❌ **quality-reviewer 最终必派且仅一次** —— 不跳过、不每任务派、不在自审 + sanity check 通过前派。
4. ❌ **不忽略 BLOCKED 同 model 重试** —— 卡住必有原因。
5. ❌ **不忽略 PLAN_CONFLICT 让子 agent 临场换方案** —— 契约级冲突必须回到 controller/用户/spec-plan。
6. ❌ **主 agent 不绕过子 agent 做实质实现** —— 微修可以,接手不行(主 agent 上下文要留给协调)。
7. ❌ **不在主分支直接派 implementer** —— 先有 feature 分支或 worktree。
8. ❌ **不超出 plan「独立提交」标注擅自 commit,绝不自动 push** —— plan 标了独立提交的任务可按 plan 结晶的规范提交(用户批准 plan 即批准这些提交);未标注的任务不擅自提交,累积到收尾交用户;push 任何情况下都归用户决定。
