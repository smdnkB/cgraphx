# 实现计划：Codex 历史会话补录

> 产物: plan
> 依据: spec@7e9527f

## 设计预览

现有看板和时间线查询已共享多来源补录，但补账不能可靠区分补录成功与覆盖不足；现有查询也只能读取最近 1 万条，原 task-history 和 Codex 可用的 dev-end 调用链已缺失。本次沿用通用补录与项目删除规则，在原查询增加可选分页，并恢复按需求关联会话、累计活跃时长、生成收口档案的技能链。

| spec 决策 | 落在 | 怎么守住 |
|---|---|---|
| D5 🔒 跨宿主收口与历史分析 | T-3 `assets/claude-template/skills/dev-end/SKILL.md`、`assets/claude-template/skills/task-history/SKILL.md`；T-4 `assets/claude-template/skills/doc-backfill/` | C-4 统一入口、调用和来源约束；安装目标沿用既有适配器 |
| D9 🔒 在原时间线查询上提供稳定分页 | T-2 `src/core/timeline/cli.ts`、`src/core/timeline/indexer.ts`、`src/core/timeline/store.ts`、`src/core/timeline/types.ts` | C-2 固定参数、输出、快照和兼容；C-3 由 T-3 消费 |

## 来源 spec 摘要

唯一契约：`docs/features/2026-11-16-Codex历史会话补录/Codex历史会话补录-spec.md`（指纹 `7e9527f`）。F1 通用历史补录与结果反馈；F2 沿用 task-history 口径计算需求实际投入；F3 沿用 doc-backfill 原有产物和用户确认流程。以 spec 中 F1–F3、K1–K10、D1–D11 为准，冲突按 PLAN_CONFLICT 上报。

## 范围与不包含

- 覆盖通用补录状态、查询分页、历史分析/收口 skill 和补账编排（F1–F3）。
- 不新增 Codex 专用补录命令、不读 Codex 归档、不更改各来源项目主动删除后的过滤和重建、不恢复平台同步或旧 task 表、不改变现有文档补账产物范围。
- Claude Code、CodeBuddy、Codex 是既有可安装宿主；DeepSeek 是会话只读来源，其数据参与通用补录和统计，不增加 DeepSeek 宿主安装器。
- 不增加单元/接口测试任务或新测试；提交后既有测试必须不被弄红。spec 的设计验收由实现后独立测试流程覆盖。

## 任务清单

| 任务 | spec | 完整涉及范围（仓库相对路径） |
|---|---|---|
| T-1 通用补录反馈 | F1、D1–D4 | `src/core/timeline/ingest/ingest.ts`、`src/core/timeline/ingest/rebuild.ts`、`src/core/timeline/ingest/facts.ts`（新，拆出既有事实映射）、`src/core/timeline/ingest/coverage.ts`（新）、`src/core/timeline/index.ts`、`src/core/timeline/cli.ts`、`src/core/board/compute.ts`、`src/core/board/cli.ts` |
| T-2 原查询可选分页 | F2、D9 | `src/core/timeline/types.ts`、`src/core/timeline/store.ts`、`src/core/timeline/indexer.ts`、`src/core/timeline/index.ts`、`src/core/timeline/cli.ts`、`src/core/timeline/page-cursor.ts`（新） |
| T-3 历史分析和收口技能 | F2、F3、D5–D8、D11 | `assets/claude-template/skills/task-history/SKILL.md`（新）、`assets/claude-template/skills/dev-end/SKILL.md`（新）、`assets/claude-template/commands/dev-end.md`、`assets/claude-template/deprecated-assets.json` |
| T-4 补账编排 | F1、F3、D4、D10、D11 | `assets/claude-template/skills/doc-backfill/SKILL.md`、`assets/claude-template/skills/doc-backfill/filler-prompt.md`、`docs/features/2026-11-16-Codex历史会话补录/` 下本需求方案、spec 和 plan 文件 |

T-1 的新内部模块用于拆分现有 1142 行的 `ingest.ts`，需满足每个修改后的源码文件不超过 600 行；若按上述两个文件无法拆分而不改变门面，按 PLAN_CONFLICT 上报，先调整任务文件清单。

