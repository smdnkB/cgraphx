# 实现计划: skill瘦身 · T-24 skill 行为

> 产物: plan
> 依据: spec@4ef10cf

## T-24: subagent-implement 改写、新增 visual-explain,clarify 和 write-plan 跟着改

- 目标:subagent-implement 按新规则改写,新增 visual-explain;clarify 结尾不再自动出页面,只提醒图解;write-plan 改成一个任务一个文件,implementation 按新结构读 plan;5 个 skill 补回 subagent-implement 的引用;废弃清单同步。
- 对应 spec 条款:§3.3、§3.4、§4.2、§4.3、§6、§7.1、§7.2、§7.3、§7.6、§8.5、§10 第 5 行、§12、§14
- 强制引用:无(只改 markdown、HTML 和一个 JSON 清单)
- 涉及范围(14 个文件,和 T-25 不重叠):
  1. 新建 `assets/claude-template/skills/subagent-implement/SKILL.md`
  2. 新建 `assets/claude-template/skills/visual-explain/SKILL.md`
  3. 新建 `assets/claude-template/skills/visual-explain/references/范例-澄清结果.html`
  4. 改 `assets/claude-template/skills/clarify-requirements/SKILL.md`
  5. 删 `assets/claude-template/skills/clarify-requirements/references/澄清结果页.md`;删完 `references/` 目录是空的,一起删掉
  6. 改 `assets/claude-template/skills/write-plan/SKILL.md`
  7. 改 `assets/claude-template/skills/write-plan/plan-document-reviewer-prompt.md`
  8. 改 `assets/claude-template/deprecated-assets.json`
  9. 改 `assets/claude-template/skills/write-api/SKILL.md`
  10. 改 `assets/claude-template/skills/run-api-test/SKILL.md`
  11. 改 `assets/claude-template/skills/iboc-check/SKILL.md`
  12. 改 `assets/claude-template/skills/run-ui-test/SKILL.md`
  13. 改 `assets/claude-template/skills/knowledge-write/SKILL.md`
  14. 改 `assets/claude-template/skills/implementation/SKILL.md`
- 必须严格执行:
  - 两个新 skill 的 frontmatter:`name` 按 C-1 的名字,`description` 按 C-6 原文,一字不改。
  - clarify 和 write-plan 的提醒按 C-4 原文。
  - 启动语格式和任务文件命名按 C-5;图解页的位置、命名和性质按 C-3;大需求的说法按 C-2。
  - subagent-implement 的行为逐条按 spec §7.6,以及 §12 里和它有关的三行;visual-explain 按 spec §6。
  - subagent-implement 是执行侧:写步骤说明和自检。visual-explain 是设计侧:只写讲法、范例和硬规则,不写长篇解释。
  - 改已有文件时,只动下面点名的段落;没点名的一律不动。
  - 下面给出的范例原文照抄进 skill,可以改错别字和标点,场景、数字和结构不改。
- 允许局部适配:
  - 新 skill 的小标题措辞、同一节里条目的顺序可以调;每节必须有的内容不能少。
  - 删掉点名段落以后,为了衔接可以改一两句过渡语。
- 具体要求:见下面「逐个文件」。
- 完成条件:
  - 14 个文件按「逐个文件」改完;`git status --short` 里本任务只出现这 14 个路径。
  - `assets/claude-template/skills/` 下正好 27 个目录。
  - `deprecated-assets.json` 仍是合法 JSON,不含 `skills/subagent-implement`,含 `skills/clarify-requirements/references/澄清结果页.md` 和旧版 subagent-implement 的三个提示词路径。
  - 范例页和 `docs/features/2026-10-18-skill瘦身/skill瘦身-澄清结果-v2.html` 逐字节相同。
  - 可以用 `ls`、`grep`、`cmp`、`node -e` 自查;不跑构建和测试,统一验证由主会话最后跑。
