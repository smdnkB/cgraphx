---
title: skill invocation 轴
document_type: decision
domains:
  - skill 流程
concepts:
  - skill invocation 轴
aliases:
  - disable-model-invocation
  - user-invoked
  - model-invoked
  - 用户调用型
  - 模型调用型
tags:
  - skill 流程
  - writing-great-skills
  - context-load
status: active
source_type: work_context
owners:
  - liulongfei
related_code:
  - assets/claude-template/skills/knowledge-migrate/SKILL.md
  - assets/claude-template/skills/write-workload/SKILL.md
  - assets/claude-template/skills/write-prd/SKILL.md
  - assets/claude-template/skills/write-design-doc/SKILL.md
  - assets/claude-template/skills/write-api-doc/SKILL.md
  - assets/claude-template/skills/export-table-ddl/SKILL.md
  - assets/claude-template/skills/init-project-guides/SKILL.md
  - assets/claude-template/skills/handdrawn-deck/SKILL.md
  - assets/claude-template/skills/developer-timeline/SKILL.md
  - assets/claude-template/skills/knowledge-init/SKILL.md
created: 2026-08-01
updated: 2026-08-01
---

# skill invocation 轴

## Summary

一个 skill 该 model-invoked 还是 user-invoked,判据是 writing-great-skills 的 invocation 轴:**agent 需要在自己判断下触发它、或别的 skill 需要调用它 → model-invoked**(保留 description,付每轮 context load);**只有人手敲名字才跑 → user-invoked**(`disable-model-invocation: true`,零 context load,付 cognitive load)。两个硬信号强制 model-invoked:① 设计上由 agent 自动触发;② 被另一个 skill 在正文里**调用**(文字推荐不算)。2026-08-01 据此把 10 个"用户决定才跑"的工具型 skill 转 user-invoked,常驻 description 25→15。user-invoked skill 多了靠 **router**(cgraphx-guide / FLOW-MAP)治 cognitive load——它们仍被列在索引里,agent 仍能文字推荐,用户敲名字即可,推荐链不断。

## 决策与背景

- 原 25 个 skill 全 model-invoked,description 全在每轮上下文,context load 重。writing-great-skills 明确:model-invoked 是"必须"才用(需自主触达),否则 user-invoked 省 load。
- 决策(2026-08-01):转 10 个——knowledge-migrate / write-workload / write-prd / write-design-doc / write-api-doc / export-table-ddl / init-project-guides / handdrawn-deck / developer-timeline / knowledge-init(均验证无入站调用,全是文字推荐 / 路由列举 / "提示用户跑")。

## 保留 model-invoked 的 15 个(判据落地)

- **7 硬 keeper**:clarify-requirements(需求自动入口)、knowledge-recall / knowledge-api(CLAUDE.md 明示 agent 自动召回)、knowledge-write(被 implementation / subagent / knowledge-init 调用)、db-query(被 clarify / plan / write-api / run-api-test 流程中调用)、cgraphx-guide(怎么用时自动触发,且是 router)、handdrawn-sketch-engine(被 handdrawn-deck 委托调用)。
- **8 个对话式触发**:implementation / subagent-implement / write-spec / write-plan / write-api / run-api-test / write-unit-test-spec / write-unit-test-code——常由自然语言("实现一下""写 spec""补接口测试")顺手触发,留 model-invoked 保自然语言手递。

## 关键约束

- 转 user-invoked 只加 `disable-model-invocation: true` 即可零 context load(description 不再进上下文,长短无所谓,摘要无需改写)。
- **被调用方必须 model-invoked**:user-invoked skill 调用别人时,被调方要可发现——如 knowledge-init(user)调用 knowledge-write(model)、handdrawn-deck(user)调用 sketch-engine(model),后者保持 model-invoked 才能被调到。
- 出站调用与入站调用要分清:handdrawn-deck **调** sketch-engine(故 deck 可 user、engine 必 model);write-api 与 run-api-test"不互相调用"(故可按各自触发方式独立定)。

## 代码入口

- 各 skill `SKILL.md` frontmatter `disable-model-invocation: true`(上述 10 个)。
- router:`assets/claude-template/skills/cgraphx-guide/SKILL.md`、`assets/claude-template/FLOW-MAP.md`(列全部 skill 与时机,治 cognitive load)。

## Open Questions

- B 组 8 个(implementation / write-spec 等)目前留 model-invoked 保自然语言触发;若使用习惯偏显式敲命令,可再转 user-invoked 进一步省 load。