## 执行顺序

1. T-1；先完成并提交通用补录反馈，保持删除边界、既有调用方和查询 stdout。
2. T-2；复用 T-1 的 `cli.ts` / `index.ts`，实现 C-2；提交后可并行执行 T-3、T-4，二者文件不重叠且依 C-3、C-4 衔接。
3. T-3、T-4 可并行；主会话逐一核对回报，按各自提交点串行提交；T-4 同时提交本需求方案、spec、plan 文档。
4. 全部提交后按统一验证检查；发现实现造成的问题，由主会话安排修复并按提交规范补提交。

## 必须严格执行的契约

- **C-1 补录与反馈**：现有 `ensureTimelineUpToDate(start)` 仍是 board、install、timeline query 共用入口；`TimelineSyncStatus` 原值和所有现有调用签名保持兼容。增加覆盖结果只能以可选字段扩展 `TimelineSyncOutcome`，不直接输出到 board HTTP JSON；board 现有进度和 `notice` 形态不变。`timeline query` 的 stderr 在补录完成后输出 `[timeline] 补录状态: complete|partial|blocked` 一行（竖线代表三选一），具体原因沿用 stderr；stdout 和原退出码保持。判定严格依 spec「补录状态契约」；未安装来源不单独报错、全部无来源报 partial。读取失败隔离、不推进失败文件偏移，受锁保护；删除标记和过滤不得改变。
- **C-2 原命令分页**：以 spec D9「分页接口契约」为唯一权威：`timeline query --paged --format json` 首次；续页 `--paged --format json --cursor <token>`；输出 `{events,next_cursor}`；游标携带 `(ts,id)`、首次最大 id、数据库设备号和 inode、规范化过滤及页大小。首末边界、筛选冲突、无效游标、数据库更换、参数错误退出码均按 spec。未传 `--paged` 时原倒序数组/table、默认/上限、过滤和错误行为不变；不得新增独立 `history-events` 命令。
- **C-3 历史统计**：task-history 使用 C-2 遍历完整快照，以提交、独占文件、提问关键词及时间窗识别需求事件；按本地日期分组，间隔 `>1h` 断开、`<=1h` 连续，每段至少 2 个带时间事件、累计各段首末差；分别计算明确事件的下界和含候选事件的上界，先去重，避免并行重复累计。无可计算段写「无法估算」；timeline 覆盖不足且原始会话足够时回退估算并注明非 timeline 实测；混合会话不额外标注不确定性。原文证据必须读取真实 transcript。
- **C-4 skill 链路**：安装资产统一在 `assets/claude-template/skills/`：`task-history/SKILL.md`、`dev-end/SKILL.md`，`doc-backfill` 的 filler 调用 `$dev-end`，后者调用 `$task-history`；既有可安装宿主通过现有模板部署。`doc-backfill` 使用既有时间线查询触发 C-1，捕获 stderr 状态及原因传 filler，缺状态/命令失败按覆盖不足；保留用户挑选范围、确认需求、串行 filler、不覆盖既有产物、提交机制。
- **C-5 跨层与兼容**：`src/core` 不依赖 `src/cli` 或 `src/web`；跨子系统走 `index.ts` 门面；Node 内置模块 `node:`；不改 schema、不直接用 `node:sqlite`；新源码文件不超过 600 行，修改存量超限文件时拆分；CLI 人读诊断在 stderr 加 `[timeline]`，机器数据只在 stdout；不改变用户主动删除项目后的行为。

## 细节方案核对

D1–D4 → T-1、T-4；D5 → T-3、T-4；D6–D8 → T-3；D9 → T-2、T-3；D10 → T-4；D11 → T-3、T-4。K1–K4 → C-1；K5–K8 → C-2、C-3；K9–K10 → C-4 及 T-3。无 spec 未落任务项。

## 适用规范

