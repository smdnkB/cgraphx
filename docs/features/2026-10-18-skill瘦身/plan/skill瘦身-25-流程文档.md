# 实现计划: skill瘦身 · T-25 流程文档

> 产物: plan
> 依据: spec@4ef10cf

## T-25: FLOW-MAP、模板 CLAUDE.md、cgraphx-guide、本仓库文档和知识库,按保留的 subagent-implement 和新增的 visual-explain 更新

- 目标:讲流程的文档改成新的说法:大需求先 `/write-plan`,再 `/subagent-implement` 一个会话跑完;clarify 结尾只在对话里给决策表,没看懂用 visual-explain 出图解;skill 共 27 个。
- 对应 spec 条款:§1.2、§3、§10、§13 第 10 条
- 强制引用:无(只改文档)
- 涉及范围(13 个文件,和 T-24 不重叠):
  1. `assets/claude-template/FLOW-MAP.md`
  2. `assets/claude-template/CLAUDE.md`
  3. `assets/claude-template/skills/cgraphx-guide/SKILL.md`
  4. `assets/claude-template/skills/cgraphx-guide/how-to-use.md`
  5. `assets/claude-template/skills/cgraphx-guide/how-to-use.html`
  6. `CLAUDE.md`(本仓库)
  7. `README.md`
  8. `README.en.md`
  9. `CHANGELOG.md`
  10. `docs/knowledge/skill-invocation轴.md`
  11. `docs/knowledge/测试流程后置.md`
  12. `docs/knowledge/plan手段决策三档.md`
  13. `docs/knowledge/枚举换血排查教训.md`
- 必须严格执行:
  - skill 名单和个数按 C-1;大需求的说法按 C-2;图解的说法按 C-3;两个新 skill 的一句话介绍按 C-6 的意思写,不另起说法。
  - 要写的事实都在 C-1 到 C-6 里,不读 T-24 改出来的 skill 文件。
  - 只改下面点名的段落;没点名的一律不动。
  - 知识库条目改完要能过 `cgraphx docs validate`:frontmatter 结构不动,`updated` 写 2026-10-19。
- 允许局部适配:
  - 图里改了文字以后,为了对齐可以调整空格。
  - 给出的「改成」原文可以改错别字和标点。
- 具体要求:见下面「逐个文件」。
- 完成条件:
  - 13 个文件按「逐个文件」改完;`git status --short` 里本任务只出现这 13 个路径。
  - 这 13 个文件里不再有「每批一个会话」「每批开一个会话」「每批启动语」「分批,每批」「出澄清结果页」「改动大时出页面」「25 个 skill」这类旧说法;知识库里的历史说明除外,比如 skill-invocation轴 里「原 25 个 skill 全 model-invoked」那一行讲的是 2026-08-01 的情况,保留不动。
  - 可以用 `grep` 自查;不跑构建和测试,统一验证由主会话最后跑。
- 提交点:
  1. `docs(skills): FLOW-MAP、模板 CLAUDE.md、cgraphx-guide 改成 subagent-implement 和图解`:文件 1 到 5
  2. `docs: CLAUDE.md、README、CHANGELOG 按 27 个 skill 更新`:文件 6 到 9
  3. `docs(knowledge): 四个条目补记 subagent-implement 保留和新增 visual-explain`:文件 10 到 13
- 风险/注意事项:
  - how-to-use.md 和 how-to-use.html 内容一一对应,两边要改成一样的话。
  - README、how-to-use 里的工作流全景是等宽字符画,改文字后检查竖线有没有错位。

## 逐个文件

### 文件 1:FLOW-MAP.md

1. 「## 依赖总览」图里:
   - clarify 下面一行「    结束时给出澄清结果:小需求在对话里,改动大时出澄清结果页」改成「    结束时在对话里给流程图和决策表;没看懂可以用 visual-explain 出图解」。
   - write-plan 下面一行「            (大需求分批,每批一句执行会话启动语)」改成「            (一个任务一个文件;大需求给一句 /subagent-implement 启动语)」。
   - 「  implementation(小需求一个会话;大需求每批一个会话,全部完成后 /code-review)」改成「  implementation(小需求)或 subagent-implement(大需求:一个会话按任务派子 agent,统一验证后 /code-review)」。
