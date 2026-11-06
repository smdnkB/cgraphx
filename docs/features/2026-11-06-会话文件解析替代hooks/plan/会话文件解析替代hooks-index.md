# 实现计划: 会话文件解析替代hooks

> 产物: plan
> 依据: spec@eac0b58

## 设计预览

原来时间线靠 7 条接进 agent 配置的 hook 实时记事件,提交门禁挂在 agent 的 PreToolUse hook 上按命令文字拦。这次采集改成**查时间线之前解析 agent 自己留下的会话文件**:timeline 子系统新增 `ingest/` 解析层(Claude Code、CodeBuddy 两家各一个读取器,只产统一「会话事实」),进度和文件索引放用户级新库 `~/.cgraphx/sessions.db`(基础层新模块 `session-index.ts`);门禁搬进 git 的 commit-msg 钩子(新增轻形态子系统 `src/core/commit-gate/`,退出码 3 打回,`--no-verify` 跳得过、跳过的在提交记录上标出来);会话开始的三条提示改由 commander 根命令统一输出(新文件 `src/core/session-notices.ts`);install/uninstall 撤掉全部 agent hook、清 7 条旧 hook 死条目,只装 git 钩子片段;升级后第一次 install 或第一次查时间线时,清掉 hook 记的旧事件、按解析全量重建(提交记录保留,并旧数据从此只并提交记录)。

**难回头的决策落在哪**(决策已在 spec 确认,这里核对落点,其余可略读)

| spec 决策 | 落在 | 怎么守住 |
|---|---|---|
| D1 🔒 解析放 timeline/ingest/,每家 agent 一个读取器、只产「会话事实」不碰库;agents 只描述差异 | T-2 `timeline/ingest/types.ts`、`claude-transcript.ts`、`codebuddy-transcript.ts` | 事实模型不含库句柄与项目归属,读取器只经 agents 门面取根目录与标识(C-1、C-7) |
| D2 🔒 进度存用户级 `~/.cgraphx/sessions.db`(0600,四表),不随项目数据删 | T-1 `src/core/session-index.ts`、`project/remove.ts`、`project/name.ts` | 库在用户目录、权限 0600;project remove 只写 `removed_projects` 不动偏移;改名只清 `start_dirs`(C-3) |
| D5 🔒 `timeline_events` 加 `source_key` 列 + 部分唯一索引去重,不升 schema 版本号 | T-3 `timeline/schema.sql`、`schema-bootstrap.ts`、`store.ts` | 键格式四类钉死、写入 INSERT OR IGNORE、`TIMELINE_SCHEMA_VERSION` 不动(C-2) |
| D10 🔒 门禁独立轻形态子系统 `src/core/commit-gate/`,只用 commit-msg 一个钩子 | T-5 `src/core/commit-gate/` | 只依赖 release、agents、git-hooks 门面(features check 经子进程);退出码只有 0/3(C-5) |

## 来源 spec 摘要

`docs/features/2026-11-06-会话文件解析替代hooks/会话文件解析替代hooks-spec.md`(指纹 eac0b58)。六个功能点:F1 会话文件补录时间线(核心,K1–K11、K25)、F2 agent 提交走 git 钩子门禁(核心,K12–K15、K26、K27)、F3 跳过门禁的提交可查(K16)、F4 会话开始的提示改由命令输出(K17–K20)、F5 撤掉 agent hooks(K21、K22)、F6 清掉旧采集数据、按解析重建(K23、K24);细节方案 D1–D20;全局约束(不变项、`CGRAPHX_NO_TIMELINE` 管采集不管门禁、git 钩子片段不得让提交失败、`sessions.db` 不走 data-standards、core 不依赖 cli、ingest 只经 agents 门面取差异)。

## 范围

F1–F6 全部功能点,含 spec「文档与知识库」节列出的 skill 文档、知识库与本仓库 CLAUDE.md / CHANGELOG 更新。

## 明确不包含(spec 不做项)

- 读 Codex 的会话文件(不做)
- 读仓库根 `session.v4.jsonl` 那种格式(不做)
- 上下文用量显示(context-monitor / statusLine,不动)
- 人手动提交也过检查(不做;版本分支拦截照旧对所有提交生效)
- 不排测试任务:单元测试、接口测试是代码完成后的独立流程(unit-spec → unit-code);实现期只要求既有测试不被弄红(弄红的同步修正,见 T-8)

## 任务清单

