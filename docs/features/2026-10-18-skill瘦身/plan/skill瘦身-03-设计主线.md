# 实现计划: skill瘦身 · 批次 3 设计主线

> 产物: plan
> 依据: spec@cf4712c

## 共用约定

本文件的任务都改 skill 模板,执行前先读完本节。

1. 分支:在 `feat/skill瘦身` 上做(没有就从 `main` 建);开工前 `git status` 确认暂存区是空的。
2. 改动入口:只改 `assets/claude-template/` 下的文件;本仓库根目录的 `.claude/` 不动。不改 `docs/features/` 下任何已有文件。
3. 删减规则(spec §4.1):本文件的 clarify-requirements、write-spec、write-plan、handoff-session、write-wireframe 都是设计侧:删跨 skill 重复的规则、程序会检查的规则、通用方法论、长篇 ❌ 清单、逐条自检、为防较弱模型跑偏写的解释;HARD-GATE、红线、范例保留。只删任务点名的内容,没点名的段落不动。
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

6. 文件前缀:`docs/features/<feature-id>/` 里的文件前缀 = feature-id 去掉开头的日期 `YYYY-MM-DD-`。建新需求目录的命名规则只写在 write-spec「产物位置与命名」和第 0 步(T-7 负责),别的 skill 只引用。
7. 头部(只在范例里体现):md 写在一级标题下第一组引用行;HTML 写在前 30 行内的一个注释里,每行一个 `> 字段: 值`。`依据` = `spec@` 加主 spec 指纹前 7 位(`cgraphx features show <feature-id>` 显示的「spec 指纹」),需求目录没有主 spec 时不写。
8. 每个任务做完:
   - `grep -n -e subagent-implement -e knowledge-api -e code-map -e write-prd -e write-design-doc -e write-api-doc -e knowledge-migrate -e write-delivery-guide -e 一图看懂 <本任务改过的文件>` 无结果(任务另有说明的除外);
   - SKILL.md 开头的 frontmatter(`name`、`description`)完整;
   - `npm run build` 通过。
9. 提交:标题格式 `type(scope): 中文描述`,补充说明用「——」,并列用「+」;每个 skill 一笔。本仓库的提交门禁会先拦一次,自查后用 `CGRAPHX_PRECOMMIT_REVIEWED=1 git commit ...` 重试。
10. 遇到任务要求和 spec 冲突、要改范围外的文件、点名要删的段落找不到,停下写 `PLAN_CONFLICT: <原因>`。

## T-6: clarify-requirements 给出澄清结果

- 目标:clarify 结束时自动给出澄清结果:小需求在对话里给流程图和决策表;改动牵涉多个模块或多条流程时,在需求目录里出澄清结果页,讲法写在新的附属文件里;推荐下一步不再出现 subagent-implement;删掉通用方法论。
- 对应 spec 条款:§3.3、§6(全部)、§7.1、§4.1、§4.3、§12 第 1、2 行、§13 第 3 条、§14 第 2 条。
- 强制引用:无。
- 依赖:无。
- 涉及范围:
  - `assets/claude-template/skills/clarify-requirements/SKILL.md`
  - 新建 `assets/claude-template/skills/clarify-requirements/references/澄清结果页.md`
- 必须严格执行:
  - 澄清结果页的位置、命名和性质:`docs/features/<feature-id>/<前缀>-澄清结果-v<N>.html`,N 从 1 递增,改一次出一版,旧版保留;讨论稿,不是契约,不写 `> 产物:` 头部,不登记,不上报;用户确认后才写 spec,确认后不再维护。
  - 讲法(全局加局部)只写在 `references/澄清结果页.md`,SKILL.md 里只写一行指向它。
  - 推荐下一步只剩:小需求 `/implementation`;大需求先 `/write-plan` 分批;拿不准先 `/write-plan`。
