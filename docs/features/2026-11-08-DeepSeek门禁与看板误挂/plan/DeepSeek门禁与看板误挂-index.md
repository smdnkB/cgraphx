# 实现计划: DeepSeek 门禁与会话归属、看板流程命令、子会话标题

> 产物: plan
> 依据: spec@5852da8

## 设计预览

原来 DeepSeek 的提交既不过门禁、也不记到会话上;看板把 `/dev-merge agent看板优化` 同时挂到「agent看板」和「agent看板优化」;DeepSeek 子会话的标题会盖掉主会话的标题。这次改动落在五块:`src/core/agents` 给会话来源登记 `DSH_SESSION_ID` 并让解析按来源取值;`commit-gate` + `timeline/git-commit` 把 DSH 加进门禁片段、按来源判「跳过门禁」、提交记原始会话编号;`session-notices` 在没有 agent 描述时按已装 agent 判断;`board/match` 用「任务标题 / feature-id / 副本目录名」三个完整名字 + 第一个词判流程命令;`timeline/ingest` 不产子会话标题,并用一次性记号把 DeepSeek 已有标题重算一遍。最后同步知识库、CLAUDE.md 与 CHANGELOG。不新增表、不升 schema 版本、不改任何对外 HTTP 接口。

spec 没有标 🔒 的难回头决策(删掉子会话映射后),这里只核对落点。

## 来源 spec 摘要

- spec:`docs/features/2026-11-08-DeepSeek门禁与看板误挂/DeepSeek门禁与看板误挂-spec.md`(指纹 5852da8)
- F1 提交门禁与会话归属(D1–D5)
- F2 看板流程命令(D6–D8)
- F3 子会话标题(D9–D12)
- 功能方案的不做项:DeepSeek 进安装器 / 副本、看板其他认任务依据、子会话工具事实归属不变。

## 范围

覆盖 F1、F2、F3 全部;D1–D12 每条落到任务(见「细节方案核对」)。

## 明确不包含

- 不把 DeepSeek 加进 `AGENT_PROFILES` / `AgentId`,不部署 `.dsh/`,不把它带进副本(`install`、`replica` 不动)。
- 不做子会话 id → 根主会话的映射(K4 简化):提交记录用 `DSH_SESSION_ID` 原值;不新增 `agents/deepseek-file.ts`、`SessionSource.rootSessionId`。
- 不改看板其他依据(副本目录、提交分支 / 文件、写需求目录、消息路径、读需求目录、提到需求名)。
- 不改子会话的会话头 / 工具事实归属(仍归根主会话)。
- 不新增表、不升 `TIMELINE_SCHEMA_VERSION`;不新增 HTTP 接口。
- 不新增测试任务;只修正被改动弄红的既有测试(新行为验收走后续 `/unit-spec` → `/unit-code`)。
- spec「设计验收」的 1–11 项(含旧片段不标跳过、名字集合正例、子会话标题重算)由后续 `/unit-spec` → `/unit-code` 落地;本 plan 只保证既有测试不红、契约实现到位。
- 后续 `/unit-spec` 的必列输入:spec 设计验收 1–11,其中 D8 的名字集合正例 / 负例(`agent看板` 前缀、feature-id、副本目录名、Skill 需求目录路径)、D5 的「旧片段 + DeepSeek 提交不标跳过」、D4 的「DeepSeek 提示不报错」不得省略;本 plan 不重复展开测试步骤。

## 任务清单

| 任务 | 文件 | spec | 涉及范围 |
|---|---|---|---|
| T-1 会话来源与 DSH 变量 | `src/core/agents/types.ts`、`src/core/agents/sources.ts`、`src/core/agents/index.ts`;`__tests__/cli/installer/deepseek-zero-change.test.ts`、`__tests__/core/session-notices.test.ts`(只加 DSH 到隔离名单) | D1 | agents 会话来源、会话变量解析、G1 |
| T-2 门禁片段与跳过判定 | `src/core/commit-gate/gate.ts`、`src/core/timeline/git-commit.ts`;`__tests__/core/commit-gate/snippet-reinstall.test.ts`、`__tests__/core/timeline/git-commit-hook-env.test.ts` | D2、D3、D5 | 片段变量名单、提交归属、跳过判定 |
| T-3 会话提示 | `src/core/session-notices.ts` | D4 | 版本提示 / 自动记忆提示 |
| T-4 看板流程命令 | `src/core/board/match.ts`;`__tests__/core/board/match.test.ts` | D6、D7、D8 | 认任务流程命令 |
| T-5 子会话标题与重算 | `src/core/timeline/ingest/deepseek-session.ts`、`src/core/timeline/ingest/ingest.ts`、`src/core/timeline/ingest/rebuild.ts`;`__tests__/core/timeline/deepseek-session.test.ts` | D9–D12 | 读取器标题事实、标题表一次性重算 |
| T-6 文档同步 | `docs/knowledge/会话id来源约束.md`、`docs/knowledge/agent适配.md`、`docs/knowledge/开发时间线工具事件契约.md`;`CLAUDE.md`;`CHANGELOG.md` | F1–F3(行为变更) | 知识库、项目指引、变更记录 |