- `docs/guides/coding-standards.md`：边界与结构、选型、错误与日志。
- `docs/guides/interface-standards.md`：命令注册、输出、退出码、git 钩子调起的隐藏子命令契约。
- `docs/guides/git-standards.md`：提交消息规范、提交前检查点。
- 无 schema 变更；若实现发现必须改 schema，停止并回 spec，不能沿用此计划擅自迁移。

## 提交规范

格式 `type(scope): 中文描述`，type 为 feat/refactor/fix/docs，非琐碎提交 body 写背景及要点；不写票据。提交前逐项检查：TS 运行资产登记 `scripts/copy-assets.cjs`；core 不依赖 cli/web；schema 幂等；timeline hook DB 写入 await 且异常不阻塞；不改 vitest 的 UTC；不注释命令或 hook 接入；不引入绝对路径、密钥、魔法值或 TODO/FIXME。根据每任务文件清单显式 `git add -- <路径...>`，再 `git commit -m '<说明>' -- <同一批路径...>`；禁止笼统 add 或将无关文件提交。spec/方案/plan 文件列入 T-4，避免遗漏。统一验证后的修复另提交 `fix(timeline): 修复补录与收口验证问题`，只包含修复文件；需要多笔时描述中写修复点区分。

## 统一验证

在本需求副本根目录执行：

1. `npm run build`：退出 0，TS 编译通过、运行资产复制完成。
2. `npm test`：现有套件不新增失败；基线 52 文件通过、704 通过、1 跳过。测试套件的故意 EACCES 日志和 Vite CJS 弃用提示不视为失败。

不排新测试或测试编写任务；独立单测按 spec 的设计验收在实现后另行安排。

## 写前自检

- 基线：副本无 node_modules，已在副本执行 `npm ci --offline --no-audit --no-fund`；`npm run build` 退出 0；`npm test` 退出 0，52 文件、704 通过、1 跳过。
- 仓库：`git branch --show-current` 为 `feat/Codex历史会话补录`；`git status --short` 只有本需求目录未跟踪；`git diff --cached --name-only` 为空；依赖与 dist 已忽略。
- 公共返回值：`rg -n 'ensureTimelineUpToDate|TimelineSyncOutcome|describeSyncOutcome|queryEvents\(' src __tests__`；调用包括 installer、timeline query/show/stats/recent、git commit hook、board。board 将 outcome 状态映射为独立 `notice`，未直接将 outcome 序列化；CLI stdout 当前直接序列化旧 `queryEvents` 数组；C-1 保持 board JSON、C-2 保持旧 stdout。
- 规范：已读 coding/interface/git 规范；本需求不变更 schema；data-standards 亦已读。
- 文件与适配：`assets/claude-template/skills/doc-backfill/` 存在；`dev-end` 当前只有命令模板；task-history 已从 Git 历史删除，历史依据 `7189124^:assets/claude-template/agents/task-history.md`；Codex 只部署 skills，DeepSeek 只读。
- 路径与提交：任务清单列出完整涉及路径、执行顺序、指定路径提交命令及修复提交规则，供主会话不读任务文件时核对。

## 允许局部适配

可以调整内部 helper 的局部命名、拆分内部函数和与现有项目习惯一致的语言文字；不得改变 C-1–C-5、文件清单以外的范围、spec 的业务口径或公开契约。必须新增文件或影响现有调用方时按 PLAN_CONFLICT 上报。

## PLAN_CONFLICT 与关键风险

- 遇到 spec/plan/代码冲突、无法在既定路径和契约内完成、需要改 schema、要改项目删除规则、分页/状态接口与既有消费者不兼容时停止并上报 `PLAN_CONFLICT`，列明证据和影响，等待主会话回 spec 决定。
- 部分失败或无来源不可假定为 0；不得将其他项目的会话写入当前项目；不因复制时间而错误推进偏移。
- 历史会话不等于完整对话；查不到原文不能标为会话来源；旧文件若缺失不得制造证据。

## 待确认项

无。

## 启动语

`$dev-impl-subagent docs/features/2026-11-16-Codex历史会话补录/plan/Codex历史会话补录-index.md`
