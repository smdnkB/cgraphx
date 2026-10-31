# 规格说明: init-tech-stack 迁移到流程中

> 产物: spec
> feature-id: 2026-10-31-init-tech-stack迁移到流程中
> 负责人: liulongfei
> 日期: 2026-10-31

## 功能方案

**一句话**:把只存在于本机全局的 `/init-tech-stack` 收进 cgraphx 模板,并在流程里给它一个固定位置——新项目先定技术栈(ADR),再立规范、进入需求主链;系统迁移复用它。已有项目的日常需求主链不变。

**业务口径**:无取数口径。

**功能点**

| 编号 | 功能点 | 类别 | 行为链(已锁定) | 边界 | 落地依据 |
|---|---|---|---|---|---|
| F1 | init-tech-stack 进模板并随 install 部署 | 核心 ✅ | 新项目敲 `/init-tech-stack` → 按 12 层逐层给「推荐 + 2–4 个备选相对优劣」→ 分组逐组确认 → 写 `docs/adr/<NNN>-技术栈选型.md` → 停,不自动进 spec/plan/实现 | ① 已有 ADR 编号递增不覆盖 ② 单层咨询只跑该层 ③ 已拍板层不重开 ④ 无 spec 也能跑 ⑤ 适用层不得静默跳过 | 用户级 skill 已存在;模板递归部署;dev-migrate 已按此路径引用;CHANGELOG 2.0.11 已承诺 |
| F2 | 流程落位 | 核心 ✅ | 新项目:`cgraphx install` → `/init-tech-stack` → `/init-guides` → 按需 `/init-ddl` / `/init-knowledge` → 进入需求主链;需求引入新栈:在 `/dev-spec` 前跑,ADR 作为 spec 输入;系统迁移:dev-migrate 引用 | ① 已有技术栈的项目不强制跑 ② 不自动触发 ③ plan 不重开选型 | FLOW-MAP 迁移节已引用;init-guides 依赖技术栈;flow 的「plan 不重开选型」规则 |
| F3 | 导航与起步实践同步 | 支撑 ✅ | `cgraphx-guide/SKILL.md`、`skills.html`、`how-to-use.html`、`README.md` 都能看到 `/init-tech-stack` 的位置、用法、产物;`how-to-use.html` 的 docs 树出现 `docs/adr/` | 只加索引与说明,不复制 skill 正文 | 这些页面当前都没列它 |
| F4 | 仓库文档与知识库同步 | 支撑 ✅ | 根 `CLAUDE.md` 的「31 个 skill」→ 32,skill 主线加「新项目启动(按需)」;`docs/knowledge/skill-invocation轴.md` 追加新段(计数 + 调用类型) | 知识库按 `/knowledge-write` 规则写并过 `cgraphx docs validate`;保留历史段,追加不覆盖 | CLAUDE.md 写死 31;知识条目停在 30 |
| F5 | dev-migrate 引用收口 | 支撑 ✅ | `/dev-migrate` 第 2 步改为「提示用户跑 `/init-tech-stack`」,用户跑完把 ADR 带回来;skill 缺失(旧版本未升级)→ 提示 `cgraphx upgrade`,不静默另起一套 | 不把「提示用户跑」写成可直接调用 | dev-migrate 2.0.11 已有兜底句 |
| F6 | init-guides 读 ADR 自动选模板 | 建议新增 ✂️ | 不做:会改 init-guides 行为,不属于本次迁移;基于其已有技术栈探测能力可支撑,后续需要再单独立项 | — | — |

**边界外排除**

- ① 不改 12 层决策树、基线推荐、ADR 模板内容(选型逻辑单独维护)。
- ② 不自动选型、不搭脚手架、不写业务代码。
- ③ 不动用户全局 `~/.claude/skills/init-tech-stack`;部署后建议用户自己删全局副本(不自动删用户文件)。
- ④ 不把 `docs/adr/` 纳入产物注册表 / 平台上报。
- ⑤ 不改 `init-guides` / `init-ddl` / `init-knowledge` 的既有行为(F6 砍掉后自然满足)。

