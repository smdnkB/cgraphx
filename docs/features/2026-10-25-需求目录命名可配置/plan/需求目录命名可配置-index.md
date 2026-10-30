# 实现计划: 需求目录命名可配置

> 产物: plan
> 依据: spec@869e407

## 设计预览

原来需求目录名必须以日期开头:skill 只会按 `YYYY-MM-DD-[业务ID-]<标题>` 命名,程序也只认开头那段日期。这次程序侧在 features 子系统新增 `feature-id.ts`,统一识别目录名里的日期段,需求列表、task 的目录任务名和会话归属都经 features 门面改用它;skill 侧 dev-spec 改成先读项目的 `docs/guides/feature-standards.md`,没有才按默认格式,12 处取文件前缀的说法统一成「去掉日期段」;使用指南、说明文档、知识库、CHANGELOG 同步口径。默认格式的目录,日期、标题、任务名、文件前缀和现在逐字相同。

**难回头的决策落在哪**(决策已在 spec 确认,这里核对落点,其余可略读)

| spec 决策 | 落在 | 怎么守住 |
|---|---|---|
| D4 🔒 日期段识别与去除规则(决定平台上新目录任务的名字) | T-1 `src/core/features/feature-id.ts`(新)、`src/core/task/feature-name.ts` | 规则只在 `parseFeatureId` 一处实现(C-1),scanner 和 task 都经 features 门面调用;统一验证 3 逐行核对 spec 解析表,统一验证 4 核对默认格式目录的任务名不变 |

## 来源 spec

`docs/features/2026-10-25-需求目录命名可配置/需求目录命名可配置-spec.md`(spec@869e407):项目在 `docs/guides/feature-standards.md` 写需求目录命名规范,skill 建目录时按规范命名;程序把「日期必须在目录名开头」放宽成「取目录名里第一段日期」;文件前缀 = feature-id 去掉日期段;没有规范的项目、默认格式的目录一切照旧。

## 范围

覆盖 F1–F5;spec 决策 D1–D8 全部落进任务(见「细节方案核对」)。

## 明确不包含

- 按模块分子目录、老目录改名、程序校验目录名是否符合规范、改 `docs/guides/data-standards.md` 与 `assets/claude-template/skills/init-guides/templates/schema-convention.md` 的发版顺序原文(spec 边界外)
- `/init-guides` 发现多模块工程时提议生成命名规范(spec 已砍)
- 新写测试:spec 设计验收 3、4 由全部任务完成后的 `/unit-spec` → `/unit-code` 补;本 plan 只要求既有测试不被弄红
- 部署副本:本仓库根目录 `.claude/`、上级目录 `.claude/` 由 `cgraphx install` 刷新,不手改
- 版本号:发版时另走 `npm version`

## 任务清单

| 任务 | 文件 | 对应 spec | 涉及范围 |
|---|---|---|---|
| T-1 程序:日期段统一识别 | `plan/需求目录命名可配置-01-程序-日期段识别.md` | F3、D4、D5 | `src/core/features/` 4 个文件(含新建 `feature-id.ts`)、`src/core/task/feature-name.ts`;只改注释:`src/core/task/auto-binding.ts`、`src/core/task/resolve.ts` |
| T-2 skill:按规范命名 + 取前缀口径 | `plan/需求目录命名可配置-02-skill-命名与前缀.md` | F2、F4、D2、D3、D6 | `assets/claude-template/` 下 13 个文件(11 个 skill 的 SKILL.md、`api-case/references/collection-layout.md`、`commands/dev-end.md`) |
| T-3 文档:口径统一 + 使用指南 + 知识库 | `plan/需求目录命名可配置-03-文档-口径与指南.md` | F1、F5、D1、D7、D8,全局约束末条 | FLOW-MAP.md、模板 CLAUDE.md、使用指南 md / html、本仓库 CLAUDE.md、CHANGELOG.md、知识库两条 |

## 执行顺序

- **第 0 步(主会话,开工前)**:
  1. 从 `main` 建分支 `feat/需求目录命名可配置`;`git status` 确认暂存区是空的。
  2. 提交本需求的 spec 与 plan:`docs: 需求目录命名可配置——spec + plan`(`docs/features/2026-10-25-需求目录命名可配置/` 下全部文件)。
  3. 在未改代码的 HEAD 上留基线,供统一验证 4 对比:

  ```bash
  mkdir -p .cgraphx/baseline
  npm run build
  node dist/cli/index.js features list --json > .cgraphx/baseline/features-before.json
  node dist/cli/index.js task list --local --json | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const r=JSON.parse(s);console.log(JSON.stringify(r.tasks.filter(x=>x.source==='feature').map(x=>({featureId:x.featureId,name:x.name})),null,1))})" > .cgraphx/baseline/tasks-before.json
  ```

- **第 1 步**:T-1、T-2、T-3 **同时跑**——三者改的文件不重叠,共用的写法都在下方契约里定死;T-3 写知识库时按 C-1 的文件名与函数名,不等 T-1 的代码。
- **第 2 步(主会话)**:收回报,按各任务的提交点提交(子 agent 只改文件,不构建、不测试、不提交);全部提交后跑「统一验证」。有不通过的项 → 修复后单独提交 `fix(<scope>): …`,再从头跑一遍统一验证。

