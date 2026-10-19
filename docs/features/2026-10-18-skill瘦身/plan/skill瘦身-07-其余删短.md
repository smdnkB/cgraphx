# 实现计划: skill瘦身 · 批次 7 其余删短

> 产物: plan
> 依据: spec@cf4712c

## 共用约定

本文件的任务都改 skill 模板,执行前先读完本节。

1. 分支:在 `feat/skill瘦身` 上做(没有就从 `main` 建);开工前 `git status` 确认暂存区是空的。
2. 改动入口:只改 `assets/claude-template/` 下的文件;本仓库根目录的 `.claude/` 不动。不改 `docs/` 下任何已有文件。
3. 删减规则(spec §4.1):本文件的 7 个 skill 都是设计侧,做法和产出不变,只删短:删跨 skill 重复的规则、程序会检查的规则、通用方法论、长篇 ❌ 清单、逐条自检、为防较弱模型跑偏写的解释;HARD-GATE、红线、范例、脚本、命令保留。只删任务点名的内容,没点名的段落不动。
4. 写法(spec §4.3):靠删内容瘦身,不把句子写紧;新写或改写的句子不用箭头(→)、不用斜杠并列(甲/乙)、不用自造缩写;没被要求改的句子不为改写而重写。
5. 已废弃的 skill 不再作为现行用法出现:subagent-implement 改为「大需求由 `/write-plan` 分批,每批一个会话跑 `/implementation`」;knowledge-api 改为 knowledge-recall;代码地图不再维护,查代码结构直接用 grep、Read。
6. 每个任务做完:
   - `grep -n -e subagent-implement -e knowledge-api -e code-map -e write-prd -e write-design-doc -e write-api-doc -e knowledge-migrate -e write-delivery-guide <本任务改过的文件>` 无结果;
   - SKILL.md 开头的 frontmatter 完整(`name`、`description`,原有的 `disable-model-invocation`、`version` 等字段不动);
   - `npm run build` 通过。
7. 提交:标题格式 `type(scope): 中文描述`,补充说明用「——」,并列用「+」;每个 skill 一笔。本仓库的提交门禁会先拦一次,自查后用 `CGRAPHX_PRECOMMIT_REVIEWED=1 git commit ...` 重试。
8. 遇到任务要求和 spec 冲突、要改范围外的文件、点名要删的段落找不到,停下写 `PLAN_CONFLICT: <原因>`。

## T-19: knowledge-write、db-query、export-table-ddl 删短

- 目标:三个 skill 做法和产出不变,删掉重复和解释性内容;表结构知识的闭环规则只留在 db-query 一处。
- 对应 spec 条款:§3.3(其余 skill 只按 §4 删短)、§4.1、§10(knowledge-write 里对已废弃 skill 的引用)。
- 强制引用:无。
- 依赖:无。
- 涉及范围:
  - `assets/claude-template/skills/knowledge-write/SKILL.md`
  - `assets/claude-template/skills/db-query/SKILL.md`(`agent-prompt.md` 不动)
  - `assets/claude-template/skills/export-table-ddl/SKILL.md`(`closed-loop.html`、`scripts/`、`evals/` 不动)
- 必须严格执行:
  - DISCOVERED 块格式、枢纽表原则、`pending-comments.sql` 规则、schema-knowledge 闭环,权威位置在 db-query;export-table-ddl 只留一句指向它。
  - knowledge-write 的 frontmatter 规范、枚举、模板表、命名与语言、维护规则、红线保留。
- 允许局部适配:删除段落后的过渡语。
- 具体要求(knowledge-write):
  1. 「双层结构」最后一条里「implementation/subagent-implement 收尾会提示识别实体」改为「implementation 收尾会提示识别实体」。
  2. 「CLI」的「校验」一条:删掉「规则与 index 扫描一致(单一事实源 `src/core/markdown/validator.ts`):title 非空 · … · updated 为 YYYY-MM-DD」这半句(validate 会检查,枚举已在「Frontmatter 规范」),保留「`docs validate <file>`(exit 0 合法 / 2 非法;`--json` 出 {valid, skipReason, detail})」。
  3. 「质量规则」删掉「**通用**:…」这一条;「应记录」「不记录」两条保留。
