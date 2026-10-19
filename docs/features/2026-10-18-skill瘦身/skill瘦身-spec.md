# 规格说明: skill瘦身

> 产物: spec
> feature-id: 2026-10-18-skill瘦身
> 负责人: liulongfei
> 日期: 2026-10-19

## 1. 目标与范围

### 1.1 目标

现在 `assets/claude-template/` 下有 33 个 skill,SKILL.md 加 agents、commands 约 6200 行,算上各 skill 自带的模板和参考文件约 1.1 万行。其中不少是写给较弱模型的步骤解释、跨 skill 重复的规则,或者已经交给程序检查的规则。plan 里同一份契约在多个任务里各抄一遍,任务也常按提交切得很细。同时,AI 写给人看的产出不好读;改动大的需求,写 spec 之前看不到改完以后的全貌。

本需求做五件事:

1. 删减:skill 从 33 个减到 27 个(废弃 8 个,合并出 2 个,新增 1 个),留下的删短。
2. 落地产物规范:做完主任务「产物注册表与头部规范」交给本任务的模板改动,并把 `features check` 接进提交门禁。
3. 图解:新增 visual-explain,把对话里说过的内容画成一页图解,降低人看懂 AI 输出的成本;clarify 结尾提醒可以图解。
4. 可读性:写给人看的地方改用大白话。
5. 大需求实现:subagent-implement 保留并改写,在一个会话里按任务派子 agent 跑完全部任务;plan 改成 index 加一个任务一个文件。

### 1.2 包含范围

| 部分 | 内容 | 详见 |
|---|---|---|
| 删减 | 废弃 8 个 skill,合并出 2 个,其余删短 | §3、§4 |
| 产物规范落地 | 各 skill 写统一头部;登记开头结论;`/end` 生成发布记录;实现收尾提醒平台环节缺口;`features check` 接进提交门禁 | §8 |
| 图解 | 新增 visual-explain;clarify 结尾和 write-plan 请人确认设计预览时各提醒一句 | §6 |
| 可读性 | 写法约束、大白话范例 | §4.3 |
| 流程调整 | 大需求用 subagent-implement 在一个会话里跑完;plan 改成 index 加一个任务一个文件;spec 去掉一图看懂;设计预览只留重点决策表 | §7 |
| 代码地图停止维护 | 废弃两个 code-map skill,web 提示改文案 | §9 |
| 同步更新 | FLOW-MAP、CLAUDE.md 模板、cgraphx-guide、本仓库 README 和 CLAUDE.md、知识库条目、CHANGELOG | §10 |

### 1.3 非目标

- 业务地图(每个业务一张地图):另开需求。web「系统地图」页的去留也在那个需求里定。
- 删除 web「系统地图」页或 `docs/code-map/` 下的文件。
- 新旧 skill 对比测试和冷读测试:改完由负责人人工审查。
- 给旧产物补 `> 产物:` 头部。
- 新增产物类型:图解页,包括澄清结果的图解页,不登记。
- 改动 `cgraphx` 命令的参数和输出;§8.2、§8.4、§9 写明的改动除外。
- 自动跑 `/code-review`:subagent-implement 只提示。
- 用 git worktree 隔离同时跑的任务。
- 把已有的 plan 迁移成新结构。

## 2. 术语

| 术语 | 含义 |
|---|---|
| 执行侧 skill | 可以交给第三方模型执行的 5 个 skill:implementation、subagent-implement、write-unit-test-code、run-api-test、run-ui-test |
| 设计侧 skill | 执行侧以外的 skill,由 Claude 执行 |
| 澄清结果 | clarify 结束时在对话里给的流程图和决策表,用户据此拍板 |
| 图解页 | visual-explain 生成的单页 HTML,用来帮人看懂;澄清结果的图解页叫澄清结果页 |
| 重点决策表 | plan 设计预览里的表:改错了代价最大的几条决策,以及每条为什么难回头 |
| 任务文件 | plan 里一个任务一个文件;背景和共用部分写在 index |
| 执行顺序 | index 里写的派任顺序:分几步,每步哪些任务,哪些能同时跑 |
| 统一验证 | 全部任务做完后,由主会话跑一次的命令和要看的结果,写在 index |
| 提交点 | 任务文件里写的提交划分:每笔的提交说明和包含的文件 |
| 主会话 | 跑 subagent-implement 的会话;它派出去做单个任务的叫子 agent |
| 开头结论 | 产物文件的第一个二级标题及其内容;`features check` 按注册表登记的标题检查 |
| 依据 | 头部 `> 依据: spec@<指纹>`,定义见主任务 spec §6 |

