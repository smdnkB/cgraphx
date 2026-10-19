# 实现计划: skill瘦身 · 批次 5 单元与 UI 测试及命令

> 产物: plan
> 依据: spec@cf4712c

## 共用约定

本文件的任务都改 skill 模板和命令,执行前先读完本节。

1. 分支:在 `feat/skill瘦身` 上做(没有就从 `main` 建);开工前 `git status` 确认暂存区是空的。
2. 改动入口:只改 `assets/claude-template/` 下的文件;本仓库根目录的 `.claude/` 不动。不改 `docs/features/` 下任何已有文件。
3. 删减规则(spec §4.1),本文件两种都有,看清每个任务标的是哪一侧:
   - **执行侧**(write-unit-test-code、run-ui-test):只删跨 skill 重复的规则和程序会检查的规则;步骤说明、自检、边界场景一律保留。
   - **设计侧**(write-unit-test-spec、write-ui-test):删跨 skill 重复的规则、程序会检查的规则、通用方法论、长篇 ❌ 清单、逐条自检、为防较弱模型跑偏写的解释;HARD-GATE、红线、范例保留。
   - 命令 `/end`、`/my-query` 只做任务点名的改动。
   - 都只删任务点名的内容,没点名的段落不动。
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

6. 文件前缀:`docs/features/<feature-id>/` 里的文件前缀 = feature-id 去掉开头的日期 `YYYY-MM-DD-`。这里的 skill 都只在已有需求目录里干活,不再各自抄一份命名规则。
7. 头部和开头结论(只在范例里体现):md 写在一级标题下第一组引用行;`依据` = `spec@` 加主 spec 指纹前 7 位(`cgraphx features show <feature-id>` 显示的「spec 指纹」),需求目录没有主 spec 时不写这一行。第一个二级标题逐字等于登记的标题,不带编号:单元测试规格、UI 测试用例规格是「覆盖范围」,单元测试报告是「结论」,收口档案是「历时」,发布记录是「版本与上线时间」。
8. 每个任务做完:
   - `grep -n -e subagent-implement -e knowledge-api -e code-map -e write-prd -e write-design-doc -e write-api-doc -e knowledge-migrate -e write-delivery-guide <本任务改过的文件>` 无结果;
   - SKILL.md 开头的 frontmatter(`name`、`description`)完整;
   - `npm run build` 通过。
9. 提交:标题格式 `type(scope): 中文描述`,补充说明用「——」,并列用「+」;每个 skill 一笔。本仓库的提交门禁会先拦一次,自查后用 `CGRAPHX_PRECOMMIT_REVIEWED=1 git commit ...` 重试。
10. 遇到任务要求和 spec 冲突、要改范围外的文件、点名要删的段落找不到,停下写 `PLAN_CONFLICT: <原因>`。

## T-13: 单元测试规格和报告写头部与开头结论

- 目标:write-unit-test-spec 产出的规格以「覆盖范围」开头并带头部,给一份完整范例;write-unit-test-code 产出的报告以「结论」开头并带头部。
- 对应 spec 条款:§3.3、§8.1、§8.2、§4.1、§4.3。
- 强制引用:无。
- 依赖:无。
- 涉及范围:
  - `assets/claude-template/skills/write-unit-test-spec/SKILL.md`(设计侧)
  - `assets/claude-template/skills/write-unit-test-code/SKILL.md`(执行侧)
- 必须严格执行:
  - 规格的第一个二级标题是 `## 覆盖范围`;报告的第一个二级标题是 `## 结论`。
  - write-unit-test-code 是执行侧:流程 1 到 6 的说明、逐场景结果格式、边界场景、不做的事全部保留。
