# 实现计划: skill瘦身 · 批次 4 实现与接口测试

> 产物: plan
> 依据: spec@cf4712c

## 共用约定

本文件的任务都改 skill 模板,执行前先读完本节。

1. 分支:在 `feat/skill瘦身` 上做(没有就从 `main` 建);开工前 `git status` 确认暂存区是空的。
2. 改动入口:只改 `assets/claude-template/` 下的文件;本仓库根目录的 `.claude/` 不动。不改 `docs/features/` 下任何已有文件。
3. 删减规则(spec §4.1),本文件两种都有,看清每个任务标的是哪一侧:
   - **执行侧**(implementation、run-api-test):只删跨 skill 重复的规则和程序会检查的规则;步骤说明、自检、质量检查、异常速查一律保留。
   - **设计侧**(write-api):删跨 skill 重复的规则、程序会检查的规则、通用方法论、长篇 ❌ 清单、逐条自检、为防较弱模型跑偏写的解释;HARD-GATE、红线、范例保留。
   - 两侧都只删任务点名的内容,没点名的段落不动。
4. 写法(spec §4.3):靠删内容瘦身,不把句子写紧;新写或改写的句子不用箭头(→)、不用斜杠并列(甲/乙)、不用自造缩写;没被要求改的句子不为改写而重写。任务给出的范例原文照抄,可以改错别字和标点,不改场景和结构。
5. 已废弃的 skill 不再作为现行用法出现。对应的新做法:

   | 废弃 | 以后怎么做 |
   |---|---|
   | subagent-implement | 大需求由 `/write-plan` 分批,每批开一个会话跑 `/implementation`,全部完成后回 Claude 跑 `/code-review` |
   | knowledge-api | knowledge-recall |
   | code-map-write、code-map-recall | 不再维护代码地图;涉及的已有代码直接读代码 |
   | write-prd、write-design-doc、write-api-doc | `/write-docs` |
   | knowledge-migrate | 不再提供 |
   | write-delivery-guide | 不再事后写交付讲解;clarify 结束时给出澄清结果 |

6. 文件前缀:`docs/features/<feature-id>/` 里的文件前缀 = feature-id 去掉开头的日期 `YYYY-MM-DD-`。建新需求目录的命名规则只写在 write-spec,这里的 skill 都只在已有需求目录里干活。
7. 头部和开头结论(只在模板范例里体现,不在 skill 正文里讲规则):md 写在一级标题下第一组引用行;`依据` = `spec@` 加主 spec 指纹前 7 位(`cgraphx features show <feature-id>` 显示的「spec 指纹」),需求目录没有主 spec 时不写这一行。第一个二级标题逐字等于登记的标题,不带编号:接口测试规格是「覆盖范围」,接口测试报告是「结论」。
8. 每个任务做完:
   - `grep -n -e subagent-implement -e knowledge-api -e code-map -e write-prd -e write-design-doc -e write-api-doc -e knowledge-migrate -e write-delivery-guide <本任务改过的文件>` 无结果;
   - SKILL.md 开头的 frontmatter(`name`、`description`)完整;
   - `npm run build` 通过。
9. 提交:标题格式 `type(scope): 中文描述`,补充说明用「——」,并列用「+」;每个任务一笔。本仓库的提交门禁会先拦一次,自查后用 `CGRAPHX_PRECOMMIT_REVIEWED=1 git commit ...` 重试。
10. 遇到任务要求和 spec 冲突、要改范围外的文件、点名要删的段落找不到,停下写 `PLAN_CONFLICT: <原因>`。

## T-10: implementation 收尾只留两个提示,汇报给大白话范例(执行侧)

- 目标:收尾只剩「要不要沉淀知识」「平台环节还缺什么」两个提示;去掉代码地图、交付讲解两个提示;汇报给一段大白话范例。
- 对应 spec 条款:§3.3、§7.3、§8.5、§9(收尾不再提示刷新代码地图)、§4.1 执行侧、§4.3。
- 强制引用:无。
- 依赖:无。
- 涉及范围:`assets/claude-template/skills/implementation/SKILL.md`
- 必须严格执行:
  - 执行侧:流程各步的说明、变更边界、中断与上报、质量底线、红线全部保留。
  - 平台环节缺口提醒只提醒,不拦,不影响流程。