**体验决策**

- **变体一 A(流程位置)**:FLOW-MAP 新增「新项目启动流程(按需)」一节;guide 阶段表加一行;how-to-use / README 起步实践加第一步;docs 树加 `adr/`。
- **变体二 A(调用方式)**:`init-tech-stack` 设为 **user-invoked**(`disable-model-invocation: true`),与 init-guides / init-ddl / init-knowledge 一致;`dev-migrate` 中断一次,提示用户手敲 `/init-tech-stack`。

## 怎么实现

### 实现依据(已核实的事实)

- 用户级 skill 存在:`~/.claude/skills/init-tech-stack/SKILL.md`(87 行,2026-10-06);`assets/claude-template/skills/` 下没有它。
- `scripts/copy-assets.cjs` 递归拷贝 `assets/claude-template/**` → `dist/.claude-template/**`;`cgraphx install` 按模板目录部署,**新增一个 skill 目录即可随包发布,不改安装器**。
- 模板现有 31 个 skill;根 `CLAUDE.md:24` 写死「共 31 个 skill」。
- `dev-migrate` 第 2 步已写「跑 `/init-tech-stack`」并带「环境里没有 → 临场照做」兜底(`assets/claude-template/skills/dev-migrate/SKILL.md:55`);`FLOW-MAP.md:78` 迁移流程也引用了它。
- CHANGELOG 2.0.11 已写 "The tech stack is settled with `/init-tech-stack`",但包里没有这个 skill——本次补齐发布说明与实际交付的差距。
- `init-guides` 需要技术栈(探测不到会问用户),所以新项目里 `init-tech-stack` 天然在 `init-guides` 之前。
- `docs/adr/` 已被产物注册表 spec 明确排除在登记/上报范围之外(`docs/features/2026-10-18-产物注册表与头部规范/产物注册表与头部规范-spec.md:62`),不需要加注册逻辑。
- `cgraphx-guide/SKILL.md`、`skills.html`、`how-to-use.html`、`README.md` 都没有这个 skill;`how-to-use.html` 的 docs 树也没有 `docs/adr/`。
- 知识库 `docs/knowledge/skill-invocation轴.md` 停在 30 个 skill(22 model + 8 user),未计入 2.0.11 新增的 dev-migrate(model-invoked);加上 dev-migrate 当前实际为 31。
- 《skill invocation 轴》判据:被别的 skill 正文**调用** → model-invoked;只由人敲、或别的 skill 只做**文字推荐** → user-invoked。本次按变体二 A 把 `dev-migrate` 的「跑」改成「提示用户跑」,维持 user-invoked。

### 细节方案:F1 init-tech-stack 进模板

| # | 决策 | 选择 | 没选的(为什么) | 理由(依据) | 影响面 |
|---|---|---|---|---|---|
| D1 | 文件形态 | 单个 `assets/claude-template/skills/init-tech-stack/SKILL.md`,不放 references | 拆 references(决策树/模板/配方)——87 行自包含,拆分只增加维护面;dev-migrate 需要 references 是因为它带配方和脚本 | 原 skill 87 行;init-* 均为单文件 | 模板新增 1 个目录 |
| D2 | 调用方式 | `disable-model-invocation: true`(user-invoked) | model-invoked——与 init-* 不一致,description 常驻上下文;变体二 A 已锁定 | 《skill invocation 轴》;clarify 变体二 A | dev-migrate 改成「提示用户跑」 |
| D3 | 正文结构 | 保留原内容,只重排为 `# 技术栈选型 (init-tech-stack)` + `## 定位` + `## 流程` + `## 决策树(12 层,依赖有序)` + `## 产物模板` + `## 推荐下一步` + `## 红线`;12 层表、基线推荐、各层取舍要点速查、ADR 模板逐字保留 | 重写整份——用户要的是迁移,不是改选型内容;重写会引入行为变化 | 原 skill 内容;仓库 skill 风格 | 无 |
| D4 | 流程位置措辞 | 定位节写:新项目启动在 `/init-guides` 前;需求引入新栈在 `/dev-spec` 前(ADR 作为 spec 输入);系统迁移由 `/dev-migrate` 提示用户跑 | 只写「spec/clarify 的下游」——与现行「plan 不重开选型」冲突 | FLOW-MAP 设计流程/迁移流程;clarify 变体一 A | 与 F2 同源 |
| D5 | 第 6 步收口 | 改成「spec 的设计决策表引用 ADR,不重开选型;新项目尚未写 spec 时,ADR 作为 spec 的输入;没有 spec 则跳过」 | 保留「收口 spec 中『由 plan 选型』项」——现行流程 plan 不选型 | FLOW-MAP;《plan 手段决策三档》 | 与 D4 一致 |
| D6 | ADR 路径与登记 | `docs/adr/<NNN>-技术栈选型.md`;不写 `> 产物:` 头,不进产物注册表/平台上报 | 纳入产物注册表——spec 明确排除 `docs/adr/` | 产物注册表 spec §1.3 | 无 |
| D7 | 推荐下一步 | 新增一节:新项目 → `/init-guides`;需求引入新栈 → `/dev-spec`;迁移 → 回到 `/dev-migrate` 第 3 步;明确不自动跑 | 不写——用户不知道下一步;但 FLOW-MAP 已写 | 仓库 skill 收尾惯例 | 无 |