2. 「## 设计流程」:
   - 「**人工确认点**」里「澄清结果(小需求看对话里的流程图和决策表,改动大看澄清结果页),人说对了才写 spec;」改成「澄清结果(对话里的流程图和决策表,没看懂可以出图解页),人说对了才写 spec;」。
   - 「**产物**」里「`<前缀>-澄清结果-v<N>.html`(讨论稿,不登记)、`plan/<前缀>-index.md` 等」改成「图解页 `<前缀>-<主题>-v<N>.html`(visual-explain 出,讨论稿,不登记)、`plan/<前缀>-index.md` 加一个任务一个文件」。
3. 「## 开发流程」:
   - 「**链**」整条换成:「- **链**:小需求一个会话跑 `/implementation`;大需求先 `/write-plan`,再 `/subagent-implement` 在一个会话里按任务派子 agent 跑完,全部做完统一验证,最后提示跑 `/code-review`。判断看需求规模(预估变更文件 ≥10,且跨 ≥3 个相互独立的模块),不看任务量;拿不准先 `/write-plan`。」
   - 「**小步提交**」整条换成:「- **提交**:任务文件写提交点。大需求由 subagent-implement 的主会话按提交点提交,不构建、不测试,全部做完统一验证;小需求由 implementation 按 plan 的提交点提交。`git-standards.md` 的提交规范结晶进 index「提交规范」节,precommit 门禁兜底;push 永远归用户。」
4. 「## 规范(guides)」那张表里 `git-standards.md` 那一行,第二列开头的「有「独立提交」任务时结晶进 index「提交规范」节(plan 级,一次)」改成「结晶进 index「提交规范」节(plan 级,一次)」,后半句不动。
5. 「## 其他能力」第一行前面加一行:「- `/visual-explain` 图解:没看懂就说「画个图讲讲」,出一页图解;和需求有关的放需求目录,无关的放 `.cgraphx/visual/`」。

### 文件 2:模板 CLAUDE.md

第 4 行(「本项目用 cgraphx 的 skill 流程做需求」那一段)里:

- 「再 clarify 澄清(结束时给出澄清结果)」改成「再 clarify 澄清(结束时在对话里给决策表,没看懂可以用 visual-explain 出图解)」。
- 「大需求先 write-plan 分批,每批一个会话跑 implementation,全部完成后 /code-review」改成「大需求先 write-plan,再 subagent-implement 在一个会话里跑完,最后 /code-review」。

### 文件 3:cgraphx-guide/SKILL.md

1. 「## 整体使用流程」表「**日常做需求 · 必经两步**」行的第二列换成:「`/clarify-requirements` 澄清,结束时在对话里给决策表,然后 `/implementation`;大需求先 `/write-plan`,再 `/subagent-implement` 一个会话跑完,最后 `/code-review`;哪里没看懂,说「画个图讲讲」出一页图解」。
2. 「### 用户主动触发」表:
   - `/clarify-requirements` 行第二列:「接到模糊需求,先澄清意图、业务边界、技术约束,结束时在对话里给流程图和决策表」。
   - `/write-plan` 行第二列:「大需求拆执行计划:index 加一个任务一个文件,给一句 `/subagent-implement` 启动语」。
   - `/implementation` 行第二列:「小需求按 plan 或当前上下文实现代码」。
   - 在 `/implementation` 行后面加一行:「| `/subagent-implement` | 大需求按 plan 执行:一个会话按任务派子 agent,主会话提交、统一验证和修复,最后提示 `/code-review` |」。
   - 在表的最后(`/handdrawn-deck` 行后面)加一行:「| `/visual-explain` | 哪里没看懂,把对话内容或指定的文件、话题画成一页图解 |」。
   - 改完这张表共 23 行,和 C-1「用户会敲的 23 个」一致。

### 文件 4:cgraphx-guide/how-to-use.md

1. 「## 工作流全景」字符画:
   - 「  澄清 + 澄清结果           唯一契约          分批 + 每批启动语」改成「  澄清 + 决策表             唯一契约          一个任务一个文件」。
   - 「  /implementation(小需求一个会话;大需求每批一个会话,做完 /code-review)」改成「  /implementation(小需求)· /subagent-implement(大需求,一个会话跑完,做完 /code-review)」。
