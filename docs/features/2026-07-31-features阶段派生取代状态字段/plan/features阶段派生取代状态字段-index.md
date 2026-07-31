# 实现计划: features 阶段派生取代状态字段
> feature-id: 2026-07-31-features阶段派生取代状态字段
> 状态: 已确认
> 负责人: liulongfei
> 日期: 2026-07-31
> 来源 spec: 同目录 `features阶段派生取代状态字段-spec.md`(阶段枚举与派生口径 / 系统行为 / 兼容性 / 验收)

## 目标与范围

把 `cgraphx features` 的「需求阶段」从手填头部 `> 状态:` 改为**从 `docs/features/<id>/` 产物存在性实时派生**(已规格/已规划/已验证),并同步 `write-spec`/`write-plan` skill 头部约定。

包含:
- `src/core/features/`(types/scanner/index/cli/sync):阶段派生、展示列、`--stage` 过滤、my-features.md 列、对外记录字段。
- `__tests__/core/features/scanner.test.ts`:断言迁移 + 阶段派生组合用例。
- `CHANGELOG.md`:Breaking 记录。
- `assets/claude-template/skills/write-spec/SKILL.md`、`write-plan/SKILL.md`:头部去 `> 状态:`。

## 明确不包含

- 不设「已实现/已交付」阶段;不引 git/timeline 信号。
- 不做状态生命周期/回写。
- 不改写存量文档 `> 状态:` 行。
- 不动 负责人/日期 解析与 `--mine`;不动 docs/db/timeline;不动 src/web(features 无 web 面)。
- 不留 `--status` 过渡别名(spec 已锁定)。

## 计划文件清单

| 文件 | 状态 |
|---|---|
| `features阶段派生取代状态字段-index.md` | 本文件(含全部任务) |
| `-01-schema.md` | 不涉及(无 DB/无 schema) |
| `-02-backend.md` | 并入 index(单子系统,任务集中) |
| `-03-frontend.md` | 不涉及(features 无前端) |
| `-04-test.md` | 并入 index(测试依规范并入实现任务) |

## 总任务清单

| 任务 | 内容 | 对应 spec 条款 | 独立提交 |
|---|---|---|---|
| T1 | features 阶段派生全栈(types/scanner/index/cli/sync)+ 测试 + CHANGELOG | §阶段枚举与派生口径 · §系统行为 · §数据状态与口径 · §接口边界 · §兼容性 · §异常与边界 · §验收 | 是 |
| T2 | write-spec / write-plan skill 头部去 `> 状态:` | §系统行为(skill 头部约定)· §兼容性(新文档不再产生状态) | 是 |

## 全局依赖图

T1 与 T2 **互不依赖**,文件集不相交(T1 = `src/`+`__tests__/`+`CHANGELOG.md`;T2 = `assets/claude-template/skills/`),无共享契约需同文。逻辑上建议先 T1(程序忽略状态)后 T2(skill 停写状态),但并行无冲突。

## 推荐执行顺序 / 可并行批次

- 批次 1(可并行):**{T1, T2}**——文件集不相交、验证状态互不染(T1 跑 vitest/build;T2 仅 grep/build)。

## 必须严格执行的契约(plan 级,跨任务)

1. 阶段枚举与派生口径**以 spec §阶段枚举与派生口径 为准**:已验证 > 已规划 > 已规格;各里程碑独立探测、允许跨阶;已验证 = 测试**报告**存在(非规格)且不含「通过」语义;无可识别产物 → null(展示 `-`)。
2. 负责人/日期 解析与 `--mine` 行为**不变**。
3. `--status` 直接移除,**不留别名**;`--stage` 精确匹配派生阶段。
4. 分层:`src/core/features` 不得依赖 `src/cli`/`src/web`;外部经门面 `index.ts`(coding-standards §边界与结构)。
5. 阶段类型用 `as const` 数组 + 联合类型,**不用 TS enum**(coding-standards §选型)。
6. 测试:真实栈不用 `vi.mock`、`fs.mkdtempSync` 临时目录 + afterEach 清理、describe/it **英文**、spec 派生项标注章节号(testing-standards §Mock 政策 / §测试描述);不得改 `vitest.config.ts` 的 `TZ=UTC`。
7. 新代码注释中文(coding-standards §选型)。
8. **删除 `FeatureEntry.source`** 字段(用户拍板):scanner 不再产出/返回 source,`findMetaFile` 简化为返回元数据文件路径或 null。

## 已锁定的实现手段决策

