# Plan: skill 流程新增「UI 功能测试」环节

> feature-id: 2026-08-23-ui功能测试
> 负责人: liulongfei
> 日期: 2026-08-24
> 来源: `../ui功能测试-spec.md`(11 条锁定决策 + S1-S4 规格,无待确认项)

## 目标与范围

把 spec 的四块范围落成可执行任务:

1. **T-1** `src/core/features/scanner.ts` 阶段派生扩展 + 测试(唯一代码改动)
2. **T-2** 新 skill `write-ui-test`(SKILL.md + references)
3. **T-3** 新 skill `run-ui-test`(SKILL.md + references)
4. **T-4** `FLOW-MAP.md` 增节 + 接口测试节补推荐顺序

## 明确不包含

- 不改既有 skill(write-api / run-api-test / 单元测试系列 / cgraphx-guide 等)——cgraphx-guide 的 skill 清单/流程图不含新环节,接受该滞后,如需更新另起需求
- 不动 installer(`src/cli/installer/`)、不写 .mcp.json、不动 `deprecated-assets.json`
- 不改 `scripts/copy-assets.cjs`(它递归 walk `assets/claude-template/**`,新 skill 目录自动随包)
- 不新增 guides 文件;不引入 Playwright 相关 npm 依赖(浏览器操作走目标项目的 Playwright MCP,不是 cgraphx 的能力)
- 不排独立测试任务(单元测试是代码完成后独立流程);spec 要求的 scanner 测试扩展并入 T-1(代码任务的随附交付物,非独立测试任务);其余改动不弄红既有测试

## 计划文件清单

| 文件 | 状态 |
|---|---|
| `ui功能测试-index.md`(本文件) | ✅ 全部任务在此 |
| `-01-schema` | 不涉及(无表) |
| `-02-backend` | 不涉及(scanner 改动小,并入 index) |
| `-03-frontend` | 不涉及 |

## 总任务清单

| 任务 | 内容 | 对应 spec 条款 | 独立提交 |
|---|---|---|---|
| T-1 | deriveStage 识别 UI 功能测试报告 + 测试 | S4、锁定决策 11、验收 7 | 是 |
| T-2 | write-ui-test skill | S1、S3、锁定决策 1-4、验收 1 | 是 |
| T-3 | run-ui-test skill | S2、S3、锁定决策 4-10、验收 2-6 | 是 |
| T-4 | FLOW-MAP 增节 | 范围 2、验收 8 | 是 |

## 全局依赖图

**任务间无依赖**:四个任务文件集不相交,共享契约已在「必须严格执行的契约」节写死原文,每个任务自包含。

```text
T-1 (scanner.ts)    T-2 (write-ui-test)    T-3 (run-ui-test)    T-4 (FLOW-MAP)
     独立                独立                    独立                 独立
```

T-3 的 SKILL.md 引用 T-2 的产物名——引用所需的契约原文已分别写入两个任务(不依赖 T-2 先完成)。

## 推荐执行顺序与并行批次

- 顺序(单人串行时):T-1 → T-2 → T-3 → T-4(先代码后文案)
- **并行批次**:四任务文件集互不重叠,可一批全派;T-2、T-3、T-4 同为 `assets/claude-template/` 文案,若只派一个 implementer 做这三个,风格更一致。**注意**:T-2/T-3 的验证命令 `node scripts/copy-assets.cjs` 会先清空再整体重拷 `dist/.claude-template/`,并行时该验证步骤须串行执行(或两个 skill 都落盘后统一跑一次)

## 必须严格执行的契约(跨任务共享,逐字一致)

**命名契约**(T-2 输出 = T-3 输入 = T-4 文中引用 = T-1 识别对象):

- skill 名:`write-ui-test` / `run-ui-test`(目录 `assets/claude-template/skills/<名>/`)
- 产物目录:`docs/features/<feature-id>/ui功能测试/`
- 用例规格:`<文件前缀>-ui功能测试-spec.md`;测试报告:`<文件前缀>-ui功能测试报告.md`
- feature-id / 文件前缀算法复用既有规则(同 write-api / run-api-test):feature-id `YYYY-MM-DD-[业务ID-]<标题>`;前缀 = 有业务ID `<业务ID>-<标题>` / 无 `<标题>`;文件名不得含 `/ \ : * ? " < > |`
- 截图存产物目录,**按功能点命名**:`<功能点名>.png`,同功能点多张追加 `-2` / `-3` 数字后缀;功能点名遵循同样的敏感字符约束