- 提交点:
  1. `feat(skills): 新增 visual-explain——把对话内容画成一页图解 + clarify 结尾改成提醒图解`:文件 2、3、4、5(文件 5 是删除,主会话用 `git add <文件 5 的路径>` 把删除放进这一笔)
  2. `refactor(skills): subagent-implement 改写——一个会话按任务派子 agent,主会话提交和统一验证`:文件 1
  3. `refactor(skills): write-plan 改成一个任务一个文件 + implementation 按新结构读 plan`:文件 6、7、14
  4. `refactor(skills): 废弃清单撤掉 subagent-implement + 登记旧版提示词和 clarify 旧附属文件`:文件 8
  5. `docs(skills): 五个 skill 补回 subagent-implement 的引用`:文件 9 到 13
- 风险/注意事项:
  - clarify 只删出页面的部分;对话版范例、决策表和下半部分都保留。
  - write-plan 改的地方多,逐条对照下面的清单;「设计预览」「适用规范」的说明条目、「No Placeholders」的例外、「红线」这些没点名的内容不要动。
  - 范例页是原样复制,不改里面任何内容。

## 逐个文件

### 文件 1:新建 subagent-implement/SKILL.md

按下面的结构写。每节写到列出的内容;三段范例(派任说明、回报格式、收尾汇报)原样照抄,放进代码块;第 9 条的表格照抄为表格。

1. frontmatter:`name: subagent-implement`;`description` 按 C-6。
2. 一级标题:`# Subagent Implement`。
3. `## 定位`,三条:
   - 大需求的执行方式:在一个会话里按 plan 的任务派子 agent,每个子 agent 是一份新的上下文;主会话只负责派任、提交、统一验证和修复。
   - 在设计会话里直接跑,或者新开一个会话跑;启动语都是 index 末尾那一句。
   - 小需求不用它,一个会话跑 `/implementation`。
4. `## 开跑前`,三步:
   1. 看分支:当前在 main 或 master 上,先停下问用户要不要建分支。
   2. 读 index:只读「任务清单」「执行顺序」「提交规范」「统一验证」四节;任务清单里列了每个任务的涉及范围,核对回报时用它。任务文件正文和代码都不读。
   3. 定起点:用户指定了从哪个任务开始,就从那里开始;同一个会话里已经提交的任务不重跑。
5. `## 流程`,五步:
   1. 派任务:按执行顺序一步一步派;同一步里标了能同时跑的,在同一条消息里一起派。用 general-purpose 子 agent,不指定 model。派任说明照「派任说明范例」写,后面接着贴「回报格式」。
   2. 收回报、提交:回报的结果是「完成」时,先核对回报里的文件都在 index 任务清单写的这个任务的涉及范围里,也没和同一步同时跑的任务重叠,再按提交点逐笔提交,见「提交」;不构建、不测试。回报里有「要人验证的」,照常提交,不等人,记下来放进收尾汇报。结果是「冲突」或「卡住」时,见「停下问用户」。
   3. 统一验证:全部任务都提交以后,逐条跑 index「统一验证」里的命令,记下每一条的结果。
   4. 修复:有失败时由主会话负责。改一两个文件就能修好的,主会话直接改;修复量大时,派一个修复子 agent,把失败输出和相关任务文件的路径给它,让它只改文件、不提交,主会话再跑统一验证确认。修复单独提交,标题写成 `fix(<scope>): <修了什么>`。修完再跑一遍统一验证,直到通过。
   5. 收尾:按「收尾汇报范例」写给用户;汇总子 agent 报的「值得沉淀的」,问一句要不要用 knowledge-write 沉淀;有需求目录时跑 `cgraphx features show <feature-id>`,平台环节里标「缺(必需)」的提醒一句;最后提示用户跑 `/code-review`,不自动跑;不 push。
6. `## 派任说明范例`,照抄:

   ```text
   读 .claude/skills/implementation/SKILL.md,按它执行一个任务。
   index:docs/features/2026-10-20-订单导出/plan/订单导出-index.md
   你的任务:T-2 后端,任务文件 docs/features/2026-10-20-订单导出/plan/订单导出-02-后端.md。
   只读 index 和你的任务文件;别的任务文件不读、不改。
   这次只改文件:不构建、不测试、不提交;implementation 收尾的沉淀提示和平台环节提醒也不做。
   要改的文件超出任务的「涉及范围」时,先停下,回报「卡住」并写明原因。
   做完按下面的格式回报。
   ```