| 任务 | 文件 | 对应 spec | 涉及范围(文件) |
|---|---|---|---|
| T-1 agents 描述扩展 + sessions.db 索引库 | `01-agents描述与会话索引库.md` | D1(描述侧)、D2、D3(索引侧) | `agents/types.ts`、`agents/profiles.ts`、`agents/index.ts`、新增 `core/session-index.ts`、`project/remove.ts`、`project/name.ts` |
| T-2 会话文件读取器 | `02-会话文件读取器.md` | D1 🔒、D6、D7、D8(解析)、K4–K10 | 新增 `timeline/ingest/types.ts`、`timeline/ingest/claude-transcript.ts`、`timeline/ingest/codebuddy-transcript.ts`、`timeline/ingest/reader.ts` |
| T-3 补录管线与去重 | `03-补录管线与去重.md` | D3、D4、D5 🔒、D6(轮次编号)、D9、K1–K3、K11、K25 | `timeline/schema.sql`、`timeline/schema-bootstrap.ts`、`timeline/store.ts`、`timeline/cli.ts`、`timeline/index.ts`、新增 `timeline/ingest/ingest.ts`、`timeline/kill-switch.ts` |
| T-4 重建与并旧数据收窄 | `04-重建与并旧数据收窄.md` | D19、D20、K23、K24 | 新增 `timeline/ingest/rebuild.ts`、`timeline/merge.ts`、`timeline/types.ts`、`project/merge-files.ts`、`project/types.ts`、`cli/installer/index.ts`、`cli/installer/project-steps.ts` |
| T-5 commit-gate 门禁子系统 | `05-commit-gate门禁子系统.md` | D10 🔒、D11、D12、D13、K12–K15、K26、K27 | 新增 `commit-gate/index.ts`、`commit-gate/cli.ts`、`commit-gate/constants.ts`、`commit-gate/gate.ts`;`cli/index.ts`、`release/index.ts`(补导出) |
| T-6 跳过门禁标记与提交后台任务 | `06-跳过门禁标记与提交后台任务.md` | D13(前台侧)、D14、D15、K16 | `timeline/git-commit.ts`、`timeline/installer.ts`、`timeline/describe.ts`、`timeline/constants.ts` |
| T-7 会话提示改命令输出 | `07-会话提示改命令输出.md` | D16、K17–K20 | 新增 `core/session-notices.ts`;`cli/index.ts` |
| T-8 撤掉 agent hooks 与死代码清理 | `08-撤掉agent-hooks与死代码清理.md` | D17、D18、K21、K22、F5 行为链 | `agents/types.ts`、`agents/profiles.ts`、`agents/index.ts`、删 `timeline/{hooks,hook-runner,payload,turn-state}.ts`、删 `core/session-registry.ts`、`timeline/{constants,cli,installer,index,store,indexer}.ts`、`cli/legacy-hook-commands.ts`、`cli/installer/{index,agent-steps}.ts`、`cli/installer/targets/agent-target.ts`、`core/user-data-dir.ts`、`core/project/index.ts`(头注释与死代码清理)、`deprecated-assets.json`、删 `assets/claude-template/hooks/precommit-check/`、同步修既有测试 |
| T-9 skill 模板文档更新 | `09-skill模板文档更新.md` | F1(D8 影响面)、F2、F3、F5 的文档行 | `assets/claude-template/skills/`(doc-report、release-review、dev-impl、dev-impl-subagent、doc-backfill、init-guides、cgraphx-guide、dev-clarify、dev-merge、dev-start 中实际提及处)、`assets/claude-template/FLOW-MAP.md`、`assets/claude-template/CLAUDE.md` |
| T-10 知识库与本仓库文档 | `10-知识库与本仓库文档.md` | 「文档与知识库」节 | `docs/knowledge/` 7 篇改写、本仓库 `CLAUDE.md`、`CHANGELOG.md`、`docs/guides/interface-standards.md`(hook 子命令契约节按新命令面更新) |

## 执行顺序

| 步 | 任务 | 说明 |
|---|---|---|
| 1 | T-1 | 一切的地基:agents 描述字段 + sessions.db |
| 2 | T-2 | 读取器,依赖 T-1 的 C-7 |
| 3 | T-3 ∥ T-5 | 可同时:T-3 只动 timeline 及其 ingest;T-5 是全新目录 + `cli/index.ts`,文件不重叠 |
| 4 | T-4 ∥ T-6 ∥ T-7 | 可同时:T-4 动 ingest/rebuild、merge、installer;T-6 动 git-commit、installer(timeline)、describe;T-7 动 session-notices + `cli/index.ts`。文件互不重叠(T-5 与 T-7 都动 `cli/index.ts`,已分在两步) |
| 5 | T-8 | 撤 hooks 必须在 T-3/T-4/T-6/T-7 之后(死代码的替代品全部就位) |
| 6 | T-9 ∥ T-10 | 文档收尾,文件不重叠 |