**用例五要素**(T-2 产出、T-3 消费):每条用例含 功能点名 / 操作步骤(自然语言) / 预期表现 / 数据前提 / 登录账号(无需登录则标「无需登录」)

**状态枚举**(T-3 报告专用):`通过` / `失败-预期不符` / `失败-元素缺失` / `失败-环境`(服务中途挂/浏览器异常) / `失败-登录` / `跳过`

**分工边界**:write-ui-test 不碰浏览器;run-ui-test 不派生用例、不改用例;两者都不验 DB、不修代码、不自动重跑;报告归用户触发时指定的需求目录

## 实现手段决策(plan 自主项,均无 spec 信封外业务可观察后果)

| 决策 | 选项 | 定案 | 理由 |
|---|---|---|---|
| skill 文件组织 | SKILL.md 单文件 / SKILL.md + references | SKILL.md + 1 个 references(格式规范),报告骨架内联在 references,不建单独 assets 模板文件 | 对齐 write-api/run-api-test 形态;骨架内联 = 直接展示最好案例,少一层文件 |
| 截图命名格式 | 功能点名 / 功能点名+步骤 | `<功能点名>.png`,多张追加数字后缀 | spec 只锁「按功能点命名」;一用例默认一截图(预期验证点) |
| 入口 URL | 执行时每次给 / 记入用例 | write-ui-test 记入用例规格(未知留【需用户填写】);run-ui-test 默认读、允许触发时覆盖 | 满足 spec「明确获得、不隐式假设」;记录降低重跑成本 |
| 报告是否带 JSONL | 带 / 不带 | 不带 | JSONL 在接口测试中承载 DB 核实记录供下游程序化;UI 测试不验库,无消费方——YAGNI |
| scanner 实现 | 扩展现有 some 条件 / 新增子目录探测 | 新增「探测 `ui功能测试/` 子目录」的独立函数,并入 hasReport 判断 | 顶层 readdir 天然看不到子目录内容;独立函数最小侵入、不动优先级 |
| MCP 可用性校验 | 跑命令探测 / agent 会话内判断 | run-ui-test 前置步骤由 agent 判断当前会话是否有 playwright MCP 工具,缺失输出 `claude mcp add playwright npx @playwright/mcp@latest` 指引 | 不写死工具名(各宿主/版本名不同);skill 文案可执行即可 |

**回跳项**:无(无需业务补契约)。

## 适用规范

| 规范 | 读点 | 标注任务 |
|---|---|---|
| `docs/guides/coding-standards.md` | 边界与结构 / 选型(注释中文) / 错误与日志 | T-1(唯一 TS 代码任务) |
| `docs/guides/git-standards.md` | 全文——已结晶进下方「提交规范」节 | 全部「独立提交」任务(不再现场读) |
| `data-standards.md` / `interface-standards.md` / `testing-standards.md` | 不涉及(无 schema / 无接口 / 测试规范单测向不入 plan) | 无 |

T-2/T-3/T-4 为 skill 文案/流程图任务,guides 无适用条目(编码规范约束 TS 代码);写法对齐仓库既有 skill 形态(模仿 write-api / run-api-test 的章节骨架)。

## 提交规范(结晶自 git-standards.md,实施期据此提交,门禁仅兜底)

**消息格式**:`type(scope): 中文描述`(Conventional Commits + 中文)

- type:feat / docs;本需求 scope:`features`(T-1)/ `skills`(T-2/T-3/T-4)
- 补充说明用「——」;无票据关联(追踪走 `docs/features/`)
- body:背景一行 + 「-」列要点;琐碎可只留 subject

**提交前检查点**(逐项对照 `git diff --cached`):

- 与 TS 同放的运行时资产未登记 `scripts/copy-assets.cjs`(本需求新 skill 在 `assets/claude-template/` 下,已被递归 walk 覆盖,无需登记——确认没引入别的散资产)
- `src/core` 出现对 `src/cli` / `src/web` 的 import
- 写死的魔法值(绝对路径/密钥/阈值)进源码
- 新增 TODO / FIXME 随提交入库

---

## T-1: deriveStage 识别 UI 功能测试报告

