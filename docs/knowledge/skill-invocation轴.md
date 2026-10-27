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
  - assets/claude-template/skills/doc-delivery/SKILL.md
  - assets/claude-template/skills/doc-workload/SKILL.md
  - assets/claude-template/skills/init-ddl/SKILL.md
  - assets/claude-template/skills/init-guides/SKILL.md
  - assets/claude-template/skills/doc-report/SKILL.md
  - assets/claude-template/skills/init-knowledge/SKILL.md
  - assets/claude-template/skills/dev-impl-subagent/SKILL.md
  - assets/claude-template/skills/visual-explain/SKILL.md
  - assets/claude-template/skills/knowledge-migrate/SKILL.md
created: 2026-08-01
updated: 2026-10-27
---

# skill invocation 轴

## Summary

一个 skill 该 model-invoked 还是 user-invoked,判据是 writing-great-skills 的 invocation 轴:**agent 需要在自己判断下触发它、或别的 skill 需要调用它 → model-invoked**(保留 description,付每轮 context load);**只有人手敲名字才跑 → user-invoked**(`disable-model-invocation: true`,零 context load,付 cognitive load)。两个硬信号强制 model-invoked:① 设计上由 agent 自动触发;② 被另一个 skill 在正文里**调用**(文字推荐不算)。2026-08-01 据此把 10 个"用户决定才跑"的工具型 skill 转 user-invoked,常驻 description 25→15。user-invoked skill 多了靠 **router**(cgraphx-guide / FLOW-MAP)治 cognitive load——它们仍被列在索引里,agent 仍能文字推荐,用户敲名字即可,推荐链不断。2026-10-27 新增 knowledge-migrate 后为 27 个:19 个 model-invoked、8 个 user-invoked,见文末更新。

## 决策与背景

- 原 25 个 skill 全 model-invoked,description 全在每轮上下文,context load 重。writing-great-skills 明确:model-invoked 是"必须"才用(需自主触达),否则 user-invoked 省 load。
- 决策(2026-08-01):转 10 个——knowledge-migrate / doc-workload / write-prd / write-design-doc / write-api-doc / init-ddl / init-guides / handdrawn-deck / doc-report / init-knowledge(均验证无入站调用,全是文字推荐 / 路由列举 / "提示用户跑")。

## 保留 model-invoked 的 15 个(判据落地)

- **7 硬 keeper**:dev-clarify(需求自动入口)、knowledge-recall / knowledge-api(CLAUDE.md 明示 agent 自动召回)、knowledge-write(被 dev-impl / subagent / init-knowledge 调用)、db-query(被 clarify / plan / api-case / api-run 流程中调用)、cgraphx-guide(怎么用时自动触发,且是 router)、handdrawn-sketch-engine(被 handdrawn-deck 委托调用)。
- **8 个对话式触发**:dev-impl / dev-impl-subagent / dev-spec / dev-plan / api-case / api-run / unit-spec / unit-code——常由自然语言("实现一下""写 spec""补接口测试")顺手触发,留 model-invoked 保自然语言手递。

## 关键约束

- 转 user-invoked 只加 `disable-model-invocation: true` 即可零 context load(description 不再进上下文,长短无所谓,摘要无需改写)。
- **被调用方必须 model-invoked**:user-invoked skill 调用别人时,被调方要可发现——如 init-knowledge(user)调用 knowledge-write(model)、handdrawn-deck(user)调用 sketch-engine(model),后者保持 model-invoked 才能被调到。
- 出站调用与入站调用要分清:handdrawn-deck **调** sketch-engine(故 deck 可 user、engine 必 model);api-case 与 api-run"不互相调用"(故可按各自触发方式独立定)。

## 代码入口

- 各 skill `SKILL.md` frontmatter `disable-model-invocation: true`(上述 10 个)。
- router:`assets/claude-template/skills/cgraphx-guide/SKILL.md`、`assets/claude-template/FLOW-MAP.md`(列全部 skill 与时机,治 cognitive load)。

## Open Questions

- B 组 8 个(dev-impl / dev-spec 等)目前留 model-invoked 保自然语言触发;若使用习惯偏显式敲命令,可再转 user-invoked 进一步省 load。

## 2026-10-19 更新(skill瘦身)