7. `## 回报格式`,照抄:

   ```text
   结果:完成(另两种是「冲突」「卡住」,写明原因)
   提交点:
     1. feat(order): 订单导出接口
        src/order/export-service.ts
        src/order/routes.ts
     2. feat(order): 导出记录表的读写
        src/order/export-record-repo.ts
   按 plan 执行:PLAN_FOLLOWED(PLAN_ADAPTED 时写明改了什么,PLAN_CONFLICT 时写明和哪条契约冲突)
   要人验证的:无(有就写验证什么、预期是什么)
   值得沉淀的:导出文件名要带租户编号,否则多租户下会互相覆盖(没有写「无」)
   ```

8. `## 提交`,三条:
   - 只 stage 回报里这一笔列出的文件,不用 `git add -A` 或 `git add .`。
   - 提交说明按 index「提交规范」写;提交门禁拦下时,按「提交规范」的检查点自查,再带 `CGRAPHX_PRECOMMIT_REVIEWED=1` 重新提交。
   - `features check` 报失败时,按提示改对,算主会话的小修复,改完和这一笔一起提交。
9. `## 停下问用户`,照抄这张表和表后一句:

   | 情况 | 怎么做 |
   |---|---|
   | 开跑前发现在 main 或 master 上 | 先不派任务,问要不要建分支 |
   | 子 agent 回报「冲突」或「卡住」 | 已经在跑的让它跑完,完成的照常提交;后面的不再派;把原因报给用户 |
   | 回报的文件超出任务的涉及范围,或者和同时跑的任务重叠 | 这个任务先不提交,停下问用户 |
   | 统一验证里同一个问题修了两轮还没过 | 停下,把失败情况和已做的修复报给用户 |

   用户说继续时,从停下的任务接着派;已经提交的任务不重跑。
10. `## 收尾汇报范例`,照抄:

    ```text
    原来订单只能在数据库里手工查了再导出;这次 4 个任务都做完并已提交:数据库加了导出记录表,后端加了导出接口,前端订单页加了导出按钮,配置加了导出文件的保存目录。

    统一验证:npm run build 通过;npm test 有 2 个失败,在后端的导出接口测试里,主会话改好后单独提交 1 笔,再跑全部通过。

    要你验证的:打开订单页,点导出,下载的文件里有备注列。
    按 plan 执行:T-3 PLAN_ADAPTED(导出按钮复用了现有的工具栏组件),其余 PLAN_FOLLOWED;没有出现 PLAN_CONFLICT。
    值得沉淀的:导出文件名要带租户编号,否则多租户下会互相覆盖。要用 knowledge-write 沉淀吗?
    平台环节还缺:测试。可以跑 /write-api 或 /write-unit-test-spec 补。

    下一步:跑 /code-review,审 feat/订单导出 相对 main 的改动。
    ```

11. `## 自检`,交给用户前逐条过,四条:
    - 每个任务都已提交,没提交的写明了原因。
    - 统一验证每一条都跑了,结果写进了汇报。
    - 要人验证的、按 plan 执行的情况、值得沉淀的,都已汇总。
    - 没有 push,也没有自动跑 `/code-review`。
12. `## 红线`,五条:
    1. ❌ 不让子 agent 构建、测试、提交。
    2. ❌ 不在 main 或 master 上直接开跑。
    3. ❌ 不跳过统一验证就交给用户。
    4. ❌ 不自动 push,不自动跑 `/code-review`。
    5. ❌ 不用 git worktree;改到同一个文件的任务不同时跑。

### 文件 2:新建 visual-explain/SKILL.md

1. frontmatter:`name: visual-explain`;`description` 按 C-6。
2. 一级标题:`# Visual Explain`。
3. `## 定位`,三条:
   - 降低人看懂 AI 输出的成本:把对话里说过的内容,或者用户指定的文件、话题,画成一页图解。
   - 用户说「没看懂」「画个图讲讲」「图解一下」时用;用户没要求时不主动出页面。
   - 图解是讨论稿,不是契约,看完不再维护。
