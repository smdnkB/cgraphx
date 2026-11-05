# 实现计划: 下掉web与平台同步

> 产物: plan
> 依据: spec@1fedd36

## 设计预览

原来 cgraphx 除了本机的知识库、时间线、需求目录能力,还背着三块只为「平台对接」存在的东西:本地 web 浏览服务(`cgraphx web`)、往研发管理平台上报的 sync 子系统(`cgraphx sync`,连着平台下发的产物类型表、查知识库记的参考)、开发任务绑定(`cgraphx task`,连着 task-history 子 agent、`/dev-handoff` 会话交接、按任务算历时)。这次把三个子系统整体删掉(`src/web/`、`src/core/sync/`、`src/core/task/` 连测试约 80 个文件),跑这些命令只报 unknown command;安装器学会三件升级清理:把旧项目配置里的上报/任务 hook 当死 hook 删掉、删掉库里 13 张 `sync_*`/`task_*` 表和四个运行文件、给没重装的项目留五个隐藏空命令兜底(不报错);features 产物检查只认内置类型、「平台环节」改叫「需求环节」、不再读 spec 头部的 `> 任务:`;replica 加「一个需求只开一个副本」拦截;会话开始的提示(落后、自动记忆去向)改由时间线 hook 独自出;流程文字与知识库条目同步收口(dev-handoff、task-history 删除,澄清进度改写进讨论稿,收口档案历时只留起止)。

**难回头的决策落在哪**(决策已在 spec 确认,这里核对落点,其余可略读)

| spec 决策 | 落在 | 怎么守住 |
|---|---|---|
| D1 🔒 删掉整个 `src/web/`(含 `public/`)、`__tests__/web/`、`markdown-it` 依赖 | T-1 | 删除范围在任务原文列死;统一验证查 `dist/web/` 不存在、依赖表无 `markdown-it`、`cgraphx web` 报 unknown command |
| D2 🔒 删掉整个 `src/core/sync/`(含 schema.sql)、`__tests__/core/sync/`,依赖三处(markdown/cli、project/merge、cli/index)收口 | T-1 | 三处依赖的改法在任务原文逐条列死;统一验证 grep `src/core` 无 sync 引用 |
| D6 🔒 project 子系统新增「清理已下掉功能的数据」:DROP 13 张表 + 删 4 个文件 ×2 位置,不另做备份 | T-2 | 表清单与文件名 = C-3,输出原文 = C-2,函数形态 = C-4;出错只警告不中断 |
| D9 🔒 删掉整个 `src/core/task/`(含 schema.sql)与依赖处,会话登记读取方只剩 timeline | T-1 | 死 hook 五条清单 = C-1;会话开始提示挪移 = C-6(把 task hook 最后两个职责接走);统一验证 grep 无 task 引用 |

## 来源 spec 摘要

spec:`docs/features/2026-11-05-下掉web与平台同步/下掉web与平台同步-spec.md`(指纹 1fedd36)。六个功能点:F1 下掉本地 web、F2 下掉平台上报、F3 升级时清理、F4 下掉开发任务、F5 下掉会话交接、F6 下掉按任务算历时;细节决策 D1–D15;边界外:平台上的数据不动、按副本/worktree 记任务后期再补。

## 范围

- 覆盖功能点:F1、F2、F3、F4、F5、F6 全部。
- 撤掉的东西:三个子系统源码与测试、三个命令组(`cgraphx web` / `sync` / `task`)与隐藏命令 `sync-worker`、skill `dev-handoff`、agent `task-history`、spec 头部 `> 任务:` 的读写、交接文件流程、task 派历时。
- 新增/改动的东西:安装器升级清理(T-2)、features 只认内置类型与「需求环节」(T-3)、replica `feature_has_replica`(T-4)、时间线会话开始 hook 接管提示(T-1 内)、五个隐藏空命令(T-2)、流程与文档文字(T-5/T-6/T-7)。

## 明确不包含(功能方案的不做项)