- 具体要求(db-query):
  1. 删掉「探索结果收口(给 clarify/spec/plan)」整节。
  2. 「何时派子 agent」删掉「代价」小节;判断规则、例子表、派的方法保留。
  3. 「陌生 schema 探索流程」代码块后面「**长期目标**:…」一段删掉。
  4. 「跨表知识往哪张表写」开头解释访问路径的那段(「agent 的访问路径是…必须塞进 agent 必然落地的表的 DISCOVERED 块:」)压成一句:「跨表知识不单独建文件,写进 agent 必然会读的表的 DISCOVERED 块:」;下面四条规则和「工程级 meta」一段保留。
  5. 「pending-comments.sql」小节删掉「**为什么可以独立**:…」一条;其余保留。
  6. 「schema-knowledge 目录结构」保留目录树和「闭环工作流」四步(这里是闭环的权威位置);删掉「**两类落点,各服务不同对象**」两条(和陌生 schema 流程第 4 步重复)和「两张表的 DDL 文件示例」代码块(格式已在 DISCOVERED 一节)。
- 具体要求(export-table-ddl):
  1. 「闭环:和 db-query skill 配合」整节(含图、DISCOVERED 格式代码块、「知识落在哪」小节)换成两句:「日常改模型时由开发流程直接改全量 `ddl/<表名>.sql`(见 `docs/guides/data-standards.md`「Schema 变更约定」);本 skill 建基线、做周期校准。重导时脚本保留每张表已有的 DISCOVERED 块;块的格式、跨表知识写在哪,见 db-query skill。」
  2. 「代价意识」压成一句:「每张表一次 DB 连接,100 张表的远程库可能要几十秒,所以先确认表清单再批量拉。」
  3. 其余各节不动。
- 完成条件:
  - `grep -n "探索结果收口" assets/claude-template/skills/db-query/SKILL.md` 无结果。
  - `grep -n "=== DISCOVERED" assets/claude-template/skills/export-table-ddl/SKILL.md` 无结果;`grep -n "db-query" assets/claude-template/skills/export-table-ddl/SKILL.md` 仍命中。
  - `grep -n subagent assets/claude-template/skills/knowledge-write/SKILL.md` 无结果。
  - 共用约定第 6 条检查通过。
- 验证方式:上面的 grep;`npm run build`。
- 独立提交:是,三笔。建议标题:`refactor(skills): knowledge-write 删短 + 去掉 subagent-implement 引用`;`refactor(skills): db-query 删短——删探索收口和解释段`;`refactor(skills): export-table-ddl 闭环说明改为指向 db-query`
- 风险/注意事项:`export-table-ddl/closed-loop.html` 是本仓库 CLAUDE.md 引用的全景图,不动。

## T-20: developer-timeline、write-workload、两个手绘 skill 删短

- 目标:四个 skill 做法和产出不变,删掉通用方法论、自检清单、和别处重复的反模式;去掉对 knowledge-api 和 1.x 代码图谱的引用。
- 对应 spec 条款:§3.3(其余 skill 只按 §4 删短)、§4.1、§10(developer-timeline 里对已废弃 skill 的引用)。
- 强制引用:无。
- 依赖:无。
- 涉及范围:
  - `assets/claude-template/skills/developer-timeline/SKILL.md`(`demo-single-page-report.html` 不动)
  - `assets/claude-template/skills/write-workload/SKILL.md`
  - `assets/claude-template/skills/handdrawn-deck/SKILL.md`(`references/` 不动)
  - `assets/claude-template/skills/handdrawn-sketch-engine/SKILL.md`(`references/`、`assets/` 不动)
- 必须严格执行:
  - 两个手绘 skill 删掉验收清单后**不重排章节编号**:`deck-template.html`、`engine-template.html` 里有「SKILL.md §5」「SKILL §7」这类按编号的引用。
  - 手绘引擎的脚本约定、视觉 DNA 数值、渲染类踩坑、deck 的 notes.js 契约和按键分工保留。
- 允许局部适配:删除段落后的过渡语。
- 具体要求(developer-timeline):
  1. 删掉「探索结果收口(给 clarify/spec/plan)」整节。
  2. 删掉「跟其他工具的边界」整节(其中的 `cgraphx` skill 是 1.x 的代码图谱,knowledge-api 已废弃)。
  3. 「报告生成流程」删掉「### 3. 聚合事件,不要流水账」「### 4. 选择叙述方式」两小节(通用写作方法;不写流水账、区分状态等要求已在「内容质量规则」里);「### 5. 生成报告」改为「### 3. 生成报告」。
  4. 「定位」只留第一段和最后一句「报告要提炼成果,不要把 timeline 原始事件流水账贴给用户」;中间「目标是把…聚合成:」一句和下面三条受众列表删掉。
  5. 「适用场景」「输出模式」「1. 确认必须明确的维度」「2. 采集 timeline 数据」「报告模板」「使用习惯分析指标」「内容质量规则」「CLI 数据源参考」「前置条件和失败处理」不动。