| 议题 | 选项 | 结论 + 理由 |
|---|---|---|
| 阶段类型表示 | (a) `stage: FeatureStage \| null`(null=未规格,显示 `-`);(b) TS enum/数值 | **(a)**:与既有 owner/status 的 null 约定一致,展示与过滤同值;依规范不用 enum |
| 已验证检测 | (a) 顶层文件名后缀匹配;(b) 读报告内容判成败 | **(a)**:与 skill 产物命名契约一致、便宜;(b) 贵且阶段不含通过语义,否决 |
| 已验证后缀契约 | — | 文件名以 `-单元测试报告.md` 或 `-测试报告.md` 结尾(两者都算;`-单元测试报告.md` 不以 `-测试报告.md` 结尾,故两后缀都要) |
| `source` 字段去留 | (a) 保留;(b) 删除 | **(b) 删除**(用户拍板):只写不读、仅 `--json` 外露、无消费方,「无头部」已由 `owner=null` 自证;本次本就 breaking,顺带删无额外兼容成本 |
| 派生与 findMetaFile 关系 | (a) 独立产物探测;(b) 复用 findMetaFile | **(a)**:findMetaFile 是 spec 优先短路,无法独立判 plan/report;独立探测(读顶层条目一次) |
| `--status` 移除 | (a) 直接删;(b) 留别名 | **(a)**:spec 已锁定不留别名 |

## 适用规范(文件 + 章节标题)

- `coding-standards.md`:「边界与结构」「选型」「错误与日志」(T1)
- `testing-standards.md`:「时区」「Mock 政策与隔离」「测试描述」(T1)
- `git-standards.md`:「提交消息规范」「提交前检查点」→ 已结晶进下方「提交规范」节(plan 级一次)
- `data-standards.md` / `interface-standards.md`:不涉及(无 schema、无 API 接口)

## 提交规范(从 git-standards.md 结晶)

- 格式:`type(scope): 中文描述`(Conventional Commits + 中文)。type ∈ feat/refactor/fix/docs;scope 常用 skills/installer,仓库级改动省 scope。
- 「——」补充说明、「+」并列、「→」数值对比;**无票据关联**(需求追踪走 docs/features/)。
- body:非琐碎提交写 body——背景一行(问题/动机)+「-」列要点;琐碎可只留 subject。
- **无 Co-Authored-By 尾行**(git-standards 已移除该约定)。
- 提交前检查点(逐条自查):① 与 TS 同放的运行时资产须登记 `scripts/copy-assets.cjs`(本需求 skills 经既有 `.claude-template` 整体拷贝,无新登记);② `src/core` 不得 import `src/cli`/`src/web`;③ schema.sql 须 `IF NOT EXISTS`(本需求无 schema);④ timeline hook 未 await/抛错不吞(本需求不涉及);⑤ `vitest.config.ts` 的 `TZ=UTC` 不得改;⑥ 无被注释掉的命令注册/hook 接入;⑦ 不写死魔法值(绝对路径/密钥/阈值/版本号);⑧ 新增 TODO/FIXME 须转任务、不入库。

## 允许局部工程适配的范围

- T1:`deriveStage` 内部如何复用一次 `readdir`、helper 命名与拆分、测试 fixture 具体文件名(满足后缀契约即可)。
- T2:skill 中「阶段由 features 派生」补充说明的具体措辞。
- 未列入上述「必须严格执行」与「已锁定手段」的实现细节,implementer 可局部适配;凡 spec 口径/字段名/CLI 面/分层/枚举形态均不得改。

## Plan 冲突上报规则

任务执行中发现 plan 与 spec 冲突、或手段产生 spec 信封外的业务可观察后果 → 按 `PLAN_CONFLICT` 上报主 agent,不自行重新定义 spec;局部工程适配在允许范围内自行处理。

## 关键风险与防跑偏约束

- **FeatureEntry/FeatureFilter 是对外类型**:改 `status`→`stage` 是 breaking。开工先 `grep -rn "\.status\|status:" src/ __tests__/` 确认引用仅在 features 子系统内(预期:`src/core/features/*` + `scanner.test.ts`),无外部消费者漏改。
- **`-测试报告.md` 后缀歧义**:已验证须同时匹配 `-单元测试报告.md` 与 `-测试报告.md`(前者不以 `-测试报告.md` 结尾);勿只写一个后缀漏掉单测报告。
- **不扩范围**:不动 负责人/日期/--mine、不动 docs/db/timeline、不引 git/timeline 信号判阶段、不加「已实现」阶段。
- 测试描述须英文(与代码注释中文约定有意不同),勿混。

## 待确认项

- 无。「source 字段去留」用户已拍板**删除**(见手段决策);「--status 别名」spec 已锁定不留。

---

