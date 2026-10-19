# 实现计划: skill瘦身 · 批次 6 知识库与规范

> 产物: plan
> 依据: spec@cf4712c

## 共用约定

本文件的任务都改 skill 模板,执行前先读完本节。

1. 分支:在 `feat/skill瘦身` 上做(没有就从 `main` 建);开工前 `git status` 确认暂存区是空的。
2. 改动入口:只改 `assets/claude-template/` 下的文件;本仓库根目录的 `.claude/` 不动。不改 `docs/` 下任何已有文件。
3. 删减规则(spec §4.1):本文件的 knowledge-init、iboc-check、init-project-guides 都是设计侧:删跨 skill 重复的规则、程序会检查的规则、通用方法论、长篇 ❌ 清单、逐条自检、为防较弱模型跑偏写的解释;HARD-GATE、红线、范例保留。只删任务点名的内容,没点名的段落不动。
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

6. 每个任务做完:
   - `grep -n -e subagent-implement -e knowledge-api -e code-map -e write-prd -e write-design-doc -e write-api-doc -e knowledge-migrate -e write-delivery-guide <本任务改过的文件>` 无结果;
   - SKILL.md 开头的 frontmatter(`name`、`description`)完整;
   - `npm run build` 通过。
7. 提交:标题格式 `type(scope): 中文描述`,补充说明用「——」,并列用「+」;每个 skill 一笔。本仓库的提交门禁会先拦一次,自查后用 `CGRAPHX_PRECOMMIT_REVIEWED=1 git commit ...` 重试。
8. 遇到任务要求和 spec 冲突、要改范围外的文件、点名要删的段落找不到,停下写 `PLAN_CONFLICT: <原因>`。

## T-16: knowledge-init 照 knowledge-write 模板写条目,整个改成中文

- 目标:子 agent 写条目时照 knowledge-write 的实体、流程两种模板写,不再自己定分类和章节规则;保留骨架(找入口、分批派子 agent 探索、合并跨模块的概念、中断后接着跑);整个 skill 改成中文;删掉解释性段落和已作废的字段。
- 对应 spec 条款:§3.3、§7.5、§4.1。
- 强制引用:无。
- 依赖:无。
- 涉及范围:`assets/claude-template/skills/knowledge-init/SKILL.md`
- 必须严格执行:
  - 骨架保留:前置检查脚本、配置块、队列文件路径和 JSON 结构、阶段一四步、阶段二批次循环(含 Case A、B、C 和三段 jq、shell 脚本)、阶段三五步、两层去重脚本、中断恢复七条、两个子 agent 模板和它们的返回 JSON。
  - 子 agent 写条目一律照 knowledge-write:document_type、正文章节、domains、文件名都以 knowledge-write 为准;只有 `source_type` 填 `batch_exploration`、`related_code` 填实际看过的文件路径这两项按批量建档定;写完必须过 `cgraphx docs validate`。
  - 代码块里的命令、jq 表达式、JSON 键名、配置键名不改;只翻译代码块外的英文和代码注释里的英文。