- 允许局部适配:节标题措辞;删除段落后的一两句过渡语。
- 具体要求(SKILL.md):
  1. frontmatter `description`:在现有内容后补一句「结束时给出可视化的澄清结果:小需求在对话里给流程图和决策表,改动大时在需求目录出澄清结果页」;其余不改。
  2. 「流程」第 3 步「分类任务」整条改为:「**涉及页面、表单、展示或交互变化时**,提示一句「要不要先用 `/write-wireframe` 画个线框,看着界面再定?」;用户不需要就继续。」
  3. 「流程」第 7 步整条改为:「**给出澄清结果并停止** —— 按「澄清结果」一节输出,用户说「对了」才算结束;推荐下一步见「推荐下一步」;不自动继续。」
  4. 删掉「任务类型路由」「各类型关注点」「问题池」三节。
  5. 「澄清策略(按需)」整节换成一段:「**一次只问一个决策,每问先给推荐答案**,用户确认或纠正后再问下一个;事实自己查,只问决策;琐碎确认可以合在一起问。」(删掉确认式、头脑风暴两条。)
  6. 「决策分层(即总结结构)」改名为「澄清结果」,改成下面几部分:
     - 开头一句保留原意:澄清结果是 spec 的输入,不是契约,决策只有写进 spec 才成为义务;输出后停止,不自动调任何下游。
     - 「输出什么」一张表:

       | 情况 | 输出 |
       |---|---|
       | 小需求 | 在对话里给流程图和决策表(下面的对话版),不写文件 |
       | 改动牵涉多个模块或多条流程(你来判断) | 在需求目录里出澄清结果页:读 [references/澄清结果页.md](references/澄清结果页.md) 照做 |
       | 小需求,但用户想看页面 | 同样出澄清结果页 |

       表下加一句:出页面时,供 spec 使用的下半部分仍写在对话里;澄清结果页是讨论稿,不算 spec,HARD-GATE 不拦它。
     - 「对话版(按此示例写)」:保留原「上半部分」的整个示例和示例后面的四条要求,只把示例第一行改成:
       `**一句话**:原来侧栏的「数据库」入口是灰的,点不了;这次把它做成能点的页面,团队在浏览器里看本地导出的表结构和探索经验,只读本地文件,不连库。`
     - 「结束条件」:「用户看完说「对了」,澄清才算结束;发现不对就改,页面出下一版,旧版保留。结束前要满足:意图、业务边界(含口径和容忍度)、技术约束、主要非目标都已明确,剩下的问题不挡 spec。」(原「终止条件」一节删掉,内容并到这里。)
     - 「下半部分:供 spec 使用」:保留原清单,只把最后一条「用户控制的下一步」改为:`**用户控制的下一步**:`/write-spec` · `/write-wireframe`(涉及 UI 且还没线框,或决策改变了界面) · `/write-plan`(大需求分批) · `/implementation`(小需求) · `/write-docs`(发布后按需)`
  7. 「下游实现 skill 选择」整节换成「推荐下一步」:

     ```markdown
     ## 推荐下一步

     | 规模 | 条件 | 推荐 |
     |---|---|---|
     | 小需求 | 单点变更、1 到 3 个文件、单个模块 | `/implementation` |
     | 大需求 | 预估变更文件 ≥10,且跨 ≥3 个相互独立的模块 | 先 `/write-plan`,由它分批,每批一个会话跑 `/implementation` |
     | 拿不准 | 其余情形 | 先 `/write-plan` |

     - 判断看需求规模,不看任务量;小全栈需求(加 1 个字段、改 1 个接口、加 1 处页面展示,跨 3 层)仍算小需求。
     - 事后文档发布后按需走 `/write-docs`。
     ```

  8. 「红线」第 5 条「输出总结即停」改为「输出澄清结果即停」;其余红线不动。
