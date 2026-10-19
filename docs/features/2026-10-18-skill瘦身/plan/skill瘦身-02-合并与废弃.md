# 实现计划: skill瘦身 · 批次 2 合并与废弃

> 产物: plan
> 依据: spec@cf4712c

## 共用约定

本文件的任务都改 skill 模板,执行前先读完本节。

1. 分支:在 `feat/skill瘦身` 上做(没有就从 `main` 建);开工前 `git status` 确认暂存区是空的。
2. 改动入口:只改 `assets/claude-template/` 下的文件;本仓库根目录的 `.claude/` 是已部署的旧副本,不动。不改 `docs/features/` 下任何已有文件。
3. 删减规则(spec §4.1):
   - 设计侧 skill:删跨 skill 重复的规则、程序会检查的规则、通用方法论、长篇 ❌ 清单、逐条自检、为防较弱模型跑偏写的解释;HARD-GATE、红线、范例保留。
   - 本文件涉及的 knowledge-recall、write-docs 都是设计侧。
   - 只删任务里点名的内容;没点名的段落不动。
4. 写法(spec §4.3):靠删内容瘦身,不把句子写紧;新写或改写的句子不用箭头(→)、不用斜杠并列(甲/乙)、不用自造缩写;没被要求改的句子不为改写而重写。
5. 已废弃的 skill 不再作为现行用法出现。对应的新做法:

   | 废弃 | 以后怎么做 |
   |---|---|
   | subagent-implement | 大需求由 `/write-plan` 分批,每批开一个会话跑 `/implementation`,全部完成后回 Claude 跑 `/code-review` |
   | knowledge-api | knowledge-recall |
   | code-map-write、code-map-recall | 不再维护代码地图;涉及的已有代码直接读代码 |
   | write-prd、write-design-doc、write-api-doc | `/write-docs` |
   | knowledge-migrate | 不再提供 |
   | write-delivery-guide | 不再事后写交付讲解;clarify 结束时给出澄清结果 |

6. 文件前缀:`docs/features/<feature-id>/` 里的文件前缀 = feature-id 去掉开头的日期 `YYYY-MM-DD-`。建新需求目录的命名规则只写在 write-spec「产物位置与命名」,别的 skill 不再抄一份。
7. 头部和开头结论(只在范例里体现,不在 skill 正文里讲规则):
   - md:一级标题下第一组引用行,如 `> 产物: prd`、`> 依据: spec@3f9a1c2`;HTML:前 30 行内的一个注释里,每行一个 `> 字段: 值`。
   - `依据` = `spec@` 加主 spec 指纹前 7 位(`cgraphx features show <feature-id>` 显示的「spec 指纹」);需求目录没有主 spec 时不写这一行。
   - md 产物的第一个二级标题必须逐字等于登记的标题,不带编号。
8. 每个任务做完:
   - `grep -n -e subagent-implement -e knowledge-api -e code-map -e write-prd -e write-design-doc -e write-api-doc -e knowledge-migrate -e write-delivery-guide <本任务改过的文件>` 无结果(任务另有说明的除外);
   - SKILL.md 开头的 frontmatter(`name`、`description`)完整;
   - `npm run build` 通过。
9. 提交:标题格式 `type(scope): 中文描述`,补充说明用「——」,并列用「+」;每个任务一笔。本仓库的提交门禁会先拦一次,自查后用 `CGRAPHX_PRECOMMIT_REVIEWED=1 git commit ...` 重试。
10. 遇到任务要求和 spec 冲突、要改范围外的文件、点名要删的段落找不到,停下写 `PLAN_CONFLICT: <原因>`。

## T-3: knowledge-recall 并入 knowledge-api