## 必须严格执行的契约

- **C-1 会话事实模型**(`timeline/ingest/types.ts` 定义,读取器与管线共用):读取器输入(文件绝对路径、起始字节偏移),输出 `{ facts: SessionFact[]; consumedBytes: number }`,其中 `SessionFact` 只有五种:`prompt`(uuid、ts、文本、来源 user / auto_message 的 source)、`tool`(tool_use_id、工具名、发出 ts、参数、结果 ts、结果载荷、is_error、可选 subagent {id,type})、`turn_end`(ts、回复 message.id)、`session_head`(sessionId、start_cwd、该会话首条消息 ts)——**每个 sessionId 在本文件首次出现处产一个 session_head**(分叉文件开头拷来的旧会话行也产旧会话的头,键按会话编号去重,见 C-2)。**读取器不打开任何库、不知道项目归属、不生成事件类型与 source_key**;CodeBuddy 的 `status` 字段映射进 is_error(completed→成功,incomplete→失败,见 T-2 待确认)。
- **C-2 source_key 与去重**:键格式钉死——提问 `<agent>:prompt:<uuid>`,工具 `<agent>:tool:<tool_use_id>`,轮次结束 `<agent>:stop:<回复 message.id>`,会话开始 `<agent>:start:<会话编号>`(`<agent>` 取 agents 描述的 id)。`timeline_events` 加列 `source_key TEXT` + `CREATE UNIQUE INDEX IF NOT EXISTS timeline_events_source_key_uidx ON timeline_events(source_key) WHERE source_key IS NOT NULL`;schema.sql(新库)与 `ensureSourceKeyColumn`(旧库,写法同 `ensureAgentColumn`)双写;**不升 `TIMELINE_SCHEMA_VERSION`**;`store.insert` 的 INSERT 改 `INSERT OR IGNORE`(无键行不进部分索引,行为不变);git_commit 不带键、去重照旧走 commit_hash。
- **C-3 sessions.db**:路径 `~/.cgraphx/sessions.db`(`userDataRoot()` 下),文件权限 0600;四表列名钉死——`session_files(path 主键, agent, session_id, start_cwd, project_dir, byte_offset, size, mtime_ms, updated_at)`、`start_dirs(cwd 主键, root, origin, name, project_dir, classified_at)`、`removed_projects(identity_key 主键, removed_at)`、`notices_shown(scope 主键, shown_at)`;`identity_key = JSON.stringify({origin, name})`(字段序固定);建表 SQL 直接写在 `core/session-index.ts`(幂等 CREATE TABLE IF NOT EXISTS),**不新增随包资产、不动 `scripts/copy-assets.cjs`**;改名只清 `start_dirs` 中受影响根的行(偏移不动);`project remove` 写 `removed_projects`、不动偏移;`notices_shown` 打开时删 30 天前的行。
- **C-4 timeline 门面补录入口**:导出 `ensureTimelineUpToDate(start: string): { status: 'synced' | 'rebuilt' | 'busy' | 'failed' | 'skipped-disabled' | 'skipped-legacy'; sessions?: number; events?: number; notices: string[]; reason?: string }` 与 `describeSyncOutcome(outcome): string[]`(人读提示渲染,原文按 F1/F6 图)。内部顺序:开关关闭→`skipped-disabled` 不做任何事;`hasUnmergedLegacyData(start)`(经 **project 门面**取,接受 timeline⇄project 双向引用——spec D3 定的复用,运行期函数调用无碍)→`skipped-legacy`(提示「这个目录还没装新版…cgraphx install 补齐」);`timeline_meta` 无 `rebuilt_at`→走 F6 重建(T-4)后增量;否则增量补录(T-3)。三个调用方:timeline 四个查询命令(T-3)、post-commit 后台进程(T-6)、install 并旧数据之后(T-4)。
- **C-5 commit-gate 隐藏命令**:`cgraphx commit-gate-hook <说明文件路径>`(隐藏、顶层);退出码只有 0(放行,含检查跑不起来/超时/放行分支)与 3(打回,stderr 打 F2 图的打回原文);只要没打回就把 `git write-tree` 结果写进 `<git 目录>/cgraphx/commit-gate-pass`;门面同时导出 `installCommitGate(cwd)` / `removeCommitGate(cwd)`(经基础层 `installHookSnippet` / `removeHookSnippet`)。
- **C-6 门禁 sh 片段**:marker `# cgraphx-commit-gate`;片段先看会话变量——名单从 agents 描述 `sessionIdEnv` 生成,没有任何已登记变量就不起 node;有才调 C-5 的隐藏命令,**只有退出码 3 才打回**(`command not found`、旧版报未知命令、任何异常都放行);每行带 marker;兼容 `#!/bin/sh -e`(命令替换带 `|| true` 写法,同现有片段);重装按 marker 先删旧行。
- **C-7 agents 描述新增字段**:`AgentProfile` 加 `readonly sessionsDir: readonly string[] | null`(相对家目录的段,claude-code `['.claude','projects']`、codebuddy `['.codebuddy','projects']`)与 `readonly sessionsDirEnv: string | null`(claude-code `'CLAUDE_CONFIG_DIR'`、codebuddy `null`);agents 门面导出 `agentSessionsRoot(profile): string | null`(env 设了优先,`path.join(env, …segments)` / `path.join(homedir, …segments)`)与读取器标识 `sessionReader: 'claude-transcript' | 'codebuddy-transcript'`。T-8 再从描述删 `capabilities.postToolUseFailure` 与 `writeTools`。
- **C-8 跳过门禁标记**:判定成立的 agent 提交写 `timeline_events.metadata.gate = 'skipped'`;`describeEvent` 对带标记的 git_commit 摘要追加「跳过门禁」。
- **C-9 提示 scope 与挂点**:scope 取 `session:<会话编号>`(有会话变量,`resolveSessionIdFromEnv`)或 `day:<项目根>:<本地日期 YYYY-MM-DD>`(没有);记在 `notices_shown`;提示经 commander 根命令的统一挂点(T-7)输出到 **stderr**,整体 try/catch;隐藏命令、git 钩子调起的命令、`--help`、`--version`、`version` 不算一条。
- **C-10 不再记录的事件类型**:`pre_tool_use`、`session_end` 不再写新数据;`--type` 选项与显示照旧认这两种类型(旧数据没了只是查不到);`store.getMostRecentPre` / `indexer.getMostRecentPre` 删掉(T-8,与 hooks 删除同步)。
- **C-11 post-commit 片段新增环境变量**:前台取好传给后台进程,常量放 `timeline/constants.ts`——`CGRAPHX_GATE_TREE`(commit-gate-pass 文件内容)、`CGRAPHX_CHERRY_PICK`(有 `CHERRY_PICK_HEAD` 时为 `1`)、`CGRAPHX_REBASE`(`rebase-merge` / `rebase-apply` 在时为 `1`);与现有 `COMMIT_SHA_ENV` 同法。

