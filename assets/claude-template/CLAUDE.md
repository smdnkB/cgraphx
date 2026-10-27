## 项目介绍
这是一个【项目类型】项目,主要功能包含【核心功能】。

本项目用 cgraphx 的 skill 流程做需求。**流程全图见 `FLOW-MAP.md`**(各流程的链 / 前置依赖 / 强制读 / 产物落点);主线:先用 knowledge-recall 对齐概念,再 clarify 澄清(探索项目现实、定业务口径后,以功能点为单位给行为链提案,人审稿式改稿,结束时给《需求功能方案》,多功能点需求另写一份带 mermaid 流程图的讨论稿;没看懂可以用 visual-explain 出图解),spec 是唯一契约;小需求直接 dev-impl,大需求先 dev-plan,再 dev-impl-subagent 在一个会话里跑完,最后 /code-review。平行支线:接口测试、单元测试、知识库、规范(guides)。

## 项目约定

- **schema 变更约定(全量+增量双层维护)**:见 `docs/guides/data-standards.md`「Schema 变更约定」节——动表时按其命名与维护规则执行(规范缺失先 `/init-guides` 补齐,动表前必读)。

你负责按阶段推进需求,并在每个任务/阶段收尾时**主动给出下一步建议**(2–4 条,标注对应 skill;不要每轮都附,用户已明确就直接执行)。阶段判断:看需求目录 `docs/features/<feature-id>/`(命名见 `docs/guides/feature-standards.md`,没有就按 `YYYY-MM-DD-[业务ID-]<标题>`)已有产物(有无 spec / plan / 实现)+ 对话上下文。
