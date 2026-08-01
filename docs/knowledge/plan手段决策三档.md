---
title: plan 手段决策三档
document_type: decision
domains:
  - skill 流程
concepts:
  - 手段决策三档
aliases:
  - 业务可观察性分档
  - 手段自主与回跳
  - plan 手段自主
  - 手段回跳 spec
tags:
  - skill 流程
  - write-plan
  - write-spec
  - 手段决策
status: active
source_type: work_context
owners:
  - liulongfei
related_code:
  - assets/claude-template/skills/write-plan/SKILL.md
  - assets/claude-template/skills/write-spec/SKILL.md
  - assets/claude-template/skills/clarify-requirements/SKILL.md
  - assets/claude-template/FLOW-MAP.md
related_documents:
  - docs/knowledge/测试流程后置.md
  - docs/knowledge/澄清苏格拉底单问.md
created: 2026-08-01
updated: 2026-08-01
---

# plan 手段决策三档

## Summary

plan 的实现手段决策**按业务可观察性分档**,判别一句:**手段有没有 spec 信封外的业务可观察后果?** 无(纯工程手段:内部结构 / 复用哪个既有模块 / 规范内命名 / 同步内实现细节)→ **plan 自主决定**并记入 index(选项 + 推荐 + 理由,透明可复审,不必用户拍板);有(选异步 ⇒ 用户看到"处理中"、软删 ⇒ 审计口径、选三方 ⇒ 成本/能力)→ 这是伪装成技术决策的业务决策,**回跳 write-spec 让业务拍板补契约**再定手段。**回跳是例外阀门,不是常规流程**。本条记录该决策:取代原先"所有手段都选项 + 推荐 + 用户拍板"的保守做法(把用户不在乎的纯工程问题也抛给用户,换来"随便你"式回答),放权纯工程、保留业务升级通道。

## 决策与背景

- 澄清分两段:clarify 锁**业务边界**(业务拍板人能回答的),plan 做**手段决策**(需代码现实才能回答的)。曾考虑"澄清全部前置进 clarify、plan 纯消费"——但 plan 的"方案澄清"实际是两件事:纯工程手段(根本不是澄清,是工程裁量)+ 有业务可观察后果的手段(伪装成技术决策的业务决策)。
- 后者**只有分析了实现才浮现**(不读代码不知道选异步会逼出"处理中"需求),无法前置——plan 的「回跳规则」就是它的出口:发现即回跳 spec 补契约。所以 plan 不能"纯消费无上行通道",回跳省不掉。

## 备选方案(为何不选)

- **澄清全部前置进 clarify,plan 纯消费**:做不到——业务可观察手段只有实现分析后才知("you can't clarify what you can't yet know");强行前置要么把 plan 的代码分析并进 clarify(失去分阶段意义、违背"少前期文档"),要么无代码现实拍手段(clarify HARD-GATE「不编造」禁止)。否决。
- **所有手段都用户拍板**(原状):过度保守,纯工程问题也问用户,换"随便你"式回答(比给自主权更糟)。否决。

## 关键设计与风险

- 判别器 leading word:「业务可观察后果」+ 现成的「回跳」「信封」;不造 A/B 标签(自造词不招募预训练先验)。
- 单一事实源:三档模型完整定义在 write-plan 定位节;write-spec / clarify / FLOW-MAP / reviewer 均为指针 echo。
- **残余风险**:plan 把业务可观察手段误判为纯工程 → 悄悄替业务拍板。护栏三道:write-plan 定位给 B 类判别示例 + 红线「越信封 → 回跳,不夹带」+ subagent-implement 的 spec-reviewer 实现期再审;并以透明(plan 记录手段决策,事后可见可改)兜底。

## 代码入口

- `assets/claude-template/skills/write-plan/SKILL.md` — 定位节"手段按业务可观察性分档"(判别器 + 自主支 + 回跳支);工作流程 step3;index「实现手段决策」节。
- `assets/claude-template/skills/write-spec/SKILL.md` — 边界节:手段选型在 plan,纯工程自主 / 业务可观察回跳。
- `assets/claude-template/FLOW-MAP.md` — 依赖图与"设计流程·分工":手段按业务可观察性分档。

## Open Questions

- "业务可观察后果"边界非完全可判定,误判 B 为 A 是放权固有代价;判别示例集可随真实案例积累扩充。
