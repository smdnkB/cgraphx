### T-5: skill 与命令模板收口(dev-handoff、task-history 下掉,澄清进度改写进讨论稿)

> 产物: plan
> 依据: spec@a4ca0fa

- 目标: 模板里不再有 `/dev-handoff`、task-history;澄清中途换会话改成把进度写进讨论稿;`/dev-start` 不再讲任务归属、一个需求只开一个副本;`/dev-end` 历时只留起止;`/dev-impl` 两兄弟与 FLOW-MAP 的「平台环节」改「需求环节」;cgraphx-guide 不再介绍 web、上报、开发任务。
- 对应 spec 编号: F2(环节提醒、FLOW-MAP、cgraphx-guide)、F4(dev-spec 的 `> 任务:`、dev-start 的任务归属)、F5(D12、dev-handoff 删除、dev-start 换会话说法、F5③)、F6(D14、doc-report、task-history 删除)。(执行者据此读 spec 原文,不凭任务转述猜)
- 强制引用: `docs/guides/coding-standards.md`(注释/文案中文的既有约定;无代码)
- 涉及范围(都在 `assets/claude-template/` 下):
  - 修改:`skills/dev-clarify/SKILL.md`、`skills/dev-spec/SKILL.md`、`skills/dev-start/SKILL.md`、`skills/dev-impl/SKILL.md`、`skills/dev-impl-subagent/SKILL.md`、`skills/doc-report/SKILL.md`、`commands/dev-end.md`、`FLOW-MAP.md`、`skills/cgraphx-guide/SKILL.md`、`skills/cgraphx-guide/skills.html`、`skills/cgraphx-guide/how-to-use.md`、`skills/cgraphx-guide/how-to-use.html`、`deprecated-assets.json`,以及 `skills/dev-wireframe/references/wireframe-template.html`——只改第 4 行示例标题「线框 v2 · cgraphx web 数据库入口(低保真)」为与已下掉功能无关的示例名(spec 文档改动表外的顺带清理:线框范例页不再引用已下掉的 `cgraphx web`;该行的 feature-id 与变化说明保留)。
  - 删除:`skills/dev-handoff/` 整目录、`agents/task-history.md`。
  - 与同一步同时跑的任务(T-1、T-4、T-6)不重叠。