- 平台服务端与平台上已有的数据:不动。
- 按需求副本 / git worktree 记任务、按任务算历时:后期计划,本次不做、不留半成品。
- `precommit-check` hook:不动(改成 git 原生钩子是下一个需求)。
- 时间线的 7 个 hook 与采集行为:不动(等「会话文件解析替代hooks」)。
- 旧 spec 里留着的 `> 任务:` 行、以前写好的交接文件、收口档案里的「实际投入」行:不删不改,且不得因此出现新的警告或失败。
- `features list / sync`、db-query、report、release、replica 其余行为:不动。
- 根目录其他文档(README、我们的流程解决的问题.md 等):不在本次范围(spec 文档改动表只列 CLAUDE.md、CHANGELOG.md)。

## 任务清单

| 任务 | 文件 | 对应 spec | 涉及范围(概要) |
|---|---|---|---|
| T-1 撤掉 web、sync、task 子系统与依赖处 | `plan/下掉web与平台同步-01-撤掉web-sync-task子系统.md` | F1 D1、F2 D2、F4 D9/D10、D7 | 删 `src/web/`、`src/core/sync/`、`src/core/task/`、`__tests__/web/`、`__tests__/core/sync/`;改 `src/cli/index.ts`、`src/cli/installer/agent-steps.ts`、`src/cli/installer/index.ts`(仅注释)、`src/core/markdown/cli.ts`、`src/core/project/merge.ts`、`merge-files.ts`、`remove.ts`、`src/core/timeline/hooks.ts`、`src/core/skill-version/index.ts`、`skill-version/constants.ts`、`scripts/copy-assets.cjs`、`package.json` |
| T-2 安装器升级清理 | `plan/下掉web与平台同步-02-安装器升级清理.md` | F3 D5、D6、D8、K2、K3 | 改 `src/cli/installer/targets/agent-target.ts`、`src/cli/installer/index.ts`、`src/cli/index.ts`(一行注册);新增 `src/core/project/` 清理模块 + 门面导出;新增 `src/cli/` 隐藏空命令文件 |
| T-3 features 只认内置类型与需求环节 | `plan/下掉web与平台同步-03-features只认内置类型与需求环节.md` | F2 D3、D4、K1、K6;F4 D11 | 改 `src/core/features/check.ts`、`cli.ts`、`show.ts`、`scanner.ts`、`types.ts`、`index.ts`、`src/core/artifact-registry/header.ts` |
| T-4 replica 一个需求一个副本 | `plan/下掉web与平台同步-04-replica一个需求一个副本.md` | F5③ D13 | 改 `src/core/replica/create.ts`、`errors.ts` |
| T-5 skill 与命令模板收口 | `plan/下掉web与平台同步-05-skill与命令模板收口.md` | F2、F4、F5 D12、F6 D14 | 改 `assets/claude-template/` 下 13 个文件(12 个流程文件 + dev-wireframe 示例页一行);删 `skills/dev-handoff/`、`agents/task-history.md`;改 `deprecated-assets.json` |
| T-6 知识库条目改版 | `plan/下掉web与平台同步-06-知识库条目改版.md` | D15 | 改 `docs/knowledge/` 11 个文件 + validate + 重建索引 |
| T-7 仓库文档 | `plan/下掉web与平台同步-07-仓库文档.md` | 全局约束 | 改 `CLAUDE.md`、`CHANGELOG.md` |

## 执行顺序

- **第一步(以下四个可同时跑,改的文件互不重叠)**:T-1、T-4、T-5、T-6。
- **第二步(以下三个可同时跑,改的文件互不重叠;都必须在 T-1 之后)**:
  - T-2:依赖 T-1 已删掉 sync/task 子系统(agent-steps 不再装它们的 hook,死 hook 清理与空命令才有意义)。
  - T-3:依赖 T-1 已删掉 `src/core/task/`(`task/feature-task.ts` 是 `readFeatureTask`/`scanFeatureTasks` 的唯一外部读取方,先删导出会弄断编译)。
  - T-7:描述终态,放最后一步。

## 必须严格执行的契约