## 3. skill 清单变化

改完共 27 个 skill。

### 3.1 废弃(8 个)

全部登记进 `deprecated-assets.json`(§4.2)。

| 废弃 | 以后怎么做 |
|---|---|
| knowledge-api | 并入 knowledge-recall(§5.1) |
| code-map-write、code-map-recall | 不再维护代码地图(§9) |
| write-prd、write-design-doc、write-api-doc | 合成 write-docs(§5.2) |
| knowledge-migrate | 不再提供 |
| write-delivery-guide | 不再事后写交付讲解;要看懂时用 visual-explain 出图解(§6);它的模板不沿用 |

### 3.2 合并

| skill | 来源 | 触发方式 |
|---|---|---|
| knowledge-recall | 吸收 knowledge-api | AI 自动触发,和现在一样 |
| write-docs | 合成 write-prd、write-design-doc、write-api-doc | 只能手动调用,和原来三个一样 |

### 3.3 有改动的 skill、命令和 hook

| 对象 | 改什么 | 详见 |
|---|---|---|
| clarify-requirements | 结尾在对话里给流程图和决策表,加一句图解提醒,不再自动出页面;推荐下一步:大需求先 `/write-plan`,再 `/subagent-implement` | §6.4、§7.1 |
| write-spec | 写统一头部;去掉一图看懂 | §7.1、§8 |
| write-plan | 一个任务一个文件,先按类型拆、做不完再按并行度拆;index 写执行顺序和统一验证,启动语只有一句;请人确认设计预览时提醒图解;设计预览只留重点决策表;不再召回代码地图 | §6.4、§7.2 |
| implementation | 收尾只剩沉淀知识、平台环节缺口两个提示;汇报给大白话范例;按新的 plan 结构读 plan、按提交点提交 | §7.3 |
| handoff-session、write-wireframe | 写统一头部 | §8.1 |
| write-api、write-unit-test-spec、write-ui-test | 测试规格写头部和开头结论 | §8 |
| write-unit-test-code、run-api-test | 测试报告写头部和开头结论 | §8 |
| run-ui-test | 只删重复规则 | §4.1 |
| iboc-check | 缺什么改看 `features show`;设计文档改由 write-docs 生成;补头部不加 `> 产物:` | §7.4 |
| knowledge-init | 子 agent 照 knowledge-write 的模板写条目;改成中文 | §7.5 |
| init-project-guides | 提交规范模板加大白话的 commit 标题范例 | §4.3 |
| cgraphx-guide | 流程说明随本需求更新 | §10 |
| 命令 `/end` | 增加发布记录;收口档案写头部和开头结论 | §8 |
| 命令 `/my-query` | knowledge-api 改为 knowledge-recall | §10 |
| hook precommit-check | 接入 `features check` | §8.4 |

其余 skill(db-query、developer-timeline、export-table-ddl、handdrawn-deck、handdrawn-sketch-engine、knowledge-write、write-workload)只按 §4 删短,做法和产出不变。

### 3.4 保留改写与新增

| skill | 变化 | 触发方式 | 详见 |
|---|---|---|---|
| subagent-implement | 不废弃,改写:在一个会话里按 plan 的任务派子 agent,主会话负责提交、统一验证和修复 | AI 按用户的话调用,也可以敲命令,和原来一样 | §7.6 |
| visual-explain | 新增:把对话里说过的内容画成一页图解 | 用户说没看懂、要图解时 AI 调用,也可以敲命令 | §6 |

## 4. 删减规则

### 4.1 删什么、留什么

| 内容 | 设计侧 | 执行侧 |
|---|---|---|
| 跨 skill 重复的规则,比如「feature-id 与文件前缀规则」在 6 个 skill 里各有一份 | 删,只留一处 | 删,只留一处 |
| 程序会检查的规则,比如头部和开头结论由 `features check` 检查 | 删,只在范例里体现 | 删,只在范例里体现 |
| 硬规则(HARD-GATE、红线)和范例 | 留 | 留 |
| 通用方法论、长篇 ❌ 清单、逐条自检、为防较弱模型跑偏而写的解释 | 删 | 留 |

- 「只留一处」:同一条规则在模板里只有一个权威位置,其他地方引用它或不再提;放在哪由 plan 定。
- 设计侧以 Claude 为基线(2026-10-17 定)。

### 4.2 废弃登记