- 具体要求(新建 `references/澄清结果页.md`,按下面几节写,控制在 70 行以内):
  1. 一句开头:改动牵涉多个模块或多条流程,或用户想看页面时读本文件。
  2. 「文件」:
     - 位置 `docs/features/<feature-id>/<前缀>-澄清结果-v<N>.html`,N 从 1 起,改一次出一版,旧版保留;前缀 = feature-id 去掉开头的日期。
     - 还没有需求目录:按 write-spec 第 0 步和「产物位置与命名」定 feature-id(业务 ID、标题语言要用户确认),建目录;已有就复用。
     - 讨论稿,不是契约:不写 `> 产物:` 头部,不登记,不上报;用户确认后才写 spec,页面不再维护。
     - 事后要看:照已有 spec 重新生成一份,用同一套讲法,同样是讨论稿。
  3. 「两部分」:
     - **要做的事情**:定下的每条决策一行,三列「决策、结论、举个例子」;例子写具体的数据或场景,让人看出这条决策会带来什么。
     - **会得到的结果**:改完以后的样子,按下一节「全局加局部」讲。
  4. 「讲法:全局加局部」(照 spec §6.2 写):
     - 全局:一张图看清整体走向,标出这次新增、改动、去掉的地方。主线沿读者熟悉的那条线排:业务需求沿业务流程,流程或工具调整沿使用顺序。拿不准沿哪条线讲,先问用户。
     - 局部:关键节点展开写细节。业务需求写口径和逻辑,即判断条件、计算规则、取数范围;流程或工具调整写头部、拦截、强制规范和产出。
     - 一张例子表:

       | 例子 | 全局 | 局部 |
       |---|---|---|
       | 一个功能的流程 | 流程图画业务走向,标出新增和改动的步骤 | 「计算优惠」节点写清取数范围和计算规则 |
       | skill 调整 | 按做需求的顺序串起所有 skill,标出废弃、合并、改动 | 每个 skill 写功能、卡点、产出、头部、开头结论 |

  5. 「页面」:
     - 开头一段先讲原来的情况,再说这次要做什么、做完是什么样。
     - 单文件 HTML,样式内联,断网能打开;浅色、深色下都看得清;手机宽度下不横向滚动。
     - 图例写清每种颜色、标记的意思(新增、改动、去掉、需要你确认)。
  6. 「最佳案例」一段,描述 skill瘦身 的澄清结果页怎么组织(不贴代码):开头一句讲这是 skill瘦身 的澄清结果,下面四个数字(skill 从 33 个减到 25 个、废弃 9 个、合并 2 处、新增 1 道门禁);「要做的事情」是一张 16 行的决策表;「会得到的结果」用一条竖线串起 8 站(接入项目、理解需求、写契约、规划、实现、测试、收尾、发布后),每站挂 skill 卡片,卡片写做什么、卡点(程序拦、硬规则、等你确认、缺规范、提示)、产出、头部、开头先给什么,有改动的卡片用一行色块写改了什么;站与站之间标出需要人确认的关口;页尾附产物与头部总表、卡点总表、废弃清单。
  7. 不提 write-delivery-guide,不引用它的任何模板。
- 完成条件:
  - SKILL.md 不含 `subagent-implement`、`write-prd`、`write-api-doc`、`write-design-doc`;含「澄清结果」「推荐下一步」两节和指向 `references/澄清结果页.md` 的链接;比原来至少短 30 行(原 171 行)。
  - `references/澄清结果页.md` 存在,含「全局加局部」和两行例子表。
  - 共用约定第 8 条检查通过。
- 验证方式:`wc -l`、`grep -n "references/澄清结果页.md" assets/claude-template/skills/clarify-requirements/SKILL.md`、共用约定第 8 条的 grep、`npm run build`。
- 独立提交:是。建议标题:`refactor(skills): clarify-requirements 结束时给出澄清结果——小需求对话里出图表 + 改动大出页面 + 删通用方法论`
- 风险/注意事项:「定位」「HARD-GATE」两节和原上半部分的示例是这个 skill 的核心,除任务点名的那一行外不改。

## T-7: write-spec 去掉一图看懂并写头部