- **C-1 死 hook 五条子命令名与匹配规则(D5/K2)**:`isDeadHookCommand` 新增认五条——`sync-session-start-hook`、`sync-stop-hook`、`task-session-start-hook`、`task-stop-hook`、`task-post-tool-use-hook`。匹配规则:命令串里含 `cgraphx <完整子命令名>` 即算,子命令名后面带不带 `--agent <id>`、带不带容错后缀(` 2>/dev/null || true`)都算;**禁止**按 `cgraphx sync-` / `cgraphx task-` 前缀匹配(以后同前缀的新命令会被误删)。已有的三条(`cgraphx prompt-hook`、`codegraph mark-dirty`、`codegraph sync-if-dirty`)不变。
- **C-2 F3 清理输出三条原文**:
  1. 清掉旧 hook:`平台同步、开发任务已下掉:已移除 hooks(<事件名,用 / 连>)`——事件名取实际删掉的条目所属的 hook 事件(如 `SessionStart/Stop/SessionEnd`),去重;install 与 uninstall 两个路径都出,别的死 hook(1.x 那三条)删掉时**不**出这行。
  2. 清掉数据:`平台同步、开发任务的数据已清掉`——删了东西(表或文件任一)才出,什么都没删不出。
  3. 清理出错:`清理已下掉的功能失败:<原因>`——警告,不中断安装。
- **C-3 清数据范围(D6/K3)**:13 张表,`DROP TABLE IF EXISTS`,子表先删(排序逻辑照 `src/core/project/merge.ts` 的 `childFirstOrder`):五张 `sync_*`——`sync_schema_versions`、`sync_state`、`sync_sessions`、`sync_reference_records`、`sync_unreported_artifacts`;八张 `task_*`——`task_schema_versions`、`task_items`、`task_sessions`、`task_reminders`、`task_feature_tasks`、`task_auto_sessions`、`task_superseded_bindings`、`task_auto_meta`。四个文件:`sync.lock`、`sync-trigger`、`sync-worker.pid`、`task-source.json`,在**数据位置目录**与**本地 `.cgraphx/`** 两处都删。不另做备份(并旧数据的备份里已有旧库整份)。
- **C-4 清理函数形态(D6)**:归 project 子系统,经 `src/core/project/index.ts` 门面导出;只做清理、不打印(输出由安装器按 C-2 打);`cgraphx install` 在第 ⑦ 步(`settleProjectData`,认项目、并旧数据)之后调用;幂等(第二次 install 什么都没有、不输出);任何异常不抛,由调用方按 C-2 第 3 条打警告、安装继续。
- **C-5 五个隐藏空命令(D8)**:与 C-1 同名的五个子命令,单放一个 CLI 层新文件注册(不进任何 core 子系统),`{ hidden: true }`;接受 `--agent <id>` 选项(收下不解析);行为:把 stdin 读完到 EOF,不写 stdout/stderr,不读不写任何库与文件,退出码恒 0。
- **C-6 会话开始提示(D10/K4/K7/K8)**:全由 `src/core/timeline/hooks.ts` 的 `sessionStartHook` 输出。顺序:① skill 版本落后(压缩后重开不出,其余按版本比较)→ ② 自动记忆去向(仅 Claude Code 会话、本人本地设置 `autoMemoryEnabled === false`,压缩后重开也出)→ ③ git 钩子补不上的提示。每条各自独立 try/catch(哪条判断出错哪条不出,其余照出);多条用空行(`\n\n`)连成一段 `additionalContext`,一段都没有则 stdout 为空。`isAutoMemoryOff` 与 `autoMemoryOffContext` 从 `src/core/task/hooks.ts` 原样挪到 timeline(判断逻辑与文案不变,含只对 claude-code 生效的限定);`skill-version` 的 `hasTaskSessionStartHook` 函数与 `TASK_SESSION_START_COMMAND` 常量删除,落后提示不再看配置里有没有接任务 hook;不再输出「当前会话 id」那条。
- **C-7 `docs --session` 帮助文字(F2)**:`cgraphx docs find` / `docs show` 的 `--session` 选项保留、照收,帮助文字改成「已不起作用,只为兼容旧用法保留」,不再调 `recordReferenceHit`。
- **C-8 replica 拦截(D13/F5③)**:`cgraphx replica create` 开副本前查登记:同一 feature-id 已有状态为 `present` 的副本 → 抛新错误码 `feature_has_replica`,message 原文:「这个需求已经有副本 <副本目录名>;一个需求只开一个副本,要并行先把需求拆成几个需求目录」,什么都不建;状态 `missing`、`removed` 的不拦;`REPLICA_ERROR_CODES` 加该 code,退出码走既有 `exitCodeForError`(→ 2)。
- **C-9 版本与 CHANGELOG 口径(全局约束)**:改动随 2.0.14 发布;plan 与实现不改 `package.json` 的版本号(发版时 `npm version` 打)。CHANGELOG 在现有 `## Unreleased` 节下追加(与「data lives per project」同一未发布节),按该文件既有英文条目风格写明:去掉的命令(`cgraphx web`、`cgraphx sync`、`cgraphx task`)与 skill(`/dev-handoff`、task-history)、install 时的升级清理(hook + 数据 + 兼容空命令)、产物类型只认内置、「平台环节」改「需求环节」、replica 一需求一副本、收口档案历时简化。

