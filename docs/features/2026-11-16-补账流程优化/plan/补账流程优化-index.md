# 实现计划：补账流程优化

> 产物: plan
> 依据: spec@973d521

## 设计预览

入口改为 iboc-check，确认后继续补齐。根据用户 2026-11-17 的追加指令，dev-end、task-history 都只保留 skill，删除两个 command 和旧 task-history agent；安装时通过既有废弃清单清理。撤回尚未提交的 Codex agent 分发特例，继续沿用原 skill 安装机制。小需求，一个 dev-impl 会话串行完成。

| spec 决策 | 落在 | 怎么守住 |
|---|---|---|
| D1 🔒 唯一入口 iboc-check | T-1 新 skill 目录；T-2 manifest、profiles.ts；T-3 指南 | C-1、C-2 |
| D5 🔒 两个职责各一份 skill | T-1 dev-end skill、task-history skill、旧 agent 删除；T-2 安装清理 | C-2、C-3 |

## 来源 spec 摘要

唯一契约 `docs/features/2026-11-16-补账流程优化/补账流程优化-spec.md`，指纹 973d521，第一节收录用户更新后的功能方案 v2。D1、D5、D8 均按用户最新指令确定，无设计待确认。原 agent 路线已被替代，不能继续执行旧安装适配。

## 范围

F1、F2、K1—K6、D1—D8。删除两个 command 并在安装中自动清理；task-history 仅 skill。历史算法、文档产物范围、确认与补齐规则不变。

不含实际补账、数据库/API、历史需求批量改名、新 IBOC 条款、新测试编写、发版和推送。临时目录验证不处理真实项目数据。

## 任务清单

工作目录：`/Users/smdnk/.cgraphx/worktrees/cgraphx-331dde92c546abf6/cgraphx@补账流程优化`。路径相对此目录；以下为每任务完整允许范围。

### T-1 自查入口与唯一规则定义

对应 F1、F2、D1、D2、D5、D7、D8：

- `assets/claude-template/skills/doc-backfill/SKILL.md` → `assets/claude-template/skills/iboc-check/SKILL.md`
- `assets/claude-template/skills/doc-backfill/filler-prompt.md` → `assets/claude-template/skills/iboc-check/filler-prompt.md`
- `assets/claude-template/skills/dev-end/SKILL.md`
- `assets/claude-template/skills/task-history/SKILL.md`（保留原有完整规则，内容不必改动）
- `assets/claude-template/agents/task-history.md`（删除）
- `assets/claude-template/commands/dev-end.md`（删除）
- `assets/claude-template/commands/my-query.md`（删除）

### T-2 安装分发与升级清理

对应 F1、F2、D3、D4、D6、D8：

- `src/core/agents/profiles.ts`（只增加 iboc 指令前缀）
- `assets/claude-template/deprecated-assets.json`
- `__tests__/cli/installer/assets-removal.test.ts`（修正受规格变化影响的已有断言及旧资产 fixture）

此前未提交的 `src/core/agents/types.ts` 和 `src/cli/installer/claude-assets.ts` 改动撤回至本需求开始前的内容，两个文件最终无 diff；不是新实现范围，不撤回任何用户改动。

### T-3 活动引用与需求文档归档

对应 F1、F2、D4、D8：

- `assets/claude-template/FLOW-MAP.md`
- `assets/claude-template/skills/cgraphx-guide/SKILL.md`
- `assets/claude-template/skills/cgraphx-guide/how-to-use.md`
- `assets/claude-template/skills/cgraphx-guide/how-to-use.html`
- `assets/claude-template/skills/cgraphx-guide/skills.html`
- `assets/claude-template/skills/audit-login-security/SKILL.md`
- `src/core/timeline/cli.ts`（只改消费方名称注释）
- `docs/features/2026-11-16-补账流程优化/补账流程优化-功能方案-v1.md`
- `docs/features/2026-11-16-补账流程优化/补账流程优化-功能方案-v2.md`
- `docs/features/2026-11-16-补账流程优化/补账流程优化-spec.md`
- `docs/features/2026-11-16-补账流程优化/plan/补账流程优化-index.md`
- `docs/features/2026-11-16-补账流程优化/plan/补账流程优化-01-自查入口与唯一规则定义.md`
- `docs/features/2026-11-16-补账流程优化/plan/补账流程优化-02-安装分发与升级清理.md`
- `docs/features/2026-11-16-补账流程优化/plan/补账流程优化-03-活动引用与需求文档归档.md`

