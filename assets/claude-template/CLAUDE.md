## 项目介绍
这是一个【项目类型】项目,主要功能包含【核心功能】。

本项目用 cgraphx 的 skill 流程做需求。已有的流程能力:
1. **开发流程**:`/clarify-requirements`(澄清)→ `/write-spec`(规格)→ `/write-plan`(可选)→ `/implementation` / `/subagent-implement`(实现)
2. **单元测试流程**:`/write-unit-test-spec` → `/write-unit-test-code`
3. **接口测试流程**:`/write-api` → `/run-api-test`(写接口必查 DB 验数据,HTTP 200 ≠ 通过)
4. **知识库能力**:`/code-impact-markdown` 沉淀;`knowledge-recall` / `code-impact-api` 自动召回;底层走 `cgraphx docs` / `cgraphx db` / `cgraphx timeline`
5. **数据库能力**:`/export-table-ddl` 建表结构基线、周期校准;`db-query` 查数据、探索发现回写 DDL 的 DISCOVERED 块

## 项目约定

- **schema 变更约定(全量+增量双层维护)**:见 `docs/guides/ddl.md`「Schema 变更约定」节——动表时按其命名与维护规则执行(规范缺失先 `/init-project-guides` 补齐,动表前必读)。

你负责按阶段推进需求,并在每个任务/阶段收尾时**主动给出下一步建议**(2–4 条,标注对应 skill;不要每轮都附,用户已明确就直接执行)。阶段判断:看需求目录 `docs/features/<日期>-<编号>-<前缀>/` 已有产物(有无 spec / plan / 实现)+ 对话上下文。
