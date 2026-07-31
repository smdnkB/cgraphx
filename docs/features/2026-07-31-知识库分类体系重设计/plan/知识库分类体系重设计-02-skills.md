# Skills 计划: knowledge-write 换血(S-1)+ knowledge-init(S-2)+ 排查闸门(S-3)+ 迁移 skill 新建(S-4)

> 隶属:`知识库分类体系重设计-index.md`(全局契约见 index §7,本文件任务中重复关键契约原文,自包含可执行)
> **修改入口铁律**(CLAUDE.md):skill 源在 `assets/claude-template/`,不是仓库根目录 `.claude/`(后者是 gitignore 的部署产物)。本文件所有 skill 改动只发生在 `assets/claude-template/skills/` 下。
> feature-id: 2026-07-31-知识库分类体系重设计 · 负责人: liulongfei

---

### T-S-1: knowledge-write 换血(枚举说明 + 模板重映射 + template-flow 新建 + template-runbook 并入移除 + domains 引导)

- **目标**: 将 knowledge-write skill 的类型枚举说明、frontmatter 规范、模板体系、domains 填写引导全部切换到新分类体系。
- **对应 spec 条款**: §3.1(新枚举 + 映射)、§3.2(source_type 新枚举)、§3.3(domains 业务域语义 + skill 引导落实)、§7-2(skills 修订面)。implementer 据此读 spec 原文。
- **强制引用**: 无 docs/guides 代码规范(skill 文本任务,非代码)。**开工前必读**:`assets/claude-template/skills/knowledge-write/` 全部文件(SKILL.md + 5 个模板),理解既有体例后再改。
- **依赖**: T-C-1(新枚举为最终定稿)。
- **涉及范围(只准改这些)**: `assets/claude-template/skills/knowledge-write/SKILL.md`、`template-concept.md`、`template-memory.md`、`template-guide.md`、`template-runbook.md`(并入后删除)、`template-flow.md`(新建)。禁碰其他 skill(S-2/S-3 负责)。
- **必须严格执行**:
  - **SKILL.md 枚举说明换血**:`document_type` 枚举段由 17 条换为 7 条(逐字,index §7.1 表):business-entity 业务实体(业务对象主条目)· business-flow 业务流程 · mechanism 技术机制(含架构)· decision 决策 · rule 规则 · lesson 教训 · guide 指南(含运维手册/教程/安装/FAQ/API 文档);废除值不再出现于任何「合法类型」列表。
  - **source_type 枚举段**换为 5 条(逐字,index §7.2 表):work_context 工作上下文(需求/任务流中沉淀)· batch_exploration 批量探索(knowledge-init 式项目探索)· review 评审(代码/架构评审中发现)· debugging 调查排障(问题调查中发现)· manual 手工(人工主动整理)。
  - **frontmatter 规范示例更新**:示例中的 `source_type: human_note → manual`;示例 domains 改为业务域示例(如标题为安装指南类,domains 填其服务的业务域,服务模块信息放 tags 示范);必填 7 项名单与校验规则描述不变(title/document_type/domains/concepts/status/source_type/updated;domains/concepts ≥1)。
  - **模板映射表**(SKILL.md 内「Summary 章节」的 document_type→模板表)换为(index §7.7 逐字):
    | document_type | 模板 |
    |---|---|
    | business-entity | template-concept.md |
    | business-flow | template-flow.md |
    | mechanism / decision / rule / lesson | template-memory.md |
    | guide | template-guide.md |
  - **template-concept.md**:「适用的 document_type 值」由 `concept` 改为 `business-entity`;模板内「concept 主条目」「实体主条目」等措辞中的类型名同步(实体/主条目概念表述保留,仅类型标识换);`tags: [entity]` 示例可保留(entity 作 tag 合法)。
  - **template-memory.md**:适用类型行由 `conversation / exploration / finding / analysis / decision / lesson / warning / rule / architecture` 改为 `mechanism / decision / rule / lesson`。
  - **template-flow.md(新建)**:business-flow 专用,章节骨架:
    ```
    # <流程名>
    ## Summary            ← 唯一进索引章节(一句话定义 + 黑话变体各出现一次 + 与邻近流程边界)
    ## 触发与前置          ← 触发事件、前置条件
    ## 参与者与系统        ← 角色/系统/服务
    ## 主链路与状态流转     ← 主干步骤与状态迁移(文件级入口指针,不写行号/代码复述)
    ## 异常分支           ← 失败/回滚/补偿
    ## 关键约束与陷阱      ← 跨文件才看得出的规则(同 template-concept 纪律)
    ## 代码入口           ← 文件级路径
    ## Open Questions     ← 可选
    ```
    体例与既有模板一致(frontmatter 示例 + 各章节填写要点表 + 「不应写入」纪律:不写行号/代码复述/全量清单,Summary 标题必须正好 `## Summary` 两个 # 一个空格)。
  - **template-guide.md**:适用类型行确认为 `guide`(含 runbook/faq/tutorial/installation/api 子类说明);**并入 template-runbook.md 的运维要点**:在模板中增加 runbook 子类分支指引(操作步骤 / 回滚方案 / 检查点三要素,适用于运维手册类 guide);
  - **template-runbook.md**:内容并入 template-guide.md 后**删除该文件**(git rm);SKILL.md 中对 template-runbook 的一切引用清除。
  - **domains 填写引导**(SKILL.md「命名与语言」domain 段或 frontmatter 规范段):domains 语义明确为**业务域**(项目的业务领域,如合约/商品/礼包/宽带/订单);服务/模块信息(如 so-service/order-service)放 **tags** 不放 domains;domains 为自由词表(程序不校验枚举),靠本引导与召回反馈收敛;示例对照:✗ `domains: [so-service]` → ✓ `domains: [商品]` + `tags: [so-service]`。
  - **双层结构段落**:「实体主条目(document_type: concept)」→「实体主条目(document_type: business-entity)」;流程层条目类型说明从「exploration/guide 等」改为「business-flow(流程主条目)/ mechanism(技术机制)等」。
  - **CLI 节校验规则摘要的计数**(易漏点):「document_type 属 17 枚举」→「document_type 属 7 枚举」、「source_type 属 7 枚举」→「source_type 属 5 枚举」(status 4 枚举不动);
  - **「维护 → 合并检查」兼容组按新类型族归并**:guide/installation 互兼容 → 该对消失(installation 已并入 guide);conversation/exploration 互兼容 → 改为同模板族归并(memory 模板族:mechanism/decision/rule/lesson 互兼容);concept 与流程类永不互合 → business-entity 与流程类(business-flow)永不互合(保持);
  - **「质量规则」段**:「陷阱用 warning」→ 按映射原则改为「约束类陷阱用 rule,复盘类用 lesson」;
  - **template-memory.md 中「简短对话摘要模板」小节(专为废除类型 conversation)整节删除**(conversation 废除 + 主题不明不库,该模板失去适用类型)。
- **允许局部适配**: 各段解说文案措辞(枚举表与映射表逐字);template-flow 章节的填写要点细则;runbook 要点并入 template-guide 的编排方式(独立小节或分支指引);示例具体取值。
- **具体要求**: 改完后全文 grep 自检:SKILL.md 与全部模板中不得再出现废除值作为**合法类型**(反例/历史说明性提及可以,但本需求后无此场景——应为零命中);`document_type: concept`(作为类型值)零命中;**旧计数零命中**:`grep -n "17 枚举\|7 枚举\|7 种枚举\|17 种" assets/claude-template/skills/knowledge-write/SKILL.md` 应为 0 命中(新计数表述为「7 枚举」「5 枚举」,不出现旧数字)。
- **完成条件**: SKILL.md + 4 个模板(concept/memory/guide/flow)全部切换;template-runbook.md 已删除;grep 自检零残留;SKILL.md 结构完整(误删章节 = 不通过)。
- **验证方式**: grep 命令与输出贴入报告(`grep -rn "exploration\|architecture\|conversation\|finding\|analysis\|warning\|tutorial\|runbook\|installation\|api 文档枚举项\|human_note\|ai_session\|code_review\|architecture_review\|external_summary" assets/claude-template/skills/knowledge-write/` 应为 0 命中,runbook 仅允许出现在「guide 含 runbook 子类」语义句);删除文件列表;template-flow.md 全文(新建文件贴报告备审)。
- **独立提交**: 是。提交范围:knowledge-write 目录全部改动(含 template-runbook.md 删除)。subject:`feat(skills): knowledge-write 分类体系换血——新枚举 + template-flow 新建`;body 列:7+5 枚举换血 + 模板重映射 + template-flow 新建 + template-runbook 并入 guide 移除 + domains 业务域引导;不附 Co-Authored-By。提交前过 index §9 检查点。
- **风险/注意事项**:
  - knowledge-write 是产品核心沉淀流程,改坏影响全线知识质量——逐段对照改,不整文件重写;
  - 「只有 ## Summary 进索引」「标题大小写敏感」等索引契约描述不得在换血中丢失;
  - frontmatter-parser 对字段名的约定(related_code/related_documents 等下划线命名)不在本任务变更范围。

---

### T-S-2: knowledge-init 新枚举同步

- **目标**: knowledge-init(项目知识库批量探索建库)创建的文档 frontmatter 切换为新枚举。
- **对应 spec 条款**: §3.1 §3.2 §7-2。implementer 据此读 spec 原文。
- **强制引用**: 无代码规范;开工前必读 `assets/claude-template/skills/knowledge-init/SKILL.md` 全文。
- **依赖**: T-C-1。
- **涉及范围**: `assets/claude-template/skills/knowledge-init/SKILL.md`。禁碰其他 skill。
- **必须严格执行**:
  - 全文中的类型枚举引用(如建库时使用的 document_type 值:旧 exploration/concept/architecture 等)换为新枚举。新枚举完整清单(逐字,同 index §7.1/§7.2):document_type 7 值 = business-entity / business-flow / mechanism / decision / rule / lesson / guide;source_type 5 值 = work_context / batch_exploration / review / debugging / manual;
  - 建库产出文档的默认类型指引按新语义重写:实体识别 → business-entity;流程识别 → business-flow;技术结构/机制 → mechanism;**约束/陷阱类 → rule / lesson**(约束规则归 rule,复盘教训归 lesson);决策类 → decision;**建库默认来源 → batch_exploration**(knowledge-init 即批量探索场景,spec §3.2 该值的定义出处);domains 填业务域(与 S-1 引导一致,服务模块入 tags);
  - 文中其他 source_type 引用(ai_session 等)→ 按 index §7.2 映射替换;**但建库默认来源一处不走 ai_session→work_context 映射,按上一条取 batch_exploration**(两条指令的优先级:建库默认 > 通用映射)。
- **允许局部适配**: 行文措辞;建库探索的实体/流程识别启发式表述。
- **具体要求**: 改后 grep 自检:判定口径为「废除值不作为 document_type / source_type 合法值出现」——**误报不改**:`.exploration-queue.json` 类运行时文件名、`phase: "exploration"` 状态机值、英文散文中的 exploration 一词均为 knowledge-init 自身的探索阶段概念(与 document_type 无关),保留;仅替换作为知识文件类型/来源值的旧枚举。
- **完成条件**: 文件内类型/来源枚举全为新值;grep 零残留;skill 流程结构完整。
- **验证方式**: grep 输出 + 关键段落 diff 贴入报告。
- **独立提交**: 是。subject:`feat(skills): knowledge-init 同步新分类枚举`;不附 Co-Authored-By。
- **风险/注意事项**: knowledge-init 与 knowledge-write 有交叉引用(建库后调用 knowledge-write)——若 knowledge-init 文中有「按 knowledge-write 规范」式引用,保留引用不抄内容(避免两处维护)。

---

### T-S-3: 全 skill 资产旧枚举排查闸门

- **目标**: 校验 assets/claude-template/ 下除已修订 skill 外**零旧枚举残留**;误报(plugins 构建产物)核实排除。
- **对应 spec 条款**: §7-2(plan 阶段全 skill 排查,防遗漏)。
- **强制引用**: 无。
- **依赖**: T-S-1、T-S-2(先完成已知修订面,本任务查其余)。
- **涉及范围**: `assets/claude-template/` 全目录(只读排查;发现真实残留才改对应文件)。
- **必须严格执行**:
  - 排查命令(覆盖全部废除值,注意 `api` 要带语境匹配避免误报,用 `document_type: api` / `· api` / `api API` 等枚举语境模式):
    ```
    grep -rn -E "document_type: (conversation|exploration|finding|analysis|note|warning|architecture|tutorial|runbook|installation|api|faq|concept)\b" assets/claude-template/skills/
    grep -rn -E "(conversation|exploration|finding|analysis|warning|architecture|tutorial|runbook|installation|faq) " assets/claude-template/skills/ --include="*.md" | grep -iE "document_type|类型|枚举|type"
    grep -rn -E "source_type: (ai_session|human_note|code_review|architecture_review|external_summary)" assets/claude-template/skills/
    ```
    另扫 `assets/claude-template/FLOW-MAP.md` 与根级 md(如有类型枚举提及);
  - `assets/claude-template/plugins/claude-hud/dist/usage-api.*` 的既有命中:读匹配行确认是构建产物中的英文散文/代码(非知识枚举引用)→ 记为**误报排除**,不改(plugin dist 是构建产物,不在本需求范围);
  - 发现真实残留(某 skill 文本把旧值当合法类型/来源引导)→ 按 index §7.1/§7.2 表修订该文件(最小改动,只改枚举引用)。
- **允许局部适配**: 无(本任务是闸门,判定二元:残留/无残留)。
- **完成条件**: 三条排查命令在 skills/ 下**零真实命中**(误报有逐条核实说明);若有修订,修订文件 grep 复检零命中。
- **验证方式**: 全部命令输出贴入报告;误报核实的匹配行摘录。
- **独立提交**: 视结果:零残留 → 无提交(报告即交付);有修订 → 修订文件单独提交,subject:`feat(skills): 旧分类枚举残留清理(排查闸门)`;不附 Co-Authored-By。
- **风险/注意事项**: 漏扫 = 发布后某 skill 继续引导旧枚举,污染新体系;grep 模式宁可宽(宽了逐条核实误报),不可窄。

---

### T-S-4: 新建 knowledge-migrate 迁移 skill

- **目标**: 交付分类体系存量迁移的执行载体:knowledge-migrate skill(dry-run 报告 → 用户确认 → 执行 → 校验 → 索引 → 抽检)。
- **对应 spec 条款**: §4.4(迁移 skill 行为契约)、§7-2(skills 修订面:新建迁移 skill)、§3.1/§3.2/§3.3(映射规则)、§6.2/§6.3(迁移边界)。implementer 据此读 spec 原文。
- **强制引用**: 无代码规范;开工前必读 `assets/claude-template/skills/knowledge-write/SKILL.md`(镜像其 frontmatter 形态与体例)与 `knowledge-recall/SKILL.md`(触发词写法参考)。
- **依赖**: T-C-1(新枚举定稿;skill 内嵌映射表以此为准)。
- **涉及范围**: `assets/claude-template/skills/knowledge-migrate/SKILL.md`(新建,单文件 skill)。禁碰其他 skill。
- **必须严格执行**:
  - **skill frontmatter**:镜像既有 knowledge-* skills 的 frontmatter 形态(先读 knowledge-write/SKILL.md 顶部确认字段);description 含触发词:迁移知识库 / 分类迁移 / 类型迁移 / frontmatter 迁移 / 知识库换血 / migrate knowledge / taxonomy migration;
  - **流程契约(逐字落地,index §7.6)**:
    1. 定范围:目标项目知识库(docs/knowledge/ 全量)或用户指定文件集;
    2. **dry-run**(不改任何文件):逐篇读内容,按内嵌映射表判定,生成**迁移报告表**——列:文件 / 旧 document_type → 新 / 旧 source_type → 新 / 旧 domains → 新业务域 / 移入 tags 的服务模块 / 判定依据(一句话)/ 剔除建议(主题不明者);
    3. **用户确认(硬检查点)**:报告交用户确认,未确认不得执行写入;用户对单条的修改意见直接采纳;
    4. 执行:批量改写 frontmatter——仅改 document_type / source_type / domains / tags 四个字段,**保留正文与其他全部 frontmatter 字段**(未知字段原样保留);
    5. 逐篇 `cgraphx docs validate <file>`(或 `node dist/cli/index.js docs validate`),不过的条目**回滚该条**并列入失败清单报告;
    6. **剔除执行**:主题不明的剔除项**移出索引目录**(默认 `docs/knowledge/` → `docs/knowledge-archive/`,归档目录在用户确认环节可改)——留在 docs/knowledge/ 带旧值会导致重索引 skip,违反「重建索引无 skip」验收;剔除动作同样在用户确认后执行;
    7. 提议重建索引:`cgraphx docs index`(**用户确认后**执行,全量覆盖式、事务性);
    8. 输出:抽检建议(随机抽 N 篇供人工核对,含判定依据)、剔除清单(含归档去向)、失败清单;
  - **内嵌映射表**(index §7.5 逐字:document_type 映射原则 + source_type 映射 + domains 服务模块迁 tags + 同名保留值复核原则 + 主题不明剔除规则);
  - **新枚举表内嵌**(index §7.1/§7.2 逐字,判定与 validate 依据);
  - **红线段**(写进 SKILL.md):不改正文;未知字段保留;validate 不过即回滚该条;不自动跑 docs index;剔除必先经用户确认且给出归档去向(必须移出索引目录);域外文件不碰(只动 docs/knowledge/ 或用户指定集);迁移后 domains ≥1 项(spec §6.3——服务模块迁出后必须补填业务域,不得留空 domains);
  - 判定纪律段:按**内容主题**判定,不按旧值机械映射;同名保留值(decision/rule/lesson/guide/debugging/manual)复核新语义归属。
- **允许局部适配**: SKILL.md 行文结构与措辞(流程步骤、映射表、红线为契约,不可省);报告表的具体排版;抽检默认篇数(建议 10% 且 ≥3 篇)。
- **完成条件**: SKILL.md 创建,frontmatter 形态合规;流程七步 + 映射表 + 新枚举表 + 红线齐全;与 knowledge-write 体例一致。
- **验证方式**: SKILL.md 全文贴报告备审;`ls assets/claude-template/skills/knowledge-migrate/` 确认;grep 自检文件内无旧枚举作为**合法值**出现(映射表中旧值作为「来源」出现是必须的,不算残留)。
- **独立提交**: 是。subject:`feat(skills): knowledge-migrate 迁移 skill——dry-run 报告 + 确认执行`;body 列:七步流程(硬检查点:用户确认 + 索引确认)+ 映射表内嵌 + 红线(不改正文/不自动索引/回滚);不附 Co-Authored-By。
- **风险/注意事项**:
  - 硬检查点措辞必须是命令式(「未确认不得执行」),不能是建议式——这是 61+ 篇批量变更的唯一人工闸门;
  - skill 是 AI 执行指引,步骤要可机械遵循,不留「酌情处理」式模糊(判定依据要求写一句话,就是为抽检可审)。