- 允许局部适配:各节中文标题的措辞;翻译时的句式。
- 具体要求(按原文顺序):
  1. frontmatter:`name`、`disable-model-invocation: true` 不变;`description` 改成中文:「陌生项目从零建知识库:用 rg、grep、Read 找入口,分批派子 agent 深入探索,条目照 knowledge-write 的模板写进 docs/knowledge/,最后合并跨模块的概念,中断后能接着跑。依赖 knowledge-write skill。Use when 探索陌生项目、摸清新代码库、从零建知识库、explore this project、build a knowledge base。」
  2. 一级标题下的英文介绍段换成一句中文;「**Dependencies:**」改为「**依赖**」,四条译成中文。
  3. 删掉「Trigger」整节。
  4. 「Pre-flight Check」改名「前置检查」,脚本保留;脚本后的英文句子改为:「cgraphx 不可用时不降级运行,请用户先 `npm install -g cgraphx`。」
  5. 「Configuration」改名「配置」:配置块删掉 `use_persistent_dedup` 这一行;删掉「项目规模预期」表格、表后那段解释和「千万行级别现实建议」整个列表,换成一句:「千万行级项目:`concurrent_agents` 调到 4 到 8,`max_explored` 不超过 20000,务必利用中断恢复;阶段一的选语言、排除规则两步不能跳。」
  6. 「与 cgraphx 的协作(Tools Coordination)」整节换成三句:「代码事实靠 `rg`、`grep`、`Read`;业务理解写进 `docs/knowledge/`,由 `cgraphx docs` 管概念索引、去重和校验。没有 cgraphx 不能启动。`cgraphx docs index` 只在阶段二末尾和阶段三末尾各跑一次。」
  7. 「Queue File」改名「队列文件」:JSON 示例里删掉 `seen_normalized_names` 那一行;「设计要点」删掉 `seen_normalized_names` 那一条,其余保留;末尾 `phase values: …` 改为中文「`phase` 的取值:`exploration`、`deep_dive`、`completed`」。
  8. 「Main Agent Workflow」改名「主流程」,三个阶段标题改为「阶段一:找入口」「阶段二:分批探索」「阶段三:合并跨模块的概念」;各 Step 的英文标题译成中文。
  9. 阶段一 Step 3 后面「grep 模式局限」三条压成一条:「字符串匹配会漏掉接口实现、动态分发、继承覆盖;每个候选至少 Read 一段实现,确认是业务逻辑而不是框架样板。」
  10. 阶段二:
      - Case A 第 2 条下删掉「不再写 `seen_normalized_names`…」这一子项;第 3 条下删掉「entry point name 维度的 dedup 状态完全在…」这一子项。
      - Case C 的标题「完成但产出可疑(`DONE_WITH_CONCERNS` 或文档缺 Evidence)」改为「完成但产出可疑(`DONE_WITH_CONCERNS`)」。
      - 成功项写回示例脚本里删掉注释「# queue 本地只改 pending 和 explored_count(不再维护 seen_normalized_names)」,命令不动。
      - Step 3 第 1 条压成一句:「批次之间不跑 index(全量重建太慢);阶段二里新概念的第二层去重会漏判,第一层仍能挡住入口重复,可以接受。」
      - 删掉 Step 4 之后的「Pipeline flow」图和「为什么不能每批次 index?」整段;Step 4 末尾那句引用块(`explored_count` 是独立计数器)保留。
  11. 阶段三:开头「核心思路」压成一句:「跨模块概念 = 代码里被多个文件引用的符号,加上知识库里被多篇文档提到但没有专属条目的概念,两者交叉确认。」Step 1 的「指标说明」只留「局限」一条;Step 1 末尾「被多个文件引用的 symbol 就是…」一段删掉;Step 2 到 Step 5 保留。
  12. 「Dedup Rules」改名「去重」:开头英文段译成中文一句;两层的脚本和各自一句说明保留;删掉「Fallback(`use_persistent_dedup: false` 时)」整段;「File-level coverage is NOT a dedup signal」译成「文件已被探索过不算去重依据:一个文件里可能有多个独立功能」;「框架 boilerplate 不进 dedup 流程」一句保留。
  13. 「Resuming After Interruption」改名「中断后接着跑」:「If the queue file exists with `phase` not `completed`:」译成「队列文件存在且 `phase` 不是 `completed` 时:」;七条保留;「Do NOT restart from Phase 1.」译成「不要从阶段一重来。」;删掉最后一段关于旧版 `seen_normalized_names` 字段的说明。
  14. 「Sub-Agent Template」改名「子 agent 模板」,第一句译成「每个子 agent 的 prompt 照下面填好 `{占位}` 再派:」。模板里【保存知识文档】整段(原第 1 到 10 条)换成:

      ```text
      【保存知识文档】
      先用 Skill 工具加载 knowledge-write,完整照它的流程和模板写:业务实体用 template-concept.md,业务流程用 template-flow.md,其他类型按 knowledge-write 的模板表选。document_type、正文章节、domains、文件名一律以 knowledge-write 为准,这里不另定规则。
      只有两项按批量建档填:source_type 填 batch_exploration;related_code 填实际看过的文件路径(grep 输出里有,直接复制)。
      写完必须 `cgraphx docs validate <file>` 通过;不通过就改 frontmatter 再写,直到通过。
      ```

      模板里其余部分(入口点、工具优先级、rg 命令、Read 策略、已有业务知识、项目信息、任务 1 到 3、返回 JSON)保留。
  15. 「Cross-cutting Sub-Agent Template」改名「跨模块子 agent 模板」,第一句译成「阶段三里 `type: "cross_cutting_concept"` 的待办用这个模板:」。模板【输出】里「document_type 建议」三条和「frontmatter」三条换成:「照 knowledge-write 的流程和模板写(加载方式同上);related_documents 填引用的已有文档,related_code 填跨文件引用结果里的高中心性文件。」;「**Write 后必须 … 校验通过**(同知识文档流程步骤 10)」改为「写完必须 `cgraphx docs validate <file>` 通过。」;其余保留。
  16. 「Quality Rules」改名「质量要求」,只留三条并译成中文:每个子 agent 至少看 3 个文件,不只看入口文件;新入口必须真正独立,已探索入口调用的 helper 不算新入口;项目用了框架(Spring、Express、Axum、Django)时,框架样板不是入口,只看业务逻辑。删掉要求 Evidence、Impact For Future Changes 两节的两条(与 knowledge-write 的模板冲突)。