- 目标:spec 只写契约:去掉「一图看懂」整节;头部按范例写 `> 产物: spec`;命名规则在这里留唯一一份;删掉自检和通用说明。
- 对应 spec 条款:§3.3、§7.1、§8.1、§8.2(spec 不要求开头结论)、§4.1、§13 第 4 条。
- 强制引用:无。
- 依赖:无。
- 涉及范围:`assets/claude-template/skills/write-spec/SKILL.md`
- 必须严格执行:
  - 头部范例(原样写进「结构」一节):

    ```markdown
    # 规格说明: 积分发放规则

    > 产物: spec
    > feature-id: 2026-10-18-REQ-1024-积分发放
    > 负责人: zhangsan
    > 日期: 2026-10-18
    ```

    范例下加一句:关联平台上已有任务时,加一行 `> 任务: T-<n>`。
  - 「工作流程」第 0 步和「产物位置与命名」是全模板唯一的命名规则,其他 skill 引用这里;内容保留,并补一句:「其他 skill 在已有需求目录里取前缀时,写成「文件前缀 = feature-id 去掉开头的日期」,两种说法等价。」
  - 负责人规则写全:默认 `git config user.name`,向用户展示确认;必须和负责人本人的 `git config user.name` 一字不差,写成显示名平台就建不出任务。
- 允许局部适配:节标题措辞;删除段落后的过渡语。
- 具体要求:
  1. 删掉「一图看懂(spec 开头,写给人)」整节(从该标题到「内容模块池」之前)。其中两条规则挪走保留:
     - 「涉及 UI」那一条挪到「内容模块池」表格「接口、页面与系统边界」一行的「写什么」里,写成:「涉及 UI 且已有人确认的线框时,写一行「页面布局与交互以 `<前缀>-线框-v<N>.html` 为准」,版本号写死,出新版要修订这一行;还没有线框,提示一句要不要先 `/write-wireframe`。」
     - 「正文写法同理:场景 × 行为、规则 × 条件、改前 × 改后,一律用表格,不写成长段落;状态多的用 `stateDiagram-v2`。」挪到「结构」一节,作为最后一条,原文不改。
  2. 「结构」一节:删掉「一图看懂(紧跟头部,必有)」这一条;「头部」这一条换成上面的头部范例;删掉「需求阶段由 `cgraphx features` 从产物自动派生…不手填状态」这句。
  3. 删掉「输入理解」整节(红线第 5 条已经管住「只有一句模糊想法」的情况)。
  4. 「工作流程」:第 0 步按「必须严格执行」补全负责人规则;删掉第 5 步「自检」。
  5. 删掉「质量检查(输出前)」整节。
  6. 「定位」「HARD-GATE」「边界」「内容模块池」「收尾」「红线」除上面点名的改动外不动。
- 完成条件:
  - `grep -n 一图看懂 assets/claude-template/skills/write-spec/SKILL.md` 无结果;`grep -n "> 产物: spec" assets/claude-template/skills/write-spec/SKILL.md` 命中。
  - 线框引用规则仍在(`grep -n 线框-v assets/claude-template/skills/write-spec/SKILL.md` 命中)。
  - 共用约定第 8 条检查通过;比原来至少短 30 行(原 134 行)。
- 验证方式:上面三条 grep、`wc -l`、`npm run build`。
- 独立提交:是。建议标题:`refactor(skills): write-spec 去掉一图看懂 + 头部写产物类型——spec 只写契约`
- 风险/注意事项:T-1 已撤掉注册表对 spec「一图看懂」的检查;两边要一起上线,不要只改一边。

## T-8: write-plan 分批出启动语,设计预览只留重点决策表

- 目标:大需求由 write-plan 拆批并给每批的执行会话启动语;设计预览只放一段话加重点决策表,不画图;不再召回代码地图;头部按范例写;删掉自检清单和重复的命名规则。
- 对应 spec 条款:§3.3、§7.2、§8.1、§9(不再召回代码地图)、§4.1、§13 第 5 条。
- 强制引用:无。
- 依赖:无。
- 涉及范围:
  - `assets/claude-template/skills/write-plan/SKILL.md`
  - `assets/claude-template/skills/write-plan/plan-document-reviewer-prompt.md`