- **目标**:`ui功能测试/` 子目录下存在 `-ui功能测试报告.md` 的需求,阶段派生为「已验证」;其余阶段识别与优先级不变
- **对应 spec 条款**:S4、锁定决策 11、验收 7(有疑问读 spec 原文)
- **强制引用**:`docs/guides/coding-standards.md`
- **依赖**:无
- **涉及范围**:`src/core/features/scanner.ts`、`__tests__/core/features/scanner.test.ts`
- **必须严格执行**:
  - 新增独立函数探测 `path.join(featureDir, 'ui功能测试')` 子目录:目录可读且其中存在 `endsWith('-ui功能测试报告.md')` 的文件 → 命中;目录不存在/不可读 → 不命中(容错同 `hasPlanIndex` 模式,不抛错)
  - 命中并入「已验证」判断:与现有三个顶层后缀判断(单元测试/接口测试/旧名)是「或」关系;优先级顺序(已验证 > 已规划 > 已规格)不动
  - 不改动顶层三个后缀的判断、不动 `hasPlanIndex` / spec 探测 / `findMetaFile`
  - `deriveStage` 的 doc 注释同步更新:「已验证」探测来源补一句 run-ui-test 的 `ui功能测试/*-ui功能测试报告.md`(注释中文)
  - 测试扩展(沿用 `mkFeature` fixture 模式):
    - `mkFeature` opts 增加产 UI 报告与 UI 用例规格的能力:建 `ui功能测试/` 子目录写 `${name}-ui功能测试报告.md` / `${name}-ui功能测试-spec.md`
    - 新用例:① spec + UI 报告(无 plan)→ 已验证;② spec + UI 报告 + plan → 已验证;③ 仅 UI 用例规格无报告 → 保持 已规格(规格 ≠ 验证);④ `ui功能测试/` 空目录 → 不影响阶段
    - 既有用例全部保持原断言(存量识别不回退)
- **允许局部适配**:辅助函数命名、测试用例措辞与分组位置
- **完成条件**:类型检查过、测试全绿、注释与实现一致
- **验证方式**:`npx tsc --noEmit` 通过;`npx vitest run __tests__/core/features/scanner.test.ts` 全绿
- **独立提交**:是——完成后仓库可工作(纯加法式识别)。粒度:单提交;主题:`feat(features): deriveStage 识别 UI功能测试报告——已验证派生扩展`
- **风险/注意事项**:严格 TS + `noUncheckedIndexedAccess`,readdir 结果访问按现有代码模式处理;子目录名 `ui功能测试` 与 skill 产物约定逐字一致(契约节),不得写成英文目录名

## T-2: write-ui-test skill(用例派生)

- **目标**:新建 `assets/claude-template/skills/write-ui-test/`,从需求 spec 派生 UI 功能测试用例规格,不碰浏览器
- **对应 spec 条款**:S1、S3、锁定决策 1-3、验收 1
- **强制引用**:无(文案任务;形态模仿 write-api,章节骨架见下)
- **依赖**:无(命名契约原文见 index「必须严格执行的契约」节)
- **涉及范围**:`assets/claude-template/skills/write-ui-test/SKILL.md`、`assets/claude-template/skills/write-ui-test/references/用例规格-format.md`
- **必须严格执行**:
  - SKILL.md frontmatter:`name: write-ui-test`;description 含 Use when 触发词(写 UI 功能测试用例 / 生成界面测试用例 / write-ui-test),并写明「不碰浏览器、不执行、不出报告——那是 /run-ui-test 的职责」
  - 章节骨架对齐 write-api:定位 / HARD-GATE / Trigger / 与既有 skill 边界 / 依赖 / feature-id 与文件前缀规则 / 工作流 / 异常速查 / 质量检查 / 收尾
  - HARD-GATE 必含:不碰浏览器;不编造 spec 中没有的功能点;用例清单未经用户确认不落盘;不重新定义 spec 已锁定的业务规则
  - 工作流三步:
    - U1 确认需求与功能点范围:读 `docs/features/<feature-id>/<文件前缀>-spec.md` 的功能点/验收标准;无可派生功能点 → 报错退出,不产空产物;**功能点清单必须显示给用户确认**
    - U2 派生用例:一功能点一用例;每条含契约节「用例五要素」;登录账号未知 → 留【待用户填写】;入口 URL 记入用例规格 §1 概览,未知留【需用户填写】
    - U3 确认落盘:用例清单显示给用户确认 → 落盘 `docs/features/<feature-id>/ui功能测试/<文件前缀>-ui功能测试-spec.md`
  - 异常:需求 spec 缺失 → 报错退出;同需求重复触发 → 覆盖已有用例规格(数据从当前需求 spec 重新派生)
  - 收尾:提示下一步跑 `/run-ui-test`;不主动调下游、不写 knowledge、不改 spec
  - `references/用例规格-format.md`:用例规格文档骨架——§1 概览(来源需求/功能点数/入口 URL) §2 用例(一功能点一小节:五要素齐全,给一个完整的最好案例) §3 数据前提清单(汇总各用例数据前提,供 run 前人工核对) §4 登录说明(账号来源/填写位)