## 细节方案核对(spec 设计决策表逐条落点)

| spec | 落点 | 核对 |
|---|---|---|
| D1 🔒 | T-2(ingest/ + 读取器)、T-1(agents 描述字段) | 门面导出补录入口在 T-3(C-4);接新 agent = 加描述字段 + 一个读取器 |
| D2 🔒 | T-1(session-index.ts、remove、name) | 库名 sessions.db 不叫 cgraphx.db(根下无库);进度不随项目删(K3) |
| D3 | T-1(索引写入)、T-3(找文件与归属判定) | `CLAUDE_CONFIG_DIR` 优先(C-7);`locateDataAtRoot` / `hasUnmergedLegacyData` 直接复用 |
| D4 | T-3 | 按字节偏移读到最后一一个换行;文件变短从头重读靠 C-2 去重;先写库后更新偏移 |
| D5 🔒 | T-3 | C-2 |
| D6 | T-2(提问/自动消息/斜杠命令/queued_command 识别)、T-3(轮次编号取提问 uuid) | `classifyAutoMessage` 复用;99 条自动消息差异按待确认项校准,不改结构 |
| D7 | T-2 | `sanitizeToolArgs` / `summarizeToolResponse` / is_error 分支复用;`cwd` 取调用行;`duration_source: 'transcript'` |
| D8 | T-2(turn_end / session_head 事实)、T-3(事件映射)、T-9(doc-report 文档) | C-10;`/doc-report` 事件种类段由 T-9 改 |
| D9 | T-3(入口、锁、K11、stderr)、T-6(post-commit 调用) | ingest.lock 写法沿用 merge-files 锁,等 3 秒 |
| D10 🔒 | T-5 | C-5;只用 commit-msg |
| D11 | T-5 | C-6;人手动提交不起 node(片段先看会话变量) |
| D12 | T-5 | K26 规则常量经 release 门面取(`VERSION_BRANCH_PATTERN`;`RELEASE_FLOW_CONFIG_KEY` 需在 T-5 补进 `release/index.ts` 导出);K13 按 `MERGE_MSG` 文件名;K14 子进程 15 秒超时只拦 failures>0;K15 提示原文搬自 precommit-check.cjs,guide 路径相对工作区根 |
| D13 | T-5(写记号)、T-6(前台读删并传 `CGRAPHX_GATE_TREE`) | `git write-tree` 只写对象不动索引 |
| D14 | T-6 | `metadata.gate = 'skipped'`(C-8);post-merge 调起一律不判 |
| D15 | T-6(后台任务:记提交→判跳过→补片段→补录)、T-9(release-review 新节) | `describeEvent` 改动在 T-6 |
| D16 | T-7 | C-9;判断函数与原文从 `timeline/hooks.ts` 挪到 `core/session-notices.ts` |
| D17 | T-8 | `isDeadHookCommand` 加 7 条完整子命令名 + 认 `/hooks/precommit-check/precommit-check.cjs`;7 个空命令进 `legacy-hook-commands.ts`;`hooks/precommit-check` 进废弃清单 |
| D18 | T-8 | 提交记录片段照旧看勾选;门禁片段选了 agent 就装、不看勾选;卸载走 `gitHookKeptFor` 判断(`listOtherInstalledDirs`) |
| D19 | T-4 | 临时库 + ATTACH 短事务;删 `turns/`、`~/.cgraphx/sessions/`;死代码清单(session-registry、turn-state、hook-runner、payload、hooks 的 agent hook 部分)在 T-8 删 |
| D20 | T-4 | merger 只并 git_commit 与 timeline_roots;id 对照与进度换算删;输出改「并了多少提交」 |