4. `## 流程`,六步:
   1. 定要讲什么:先用一句话说清用户看完要懂什么。
   2. 选主线:按「讲法」表选;拿不准沿哪条线讲,先问用户。
   3. 画全局:一张图看清整体,标出新增、改动、去掉的地方和需要人确认的关口。
   4. 展开局部:关键节点写细节,每个结论配一个例子。
   5. 写成一页:按「页面要求」写,版式照 `references/范例-澄清结果.html`。
   6. 存好、打开:按「放在哪」存;用系统浏览器打开,macOS 用 `open`,Linux 用 `xdg-open`,Windows 用 `start`;打不开就把文件路径给用户。
5. `## 讲法:全局加局部`:先写两条,照抄 spec §6.2 的「全局」「局部」两条;再照抄 spec §6.2 的五行表(表头:要讲的内容、主线沿着、全局、局部)。
6. `## 页面要求`,三条,照 spec §6.3 的「形式」「开头」「澄清结果的图解」三行写。
7. `## 放在哪`:
   - 按 C-3 写位置、命名、版本和性质。
   - 和需求有关但还没有需求目录时,按 write-spec 的命名规则定 feature-id、建目录。
   - 拿不准和哪个需求有关,先问用户。
8. `## 范例`,照抄这段:「`references/范例-澄清结果.html` 是 skill瘦身 的澄清结果图解,属于「流程或工具调整」:开头一段加四个数字,「要做的事情」是两组决策表,「会得到的结果」每部分先全局再局部。要出页面时先读它,版式、配色、深浅色和窄屏表格照它写,内容换成要讲的东西。」
9. `## 红线`,四条:
   1. ❌ 用户没要求时不主动出页面。
   2. ❌ 不写 `> 产物:` 头部,不登记,不上报,不当契约引用。
   3. ❌ 不加载外部的脚本、字体和图片,断网要能打开。
   4. ❌ 不编造:图里的每个节点、每条结论都要在对话、文件或代码里有依据。

### 文件 3:新建 visual-explain/references/范例-澄清结果.html

从 `docs/features/2026-10-18-skill瘦身/skill瘦身-澄清结果-v2.html` 原样复制,不改任何内容:

```bash
mkdir -p assets/claude-template/skills/visual-explain/references
cp docs/features/2026-10-18-skill瘦身/skill瘦身-澄清结果-v2.html assets/claude-template/skills/visual-explain/references/范例-澄清结果.html
```

### 文件 4:改 clarify-requirements/SKILL.md

1. frontmatter `description` 的最后一句「结束时给出可视化的澄清结果:小需求在对话里给流程图和决策表,改动大时在需求目录出澄清结果页。」改成「结束时在对话里给流程图和决策表,并提醒没看懂可以用 visual-explain 出图解。」
2. 「### 输出什么」下面:删掉整张表(表头「情况 | 输出」的三行表),再删掉表后那句「出页面时,供 spec 使用的下半部分仍写在对话里;澄清结果页是讨论稿,不算 spec,HARD-GATE 不拦它。」,换成一句:「在对话里给流程图和决策表,照下面的对话版写,不写文件。」
3. 「### 对话版(按此示例写)」的代码块:在最后一行 `**以上业务决策对吗?要改的直接说哪一行。**` 后面空一行,加上 C-4 的 clarify 提醒原文。代码块下面的说明条目末尾加一条:「- **结尾提醒**:最后一句照范例写,只提醒,不自动出页面。」
4. 「### 结束条件」里的「发现不对就改,页面出下一版,旧版保留。」改成「发现不对就改,改完再给一版。」
5. 「## 推荐下一步」表里「大需求」那一行,推荐列「先 `/write-plan`,由它分批,每批一个会话跑 `/implementation`」改成「先 `/write-plan`,再 `/subagent-implement`」。
6. 「### 下半部分」的「用户控制的下一步」里,「`/write-plan`(大需求分批)」改成「`/write-plan`(大需求,写完用 `/subagent-implement` 跑)」。

### 文件 5:删 clarify-requirements/references/澄清结果页.md

```bash
rm assets/claude-template/skills/clarify-requirements/references/澄清结果页.md
rmdir assets/claude-template/skills/clarify-requirements/references
```

只删工作区里的文件,不用 `git rm`:删除由主会话在提交点 1 里 stage,免得同时跑的 T-25 提交时把它带进去。它的讲法已经写进 visual-explain(文件 2);clarify 的 SKILL.md 里不再链接它(文件 4 第 2 条已删)。