## 执行顺序

1. **第一步(并行)**:T-1、T-4、T-5。文件不重叠;T-1 定 C-1,T-4 定 C-5,T-5 定 C-6 / C-7。
2. **第二步(并行)**:T-2、T-3。都依赖 T-1 的 C-1;T-2 定 C-2 / C-3,T-3 定 C-4;与第一步文件不重叠。
3. **第三步**:T-6。依赖前五步行为定稿。

## 必须严格执行的契约

### C-1 会话来源的会话变量(T-1)

- `src/core/agents/types.ts`:`SessionSource` 增加 `readonly sessionIdEnv: string | null`;`SessionFromEnv` 为 `{ sessionId: string; agent: SessionSourceId; sessionIdEnv: string }`。
- `src/core/agents/sources.ts`:`profileSource` 返回 `sessionIdEnv: profile.sessionIdEnv`;`DEEPSEEK_SOURCE` 返回 `sessionIdEnv: 'DSH_SESSION_ID'`;`listSessionSources()` 顺序保持 claude-code → codebuddy → deepseek。
- `src/core/agents/index.ts`:`resolveSessionIdFromEnv(env = process.env)` 遍历 `listSessionSources()`,跳过 `sessionIdEnv === null`,取第一个 `env[source.sessionIdEnv]?.trim()` 非空值,返回 `{sessionId: value, agent: source.id, sessionIdEnv: source.sessionIdEnv}`;不读文件、不做子会话 → 根映射。
- 新增并导出 `listSessionIdEnvNames(): string[]`(按来源登记顺序,过滤 null)。

### C-2 门禁片段(T-2)

- `installCommitGate` 用 `listSessionIdEnvNames()` 生成变量名单(不再 `listAgentProfiles()`)。
- 片段探针按名单顺序拼 `${<name>:-}`;三个来源的当前结果:`${CLAUDE_CODE_SESSION_ID:-}${CODEBUDDY_SESSION_ID:-}${DSH_SESSION_ID:-}`。
- 片段仍是一行(不含真换行)、带 `# cgraphx-commit-gate` marker、`sh -n` 可过;其余退出码 / 放行规则不变。
- 不改 `repairHookSnippets` / 不自动换片段(D3):已装项目重跑 `cgraphx install` 才换新。

### C-3 提交记录与「跳过门禁」(T-2)

- `gitCommitHook`:`const fromEnv = resolveSessionIdFromEnv(); const session_id = fromEnv?.sessionId ?? null; const agent = fromEnv?.agent ?? null;`;不读会话文件、不映射根。
- `isGateSkipped(info: GitCommitInfo, session: SessionFromEnv | null): boolean`;`session === null` → false;post-merge → false。
- 读 `resolveHooksDir(info.cwd)/commit-msg`;把文本按行拆(`/\r?\n/`),要求**至少一行**同时含 `COMMIT_GATE_MARKER` 和 `` `${${session.sessionIdEnv}:-}` ``(说明行、探针行都带 marker,不能只认 marker);没有 → false。
- 其余条件(tree 与 `GATE_TREE_ENV` 不一致、非 cherry-pick / rebase、非 `Revert "…"`)保持现有顺序与行为。
- 调用处 `isGateSkipped(info, fromEnv)`。

### C-4 会话提示(T-3)

- `skillVersionNoticeSafe`:`const own = session !== null ? getAgentProfile(session.agent) : undefined; const candidates = own !== undefined ? [own] : listAgentProfiles();`;不再 `requireAgentProfile(session.agent)`。
- `autoMemoryOffNotice`:`getAgentProfile(session.agent)` 返回 undefined(deepseek)→ null;其余不变。
- `noticeScope` 不变(仍 `session:<会话编号>`)。

### C-5 看板流程命令(T-4)