- 目标:查知识库只剩 knowledge-recall 一个入口:先派子 agent 匹配概念,再用 `cgraphx docs show <path> --body` 读正文;knowledge-api 的命令用法压成几行并进来。
- 对应 spec 条款:§3.2、§5.1、§13 第 2 条。
- 强制引用:无。
- 依赖:无(必须在 T-5 删掉 knowledge-api 之前做)。
- 涉及范围:`assets/claude-template/skills/knowledge-recall/SKILL.md`(改写);只读 `assets/claude-template/skills/knowledge-api/SKILL.md`。
- 必须严格执行:
  - 保持 model-invoked:frontmatter 不加 `disable-model-invocation`。`description` 在现有内容上补进 knowledge-api 的触发场景:任务开始时查知识库、查历史决策、找相关文档。
  - 同名子 agent `assets/claude-template/agents/knowledge-recall.md` 不改,仍是唯一的召回子 agent。
  - 不搬 knowledge-api 的:子 agent 提示词(`agent-prompt.md`)、「何时派子 agent」整节(R4 判断规则、派的方法、代价)、「文档规范要点」整节(归 knowledge-write)、「排除范围」「探索结果收口」「工作流(任务开始时)」的图解。
- 允许局部适配:各节标题措辞;命令表用表格还是列表。
- 具体要求(改写后的 SKILL.md 由下面几部分组成):
  1. 开头一两句:这个 skill 做什么(把「加载全量概念并匹配」放进子 agent 的隔离上下文,主 agent 只收命中结果)。删掉现有「这个 skill 解决什么」里解释后果的长句。
  2. 「流程」:保留现有第 1 步(Agent 调用代码块)和第 2 步(直接采纳,不自己再调 concepts、find 重查)。第 3 步的分支保留,删掉其中「需要精确查某个概念的其他文档 → 调 `knowledge-api` skill」这一条,改为「需要精确查某个概念的其他文档:用下面的命令」;把「读 docs/knowledge 正文一律用 docs show --body…」这一条挪进「命令」一节,流程里不重复。
  3. 「命令」(新加,从 knowledge-api 压缩,每行一个):
     - 查概念:`cgraphx docs concepts`
     - 按概念反查文档:`cgraphx docs find --concept=<名>`
     - 关键词查:`cgraphx docs find --q=<关键词>`(只匹配 title 和 Summary)
     - 读正文:`cgraphx docs show <path> --body`。读知识库正文一律用它,不用 cat、Read,这样读过的条目才会记为本次任务的参考;提示 `unknown option '--body'` 说明全局 cgraphx 太旧,先 `npm i -g cgraphx` 升级
     - 建索引:`cgraphx docs index`(写了或改了知识文件的 frontmatter、Summary 之后跑;全量重建)
     - 以上命令都支持 `--json`
  4. 没有命中时走 knowledge-write 的那一条,保留现有写法。
- 完成条件:
  - 新 SKILL.md 不超过 45 行;不含 `knowledge-api`;含上面 6 行命令。
  - 共用约定第 8 条检查通过。
- 验证方式:`wc -l`、`grep -n knowledge-api assets/claude-template/skills/knowledge-recall/SKILL.md`(无结果)、`npm run build`。
- 独立提交:是。建议标题:`refactor(skills): knowledge-recall 并入 knowledge-api——查知识库只剩一个入口`
- 风险/注意事项:不要把 knowledge-api 的子 agent 派遣规则带进来,召回子 agent 只有 `agents/knowledge-recall.md` 一个。

## T-4: 新建 write-docs

- 目标:把 write-prd、write-design-doc、write-api-doc 合成一个只能手动调用的 `/write-docs`:运行时先问要哪几种(可多选),共用规则只写一次,三种文档各一份参考文件放各自的章节和模板。
- 对应 spec 条款:§3.2、§5.2、§8.1(需求文档、设计文档、接口文档的头部)、§8.2(需求概览、架构总览;HTML 不查)、§13 第 2、6 条。
- 强制引用:无。
- 依赖:无(必须在 T-5 删掉三个旧 skill 之前做)。
- 涉及范围(新建):
  - `assets/claude-template/skills/write-docs/SKILL.md`
  - `assets/claude-template/skills/write-docs/references/需求文档.md`
  - `assets/claude-template/skills/write-docs/references/设计文档.md`
  - `assets/claude-template/skills/write-docs/references/接口文档.md`
  - 只读来源:`skills/write-prd/SKILL.md`;`skills/write-design-doc/SKILL.md`、`template-design-md.md`、`template-design-html.md`;`skills/write-api-doc/SKILL.md`、`template-api-html.md`。