- `deprecated-assets.json` 增加 8 个路径:`skills/knowledge-api`、`skills/code-map-write`、`skills/code-map-recall`、`skills/write-prd`、`skills/write-design-doc`、`skills/write-api-doc`、`skills/knowledge-migrate`、`skills/write-delivery-guide`。`skills/subagent-implement` 不登记,已经登记的撤掉。
- clarify 的附属文件挪进 visual-explain 以后,旧路径 `skills/clarify-requirements/references/澄清结果页.md` 也登记。
- 旧版 subagent-implement 随包部署过三个提示词文件:`skills/subagent-implement/implementer-prompt.md`、`skills/subagent-implement/spec-reviewer-prompt.md`、`skills/subagent-implement/quality-reviewer-prompt.md`。新版只有 SKILL.md,这三个路径也登记,升级时清掉。
- 升级时只清理 `.claude/` 下的这些路径;目标项目 `docs/` 下的文件一个不动。

### 4.3 写法约束

1. 瘦身靠删内容,不靠把句子写紧。新写或改写的句子不用箭头、斜杠并列、自造的缩写。留下的规则不为改写而重写,本来要改的句子顺手改成大白话。
2. 写给人看的地方,各放一段大白话范例,范例第一句先讲原来的情况:

| 位置 | 所在 skill |
|---|---|
| 澄清结果(对话里的流程图和决策表) | clarify-requirements |
| 图解页 | visual-explain |
| 设计预览的重点决策表 | write-plan |
| 实现汇报 | implementation |
| 全部任务做完后的汇报 | subagent-implement |
| 各类产物的开头结论(§8.2) | 写该产物的 skill |
| commit 标题 | init-project-guides 的提交规范模板 |

## 5. 合并后的 skill

### 5.1 knowledge-recall

| 项 | 规格 |
|---|---|
| 做法 | 先派 knowledge-recall 子 agent 在知识库里匹配概念,再用 `cgraphx docs show <path> --body` 读命中条目的正文 |
| 从 knowledge-api 并入 | 命令用法:查概念、按概念反查、关键词查、读正文、建索引,压成几行 |
| 删除 | knowledge-api 自己的子 agent 提示词和派遣规则;「文档规范要点」一节,归 knowledge-write |
| 同名 agent | 保留,仍是唯一的召回子 agent |

### 5.2 write-docs

| 项 | 规格 |
|---|---|
| 时机 | 发布后按需 |
| 交互 | 运行时先问要哪一种:需求文档、设计文档、接口文档,可以多选 |
| 产物 | 文件名和产物类型与原来一致:`<前缀>-需求文档.md`(prd)、`<前缀>-设计文档.md` 或 `.html`(design_doc)、`<前缀>-接口文档.html`(api_doc) |
| 结构 | 共用规则(时机、命名、头部、开头结论)只写一次;三种文档各一份参考文件,放各自的章节和模板;接口文档读代码提取接口的步骤写在它自己那份里 |

## 6. 图解(visual-explain)

### 6.1 做什么、什么时候用

| 项 | 规格 |
|---|---|
| 作用 | 把对话里说过的内容,或者用户指定的文件、话题,画成一页图解,降低人看懂 AI 输出的成本 |
| 适用内容 | 不限于澄清:澄清结果、plan、实现汇报、代码怎么走、几种方案的对比都能用 |
| 触发 | 用户说「没看懂」「画个图讲讲」「图解一下」时 AI 调用;也可以直接敲 `/visual-explain`。用户没要求时,AI 不主动出页面 |
| 侧别 | 设计侧:按 Claude 的水平写,只留讲法、范例和硬规则 |

### 6.2 讲法:全局加局部

- **全局**:一张图看清整体走向,标出新增、改动、去掉的地方和需要人确认的关口。主线沿读者熟悉的那条线排,见下表。
- **局部**:关键节点展开写细节。业务写口径和逻辑,即判断条件、计算规则、取数范围;流程或工具调整写头部、拦截、强制规范和产出;代码写输入、判断条件和输出。每个结论配一个例子。
- 拿不准沿哪条线讲时,先问用户。
- 讲法只写在 visual-explain 里:原来 clarify 附属文件里的讲法挪过来,扩成什么内容都能讲;不沿用 write-delivery-guide 的模板。