2026-10-19 瘦身废弃 8 个 skill(knowledge-api、code-map-write、code-map-recall、write-prd、write-design-doc、write-api-doc、knowledge-migrate、write-delivery-guide),合并 2 处(knowledge-api 并入 knowledge-recall;write-prd、write-design-doc、write-api-doc 合成 doc-delivery),新增 visual-explain,后剩 27 个。

- model-invoked 19 个:cgraphx-guide、dev-clarify、db-query、handdrawn-sketch-engine、dev-handoff、dev-impl、knowledge-recall、knowledge-write、api-run、ui-run、dev-impl-subagent、visual-explain、api-case、dev-plan、dev-spec、ui-case、unit-code、unit-spec、dev-wireframe。
- user-invoked 8 个:doc-report、init-ddl、handdrawn-deck、doc-backfill、init-guides、init-knowledge、doc-delivery、doc-workload。

doc-delivery 沿用 write-prd、write-design-doc、write-api-doc 三个旧 skill 的 user-invoked;knowledge-api 并入 knowledge-recall 后,knowledge-recall 仍是 model-invoked。dev-impl-subagent 保留并改写,仍是 model-invoked,用户说「跑 plan」「按 plan 实现」时由 AI 调用。新增的 visual-explain 也是 model-invoked:用户说「没看懂」「画个图讲讲」时由 AI 调用,用户没要求时不主动出页面。

## 2026-10-20 更新(删掉手绘两个 skill)

2026-10-20 删掉 handdrawn-deck、handdrawn-sketch-engine,它们不属于开发流程;skill 剩 25 个。

- model-invoked 18 个:cgraphx-guide、dev-clarify、db-query、dev-handoff、dev-impl、knowledge-recall、knowledge-write、api-run、ui-run、dev-impl-subagent、visual-explain、api-case、dev-plan、dev-spec、ui-case、unit-code、unit-spec、dev-wireframe。
- user-invoked 7 个:doc-report、init-ddl、doc-backfill、init-guides、init-knowledge、doc-delivery、doc-workload。

这两个 skill 已登记进 `deprecated-assets.json`,`cgraphx install` 升级时清掉。

## 2026-10-24 更新(新增 audit-login-security)

2026-10-24 新增 audit-login-security(登录/认证安全审计),skill 共 26 个。

- model-invoked 19 个:上一版 18 个 + audit-login-security。
- user-invoked 7 个:不变。

判据:它要能被「帮我看看登录有没有漏洞」「登录接口会不会被绕过」这类自然语言顺手触发,不是只靠人敲命令名;且它不调用别的 skill、也不被别的 skill 调用,没有出站/入站约束。


## 2026-10-25 更新(按阶段加前缀改名)

2026-10-25 按使用阶段给 skill 加前缀,改名 20 个,invocation 类型都不变;上文各版名单已换成新名。前缀:`init-` 项目接入、`dev-` 做需求主线、`api-` / `ui-` / `unit-` 三条测试线、`doc-` 事后文档与汇报。knowledge-recall、knowledge-write、db-query、visual-explain、audit-login-security、cgraphx-guide 不改名。`/end` 命令同步改为 `/dev-end`。

新旧名对照见 CHANGELOG;旧目录已登记进 `deprecated-assets.json`,`cgraphx install` 升级时清掉,不会新旧两套同时触发。

## 2026-10-27 更新(新增 knowledge-migrate,沿用旧名)

2026-10-27 新增 knowledge-migrate:把 Claude Code 自动记忆迁进知识库、项目 CLAUDE.md 或个人 CLAUDE.md,再关掉本人的自动记忆。名字沿用 2026-10-19 废弃的知识库分类迁移 skill,两者无关;skill 共 27 个。

- model-invoked 19 个:不变。
- user-invoked 8 个:上一版 7 个 + knowledge-migrate。

判据:只有人敲 `/knowledge-migrate` 才跑,每人每个项目一次;它按 knowledge-write 的规则写知识库是文字引用、不是调用,也没有别的 skill 调它。关掉记忆后「以后都这样做」的去向提问由 task 的 SessionStart 注入,不靠它的 description 触发。旧名已从 `deprecated-assets.json` 撤下:清理在部署之后跑,留着会把新 skill 一装上就删掉。