**内容清单**

- **逐字保留**:12 层决策树表(L1–L12)、基线推荐(2026-10)、各层取舍要点速查、ADR 模板、红线 1–6、单层咨询规则、「前置读取已拍板约束」规则。
- **改写**:frontmatter(`disable-model-invocation: true`;description 去掉「收口 spec 中『由 plan 选型』项」,补流程位置);标题与节标题;定位节补流程位置;第 6 步收口;新增「推荐下一步」。
- **frontmatter description(建议)**:
  `新项目启动技术选型 — 按 12 层决策树(产品形态→语言生态→后端框架→数据库→ORM→缓存→部署形态→前端框架→路由→状态缓存→CSS→工程结构)逐层给推荐+备选优劣对比,分组与用户敲定,产出 docs/adr/ 下的技术栈选型 ADR;新项目在 /init-guides 前跑,需求引入新技术栈时在 /dev-spec 前跑,系统迁移由 /dev-migrate 提示用户跑。Use when 新项目选型/技术选型/选型敲定/技术栈选型/技术栈敲定/选什么数据库/选什么框架/选什么ORM/新项目启动/项目初始化/产品形态选型/生态选型/前后端选型/工程结构怎么定/tech stack/选型.`

### 细节方案:F2 流程落位

| # | 决策 | 选择 | 没选的(为什么) | 理由(依据) | 影响面 |
|---|---|---|---|---|---|
| D8 | FLOW-MAP 新章节位置 | 顶部依赖图之后、`## 设计流程` 之前,新增 `## 新项目启动流程(按需)` | 放在系统迁移流程附近——选型不只服务迁移,新项目更常用 | FLOW-MAP 结构;clarify 变体一 A | FLOW-MAP |
| D9 | 依赖图 | 主链上方加一段启动支线:`新项目启动(按需):/init-tech-stack → /init-guides → /init-ddl / /init-knowledge`,箭头指向 `knowledge-recall` | 只加正文不加图——用户看全图时看不到新流程 | FLOW-MAP 顶部图 | 图是文本,改动小 |
| D10 | 设计流程前置 | 加一句「新项目先走新项目启动流程(技术栈、规范);已有技术栈的项目跳过 `/init-tech-stack`」 | 不加——设计流程读者不知道有前置 | FLOW-MAP 设计流程 | 无 |
| D11 | 迁移流程表述 | 把「定目标(`/init-tech-stack` 出 ADR、模块映射、表映射、全局决策)」拆清楚:提示用户跑 `/init-tech-stack` 出 ADR;模块/表映射、全局决策由 dev-migrate 出 | 保持原句——会让人以为 init-tech-stack 产出模块/表映射 | dev-migrate SKILL 第 2 步 | 与 F5 一致 |

**FLOW-MAP 新章节正文(锁定)**