- 必须严格执行:
  - 执行方式:小需求一个会话跑 `/implementation`;大需求(预估变更文件 ≥10,且跨 ≥3 个相互独立的模块;拿不准按小需求)拆成几批,每批开一个会话跑 `/implementation`,全部完成后回 Claude 跑 `/code-review`;index 给出每批的启动语,一批一句,形如 `/implementation 执行 docs/features/<feature-id>/plan/<前缀>-02-backend.md 的 T-1,只做 T-1。`;每个任务自包含,执行会话不读其他任务也能做。
  - 设计预览只留重点决策表:改错了代价最大的几条决策,以及每条为什么难回头;不画架构图、时序图、类图。
  - plan 头部只写 `> 产物: plan` 和 `> 依据: spec@<前 7 位>`;index 和各分文件都写。
- 允许局部适配:节标题措辞;删除段落后的过渡语;工作流程步骤的编号。
- 具体要求(SKILL.md):
  1. `description`:在现有内容里补一句「大需求拆成几批,每批给一句执行会话启动语」;其余不改。
  2. 「定位」第三条「两种读者两种写法」改为:「**两种读者两种写法**:index 开头的「设计预览」写给**人**——一段话说清改动落在哪,加一张重点决策表,人看完决定放不放行;其余部分写给执行会话(见「消费模型与防漂移」)。」
  3. 「输入与上下文」的「工具」一条改为:「**工具**:`knowledge-recall`(知识库:历史决策、业务概念)、`db-query`(查库、查 DDL)、grep 和 Read(调用关系、符号定位);涉及的已有代码直接读代码确认。」
  4. 「工作流程」:
     - 第 0 步改为:「**命名沿用 spec**:feature-id、文件前缀沿用 spec 所在的需求目录;没有 spec 时按 write-spec 第 0 步和「产物位置与命名」定。」
     - 第 3 步「召回代码地图」改为:「**读已有代码**:涉及的已有模块、调用方直接读代码确认,不凭印象写。」
     - 删掉第 6 步「Self-Review」整条(连同其下所有子项)。
     - 第 7 步「Plan Review」保留,把「跳过条件:… (在 Self-Review 里写跳过理由)」改为「跳过条件:用户明确说不用、plan 极小、时间紧;跳过时在 index 里写一句理由」。
  5. 「拆分规则」:最后一条「执行方式建议(终判,写进 index)…」整条换成「必须严格执行」里的执行方式原文(以「**执行方式(写进 index)**:」开头)。其余条目不动。
  6. 「消费模型与防漂移」第一段改为:「**plan 的读者是执行会话**(可能是第三方模型):看不到你的上下文、不知道你脑中的默认,遇到模糊处会默默自行补全。写法纪律由此反推。」第一条「自包含 + 引用不指涉」末尾补一句「每个任务自包含:执行会话不读其他任务也能做」。
  7. 「适用规范」:把文中「implementation/subagent-implement」「implementation / subagent-implement」都改为「implementation」。
  8. 「设计预览(index 开头,写给人)」整节换成下面这段(原文照抄):

     `````markdown
     ## 设计预览(index 开头,写给人)

     人读完这一节就能决定放不放行:一段话说清改动落在哪,再加一张重点决策表,写改错了代价最大的几条决策,以及每条为什么难回头。不画架构图、时序图、类图。按此示例写:

     ````markdown
     ## 设计预览

     原来侧栏的「数据库」入口是灰的,点不了。这次新增 schema 模块:三个新文件分别负责读文件、拼 HTML、出页面,server 加一组 `/schema` 路由;全程只读本地文件,不碰 SQLite。

     **需要你重点看的**(改错了代价最大,其余可略读)

     | # | 决策 | 为什么难回头 |
     |---|---|---|
     | 1 | schema 页面函数签名**不带 db 参数**,模块永不读 `cgraphx.db` | 一旦有页面依赖 db,纯文件派生的边界就破了,后续都会往里加 |
     | 2 | 工程名或表名含 `..`、`/`、`\` 时**在路由层直接 404**,不进页面层 | 路径安全边界;放到下层校验,任何新页面都可能漏 |
     | 3 | URL 形态 `/schema/<工程>/<表>`,`insights` 为保留词 | 用户会收藏链接,改形态即失效 |
     ````

     - 第一句先讲原来的情况,再说这次改了什么。
     - 只放难回头的决策,不超过 3 条:持久化的数据结构和表、对外接口与 URL、模块边界与依赖方向、安全边界。内部拆分、命名、可逆的手段不进此表,放「实现手段决策」。
     - 表里的文件名、函数名和下面任务原文一致;plan 改了,这张表一起改。
     `````

  9. 「index.md 必备内容」整节换成:
     - 一行清单:「**设计预览**(开头,见上节) · 来源 spec 摘要 · 目标与范围 · 明确不包含 · 计划文件清单 · 总任务清单(每个任务标对应 spec 条款和是否「独立提交」) · 依赖与顺序(没有依赖就直说) · 执行方式(小需求一个会话;大需求分批,附每批启动语) · 必须严格执行的契约 · 实现手段决策(自主项:选项、推荐、理由;回跳项:业务拍板结论) · 适用规范(文件与章节标题) · 提交规范(有「独立提交」任务时必备:从 `git-standards.md` 结晶的提交消息格式和提交前检查点) · 允许局部适配的范围 · Plan 冲突上报规则 · 关键风险与防跑偏约束 · 待确认项。」
     - 头部范例,范例下加一句「依据取 `cgraphx features show <feature-id>` 显示的 spec 指纹前 7 位;各分文件写同样两行」:

       ```markdown
       # 实现计划: <需求名称>

       > 产物: plan
       > 依据: spec@3f9a1c2

       ## 设计预览
       ```

  10. 「产物位置与命名」整节换成两条:
      - 「路径:`docs/features/<feature-id>/plan/<文件前缀>-index.md`(按需加 `-01-schema`、`-02-backend`、`-03-frontend`);文件前缀 = feature-id 去掉开头的日期。需求目录不存在时按 write-spec「产物位置与命名」建。」
      - 「无可写项目上下文时,在回复里直接输出同等结构的正文。」
  11. 「收尾」整段换成:「产物落盘后跑 `cgraphx features sync`。然后请人确认设计:回复里给出设计预览的那段话和重点决策表,问「**设计预览是否符合你的预期?确认后再开始实现。**」——人不确认不进实现;人提出修改就改 plan(预览一起改)后再问。确认后:小需求提示 `/implementation`;大需求列出 index 里每批的启动语,提示每批开一个新会话贴进去,全部完成后回 Claude 跑 `/code-review`。不自动开始实现。找需求目录:`cgraphx features list --mine`。」
  12. 「红线」:删掉第 7 条(不擅自中文转英文 slug,命名规则已归 write-spec),其余条目重新编号,内容不改。