- 允许局部适配:新增两节的标题措辞。
- 具体要求:
  1. 「流程」删掉第 8 步「交付讲解提示」和第 9 步「代码地图提示」;新的第 8 步写:「**平台环节缺口提醒** —— 有需求目录时才做(见下)。」
  2. 删掉「代码地图(实现结束后)」「交付讲解(实现结束后)」两节。
  3. 新增一节「平台环节缺口(实现结束后)」:
     「有需求目录时跑 `cgraphx features show <feature-id>`;「平台环节」里标「缺(必需)」的,在汇报末尾提一句还缺哪些环节、可以用哪个 skill 补,例如「平台环节还缺:测试。可以跑 `/write-api` 或 `/write-unit-test-spec` 补。」只提醒,不拦;没有需求目录就跳过。」
  4. 「流程」第 6 步「汇报」末尾补一句:「按下方「汇报范例」写:先说原来怎样,再说现在怎样,然后列改了什么、验证了什么。」并新增一节「汇报范例」,内容照抄:

     ````markdown
     原来侧栏的「数据库」入口是灰的,点不了。现在能点了:进去先看工程列表,点工程看表清单,点表看 DDL 原文和探索经验;全程只读 `docs/schema-knowledge/`,不连库。

     改了什么:
     - 新增 `src/web/schema-reader.ts`、`schema-templates.ts`、`pages-schema.ts`,分别负责读文件、拼 HTML、出页面
     - `server.ts` 加 `/schema` 路由;`layout.ts` 把侧栏第三个入口改成可点

     验证了什么:
     - `npm test` 全部通过
     - 本地打开 `/schema`,工程列表、表清单、单表 DDL 三页都看过;工程名带 `..` 时返回 404
     - 没验证:Windows 下的路径分隔符,本机没有 Windows 环境

     按 plan 执行:PLAN_FOLLOWED,没有出现 PLAN_CONFLICT。

     平台环节还缺:测试。可以跑 `/write-api` 或 `/write-unit-test-spec` 补。
     ````

  5. 「知识沉淀(实现结束后)」一节里「用户同意 → 走 `knowledge-write` 完整流程(查概念 → 写 → validate → 合并检查 → 询问扫描);拒绝或无内容 → 不提。」改为:「用户同意就走 knowledge-write;拒绝或没有可沉淀的内容就不提。」(knowledge-write 自己的流程不在这里重复。)触发条件的两条不动。
  6. 其余内容一字不改。
- 完成条件:
  - `grep -n -e code-map -e write-delivery-guide -e 交付讲解 assets/claude-template/skills/implementation/SKILL.md` 无结果。
  - `grep -n "features show" assets/claude-template/skills/implementation/SKILL.md` 命中;「汇报范例」一节存在。
  - 共用约定第 8 条检查通过。
- 验证方式:上面的 grep;`npm run build`。
- 独立提交:是。建议标题:`refactor(skills): implementation 收尾只留沉淀和平台环节缺口两个提示 + 汇报给大白话范例`
- 风险/注意事项:这是执行侧 skill,读者可能是第三方模型。除点名的几处,不要按设计侧标准删短。

## T-11: write-api 接口测试规格写头部和覆盖范围(设计侧)

- 目标:接口测试规格模板带头部、以「覆盖范围」开头;SKILL.md 删掉触发说明、边界表、自检和重复的命名规则。
- 对应 spec 条款:§3.3、§8.1、§8.2(覆盖范围)、§4.1 设计侧、§4.3、§10。
- 强制引用:无。
- 依赖:无。
- 涉及范围:
  - `assets/claude-template/skills/write-api/SKILL.md`
  - `assets/claude-template/skills/write-api/assets/template-接口测试-spec.md`
  - `assets/claude-template/skills/write-api/references/接口测试-spec-format.md`
- 必须严格执行:
  - 接口测试规格的第一个二级标题是 `## 覆盖范围`,插在 `## 1. 接口清单` 之前;§1 到 §6 的编号和内容不变(run-api-test 按「§5 接口映射」引用)。
  - HARD-GATE、S1 到 S4 的工作流、异常速查、收尾保留。