## T1: features 阶段派生全栈(代码 + 测试 + CHANGELOG)

- 目标: features 子系统以派生阶段取代手填状态(展示列、过滤、个人索引、对外记录、测试)。
- 对应 spec 条款: §阶段枚举与派生口径 · §系统行为 · §数据状态与口径 · §接口页面与系统边界 · §兼容性迁移与存量数据 · §异常与边界场景 · §验收标准与测试关注点(implementer 读 spec 原文,不凭此转述猜)。
- 强制引用: `coding-standards.md`(边界与结构 / 选型 / 错误与日志)、`testing-standards.md`(时区 / Mock 政策与隔离 / 测试描述)。
- 依赖: 无。
- 涉及范围: `src/core/features/types.ts`、`scanner.ts`、`index.ts`、`cli.ts`、`sync.ts`;`__tests__/core/features/scanner.test.ts`;`CHANGELOG.md`。
- 必须严格执行:
  - **types.ts**
    - 新增 `export const FEATURE_STAGES = ['已规格', '已规划', '已验证'] as const;` 与 `export type FeatureStage = (typeof FEATURE_STAGES)[number];`(`as const`+联合,不用 enum)。
    - `FeatureEntry`:删除 `status: string | null` **与 `source: 'spec' | 'plan' | 'directory'`**;新增 `stage: FeatureStage | null`(null = 未规格);保留 featureId/date/title/owner/path 及其注释。
    - `FeatureFilter`:删除 `status?: string`;新增 `stage?: string`(阶段精确匹配)。
  - **scanner.ts**
    - `readHeaderMeta`:正则去「状态」分支 → `/^>\s*(负责人|日期)\s*[:：]\s*(.+?)\s*$/`;`HeaderMeta` 删 `status`;不再读状态(负责人/日期 不变)。
    - 新增产物探测 + 阶段派生(读 feature 目录顶层条目一次):
      - hasSpec = 顶层存在 `*-spec.md` 或 `spec.md`;
      - hasPlan = `plan/` 子目录存在且含 `*-index.md` 或 `index.md`;
      - hasReport(已验证)= 顶层存在文件名以 `-单元测试报告.md` 或 `-测试报告.md` 结尾;
      - `deriveStage` = hasReport → `'已验证'`;否则 hasPlan → `'已规划'`;否则 hasSpec → `'已规格'`;否则 `null`。
    - `findMetaFile`:不再返回 `source`(其唯一消费点 entry.source 已删),简化为返回元数据文件路径或 `null`(spec→plan/index 优先级不变,仅供读 owner/date)。
    - `scanFeatures`:entry 的 `stage` 由 `deriveStage` 填(不再填 status、不含 source);owner/date 仍取自头部。
    - 文件头部注释里的 `> 状态: 草稿` 示例行删除(头部示例改为 feature-id/负责人/日期)。
  - **index.ts**:`filterFeatures` 改用 `filter.stage`——`if (filter.stage !== undefined && (e.stage ?? '') !== filter.stage) return false;`(null 阶段不命中任何 `--stage` 值);注释 status→stage。
  - **cli.ts**
    - `renderTable`:headers `'状态'`→`'阶段'`;cells `r.status ?? '-'` → `r.stage ?? '-'`。
    - `ListOptions`:`status?` → `stage?`。
    - option:删除 `--status <status>`;新增 `.option('--stage <stage>', '按阶段精确过滤(已规格 / 已规划 / 已验证)')`;不留别名。
    - action:`listFeatures(projectRoot, { owner, q: options.q, stage: options.stage })`。
    - 顶部注释「按负责人/关键词/状态定位」→「按负责人/关键词/阶段定位」。
  - **sync.ts**:`renderMarkdownIndex` 表头 `'| 日期 | 状态 | 标题 | 目录 |'` → `'| 日期 | 阶段 | 标题 | 目录 |'`;行内 `r.status ?? '-'` → `r.stage ?? '-'`。
  - **CHANGELOG.md**:在既有 `## Unreleased` 下新增 `### Breaking — features 状态字段由派生阶段取代`,记:阶段(已规格/已规划/已验证)由 `docs/features/` 产物存在性派生、查询时实时计算;`--status` 移除、`--stage` 取代(无别名);`list`/`my-features.md` 列与 JSON 字段 状态→阶段;存量 `> 状态:` 行忽略、不改写;负责人/日期/`--mine` 不变。
  - **scanner.test.ts**(更新 + 新增;真实栈、mkdtemp、英文 describe/it、spec 章节标注)
    - `mkFeature` 增 `report?: 'unit' | 'api'` 选项:写 `<name>-单元测试报告.md`(unit)或 `<name>-测试报告.md`(api);保留 spec/planIndex 选项。
    - 既有断言 status→stage:仅目录名 → `stage: null`;spec 头部用例 → `stage: '已规格'`(owner/date 断言不变);无 spec 有 plan → `stage: '已规划'`;全角冒号用例 → `stage: '已规格'`。
    - **删除 4 处 source 断言**(原 :68 'directory' / :83 'spec' / :95 'plan' / :105 'directory');相关用例保留 owner/date/stage 断言。
    - `filterFeatures` 的 `'filters by status...'` → `'filters by stage...'`:构造不同阶段 fixture,验 `listFeatures(root, { stage: '已验证' })` 精确匹配、与 owner 取交集。
    - 新增阶段派生组合用例(标注 spec §异常与边界场景):spec+plan → 已规划;spec+plan+unit report → 已验证;spec+api report(无 plan)→ 已验证(跨阶);仅测试规格无报告(如写 `<name>-单元测试-spec.md`)→ 不升已验证(仍 已规格);纯目录 → null。
    - `syncMyFeatures`:断言 my-features.md 含「阶段」列、不含「状态」列。