- 必须严格执行:
  - frontmatter:`name: write-docs`,`disable-model-invocation: true`(和原来三个一样只能手动调用)。`description` 写清:发布后按需生成需求文档、设计文档、接口文档;运行时先问要哪几种,可以多选;写实际交付的行为,不重新定义 spec;产物文件名;触发词含 写需求文档、PRD、设计文档、接口文档、API 文档、发布后补文档、write-docs。
  - 产物文件名和类型与原来一致:`<前缀>-需求文档.md`(prd)、`<前缀>-设计文档.md` 或 `.html`(design_doc)、`<前缀>-接口文档.html`(api_doc)。
  - 需求文档 md 的第一个二级标题是 `## 需求概览`(一句话需求,加业务流程图);设计文档 md 的第一个二级标题是 `## 架构总览`(架构总览与关键取舍)。HTML 版设计文档把「架构总览」放在正文最前面;接口文档 HTML 把「接口清单」(方法、路径、用途)放在正文最前面,目录导航可以留在它上面。
  - 每份模板的头部:md 在一级标题下写 `> 产物:` 和 `> 依据:`;HTML 在 `<!DOCTYPE html>` 之后、前 30 行内放一个注释,内含这两行。
  - 读代码提取接口的步骤只写在 `references/接口文档.md` 里。
