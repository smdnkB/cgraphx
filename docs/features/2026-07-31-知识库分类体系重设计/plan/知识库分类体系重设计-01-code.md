# 代码计划: core 枚举换血(C-1)+ web 同步(C-2)

> 隶属:`知识库分类体系重设计-index.md`(全局契约见 index §7,本文件任务中重复关键契约原文,自包含可执行)
> feature-id: 2026-07-31-知识库分类体系重设计 · 负责人: liulongfei

---

### T-C-1: core 枚举换血 + validator 消息充实 + 测试基线更新 + 本仓库 KB 文档迁移

- **目标**: 换血 `DOCUMENT_TYPES`(17→7)与 `SOURCE_TYPES`(7→5);validator 自动随常量生效,充实三个枚举字段的错误 detail;更新全部受影响的测试基线(枚举契约变更引起的合法更新);迁移本仓库自身的知识库文档。
- **对应 spec 条款**: §3.1(新枚举 + 废除值)、§3.2(source_type 重定义)、§3.4(不变项:必填 7 项、domains/concepts ≥1、CLI 行为、表结构)、§4.1(validator 行为与错误消息)、§7-6(测试基线更新属本需求变更)、§8(未迁移文档被判非法)。implementer 据此读 spec 原文。
- **强制引用**: `docs/guides/coding-standards.md`(边界与结构 / 选型 / 错误与日志)、`docs/guides/testing-standards.md`(Mock 政策与隔离 / 测试描述)。开工前必读。
- **依赖**: 无(批次 1,一切的基础)。
- **涉及范围(只准改这些)**: `src/core/markdown/constants.ts`、`src/core/markdown/validator.ts`(仅 detail 文案)、`__tests__/core/markdown/**`(基线更新)、`docs/knowledge/cgraphx-web.md`(本仓库 KB 文档迁移)。禁碰 `src/web/**`(C-2)、`src/core/markdown/` 其他模块(query/store/indexer 等零改动——validator 复用常量自动生效)。
- **必须严格执行**:
  - `DOCUMENT_TYPES` 换血为 7 值(顺序如下,注释中文,`as const` 保持):
    ```ts
    export const DOCUMENT_TYPES = [
      'business-entity',  // 业务实体
      'business-flow',    // 业务流程
      'mechanism',        // 技术机制(含架构)
      'decision',         // 决策
      'rule',             // 规则
      'lesson',           // 教训
      'guide',            // 指南(含运维手册/教程/安装/FAQ/API 文档)
    ] as const;
    ```
  - `SOURCE_TYPES` 换血为 5 值(沉淀场景语义):
    ```ts
    export const SOURCE_TYPES = [
      'work_context',       // 工作上下文:需求/任务流中沉淀
      'batch_exploration',  // 批量探索:knowledge-init 式项目探索
      'review',             // 评审:代码/架构评审中发现
      'debugging',          // 调查排障:问题调查中发现
      'manual',             // 手工:人工主动整理
    ] as const;
    ```
  - `REQUIRED_FRONTMATTER_KEYS` / `DOCUMENT_STATUSES` / `LIST_KEYS` / `OPTIONAL_SCALAR_KEYS` / `SUMMARY_HEADINGS` / `KNOWLEDGE_DIR` / `ACCEPTED_EXTENSIONS` **逐字不动**(spec §3.4)。
  - validator.ts:三个枚举字段(document_type / status / source_type)非法时的 detail 统一为 `<field>=<value> (valid: <合法值逗号分隔>)`,合法值取对应常量数组 join(', ');skipReason 保持 `invalid_enum_value`;ValidationResult / ValidatedFields 结构与校验阶段逻辑不变。
  - **测试基线更新**(枚举契约本身在变,更新合法;测试意图不变):
    - `facade.test.ts`:byType 全键断言由 17 键改为 7 键(新枚举全在、缺省 0);byStatus 4 键不变;导出面精确键集合断言不变(门面导出面未变);
    - `find-paged.test.ts` / `concepts-sort.test.ts` / `dedup.test.ts` / `indexer.test.ts` / `extractor.test.ts` / `frontmatter-parser.test.ts` / `schema-migration.test.ts` / `docs-validate.test.ts` / `validator.test.ts`:fixture frontmatter 与断言中的旧枚举值替换为新值——**按各 fixture 的测试意图选值**(如流程类 fixture → business-flow,机制类 → mechanism;filter 用例需要多类型时分散取新值);validator 用例新增:7 个新 document_type 值全部合法、5 个新 source_type 值全部合法、废除值(至少 exploration / architecture / concept / ai_session / human_note 各一)非法且 detail 含 `(valid:` 片段与完整合法值列表;
    - timeline 测试中若有旧枚举词命中(如 stop-event/bash-semantics 等),那是英文散文误命中,**不动**;
    - 每条 fixture 替换在报告中列一句理由(测试意图 → 选值)。
  - **本仓库 KB 文档迁移** `docs/knowledge/cgraphx-web.md`:`document_type: concept → business-entity`;`source_type: ai_session → work_context`;`domains: [web] → [web 服务]`(业务域语义;web 子系统对本项目即业务域);tags 追加 `web`(原 domains 服务模块信息迁 tags——本例 web 已是业务域名,tag 保留子系统标记);其余字段与正文不动;改后 `node dist/cli/index.js docs validate docs/knowledge/cgraphx-web.md` 通过(注意:dist 是旧构建,validate 走旧枚举会判 business-entity 非法——**先 `npm run build` 再 validate**,或直接用 vitest 新用例覆盖,二者择一,报告写明)。
  - 新代码注释中文;CLI(`src/core/markdown/cli.ts`)不动。