```markdown
## 新项目启动流程(按需)

- **链**:`cgraphx install` → `/init-tech-stack`(定技术栈,ADR 落 `docs/adr/`)→ `/init-guides`(按 ADR 生成 `docs/guides/` 五份规范)→ 按需 `/init-ddl` / `/init-knowledge` → 进入设计流程
- **前置**:无;需求里引入新技术栈时,在 `/dev-spec` 前跑,ADR 作为 spec 输入;系统迁移由 `/dev-migrate` 提示用户跑
- **产物**:`docs/adr/<NNN>-技术栈选型.md`;后续 `docs/guides/`、`docs/schema-knowledge/`、`docs/knowledge/`
- **边界**:只定选型,不搭脚手架、不写代码;plan 不重开选型;已有技术栈的项目不强制跑
```

### 细节方案:F3 导航与起步实践

| # | 决策 | 选择 | 没选的(为什么) | 理由(依据) | 影响面 |
|---|---|---|---|---|---|
| D12 | cgraphx-guide 阶段表 | 在「项目级 · 每项目一次」行的 `cgraphx install` 后加 `/init-tech-stack`(新项目先定技术栈) | 新起一行——这一行就是项目级一次性动作 | cgraphx-guide 现有表 | 一行 |
| D13 | cgraphx-guide skill 导航 | 在 `/dev-migrate` 行后加 `/init-tech-stack` 一行;文案见下 | 放在 init-guides 旁——按阶段排序,dev-migrate 是调用方,放它附近更易发现 | 现有导航表 | 一行 |
| D14 | skills.html 分组 | 放进「规范与收尾」组(`data-group="wrap"`)顶部,组名/筛选 chip 改为「项目启动与收尾」 | 新开「项目启动」组 + 新 chip——多一个 chip,内容只有 1 个 skill | skills.html 现有分组 | 组名与 chip 文案 |
| D15 | how-to-use 最佳起步实践 | 在「立规范」前加「定技术栈 · `/init-tech-stack`」一步(注明已有技术栈的项目跳过);highlight 改成「先定选型与规范…」 | 只写进 docs 树——起步实践是用户最先看的 | how-to-use 现有 3 步 | 新增 1 步 |
| D16 | how-to-use 工作流全景 + docs 树 | 全景图顶部加「新项目启动 · /init-tech-stack → /init-guides」两行;docs 树加 `adr/` | 只加 docs 树——全景图是流程入口,不标会漏 | how-to-use | 两处 |
| D17 | README | 最佳起步实践加「定技术栈」第 1 步(原 3 步顺延),开头句改「先定选型与规范、再聊业务」;问题表加第 9 行「新项目选型靠拍脑袋」 | 只加起步实践不加问题表——问题表是产品叙事,缺选型叙事不完整 | README 现状 | 两处 |

**导航文案(锁定)**

- cgraphx-guide 阶段表:`cgraphx install` 后加「`/init-tech-stack`(新项目先定技术栈)」,再列 `/init-guides`。
- cgraphx-guide skill 导航行:
  `| /init-tech-stack | 新项目起步选型:按 12 层决策树逐层给推荐与优劣,产出 docs/adr/ 技术栈选型 ADR;系统迁移时由 /dev-migrate 提示用户跑 |`
- skills.html 条目:

```html
<details class="skill" id="init-tech-stack">
<summary><span class="name">/init-tech-stack</span><span class="oneline">新项目先定技术栈,产出 ADR</span><span class="how how-cmd">敲命令</span></summary>
<div class="body"><dl>
<dt>什么时候用</dt><dd>新项目起步;需求里要引入新技术栈;系统迁移定目标时由 <code>/dev-migrate</code> 提示你跑。</dd>
<dt>怎么用</dt><dd>敲 <code>/init-tech-stack</code>,按 12 层逐层看推荐和备选,逐组拍板。</dd>
<dt>要你拍板</dt><dd>每一层选哪个;已拍板的层不重开,只敲定剩下的。</dd>
<dt>产出</dt><dd><code>docs/adr/&lt;NNN&gt;-技术栈选型.md</code>;后续 <code>/init-guides</code> 按它生成规范。</dd>
<dt>前后</dt><dd>新项目在 <code>/init-guides</code> 前;需求引入新栈在 <code>/dev-spec</code> 前;迁移时由 <code>/dev-migrate</code> 提示。</dd>
</dl></div>
</details>
```