## 必须严格执行的契约

- **C-1 日期段识别函数**
  - 文件:`src/core/features/feature-id.ts`(新建)
  - 导出:`export interface ParsedFeatureId { date: string | null; title: string }` 与 `export function parseFeatureId(featureId: string): ParsedFeatureId`
  - 门面:`src/core/features/index.ts` 导出 `parseFeatureId` 与类型 `ParsedFeatureId`;task 只经 `'../features'` 导入
  - 规则(spec D4):日期段 = 目录名里第一个前后紧挨连字符或名字首尾的 `YYYY-MM-DD`(4-2-2 位数字,不校验日期是否真实存在);`title` = 去掉日期段,以及它与相邻段之间的一个连字符;没有日期段,或去掉后为空(目录名就是一个日期)→ `{ date: null, title: featureId }`
  - 结果必须与 spec「目录名解析」表 7 行逐行一致
- **C-2 规范文件**:路径 `docs/guides/feature-standards.md`,节标题 `## 需求目录命名`;格式行以「格式:」开头,模板用反引号包住;占位写法:必填段 `<名称>`、可选段 `[名称-]`、日期固定写 `YYYY-MM-DD`(spec D1)
- **C-3 文件前缀一句**(逐字,含反引号):「文件前缀 = feature-id 去掉日期段 `YYYY-MM-DD`」(spec D6)
- **C-4 规范例子全文**:spec「细节方案:F1」下「规范写法」代码块,逐字照抄
- **C-5 需求目录写法**(逐字,含反引号;用来整体替换旧写法 `docs/features/<日期>-<编号>-<前缀>/`):「`docs/features/<feature-id>/`(命名见 `docs/guides/feature-standards.md`,没有就按 `YYYY-MM-DD-[业务ID-]<标题>`)」(spec F5)
- **C-6 两句原文**(逐字):
  - F2① 提示:「命名规范缺少日期段 YYYY-MM-DD,本次按默认格式命名」
  - 发版提醒:「汇集发版 SQL 时按目录名里的日期排,别按目录名排序」

## 细节方案核对

| spec 决策 | 落进 |
|---|---|
| D1 规范写法(格式行与占位写法) | T-2(dev-spec 读规范时按 C-2 判断日期段与占位段)、T-3(使用指南例子按 C-4) |
| D2 读规范只写在 dev-spec,其余引用;dev-impl 补引用;dev-handoff 括注补「规范里的其他段」 | T-2 |
| D3 命名先行确认格式里除日期外的每个占位段 | T-2(dev-spec 第 0 步) |
| D4 🔒 日期段识别与去除 | T-1(C-1) |
| D5 识别函数放 features 门面,task 经门面 | T-1(C-1) |
| D6 文件前缀统一一句 | T-2(C-3) |
| D7 「聚合项目」一节放使用指南「最佳起步实践」第 1 步之后,md / html 同步 | T-3 |
| D8 口径统一的 5 个文件,「项目约定」不加条 | T-3(C-5) |
| 全局约束「默认格式零变化」 | T-1 完成条件 + 统一验证 3、4 |
| 全局约束「CHANGELOG + 知识库两条」 | T-3 |

没有选型缺口。

## 适用规范

- `docs/guides/coding-standards.md`「边界与结构」「选型(偏离社区默认)」:T-1 强制引用(门面硬约定、core 不依赖 cli / web、注释中文、`node:` 前缀)
- `docs/guides/git-standards.md`「提交消息规范」「提交前检查点」:结晶进下方「提交规范」
- T-2、T-3 只改 markdown / html,不涉及 interface / data / testing 规范

## 提交规范

摘自 `docs/guides/git-standards.md`:

- 格式:`type(scope): 中文描述`;type 用 feat / refactor / fix / docs;scope 常用 skills / installer,仓库级改动省 scope
- 补充说明用「——」,并列用「+」,数值对比用「→」(`159→60`)
- 正例:`feat(skills): init-guides 双模式——新项目立起步规范`;反例:`update skill`(无 type、英文、零信息)
- 无票据关联:需求追踪走 `docs/features/` 目录,不进标题
- body:非琐碎提交写 body——背景一行(问题 / 动机)+「-」列要点;琐碎可只留 subject
- 末尾按会话约定加署名行
- 提交门禁:本仓库的 precommit-check hook 会先拦一次——先跑 `cgraphx features check --staged`(暂存区产物不合格必须改对),再要求对照下面的检查点自查 `git diff --cached`;自查无问题后用 `CGRAPHX_PRECOMMIT_REVIEWED=1 git commit ...` 重试

提交前检查点(原文):