只提交各清单内实际变动文件；v1 保留历史方案，当前 spec 以 v2 为准。

## 执行顺序

T-1 → T-2 → T-3 → 统一验证 → 按任务三笔提交。本次为先完成验证再提交而调整原提交时点，避免提交未验证改动；不派实现子 agent、不并行写 Git index。修复仍在对应任务范围独立提交。

## 必须严格执行的契约

### C-1 入口与补全

按 spec D1、D2：name=iboc-check、disable-model-invocation=true，中文标题「IBOC 送检前自查与补齐」。模板使用 /iboc-check，Codex 转为 $iboc-check；filler 相对路径不变。K1—K5 的选择范围、候选、用户确认、串行补齐、核验和逐需求提交、已有产物跳过规则保持。

### C-2 定义与安装清理

按 D3、D5、D6、D8：仅 skills/dev-end 和 skills/task-history；发布源移除两个 command 与历史 agent。废弃清单移除 skills/iboc-check 与 skills/task-history，包含 skills/doc-backfill、commands/dev-end.md、commands/my-query.md、agents/task-history.md。沿用既有部署后清理；不清理整个 commands/agents，不误删用户其他文件。

不保留 additionalAssetPaths 字段或 Codex agent 放行，不改变现有安装返回结构、过滤器或其他宿主默认行为。

### C-3 skill 调用链

iboc-check → filler → dev-end skill → task-history skill；输入输出完全按 spec D7。filler 在自身上下文执行，历史分析不另派同名 agent；历史规则只在 task-history skill，收口 schema/原文证据/发布确认只在 dev-end skill。受阻如实报告，不将调用失败伪装成分析已完成。

### C-4 工程约束

core 不依赖 cli/web，外部消费 core 经门面；新注释中文，内置模块 node: 前缀。版本、依赖、测试 TZ 不改。发布资产使用原 copy-assets 递归构建，不修改 dist 或本副本已安装的 .agents。

### C-5 活动引用与归档

活动说明移除 my-query，dev-end 列在 skill 清单；task-history 描述为 skill。HTML 入口及锚点同步。历史需求不全局替换，本需求 v1 原样保留；v2 与 spec 第一节保持一致。不宣称自查通过就等同送检通过。

## 细节方案核对

| spec 决策 | 任务 | 契约 |
|---|---|---|
| D1、D2 | T-1、T-3 | C-1、C-5 |
| D3 | T-2 | C-2 |
| D4 | T-2、T-3 | C-1、C-5 |
| D5、D7 | T-1 | C-2、C-3 |
| D6 | T-2 | C-2、C-4 |
| D8 | T-1、T-2、T-3 | C-2、C-5 |

## 适用规范

- docs/guides/coding-standards.md：边界与结构、选型、错误与日志；T-2 和 T-3 强制引用。
- docs/guides/git-standards.md：提交消息规范与提交前检查点，结晶如下。
- 不涉及 schema/API，无需数据和接口规范。

## 提交规范


当前分支 `feat/补账流程优化`；初始暂存区为空，工作区仅本需求目录下未跟踪的讨论稿和 spec。实施前再次确认状态；若出现无关变动，不纳入提交。

消息格式原文：`type(scope): 中文描述`（Conventional Commits + 中文）。type 为 feat/refactor/fix/docs；无票据关联；非琐碎提交 body 写背景一行及 `-` 要点。多行 body 写临时文件后传 `git commit --file`，不在命令字符串拼接转义。

三笔提交：

1. T-1：`refactor(skills): 统一IBOC自查与收口定义`，仅 T-1 所列旧/新路径。
2. T-2：`feat(installer): 清理旧指令与历史分析agent`，仅 T-2 三个路径。
3. T-3：`docs(skills): 更新IBOC自查指引与需求文档`，仅 T-3 实际变动路径。

每笔先用精确文件清单检查 diff，`git add -A -- <该笔存在或已跟踪删除的精确文件路径>`；核对 `git diff --cached --name-only` 和 `git diff --cached` 只含此笔范围后提交。不得 `git add .`，不得夹带其他需求。若发现非本笔的 staged 文件，不替用户重置，改用精确 `git commit --only -- <该笔路径>` 并在提交前核对该笔内容；不能保证隔离则上报。重命名的旧新文件均纳入。无实际改动不空提交。