- 具体要求(`plan-document-reviewer-prompt.md`):
  1. 「5. 执行契约清晰度」末尾加一条:「- 大需求是否分批、每批有一句执行会话启动语,任务是否自包含(执行会话不读其他任务也能做)?」
  2. 「跟其他 reviewer 的边界」整节(表格和「核心区别」一段)换成一句:「你在执行前审 plan 写得够不够具体;全部批次完成后,由 Claude 跑 `/code-review` 审整体实现。」
  3. 其余内容不动。
- 完成条件:
  - `grep -n -e subagent -e code-map -e 架构图 -e 类图 assets/claude-template/skills/write-plan/SKILL.md`:只允许命中「不画架构图、时序图、类图」这一句。
  - `grep -n "> 产物: plan" assets/claude-template/skills/write-plan/SKILL.md` 命中;`grep -n "只做 T-1" assets/claude-template/skills/write-plan/SKILL.md` 命中。
  - `grep -n -e spec-reviewer -e quality-reviewer assets/claude-template/skills/write-plan/plan-document-reviewer-prompt.md` 无结果。
  - 共用约定第 8 条检查通过;SKILL.md 比原来至少短 50 行(原 271 行)。
- 验证方式:上面的 grep、`wc -l`、`npm run build`。
- 独立提交:是。建议标题:`refactor(skills): write-plan 大需求分批出启动语 + 设计预览只留重点决策表——不再召回代码地图`
- 风险/注意事项:「拆分规则」「消费模型与防漂移」「适用规范」「任务写法」「No Placeholders」「红线」是执行质量的保障,除点名处外不动。