| 要讲的内容 | 主线沿着 | 全局 | 局部 |
|---|---|---|---|
| 一个功能的流程 | 业务流程 | 流程图画业务走向,标出新增和改动的步骤 | 「计算优惠」节点写清取数范围和计算规则 |
| 流程或工具调整 | 使用顺序 | 按做需求的顺序串起各步,标出新增、改动、去掉 | 每一步写做什么、在哪会被拦、产出什么 |
| 一段代码 | 调用顺序 | 调用链一张图,标出入口和数据最后落在哪 | 关键函数写输入、判断条件和输出 |
| 一份 plan | 执行顺序 | 任务和执行顺序一张图,标出能同时跑的 | 重点决策写清为什么难回头 |
| 几种方案对比 | 对比维度 | 一张表看清每个方案在各维度上的差别 | 推荐的方案写清理由和代价 |

### 6.3 图解页

| 项 | 规格 |
|---|---|
| 形式 | 一律出一页 HTML:单个文件,样式内联,断网能打开;浅色、深色下都看得清;手机宽度下不横向滚动;图例写清每种颜色和标记的意思 |
| 开头 | 一段话先给结论;讲改动时,第一句先讲原来的情况 |
| 澄清结果的图解 | 分「要做的事情」和「会得到的结果」两部分:前者是定下的每条决策,各配一个例子;后者是改完以后的样子 |
| 位置 | 和某个需求有关的,放进该需求目录:`docs/features/<feature-id>/<前缀>-<主题>-v<N>.html`,澄清结果的主题就叫「澄清结果」。和需求无关的,放 `.cgraphx/visual/<主题>-v<N>.html`,只存在本机,不进 git |
| 版本 | N 从 1 递增,改一次出一版,旧版保留 |
| 性质 | 讨论稿,不是契约:不写 `> 产物:` 头部,不登记产物类型,不上报平台,看完不再维护 |
| 做完 | 在浏览器里打开;打不开时给出文件路径 |
| 和 spec 的关系 | 图解不是契约,spec 不画可视化;需要时可以照已有 spec 重新生成一份图解 |

### 6.4 提醒

| 时机 | 提醒什么 |
|---|---|
| clarify 结尾 | 给出流程图和决策表以后,加一句:有没看懂的地方,可以说「画个图讲讲」,出一页图解 |
| write-plan 请人确认设计预览时 | 加一句:设计预览哪里没看懂,可以说「画个图讲讲」 |

- 只提醒,不自动出页面。

## 7. 流程和 skill 的行为变化

### 7.1 clarify 和 write-spec

| skill | 改前 | 改后 |
|---|---|---|
| clarify-requirements | 澄清总结只在对话里,上半部分给人确认;推荐下一步时在 implementation 和 subagent-implement 之间选 | 结尾在对话里给流程图和决策表,用户说「对了」才算结束;最后提醒一句可以图解(§6.4),不自动出页面。推荐下一步:小需求 `/implementation`;大需求先 `/write-plan`,再 `/subagent-implement`;拿不准先 `/write-plan` |
| write-spec | 头部写 feature-id、负责人、任务、日期;正文第一节必须是「一图看懂」 | 头部按 §8.1 写,含 `> 产物: spec`;去掉一图看懂整节和范例,spec 只写契约 |

### 7.2 write-plan

| 项 | 改后 |
|---|---|
| 执行方式 | 小需求:一个会话跑 `/implementation`。大需求:用 `/subagent-implement` 在一个会话里跑完全部任务(§7.6) |
| 大需求的判断 | 沿用现有判据:预估变更文件 ≥10,且跨 ≥3 个相互独立的模块;拿不准按小需求 |
| plan 文件 | index 放背景和共用部分,和现在一样;其余一个任务一个文件:`plan/<前缀>-<两位序号>-<任务名>.md`,序号和任务编号一致,T-1 对应 01;index 文件名不变 |
| 怎么拆 | 先按任务类型拆:数据库、后端、前端、配置、文档等。一个任务预估改动超过 15 个文件,算一个子 agent 做不完,再按并行度往下拆:拆成改的文件不重叠、只靠 index 契约衔接的几块,拆到每块不超过 15 个文件为止,不拆到底 |
| 契约 | 跨任务共享的契约只写在 index,带编号;任务文件按编号引用,不抄原文 |
| 执行顺序 | index 写分几步、每步哪些任务,标出同一步里能同时跑的。能同时跑的条件:改的文件不重叠,依赖的契约已在 index 定死 |
| 统一验证 | index 写全部任务做完后要跑的命令和要看的结果;任务文件不再写验证方式 |
| 任务文件 | 写目标、对应 spec 条款、强制引用的规范、涉及范围(改哪些文件)、必须严格执行、允许局部适配、具体要求、完成条件、提交点。依赖写进 index 的执行顺序 |
| 启动语 | index 只给一句 `/subagent-implement docs/features/<feature-id>/plan/<前缀>-index.md`;不再每批一句 |
| 设计预览 | 只留重点决策表:改错了代价最大的几条决策,以及每条为什么难回头;不画架构图、时序图、类图 |
| 请人确认 | 给出设计预览时加一句图解提醒(§6.4);确认后,小需求提示 `/implementation`,大需求提示 `/subagent-implement` |
| plan 审查 | 审查提示词按新结构审:任务文件不抄契约;同一步里同时跑的任务改的文件不重叠;执行顺序和依赖对得上;超过 15 个文件的任务写明了拆不开的原因 |
| 代码地图 | 不再召回;涉及的已有代码直接读代码确认 |