### 文件 6:改 write-plan/SKILL.md

逐条改,没列的不动:

1. frontmatter `description`:
   - 「默认产出 docs/features/{feature-id}/plan/ 下的 <文件前缀>-index.md、<文件前缀>-01-schema.md、<文件前缀>-02-backend.md、<文件前缀>-03-frontend.md 等按需文件(文件前缀算法见 SKILL 正文)」改成「默认产出 docs/features/{feature-id}/plan/ 下的 <文件前缀>-index.md,加上一个任务一个的 <文件前缀>-<两位序号>-<任务名>.md(文件前缀算法见 SKILL 正文)」。
   - 「大需求拆成几批,每批给一句执行会话启动语。」改成「大需求由 /subagent-implement 按任务派子 agent 执行,index 给一句启动语。」
2. 「## 定位」第 3 条末尾「其余部分写给执行会话(见「消费模型与防漂移」)」改成「其余部分写给子 agent(见「消费模型与防漂移」)」。
3. 「## 工作流程」第 5 步「5. **生成文件**:index.md 必须;01-04 按需,不建空文件(不涉及 → index 中标记)。」改成「5. **生成文件**:index 加每个任务一个文件,见「任务文件」。」
4. 「## 拆分规则」整节换成下面 8 条,「测试不进 plan」那条沿用原文:
   - 先按任务类型拆:数据库、后端、前端、配置、文档等,一类一个任务。
   - 一个任务预估改动超过 15 个文件,算一个子 agent 做不完,再按并行度往下拆:拆成改的文件不重叠、只靠 index 契约衔接的几块,拆到每块不超过 15 个文件为止,不拆到底。超过 15 个文件但改动强耦合、找不到并行边界的,不硬拆,在任务文件里写明原因。
   - **测试不进 plan**:(原文照留)
   - 高风险任务写保护条件和回退思路。
   - **提交点**:每个任务写清分几笔提交,每笔的提交说明和包含的文件;一个任务可以有好几笔,比如一个 skill 一笔。大需求由 subagent-implement 的主会话按提交点提交,中间的提交不保证能构建。
   - **执行顺序(写进 index)**:分几步,每步哪些任务;同一步里能同时跑的要标出来。能同时跑的条件:改的文件不重叠,依赖的契约已在 index 定死;拿不准就分成两步。
   - 不重新打开 spec 已锁定的契约;不把简单需求拆碎。
   - **执行方式**:小需求一个会话跑 `/implementation`;大需求(预估变更文件 ≥10,且跨 ≥3 个相互独立的模块;拿不准按小需求)用 `/subagent-implement` 在一个会话里跑完,index 末尾给一句启动语,格式写 C-5 的启动语原文。
5. 「## 消费模型与防漂移」:
   - 第一段「**plan 的读者是执行会话**(可能是第三方模型):看不到你的上下文」改成「**plan 的读者是子 agent**(可能是第三方模型):每个只读 index 和自己的任务文件,看不到你的上下文」,这一段其余文字不动。
   - 「自包含 + 引用不指涉」整条换成:「**共享的只写在 index**:跨任务共享的契约(签名、接口形态、命名)只写在 index,带编号(C-1、C-2……);任务文件按编号引用,写「按 C-1」,不抄原文。任务文件加上 index,就是执行者需要的全部;「见 T-3 的定义」这种指向别的任务文件的写法不行。」
   - 「契约两端同文」整条换成:「**契约两端同文**:T-5 消费 T-2 产出时,两边都引用 index 里同一个编号的契约,不各写一份。」
   - 「双向追溯」「自由必须枚举」两条不动。
