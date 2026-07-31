# 规格说明: docs 知识库分类体系重设计(换血式)

> feature-id: 2026-07-31-知识库分类体系重设计
> 业务ID: 无(已确认)
> 状态: 已确认
> 负责人: liulongfei
> 日期: 2026-07-31

## 1. 目标与范围

### 1.1 目标与动因

docs 子系统(markdown 知识库)的三个分类维度出现语义失效,本需求对其**换血式重设计**:

1. **document_type(生产/形式语义 → 主题语义)**:现有 17 种类型回答"知识怎么来的/什么形式"(conversation/exploration/finding/analysis/…),不回答"文档在讲什么"。hx 项目 61 篇真实知识库中只用 5 种,`exploration` 占 57% 沦为默认桶;主题归属溢出到 tags 并碎裂(`business-flow` 16 / `flow` 14 / `biz-flow` 8 / `end-to-end` 11——同一语义四个互不相通的标签);
2. **source_type(形式语义 → 沉淀场景语义)**:现有 7 种(ai_session/human_note/…)77% 集中于 ai_session,5/7 值零使用,且消费点为零(find 不支持过滤、web 不展示、仅 CLI `docs show` 一行)。重定义为"从哪个场景沉淀的",落地写入侧的场景意识;
3. **domains(服务模块语义 → 业务域语义)**:自由词表实际被用作服务模块(so-service 56 / order-service 41…),运转良好但缺失业务视角(合约/商品/礼包/宽带…)。语义转向业务域,服务模块信息迁 tags。

### 1.2 包含范围

- document_type 枚举换血(7 种,废除 13 个旧值)+ 存量映射规则;
- source_type 枚举重定义(5 种,沉淀场景语义)+ 存量映射规则;
- domains 语义转向(业务域,服务模块迁 tags,validator 不校验枚举,skill 引导填写);
- 迁移 skill 新建(AI 读内容判定 → 改写 frontmatter → validate);
- **hx 知识库 61 篇(`/Users/smdnk/objects/java/hx/docs/knowledge`)迁移纳入本需求**,兼作验收试金石;
- 同步修订面(§7,六处,须同发布)。

### 1.3 明确非目标

- ❌ domains 项目级枚举声明 + validator 校验机制(记为未来可选扩展);
- ❌ CLI 迁移助手命令(以 skill 形态替代);
- ❌ 索引层表结构变更(`markdown_documents.document_type` / `source_type` 仍为 TEXT 列);
- ❌ 分类之外的知识库治理(concepts 词汇收敛、重复条目合并等);
- ❌ source_type 消费点建设(find 过滤 / web 展示——字段就位,消费另议);
- ❌ status(4 种)、concepts/tags/aliases 维度、CLI 子命令接口语义的任何变更。

## 2. 术语与业务对象

| 术语 | 本需求语境 |
|---|---|
| 主题语义 | document_type 的新语义:回答"文档在讲什么"(业务实体/业务流程/技术机制/决策/规则/教训/指南),不回答"知识怎么产生的" |
| 沉淀场景语义 | source_type 的新语义:回答"从哪个场景沉淀的"(工作上下文/批量探索/评审/调查排障/手工) |
| 业务域 | domains 的新语义:项目的业务领域(合约/商品/礼包/宽带…),与 concepts 词汇互补(业务域是面,concept 是点) |
| 同名保留值 | 新旧枚举同名的值:`decision` / `rule` / `lesson` / `guide`(document_type)与 `debugging` / `manual`(source_type)。**值合法 ≠ 归属准确**:guide 语义扩含 runbook/faq 等,debugging 从形式语义转为场景语义——存量文档仍须经迁移按新语义复核 |
| 兜底类型 | 主题不明时可填的类型。新枚举**无兜底类型**(note 已废除):主题不明的文档不入库 |

## 3. 已确认规格:三个维度的新定义

### 3.1 document_type 新枚举(7 种)

英文枚举值为 frontmatter 契约值(validator 校验对象);中文为显示标签(web 渲染用,映射表由 web 侧维护且须与本表一致):

| 枚举值 | 显示标签 | 语义 |
|---|---|---|
| `business-entity` | 业务实体 | 能用名词指代、有属性和生命周期的业务对象的主条目(商品、礼包、合约) |
| `business-flow` | 业务流程 | 业务活动的端到端流转(礼包新装、退订、过户) |
| `mechanism` | 技术机制 | 技术机制与架构(含原 architecture:服务拓扑、分发机制、分片路由) |
| `decision` | 决策 | 取舍记录(同名保留) |
| `rule` | 规则 | 长期有效的约束(同名保留;吸收原 warning 的规则类) |
| `lesson` | 教训 | 事故/问题复盘(同名保留;吸收原 warning 的复盘类) |
| `guide` | 指南 | 操作性知识:指南/运维手册/教程/安装/FAQ/API 文档(同名保留,语义扩含) |