- **允许局部适配**:章节内措辞、最好案例的选取、U 步骤的子项组织
- **完成条件**:两文件落盘;frontmatter 合法;HARD-GATE 覆盖全部 spec 约束;骨架与 write-api 同构
- **验证方式**:Read 两文件自查质量检查节;`node scripts/copy-assets.cjs` 后 `dist/.claude-template/skills/write-ui-test/` 存在
- **独立提交**:是——纯新增文案,仓库可工作。主题:`feat(skills): write-ui-test——从 spec 派生 UI 功能测试用例`
- **风险/注意事项**:产物路径/文件名与契约节逐字一致(勿写 `-ui测试-` 等变体);截图命名约定写入用例规格 §1(供 T-3 消费)

## T-3: run-ui-test skill(执行与报告)

- **目标**:新建 `assets/claude-template/skills/run-ui-test/`,按用例规格驱动浏览器执行、截图、出报告
- **对应 spec 条款**:S2、S3、锁定决策 4-10、验收 2-6
- **强制引用**:无(文案任务;形态模仿 run-api-test)
- **依赖**:无(消费 T-2 产物,契约原文见 index「必须严格执行的契约」节,不依赖 T-2 执行先后)
- **涉及范围**:`assets/claude-template/skills/run-ui-test/SKILL.md`、`assets/claude-template/skills/run-ui-test/references/report-format.md`
- **必须严格执行**:
  - SKILL.md frontmatter:`name: run-ui-test`;description 含 Use when(跑 UI 功能测试 / 界面上验一下需求 / run-ui-test;write-ui-test 跑完后执行),写明「不派生用例、不验库、不修代码、不自动重跑」
  - 章节骨架对齐 run-api-test:定位 / HARD-GATE / Trigger / 与既有 skill 边界 / 依赖 / feature-id 与文件前缀规则 / 触发逻辑 / 工作流 / 异常速查 / 质量检查 / 收尾
  - HARD-GATE 必含:不验 DB(写操作也只验 UI 表现);不修代码、不改用例、不自动重跑,失败交用户;MCP 缺失不盲跑;数据前提未备齐不跑;报告归用户指定需求目录
  - 触发逻辑照 run-api-test 模式:指定需求 → 读该需求 `docs/features/<feature-id>/ui功能测试/<文件前缀>-ui功能测试-spec.md`;未指定 → 主动问;锁定 feature-id 后显示测试范围给用户确认
  - 工作流六步(顺序固定):
    - R0 MCP 就绪:确认当前会话有 playwright MCP 工具可用;缺失 → 输出安装命令 `claude mcp add playwright npx @playwright/mcp@latest` 提示人工安装,退出;不替目标项目写配置
    - R1 锁定需求与用例范围(触发逻辑 + 用例清单用户确认)
    - R2 执行参数:人工指定 headed / 无头;入口 URL 默认读用例规格记录值,用户可在触发时覆盖;两者缺一 → 向用户要,不隐式假设
    - R3 就绪确认:服务已启动(人工,本地或测试环境)+ 用例规格数据前提清单逐项备齐——两项暂停请用户确认,任一不满足不执行
    - R4 登录:agent 用用例记录的登录账号自己登录;验证码/SSO 卡住 → 暂停请人工介入
    - R5 逐用例执行:按操作步骤驱动页面 → 验证预期表现 → 预期验证点截图存 `ui功能测试/<功能点名>.png`(多张追加 `-2`/`-3`);单用例失败记状态继续下一条,不阻塞
    - R6 出报告:`<文件前缀>-ui功能测试报告.md` 落产物目录;同需求重复触发 → 覆盖,不增量合并
  - 状态枚举用契约节六个值;失败原因分类对应:失败-预期不符(疑似功能 bug)/ 失败-元素缺失(页面结构不符或定位失败)/ 失败-环境(服务中途不可用/浏览器异常)/ 失败-登录
  - 收尾:报告位置 + 通过/失败汇总 + 失败清单与分类 + 下一步建议(失败 → `/implementation` 修后重跑;用例写错 → 走 `/write-ui-test` 重新派生);不主动调下游、不写 knowledge、不改用例
  - `references/report-format.md`:报告骨架——§1 汇总(总用例/通过/失败/跳过/通过率) §2 逐用例结果(功能点/步骤/预期/实际/截图引用/状态,失败用例必须详细) §3 失败汇总(按状态枚举聚合) §4 下一步建议 §5 产物清单(用例规格+报告+截图);含一个最好案例片段