## 细节方案核对(spec 设计决策表 → 任务)

| spec 决策 | 落进 | 备注 |
|---|---|---|
| D1 🔒 web 删除范围 | T-1 | 删除清单逐文件列死;`markdown-it`/`@types/markdown-it` 出依赖表 |
| D2 🔒 sync 删除范围与依赖三处 | T-1 | markdown/cli 按 C-7;project/merge 按 D7(T-1);cli/index 收口 |
| D3 产物类型只认内置 | T-3 | check 入参与 `unknown_type` 文案在 T-3 内联定死 |
| D4 需求环节 | T-3 | 文案原文与「算法不动」在 T-3 内联定死;`--json` 字段名不变(除删掉的 `task`、`customTypes`) |
| D5 旧 hook 清理 | T-2 | 按 C-1、C-2;install/uninstall 都扫,不看勾了哪些子系统 |
| D6 🔒 清数据 | T-2 | 按 C-2、C-3、C-4 |
| D7 并旧数据 | T-1 | merge.ts 去掉 task/sync 并入;判定与删旧表保持含 `task_*`/`sync_*` 不变 |
| D8 隐藏空命令 | T-2 | 按 C-5 |
| D9 🔒 task 删除范围 | T-1 | 依赖处逐条列死 |
| D10 会话开始提示 | T-1 | 按 C-6 |
| D11 `> 任务:` 头部 | T-3 | 读、显、查三处都去;旧 spec 不得出新警告 |
| D12 澄清进度写进讨论稿 | T-5 | 只改 skill 文字 |
| D13 一需求一副本 | T-4 | 按 C-8 |
| D14 收口档案历时 | T-5 | 只留「立项 · 完成 · 日历跨度」一行;task-history 删除并登记 |
| D15 知识库条目 | T-6 | 六篇 deprecated + 五篇改段落 |

拆解中未发现选型缺口;spec 待确认项为「无」。

## 适用规范

- `docs/guides/coding-standards.md` —— 全部动代码任务(T-1~T-4):边界与结构(门面、copy-assets 登记)、选型(禁 chalk、中文注释)、错误与日志。
- `docs/guides/interface-standards.md` —— T-1(cli/index.ts 命令注册)、T-2(新隐藏命令,见其「Hook 子命令契约」节)、T-3(`--json` 与退出码)。
- `docs/guides/git-standards.md` —— 不逐任务标注,结晶进下节「提交规范」。
- `docs/guides/data-standards.md` —— **例外**:本次只对包内表(`sync_*`、`task_*`)做 `DROP TABLE IF EXISTS`,不建不改业务表;spec 全局约束明确包内表不走该文件「Schema 变更约定」的全量/增量维护(该节约束目标项目的业务库)。各任务不标 data-standards。
- `docs/guides/testing-standards.md` —— 不适用(plan 不排测试;新测试由 `unit-spec`/`unit-code` 流程另行派生)。

## 提交规范(从 git-standards.md 结晶,plan 级一次)