**废除值(13 个)**:conversation / exploration / finding / analysis / note / warning / architecture / tutorial / runbook / installation / api / faq / concept。

**存量映射原则**(迁移 skill 据此逐篇判定,非机械替换):

| 旧值 | 映射原则 |
|---|---|
| concept | → business-entity |
| exploration / finding / analysis | 按内容主题判定:讲业务流程 → business-flow;讲技术机制/架构 → mechanism;讲业务实体 → business-entity;其余按主题归入 |
| architecture | → mechanism |
| warning | 约束类 → rule;复盘类 → lesson |
| tutorial / runbook / installation / api / faq | → guide |
| conversation / note | 按内容主题判定;确无明确主题者**不迁移入库**(note 废除即"主题不明不入库") |

### 3.2 source_type 新枚举(5 种,沉淀场景语义)

| 枚举值 | 显示标签 | 语义 | 存量映射 |
|---|---|---|---|
| `work_context` | 工作上下文 | 需求/任务流中沉淀(主渠道) | ← ai_session |
| `batch_exploration` | 批量探索 | knowledge-init 式项目批量探索 | — |
| `review` | 评审 | 代码/架构评审中发现 | ← architecture_review、code_review |
| `debugging` | 调查排障 | 问题调查中发现 | ← debugging(同名,语义转为场景) |
| `manual` | 手工 | 人工主动整理记录 | ← manual、human_note、external_summary(如有) |

- **保持必填**(frontmatter 7 项必填不变);
- 消费点现状为零(find 不支持、web 不展示、仅 CLI `docs show` 展示原值)——本需求不建设消费点,重定义落地的是写入侧场景意识;字段与值就位,未来消费随时可接。

### 3.3 domains 语义转向

- 语义:**业务域**(项目业务领域,如合约/商品/礼包/宽带);
- **自由词表,validator 不校验 domains 枚举**——validator 是跨项目通用逻辑,不内置任何项目特定业务域名单(锁定约束);
- 存量中的服务模块信息(so-service/order-service/…)迁移至 tags;
- 填写引导由 knowledge-write skill 落实(语义说明 + 示例),非程序强制。

### 3.4 不变项

- status 4 枚举(draft/active/superseded/deprecated);
- concepts / tags / aliases 维度;
- frontmatter 必填项 7 项(title / document_type / domains / concepts / status / source_type / updated),数量与名单不变;
- domains / concepts ≥1 项的校验规则不变(迁移后 domains 不得为空,见 §6.3);
- CLI 全部子命令的接口语义(index/concepts/domains/tags/find/refs/dedup/seen-names/show/validate 行为不变——**枚举内容变化是唯一的 breaking point**);
- 索引层表结构(`markdown_*` 表不动,枚举以 TEXT 存储)。

## 4. 系统行为

### 4.1 validator 校验行为

- `document_type` 属新 7 枚举、`source_type` 属新 5 枚举为合法;**旧废除值一律非法**(skipReason `invalid_enum_value`);
- 非法文件行为沿用现有契约:`docs validate` 报非法并给出可读原因(错误消息应列举合法枚举值,便于修正——消息措辞由 plan 定);`docs index` 跳过非法文件并计入 skip 统计(现有行为不变)。

### 4.2 各命令在新枚举下的行为

| 命令 | 行为 |
|---|---|
| `docs validate <file>` | 按新枚举校验;非法值报错并列举合法枚举 |
| `docs index [path]` | 扫描逻辑不变;旧值文档被判非法跳过(skip 统计中可见) |
| `docs find --documentType=<v>` | 接口不变;`<v>` 的有效取值集为新 7 枚举(传废除值 → 现有"非法枚举返回空"行为) |
| `docs concepts/domains/tags/refs/dedup/seen-names` | 零变化 |
| `docs show <id-or-path>` | 展示 frontmatter 原值(即新枚举英文值),行为不变 |

### 4.3 web(知识库浏览服务)行为

- 类型过滤芯片渲染**新 7 枚举**(按使用频率降序,全集始终全部渲染,0 计数也显示——沿用已实现的 web 行为契约,仅枚举内容换血);
- 显示标签映射(TYPE_LABELS)须与 §3.1 表逐字一致;
- **修订顺序约束**:`2026-07-30-cgraphx-web知识库浏览` spec §3.3 的「17 种类型映射表」条款须**先修订为新 7 枚举表,再改 web 代码**(spec 是契约,代码不得先于契约变更)。