- how-to-use 最佳起步实践新增步骤(放在「立规范」前):
  `定技术栈 · /init-tech-stack`:新项目先定技术栈——12 层决策树逐层给推荐 + 备选优劣,产出 `docs/adr/` ADR;已有技术栈的项目跳过。规范、代码、plan 都以它为准,不重开选型。
- how-to-use docs 树:在 `guides/` 附近加 `adr/ 技术栈选型(/init-tech-stack;新项目/换栈时)`。
- README 问题表第 9 行:
  `| 9 | **新项目选型靠拍脑袋**——聊完不落档,下次重聊 | /init-tech-stack 按 12 层决策树逐层定,产出 ADR;后续 spec/plan 不重开选型 |`

### 细节方案:F4 仓库文档与知识库

| # | 决策 | 选择 | 没选的(为什么) | 理由(依据) | 影响面 |
|---|---|---|---|---|---|
| D18 | 根 CLAUDE.md | 「31 个 skill」→ 32;skill 主线加「新项目启动(按需)」bullet | 只改数字——主线不写,读者不知道新流程 | CLAUDE.md:24 | 两处 |
| D19 | 知识库 skill-invocation 轴 | 追加 2026-10-31 新段:32 个;model 23(补记 dev-migrate)、user 9(+init-tech-stack);判据说明;`related_code` 加新路径 | 改旧段——历史更新是决策记录,应保留 | 知识条目结构 | 追加一段 + frontmatter 一行 |
| D20 | 新知识条目 | 不新增(后续按需) | 本次新增——clarify 默认按需,不列入本次功能点 | clarify 结论 | 无 |

**根 CLAUDE.md 新增 bullet(锁定)**

```markdown
- 新项目启动(按需):`/init-tech-stack`(12 层决策树定技术栈,ADR 落 `docs/adr/`)→ `/init-guides` → `/init-ddl` / `/init-knowledge`;换栈/迁移由 `/dev-migrate` 提示用户跑。
```

**知识库追加段(锁定)**

```markdown
## 2026-10-31 更新(新增 init-tech-stack,补记 dev-migrate)

新增 init-tech-stack:新项目启动技术选型,12 层决策树,产出 docs/adr/ 下的 ADR。skill 共 32 个。

- model-invoked 23 个:上一版 22 个 + dev-migrate(2.0.11 新增,前次更新未计入;按自然语言「把这个系统迁到新工程」触发)。
- user-invoked 9 个:上一版 8 个 + init-tech-stack。

判据:init-tech-stack 只有人敲 `/init-tech-stack` 才跑(新项目一次性选型);`dev-migrate` 第 2 步写成「提示用户跑」,是文字推荐不是调用,故保持 user-invoked。
```

`docs/knowledge/skill-invocation轴.md` 的 `related_code` 追加 `assets/claude-template/skills/init-tech-stack/SKILL.md`。

### 细节方案:F5 dev-migrate 引用收口

| # | 决策 | 选择 | 没选的(为什么) | 理由(依据) | 影响面 |
|---|---|---|---|---|---|
| D21 | 第 2 步引用 | 改为「提示用户跑 `/init-tech-stack`;用户跑完把 ADR 带回来」;删除「环境里没有这个 skill → 临场照做」,改成「技能缺失说明版本未升级 → 提示 `cgraphx upgrade` 后重跑」 | 保持可直接调用——变体二 A 已锁定 user-invoked,agent 不能调用 | dev-migrate:55;《skill invocation 轴》 | 改一句 |
| D22 | 迁移流程 FLOW-MAP 表述 | 拆清 init-tech-stack 产出 ADR;模块/表映射、全局决策归 dev-migrate | 保持原句——会误导产出归属 | 见 D11 | 一行 |