- `firstWord(text)` = `text.trim().split(/\s+/)[0] ?? ''`。
- `TaskContext` 增加 `flowNames: ReadonlySet<string>`,由 `taskContextsOf` 构建:`[task.title, task.featureId, ...own.map(r => r.name)].filter(n => n !== '')`(`own` 是该需求的副本登记,含已删)。
- prompt 分支:`FLOW_COMMAND_PATTERN.exec(prompt.text)?.[1]` 存在且 `task.flowNames.has(firstWord(params))` → 定挂「流程命令」。
- Skill 分支:`tool.tool === 'Skill' && tool.args !== null && (task.flowNames.has(firstWord(tool.args)) || tool.args.includes(task.prefix))` → 定挂;`task.prefix` 是 `docs/features/<featureId>/`。
- 不做标点 / 大小写 / 全角空格归一化;`FLOW_COMMAND_PATTERN` 不变;`task.prefix` 不加入 `flowNames`(单独文件前缀不算)。

### C-6 子会话标题(T-5)

- `handleSessionTitle` 开头 `if (s.isChild) return;`;子会话不再产 `session_title` 事实。
- 会话头 / 工具事实仍按现有逻辑归 `s.rootSessionId`;不动。

### C-7 标题一次性重算(T-5)

- `ingest.ts` 导出 `SESSION_TITLES_REFRESH_AT_KEY = 'session_titles_refresh_at'`;模块常量 `TITLE_REFRESH_SOURCE_ID = 'deepseek'`。
- 新函数 `refreshDeepSeekSessionTitles(start: string): Promise<string[]>`:
  - 与 `backfillSessionTitles` 同样的入口保护:`findProjectRoot`;`locateDataAtRoot` 为 project 且有 dataDir / projectDirName;库文件存在;`openSessionIndex`;`acquireIngestLock`;打开库、`ensureTimelineSchema`;重查记号,已有 → `[]`。
  - 取 `listSessionSources().find(s => s.id === TITLE_REFRESH_SOURCE_ID)`;没有或 `unavailableReason() !== null` → 返回 `[]` 且**不写记号**(下次重试)。
  - `reader = sessionFactsReader(source.sessionReader)`;遍历 `sessionIndex.listSessionFiles(source.id)` 中 `project_dir === loc.projectDirName` 的行;`await reader(row.path, 0)`;从 facts 收集 `session_head` 的 `sessionId` 到 `covered`,用 `titleUpserts(facts)` 收集标题;单文件读失败 `catch` 跳过(旧行保留)。
  - 事务内:按不超过 500 个参数分批 `DELETE FROM timeline_session_titles WHERE session_id IN (...)`(covered),再逐个 `upsertSessionTitle`;事务成功后 `writeMetaNow(db, SESSION_TITLES_REFRESH_AT_KEY)`。
  - 任何异常 → 返回 `` [`会话标题重算失败:${shortReason(err)},下一趟会重试`] ``,不写记号;释放锁、关库同 backfill。
- `ensureTimelineUpToDate` 顺序:`backfillSessionTitles` → `refreshDeepSeekSessionTitles` → `ingestIncremental`;notices 顺序 `backfill → refresh → incremental`。
- `backfillSessionTitles` 写完 `SESSION_TITLES_AT_KEY` 后也写 `SESSION_TITLES_REFRESH_AT_KEY`。
- `commitRebuild` 两处 `writeMetaNow(projectDb, SESSION_TITLES_AT_KEY)`(正常重建 + mark-only)都同时写 refresh 键。

### C-8 测试隔离与既有测试(T-1 / T-2 / T-4 / T-5)

- 所有会读 `resolveSessionIdFromEnv()` 的测试,把 `DSH_SESSION_ID` 放进删除 / 还原名单:
  - `__tests__/core/session-notices.test.ts` 的 `SESSION_VARS`;
  - `__tests__/core/commit-gate/snippet-reinstall.test.ts` 的 `SESSION_VARS`;
  - `__tests__/core/timeline/git-commit-hook-env.test.ts` 的 `TOUCHED_ENV`。
- `deepseek-zero-change.test.ts` G1 改为认 deepseek,并补 Claude 优先断言;G2 不变。
- `git-commit-hook-env.test.ts` 的 `installGateSnippet` 假片段改成含 `${CLAUDE_CODE_SESSION_ID:-}` 的一行;`isGateSkipped` 调用传 `SessionFromEnv` 或 null。
- `deepseek-session.test.ts` A3 断言子会话 facts 里没有 `session_title`,工具 / 会话头仍归 parent。
- `board/match.test.ts` C5 的 Skill 参数改成以名字开头(`订单导出 按 spec 写计划`);不新增用例。
- 会自己造 `~/.dsh` 会话文件的测试(`__tests__/core/timeline/ingest-sources.test.ts`)把 `DSH_HOME` 指到临时 HOME 的 `.dsh` 并在 `afterEach` 还原;否则在 DeepSeek 会话里跑测试会读真实 `~/.dsh`、B1/B9 全空。
- 不新增测试文件 / 用例;新行为验收归 `/unit-spec` → `/unit-code`。