2. 图下面一段「大需求先 `/write-plan` 分批,复杂需求按需补规格和测试。」改成「大需求先 `/write-plan`,再 `/subagent-implement` 一个会话跑完;复杂需求按需补规格和测试;哪里没看懂,说「画个图讲讲」出一页图解。」;这一段后面的 timeline 那句不动。
3. 「### 开发流程」列表:
   - clarify 条的「结束时给出澄清结果(小需求在对话里,改动大时出页面)」改成「结束时在对话里给流程图和决策表」。
   - write-plan 条的「大需求分批,每批给一句执行会话启动语」改成「index 加一个任务一个文件,先按任务类型拆,一个任务预估超过 15 个文件再按并行度拆;大需求给一句 `/subagent-implement` 启动语」。
   - implementation 条整条换成:「- **必经** `/implementation`(小需求)或 `/subagent-implement`(大需求):大需求在一个会话里按任务派子 agent,主会话按提交点提交,全部做完统一验证、修复,最后提示跑 `/code-review`;判据是需求规模(预估变更文件 ≥10,且跨 ≥3 个相互独立的模块),不是任务量」。
   - 在 implementation 条后面加一条:「- **随时** `/visual-explain`:哪里没看懂,说「画个图讲讲」,出一页图解;clarify 结尾和 write-plan 请你确认设计预览时会提醒」。
4. 「## docs/ 目录速查」树里「│       ├── <前缀>-澄清结果-v<N>.html  /clarify-requirements 可选  改动大时」改成「│       ├── <前缀>-<主题>-v<N>.html    /visual-explain       可选  要图解时」,列对齐和上下行一致。

### 文件 5:cgraphx-guide/how-to-use.html

和文件 4 一一对应,改成同样的话,HTML 标签和 class 保持原样:

- 工作流全景(`<pre>` 里)两行,同文件 4 第 1 条。
- 「日常默认两步」那一段,同文件 4 第 2 条。
- `tab-dev` 面板的 `<ul class="phase-list">`:clarify、write-plan、implementation 三个 `<li>` 同文件 4 第 3 条;在 implementation 的 `<li>` 后面加一个 `<li>`,写法照抄同列表里「收尾」那条的结构,把 `<span class="opt">收尾</span>` 换成 `<span class="opt">随时</span>`,内容是文件 4 第 3 条新加那条去掉「**随时**」以后的文字,命令用 `<code>` 包住。
- docs 目录速查树(`<pre>` 里,`澄清结果-v` 那一行),同文件 4 第 4 条;`<span class="skill">`、`<span class="opt">`、`<span class="ann">` 的包法照原行。

### 文件 6:本仓库 CLAUDE.md

1. 「**skill 主线**」那一行的「共 25 个 skill」改成「共 27 个 skill」。
2. 「- 需求主线」那一条里,从「→ `/write-plan`(大需求必走,由它分批)」到「日常默认两步:澄清 + 实现。」这一段换成:「→ `/write-plan`(大需求必走:index 加一个任务一个文件)→ `/implementation`(小需求)或 `/subagent-implement`(大需求:一个会话按任务派子 agent,全部做完统一验证,最后 `/code-review`;判据是需求规模——≥10 文件且 ≥3 独立模块,不是任务量)。日常默认两步:澄清 + 实现;哪里没看懂,`/visual-explain` 出一页图解。」

### 文件 7:README.md

1. 「## 工作流全景」字符画两行,改法同文件 4 第 1 条。
2. 「日常默认两步:**澄清 + 实现**。大需求先 `/write-plan` 分批,复杂需求按需补规格和测试。」改成「日常默认两步:**澄清 + 实现**。大需求先 `/write-plan`,再 `/subagent-implement` 一个会话跑完;复杂需求按需补规格和测试;哪里没看懂,说「画个图讲讲」,`/visual-explain` 出一页图解。」

### 文件 8:README.en.md

1. 「## Workflow overview」字符画:
   - 「  clarify + visual summary   sole contract    batches + kickoff lines」改成「  clarify + decision table   sole contract    one file per task」。
   - 「  /implementation (one session; large work: one session per batch, then /code-review)」改成「  /implementation (small) · /subagent-implement (large: one session, then /code-review)」。
2. 「Everyday default: **clarify + implement**. Large work goes through `/write-plan` batches; add spec and tests as complexity grows.」改成「Everyday default: **clarify + implement**. Large work goes through `/write-plan`, then `/subagent-implement` runs every task in one session; add spec and tests as complexity grows. When something is unclear, ask for a picture and `/visual-explain` draws a one-page explainer.」

### 文件 9:CHANGELOG.md

只改 `## Unreleased` 下的「### Breaking — skills slimmed from 33 to 25」这一节:

1. 标题改成「### Breaking — skills slimmed from 33 to 27」。
2. 「- Removed 9 skills.」改成「- Removed 8 skills.」,这一条后半句不动。
3. 删掉 `subagent-implement` 那两行(「  - `subagent-implement`: large work is split into batches by `/write-plan`;」和下一行「    run `/implementation` in a new session per batch, then `/code-review`.」)。
4. `write-delivery-guide` 那条(三行)换成:

   ```text
     - `write-delivery-guide`: no more after-the-fact delivery guides. Use
       `/visual-explain` when something needs explaining.
   ```

5. 在「- Specs drop the 「一图看懂」 section;」那条前面加三条:

   ```text
   - New `visual-explain`: turns what was just discussed, or a named file or
     topic, into a one-page HTML explainer: one picture for the whole, then the
     key points with examples. Pages for a feature go into its directory; others
     go into `.cgraphx/visual/`, which is never committed.
     `/clarify-requirements` ends with a flow chart and a decision table in chat
     and points to it.
   - `subagent-implement` stays, rewritten: one session hands each task of the
     plan to a subagent in the plan's order; the main session commits each task,
     runs the plan's verification once at the end, fixes failures, then suggests
     `/code-review`.
   - Plans are an `index` plus one file per task. Tasks are split by type first;
     a task that would touch more than 15 files is split further where its parts
     can run in parallel.
   ```

### 文件 10:docs/knowledge/skill-invocation轴.md

1. frontmatter 的 `related_code` 末尾加两行:`assets/claude-template/skills/subagent-implement/SKILL.md`、`assets/claude-template/skills/visual-explain/SKILL.md`;`updated` 写 2026-10-19。
2. Summary 段末句「2026-10-19 skill瘦身后为 25 个:17 个 model-invoked、8 个 user-invoked,见文末更新。」改成「2026-10-19 skill瘦身后为 27 个:19 个 model-invoked、8 个 user-invoked,见文末更新。」
3. 文末「## 2026-10-19 更新(skill瘦身)」整节换成:

   ```markdown
   ## 2026-10-19 更新(skill瘦身)

   2026-10-19 瘦身废弃 8 个 skill(knowledge-api、code-map-write、code-map-recall、write-prd、write-design-doc、write-api-doc、knowledge-migrate、write-delivery-guide),合并 2 处(knowledge-api 并入 knowledge-recall;write-prd、write-design-doc、write-api-doc 合成 write-docs),新增 visual-explain,后剩 27 个。

   - model-invoked 19 个:(照抄 C-1 的 19 个名字)
   - user-invoked 8 个:(照抄 C-1 的 8 个名字)

   write-docs 沿用 write-prd、write-design-doc、write-api-doc 三个旧 skill 的 user-invoked;knowledge-api 并入 knowledge-recall 后,knowledge-recall 仍是 model-invoked。subagent-implement 保留并改写,仍是 model-invoked,用户说「跑 plan」「按 plan 实现」时由 AI 调用。新增的 visual-explain 也是 model-invoked:用户说「没看懂」「画个图讲讲」时由 AI 调用,用户没要求时不主动出页面。
   ```

   括号里的两处照抄 C-1 的名单,用顿号分隔,不保留括号说明。
4. 其他段落(包括 2026-08-01 的分组说明)不动。

### 文件 11:docs/knowledge/测试流程后置.md

文末那行「2026-10-19:subagent-implement 已废弃,实现只剩 implementation 一条路。」改成「2026-10-19:subagent-implement 保留并改写。实现有两条路:小需求 implementation,大需求 subagent-implement 在一个会话里按任务派子 agent;两条路都不写新测试,测试仍是代码完成后的独立流程。」;`updated` 保持 2026-10-19。

### 文件 12:docs/knowledge/plan手段决策三档.md

「**残余风险**」那一条里「全部批次完成后回 Claude 跑 `/code-review` 整体审查(2026-10-19 起;原为 subagent-implement 的 spec-reviewer 实现期再审,该 skill 已废弃)」改成「全部任务做完、统一验证通过后,由用户跑 `/code-review` 整体审查(2026-10-19 起;subagent-implement 改写后不再逐任务派 spec-reviewer)」;这一条其余文字不动,`updated` 保持 2026-10-19。

### 文件 13:docs/knowledge/枚举换血排查教训.md

「排查与复审分离」那一条末尾的「(2026-10-19 起,最终复审由全部批次完成后的 `/code-review` 承担)」改成「(2026-10-19 起,最终复审由全部任务做完、统一验证通过后的 `/code-review` 承担)」;这一条其余文字不动,`updated` 保持 2026-10-19。