- **允许局部适配**: validator detail 文案措辞(格式固定);fixture 替换选值(按测试意图);本仓库 KB 文档 domains 业务域具体填法(「web 服务」为推荐,可微调)。
- **具体要求**:
  - 先跑基线 `npx vitest run __tests__/core/markdown/` 记录当前全绿状态,再动手;
  - 换血后立即回归,逐个修复红用例(按上述基线更新规则);
  - 全量 `npx vitest run` 回归(web 测试此时会红——web TYPE_LABELS 是 Record<DocumentType,...> 穷尽类型,枚举换血后**编译失败属预期**,由 C-2 修复;本任务完成条件以 `__tests__/core/markdown/` 全绿 + `npx tsc --noEmit` 的报错**仅限 src/web/ 与 __tests__/web/** 为准)。
- **完成条件**:
  - `npx vitest run __tests__/core/markdown/` 全绿(含新增 validator 枚举用例 + **本仓库 KB 文档用例**:读 `docs/knowledge/cgraphx-web.md` 真实文件,`parseFrontmatter` + `validateFrontmatter` 断言 valid=true 且 documentType='business-entity'、sourceType='work_context'——此项在 C-1 阶段即覆盖 KB 文档迁移合法性,不依赖 build);
  - `npx tsc --noEmit` 报错仅存在于 src/web/constants.ts(TYPE_LABELS/TYPE_TONES 穷尽性)——这是 C-2 的输入信号,其他位置零报错。
- **验证方式**: 上述命令,输出贴入报告;fixture 替换理由清单;本仓库 KB 文档迁移前后 frontmatter diff。**构建后验证项(由 controller 在批末 C-2 完成、`npm run build` 成功后执行,不在 C-1 阶段阻塞)**:`node dist/cli/index.js docs validate docs/knowledge/cgraphx-web.md` exit 0;`docs show docs/knowledge/cgraphx-web.md` 输出中 document_type/source_type 行展示新值(spec §7-5 核对项:行为不变,新值自然呈现)。
- **独立提交**: 是,但**批末提交**:C-1 单独完成时 web 存在预期编译失败(`Record<DocumentType,…>` 穷尽性),不满足「提交后仓库可工作」,故不即时提交——待 C-2 完成、全仓 tsc + 全量测试转绿后,controller 先提交 C-1 再提交 C-2(两次原子提交)。建议 C-1 提交范围:constants.ts + validator.ts + __tests__/core/markdown/** + docs/knowledge/cgraphx-web.md。subject:`feat(markdown): 知识库分类体系换血——document_type 7 值 + source_type 5 值`;body 列:换血两枚举 + validator detail 列举合法值 + 测试基线更新(枚举契约变更,spec §7-6)+ 本仓库 KB 文档迁移;不附 Co-Authored-By(index §9 注)。提交前过 index §9 检查点。
- **风险/注意事项**:
  - facade.test.ts 的导出面精确键集合断言是防门面漂移的闸门——门面导出面确实未变,断言不应变;若红,说明误改了 index.ts,回退;
  - fixture 替换不得改变用例测试意图(如"非法枚举返回空"的用例,非法值换成新废除值 exploration,不是换成合法值);
  - `npm run build` 会因 web 编译失败而失败(C-2 未做)——本任务验证 KB 文档时用 vitest 覆盖或仅 tsc 核心目录判断,不死等 build。

---

### T-C-2: web 同步——spec 条款先行修订 + TYPE_LABELS/TYPE_TONES 7 项 + web 测试更新

- **目标**: 将 web 知识库浏览的类型体系从 17 枚举换血为 7 枚举:**先修订 web 需求 spec §3.3 条款**(spec 是契约,先行),再改 web 常量与测试。
- **对应 spec 条款**: §3.1(新枚举表)、§4.3(web 行为 + 修订顺序约束)、§7-3(web 同步修订面)。implementer 据此读 spec 原文。
- **强制引用**: `docs/guides/coding-standards.md`(选型 / 边界与结构)、`docs/guides/testing-standards.md`(Mock 政策与隔离 / 测试描述)。开工前必读。
- **依赖**: T-C-1(新枚举已落 constants;C-1 留下的 web 编译失败是本任务修复对象)。
- **涉及范围(只准改这些)**: `docs/features/2026-07-30-cgraphx-web知识库浏览/cgraphx-web知识库浏览-spec.md`(仅 §3.3 类型映射表段落)、`src/web/constants.ts`、`src/web/public/app.css`(仅 'record' 色系类清理,可选)、`__tests__/web/knowledge-overview.test.ts`、`__tests__/web/knowledge-detail.test.ts`(fixture 类型值)。禁碰 `src/core/**`、`src/web/` 其他文件(页面模板渲染逻辑不依赖具体类型值,不应改)。
- **必须严格执行**:
  - **顺序硬约束**:先改 web 需求 spec 的 §3.3 类型映射表段落,再改代码。spec 修订内容:17 行映射表替换为 7 行(本任务下方契约表逐字)+ 表后追加一句「废除 13 值(2026-07-31 分类体系换血,见《知识库分类体系重设计-spec》§3.1):conversation / exploration / finding / analysis / note / warning / architecture / tutorial / runbook / installation / api / faq / concept」;**§3.3 中随表联动的枚举个数文字同步改**:「列出全部 17 种类型」→「列出全部 7 种类型」、色系括号「17 种不可能各一色」→「7 种」(仅个数);§3.3 的**行为口径文字不动**(按使用频率降序、全集始终全部渲染、0 计数也显示、计数联动与否的条款)。web 需求的 plan 文件(历史执行产物)**不追溯修改**。
  - `src/web/constants.ts` 换血(契约逐字):
    ```ts
    TYPE_LABELS: Record<DocumentType, string> = {
      'business-entity': '业务实体', 'business-flow': '业务流程', mechanism: '技术机制',
      decision: '决策', rule: '规则', lesson: '教训', guide: '指南',
    }
    type TypeTone = 'entity' | 'process' | 'judgment' | 'lesson';   // 移除 'record'
    TYPE_TONES: Record<DocumentType, TypeTone> = {
      'business-entity': 'entity', mechanism: 'entity',
      'business-flow': 'process', guide: 'process',
      decision: 'judgment', rule: 'judgment',
      lesson: 'lesson',
    }
    ```
    STATUS_LABELS 不动;PAGE_SIZE / CONCEPT_PANEL_TOP 不动;文件头注释中「17 条」改「7 条」、指向改为本 spec(《知识库分类体系重设计-spec》§3.1)与 web 需求 spec 修订后的 §3.3;色系注释按新分组重写(entity:business-entity/mechanism 定义结构类;process:business-flow/guide 操作流程类;judgment:decision/rule 判断约束类;lesson:lesson 教训风险类)。
  - `app.css`:'record' 色系相关类(`.tbadge--record` 等,以文件实际为准)可清理(无类型映射到 record;页面模板按 TYPE_TONES 动态取类,不会有元素带 record 类)——清理或保留均可(允许适配),不得影响其他色系。
  - web 测试更新:
    - `knowledge-overview.test.ts`:「17 个类型芯片全渲染」用例改为「7 个新枚举值全渲染」(断言 business-entity/business-flow/mechanism/decision/rule/lesson/guide 全部出现,计数降序逻辑不变);fixture 文档类型用新值(如 decision/lesson/business-flow,保持用例的组合过滤意图);
    - `knowledge-detail.test.ts`:fixture frontmatter 类型/来源换新值(如 business-entity + work_context);`tbadge--<tone>` 类断言按新 TYPE_TONES 核对(business-entity → tbadge--entity);
    - `server.test.ts`:不依赖类型枚举,预期零改动(若红,排查是否误碰)。
- **允许局部适配**: CSS record 类清理与否;测试 fixture 具体选值(按用例意图);spec §3.3 追加说明的措辞(要素固定)。
- **具体要求**: 按「先 spec 后代码」顺序执行;改完跑 `npx tsc --noEmit`(C-1 遗留的 web 编译错误必须清零)+ `npx vitest run __tests__/web/` 全绿 + `npm run build` 成功。
- **完成条件**: `npx tsc --noEmit` 零错;`npx vitest run __tests__/web/` 全绿(server 8 + overview 19 + detail 8,数量以实际为准);`npm run build` 成功;web 需求 spec §3.3 已是 7 枚举表。
- **验证方式**: 上述命令输出贴入报告;spec §3.3 修订 diff;constants.ts diff。
- **独立提交**: 是,**批末提交**(全仓 tsc + 全量测试转绿后,controller 按 C-1 → C-2 顺序提交,本任务为第二笔)。提交范围:web 需求 spec + src/web/constants.ts + (app.css 若清理) + __tests__/web/ 两文件。subject:`feat(web): 类型体系换血——spec 条款先行修订 + TYPE_LABELS/TYPE_TONES 7 项`;body 列:spec §3.3 条款先行修订(顺序约束)+ 常量 7 项换血 + TypeTone 移除 record + 测试更新;不附 Co-Authored-By。提交前过 index §9 检查点。
- **风险/注意事项**:
  - 页面模板(pages-overview/pages-detail/overview-templates)按 Record 查表渲染,不含具体类型值硬编码——若发现硬编码(如某处写死 'exploration'),那是 bug,上报 PLAN_CONFLICT,不在本任务扩改;
  - spec 修订只动 §3.3 类型表段落,不得顺手改 §3.3 其他口径(排序/全集渲染/计数是已实现契约)。