### 4.4 迁移 skill 行为契约

- 输入:目标项目知识库(或指定文档集);
- 处理:逐篇读文档内容 → 按 §3.1 / §3.2 / §3.3 判定新 document_type / source_type / 业务域 → 服务模块信息迁 tags → 改写 frontmatter(保留其余字段与正文)→ `docs validate` 校验;
- 判定原则:按文档**内容主题**判定,不按旧值机械映射(§3.1 映射原则是指导而非硬规则;同名保留值同样复核);
- 迁移后 frontmatter 必须通过 validator(含 domains ≥1 项,见 §6.3);
- 形态细节(触发词、逐篇/批量、dry-run 报告、抽检机制)由 plan 定。

## 5. 数据、状态与口径

- **存储**:枚举值以英文原值存储(frontmatter 与索引层一致),中文标签仅 web 渲染层映射,不入库;
- **索引层**:零结构变更;重建索引即全量切换到新枚举视图(索引是派生物,迁移只动源 frontmatter);
- **口径**:「存量迁移完成」= 目标知识库全部文档通过新枚举 validator 且重建索引无 skip(主题不明剔除者除外,剔除须有记录)。

## 6. 兼容性、迁移与存量数据

### 6.1 破坏性变更性质

frontmatter 是 cgraphx 接入项目的**对外契约**,本变更为破坏性变更:

- **无双轨期**:新版本发布后,validator 即按新枚举校验;未迁移文档重索引时被判非法跳过——不存在"旧值临时合法"的过渡窗口;
- 版本策略(版本号、发布节奏)属发布阶段决策,语义上倾向 major;迁移 skill 须随新版本配套提供;
- **2.0-spec 兼容承诺注记**:《cgraphx2.0重构-spec》§9「三块 CLI 接口:沿用 codegraph 现有子命令语义」——本变更保持子命令**行为**不变,仅 frontmatter 枚举内容换血;此偏离须在《cgraphx2.0重构-spec》对应位置追加兼容性注记,指向本 spec。

### 6.2 hx 知识库迁移(本需求范围内)

- 范围:`/Users/smdnk/objects/java/hx/docs/knowledge` 全部 61 篇;
- 方式:用本需求交付的迁移 skill,AI 判定 + 人工抽检;
- 存量映射预期(按当前分布):document_type 侧 exploration 35 篇按主题分流(business-flow 为主)、architecture 21 → mechanism、concept 2 → business-entity、rule 2 / lesson 1 复核;source_type 侧 ai_session 47 → work_context、architecture_review 7 + code_review 3 → review、debugging 2 / manual 2 保留复核;domains 侧服务模块值迁 tags、按内容填业务域;
- 判错可逆:frontmatter 纯文本,判错人工改回;
- **时序约束**:hx 迁移完成并重建索引前,避免对 hx 运行 `docs index`(会产生 skip);迁移完成后全量重建索引作为验收。

### 6.3 其他接入项目

- 不代迁:其他接入项目按迁移 skill 自助迁移,发布时通知到位(迁移 skill 即迁移工具);
- **domains 非空边界**:服务模块值迁出 domains 后,若文档无明确业务域归属,须按内容填入合适的业务域(如项目级技术机制文档填项目级域),保证 domains ≥1 项的既有校验通过——迁移 skill 必须处理此边界,不得迁出空 domains。

## 7. 接口、页面与系统边界(同步修订面)

六处修订须**同发布**(任一滞后即产生不一致):

1. `src/core/markdown/constants.ts`:`DOCUMENT_TYPES`(7)、`SOURCE_TYPES`(5);validator 校验随之生效(validator 复用常量,无需双改);
2. **skills**(修改入口为 `assets/claude-template/`,非根目录 `.claude/`):
   - knowledge-write:类型枚举说明、frontmatter 规范章节、模板体系重映射(模板与新类型的具体映射由 plan 定);
   - knowledge-init:创建文档所用的类型/来源枚举;
   - 新建迁移 skill(§4.4);
   - plan 阶段对**全部** skill 文本做旧枚举引用排查(knowledge-recall / knowledge-api / export-table-ddl 等,防遗漏);
3. cgraphx web:TYPE_LABELS(7 项)+ STATUS 无变化;§4.3 修订顺序约束;**先修 `2026-07-30-cgraphx-web知识库浏览` spec §3.3 条款**;
4. 《cgraphx2.0重构-spec》:追加兼容性注记(§6.1);
5. CLI `docs show`:行为不变(展示原值),新枚举值自然呈现——无代码变更,列为核对项;
6. 测试基线:`__tests__/core/markdown/` 现有用例中依赖旧枚举值者随枚举换血更新(属本需求变更,非"改测试期望绕过"——枚举契约本身在变),新增新枚举校验用例。