- 允许局部适配:删除段落后的过渡语。
- 具体要求(SKILL.md):
  1. 删掉「Trigger」整节。
  2. 删掉「与既有 skill 边界」整节。
  3. 「依赖」第一条「(`/implementation` 或 `/subagent-implement` 跑完)」改为「(`/implementation` 跑完)」。
  4. 「feature-id 与文件前缀规则」改名为「产物」;删掉开头的「复用既有规则…」一句和下面四条规则(feature-id 格式、文件前缀、标题不转 slug、文件名敏感字符),换成一句「文件前缀 = feature-id 去掉开头的日期 `YYYY-MM-DD-`。」;下面的产物文件名清单和「接口测试报告 / JSONL 不由本 skill 产」一句保留。
  5. S2 的「行为」改为:「照 `assets/template-接口测试-spec.md` 生成接口测试规格(开头先写「覆盖范围」,再写六节;各节要点见 `references/接口测试-spec-format.md`);AI 做微服务识别和通用接口判断(prompt 见 `references/ai-prompts.md` §S2),结果写入 §1 接口清单的「服务」和「通用」列」。
  6. 删掉「工作流结束」「质量检查」两节(产物清单在「产物」一节;格式要求在 references 各文件里)。
- 具体要求(`assets/template-接口测试-spec.md`):
  1. 「完整结构」代码块里的头部改为:

     ```markdown
     # 接口测试规格: <feature 标题>

     > 产物: api_test_spec
     > 依据: spec@<主 spec 指纹前 7 位,用 cgraphx features show <feature-id> 查;没有主 spec 就删掉这一行>
     > feature-id: <feature-id>
     > 生成时间: <YYYY-MM-DD HH:MM>
     > 关联接口集合: docs/bruno/<服务>/<文件前缀>/
     ```

  2. 在 `## 1. 接口清单` 之前插入(照抄):

     ```markdown
     ## 覆盖范围

     原来没有用户查询和创建接口;这次新增 2 个,加上通用的登录接口,共测 3 个接口、8 个场景:正常 3、边界 2、异常 3。写接口 2 个(创建用户、登录),要查库核实。
     ```

  3. 文末「填写说明」加一条:「「覆盖范围」第一句先讲原来的情况,再写测几个接口、几个场景(正常、边界、异常各几个),哪些写接口要查库。」
- 具体要求(`references/接口测试-spec-format.md`):
  1. 「六节结构(必须完整)」改为「结构(必须完整)」,第一句改为:「开头一节「覆盖范围」,后面六节,顺序固定;完整示例见 `assets/template-接口测试-spec.md`。」
  2. 在「§1. 接口清单」之前加一小节「覆盖范围」:「第一个二级标题,写作 `## 覆盖范围`,不带编号:第一句先讲原来的情况,再写测几个接口、几个场景(正常、边界、异常各几个),哪些写接口要查库。」
  3. 删掉 §1 到 §5 里的示例代码块(模板里有完整示例),每节的说明文字保留;§6「验收口径」保留原样。
  4. 删掉「模板」一节(已并进第 1 条);「与下游 skill 的契约」保留。
- 完成条件:
  - `grep -n "## 覆盖范围" assets/claude-template/skills/write-api/assets/template-接口测试-spec.md` 命中,且在 `## 1. 接口清单` 之前。
  - `grep -n "> 产物: api_test_spec" assets/claude-template/skills/write-api/assets/template-接口测试-spec.md` 命中。
  - 共用约定第 8 条检查通过(检查范围是本任务改的三个文件)。
- 验证方式:上面的 grep;`npm run build`。
- 独立提交:是。建议标题:`refactor(skills): write-api 接口测试规格写头部和覆盖范围 + 删触发说明和自检`
- 风险/注意事项:`references/` 下另外五个文件(ai-prompts、bru-format、collection-layout、environment-setup、interface-scope)不在本任务范围,不动。

## T-12: run-api-test 报告写头部和结论(执行侧)

- 目标:接口测试报告带头部、以「结论」开头;对已废弃 skill 的引用改掉;删掉重复的命名规则。其余步骤说明和自检全部保留。
- 对应 spec 条款:§3.3、§8.1、§8.2(结论)、§4.1 执行侧、§4.3、§10。
- 强制引用:无。
- 依赖:无。
- 涉及范围:
  - `assets/claude-template/skills/run-api-test/SKILL.md`
  - `assets/claude-template/skills/run-api-test/references/report-format.md`
  - `assets/claude-template/skills/run-api-test/assets/template-接口测试报告.md`