- 具体要求(write-workload):
  1. 「这个 skill 的灵魂(先读这段)」改名「五条规则」:五条只留每条的粗体结论和一句规则,删掉每条后面的解释;删掉开头「用户说「汇报工作量」时…别这样」一段和结尾「把这五条内化后…」一句。五条的一句话如下(照抄):
     1. **维度先于内容**:先问清受众和口径再动笔,哪怕只问两三个问题。
     2. **对账必配佐证**:工时拆解要配一层影响范围佐证,回答「就改了这几个文件,要几人天」。
     3. **隐性工时显性化**:需求待确认项核实、外部接口联调、跨服务契约确认、配置映射纠正、返回键核对、多场景自测,逐项列成工时项。
     4. **工时数字不编**:用户给真实记录,或明确授权你估并给区间,你才填,并标明是估算。
     5. **查代码核实交付物**:汇报前回代码核实每一项交付物真实存在,文档和代码有出入以代码为准。
  2. 「流程」各步里的引用块解释删掉:Step 0 末尾「> 问问题的目的不是走流程…」、Step 1 末尾「> 这一步的产出是…」、Step 2 末尾「> 为什么用 preview…」。
  3. 「文档结构」里「> 复杂需求四到五节的范例见下方「真实样例」(req74442)…」这句删掉(文件里没有这一节)。
  4. 删掉「收尾自检(交文档前)」整节。
  5. 「何时触发」「输入」「工时补全规则」「项目约定」不动。
- 具体要求(handdrawn-deck):
  1. 删掉「## 4. deck 级验收清单」整节,其他节编号不变。
  2. 「0. skill 结构与分工」目录树里 `SKILL.md(本文档)` 后面的说明「流程 / 确认单格式 / 组装规范 / 验收」去掉「/ 验收」。
  3. 「1. 编排工作流」⑤ 里「按引擎验收清单自检;」改为「打开页面看一遍逐笔绘制;」;⑦ 里「(§4 验收)」删掉。
  4. 「6. 反模式」只留两条:「跨页同一概念换图标」「跑无头浏览器做「验证」」;其余各条删掉(都已写在「1. 编排工作流」和「5. deck 组装规范」里)。
  5. 「2. 确认单与页面计划格式」「3. 布局词表」「5. deck 组装规范」「7. 引擎协作备忘」不动。
- 具体要求(handdrawn-sketch-engine):
  1. 删掉「## 9. 验收清单」整节,「## 10.」编号不变。
  2. 「4. 调用约定」第 3 步「**3. 自检 + 交付**:按 §9 验收清单过一遍,交付单文件 HTML,」改为「**3. 交付**:打开文件看一遍逐笔绘制,交付单文件 HTML,」(后半句不动)。
  3. 「4. 调用约定」第 1 步末尾「(见 handdrawn-deck §4④ / §7)」改为「(见 handdrawn-deck「1. 编排工作流」第 ④ 步、§7)」。
  4. 「8. 反模式 / 踩坑清单」删掉「**流程类(本 skill 稳定性的根源)**:」及其下五条(都已写在 §4、§5);「**渲染类**」各条保留。
  5. 其余各节不动。
- 完成条件:
  - `grep -n -e knowledge-api -e "跟其他工具的边界" -e "探索结果收口" assets/claude-template/skills/developer-timeline/SKILL.md` 无结果。
  - `grep -n "收尾自检" assets/claude-template/skills/write-workload/SKILL.md` 无结果。
  - `grep -n "验收清单" assets/claude-template/skills/handdrawn-deck/SKILL.md assets/claude-template/skills/handdrawn-sketch-engine/SKILL.md` 无结果;`grep -n "§9" assets/claude-template/skills/handdrawn-sketch-engine/SKILL.md assets/claude-template/skills/handdrawn-deck/SKILL.md` 无结果。
  - 共用约定第 6 条检查通过。
- 验证方式:上面的 grep;`npm run build`。
- 独立提交:是,四笔。建议标题:`refactor(skills): developer-timeline 删短——删探索收口、边界表和通用写法`;`refactor(skills): write-workload 删短——五条规则只留结论 + 删自检`;`refactor(skills): handdrawn-deck 删验收清单和重复的反模式`;`refactor(skills): handdrawn-sketch-engine 删验收清单和流程类踩坑`
- 风险/注意事项:两个手绘 skill 的模板和图标库是成品依赖的资产,一律不动。