提交前检查点原文摘录：

- **与 TS 同放的运行时资产未登记 `scripts/copy-assets.cjs`** —— 不随包发布，用户机器运行时 ENOENT。
- **src/core 出现对 src/cli / src/web 的 import** —— 分层硬约定破坏，无 lint 拦截，只靠人眼。
- **schema.sql 丢失 `IF NOT EXISTS`** —— 已初始化项目重复应用 schema 直接报错。
- **timeline hook 链路出现未 await 的 DB 写入 / 抛错不吞** —— 阻塞宿主 Claude Code 工具调用。
- **`vitest.config.ts` 的 `TZ: 'UTC'` 钉死被改** —— 日期断言失去跨机器可复现性。
- 被注释掉的命令注册 / hook 接入项(commander `.command(...)` / settings.json hooks)—— 功能静默失效。
- 写死的魔法值：绝对路径、密钥、阈值、版本号写进源码。
- 新增 TODO / FIXME：确认是否应转任务，不随提交入库。

统一验证后的修复提交：`fix(installer): 修复IBOC资产分发问题` 或 `fix(skills): 修复IBOC自查调用问题`，范围仍只限相关任务路径；不改号、不合并无关修复。门禁拦截先读提示核对 staged diff，仅在确已完成审核且规则允许时按提示重试，不禁用门禁。push 归用户。

## 统一验证

从本副本执行：

- `npm run build`：TS 编译及 copy-assets 成功，构建不残留旧 agent 和两个 command。
- `git diff --check`：无空白错误。
- `node dist/cli/index.js features show '2026-11-16-补账流程优化'`：spec 指纹为 973d521，各 plan 依据未过期。
- `rg --files dist/.claude-template | rg '/(iboc-check|doc-backfill|task-history|dev-end|my-query)(/|\.md$)'`：只有 iboc-check 两文件、dev-end skill、task-history skill 四个文件。

以上命令已在实施前试跑：初始缺 tsc，经本地缓存离线安装后构建通过；原 spec 指纹 d96f8df，旧构建列六个相关资产，diff 检查通过。用户改为仅 skill 后重新验证最终结果。既有测试不得弄红，只同步修正已受影响断言，不排新测试任务或写新测试代码；正式测试产物走独立流程。

三宿主真实模型服务运行有证据才记通过。此前 agent 冒烟超时/500 不能作为本 skill 调用通过证据；当前实现不依赖已删的 agent 注册、工具调用或嵌套能力。

## 写前自检

- 分支 feat/补账流程优化；初始 git status 只有本需求目录，暂存区空。追加指令前所有工作区变更均为本次实现；撤回 agent 适配不触及用户改动。
- 原基线构建、diff、features show 和文件筛选均实跑；离线安装 84 个依赖包，锁文件未改。
- 读取安装过滤、部署/卸载及 GenericAgentTarget 消费处；返回数组会进入 WriteResult.files。本版不更改共享方法签名、过滤器或公共返回结构。
- 保留的唯一代码适配为 profile 内 iboc 前缀；消费者仍经 applyAssetReplacements，不新增对外字段。
- 同一会话读取 index 和三个任务文件；完整范围、顺序、提交与验证均在 index。
- 修复提交格式已列明。小需求，未派 plan 审核；用户追加指令已直接锁定变更，无新待拍板方案。

## 允许局部适配的范围

文字与局部命名可按既有模式调整；定义形式、调用链、算法、清理路径、确认规则和提交隔离固定。

## Plan 冲突上报规则

出现超出用户最新指令/spec 的设计变化时报告 PLAN_CONFLICT，列编号、代码证据与影响面；不自行扩范围。此次 skill 和 commands 调整是用户明确要求的 PLAN_ADAPTED，不重新要求确认。

## 关键风险与防跑偏约束

废弃清单不能误删 task-history 或新 iboc-check；命令删除不等于取消 dev-end skill 入口；旧 agent 必须在三宿主升级时清理；不清理用户其他 command/agent。回退需按授权精确撤销本需求提交，不重置工作区或自行推送。

## 待确认项

无影响实施的设计缺口；用户已明确要求直接删除、自动清理并改为 skill。

## 启动语

`$dev-impl docs/features/2026-11-16-补账流程优化/plan/补账流程优化-index.md`