- 允许局部适配:无。
- 具体要求(write-unit-test-spec,设计侧):
  1. 删掉「Trigger」整节。
  2. 「流程」第 4 步「产出测试规格文档」里「结构轻量,至少包含:」及其下四条,换成「照下面的范例写,至少有覆盖范围、必测场景、测试骨架映射、待确认项四节:」和这段范例(照抄):

     ````markdown
     # 单元测试规格: 积分发放规则

     > 产物: unit_test_spec
     > 依据: spec@3f9a1c2

     ## 覆盖范围

     原来下单统一返 1% 积分,这次改成按会员等级发放,退款时按原比例扣回。共 7 个场景:主路径 3、边界 2、异常 2;不测积分兑换(另一个需求)。

     ## 必测场景

     ### 主路径
     - 普通会员付款 100 元,发放 100 分(依据: spec §3.1)
     - 黄金会员付款 100 元,发放 200 分(依据: spec §3.1)
     - 退款 100 元,按当初的比例扣回积分(依据: spec §3.2)

     ### 边界
     - 付款 0.5 元,不足 1 元不发积分(依据: spec §3.1)
     - 付款后会员等级变了,按付款时的等级发放(依据: spec §3.3)

     ### 异常
     - 退款金额大于原订单金额,拒绝扣回并报错(依据: spec §5.1)
     - 积分流水写入失败,整笔发放回滚(依据: spec §5.2)

     ## 测试骨架映射

     | 场景 | 测试文件 | describe |
     |---|---|---|
     | 发放相关 | `__tests__/2026-10-18-REQ-1024-积分发放.test.ts` | `issuePoints` |
     | 退款相关 | `__tests__/2026-10-18-REQ-1024-积分发放.test.ts` | `refundPoints` |

     ## 待确认项

     - spec 没写积分跨年过期后退款怎么扣,先不测,已提醒回 write-spec 补
     ````

     范例后保留原来那句「**AI 自己发挥的空间**:…」。
  3. 「不做的事」整节删掉;其中「不改 spec / implementation / write-plan」挪进 HARD-GATE,写成一条「**不改 spec、实现代码和 plan**」。
  4. 删掉「和其他 skill 的关系」整节。
  5. 「定位」「HARD-GATE」(除第 3 条的新增)「产物」「边界场景」不动。
- 具体要求(write-unit-test-code,执行侧):
  1. 第 5 步「头部样例」代码块里,在 `> feature-id:` 之前加两行:
     `> 产物: unit_test_report`
     `> 依据: spec@<主 spec 指纹前 7 位,用 cgraphx features show <feature-id> 查;没有主 spec 就删掉这一行>`
  2. 第 5 步「正文结构轻量,至少包含:」下的第一条「测试概况:…」改为:「`## 结论`(第一个二级标题):第一句先讲原来的情况,再写通过、失败、跳过各几条,最后说能否交付;下面放计数:总数、通过、失败、跳过(it.skip 占位)、时长。」其后紧跟一段「结论示例」(照抄):

     ```markdown
     ## 结论

     原来用户资料处理没有任何校验;这次补上空值校验和权限检查。3 个场景:通过 1、失败 1、跳过 1,暂时不能交付:空值输入没有校验(见「空值输入应抛错」);权限检查还没实现,对应场景先跳过。
     ```

  3. 「定位」里「**和 write-unit-test-spec 的分工**:」这一小段(连同下面两条)删掉,write-unit-test-spec 里已经有同样的分工说明;「两个 skill 顺序依赖…」一句保留。
  4. 其余内容一字不改。
- 完成条件:
  - `grep -n "## 覆盖范围" assets/claude-template/skills/write-unit-test-spec/SKILL.md` 命中;`grep -n "unit_test_spec" assets/claude-template/skills/write-unit-test-spec/SKILL.md` 命中。
  - `grep -n "## 结论" assets/claude-template/skills/write-unit-test-code/SKILL.md` 命中;`grep -n "unit_test_report" assets/claude-template/skills/write-unit-test-code/SKILL.md` 命中。
  - 共用约定第 8 条检查通过。
- 验证方式:上面的 grep;`npm run build`。
- 独立提交:是,两笔。建议标题:`refactor(skills): write-unit-test-spec 规格以覆盖范围开头 + 给完整范例 + 删触发说明`;`refactor(skills): write-unit-test-code 报告写头部和结论`
- 风险/注意事项:范例里的「依据: spec §3.1」是每条场景对应的 spec 条款,和头部的 `> 依据: spec@<指纹>` 是两回事,两者都要保留。