## 适用规范

| 任务 | 强制引用 |
|---|---|
| T-1、T-3、T-4(动表) | `docs/guides/data-standards.md`(例外见「关键风险」第 2 条,记自 spec 全局约束)+ `docs/guides/coding-standards.md` |
| T-3、T-5、T-7(CLI 命令面/退出码) | `docs/guides/interface-standards.md` + `docs/guides/coding-standards.md` |
| 其余动代码任务(T-2、T-6、T-8) | `docs/guides/coding-standards.md` |
| T-9、T-10(文档) | 无 |

`coding-standards.md` 本章要点(结晶):core 永不依赖 cli;子系统标准形态(门面 + cli + types + errors + constants);门面是硬约定;禁 chalk;枚举用 `as const`;注释中文;单文件超 600 行必须拆;每子系统自有 errors.ts;CLI 错误映射退出码。commit-gate 遵循轻形态(门面 + cli + errors + constants,无库表,同 replica / release)。

## 提交规范(从 `docs/guides/git-standards.md` 结晶,实施期不再现读)

**消息格式**:`type(scope): 中文描述`——type 用 feat / refactor / fix / docs;scope 常用 skills / installer / timeline 等,仓库级改动省 scope;补充说明用「——」、并列用「+」、数值对比用「→」;无票据关联(需求追踪走 `docs/features/`);非琐碎提交写 body(背景一行 + "-" 列要点)。

**提交前检查点**(逐项自查 `git diff --cached`,命中报告用户):
- 与 TS 同放的运行时资产未登记 `scripts/copy-assets.cjs`(本 plan 无新增资产,C-3 已定不新增)
- `src/core` 出现对 `src/cli` 的 import
- `schema.sql` 丢失 `IF NOT EXISTS`
- timeline 链路出现未 await 的 DB 写入 / 抛错不吞(补录与后台任务同样适用)
- `vitest.config.ts` 的 `TZ: 'UTC'` 钉死被改
- 被注释掉的命令注册 / hook 接入项
- 写死的魔法值(绝对路径、密钥、阈值、版本号)
- 新增 TODO / FIXME

## 统一验证(全部任务完成后)