### 7.3 implementation(执行侧)

| 项 | 改后 |
|---|---|
| 收尾提示 | 只剩两个:要不要沉淀知识(knowledge-write);平台环节还缺什么(§8.5)。去掉代码地图、交付讲解两个提示 |
| 汇报 | 给一段大白话范例:先说原来怎样,再说现在怎样,然后列改了什么、验证了什么 |
| 读 plan | 按 §7.2 的新结构读:先读 index,再读要做的任务文件;plan 写了提交点时,按提交点提交 |
| 其他 | 按 §4.1 执行侧规则删:步骤说明、逐条自检保留 |

### 7.4 iboc-check

| 项 | 改后 |
|---|---|
| 核对缺什么 | 用 `cgraphx features show` 的结果,不再由 AI 逐个目录扫 |
| 补设计文档 | 改由 write-docs 生成 |
| 补头部 | 给旧 spec 只补负责人、feature-id、日期,不加 `> 产物:` |
| 其他 | 批量补齐、逐个需求派子 agent 补的做法不变 |

### 7.5 knowledge-init

- 子 agent 写条目时,照 knowledge-write 的实体、流程两种模板写,不再重写分类规则。
- 保留骨架:找入口、分批派子 agent 探索、合并跨模块的概念、中断后接着跑。
- 整个 skill 改成中文。

### 7.6 subagent-implement(执行侧)

| 项 | 规格 |
|---|---|
| 定位 | 大需求的执行方式:在一个会话里按 plan 的任务派子 agent,每个子 agent 是一份新的上下文;主会话只负责派任、提交、统一验证和修复 |
| 在哪跑 | 设计会话里直接跑,或者新开一个会话跑;启动语都是 index 里那一句 |
| 开跑前 | 当前在主分支(main 或 master)上时,先停下问用户要不要建分支 |
| 主会话读什么 | 只读 index:任务清单、执行顺序、提交规范、统一验证;不读任务文件正文,也不读代码 |
| 派任 | 按执行顺序一步一步派,同一步里标了能同时跑的一起派;用户可以指定从哪个任务开始,已经提交的任务不重跑 |
| 子 agent | 读 implementation、index 和自己的任务文件,其他任务文件不读、不改;只改文件,不构建、不测试、不提交,也不做沉淀提示和平台环节提醒。implementation 不加子 agent 模式的说明,以派任说明为准 |
| 回报 | 至少包含:结果(完成、冲突或卡住,后两种写明原因);按提交点分组的改动文件和提交说明;按 plan 执行的情况(PLAN_FOLLOWED、PLAN_ADAPTED、PLAN_CONFLICT);要人验证的;值得沉淀的 |
| 提交 | 主会话每收到一个完成的回报,就按提交点提交,不构建、不测试;每笔照常过提交门禁(§8.4) |
| 出了问题 | 子 agent 报冲突或卡住:已经在跑的让它跑完,完成的照常提交;后面的不再派,停下问用户 |
| 统一验证 | 全部任务做完后,主会话跑一次 index 的统一验证 |
| 修复 | 主会话负责。小问题,比如只改一两个文件,直接改;修复量大时派一个子 agent 去修,主会话跑验证确认。修复单独提交,修完再跑一遍统一验证 |
| 要人验证的 | 照常提交,不等人;统一验证以后,把清单一起交给用户 |
| 收尾 | 汇报先讲原来怎样,再讲这次做了哪些任务、统一验证的结果、要人验证的清单、按 plan 执行的情况;汇总子 agent 报的「值得沉淀的」,问一句要不要沉淀知识;提醒平台环节还缺什么(§8.5);提示用户跑 `/code-review`,不自动跑;不 push |
| 不做 | 旧版的四件套注入、逐任务审查、质量审查子 agent、每批一句的启动语;不用 git worktree |
| 接受的代价 | 中间的提交不保证能构建;修复是最后单独的提交 |
| 写法 | 执行侧:步骤说明和自检保留;给派任说明、回报和收尾汇报的范例 |