## T-14: UI 测试用例规格写头部与覆盖范围;run-ui-test 只删重复

- 目标:write-ui-test 产出的用例规格以「覆盖范围」开头并带头部;两个 skill 的命名规则改成一句;去掉对 subagent-implement 的引用。
- 对应 spec 条款:§3.3(write-ui-test 写头部和开头结论;run-ui-test 只删重复规则)、§8.1、§8.2、§4.1、§10。
- 强制引用:无。
- 依赖:无。
- 涉及范围:
  - `assets/claude-template/skills/write-ui-test/SKILL.md`(设计侧)
  - `assets/claude-template/skills/write-ui-test/references/用例规格-format.md`
  - `assets/claude-template/skills/run-ui-test/SKILL.md`(执行侧)
- 必须严格执行:
  - 用例规格的第一个二级标题是 `## 覆盖范围`,插在 `## 1. 概览` 之前;§1 到 §4 的编号不变(run-ui-test 按「§1 概览」「§3 数据前提清单」引用)。
  - run-ui-test 只改下面点名的两处,其余一字不动;它产出的结果 json 和报告 xlsx 不加头部。
- 允许局部适配:无。
- 具体要求(write-ui-test,设计侧):
  1. 删掉「Trigger」「与既有 skill 边界」两节。
  2. 「feature-id 与文件前缀规则」改名为「产物」:删掉「复用既有规则…」一句和下面四条规则,换成一句「文件前缀 = feature-id 去掉开头的日期 `YYYY-MM-DD-`。」;用例规格路径和「`ui功能测试/` 目录不存在则创建…」一句保留。
  3. U2「行为」第一句改为:「按 `references/用例规格-format.md` 派生——开头先写「覆盖范围」,然后**一功能点一用例**,每条含五要素:」(五要素清单不动)。
  4. 删掉「工作流结束」「质量检查」两节。
- 具体要求(`references/用例规格-format.md`):
  1. 「四节结构(必须完整)」改为「结构(必须完整)」,第一句改为:「开头一节「覆盖范围」,后面四节,顺序固定。」
  2. 在「§1. 概览」之前加一小节「开头:标题、头部和覆盖范围」,放这段范例(照抄):

     ```markdown
     # UI 功能测试用例规格: 客户管理

     > 产物: ui_test_spec
     > 依据: spec@3f9a1c2

     ## 覆盖范围

     原来客户资料只能在后台数据库里改;这次新增客户管理页面,测 2 个功能点、2 条用例:新建客户、编辑客户;不测导出(spec 没要求)。
     ```

  3. §1 概览示例表里删掉「功能点数」这一行(已写进覆盖范围)。
- 具体要求(run-ui-test,执行侧):
  1. 「与既有 skill 边界」表里 `implementation` / `subagent-implement` 一行改为只写 `implementation`。
  2. 「feature-id 与文件前缀规则」:删掉「复用既有规则…」一句和下面三条规则,换成一句「文件前缀 = feature-id 去掉开头的日期 `YYYY-MM-DD-`。」;产物文件名三行和「格式见…」保留。
- 完成条件:
  - `grep -n "## 覆盖范围" assets/claude-template/skills/write-ui-test/references/用例规格-format.md` 命中;`grep -n "ui_test_spec" assets/claude-template/skills/write-ui-test/references/用例规格-format.md` 命中。
  - `git diff --stat assets/claude-template/skills/run-ui-test/` 只有 SKILL.md 一个文件,改动不超过 10 行。
  - 共用约定第 8 条检查通过。
- 验证方式:上面的命令;`npm run build`。
- 独立提交:是,两笔。建议标题:`refactor(skills): write-ui-test 用例规格写头部和覆盖范围 + 删触发说明和自检`;`refactor(skills): run-ui-test 删掉重复的命名规则`
- 风险/注意事项:run-ui-test 的五道关、R0 到 R6、报告规范都不在本任务范围。

## T-15: `/end` 写发布记录与收口档案头部;`/my-query` 改引用