- 必须严格执行:
  - **`deprecated-assets.json`**:加两条 `"skills/dev-handoff"`、`"agents/task-history"`(路径相对 `.claude/`,与现有条目同规则)。
  - **`skills/dev-clarify/SKILL.md`**(D12):⑤「放哪」里「换会话的照交接文件『澄清进度』从 ④ 接着写」改成:换会话的在讨论稿「写稿中」那行下面加一节 `**澄清进度**`——写清写到哪个 F、还等人拍板的事(一条一行)、已拍板但还没写进图和口径表的口径(照抄);新会话接着写时从这一节接;收拢时这一节和「写稿中」那行一起删;还没有讨论稿的换会话,先照「放哪」建 v1 再写这一节。推荐下一步清单里去掉 `/dev-handoff`。
  - **`skills/dev-spec/SKILL.md`**:第 0 步去掉「④ 任务」那一条(编号顺延);第 1 步「新会话里接手、只负责部分功能点的,照交接文件写的范围收……」整段删,收口径回到「收讨论稿人终确认的那一版」;负责人那条「写成显示名平台就建不出任务」改成「写成显示名,`features list --mine` 就找不到」;「或目录已由 clarify 讨论稿、`/dev-handoff`、`/dev-start` 建立」去掉 `/dev-handoff`;收尾规则里「关联平台上已有任务时,头部加一行 `> 任务: T-<n>`」删。
  - **`skills/dev-start/SKILL.md`**:开头「一个需求一个副本」段改成:一个需求只开一个副本;要几个会话并行,先把需求按功能点拆成几个需求目录(各自写讨论稿),再各开各的副本;同一需求换会话,**在副本里直接开新会话,不开新副本**;「副本里的会话、提交、任务归属……按登记归到这个需求」去掉任务归属的说法(会话和提交仍记进同一个项目的数据);流程第 1 步与「停下问用户」表里两处「换会话用 /dev-handoff」改成「在副本里直接开新会话」;「停下问用户」表「澄清还没收拢」行改成:先不开副本——当前会话按 dev-clarify 的放法把「澄清进度」写进讨论稿,再开副本(讨论稿随需求目录移进副本),到副本里开新会话接着 `/dev-clarify`;「停下问用户」表加一行:需求已有在用副本(`feature_has_replica`)→ 停下,转告命令返回的 message;开完副本的回话模板里「归到 <feature-id>」那句去掉任务归属讲法。
  - **`commands/dev-end.md`**(D14):档案模板历时节只留「立项:<日期> · 完成:<日期> · 日历跨度:<N 天>」一行;填法:立项取需求第一个提交的日期、完成取最后一个提交的日期(用户给的 SHA 范围内),日历跨度首尾两天都算(同一天提交完算 1 天);删「实际投入」那行、派 `task-history` 子 agent 的整段、按会话活跃时段估算的办法;「六节齐全」自检不变;发布记录部分去掉「写了它,平台上的任务才会显示已发布」那条理由。
  - **`skills/doc-report/SKILL.md`**:报告类型表里阶段总结的范围改成「时间窗口 / 会话范围」;「按需求出报告(阶段总结里的某个需求)时,会话和产出取 `cgraphx task show <需求> --json`」那句改成:暂不支持按某个需求出报告;要单个需求的阶段总结,按该需求的起止日期出时间窗报告。
  - **`skills/dev-impl/SKILL.md`、`skills/dev-impl-subagent/SKILL.md`**:「平台环节」改「需求环节」;做完的提醒原文改成「这个需求还缺:测试。可以跑 `/api-case` 或 `/unit-spec` 补。」(以各文件里现有提醒句式落位,缺口列表仍按 `cgraphx features show` 算)。
  - **`FLOW-MAP.md`**:去掉 `/dev-handoff` 的两处(分支图里「要开新会话 → dev-handoff」、链描述里的括号说明);收尾那一格与「收尾」段「平台环节缺口提醒」改叫「需求环节缺口提醒」。
  - **`skills/cgraphx-guide/` 四个文件**:去掉 web、平台上报(`cgraphx sync`)、开发任务(`cgraphx task`)、`/dev-handoff`、task-history 的介绍与入口(html 里的卡片/链接/目录同步删);其余 skill 介绍不动。
- 允许局部适配:
  - 行文措辞与段落组织(在语义与 spec 原文口径不变的前提下);
  - cgraphx-guide 各 html 里对应的 DOM 结构删法(不留空壳区块);
  - dev-spec 第 0 步删条后的编号重排方式。
- 具体要求:
  - 改完 `grep -rn "dev-handoff\|task-history" assets/claude-template/` 只允许 `deprecated-assets.json` 命中;`grep -rn "cgraphx web\|cgraphx sync\|cgraphx task" assets/claude-template/` 无命中(cgraphx-guide 与其余 skill 都不再提)。
  - 「平台环节」全模板只剩「需求环节」:`grep -rn "平台环节" assets/claude-template/` 无命中。
  - skill 数量从 33 变 32:如模板内有数量说法(含 CLAUDE.md——那是 T-7 的事,本任务只管模板内),同步改。
  - `npm run build` 通过(copy-assets 会拷模板,确认无断链文件被引用)。
- 完成条件:
  - 上述三个 grep 全部干净;`skills/dev-handoff/`、`agents/task-history.md` 不在;`npm run build`、`npm test` 通过。
- 提交点:
  1. `refactor(skills): 下掉 dev-handoff 与 task-history——deprecated-assets 登记`:删两个目录 + `deprecated-assets.json`。
  2. `docs(skills): 澄清进度写进讨论稿+需求环节改名+历时只留起止`:其余 12 个文件。body 列要点。
- 风险/注意事项:
  - dev-clarify 的「放哪」是 K9 的落点:改完后再通读 ⑤,确认「还没收拢 → 写澄清进度 → 新会话接 → 收拢删」链条完整、没有残留「交接文件」说法。
  - 交接文件作为一种**产物类型**仍被产物检查认(F5 边界②)——模板里删的是「写交接文件」的流程指引,不是产物注册表里的类型(注册表在代码里,本任务不碰)。