## 8. 产物规范落地

规则以主任务 spec 为准:头部 §4、首屏结论 §7、`features check` §9、发布记录 §12。本节写本任务要落地的部分,以及对主任务规则的两处调整:spec 不再要求一图看懂;HTML 产物不查开头结论。

### 8.1 头部

各 skill 写新产物时,在一级标题下写头部:

| 产物 | 写它的 skill | 头部字段 |
|---|---|---|
| 主 spec | write-spec | 产物、负责人、任务(可选) |
| 交接文件 | handoff-session | 产物、负责人 |
| 实现计划(index 和各任务文件) | write-plan | 产物、依据 |
| 接口测试规格 | write-api | 产物、依据 |
| 单元测试规格 | write-unit-test-spec | 产物、依据 |
| UI 测试用例规格 | write-ui-test | 产物、依据 |
| 接口测试报告(md) | run-api-test | 产物、依据 |
| 单元测试报告 | write-unit-test-code | 产物、依据 |
| 收口档案 | `/end` | 产物、依据 |
| 发布记录 | `/end` | 产物 |
| 需求文档、设计文档、接口文档 | write-docs | 产物、依据 |
| 线框 | write-wireframe | 产物(写在 HTML 注释里) |

- `> 依据:` 取主 spec 的当前指纹(`cgraphx features show <feature-id>` 会显示),写成 `spec@` 加前 7 位;产出目录没有主 spec 时不写。
- `> 产物:` 写注册表的类型标识:spec、handoff、plan、api_test_spec、unit_test_spec、ui_test_spec、api_test_report、unit_test_report、closure_record、release_record、prd、design_doc、api_doc、wireframe。
- HTML 产物的头部写在前 30 行内的一个注释里。
- 头部格式只在范例里体现,skill 正文不重复主任务 spec 的规则(§4.1)。
- xlsx、json、jsonl 产物不写头部;UI 测试报告(xlsx)照旧由 `cgraphx report ui-test` 生成。

### 8.2 开头结论

注册表登记下列标题,`features check` 对新产物检查「第一个二级标题等于登记的标题」:

| 产物 | 标题 | 内容 | 状态 |
|---|---|---|---|
| 主 spec | 无 | — | 撤掉现有的「一图看懂」检查 |
| 实现计划 index | 设计预览 | 重点决策表 | 已在检查,保留 |
| 交接文件 | 本任务范围 | 本任务做什么、不做什么 | 新登记 |
| 接口、单元、UI 测试规格 | 覆盖范围 | 测哪些功能点或场景,各多少条 | 新登记 |
| 接口、单元测试报告(md) | 结论 | 通过、失败、跳过各多少条,能否交付 | 新登记 |
| 收口档案 | 历时 | 历时与实际投入 | 新登记,沿用 `/end` 现有的第一节 |
| 发布记录 | 版本与上线时间 | 版本号或 tag、上线时间 | 新登记 |
| 需求文档(md) | 需求概览 | 一句话需求,加业务流程图 | 新登记 |
| 设计文档(md) | 架构总览 | 架构总览与关键取舍 | 新登记 |

- 开头结论只检查 md 文件。HTML 产物(接口文档、HTML 版设计文档、线框)不检查,模板里同样把结论放在最前面。
- 交付讲解不再生成,不登记。
- HEAD 里已有的文件不查开头结论,和主任务规则一致。

### 8.3 发布记录(`/end`)

| 项 | 规格 |
|---|---|
| 何时写 | `/end` 收口时问用户是否已上线;确认已上线才写,没上线不写;发布晚于收口的,之后单独补写 |
| 文件 | `<目录>/<前缀>-发布记录.md`,头部 `> 产物: release_record` |
| 内容 | 至少有版本号或 tag、上线时间;可附关联 commit、分支、发布说明;同一任务多次发布,追加在同一个文件里 |
| 效果 | 连协议 1.3 及以上的服务端时上报,平台上的任务显示「已发布」;本地阶段不变 |

### 8.4 提交门禁

precommit-check 在现有的提交规范自查之外,接入 `features check`,只检查本次暂存的、在 `docs/features/` 下的文件,没有暂存的文件不查:

| 情况 | 结果 |
|---|---|
| AI 发起 `git commit`,提交说明还没自查 | 拦下,提示对照 git-standards 自查后,带 `CGRAPHX_PRECOMMIT_REVIEWED=1` 重新提交(现有行为不变) |
| `features check` 有失败项 | 拦下,列出文件、原因和改法;带 `CGRAPHX_PRECOMMIT_REVIEWED=1` 也跳不过,必须改对 |
| `features check` 只有警告,比如产物过期、未知类型 | 放行 |
| `features check` 无法运行,比如全局 cgraphx 版本过旧 | 放行,沿用 hook 现有的「出错不阻断提交」原则 |
| 用户在终端里手动提交 | 不受影响,hook 只拦 AI 发起的提交 |

- `cgraphx features check` 新增 `--staged`:只检查暂存区里 `docs/features/` 下新增和修改的文件。门禁调用它,不自己列文件。

### 8.5 平台环节缺口提醒

implementation 收尾时,以及 subagent-implement 全部做完后,按 `cgraphx features show <feature-id>` 列出的平台环节覆盖情况,提醒一句还缺哪些环节;不拦,不影响流程。

## 9. 代码地图停止维护

| 项 | 规格 |
|---|---|
| skill | 废弃 code-map-write、code-map-recall;implementation 收尾不再提示刷新代码地图;write-plan 不再召回代码地图 |
| web「系统地图」页 | 保留。空状态和过期视图里两处「在 Claude Code 中运行 `/code-map-write` …」的提示,改为「代码地图已停止维护,内容可能过时」 |
| `docs/code-map/` | 已有文件保留,不改不删 |
| 注册表 | 继续把 `docs/code-map/` 识别为 code_map 类型,不改 |
| 配置 | 模板 CLAUDE.md 和 FLOW-MAP 里的「代码图谱」配置行删除,它只给 code-map-write 用 |
| 代码注释 | `src/web/codemap-reader.ts` 里提到 code-map-recall 的注释,改为直接写明过期判定规则 |

## 10. 需同步更新的文档与引用

| 位置 | 改什么 |
|---|---|
| `assets/claude-template/FLOW-MAP.md` | 按改后的流程重写:废弃与合并;clarify 结尾的决策表和图解提醒;plan 一个任务一个文件,大需求用 subagent-implement 跑完;由人确认的点是澄清结果和设计预览的重点决策表;「随时可用」里加 visual-explain;删除代码地图一节 |
| `assets/claude-template/CLAUDE.md` | 主线描述改为大需求先 write-plan,再 subagent-implement;删除「代码图谱」行 |
| cgraphx-guide 的 SKILL.md、how-to-use.md、how-to-use.html | skill 清单和工作流说明 |
| 其他 skill 和命令里对已废弃 skill 的引用 | 改为新做法或删掉。当前涉及 clarify-requirements、write-spec、write-plan、implementation、write-api、run-api-test、write-ui-test、run-ui-test、knowledge-write、knowledge-recall、developer-timeline、iboc-check 和 `/my-query` |
| 前几批因为「subagent-implement 已废弃」删掉或改写的引用 | subagent-implement 保留以后,讲大需求怎么实现、实现完成后才轮到谁的地方,写成 implementation 或 subagent-implement;删掉的这类引用按现行做法补回 |
| 本仓库 `CLAUDE.md`、`README.md`、`README.en.md` | skill 清单和流程描述 |
| `CHANGELOG.md` | 新增一条:列出废弃和合并的 skill,以及各自以后怎么做;写明新增 visual-explain、subagent-implement 保留并改写 |
| 知识库 | 提到被废弃 skill 或一图看懂的条目按改后的事实更新:skill-invocation轴、知识库分类体系、测试流程后置、plan手段决策三档、枚举换血排查教训。skill-invocation轴 按 27 个 skill 写名单,subagent-implement 和 visual-explain 都由 AI 按用户的话调用 |

## 11. 兼容性

| 对象 | 处理 |
|---|---|
| 已部署项目 | `cgraphx install` 升级时删掉 8 个废弃 skill 的目录,subagent-implement 换成新版;`/knowledge-api`、`/write-prd` 等旧名此后不可用 |
| 已有产物 | 一律不改:旧 spec 里的一图看懂、已有的交付讲解、已有的澄清结果页、`docs/code-map/` 都保留,照常识别 |
| 已有 plan | 不迁移成新结构;按批写的 plan 仍可以照每批的启动语手动执行 |
| 已提交的文件 | `features check` 不对 HEAD 里已有的文件查开头结论,和主任务规则一致 |
| 知识库和表结构文件 | 不加头部,不变 |