## T-9: handoff-session 与 write-wireframe 写头部

- 目标:交接文件和线框的新产物带头部;两个 skill 里的命名规则改成引用 write-spec;交接样例的开头结论第一句先讲原来的情况。
- 对应 spec 条款:§8.1、§8.2(交接文件「本任务范围」)、§4.1、§4.3。
- 强制引用:无。
- 依赖:无。
- 涉及范围:
  - `assets/claude-template/skills/handoff-session/SKILL.md`
  - `assets/claude-template/skills/write-wireframe/SKILL.md`
  - `assets/claude-template/skills/write-wireframe/references/wireframe-template.html`
- 必须严格执行:
  - 交接文件头部第一行是 `> 产物: handoff`,并保留 `> 负责人:`;第一个二级标题仍是 `## 本任务范围`。
  - 线框头部写在 `<!doctype html>` 之后的那个注释里,第一行是 `> 产物: wireframe`,整个注释在文件前 30 行内。
- 允许局部适配:措辞。
- 具体要求(handoff-session):
  1. 两个交接文件样例的头部,在 `> feature-id:` 之前各加一行 `> 产物: handoff`。
  2. 「积分发放规则」样例「本任务范围」的第一条改为:`- 原来下单统一返 1% 积分;改为按会员等级发放:普通会员 1 元 = 1 分,黄金会员 1 元 = 2 分`(其余条目不动)。
  3. 「流程」第 1 步第二条改为:「没有 → 按 write-spec 第 0 步和「产物位置与命名」新建(业务 ID、标题语言由用户确认,不把中文转成英文 slug)。」
  4. 「流程」第 2 步关于负责人的长句改为:「负责人按 write-spec 第 0 步确认:取 `git config user.name`,必须和负责人本人的一字不差。」(删掉解释平台怎么建任务的后半句。)
  5. 「流程」第 3 步里「文件前缀 = 有业务ID `<业务ID>-<标题>`,无则 `<标题>`」改为「文件前缀 = feature-id 去掉开头的日期」。
- 具体要求(write-wireframe):
  1. 「流程」第 1 步改为:「**命名先行**:feature-id 已存在(已有 spec 或线框)就复用;不存在时按 write-spec 第 0 步和「产物位置与命名」落定,建 `docs/features/<feature-id>/`。」
  2. 「样张要点」表「头部注释」一行的「写法」改为:「第一行写 `> 产物: wireframe`;接着写版本、feature-id、相比上一版的变化及触发它的决策、示例数据来源;整个注释放在文件前 30 行内」。
  3. 「产物位置与命名」第二条改为:「文件前缀 = feature-id 去掉开头的日期。」
  4. `references/wireframe-template.html` 顶部注释里,在「线框 v2 · …」这一行之前加一行 `  > 产物: wireframe`(缩进与注释内其他行一致)。
- 完成条件:
  - `grep -c "> 产物: handoff" assets/claude-template/skills/handoff-session/SKILL.md` 为 2。
  - `head -12 assets/claude-template/skills/write-wireframe/references/wireframe-template.html` 能看到 `> 产物: wireframe`。
  - 共用约定第 8 条检查通过。
- 验证方式:上面两条命令;`npm run build`。
- 独立提交:是,两笔。建议标题:`refactor(skills): handoff-session 头部写产物类型 + 命名规则改引用 write-spec`;`refactor(skills): write-wireframe 线框头部注释写产物类型`
- 风险/注意事项:handoff-session 的「不做什么」和启动语规则不动。