- 完成条件:
  - `grep -n -e "Use this skill" -e "Each sub-agent" -e "Do NOT" -e "Fallback" -e "Evidence" -e "Impact For Future" -e "seen_normalized_names" -e "use_persistent_dedup" -e "kebab-case" assets/claude-template/skills/knowledge-init/SKILL.md` 无结果。
  - `grep -n "template-concept.md" assets/claude-template/skills/knowledge-init/SKILL.md` 命中。
  - 比原来至少短 100 行(原 761 行)。
  - 共用约定第 6 条检查通过。
- 验证方式:上面的 grep;`wc -l`;`npm run build`。
- 独立提交:是。建议标题:`refactor(skills): knowledge-init 改成中文 + 条目照 knowledge-write 模板写——删作废的去重字段和解释段`
- 风险/注意事项:脚本是这个 skill 能跑起来的关键,翻译时不要改动任何命令和 jq 表达式;拿不准某段算不算解释,保留。

## T-17: iboc-check 缺什么看 `features show`,补头部不加产物类型

- 目标:核对缺什么改看 `cgraphx features show` 的结果,不再由 AI 逐个目录扫文件名;给旧 spec 补头部时只补负责人、feature-id、日期,不加 `> 产物:`;设计文档的指引改为 `/write-docs`;删掉和 HARD-GATE 重复的段落。
- 对应 spec 条款:§3.3、§7.4、§4.1。
- 强制引用:无。
- 依赖:无。
- 涉及范围:`assets/claude-template/skills/iboc-check/SKILL.md`(`filler-prompt.md` 不动)
- 必须严格执行:
  - 批量补齐、逐个需求派 filler 子 agent 补全、串行派任、子 agent 不提交、主 agent 小步提交,这些做法不变。
  - 不新增可补的产物种类:仍是单元测试规格、单元测试报告、收口档案三样;设计文档仍不在补账范围,只把指引改成 `/write-docs`(负责人已确认这样解读 spec §7.4)。