```bash
npm run build                                   # 构建通过
npm test                                        # 全量测试通过(既有测试被改动弄红的已在各任务同步修正)
node dist/cli/index.js timeline query --limit 5 --format table   # 本仓库实测:输出事件 + 无报错
grep -rn "session-registry\|turn-state" src/    # 无输出(设计验收 13;user-data-dir/project/index 的注释清理见 T-8)
ls dist/.claude-template/hooks/                 # 只剩 context-monitor(设计验收 13)
```

> 注意:统一验证的 `timeline query` 是本仓库装新版后第一次查时间线,会按 F6 **真实重建**本仓库的时间线(项目库里 hook 记的事件被清掉,提交记录保留)——这是 spec 定的预期行为,不可逆;跑之前知会用户一声。

## 允许局部适配

- `timeline/ingest/` 内部文件划分(除 C-1 钉死的 types.ts 事实模型)、函数命名、导出组织。
- 读取器的行级解析实现(JSONL 行字段读取、类型判定的内部结构),行为以 C-1 与 spec K4–K10 口径为准。
- C-6 门禁 sh 片段的逐字写法(在「只有退出码 3 打回、兼容 sh -e、带 marker」的行为约束内)。
- T-8 精简 `installTimelineHooks` 报告字段后的日志文案;`timeline install/uninstall` 的报告 JSON 形状(保持向后兼容的键尽量保留)。
- T-9 各 skill 文件的具体措辞(机制说法改 git 钩子、用法不变的口径不变)。
- commit-gate 内部模块拆分(gate 判定、记号读写可再分文件)。

## Plan 冲突上报规则

任务文件与 spec 冲突时,以 spec 为准并按 `PLAN_CONFLICT` 上报主会话,不就地拍板;spec 未定且影响契约的细节,同样上报而不是自行决定。

## 关键风险与防跑偏约束

1. **读路径从只读变可能写库**(D9 影响面):补录必须完全包在 try/catch 里,任何失败只产出 stderr 提示,查询命令的退出码与 stdout 输出不受影响;`--json` 的 stdout 不得混入提示。
2. **data-standards 例外**(spec 全局约束,记例外):`sessions.db` 是 cgraphx 自身基础设施,不走目标项目「Schema 变更约定」的全量/增量双层维护;`timeline_events` 加列沿用包内表做法(`ensureAgentColumn` 同款)。除此之外任何表变更仍按规范。
3. **不升 schema 版本号是硬约束**(D5):升了会让旧版全局 cgraphx 打开库报错、hook 不再记录。
4. **git 钩子片段不得让提交失败**(全局约束):门禁打回只来自隐藏命令退出码 3;`command not found`、node 崩溃、超时全部放行。
5. **顺序纪律**:T-8 必须最后做代码任务——它删除的 `hooks.ts` 等文件的替代品(T-3 补录、T-6 提交链路、T-7 提示)必须先就位;先删会弄红全量测试。
6. **既有测试同步修正**:T-8 删 hook 体系会大面积弄红 `__tests__/core/timeline/` 既有用例,须同步删除/修正(这是修正被弄红的既有测试,不是新增测试)。
7. **`~/.claude/projects` 目录名有损编码**(D3 没选只扫编码目录的原因):归属判定只信文件行内 cwd,不反解目录名;测试一律经 `__tests__/setup-home.ts` 临时 HOME,不碰真实 `~/.claude`。
8. **回放对比先于管线定稿**:D6 的自动消息口径差异(99 条)在 T-2 校准,校准结果只改读取器识别规则,不改 C-1/C-2 结构。

## 待确认项

- 【待确认】CodeBuddy 解析细节(spec 待确认项 1):子 agent 文件布局、`status` 字段含义、斜杠命令与自动消息原文——T-2 第一步用本机已装的 2.167.0 实测回填,不阻塞结构。
- 【待确认】Claude Code 自动消息 hook 404 条 vs 原型 503 条的 99 条差异(spec 待确认项 2):T-2 按设计验收 1 回放校准 D6 后锁定;若校准结论影响 C-1 事实模型(如 `queued_command` 需要独立事实种类),上报主会话回 spec 补决策,不在实现期改契约。

## 启动语

大需求(预估变更 40+ 文件、跨 agents / timeline / commit-gate / installer / assets 五个模块),用子 agent 流程跑:

```
/dev-impl-subagent docs/features/2026-11-06-会话文件解析替代hooks/plan/会话文件解析替代hooks-index.md
```