- 允许局部适配: `deriveStage` 复用 readdir 的方式、helper 命名/拆分、测试 fixture 文件名(满足后缀契约即可)。
- 完成条件:
  - `npx vitest run __tests__/core/features` 全绿;`npx vitest run` 全量绿。
  - `npm run build` 通过(严格 TS)。
  - `node dist/cli/index.js features list` 表头显示「阶段」列;`node dist/cli/index.js features list --stage 已规格` 过滤生效;`--status` 报 unknown option。
- 验证方式: 上述命令;另在临时目录构造 `docs/features/2026-01-01-x/`(放 spec / +plan / +报告)逐一验阶段派生与 `--stage`。
- 独立提交: 是(完成后仓库可编译、测试绿)。建议 commit:`feat(features): 需求阶段派生取代手填状态——状态列/过滤改阶段 + 不留 --status 别名`;body 背景一行 +「-」要点;无 Co-Authored-By 尾行。
- 风险/注意事项: FeatureEntry/FeatureFilter breaking——开工先 grep 确认 `.status`/`.source` 引用仅在 features 内(已核验 src/web/skill 无消费方);删除 source 同步删 scanner.test 的 4 处断言;`-测试报告.md` 双后缀都要匹配;勿改 TZ=UTC。

## T2: write-spec / write-plan skill 头部去 `> 状态:`

- 目标: 两个 skill 的头部约定移除 `> 状态:`(需求阶段由 features 派生,不手填)。
- 对应 spec 条款: §系统行为(skill 头部约定)· §兼容性迁移与存量数据(新文档不再产生状态)。
- 强制引用: 无(纯 skill markdown,不动代码)。
- 依赖: 无(与 T1 文件集不相交,可并行)。
- 涉及范围: `assets/claude-template/skills/write-spec/SKILL.md`、`assets/claude-template/skills/write-plan/SKILL.md`。
- 必须严格执行:
  - **write-spec/SKILL.md**「结构」头部行(约 :47)`# 规格说明: <需求名称>` + feature-id / 状态 / 负责人 / 日期 → 去「状态」→ feature-id / 负责人 / 日期;就近补一句「需求阶段由 `cgraphx features` 从产物自动派生(已规格/已规划/已验证),不手填状态」。
  - **write-plan/SKILL.md**「index.md 必备内容」(约 :82)「feature-id/状态/负责人/日期/来源 spec 摘要」→ 去「状态」→「feature-id/负责人/日期/来源 spec 摘要」;同补一句阶段派生说明。
  - 不动 负责人声明逻辑(write-spec 命名先行 ③ / write-plan 命名先行 ③)、日期、以及正文中业务语义的「状态」字样(如「数据、状态与口径」「状态流转」)。
- 允许局部适配: 阶段派生补充说明的措辞。
- 完成条件: 两个 SKILL.md 头部约定均无 `> 状态:`;`grep -n "状态" <两文件>` 仅剩业务语义处;`npm run build` 通过(copy-assets 同步 dist)。
- 验证方式: `grep` 核对 + build 后查 `dist/.claude-template/skills/write-spec/SKILL.md`、`write-plan/SKILL.md` 头部行无状态。
- 独立提交: 是(纯文档,仓库恒可工作)。建议 commit:`feat(skills): write-spec/write-plan 头部去状态字段——需求阶段由 features 派生`。
- 风险/注意事项: 无 copy-assets 新登记需求(skills 经既有 `.claude-template` 整体拷贝);仅文档,无运行时风险;勿误删业务语义「状态」。