### C-9 文档(T-6)

- `docs/knowledge/会话id来源约束.md`:aliases 加 `DSH_SESSION_ID`;Summary / Findings 加 2026-11-08 DeepSeek;消费方写得对(提交归属、门禁、提示);主会话 `session-` / `od-`,子会话裸 uuid;提交记原始编号、不映射根;门禁片段名单来自全部会话来源;跳过判定看片段里有没有本来源探针。
- `docs/knowledge/agent适配.md`:只读来源现在也进会话 id 解析与提交门禁;仍不进安装器 / 副本 / `.dsh/`;`SessionSource` 有 `sessionIdEnv`,没有 `rootSessionId`。
- `docs/knowledge/开发时间线工具事件契约.md`:DeepSeek 子会话「只产会话头与工具事实」(标题不产);标题表与一次性 refresh 记号;标题优先级不变。
- `CLAUDE.md`:改 deepseek 的「不进安装器、副本与门禁」句、门禁片段变量名单来源、子会话标题、看板流程命令规则。
- `CHANGELOG.md`:`## Unreleased` 下按现有英文格式加 `### Fixed` / `### Changed` 3–5 句,覆盖 DeepSeek 提交过门禁并记会话、旧片段不误标跳过、看板流程命令只认完整名字、子会话标题不再盖主会话。

## 细节方案核对

| spec | 落在 | 说明 |
|---|---|---|
| D1 会话变量从哪来 | T-1 | C-1;`SessionSource.sessionIdEnv` + `SessionFromEnv.sessionIdEnv` + 来源枚举 |
| D2 门禁片段的变量名单 | T-2 | C-2;`listSessionIdEnvNames()` 生成探针 |
| D3 片段什么时候换新 | T-2 | 无代码改动:不改 `repairHookSnippets`,只靠重跑 `cgraphx install` |
| D4 会话提示侧 | T-3 | C-4;`getAgentProfile` 取不到时按已装 agent |
| D5 跳过门禁 | T-2 | C-3;按「带 marker 的行里有本来源探针」判 |
| D6 匹配算法 | T-4 | C-5;`flowNames` + `firstWord` + Skill 路径 |
| D7 标点 / 大小写 / 名字范围 | T-4 | C-5;不归一化、不做前缀匹配 |
| D8 测试 | T-4 | 改既有 C5;新行为验收留给 unit-spec / unit-code |
| D9 子会话标题不产 | T-5 | C-6;`handleSessionTitle` 子会话直接返回 |
| D10 已有错误标题重算 | T-5 | C-7;只跑 deepseek、先删 covered 再 upsert |
| D11 回填 / 重建与新记号 | T-5 | C-7;回填 / 重建各写两个记号 |
| D12 重算失败 | T-5 | C-7;不写记号、返回提示、下次重试 |

## 适用规范

- `docs/guides/coding-standards.md`「边界与结构」「选型(偏离社区默认)」「错误与日志」:core 不依赖 cli / web;子系统门面;中文注释;`node:` 前缀;单文件 ≤600 行;用户可修复错误带修复提示。
- `docs/guides/git-standards.md`「提交消息规范」「提交前检查点」:已结晶到下文「提交规范」。
- 不适用:`data-standards.md`(无 schema 变更)、`interface-standards.md`(无 HTTP 接口)、`testing-standards.md`(不新增测试,测试走独立流程)。

## 提交规范

- 格式:`type(scope): 中文描述`;type 用 feat / refactor / fix / docs;scope 用 agents / commit-gate / timeline / notices / board;仓库级文档改动省 scope。
- body:非琐碎提交写背景一行 +「-」要点;不用票据号。
- 提交前检查点(逐条对照 `git diff --cached`):
  - 与 TS 同放的运行时资产未登记 `scripts/copy-assets.cjs` —— 本 plan 不改运行时资产,确认没有新增。
  - `src/core` 出现对 `src/cli` / `src/web` 的 import —— 本 plan 不新增。
  - `schema.sql` 丢失 `IF NOT EXISTS` —— 本 plan 不改 schema。
  - timeline hook 链路出现未 await 的 DB 写入 / 抛错不吞 —— T-5 的重算是 await + try/catch,检查。
  - `vitest.config.ts` 的 `TZ: 'UTC'` 被改 —— 不动。
  - 被注释掉的命令注册 / hook 接入项 —— 不动。
  - 写死的魔法值(绝对路径、密钥、阈值、版本号)—— `TITLE_REFRESH_SOURCE_ID = 'deepseek'` 是来源 id,不是魔法阈值;不要写死本机路径。
  - 新增 TODO / FIXME —— 不留。