## 8. 异常与边界场景

| 场景 | 期望行为 |
|---|---|
| 未迁移文档(旧值)重建索引 | validator 判非法,索引跳过并计入 skip 统计;不损坏其余文档索引 |
| 文档旧值为同名保留值(decision/rule/lesson/guide/debugging/manual) | 值合法、重索引不 skip;但迁移仍须按新语义复核(值合法 ≠ 归属准确) |
| 迁移后 domains 为空 | 不允许:迁移 skill 必须补填业务域,validator 拦截兜底 |
| 主题不明文档(conversation/note 类) | 迁移时判定:可按主题归类则归;确无主题 → 不迁入知识库(记录剔除清单) |
| 新旧版本 cgraphx 混用同一项目 | 旧版 cgraphx 遇新枚举值:validator 判非法(旧枚举不含新值)→ 旧版重索引 skip 该文档。单向兼容:升级后不回退混用 |
| frontmatter 含未知字段 | 沿用现有行为:保留不校验(本需求不改变) |

## 9. 验收标准与测试关注点

**验收**(业务可观察):

1. validator 接受全部新枚举值(document_type 7 / source_type 5),拒绝全部废除值(13 + 旧 source_type 废除值),错误消息列举合法枚举;
2. `docs` 全部子命令行为回归不变(以现有测试 + 手工抽查为基线,仅枚举内容变化);
3. web 类型过滤渲染新 7 枚举,显示标签与 §3.1 表逐字一致;web spec §3.3 条款已先行修订;
4. hx 61 篇迁移完成:全部通过新枚举 validate(或主题不明剔除且剔除有记录),重建索引无 skip,web 上可按新分类浏览(类型分布不再是 exploration 独大,domains 呈现业务域);
5. 迁移 skill 可在其他项目复用(以 hx 为试金石即证);
6. knowledge-write / knowledge-init skill 文本无旧枚举残留,新枚举说明与 §3 一致;《cgraphx2.0重构-spec》注记已追加。

**测试关注点**:新枚举校验矩阵(7+5 合法 / 废除值非法 / 同名保留值合法);find `--documentType` 新值过滤与废除值空返回;validator 错误消息内容;索引 skip 统计对非法文件的计数;web 类型芯片计数与新枚举一致。

## 10. Plan 编写约束

- **CLI 行为红线**:docs 10 个子命令的行为与输出不变,现有测试为回归基线(枚举内容变更引起的期望更新除外,见 §7-6);
- **索引层零变更**:不改 `markdown_*` 表结构、不改查询实现;
- **validator 通用性**:不得引入任何项目特定枚举校验(domains 不校验即此约束的体现);
- **web 修订顺序**:先修 web 需求 spec §3.3 条款,再改 web 代码;
- **skill 修改入口**:`assets/claude-template/`(随包分发的源),非根目录 `.claude/`(部署产物,可能滞后);
- **六处同发布**:plan 须保证枚举/标签/skill 文本的变更作为一个发布单元,不允许中间态发布;
- **不引入新依赖**(本需求为枚举/文本/skill 变更,无新运行时依赖)。

## 11. 不可留到实现期的决策

1. **document_type 新枚举 7 值**及显示标签(§3.1 表);
2. **废除 13 值**清单与存量映射原则(§3.1);无兜底类型(主题不明不入库);
3. **source_type 新枚举 5 值**、沉淀场景语义、保持必填、存量映射(§3.2);不建设消费点;
4. **domains 业务域语义 + 自由词表 + validator 不校验枚举**(§3.3);
5. **无双轨期**的兼容策略与未迁移文档行为(§6.1);
6. **hx 迁移在需求范围内**,迁移后 domains 非空边界(§6.2 / §6.3);
7. **web spec 先行修订**顺序(§4.3);
8. **六处同步修订同发布**(§7);
9. frontmatter 必填项 7 项名单与数量不变(§3.4)。

## 12. 待确认项

无阻塞项。发布阶段决策(不阻塞 spec/plan):版本号与发布节奏(major/minor)、其他接入项目的通知方式与时机。plan 阶段决策:knowledge-write 模板与新类型映射、迁移 skill 形态(触发词/批量策略/dry-run/抽检)、web 芯片面板呈现细节、validator 错误消息措辞、全 skill 旧枚举排查清单。