- 目标:`/end` 收口时问是否已上线,确认已上线才写发布记录;收口档案带头部;发布晚于收口时,再跑 `/end` 只补发布记录。`/my-query` 里的 knowledge-api 改为 knowledge-recall。
- 对应 spec 条款:§3.3、§8.1、§8.2(收口档案「历时」、发布记录「版本与上线时间」)、§8.3、§10、§13 第 8 条。
- 强制引用:无。
- 依赖:无。
- 涉及范围:
  - `assets/claude-template/commands/end.md`
  - `assets/claude-template/commands/my-query.md`
- 必须严格执行:
  - 发布记录:`docs/features/<feature-id>/<前缀>-发布记录.md`,头部只写 `> 产物: release_record`;第一个二级标题 `## 版本与上线时间`,是一张表,每次发布追加一行;至少有版本号或 tag、上线时间;同一需求多次发布写在同一个文件里。
  - 没上线不写发布记录;版本号和上线时间问用户,不猜。
  - 收口档案的第一个二级标题仍是 `## 历时`,原有六节、填法要点、自检全部保留。
- 允许局部适配:新增一节的措辞。
- 具体要求(`end.md`):
  1. 「你的任务」第一句里的落盘路径 `docs/features/需求目录/[需求名称]-收口档案.md` 改为 `docs/features/<feature-id>/<前缀>-收口档案.md`(前缀 = feature-id 去掉开头的日期);这一节末尾加一条:「确认已上线时,顺带写发布记录(见「发布记录」)。」
  2. 「输入(使用者提供)」加一条:「是否已上线;已上线的话,版本号或 tag、上线时间」。
  3. 「产出 schema」代码块里,在 `# 收口档案:<需求名>` 和 `## 历时` 之间插入(前后各空一行):

     ```
     > 产物: closure_record
     > 依据: spec@<主 spec 指纹前 7 位,用 cgraphx features show <feature-id> 查;没有主 spec 就删掉这一行>
     ```

  4. 文末新增一节「发布记录(确认已上线才写)」:
     - 收口时问用户:这个需求上线了吗?确认已上线才写;没上线就不写,告诉用户上线后再跑一次 `/end` 补。
     - 再跑 `/end` 时,如果收口档案已经在,只补发布记录,不重写收口档案。
     - 文件 `docs/features/<feature-id>/<前缀>-发布记录.md`;同一需求多次发布写在同一个文件里,在「版本与上线时间」表里追加一行。
     - 至少有版本号或 tag、上线时间;关联 commit、分支、发布说明按需加。版本号和上线时间问用户,不猜。
     - 写了它,平台上的任务才会显示「已发布」(服务端协议 1.3 及以上)。
     - 范例(照抄):

       ```markdown
       # 发布记录: 积分发放规则

       > 产物: release_record

       ## 版本与上线时间

       | 版本或 tag | 上线时间 | 说明 |
       |---|---|---|
       | v2.3.0 | 2026-10-20 15:30 | 首次上线:下单积分按会员等级发放 |
       | v2.3.1 | 2026-10-22 10:00 | 修复退款时少扣 1 分 |

       ## 关联提交

       - v2.3.0:`a1b2c3d..e4f5a6b`,分支 `release/2.3`
       ```

- 具体要求(`my-query.md`):第二行「knowledge-api 查询历史需求文档…」里的 `knowledge-api` 改为 `knowledge-recall`,其余不动。
- 完成条件:
  - `grep -n -e closure_record -e release_record -e "版本与上线时间" assets/claude-template/commands/end.md` 都命中。
  - `grep -n knowledge-api assets/claude-template/commands/my-query.md` 无结果。
  - 共用约定第 8 条检查通过。
- 验证方式:上面的 grep;`npm run build`。
- 独立提交:是。建议标题:`feat(commands): /end 确认已上线时写发布记录 + 收口档案写头部;/my-query 改用 knowledge-recall`
- 风险/注意事项:收口档案前面的 frontmatter(`---` 块)保留在一级标题之前,头部引用行写在一级标题之后,不要放进 frontmatter。