- 每任务的提交说明见任务文件「提交点」。

## 统一验证

全部任务完成后,在仓库根目录跑:

1. `npm run build` — 先构建:`tsc` 通过,`node scripts/copy-assets.cjs` 正常,退出码 0;`__tests__/core/dbquery/cli.test.ts` 等要 spawn `dist/cli/index.js`,没有 dist 会整组红。
2. `npm test` — 期望所有测试文件通过,没有失败;重点看 `__tests__/core/board/match.test.ts`、`__tests__/core/timeline/deepseek-session.test.ts`、`__tests__/core/timeline/session-titles.test.ts`、`__tests__/core/timeline/git-commit-hook-env.test.ts`、`__tests__/core/session-notices.test.ts`、`__tests__/cli/installer/deepseek-zero-change.test.ts`。
3. `cgraphx docs validate docs/knowledge/会话id来源约束.md` — 输出合法 / valid。
4. `cgraphx docs validate docs/knowledge/agent适配.md` — 同上。
5. `cgraphx docs validate docs/knowledge/开发时间线工具事件契约.md` — 同上。
6. `cgraphx docs validate docs/knowledge/版本分支.md` — 同上。
7. `cgraphx docs index` — 重建本地知识库索引,退出码 0。
8. `git status --short` — 只剩本次改动;任务提交后应干净。

## 允许局部适配

- 内部 helper 命名、私有函数拆分、注释措辞。
- `firstWord` 的实现(trim / split)只要行为符合 C-5。
- `DELETE` 的分批大小(如 500)与 SQL 参数拼接方式,只要覆盖全部 covered 且不超 SQLite 参数上限。
- 标题重算的临时变量组织、日志文案(除失败提示的固定前缀外)。
- 测试隔离的具体写法(delete / restore env)。
- 不改变任何契约签名、错误行为、数据格式、提交点文件边界。

## Plan 冲突上报规则

- 遇到 spec / plan 冲突或契约缺失:停止该任务,返回 `PLAN_CONFLICT: <一句话>` + 相关 spec / plan 编号与文件;不自行选型。
- 遇到任务文件与 index 契约不一致:以 index 契约为准,并在回报里指出任务文件需修订。
- 遇到既有代码与 spec 描述不符:以 spec 为准,回报 `PLAN_CONFLICT` 并附文件:行。

## 关键风险与防跑偏约束

- **别把 DSH 加进 `AGENT_PROFILES`**:只加 `SessionSource.sessionIdEnv`;`listAgentProfiles()` / `AgentId` / `install` / `replica` 不变。
- **别做子会话映射**:不读会话文件找根,不新增 `agents/deepseek-file.ts` / `rootSessionId`;提交记录用原值。
- **别让旧片段误标跳过**:`isGateSkipped` 必须检查带 marker 的行里有没有本来源的探针;不能只认 marker。
- **别把看板退回前缀匹配**:流程命令用 `flowNames` 完整相等;Skill 路径只认 `docs/features/<featureId>/`;不做标点 / 大小写归一化。
- **标题重算别删全表**:只删 covered(DeepSeek 文件覆盖的会话)行;文件读不出保留旧行;只跑 deepseek 来源。
- **测试隔离**:所有改 `resolveSessionIdFromEnv` 的测试必须把 `DSH_SESSION_ID` 放进删除 / 还原名单;否则在 DeepSeek 会话里跑测试会串。
- **不改 schema / API**:不加表、不升版本、不加 HTTP 接口;标题重算只删 / 写 `timeline_session_titles`。
- **文档必须跟行为一致**:`docs/knowledge/会话id来源约束.md` 仍写「只读来源不进门禁」会误导;T-6 必须改。
- **规范例外**:`coding-standards.md` 要求单文件 ≤600 行;`src/core/timeline/ingest/ingest.ts` 存量 999 行已超,本次把 refresh 放同文件(与 backfill / lock 共用私有 helper,拆出去会形成循环依赖),不借机扩大拆分范围——例外记在这里,不在 T-5 临时处理。

## 待确认项

无。

## 启动语

大需求,按 `/dev-impl-subagent` 跑:

`/dev-impl-subagent docs/features/2026-11-08-DeepSeek门禁与看板误挂/plan/DeepSeek门禁与看板误挂-index.md`