- **允许局部适配**:章节内措辞、R 步骤子项组织、案例片段选取
- **完成条件**:两文件落盘;HARD-GATE 覆盖全部 spec 约束;异常速查表覆盖 spec S2 全部七类场景
- **验证方式**:Read 两文件对照 spec S2 异常速查表逐行自查;`node scripts/copy-assets.cjs` 后 `dist/.claude-template/skills/run-ui-test/` 存在
- **独立提交**:是——纯新增文案。主题:`feat(skills): run-ui-test——Playwright MCP 驱动的 UI 功能测试 + 报告`
- **风险/注意事项**:不写死 playwright MCP 具体工具名(各宿主/版本不同,skill 只描述「playwright MCP 工具」);截图文件名敏感字符约束与契约节一致

## T-4: FLOW-MAP 增节

- **目标**:流程全图纳入 UI 功能测试环节
- **对应 spec 条款**:范围 2、验收 8、兼容性节(接口测试节补推荐顺序)
- **强制引用**:无
- **依赖**:无(引用的两个 skill 名按契约节原文)
- **涉及范围**:`assets/claude-template/FLOW-MAP.md`
- **必须严格执行**:
  - 「接口测试流程」节末尾加一行:`**后续**:接口通过后推荐跑 `/write-ui-test` → `/run-ui-test`(UI 功能测试,非硬前置)`
  - 紧随「接口测试流程」节新增:
    ```markdown
    ## UI 功能测试流程

    - **链**:`/write-ui-test`(从 spec 派生用例,一功能点一用例)→ `/run-ui-test`(Playwright MCP 驱动浏览器执行 + 截图 + 报告;**不验库,只看 UI 表现**)
    - **前置**:spec + 实现完成 + 目标项目已装 Playwright MCP;推荐在接口测试后跑(非硬前置);服务启动 / 测试数据 / headed 与否归人工
    - **产物**:`docs/features/<feature-id>/ui功能测试/`(用例规格 + 报告 + 按功能点命名的截图)
    ```
  - 「依赖总览」ASCII 图纳入 UI 功能测试链(接口测试支线之下,保持对齐风格)
- **允许局部适配**:ASCII 图的具体排版
- **完成条件**:三处改动到位;既有各节文字不被误改
- **验证方式**:Read FLOW-MAP 全文,确认新节存在、接口测试节有后续行、总览图含 `/write-ui-test` → `/run-ui-test`、其余节未动
- **独立提交**:是。主题:`docs(skills): FLOW-MAP 增加 UI 功能测试流程节`
- **风险/注意事项**:ASCII 图等宽对齐易错,改完全图通读一遍

---

## 允许局部工程适配的范围

各任务「允许局部适配」所列 + 任务内未钉死的措辞/组织细节。**未列入允许的一律固定**(尤其契约节的命名、枚举、步骤顺序、HARD-GATE 清单)。

## Plan 冲突上报规则

implementer 发现 plan 与 spec 冲突 → 停下来按 PLAN_CONFLICT 上报,不自行解释;发现 plan 内跨任务契约不一致 → 以 index「必须严格执行的契约」节原文为准。

## 关键风险与防跑偏约束

| 风险 | 约束 |
|---|---|
| 新 skill 形态漂移(写成文档而不是可执行流程) | T-2/T-3 章节骨架钉死对齐 write-api / run-api-test;质量检查节自检 |
| 产物命名变体(`-ui测试-` / 英文目录名) | 契约节命名逐字一致;T-1 识别逻辑与契约节同名 |
| scanner 改动破坏存量识别 | T-1 完成条件要求既有用例全绿;只加不改 |
| implementer 顺手改 cgraphx-guide / installer | 「明确不包含」节点名;收尾不扩范围 |
| skill 写死 playwright MCP 工具名 | T-3 风险节明示只描述能力不写死名称 |

## 待确认项

无。

## 执行方式建议

**`/implementation`**(单 agent 直接做):4 任务 / 约 7 文件 / 两个域(features TS + claude-template 文案),单上下文装得下,任务间无依赖无需隔离派任;不满足 subagent-implement 门槛(文件数 <10、独立模块 <3)。