- 与 TS 同放的运行时资产未登记 `scripts/copy-assets.cjs` —— 不随包发布,用户机器运行时 ENOENT(本需求不新增运行时资产)
- src/core 出现对 src/cli / src/web 的 import —— 分层硬约定破坏,无 lint 拦截,只靠人眼
- schema.sql 丢失 `IF NOT EXISTS` —— 已初始化项目重复应用 schema 直接报错
- timeline hook 链路出现未 await 的 DB 写入 / 抛错不吞 —— 阻塞宿主 Claude Code 工具调用
- `vitest.config.ts` 的 `TZ: 'UTC'` 钉死被改 —— 日期断言失去跨机器可复现性
- 被注释掉的命令注册 / hook 接入项(commander `.command(...)` / settings.json hooks)—— 功能静默失效
- 写死的魔法值:绝对路径、密钥、阈值、版本号写进源码
- 新增 TODO / FIXME:确认是否应转任务,不随提交入库

## 统一验证

全部任务提交后,在仓库根依次跑:

1. `npm run build` → 无报错
2. `npm test` → 全部通过
3. D4 解析表(C-1):

   ```bash
   node -e "const {parseFeatureId}=require('./dist/core/features');const t=require('./dist/core/task/feature-name');for(const n of ['2026-10-18-REQ-1024-订单导出','order-2026-10-25-REQ-1024-订单导出','order-service-2026-10-25-订单导出','2026-10-25-2026-11-11大促','活动-2026-11-11','随手建的目录','2026-10-25'])console.log(n,JSON.stringify(parseFeatureId(n)),t.featureDatePrefix(n),t.featureTaskName(n))"
   ```

   → 7 行的日期、标题、任务名与 spec「目录名解析」表逐行一致(没有日期的两行 `date` 为 `null`、`featureDatePrefix` 输出 `null`)
4. 默认格式零变化(对比第 0 步基线):

   ```bash
   node dist/cli/index.js features list --json > .cgraphx/baseline/features-after.json
   diff .cgraphx/baseline/features-before.json .cgraphx/baseline/features-after.json
   node dist/cli/index.js task list --local --json | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const r=JSON.parse(s);console.log(JSON.stringify(r.tasks.filter(x=>x.source==='feature').map(x=>({featureId:x.featureId,name:x.name})),null,1))})" > .cgraphx/baseline/tasks-after.json
   node -e "const a=require('./.cgraphx/baseline/tasks-before.json'),b=require('./.cgraphx/baseline/tasks-after.json');const m=new Map(b.map(x=>[x.featureId,x.name]));const bad=a.filter(x=>m.has(x.featureId)&&m.get(x.featureId)!==x.name);console.log(bad.length?JSON.stringify(bad):'OK')"
   ```

   → `diff` 无输出;最后一条输出 `OK`
5. 口径残留与原文:
   - `grep -rn "去掉开头的日期" assets/claude-template` → 无输出
   - `grep -rln "去掉日期段" assets/claude-template --exclude-dir=cgraphx-guide | wc -l` → `12`
   - `grep -rn "<日期>-<编号>-<前缀>\|&lt;日期&gt;-&lt;编号&gt;-&lt;前缀&gt;" assets/claude-template CLAUDE.md` → 无输出
   - `grep -n "命名规范缺少日期段 YYYY-MM-DD,本次按默认格式命名" assets/claude-template/skills/dev-spec/SKILL.md` → 有命中(C-6)
   - `grep -c "汇集发版 SQL 时按目录名里的日期排,别按目录名排序" assets/claude-template/skills/cgraphx-guide/how-to-use.md assets/claude-template/skills/cgraphx-guide/how-to-use.html` → 两个文件都 ≥ 1(C-6)
6. `cgraphx docs validate docs/knowledge/开发任务.md` 与 `cgraphx docs validate docs/knowledge/开发任务绑定.md` → 都通过
7. `node dist/cli/index.js features check 2026-10-25-需求目录命名可配置` → 全部通过

## 允许局部适配的范围

只限各任务文件「允许局部适配」列出的项:注释与文档措辞、内部辅助函数与局部命名、markdown / html 排版。其余(契约 C-1–C-6、涉及范围、调用方式、提交点)一律固定。

## Plan 冲突上报规则

执行中发现 spec、plan 与代码现实对不上(如原句与任务描述不符、C-1 规则与既有测试冲突、要改的文件超出涉及范围)→ 停下,向主会话报 `PLAN_CONFLICT: <任务编号> <冲突点> <依据(文件:行)>`,不自行改契约。权威链:spec > plan > docs/guides 规范。

## 关键风险与防跑偏约束

- D4 🔒:平台只认第一次声明的任务名,规则实现错了,发版后会把错误名字永久写进平台——统一验证 3、4 不通过不得收尾,失败按修复流程单独提交 `fix(features): …`
- 只改任务清单列出的文件;不顺手重构 scanner / task 的其他逻辑;`src/core/artifact-registry/`、`src/core/sync/`、`src/web/`、`src/cli/` 全部不动
- skill 改动只在 `assets/claude-template/`,根目录 `.claude/` 是部署副本
- 不写新测试;既有测试被改动弄红时修实现,不改既有用例的期望

## 待确认项

- 无

## 启动语

```
/dev-impl-subagent docs/features/2026-10-25-需求目录命名可配置/plan/需求目录命名可配置-index.md
```