**dev-migrate 第 2 步第 1 条(锁定)**

```text
1. **技术栈**:提示用户跑 `/init-tech-stack`(它是 user-invoked,需要用户逐组拍板),用户跑完把 ADR 带回来;用户已定的层(如「语言 Java」「ORM 用 JPA」)作为已拍板约束传进去,只敲定剩下的层,ADR 落新工程 `docs/adr/`。技能缺失说明 cgraphx 版本未升级 → 提示 `cgraphx upgrade` 后重跑,不临场另写一套。
```

### 细节方案:F6(已砍)

不做。保持 `/init-guides` 现有的技术栈探测/追问方式;若以后要把 ADR 作为它的输入,另立需求。

## 全局约束

- **只改模板源与仓库文档**:`assets/claude-template/`、根 `CLAUDE.md`、`README.md`、`docs/knowledge/`;不改已部署的 `.claude/`(gitignore 的运行环境),不改 `src/` 代码、库表、测试断言。
- **不重命名/删除现有 skill**:`deprecated-assets.json` 不加条目;`cgraphx install`/`uninstall` 对现有 skill 的部署与清理规则不变。
- **选型内容零变化**:12 层表、基线推荐、各层取舍要点、ADR 模板逐字保留;只改标题、定位、第 6 步与新增「推荐下一步」。
- **调用方式锁定**:`init-tech-stack` user-invoked;`dev-migrate` 必须写「提示用户跑」,不能写成可直接调用。
- **ADR 不登记**:`docs/adr/` 保持产出目录外的自定义文档,不写 `> 产物:` 头,不进产物注册表/平台上报。
- **日常主链不变**:`/dev-clarify → /dev-spec → /dev-plan → /dev-impl` 的行为、产物、门禁不变;`/dev-migrate` 的清单、切片、对拍/对账、切换清单与产物路径不变。
- **不自动删用户文件**:用户全局 `~/.claude/skills/init-tech-stack` 保持原样;部署后建议用户自己删全局副本。
- **知识库合规**:`docs/knowledge/skill-invocation轴.md` 修改后必须过 `cgraphx docs validate`;保留历史更新段,只在末尾追加。
- **打包可验证**:`npm run build` 后 `dist/.claude-template/skills/init-tech-stack/SKILL.md` 必须存在(证明随包分发)。

## 设计验收

| # | 对应 | 验收点 | 怎么验 |
|---|---|---|---|
| 1 | F1 | 模板 skill 数量 32;新 skill 目录存在;frontmatter 有 `disable-model-invocation: true` | `ls assets/claude-template/skills` 数出 32 个目录;`grep` |
| 2 | F1/D3 | 12 层表、基线推荐、取舍要点、ADR 模板与用户级原文件逐字一致(除标题/定位/第 6 步/推荐下一步) | 与 `~/.claude/skills/init-tech-stack/SKILL.md` 对照 diff |
| 3 | F2 | FLOW-MAP 有「新项目启动流程(按需)」;设计流程前置、迁移流程、顶部依赖图都指向它;正文含「plan 不重开选型」 | `grep -n` + 人工读 |
| 4 | F3 | cgraphx-guide、skills.html、how-to-use、README 都能搜到 `/init-tech-stack`;docs 树有 `adr/`;skills.html 组名/chip 为「项目启动与收尾」 | `grep` + 打开页面 |
| 5 | F4 | 根 CLAUDE.md 写 32;知识库写 23 model + 9 user;`cgraphx docs validate` 通过 | `grep` + `cgraphx docs validate` |
| 6 | F5 | dev-migrate 第 2 步是「提示用户跑」;缺失时提示 `cgraphx upgrade`;不再有「临场照做」 | `grep` |
| 7 | 全局 | `src/`、已部署 `.claude/`、其他 skill 无改动;`deprecated-assets.json` 无新增 | `git diff --stat` |
| 8 | 全局 | 构建产物含新 skill | `npm run build` 后 `test -f dist/.claude-template/skills/init-tech-stack/SKILL.md` |

## 待确认项

- 无。