- 允许局部适配:参考文件内部的小节划分;HTML 模板的 CSS 原样搬,不做视觉调整。
- 具体要求:
  1. **SKILL.md**,按下面几部分写:
     - 「定位」两三句:发布后按需执行,不在开发主链上;写的是实际交付的行为;spec 是唯一契约,本 skill 不重新定义 spec 已锁定的规则、接口和口径,spec 与代码不符时标【待确认】。
     - 「流程」四步:
       1. 问要哪几种(多选):需求文档、设计文档、接口文档;选了设计文档再问格式(md 或 html)。
       2. 定需求目录:用户给了 feature-id 就用;没给就从当前目录往上找最近的 `docs/features/<feature-id>/`;找不到就问。文件前缀 = feature-id 去掉开头的日期。
       3. 按选中的种类逐份生成:读对应参考文件,照它的章节和模板写(需求文档读 `references/需求文档.md`,设计文档读 `references/设计文档.md`,接口文档读 `references/接口文档.md`)。
       4. 交付:告诉用户每份文件的位置,列出标了「待补充」或【待确认】的地方。
     - 「共用规则」:一张表,列「文档、文件、产物类型、开头先给什么」三行;下面放两个头部范例:

       ```markdown
       # 需求文档: 积分发放规则

       > 产物: prd
       > 依据: spec@3f9a1c2

       ## 需求概览
       ```

       ```html
       <!DOCTYPE html>
       <!--
       > 产物: api_doc
       > 依据: spec@3f9a1c2
       -->
       ```

     - 「红线」四条:不编造(代码和 spec 里都没有的接口、字段、规则不写,缺的标「待补充」或【待确认】);不重新定义 spec 已锁定的契约;不写 `docs/knowledge/`,不改 spec、plan、代码;写完不自动继续别的流程。
  2. **references/需求文档.md**(来源 write-prd):
     - 读者一句:给领导、客户、业务方看,业务可读,不要求懂代码。
     - 保留「可以写」「不要写」两张清单(原「受众和边界」)。
     - 模板:一级标题 `# 需求文档: <需求名称>`,头部两行,第一节 `## 需求概览`,其后依次 `## 1. 需求范围`(本次包含、本次不包含)、`## 2. 用户角色与使用场景`、`## 3. 业务流程`、`## 4. 功能需求`、`## 5. 业务规则`、`## 6. 数据口径与状态说明`、`## 7. 需拍板的业务决策`、`## 8. 权限与可见性`、`## 9. 异常与边界场景`、`## 10. 验收标准`、`## 11. 待确认项`。原「1. 背景与目标」并进「需求概览」。
     - 「需求概览」给一段范例(第一句先讲原来的情况):

       ````markdown
       ## 需求概览

       原来下单统一返 1% 积分,黄金会员和普通会员没有差别。现在按会员等级发放:普通会员每消费 1 元得 1 分,黄金会员得 2 分;退款时按当初的发放比例扣回。

       ```mermaid
       flowchart LR
         pay[用户付款成功] --> level{会员等级}
         level -- 普通 --> p1[每 1 元得 1 分]
         level -- 黄金 --> p2[每 1 元得 2 分]
         p1 --> ledger[记入积分流水]
         p2 --> ledger
         refund[用户退款] --> back[按原比例扣回] --> ledger
       ```
       ````

     - 原「章节写法」压成一张表:章节、写什么,每章一行。
     - 删掉原「工作流程」(命名部分由 SKILL.md 的流程第 2 步替代,其余是通用方法)、「写作原则」「质量检查」「收尾方式」「feature-id 与文件前缀规则」「产物位置」。
  3. **references/设计文档.md**(来源 write-design-doc 三个文件):
     - 素材来源:`docs/knowledge/`(用 `cgraphx docs find --concept=<名>` 找条目,用 `cgraphx docs show <path> --body` 读正文)加需求目录里的 spec、plan;两类都没有就不生成,提示先补素材。
     - 章节:md 模板第一节 `## 架构总览`(系统定位一句 + 架构图 + 关键取舍表),其后 `## 核心模块`、`## 技术决策`、`## 已知限制`、`## 扩展方向`;可选章节(数据模型、API 参考、性能特征、运维指南、术语表、相关资源)保留原样。删掉原模板的 `## 目录` 一节;原「概述」「架构设计」并进「架构总览」。
     - 「架构总览」给一段范例(第一句先讲原来的情况):

       ````markdown
       ## 架构总览

       原来积分在下单流程里按 1% 直接算,没有独立的规则。现在发放规则抽成积分规则服务,下单和退款都经它写积分流水。

       ```
       订单服务 ──付款成功──→ 积分规则服务 ──→ 积分流水表
          │                         ↑
          └────────退款─────────────┘
       ```

       | 关键取舍 | 选了 | 没选 | 为什么 |
       |---|---|---|---|
       | 流水记下规则版本 | 每条流水存发放时的规则版本 | 退款时按当前规则倒推 | 规则会改,只有记下当时的版本才能按原比例扣回 |
       ````

     - 保留「合成规则」里的来源、结构重组、引用溯源三条;「语言与风格」「图表」各压成一行(正文中文,标识符保留英文;图优先 Mermaid);「输出格式」保留两行(HTML 单文件自包含;md 不加 YAML frontmatter)。
     - HTML 模板整段搬过来:在 `<!DOCTYPE html>` 之后加头部注释(`> 产物: design_doc`、`> 依据: spec@<前 7 位>`),正文第一节改为「架构总览」,目录同步。原「设计文档 HTML 章节内容指南」「HTML 格式要点」保留。
     - 删掉原「定位」里 knowledge-api、knowledge-init 等边界说明,原「依赖」「流程」「保存位置与命名」「红线」(红线已并进 SKILL.md)。
  4. **references/接口文档.md**(来源 write-api-doc 两个文件):
     - 范围:只算本次新增的接口(新加的路由注册);改了实现的老接口、删除的接口都不算;只用 grep 和 Read 查代码。
     - 读代码提取接口的步骤,保留原第一步到第六步的内容:确认范围(用户给文件、模块、路由前缀或 handler 名);读 spec 的接口、数据、权限、异常几节;按框架 grep 路由注册点(原 pattern 表整张保留);筛出本次新增;读 handler 提取方法、路径、参数、响应示例、错误码、业务说明;组装 HTML。提取不到的字段标「待补充」。
     - 保留「内容来源与改写规则」「失败处理」两节。
     - HTML 模板整段搬过来:`<!DOCTYPE html>` 之后加头部注释(`> 产物: api_doc`、`> 依据: spec@<前 7 位>`);正文第一节改为「接口清单」,原「概览」挪到接口清单之后,目录同步。原「章节内容指南」「格式要点」保留;原文「复用 template-design-html.md 的 CSS 变量」改成「CSS 变量与设计文档模板一致」。
     - 删掉原「Trigger」「与 write-design-doc 的边界」「依赖」「feature-id 与文件前缀规则」、工作流开头的命名确认、「收尾方式」;删掉对 docgen 的提及。
