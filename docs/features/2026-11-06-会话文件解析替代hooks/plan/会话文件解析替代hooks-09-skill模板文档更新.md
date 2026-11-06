# T-9: skill 模板文档更新

> 产物: plan
> 依据: spec@eac0b58

### 目标

模板资产(`assets/claude-template/`,**不是**本仓库 `.claude/`)里所有讲「hook 采集、precommit 门禁」的地方改成新机制的说法;release-review 增「跳过门禁的提交」一节;doc-report 的事件种类段跟上 D8。

### 对应 spec 编号

「文档与知识库」表的 skill 行:F1(doc-report)、F2(门禁说法)、F3(release-review)、F5(cgraphx-guide、模板 CLAUDE.md)

### 强制引用

无(文档任务)

### 涉及范围

- `assets/claude-template/skills/doc-report/SKILL.md`
- `assets/claude-template/skills/release-review/SKILL.md`
- `assets/claude-template/skills/dev-impl/SKILL.md`、`dev-impl-subagent/SKILL.md`、`doc-backfill/SKILL.md`、`init-guides/SKILL.md`、`init-guides/templates/git-standards.md`、`cgraphx-guide/`(SKILL.md 及其中提及 hooks 的 html/引用文件)、`dev-clarify/SKILL.md`、`dev-merge/SKILL.md`、`dev-start/SKILL.md`(以 grep 实际命中为准)
- `assets/claude-template/FLOW-MAP.md`
- `assets/claude-template/CLAUDE.md`(模板根,部署后是各项目的指引块)

### 必须严格执行

- **门禁机制说法改、用法不变**(F2):所有讲「提交门禁拦下时按检查点自查、带 `CGRAPHX_PRECOMMIT_REVIEWED=1` 重试」的地方,机制描述改成「git 提交门禁(commit-msg 钩子)」;自查、带变量重试的指引原样保留。已知命中(以 grep 复扫为准):`dev-impl/SKILL.md:27`、`dev-impl-subagent/SKILL.md:58`、`doc-backfill/SKILL.md:97`、`release-review/SKILL.md:103`、`FLOW-MAP.md:146`、`init-guides/SKILL.md:19`、`init-guides/templates/git-standards.md:3`。
- **doc-report**(D8 影响面):事件种类段去掉 `pre_tool_use`,`stop` 改说「轮次结束」;`cgraphx timeline install` 那段改成「提交记录」;讲「查时间线前自动补录会话文件」补一句(新行为,agent 用的命令不变)。
- **release-review**(F3 行为链):报告多一节「跳过门禁的提交」——用现有 `cgraphx timeline query --type git_commit` 按 `metadata.gate = 'skipped'` 列提交号、说明和会话;没有写「无」;有就进「风险」、结论写「有风险」;风险规则加这一项。原有「疑似夹带」逻辑不动(人在版本分支 `--no-verify` 提交仍走那一节)。
- **cgraphx-guide / 模板 CLAUDE.md**(F5):接入方式改「不需要 agent 支持 hook,只要能读会话文件」;hook 清单里去掉 7 条时间线 hook 与 precommit-check 的描述;`cgraphx timeline install` 的说明改「只装提交记录片段」;git 钩子门禁的说明补上。
- 改动只动说法与新增节,**不改各 skill 的流程步骤本身**。

### 允许局部适配

- 具体措辞;命中点超出上面清单时(如 cgraphx-guide 的 html 里也有),一并改掉,口径一致。

### 具体要求

1. 先跑 `grep -rn "precommit-check\|CGRAPHX_PRECOMMIT_REVIEWED\|提交门禁\|timeline.*hook\|SessionStart" assets/claude-template/ --include="*.md"`(html 另扫一遍),列出全部命中点再逐处改。
2. release-review 新节写在「风险」相关的位置(和「疑似夹带」并列);引用的查询命令保持可直接执行。
3. 模板 CLAUDE.md 的 cgraphx 段落与 FLOW-MAP 的门禁行同步(FLOW-MAP.md:146 的「precommit-check 门禁兜底」改为 git 门禁兜底说法)。

### 完成条件

- 模板内 grep 不到「precommit-check」作为现行机制的表述(历史 changelog 类文件除外,如有);
- `npm run build` 通过(copy-assets 会把模板带走,确认无遗漏文件);
- 人读一遍改动 diff,说法与 index 设计预览一致。

### 提交点

1. `docs(skills): 门禁与时间线机制说法更新——git 钩子门禁+会话文件补录+release-review 跳过门禁一节`:本任务全部文件

### 风险/注意事项

- 修改入口是 `assets/claude-template/`,不是本仓库根的 `.claude/`(那里是已部署的运行环境,可能滞后,不要照它改)。
- `init-guides/templates/git-standards.md` 是给目标项目生成的模板:门禁触发方式的描述改,「提交前检查点」的结构不动。