## 12. 异常与边界

| 场景 | 预期 |
|---|---|
| 要出和需求有关的图解,但还没有需求目录 | 按 write-spec 的命名规则定下 feature-id,建目录后再写 |
| 拿不准图解和哪个需求有关 | 先问用户;和需求无关就放 `.cgraphx/visual/` |
| 图解的内容又变了 | 重出一版,旧版保留 |
| 一个任务预估超过 15 个文件,但改动强耦合,找不到并行边界 | 不硬拆,在任务文件里写明原因 |
| 子 agent 回报的改动文件超出自己任务的涉及范围,或者和同时跑的任务重叠 | 主会话先不提交这个任务,停下问用户 |
| 统一验证里同一个问题修了两轮还没过 | 停下,把失败情况和已做的修复报给用户 |
| 新写的 HTML 产物 | 只查头部,不查开头结论 |
| 产出目录没有主 spec | 派生产物不写 `> 依据:`,`features check` 也不要求 |
| 提交门禁里 `features check` 无法运行 | 放行,不阻断提交 |

## 13. 验收

改完由负责人人工审查,不跑新旧对比测试。审查时应能看到:

1. `assets/claude-template/skills/` 下有 27 个 skill;8 个废弃目录已删除,且都登记在 `deprecated-assets.json`;`skills/subagent-implement` 不在清单里,它旧版的三个提示词文件在清单里。
2. knowledge-recall、write-docs 按 §5 工作。
3. clarify 结尾在对话里给流程图和决策表,并提醒可以图解,不再自动出页面;用户说「画个图讲讲」时,visual-explain 按 §6 出一页图解:和需求有关的进需求目录、按版本出,无关的进 `.cgraphx/visual/`。
4. write-spec 写出的 spec 有 `> 产物: spec` 头部,没有一图看懂;`features check` 不再检查 spec 的开头。
5. write-plan 的设计预览只有重点决策表;大需求的 plan 是 index 加一个任务一个文件,index 有执行顺序、统一验证和一句 `/subagent-implement` 启动语,任务文件不抄契约;请人确认设计预览时有图解提醒。
6. 各 skill 写出的新产物都有 §8.1 的头部和 §8.2 的开头结论,`features check` 通过。
7. AI 提交时,`features check` 有失败项会被拦下,带 `CGRAPHX_PRECOMMIT_REVIEWED=1` 也提交不了;只有警告时放行;没有暂存的文件有问题,不影响提交。
8. `/end` 在确认已上线时写出发布记录。
9. web「系统地图」页的两处提示已改为「代码地图已停止维护,内容可能过时」。
10. FLOW-MAP、CLAUDE.md 模板、cgraphx-guide、README、本仓库 CLAUDE.md 和知识库条目里,不再出现已废弃 skill 的现行用法;CHANGELOG 有对应条目。
11. 既有测试全部通过。
12. subagent-implement 按 §7.6 工作:主会话只读 index;子 agent 只改文件;主会话按提交点提交;全部做完统一验证一次,有问题修好再交给用户;最后提示 `/code-review`。

## 14. Plan 编写约束

- 「skill 写头部」必须和 `features check` 接入门禁同批上线,或者先上线;不能让门禁拦住按旧模板写出的产物。
- 图解的讲法只写一处,即 visual-explain;clarify 和 write-plan 只写一句提醒,不复制讲法。
- 执行侧 skill 只按 §4.1 的执行侧规则删,步骤说明和自检不删;新写的 subagent-implement 同样保留步骤说明和自检。
- 注册表只改开头结论(§8.2);不增删产物类型,不改路径规则和上报行为。
- 不改 `docs/` 下已有的产物和 `docs/code-map/` 文件。
- 按 skill 提交,方便人工审查。
- 这次补充的改动(subagent-implement、plan 结构、visual-explain)按 §7.2 的新结构写 plan;已经执行完的 8 批 plan 文件不改。

## 15. 不可留到实现期的决策

都已在上文定下:废弃与合并清单(§3)、删减规则(§4.1)、图解的触发、形式、位置和命名(§6)、plan 结构、拆法和 15 个文件的阈值(§7.2)、subagent-implement 的派任、提交、验证、修复和停下规则(§7.6)、开头结论标题(§8.2)、提交门禁行为(§8.4)。

## 16. 待确认项

无。