- 完成条件:
  - 四个文件都在;`grep -n disable-model-invocation assets/claude-template/skills/write-docs/SKILL.md` 命中。
  - 三份参考文件里,md 模板的第一个二级标题分别是 `需求概览`、`架构总览`;两份 HTML 模板前 30 行内有含 `> 产物:` 的注释,正文第一节分别是架构总览、接口清单。
  - 共用约定第 8 条检查通过(write-docs 目录下不出现已废弃 skill 名)。
- 验证方式:
  - `grep -rn "^## " assets/claude-template/skills/write-docs/references/需求文档.md | head -3`
  - `grep -rn -e write-prd -e write-design-doc -e write-api-doc -e knowledge-api -e docgen assets/claude-template/skills/write-docs/`(无结果)
  - `npm run build`
- 独立提交:是。建议标题:`feat(skills): 新增 write-docs——合并 write-prd、write-design-doc、write-api-doc`
- 风险/注意事项:三个旧 skill 在 T-5 才删,这里只新建、不删。

## T-5: 删除 9 个废弃 skill 并登记

- 目标:删掉 9 个废弃 skill 的目录,并登记进 `deprecated-assets.json`,让已部署项目升级时自动清理。
- 对应 spec 条款:§3.1、§4.2、§11、§13 第 1 条。
- 强制引用:无。
- 依赖:T-3、T-4 已完成(它们要读的旧文件在本任务里删除)。
- 涉及范围:
  - 删除目录:`assets/claude-template/skills/` 下的 `subagent-implement`、`knowledge-api`、`code-map-write`、`code-map-recall`、`write-prd`、`write-design-doc`、`write-api-doc`、`knowledge-migrate`、`write-delivery-guide`
  - `assets/claude-template/deprecated-assets.json`
- 必须严格执行:
  - `deprecated-assets.json` 的 `paths` 在现有 6 条之后追加 9 条,写法与现有条目一致:`skills/subagent-implement`、`skills/knowledge-api`、`skills/code-map-write`、`skills/code-map-recall`、`skills/write-prd`、`skills/write-design-doc`、`skills/write-api-doc`、`skills/knowledge-migrate`、`skills/write-delivery-guide`。`$comment` 不改。
  - 只清理 `.claude/` 下这些目录的登记;不碰目标项目 `docs/` 下的任何文件(清单里只放 `skills/...` 路径)。
  - 别的 skill 里对这 9 个 skill 的引用不在本任务改,由后续批次各自负责。
- 允许局部适配:无。
- 具体要求:
  1. `git rm -r` 删除上面 9 个目录。
  2. 编辑 `deprecated-assets.json`,追加 9 条路径。
- 完成条件:
  - `ls assets/claude-template/skills | wc -l` 输出 25(含 T-4 新建的 write-docs)。
  - `node -e "JSON.parse(require('fs').readFileSync('assets/claude-template/deprecated-assets.json','utf8'))"` 不报错;`grep -c '"skills/' assets/claude-template/deprecated-assets.json` 为 15(原有 6 条加 9 条)。
  - `npm run build`、`npm test` 通过。
- 验证方式:上面三条命令。
- 独立提交:是。建议标题:`refactor(skills): 废弃 9 个 skill——删目录并登记 deprecated-assets.json`
- 风险/注意事项:删除和登记必须在同一笔提交里完成,否则已部署项目升级会留下孤儿目录(知识库条目「枚举换血排查教训」记过这个坑)。