6. 「## 适用规范」表最后一行第一列「提交(有「独立提交」任务时)」改成「提交」。
7. 「## index.md 必备内容」:
   - 第一段整段换成:「**设计预览**(开头,见上节) · 来源 spec 摘要 · 目标与范围 · 明确不包含 · 任务清单(任务和文件一一对应,每个任务标对应 spec 条款和涉及范围;主会话靠涉及范围核对子 agent 的回报) · 执行顺序(分几步,标出能同时跑的) · 必须严格执行的契约(带编号) · 实现手段决策(自主项:选项、推荐、理由;回跳项:业务拍板结论) · 适用规范(文件与章节标题) · 提交规范(从 `git-standards.md` 结晶的提交消息格式和提交前检查点) · 统一验证(全部任务做完后跑的命令和要看的结果) · 允许局部适配的范围 · Plan 冲突上报规则 · 关键风险与防跑偏约束 · 待确认项 · 启动语(大需求一句 `/subagent-implement`)。」
   - 头部范例后面那句里的「各分文件写同样两行」改成「各任务文件写同样两行」。
8. 「## 子计划文件(按需,不建空文件)」整节换成「## 任务文件」:
   - 第一句:「一个任务一个文件:`plan/<文件前缀>-<两位序号>-<任务名>.md`,序号和任务编号一致,T-1 对应 01。」
   - 保留原来的表:表头「文件 | 适用 | 写什么」改成「任务类型 | 适用 | 写什么」;三行的第一列 `-01-schema.md`、`-02-backend.md`、`-03-frontend.md` 分别改成「数据库」「后端」「前端」,第二、三列不动;最后加一行「| 配置、文档 | 配置项、说明文档、模板 | 改哪些文件、改成什么;文档类写清要和哪些事实保持一致 |」。
9. 「## 任务写法」:
   - 代码块整块换成:

     ```markdown
     ### T-<编号>: <任务名称>

     - 目标: ...
     - 对应 spec 条款: ...(执行者据此读 spec 原文,不凭任务转述猜)
     - 强制引用: ...(开工前必读的 docs/guides 文件,按映射机械标注:数据库任务标 data-standards.md,接口任务标 interface-standards.md,动代码任务标 coding-standards.md,都不涉及写「无」)
     - 涉及范围: ...(改哪些文件;和同一步同时跑的任务不重叠)
     - 必须严格执行:
       - ...(用到共享契约时写「按 C-1」)
     - 允许局部适配:
       - ...
     - 具体要求:
       - ...
     - 完成条件:
       - ...
     - 提交点:
       1. <提交说明>:<这一笔包含的文件>
     - 风险/注意事项:
       - ...
     ```

   - 代码块后那句「编号可按文件域(`S-1`/`B-1`/`F-1`);跨文件依赖必须在 index 体现。」改成「任务编号 T-1、T-2 依次排,文件序号和编号一致;依赖写进 index 的执行顺序。」,同一段后半句「任务足够具体让 agent 能执行,但不替 agent 写代码。」不动。
10. 「## No Placeholders」第一句「"具体要求/完成条件/验证方式"必须写到 implementer 可直接执行。」改成「「具体要求」「完成条件」和 index 的「统一验证」必须写到执行者可直接执行。」
11. 「## 产物位置与命名」第一条里「(按需加 `-01-schema`、`-02-backend`、`-03-frontend`)」改成「,任务文件见「任务文件」」。
12. 「## 收尾」:
    - 在问句「**设计预览是否符合你的预期?确认后再开始实现。**」后面加:「问完加一句:」再接 C-4 的 write-plan 提醒原文。
    - 「确认后:小需求提示 `/implementation`;大需求列出 index 里每批的启动语,提示每批开一个新会话贴进去,全部完成后回 Claude 跑 `/code-review`。」改成「确认后:小需求提示 `/implementation`;大需求给出 index 末尾那一句 `/subagent-implement` 启动语,说明在本会话直接跑或新开会话跑都行。」

### 文件 7:改 write-plan/plan-document-reviewer-prompt.md

1. 「## 你的工作流」第 1 条「**Read plan 全文**(所有文件:index.md / 01-schema.md / 02-backend.md / 03-frontend.md / ...)」改成「**Read plan 全文**(index 和全部任务文件)」。
   另外,「### 1. 完整性」开头那句「逐任务扫描"具体要求" / "完成条件" / "验证方式",看有没有:」改成「逐任务扫描"具体要求"、"完成条件",以及 index 的"统一验证",看有没有:」。