- 消息格式:`type(scope): 中文描述`(Conventional Commits + 中文)。type 用 feat / refactor / fix / docs;scope 常用 skills / installer,仓库级改动省 scope。补充说明用「——」,并列用「+」。无票据关联(需求追踪走 `docs/features/`,不进标题)。非琐碎提交写 body:背景一行 +「-」列要点。
- 提交前检查点(precommit-check 门禁兜底,提交人自查):
  - 与 TS 同放的运行时资产已登记 `scripts/copy-assets.cjs`(本次是**删**登记项,别留尸);
  - `src/core/` 不得出现对 `src/cli` / `src/web` 的 import;
  - `schema.sql` 保留 `IF NOT EXISTS`(本次只删 schema,不新增);
  - timeline hook 链路的 DB 写入必须 await、抛错要吞;
  - `vitest.config.ts` 的 `TZ: 'UTC'` 钉死不改;
  - 不留「被注释掉的命令注册 / hook 接入项」——删就删干净,不许注释掉 `.command(...)` 或 settings hooks 糊弄;
  - 不写死魔法值(绝对路径、密钥、阈值、版本号);
  - 不新增 TODO / FIXME。

## 统一验证(全部任务做完后跑)

```bash
npm run clean && npm run build                                 # ① 干净构建通过(tsc 不清 dist,先清掉旧产物,否则 ② 会假命中)
ls dist/web dist/core/sync dist/core/task 2>&1                 # ② 三者都应「No such file or directory」
node -e "const p=require('./package.json');console.log(p.dependencies['markdown-it'], p.devDependencies?.['@types/markdown-it'])"  # ③ undefined undefined
node dist/cli/index.js web;  echo "exit=$?"                    # ④ error: unknown command 'web',exit=1(sync、task 同)
node dist/cli/index.js sync-stop-hook --agent codebuddy </dev/null; echo "exit=$?"   # ⑤ 无输出,exit=0(五个空命令各试一次)
grep -rn "core/sync\|core/task\|from '\.\./web\|from '\.\./\.\./web" src/            # ⑥ 无命中(features 自己的 './sync' 不在模式内)
npm test                                                       # ⑦ 全量测试通过
node dist/cli/index.js features show 2026-11-05-下掉web与平台同步                 # ⑧ 标题「需求环节(按默认类型表)」、无「任务」行、末行「实现、知识经验:由提交和会话承载,不按产物算」
node dist/cli/index.js features check                          # ⑨ 本需求目录全部通过(旧 spec 的 > 任务: 行不引新警告)
cgraphx docs validate                                          # ⑩ 知识库改版后全合法
```

允许局部适配的范围:见各任务文件「允许局部适配」;总体上,注释措辞、新增文件的命名与内部组织、不影响行为的等价写法可自定;**契约(C-1~C-9)、输出原文、删除范围、判定口径不得变**。

## Plan 冲突上报规则

任务与 spec / 本 plan 冲突时:以 spec 为最高权威,plan 次之;实现中发现冲突或缺口,停下来在回报里按 `PLAN_CONFLICT: <任务编号> <冲突点>` 上报主会话,不自行拍板、不就地绕过。

## 关键风险与防跑偏约束

- **安装与并旧数据是关键路径**:`project/merge.ts`、`agent-steps.ts` 的改动**只删不重组**,不顺手重构锁、备份、事务结构。
- **会话开始 hook 每次会话都跑**:timeline/hooks.ts 的改动保持 fail-silent(每条提示独立 try/catch,任何一条出错不阻塞会话、不拖慢 hook)。
- **不得弄红既有测试**:本次删掉的测试(`__tests__/web/`、`__tests__/core/sync/`)随子系统删;其余既有测试(`dead-hook-cleanup`、`timeline/installer`、`features/scanner`、`markdown/facade` 等)如因改动变红,须在对应任务里同步修正到绿。
- **旧数据兼容**:升级前拉起的上报 worker 如果正在跑,可能把 `sync_*` 表建回来——D6 下次 install 再清,本次不处理(spec D6 影响面已记)。
- **防扩范围**:不动 `precommit-check`、不动时间线采集、不动 db-query/report/release/replica 其余行为、不做「按副本记任务」的任何预留。

## 待确认项

- 无。

## 启动语

大需求(变更文件远超 10 个、跨 cli/installer/features/project/timeline/replica/assets/docs 多个独立模块),用 subagent 方式执行:

```
/dev-impl-subagent docs/features/2026-11-05-下掉web与平台同步/plan/下掉web与平台同步-index.md
```