- 允许局部适配:措辞。
- 具体要求:
  1. 「流程」第 3 步第一句「逐候选核主 spec 与齐全度(产物 bar = 第 2 步勾选范围):」改为:「逐候选跑 `cgraphx features show <feature-id>`,从「产物」一节看有没有主 spec(规格说明 spec)和勾选范围内的产物(单元测试规格 unit_test_spec、单元测试报告 unit_test_report、收口档案 closure_record),不再逐个目录扫文件名;主 spec 头部三行(feature-id、负责人、日期)打开 spec 文件确认:」。下面第一条里「(`<前缀>-spec.md` 和 `spec.md` 都没有)」改为「(show 的产物里没有规格说明)」;其余两条不动。
  2. 「流程」第 5 步「三行取值:…」这一句后面加一句:「只补这三行,不加 `> 产物:`,老 spec 继续按文件名识别。」
  3. 删掉「边界场景」整节(各条已在 HARD-GATE 和流程里)。
  4. 「不做的事」只留三条:「不补设计文档——不在补账范围,发布后按需走 `/write-docs`」「不写业务实现代码(子 skill 也不写)」「不 push(只提交,push 归用户)」;其余删掉(已在 HARD-GATE 里)。
  5. 「和其他 skill 的关系」:第一条「**implementation / subagent-implement**:上游…」改为「**implementation**:上游,代码开发完成后才轮到本 skill」;删掉「**subagent-implement**:同款 controller/子 agent 模式…」这一条;其余保留。
  6. 「定位」「HARD-GATE」「派任模板」「结束后」不动。
- 完成条件:
  - `grep -n "features show" assets/claude-template/skills/iboc-check/SKILL.md` 命中;`grep -n "老 spec 继续按文件名识别" assets/claude-template/skills/iboc-check/SKILL.md` 命中。
  - 共用约定第 6 条检查通过。
- 验证方式:上面的 grep;`npm run build`。
- 独立提交:是。建议标题:`refactor(skills): iboc-check 缺什么改看 features show + 补头部不加产物类型 + 设计文档指向 write-docs`
- 风险/注意事项:`features show` 的产物名形如「单元测试规格 unit_test_spec」,判断时认类型标识,不认显示名。

## T-18: init-project-guides 提交规范模板给大白话的 commit 标题范例

- 目标:目标项目生成的 `git-standards.md` 里,commit 标题范例用业务上的大白话写;有正文约定时,正文第一行先讲原来的情况。
- 对应 spec 条款:§3.3、§4.3(commit 标题一行)。
- 强制引用:无。
- 依赖:无。
- 涉及范围:`assets/claude-template/skills/init-project-guides/templates/git-standards.md`(SKILL.md 不动)
- 必须严格执行:
  - 遵守这个模板自己的「生成形态纪律」:只给正例和来源标注,不加反例。
  - 本仓库自己的 `docs/guides/git-standards.md` 不改。
- 允许局部适配:标注列的对齐空格。
- 具体要求:
  1. 「第一部分 · 提交消息规范」里的代码块,把「提交格式」的正例和标注改为(照抄):

     ```
     ## 提交格式(就这一种,照抄)
     CRM-req74442 下单积分按会员等级发放 --2 @req74442
     ├─ CRM-req74442               需求号,来自 <实际票据系统,如 Jira 需求单>;同一需求贯穿同一编号(含 @ 处)
     ├─ 下单积分按会员等级发放 --2   这次改了什么,用业务上的说法写,不写模块名、函数名和缩写;多步任务末尾 --序号
     └─ @req74442                  编号收尾,便于 git log 按号追溯
     bug 同构:bug58017 <描述> @bug58017
     <有正文约定时加一行:正文第一行先讲原来的情况,如「原来下单统一返 1% 积分」>
     ```

  2. 「行为规则」三条和代码块后面的「挖掘口径」「新项目(无历史)」两段不动;第二部分不动。
- 完成条件:`grep -n "下单积分按会员等级发放" assets/claude-template/skills/init-project-guides/templates/git-standards.md` 命中;`git diff --stat` 只有这一个文件。
- 验证方式:上面的命令;`npm run build`。
- 独立提交:是。建议标题:`refactor(skills): init-project-guides 提交规范模板给大白话的 commit 标题范例`
- 风险/注意事项:无。