2. 「### 3. 任务可执行性」的清单:「- **依赖**:列出前置任务」改成「- **执行顺序**:index 写了分几步、每步哪些任务」;「- **验证方式**:具体命令,不是"跑测试"」改成「- **统一验证**:index 给了具体命令和要看的结果,不是"跑测试"」。其余条目不动。
3. 「### 5. 执行契约清晰度」:
   - 「- 可并行任务是否真无冲突,且写明文件集合、公共契约、验证状态互不影响?」改成「- 同一步里标了能同时跑的任务,改的文件是否不重叠,依赖的契约是否已在 index 定死?」
   - 「- 大需求是否分批、每批有一句执行会话启动语,任务是否自包含(执行会话不读其他任务也能做)?」改成「- 是否一个任务一个文件;任务文件只靠 index 的编号契约衔接(写「按 C-1」,不抄原文,也不指向别的任务文件);超过 15 个文件的任务写明了拆不开的原因;index 有统一验证和一句 `/subagent-implement` 启动语?」
4. 最后一行「你在执行前审 plan 写得够不够具体;全部批次完成后,由 Claude 跑 `/code-review` 审整体实现。」改成「你在执行前审 plan 写得够不够具体;全部任务做完后,subagent-implement 跑统一验证,再由用户跑 `/code-review` 审整体实现。」

### 文件 8:改 deprecated-assets.json

- 删掉 `"skills/subagent-implement",` 这一行。
- 在 `paths` 数组末尾依次加四项:`"skills/subagent-implement/implementer-prompt.md"`、`"skills/subagent-implement/spec-reviewer-prompt.md"`、`"skills/subagent-implement/quality-reviewer-prompt.md"`、`"skills/clarify-requirements/references/澄清结果页.md"`;注意前一项补逗号,改完仍是合法 JSON。前三项是旧版 subagent-implement 随包部署过的提示词,新版只有 SKILL.md,不登记的话,已部署项目升级后会留着这三个没人引用的文件(spec §4.2)。
- `$comment` 和其余路径不动。

### 文件 9 到 13:补回 subagent-implement 的引用

前几批因为 subagent-implement 废弃,把这 5 处的「implementation 或 subagent-implement」改成了只写 implementation。逐行改回,并列用顿号或「和」,不用斜杠:

- 文件 9 `write-api/SKILL.md`:「feature 编码已完成(`/implementation` 跑完)」改成「feature 编码已完成(`/implementation` 或 `/subagent-implement` 跑完)」。
- 文件 10 `run-api-test/SKILL.md`:关系表里第一列是 `implementation`、关系是「下游」的那一行,第一列改成 `implementation`、`subagent-implement`(两个反引号各包一个名字,中间用顿号),其余两列不动。
- 文件 11 `iboc-check/SKILL.md`:「**implementation**:上游,代码开发完成后才轮到本 skill」改成「**implementation、subagent-implement**:上游,代码开发完成后才轮到本 skill」。
- 文件 12 `run-ui-test/SKILL.md`:和文件 10 一样,关系表里第一列是 `implementation`、关系是「下游」的那一行,第一列改成 `implementation`、`subagent-implement`。
- 文件 13 `knowledge-write/SKILL.md`:「沉淀时机」那条里的「implementation 收尾会提示识别实体」改成「implementation 和 subagent-implement 收尾会提示识别实体」。

其余引用(比如前几批删掉的触发说明和关系表里的其他行)不补回。

### 文件 14:改 implementation/SKILL.md

只改这两处,让 implementation 按新结构读 plan(spec §7.3「读 plan」);其余不动,也不加子 agent 模式的说明(spec §7.6):

1. 「## 流程」第 3 步里「读 `index.md` → 按需 `01-schema` / `02-backend` / `03-frontend`;」改成「读 `index.md`,再读要做的任务文件;」。这一步后面的文字不动。
2. 「> **独立提交**:」开头的那一整段引用,换成:「> **提交点**:plan 的任务文件写了「提交点」时,每完成一个任务并通过验证后,按提交点和 index「提交规范」节(从 `git-standards.md` 结晶)逐笔提交;precommit 门禁自查按 plan 检查点过后用 `CGRAPHX_PRECOMMIT_REVIEWED=1` 重试即可。plan 没写提交点的不擅自提交,交用户决定;push 永远归用户。」