- 必须严格执行:
  - 报告第一个二级标题是 `## 结论`,取代原来的 `## 1. 汇总`;其余二级标题去掉编号,名字不变;report-format.md 里按编号引用报告章节的地方同步改成按标题引用。
  - 执行侧:HARD-GATE、触发逻辑、R1 到 R5、异常速查、质量检查、收尾保留。
- 允许局部适配:无。
- 具体要求(SKILL.md):
  1. 「Trigger」里「写 HTML 接口文档 → 用 `/write-api-doc`」改为「写接口文档 → 发布后用 `/write-docs`」。
  2. 「与既有 skill 边界」表:`write-api-doc` 一行改为 `write-docs`,关系「独立并列」,说明「不互相调用;本 skill 产接口测试报告和 JSONL,write-docs 发布后产事后文档」;`implementation` / `subagent-implement` 一行改为只写 `implementation`;删掉 `write-design-doc` 一行。
  3. 「feature-id 与文件前缀规则」:删掉「复用既有规则…」到「文件名不得包含…」四行,换成一句「文件前缀 = feature-id 去掉开头的日期 `YYYY-MM-DD-`。」;产物文件名两行和「格式见…」保留。
  4. R5「行为」第一条里括号内容改为:「(结论 + 逐接口结果 + 失败汇总 + DB 核实小结 + 下一步建议 + 产物清单;照 `assets/template-接口测试报告.md` 写)」;下面三条子项(按接口聚合、展示级别、约束)保留。
- 具体要求(`references/report-format.md`):
  1. 「Markdown 报告章节」下的 `### §1. 汇总` 改为 `### 结论(第一个二级标题,写作 `## 结论`)`,下面先加一句:「第一句先讲原来的情况和这次测了什么,再写通过、失败、跳过各几条,最后一句写能否交付;下面放计数表。」原计数表保留。
  2. `### §2. 逐接口结果 ⭐ 核心` 改为 `### 逐接口结果 ⭐ 核心`;`### §3. 失败汇总` 改为 `### 失败汇总`;`### §4. 写接口 DB 核实小结` 改为 `### DB 核实小结(写接口)`;`### §5. 下一步建议` 改为 `### 下一步建议`;`### §6. 产物清单` 改为 `### 产物清单`。
  3. 「状态枚举」里「报告 §2 / §3 / JSONL `final_status` 必须用以下枚举值」改为「报告「逐接口结果」「失败汇总」和 JSONL 的 `final_status` 必须用以下枚举值」。
  4. 产物表里 Markdown 报告的「用途」一列里的「汇总」改为「结论」。
- 具体要求(`assets/template-接口测试报告.md`):
  1. 「完整结构」代码块的头部,在 `> feature-id:` 之前加两行:
     `> 产物: api_test_report`
     `> 依据: spec@<主 spec 指纹前 7 位,用 cgraphx features show <feature-id> 查;没有主 spec 就删掉这一行>`
  2. `## 1. 汇总` 改为 `## 结论`,在计数表之前加一段示例结论(第一句先讲原来的情况,再给计数和能否交付):「原来没有用户管理接口;这次新增 5 个接口,跑了 N 个场景:通过 N、失败 3、跳过 0。暂时不能交付:创建用户没写库、删除用户断言失败、订单查询返回 404,详见「失败汇总」。」其中的 N 按模板下文示例数据实际数出来填;计数表和「通过率」一行保留。
  3. 其余二级标题去掉编号:`## 逐接口结果`、`## 失败汇总`、`## DB 核实小结（写接口）`、`## 下一步建议`、`## 产物清单`;三级标题 `### 2.1 GET …` 这类去掉「2.x 」前缀。
  4. 代码块外的「核心设计原则」「填写说明」保留。
- 完成条件:
  - `grep -n "## 结论" assets/claude-template/skills/run-api-test/assets/template-接口测试报告.md` 命中;`grep -n "## 1. 汇总" assets/claude-template/skills/run-api-test/assets/template-接口测试报告.md` 无结果。
  - `grep -n "§2\|§3" assets/claude-template/skills/run-api-test/references/report-format.md` 不再指报告章节。
  - 共用约定第 8 条检查通过。
- 验证方式:上面的 grep;`npm run build`。
- 独立提交:是。建议标题:`refactor(skills): run-api-test 报告写头部和结论 + 引用改到 write-docs`
- 风险/注意事项:这是执行侧 skill;「质量检查」九条、「异常速查」全表、R1 到 R5 的步骤说明一条不删。
