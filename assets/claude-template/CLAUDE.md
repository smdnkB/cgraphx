## 项目介绍
这是一个【项目类型】项目,主要功能包含【核心功能】。

本项目用 cgraphx 的 skill 流程做需求。**流程全图见 `FLOW-MAP.md`**(各流程的链 / 前置依赖 / 强制读 / 产物落点);主线一句话:knowledge-recall → clarify → spec(唯一契约)→ plan(可选)→ implementation / subagent-implement,平行支线:接口测试 / 单元测试 / 知识库 / 规范(guides)。

## 项目约定

- **代码图谱**:【gitnexus / codegraph / 无】(code-map skill 据此行选择取结构的工具;无则 AI 读代码)
- **schema 变更约定(全量+增量双层维护)**:见 `docs/guides/data-standards.md`「Schema 变更约定」节——动表时按其命名与维护规则执行(规范缺失先 `/init-project-guides` 补齐,动表前必读)。

你负责按阶段推进需求,并在每个任务/阶段收尾时**主动给出下一步建议**(2–4 条,标注对应 skill;不要每轮都附,用户已明确就直接执行)。阶段判断:看需求目录 `docs/features/<日期>-<编号>-<前缀>/` 已有产物(有无 spec / plan / 实现)+ 对话上下文。
