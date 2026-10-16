# 02 · Backend:任务清单

> 所有任务的权威链:任务 ← index ← spec(`../cgraphx接入研发管理平台-spec.md`)。冲突按 index「Plan 冲突上报规则」处理。
> 路径一律相对仓库根 `/Users/smdnk/objects/ai/cgraphx`。不写新测试;既有测试不得变红(`npm test`)。

---

### T-1: timeline / task 门面加只读读取与任务源配置读写

- 目标:给 sync 提供取本地数据与读写任务源配置的门面函数;不改变任何既有函数的行为与输出。
- 对应 spec 条款:§3.1「存量配置」、§3.2、§5.1–§5.4、§8「本地 web / 本地命令」。
- 强制引用:`docs/guides/coding-standards.md`
- 依赖:无。
- 涉及范围:`src/core/timeline/store.ts`、`src/core/timeline/indexer.ts`、`src/core/timeline/index.ts`、`src/core/task/source.ts`、`src/core/task/report.ts`、`src/core/task/index.ts`。
- 必须严格执行(签名逐字,T-3 / T-2 按此调用):
  - timeline 门面新增(实现放 `indexer.ts`,SQL 放 `TimelineStore` 新方法,`index.ts` 导出):
    - `listSessionEventMaxIds(projectRoot: string): Promise<Array<{ sessionId: string; maxId: number }>>` —— `SELECT session_id, max(id) FROM timeline_events WHERE session_id IS NOT NULL GROUP BY session_id`。
    - `listSessionEventsAfter(projectRoot: string, sessionId: string, afterId: number): Promise<TimelineEvent[]>` —— `session_id = ? AND id > ?`,按 `id ASC`,**无 limit**;行映射复用既有 `rowToEvent`。
    - `listCommitEvents(projectRoot: string): Promise<TimelineEvent[]>` —— `event_type = 'git_commit'`(含 `session_id IS NULL`),按 `ts ASC, id ASC`,无 limit。
  - task 门面新增:
    - `getTaskSourceConfigPath`(既有函数,`index.ts` 补导出)。
    - `writeTaskSourceConfig(projectRoot: string, config: TaskSourceConfig): void`(放 `source.ts`)—— 写 `{"url":…,"headers":{…}}`,`JSON.stringify(…, null, 2) + '\n'`,文件权限 `0o600`;`.cgraphx/` 不存在时抛 `TaskConfigError`(消息带"先运行 `cgraphx install`")。
    - `removeTaskSourceConfig(projectRoot: string): boolean`(放 `source.ts`)—— 删除文件;不存在返回 false。
    - `listBindingsWithTask(projectRoot: string): Array<{ binding: TaskBinding; task: TaskItem }>`(放 `report.ts`)—— 经 `openTaskDbReadOnly` 打开;遇 `TaskConfigError` / `TaskNotEnabledError` 返回 `[]`;用 `TaskStore.listAllBindings()` + `getTaskById()`,按 `binding.id ASC`。
- 允许局部适配:store 方法命名;`listBindingsWithTask` 内部可改为一条 JOIN SQL。
- 具体要求:
  - 新函数只读(timeline 侧复用 `openTimelineDb` 的连接生命周期;不新增版本号)。
  - 不修改 `queryEvents` / `getTaskReport` / `collectReferences` / `classifyArtifactPath` 等既有函数。
- 完成条件:
  - `npm run build` 通过;`npm test` 全绿。
  - `node -e "require('./dist/core/timeline').listSessionEventMaxIds(process.cwd()).then(r=>console.log(r.length))"` 输出 >0;`listCommitEvents` 返回含 `session_id === null` 的行(本仓库有 105 条)。
  - `node -e "console.log(require('./dist/core/task').listBindingsWithTask(process.cwd()).length)"` 输出 >0。
- 验证方式:上述命令;`git diff --stat` 只涉及上列 6 个文件。
- 独立提交:是 —— `feat(timeline): sync 用只读门面——会话事件水位 + commit 事件` 与 `feat(task): 任务源配置读写 + 绑定只读清单` 可合为一条 `feat: timeline/task 门面补 sync 只读读取与任务源配置读写`。
- 风险/注意事项:`listSessionEventsAfter` 不能复用 `query()`(它有 limit 上限 10000 且按 ts 倒序)。

---

### T-2: sync 子系统骨架:本地状态、平台客户端、接入与断开

- 目标:建 `src/core/sync/` 子系统(门面 + cli + types + errors + constants + schema),完成 `cgraphx sync connect` / `disconnect` 与 `recordReferenceHit`。
- 对应 spec 条款:§2、§3.1–§3.3、§6「本地凭据」、§7(连接信息部分)、§8「卸载」「多 agent」。
- 强制引用:`docs/guides/coding-standards.md`、`docs/guides/data-standards.md`、`docs/guides/interface-standards.md`
- 依赖:T-1。调用的 task 门面签名(T-1 原文):`loadTaskSourceConfig(projectRoot: string): TaskSourceConfig | null`(既有)、`writeTaskSourceConfig(projectRoot: string, config: TaskSourceConfig): void`、`removeTaskSourceConfig(projectRoot: string): boolean`。
- 涉及范围(新建):`src/core/sync/{index,cli,types,errors,constants,schema-bootstrap,store,client,connection,git,spawn,version}.ts` 与 `src/core/sync/schema.sql`;修改:`src/cli/index.ts`(`registerSyncCommands(program)`)、`scripts/copy-assets.cjs`(登记 `src/core/sync/schema.sql`)。
- 必须严格执行:
  - **表结构**:按 `cgraphx接入研发管理平台-01-schema.md` 原文建表(4 张表 2 个索引,`SYNC_SCHEMA_VERSION = 1`)。
  - **协议类型镜像**(`types.ts`,字段名与可选性逐字同契约 v1;注释写"镜像 @cgraphx-server/contract client.ts v1,只增不改"):
    - `ConnectRequest { username; password; remoteUrl; clientName; clientVersion }`、`ConnectResponse { token; project: { id: number; name: string }; repo: { id: number; defaultBranch: string } }`
    - `ClientStatus { lastSyncAt: string | null; backlog: number | null }`
    - `IngestEvent { eventId: string; ts: string; type: string; toolName?: string; skillName?: string }`
    - `IngestBinding { bindingId: string; taskId: string | null; start: string; end: string | null }`
    - `IngestCommit { hash: string; message: string; branch: string | null; files: string[]; insertions: number; deletions: number; ts: string }`
    - `IngestArtifact { type: ArtifactType; path: string; action: 'create' | 'modify'; commitHash: string | null; branch: string | null; ts: string }`
    - `IngestReference { kind: 'file' | 'concept'; value: string; ts: string }`
    - `IngestSession { clientSessionId: string; events: IngestEvent[]; bindings: IngestBinding[]; commits: IngestCommit[]; artifacts: IngestArtifact[]; references: IngestReference[] }`
    - `IngestRequest { remoteUrl: string; clientName: string; clientVersion: string; backlog?: number; sessions: IngestSession[] }`
    - `IngestResponse { accepted: {…5 个 number}; warnings: IngestWarning[] }`,`IngestWarning` = `{kind:'binding_ineffective', bindingId, reason}` | `{kind:'path_dropped', path}`
    - `ARTIFACT_TYPES`(`as const`,13 项,顺序同契约 enums.ts:spec, plan, wireframe, api_test_spec, api_test_report, unit_test_spec, unit_test_report, ui_test_spec, ui_test_report, knowledge, code_map, design_map, schema_knowledge)+ `type ArtifactType`
    - `CLIENT_ERROR_CODES`(`as const`:invalid_token, account_disabled, repo_not_registered, repo_disabled, not_project_member, invalid_credentials, validation_failed, internal_error, payload_too_large)
    - `PAUSE_REASONS`(`as const`:invalid_token, account_disabled, repo_not_registered, repo_disabled, not_project_member)+ `type PauseReason`
  - **本地类型**(`types.ts`):
    - `SyncConnection { serverUrl: string; username: string | null; projectName: string | null; connectedAt: string | null }`
    - `SyncStatusState { lastSuccessAt; lastAttemptAt; failingSince; lastError; pausedReason: PauseReason | null; pausedAt; lastProbeAt; lastResult: SyncRunResult | null }`(时间均 `string | null`)
    - `SyncRunResult { at: string; ok: boolean; sessionsSent: number; recordsSent: number; isolatedNew: number; warnings: number; stoppedBy: 'paused' | 'failing' | 'not_connected' | 'busy' | null; error: string | null }`
    - `ConnectInput { serverUrl?: string; username?: string; force: boolean; readPassword: () => Promise<string> }`
    - `ConnectOutcome = { kind: 'already'; connection: SyncConnection } | { kind: 'connected'; connection: SyncConnection; replacedExisting: boolean }`
    - `ReferenceHit { kind: 'concept' | 'file'; value: string; sessionId?: string }`
  - **错误**(`errors.ts`,直接继承 `Error`):`SyncError`(基类)、`SyncArgError`、`SyncNotInitializedError`、`SyncNotConnectedError`、`SyncSchemaError`、`SyncPlatformError`(字段 `code: string; httpStatus: number; retryable: boolean`)、`SyncNetworkError`、`SyncBusyError`;`exitCodeForError(err)`:SyncArgError=3、SyncNotInitializedError=2、SyncNotConnectedError=2、SyncSchemaError=2、SyncPlatformError=4、SyncNetworkError=5、SyncBusyError=1、其他=1。
  - **常量**(`constants.ts`):`SYNC_SCHEMA_VERSION = 1`、`CLIENT_NAME = 'cgraphx'`、`CLIENT_API_PREFIX = '/api/client/v1'`、`TASKS_PATH_SUFFIX = '/api/client/v1/tasks'`、`CLIENT_TIMEOUT_MS = 30_000`、`TERMINAL_SESSION_PREFIX = 'cgraphx-terminal-'`、`SEDIMENT_DIRS = ['docs/knowledge/', 'docs/schema-knowledge/', 'docs/code-map/', 'docs/design-map/'] as const`(唯一定义处)、`LOCK_FILENAME = 'sync.lock'`、`TRIGGER_FILENAME = 'sync-trigger'`、`LOCK_STALE_MS = 2 * 3600_000`;T-4 / T-5 的常量由各自任务追加到本文件。
  - **门面**(`index.ts` 本任务导出):`connectPlatform(projectRoot: string, input: ConnectInput): Promise<ConnectOutcome>`、`disconnectPlatform(projectRoot: string): boolean`、`readConnection(projectRoot: string): { serverUrl: string; token: string } | null`、`recordReferenceHit(projectRoot: string, hit: ReferenceHit): void`、`openSyncDb`、类型与错误;`cli.ts` 导出 `registerSyncCommands(program: Command): void`。
  - **`readConnection`**:经 task 门面 `loadTaskSourceConfig`;返回非 null 当且仅当 `url` 以 `TASKS_PATH_SUFFIX` 结尾且 `headers.Authorization` 以 `Bearer ` 开头;`serverUrl = url.slice(0, -TASKS_PATH_SUFFIX.length)`,`token = Authorization.slice(7)`;`TaskConfigError` → null。
  - **`client.ts`**:`postConnect(serverUrl, body: ConnectRequest): Promise<ConnectResponse>`(2xx 但 `typeof token !== 'string' || token === ''` 或缺 `project.name` → `SyncPlatformError(code='invalid_response', retryable=false)`,不写任何配置)、`getStatus(serverUrl, token, remoteUrl): Promise<ClientStatus>`(`GET …/status?remoteUrl=<encodeURIComponent>`)、`postIngest(serverUrl, token, body: IngestRequest): Promise<IngestResponse>`;全局 `fetch` + `AbortController`(`CLIENT_TIMEOUT_MS`);非 2xx:解析 `{error,message,retryable}` → `SyncPlatformError`;无法解析时:413 → `code='payload_too_large', retryable=true`,≥500 → `code='internal_error', retryable=true`,其余 → `code='http_<status>', retryable=false`;网络失败 / 超时 → `SyncNetworkError`。**错误消息、日志不得包含 token 或密码**。
  - **`git.ts`(本任务部分)**:`getOriginUrl(projectRoot): string | null`(`git remote get-url origin`)、`getRepoToplevel(projectRoot): string | null`(`git rev-parse --show-toplevel`);一律 `execFileSync('git', args, { cwd, stdio: ['ignore','pipe','ignore'] })`,失败返回 null。
  - **`spawn.ts`**:`spawnSyncWorker(projectRoot: string): boolean` —— `spawn(process.execPath, [process.argv[1], 'sync-worker', '--project', projectRoot], { detached: true, stdio: 'ignore', windowsHide: true }).unref()`;任何异常返回 false。
  - **`connectPlatform` 流程**(逐步执行,不可调整顺序):
    1. `isInitialized(projectRoot)` 否 → `SyncNotInitializedError`。
    2. `remoteUrl = getOriginUrl` 为 null → `SyncArgError('本仓库没有 origin 远程地址,无法匹配平台项目')`。
    3. `existing = readConnection(projectRoot)`。
    4. 若 `!force && existing`:`input.serverUrl` 给了且归一后 ≠ `existing.serverUrl` → `SyncArgError('已接入 <existing>,换平台请加 --force')`;否则 `getStatus(existing.serverUrl, existing.token, remoteUrl)`:成功 → 返回 `{kind:'already', connection: store 中的 connection ?? {serverUrl, username:null, projectName:null, connectedAt:null}}`;`SyncPlatformError` 且 `code==='invalid_token'` → 进入第 5 步;其它错误原样抛出。
    5. `serverUrl`(`input.serverUrl` ?? `existing?.serverUrl`)缺失 → `SyncArgError('缺少 --server')`;归一:trim、去尾部 `/`、须以 `http://` 或 `https://` 开头,否则 `SyncArgError`。`username` 缺失 → `SyncArgError('缺少 --user')`。
    6. `password = await input.readPassword()`,空 → `SyncArgError`。
    7. `postConnect(serverUrl, {username, password, remoteUrl, clientName: CLIENT_NAME, clientVersion: getClientVersion()})`。
    8. `writeTaskSourceConfig(projectRoot, { url: serverUrl + TASKS_PATH_SUFFIX, headers: { Authorization: 'Bearer ' + token } })`。
    9. store:`setConnection({ serverUrl, username, projectName: project.name, connectedAt: now })`;`status` 重置为全 null;`DELETE FROM sync_sessions`(重新回传全部历史,spec §3.2 / §4.3)。
    10. 返回 `{kind:'connected', connection, replacedExisting: existing !== null}`。
  - **`disconnectPlatform`**:`removeTaskSourceConfig`;删除 `sync_state` 的 `connection` 与 `status` 两键(库未初始化则跳过);返回是否删除了配置文件。不删除 `sync_sessions`、`sync_reference_records`。
  - **`recordReferenceHit`**:绝不抛错、绝不输出(stdout / stderr 皆无);`sessionId = hit.sessionId ?? resolveSessionIdFromEnv()?.sessionId`,无 → return;`!isInitialized` → return;`value` 空 → return;`openSyncDb` → `INSERT OR IGNORE INTO sync_reference_records(session_id, kind, value, ts)` → close。
  - **CLI**(`cgraphx sync`,`--json` 输出 `ConnectOutcome` / `{ removed: boolean }`):
    - `sync connect [--server <url>] [--user <name>] [--force] [--password-stdin] [--json]`:`readPassword` = `--password-stdin` 时读 stdin 第一行;否则 stdin 是 TTY 时关回显读一行(提示 `平台密码: `);两者都不满足 → `SyncArgError('请在终端交互输入密码,或用 --password-stdin')`。成功 `connected` → 调 `spawnSyncWorker` 并输出:`已接入平台项目「<projectName>」(账号 <username>),正在后台回传本仓库全部历史;用 cgraphx sync status 查看进度。`;`replacedExisting` 为真时追加一行:`已替换本地旧凭据;旧凭据在平台上仍有效(服务端尚不作废旧凭据)。`;`already` → `已接入平台(<serverUrl>,账号 <username ?? 未知>)。如需换账号请加 --force。`
    - `sync disconnect [--json]`:输出 `已断开平台:本地凭据已删除,停止上报;本地与平台数据均保留。` 或 `未接入,无需断开。`
    - 错误:`SyncPlatformError` 按下表转提示(文案意思固定),其余错误输出 `[sync] <message>`;退出码经 `exitCodeForError`。

      | code | 提示 |
      |---|---|
      | invalid_credentials | 账号或密码错误 |
      | account_disabled | 平台账号已停用,请联系平台管理员 |
      | repo_not_registered | 本仓库未在平台登记,请联系项目管理员 |
      | repo_disabled | 本仓库的平台登记已停用 |
      | not_project_member | 你不是该仓库所属项目的成员 |
      | invalid_token | 上报凭据已失效,请重新接入(cgraphx sync connect) |
      | 其它 | `平台返回错误:<message>` |
      `SyncNetworkError` → `无法连接平台 <serverUrl>,请检查平台地址与网络`。
- 允许局部适配:store 内部方法拆分;TTY 关回显的实现方式(readline + 静默输出);文案标点。
- 具体要求:
  - store 行类型 `XxxRow`(snake_case,JSON 列尾注 `// JSON`),行 → 领域类型在 store 内映射。
  - 版本号:`src/core/sync/version.ts` 导出 `getClientVersion(): string`,读 `path.join(__dirname, '../../../package.json')` 的 `version`(`src/core/sync/` 与 `dist/core/sync/` 上溯三级都是包根);不得 import `src/cli`。
  - CLI 输出带 `[sync]` 前缀只用于 stderr 错误。
- 完成条件:
  - `npm run build` 通过,`dist/core/sync/schema.sql` 存在;`npm test` 全绿。
  - implementer 可验证(不需要平台与密码):
    - 在无 origin 的临时 git 仓库(scratchpad 中 `git init` + `cgraphx install` 的副本)执行 `node <仓库>/dist/cli/index.js sync connect --server http://x --user u` → 退出码 3,提示「本仓库没有 origin 远程地址…」。
    - `node dist/cli/index.js sync connect --server ftp://x --user u --force` → 退出码 3(平台地址须 http/https),`.cgraphx/task-source.json` 不变。
    - 非 TTY 且无 `--password-stdin`:`node dist/cli/index.js sync connect --server http://127.0.0.1:9 --user u --force < /dev/null` → 退出码 3,提示交互输入或 `--password-stdin`。
    - `--server http://127.0.0.1:9`(不可达)+ `--password-stdin`(stdin 用 `/dev/null` 以外的任意非空输入,**不得是真实密码**,如 `echo x |`)→ 退出码 5,「无法连接平台…」,`task-source.json` 不变。
    - `node -e` 查 `sync_state` 不含 token 字段。
  - **人工验收**(负责人执行,implementer 不执行;平台不可用时记为"待人工验收",不报 PLAN_CONFLICT):平台运行中(`~/objects/ai/cgraphx-server` 下 `pnpm dev`,`curl http://localhost:8080/api/health` 为 ok),负责人在终端执行 `node dist/cli/index.js sync connect --server http://localhost:8080 --user liulongfei`,按提示交互输入密码:已有凭据 → 输出「已接入平台…」;加 `--force` → 输出「已接入平台项目「cgraphx」…」,`task-source.json` 的 Authorization 变化,`node dist/cli/index.js task list` 仍列出 T-24;错误密码 → 退出码 4、「账号或密码错误」、`task-source.json` 不变。
- 验证方式:上述命令 + 01-schema「数据校验」。
- 独立提交:是 —— `feat(sync): 平台接入骨架——sync_* 本地表 + 平台客户端 + connect/disconnect`(须在 T-1 之后提交)。
- 风险/注意事项:`connect --force` 会签发新凭据(平台 P1 不作废旧的),验证时只执行一次。

---

### T-3: 上报内容构造:会话 / 事件 / 绑定 / commit / 产出 / 参考

- 目标:从本地数据**正向构造**白名单内的 `IngestSession`;产物类型映射与参考口径各自唯一定义。
- 对应 spec 条款:§5.1–§5.6、§6。
- 强制引用:`docs/guides/coding-standards.md`
- 依赖:T-1(timeline / task 门面)、T-2(types / constants / store / git.ts)。
- 涉及范围:新建 `src/core/sync/payload.ts`、`src/core/sync/artifacts.ts`、`src/core/sync/references.ts`;修改 `src/core/sync/git.ts`(追加)、`src/core/sync/store.ts`(追加 `listReferenceRecords`)。
- 必须严格执行:
  - **调用的门面签名**(T-1 原文):`listSessionEventsAfter(projectRoot: string, sessionId: string, afterId: number): Promise<TimelineEvent[]>`、`listCommitEvents(projectRoot: string): Promise<TimelineEvent[]>`、`listBindingsWithTask(projectRoot: string): Array<{ binding: TaskBinding; task: TaskItem }>`。
  - **上下文**(`payload.ts` 导出):
    ```
    interface SyncContext {
      projectRoot: string; repoRoot: string; remoteUrl: string; clientVersion: string;
      commitEvents: TimelineEvent[];                                   // listCommitEvents
      bindingsBySession: Map<string, Array<{ binding: TaskBinding; task: TaskItem }>>;
      git: GitCache;                                                   // createGitCache(repoRoot)
      skillDirs: string[];                                             // 各已安装 agent 的 <configDir>/skills
    }
    interface BuiltSession { session: IngestSession; maxEventId: number; bindingsHash: string; extrasHash: string; pendingPush: boolean; recordCount: number }
    ```
    - `createSyncContext(projectRoot: string): Promise<SyncContext>`(remoteUrl / repoRoot 取不到 → `SyncArgError`)
    - `buildSessionPayload(ctx: SyncContext, sessionId: string, afterEventId: number): Promise<BuiltSession>` —— 读本会话**全部**事件(`listSessionEventsAfter(…, 0)`),`events` 只放 `id > afterEventId` 的;`bindings/commits/artifacts/references` 放全量。
    - `buildTerminalPayload(ctx: SyncContext): BuiltSession | null` —— `clientSessionId = TERMINAL_SESSION_PREFIX + sha256(ctx.remoteUrl).hex.slice(0,16)`;只含 `session_id === null` 的 commit 事件构造的 `commits` 与由这些 commit 文件映射出的 `artifacts`;`events/bindings/references` 为空;没有终端 commit 返回 null。
    - `bindingsHashOf(entries: Array<{ binding: TaskBinding; task: TaskItem }>): string` —— **先按字段来源表映射成 `IngestBinding[]`** 再求哈希(任务名 / 状态变化不触发重发);`extrasHashOf(session: IngestSession): string` —— 只对 `bindings/commits/artifacts/references` 求哈希。两者均 sha256(稳定 JSON:数组按自然键排序 —— bindings 按 bindingId、commits 按 hash、artifacts 按 type+path、references 按 kind+value)。
    - `recordCount = events.length + bindings.length + commits.length + artifacts.length + references.length`。
  - **字段来源表(白名单,逐字段赋值,禁止对本地对象展开 / 透传)**:

    | 协议字段 | 唯一来源 |
    |---|---|
    | `IngestEvent.eventId` | `String(e.id)` |
    | `.ts` | `e.ts` |
    | `.type` | `e.event_type` |
    | `.toolName` | `e.tool_name`(null 不带键) |
    | `.skillName` | `e.tool_name === 'Skill'` 时 `e.tool_args.skill`(字符串);`e.event_type === 'user_prompt'` 时 `parseSlashSkill(e.prompt_text, ctx.skillDirs)`;其余不带键 |
    | `IngestBinding.bindingId` | `String(binding.id)` |
    | `.taskId` | `task.source === 'api' ? task.externalId : null` |
    | `.start` / `.end` | `binding.boundAt` / `binding.unboundAt` |
    | `IngestCommit.hash` | `e.commit_hash`(null 的事件跳过);同会话按 hash 去重保留首条 |
    | `.message` | `e.commit_message ?? ''` |
    | `.branch` | `typeof e.metadata.branch === 'string' ? 它 : null` |
    | `.files` | `e.commit_files` 过滤 `isSafeRelPath` |
    | `.insertions` / `.deletions` | `e.commit_insertions ?? 0` / `e.commit_deletions ?? 0` |
    | `.ts` | `e.ts` |
    | `IngestArtifact.*` | 见下「产出规则」 |
    | `IngestReference.*` | 见下「参考规则」 |

    **从不读取**:`prompt_text`(仅 `parseSlashSkill` 内部用于取命令名,返回值只能是命令名)、`tool_args` 除 `skill` / `file_path` / `notebook_path` / `path` / `command`(command 仅在 references 推断内部使用)外的键、`tool_result_summary`(仅用于判断 `success`)、`cwd`(仅用于推断路径解析)、`duration_ms`、`turn_id`、`agent`。
  - `isSafeRelPath(p)`:非空,不以 `/` 或 `~` 开头,不含 `\`,不含 `..` 段,不匹配 `^[A-Za-z]:`。
  - `skillDirs` = 每个已登记 agent 的 `agentConfigDir(projectRoot, profile)/skills` 与 `path.join(os.homedir(), profile.configDirName, 'skills')`(项目级 + 用户级)。
  - `parseSlashSkill(prompt, skillDirs): string | undefined`:`prompt.trim()` 匹配 `^/([A-Za-z0-9][\w.:-]*)(\s|$)`;名含 `:` → 返回;否则任一 `skillDirs[i]/<名>/SKILL.md` 存在 → 返回;否则 undefined。
  - **产出规则**(`artifacts.ts`):
    - `classifyArtifactType(projectRelPath: string): ArtifactType | null` —— 先命中先用(`<F>` = `^docs/features/[^/]+/`):
      1. `ui_test_spec`:`<F>ui功能测试/[^/]*-ui功能测试-spec\.md$`
      2. `ui_test_report`:`<F>ui功能测试/([^/]*-ui功能测试报告\.(xlsx|md)|[^/]*-ui功能测试结果\.json|[^/]*\.png)$`
      3. `api_test_spec`:`<F>[^/]*-接口测试-spec\.md$`
      4. `api_test_report`:`<F>[^/]*(-接口测试报告\.md|-测试报告\.md|-接口测试验证\.jsonl)$`
      5. `unit_test_spec`:`<F>[^/]*-单元测试-spec\.md$`
      6. `unit_test_report`:`<F>[^/]*-单元测试报告\.md$`
      7. `spec`:`<F>[^/]*-spec\.md$`
      8. `plan`:`<F>plan/.+`
      9. `wireframe`:`<F>[^/]*-线框-v\d+\.html$`
      10. `knowledge`:`^docs/knowledge/.+` · 11. `code_map`:`^docs/code-map/.+` · 12. `design_map`:`^docs/design-map/.+` · 13. `schema_knowledge`:`^docs/schema-knowledge/.+`
      其余 → null。
    - `collectSessionArtifacts(ctx: SyncContext, events: TimelineEvent[], sessionCommits: IngestCommit[]): { artifacts: IngestArtifact[]; outputPaths: Set<string> }`(`sessionCommits` 为本会话已构造好的 commit;终端会话传空 `events` 与终端 commit):
      1. 候选:`event_type==='post_tool_use'` 且 `tool_name ∈ {Edit, Write, MultiEdit, NotebookEdit}` 且 `tool_result_summary` 解析后 `success !== false` 的事件,路径取 `tool_args.notebook_path ?? tool_args.file_path`(绝对路径);加上本会话 commit 的 `files`(仓库相对)。每个路径记 `lastChangeTs` = 该路径各来源 ts 的最大值。
      2. 路径归一:得到 `repoRel`(相对 `ctx.repoRoot`)与 `projectRel`(相对 `ctx.projectRoot`);任一不在根内或不过 `isSafeRelPath` → 丢弃。`outputPaths` = 全部候选的 `projectRel`(映射前)。
      3. `type = classifyArtifactType(projectRel)`,null → 不产出。
      4. `commit` = `ctx.commitEvents` 中第一个满足 `ts >= lastChangeTs` 且 `commit_files` 含 `repoRel` 的事件(不限会话)。
      5. 有 commit:`commitHash = ctx.git.isOnRemote(hash) ? hash : null`;`branch` = 该事件 `metadata.branch` 字符串或 null;`action = ctx.git.fileAddedIn(hash, repoRel) ? 'create' : 'modify'`。
         无 commit:文件当前不存在 → **不产出**;否则 `commitHash = null`、`branch = null`、`action = ctx.git.isTracked(repoRel) ? 'modify' : 'create'`。
         (已知近似,接受:文件在 S1 新建未提交、S2 又改,两会话都报 `create`;平台对 create 只升不降,影响限于该文件在 S2 也显示"新建"。)
      6. `path = repoRel`,`ts = lastChangeTs`。
    - `GitCache`(追加到 `git.ts`):`createGitCache(repoRoot: string): GitCache`,`isOnRemote(hash): boolean`(`git branch -r --contains <hash>` 输出非空;失败 false;按 hash 缓存)、`fileAddedIn(hash, repoRel): boolean`(`git show --diff-filter=A --name-only --format= <hash>` 行集合含之;按 hash 缓存)、`isTracked(repoRel): boolean`(`git ls-files -z` 首次调用一次性载入集合)。
  - **参考规则**(`references.ts`):
    - `isSedimentPath(projectRel)` —— `SEDIMENT_DIRS.some(d => projectRel.startsWith(d))`(`SEDIMENT_DIRS` 只在 `constants.ts` 定义)。
    - `inferSedimentReads(ctx, events): Map<string /*projectRel*/, string /*首见 ts*/>` —— 只看 `post_tool_use`:`Read` 取 `tool_args.file_path`;`Grep` / `Glob` 取 `tool_args.path`;`Bash` 取 `tool_args.command`:基准目录 `base = e.cwd`;命令匹配 `^\s*cd\s+("([^"]+)"|'([^']+)'|([^\s;&|]+))\s*(&&|;)` 时 `base = path.resolve(e.cwd, <目录>)`,其余部分为待切分文本;按 `/[\s'"`|;&<>()=,]+/` 切分,含 `$` 的片段跳过;相对片段按 `base` 解析、绝对片段原样;结果须在 `projectRoot` 内、`isSedimentPath`、`fs.statSync(…).isFile()`。
    - `collectSessionReferences(ctx, sessionId, events, outputPaths): IngestReference[]`:
      - 精确:`store.listReferenceRecords(projectRoot, sessionId)` → concept 原样;file 须 `isSedimentPath` 且不在 `outputPaths`,`value` 转 `repoRel`。
      - 推断:`inferSedimentReads` 结果中不在 `outputPaths` 的,`value` 转 `repoRel`。
      - 按 (kind, value) 去重保留最早 ts;file 的 `value` 须过 `isSafeRelPath`。
    - `store.listReferenceRecords(projectRoot: string, sessionId: string): Array<{ kind: 'concept' | 'file'; value: string; ts: string }>`(追加到 `store.ts`,按 id 升序)。
- 允许局部适配:模块内部辅助函数;哈希实现细节(须稳定、跨进程一致)。
- 具体要求:
  - **不得 import 或调用** `src/core/task/artifacts.ts` 的 `collectReferences` / `classifyArtifactPath`(它们服务本地 web,口径不同)。
  - 单文件 ≤ 600 行。
- 完成条件:
  - `npm run build`、`npm test` 通过。
  - 本仓库执行(`node -e` 调 `createSyncContext` + `buildSessionPayload(ctx, 'a680ce3f-4fb8-466f-8709-bec4753e8ff1', 0)`,打印 `JSON.stringify(session)`):
    - 结果字符串不含 `prompt_text`、`tool_args`、`command`、`/Users/` 子串;
    - `bindings` 含 `taskId: "T-24"`;
    - `references` 含 `docs/knowledge/开发任务.md`(由 `cd docs/knowledge; for f in 开发任务.md …` 推断 —— 若该命令形态不满足 `cd X && / cd X;` 前缀规则而未命中,如实记录,不扩展规则);
    - `artifacts` 含 `{type:'spec', path:'docs/features/2026-10-16-cgraphx接入研发管理平台/cgraphx接入研发管理平台-spec.md', commitHash:null}`(未提交时)。
  - `classifyArtifactType` 对 spec §5.5 表中每类给 1 个路径样例均返回正确类型,对 `docs/bruno/x.bru`、`docs/guides/a.md`、`docs/features/x/验收记录.md`、`src/a.ts` 返回 null(`node -e` 逐条打印核对)。
- 验证方式:上述 `node -e` 脚本(放 scratchpad,不入库)。
- 独立提交:是 —— `feat(sync): 上报内容构造——白名单正向构造 + 产物类型映射 + 沉淀参考推断`。
- 风险/注意事项:本会话的 `for f in …` 写法是 `cd docs/knowledge; for …`,符合 `cd X;` 前缀,应命中;`sed "$f"` 中的 `$f` 被跳过,文件名来自 `for` 列表的字面片段(相对 `docs/knowledge` 解析)。

---

### T-4: 同步执行器与 `sync now` / `status` / worker

- 目标:实现候选判定、分批上报、失败分级(重试 / 暂停 / 隔离)、进度推进、锁、worker 尾随一轮、状态报告。
- 对应 spec 条款:§4.1–§4.6、§7、§9(并发 / 中断 / 离线 / 幂等)。
- 强制引用:`docs/guides/coding-standards.md`、`docs/guides/interface-standards.md`
- 依赖:T-2、T-3。
- 涉及范围:新建 `src/core/sync/runner.ts`、`src/core/sync/lock.ts`、`src/core/sync/status.ts`;修改 `src/core/sync/{store,cli,index,constants}.ts`。
- 必须严格执行:
  - **调用签名**(T-3 原文):`createSyncContext(projectRoot: string): Promise<SyncContext>`、`buildSessionPayload(ctx: SyncContext, sessionId: string, afterEventId: number): Promise<BuiltSession>`、`buildTerminalPayload(ctx: SyncContext): BuiltSession | null`、`bindingsHashOf(entries)`;T-1:`listSessionEventMaxIds(projectRoot: string): Promise<Array<{ sessionId: string; maxId: number }>>`;T-2:`readConnection` / `getStatus` / `postIngest` / `SyncPlatformError`。
  - **常量追加**:`PAUSE_PROBE_MS = 30 * 60_000`、`FAIL_NOTICE_MS = 60 * 60_000`、`WORKER_TRAIL_MS = 10 * 60_000`、`BATCH_MAX_SESSIONS = 50`、`BATCH_MAX_EVENTS = 5000`、`BATCH_MAX_BYTES = 4 * 1024 * 1024`、`FOREGROUND_LOCK_WAIT_MS = 30_000`。
  - **门面追加**:`runSync(projectRoot: string, mode: 'foreground' | 'background'): Promise<SyncRunResult>`、`runWorker(projectRoot: string): Promise<void>`、`getSyncStatus(projectRoot: string): Promise<SyncStatusReport>`,
    `SyncStatusReport { connected: boolean; connection: SyncConnection | null; state: SyncStatusState; backlogEvents: number; pendingSessions: number; isolatedSessions: number }`。
  - **两个标记文件,语义分开**(`lock.ts`;`LOCK_FILENAME` 已由 T-2 定义,本任务向 `constants.ts` 追加 `WORKER_PID_FILENAME = 'sync-worker.pid'`):
    - **同步互斥锁 `.cgraphx/sync.lock`**:只在一次 `runSync` 期间持有。`acquireLock(projectRoot: string, waitMs: number): boolean` —— `fs.openSync(…, 'wx')` 写 `{"pid":…,"startedAt":…}`;已存在时读出 pid,`process.kill(pid, 0)` 抛 ESRCH,或文件 mtime 超 `LOCK_STALE_MS` → 删除后重试一次;`waitMs > 0` 时每 1 秒重试直到超时。`releaseLock(projectRoot: string): void`(只删内容为本进程 pid 的锁)。
    - **worker 存活标记 `.cgraphx/sync-worker.pid`**:worker 整个生命周期(含尾随睡眠)持有。`claimWorker(projectRoot: string): boolean`(同样 `wx` + 同一套陈旧判定;已有存活 worker → false,调用方直接退出)、`refreshWorker(projectRoot: string): void`(每轮更新 mtime,防止被判陈旧)、`releaseWorker(projectRoot: string): void`(只删本进程 pid 的文件)、`isWorkerAlive(projectRoot: string): boolean`(文件存在 + pid 存活 + mtime 未超 `LOCK_STALE_MS`;供 T-5 hook)。
  - **`runSync` 算法**(顺序固定):
    1. `conn = readConnection` 为 null → foreground 抛 `SyncNotConnectedError('未接入平台,先运行 cgraphx sync connect')`,background 返回 `stoppedBy:'not_connected'`。
    2. 取锁(foreground 等 `FOREGROUND_LOCK_WAIT_MS`,失败抛 `SyncBusyError('后台同步正在进行,稍后再试')`;background 不等,失败返回 `stoppedBy:'busy'`)。`finally` 释放。
    3. 暂停处理:`state.pausedReason === 'invalid_token'` → 返回 `stoppedBy:'paused'`(foreground 的 `error` 为"上报凭据已失效,请重新接入")。其余暂停原因:background 且 `now - lastProbeAt < PAUSE_PROBE_MS` → 返回 `paused`;否则 `getStatus` 探测并写 `lastProbeAt`:成功 → 清除 `pausedReason/pausedAt`,继续;`SyncPlatformError` 且 code ∈ `PAUSE_REASONS` → 更新 `pausedReason`,返回 `paused`;其它错误 → 返回 `failing`(不改 `failingSince`)。
    4. 写 `lastAttemptAt`;`ctx = createSyncContext`;`locals = listSessionEventMaxIds`;`rows = store.listSessions()`(Map)。
    5. 候选 agent 会话 S:`row` 不存在;或 `maxId > row.last_event_id`;或 `row.pending_push === 1`;或 `bindingsHashOf(ctx.bindingsBySession.get(S) ?? []) !== row.bindings_hash`;或 `row.isolated_reason !== null && row.isolated_client_version !== ctx.clientVersion`(升级后重试被隔离的会话,spec §4.5);且**排除** `row.isolated_reason !== null && row.isolated_client_version === ctx.clientVersion`。终端会话同样适用隔离排除规则。
    6. 对候选 `built = buildSessionPayload(ctx, S, row?.last_event_id ?? 0)`;若 `built.session.events.length === 0 && built.extrasHash === row?.extras_hash` → 只更新 `pending_push`(若变化),不发送。终端会话:`buildTerminalPayload(ctx)` 非 null 且 `extrasHash !== row?.extras_hash` → 发送。
    7. **发送前断言**:每条 `commits[].files[]`、`artifacts[].path`、`references[kind=file].value` 过 `isSafeRelPath`,不过 → 从该会话移除该条并写 stderr `[sync] 已丢弃不安全路径 1 条`(不含路径原文)。
    8. 分批:一个会话事件 > `BATCH_MAX_EVENTS` 时按事件切块,同 `clientSessionId` 多块,`bindings/commits/artifacts/references` 只放最后一块;批次按 `BATCH_MAX_SESSIONS` / `BATCH_MAX_EVENTS` / `JSON.stringify` 字节 ≤ `BATCH_MAX_BYTES` 装箱。`backlog` 字段 = 本轮剩余未确认的 `recordCount` 总和。
    9. 逐批 `postIngest`:
       - 200 → 对批内每块:非最后块只推进 `last_event_id`;最后块写 `last_event_id = built.maxEventId`、`bindings_hash`、`extras_hash`、`pending_push`、`uploaded_at = now`,清 `isolated_*`;累计 `warnings.length`。
       - `payload_too_large` → 批内 >1 块:对半拆分递归重发;单块:事件再对半切块重发(切到 1 条仍 413 → 视为 `validation_failed` 隔离)。
       - `validation_failed` → 批内 >1 个会话:按会话对半递归;单会话 → `store.isolateSession(id, message, ctx.clientVersion)`,`isolatedNew++`,继续后续批次。例外:若**第一个**单会话请求就被拒、且 message 涉及远程地址(包含 `remote` / `远程`),判为整批级错误 —— 不隔离,按 `failing` 终止本轮(`lastError = message`)。
       - code ∈ `PAUSE_REASONS` → `store.setPaused(code, now)`,终止本轮,`stoppedBy:'paused'`。
       - 其它(`internal_error`、`http_*` 可重试、`SyncNetworkError`)→ `failingSince ??= now`,`lastError = <message>`,终止本轮,`stoppedBy:'failing'`。
    10. 本轮所有批次成功 → `lastSuccessAt = now`、`failingSince = null`、`lastError = null`;写 `lastResult`;返回结果。
  - **`runWorker`**:`if (!claimWorker(root)) return; try { loop { result = await runSync(root, 'background'); if (result.stoppedBy !== null && result.stoppedBy !== 'busy') break; mark = (各会话 maxId 的最大值, commit 事件数); refreshWorker(root); await sleep(WORKER_TRAIL_MS); refreshWorker(root); 若 新 mark 与 mark 相同 → break } } finally { releaseWorker(root) }`;任何异常写 stderr 后退出码 0。(`busy` = 前台 `sync now` 正持有同步锁,睡一轮后再试。)
  - **`getSyncStatus`**:`connected = readConnection !== null`;`backlogEvents` = Σ(各候选会话 `id > last_event_id` 的事件数,经 `listSessionEventsAfter(…).length`);`pendingSessions` = 候选会话数(含终端会话需发送时);`isolatedSessions` = `isolated_reason IS NOT NULL` 行数。
  - **CLI 追加**:
    - `sync now [--json]`:前台 `runSync(root, 'foreground')`;输出 `同步完成:上报 <sessionsSent> 个会话、<recordsSent> 条记录` + (`isolatedNew>0` 时)`;<n> 个会话被平台拒收,已隔离`;`stoppedBy` 非 null 时按原因输出(paused → spec §3.3 对应提示;failing → `同步失败:<error>,本地数据已保留,稍后自动重试`)。
    - `sync status [--json]`:未接入 → `未接入平台(cgraphx sync connect 接入)`;已接入输出:平台地址、项目、账号、最后成功同步、积压(`backlogEvents` 条事件 / `pendingSessions` 个会话)、暂停原因(若有)、被拒收会话数(若有)、最近一次结果或错误。
    - **`sync connect` 的 `already` 分支补状态**(spec §3.1「已接入 → 显示同步状态」):T-2 的提示行之后接着输出 `sync status` 的同一份内容;`--json` 时输出 `{ ...ConnectOutcome, status: SyncStatusReport }`。
    - **退出码按结果映射**(不在 action 里写字面量,interface-standards「退出码」):`errors.ts` 追加 `exitCodeForRunResult(result: SyncRunResult): number` —— `stoppedBy` 为 null → 0;`'paused'` → 4;`'failing'` → 5;`'busy'` → 1;`'not_connected'` → 2。`sync status` 未接入 → 抛 `SyncNotConnectedError` 经 `exitCodeForError` 得 2。
    - 隐藏顶层命令 `sync-worker [--project <path>]`(`{ hidden: true }`):`runWorker(path ?? resolveProjectRoot(process.cwd()))`,stdout 恒空,退出码恒 0。
- 允许局部适配:`runner.ts` 内部拆分(超 600 行可拆 `batch.ts`);状态输出排版。
- 具体要求:
  - 不得用回执 `accepted` 计数推进进度(spec §4.6)。
  - `warnings` 不触发重试或提示。
- 完成条件:
  - implementer 可验证(不需要平台与密码):
    - `npm run build`、`npm test` 通过。
    - 未接入(scratchpad 中 `git init` + 加 origin + `cgraphx install` 的临时仓库):`sync now` 退出码 2、`sync status` 退出码 2 并提示接入。
    - 不可达平台:临时仓库写入 `task-source.json` = `{"url":"http://127.0.0.1:9/api/client/v1/tasks","headers":{"Authorization":"Bearer x"}}` 后 `sync now` → 退出码 5,`sync status` 显示最近错误、`backlogEvents` > 0(先用 `echo '{…}' | node dist/cli/index.js timeline-user-prompt-hook` 造一条事件)。
    - 锁:手工写入一个含不存活 pid 的 `sync.lock` 后 `sync now` 能接管(陈旧锁);`sync-worker.pid` 指向本 shell pid(`$$`)时 `isWorkerAlive` 为 true(`node -e` 调用核对)。
  - **人工验收**(负责人执行;平台不可用时记为"待人工验收",不报 PLAN_CONFLICT;本仓库已有凭据,无需输入密码):
    - `node dist/cli/index.js sync now` 首次上报会话数 >0;立即再执行一次上报 0 个会话(或只含当前会话新事件);`sync status` 的最后成功同步刷新。
    - 幂等:平台库对本仓库 `client_sessions` / `events` / `commits` 计数;`node -e` 清空本地 `sync_sessions` 后再 `sync now`,计数不变。
    - 离线:停掉平台后 `sync now` → 退出码 5;恢复后 `sync now` 成功,积压归零。
    - 并发:同时启动两个 `sync now`,一个成功,另一个 30 秒内成功或提示"后台同步正在进行";平台计数不重复。
- 验证方式:上述命令;平台库计数用 cgraphx-server 仓库的 `node -e` + `pg`(连接串取其 `.env`,只读 `SELECT count(*)`)。
- 独立提交:是 —— `feat(sync): 同步执行器——分批上报 + 暂停/隔离/重试 + sync now/status`。
- 风险/注意事项:首次全量回传约 1.2 万事件,批次装箱须正确推进水位;中途 kill 进程后再跑不得重复计数(平台幂等兜底)。

---

### T-5: 同步 hook、会话开始提示、安装器接入

- 目标:hook 只做文件检查并拉起 worker;会话开始时按暂停 / 连续失败输出一行提示;`cgraphx install` / `uninstall` 接入与移除 sync hook。
- 对应 spec 条款:§4.1「自动」、§4.4「员工感知」、§8「hook 预算」「旧版 cgraphx 共存」「已安装项目」「多 agent」。
- 强制引用:`docs/guides/coding-standards.md`、`docs/guides/interface-standards.md`
- 依赖:T-4(`sync-worker` 命令;`isWorkerAlive(projectRoot: string): boolean`,`lock.ts`,经 sync 门面导出)。
- 涉及范围:新建 `src/core/sync/hooks.ts`、`src/core/sync/installer.ts`;修改 `src/core/sync/{index,cli,constants}.ts`、`src/cli/installer/agent-steps.ts`。
- 必须严格执行:
  - **常量追加**:`TRIGGER_THROTTLE_MS = 60_000`、`HOOK_PERF_WARN_MS = 50`、`SYNC_HOOK_MARKER = 'cgraphx sync-'`、`PAUSE_NOTICES: Record<PauseReason, string>`(文案同 T-2 错误提示表对应行,`invalid_token` 为"上报凭据已失效,请运行 cgraphx sync connect 重新接入")。
  - **`syncStopHook(profile: AgentProfile): Promise<void>`**(Stop / SessionEnd 共用):
    1. `isKillSwitchOn()`(timeline 门面)→ return,不读 stdin。
    2. 读 stdin JSON(本模块自带读取函数,规则同 task hook:TTY / 空 / 非对象 → return);`projectRoot = resolveProjectRoot(cwd ?? process.cwd())`;`!isInitialized` → return。
    3. `readConnection(projectRoot) === null` → return。
    4. `<.cgraphx>/sync-trigger` 存在且 `now - mtime < TRIGGER_THROTTLE_MS` → return;`isWorkerAlive(projectRoot)` → return(worker 尾随睡眠期间仍存活,不重复拉起)。
    5. 写 / touch `sync-trigger`,`spawnSyncWorker(projectRoot)`。
    6. 全程 try/catch,失败写 stderr `[sync] hook 失败(已忽略,不影响会话):<message>`;**stdout 恒空**;退出码恒 0;不打开数据库。
  - **`syncSessionStartHook(profile: AgentProfile): Promise<void>`**:
    1–3 同上。
    4. 打开 `openSyncDb` 读 `status`:`pausedReason` 非空 → 文案 `平台上报已暂停:${PAUSE_NOTICES[reason]}。本地照常记录,恢复后自动补传。`;否则 `failingSince` 非空且 `now - failingSince > FAIL_NOTICE_MS` → `平台上报已连续失败超过 1 小时(最近错误:${lastError}),本地数据已保留;可运行 cgraphx sync now 重试。`;否则无文案。
    5. 有文案 → stdout 写一行 `{"hookSpecificOutput":{"hookEventName":"SessionStart","additionalContext":<文案>}}`。
    6. 再执行 Stop hook 的第 4–5 步(拉起 worker)。
    7. 失败处理同上(出错时不输出任何 stdout)。
  - **`installer.ts`**:`installSyncHooks(projectRoot: string, opts: { agent?: AgentId }): { written: string[]; skipped: string[] }`、`uninstallSyncHooks(projectRoot: string, opts: { agent?: AgentId }): { removed: string[] }`;接入项:
    | 事件 | 命令 |
    |---|---|
    | `SessionStart` | `silent(hookCommand('cgraphx sync-session-start-hook', profile))` |
    | `Stop` | `silent(hookCommand('cgraphx sync-stop-hook', profile))` |
    | `SessionEnd` | `silent(hookCommand('cgraphx sync-stop-hook', profile))` |
    `silent(cmd) = cmd + ' 2>/dev/null || true'`(spec §8「旧版 cgraphx 共存」:PATH 命中的旧版全局 cgraphx 不认识新命令时会 `error: unknown command` 并退出 1 —— 兜底后不出错误输出、退出码 0;代价是 hook 自身的 stderr 告警不可见,fail-silent 可接受)。
    幂等比较用**完整命令串**(同事件已有相同命令跳过);卸载仍按 `SYNC_HOOK_MARKER`(`cgraphx sync-`)识别,不碰其它 hook、清空空组与空事件键 —— 写法参照 `src/core/task/installer.ts`(**复制模式,不 import 其内部**)。
  - **CLI 追加**:隐藏顶层命令 `sync-session-start-hook` / `sync-stop-hook`,均 `{ hidden: true }`、`--agent <id>`,经 agents 门面 `resolveHookAgent` 得到 profile。
  - **`agent-steps.ts`**:`installAgentHooks` 在 task hook 之后对每个 target 调 `installSyncHooks(projectRoot, { agent: target.id })`,成功日志 `${prefix}平台同步 hook 已装:<written.join('/') 或 已存在(幂等)>`,失败 `clack.log.warn` 不中断;`uninstallAgentHooks` 对称调用 `uninstallSyncHooks`,日志 `${prefix}平台同步:已移除 hooks(…)`。动态 `import('../../core/sync')`,与既有写法一致。
- 允许局部适配:stdin 读取函数实现;日志措辞。
- 具体要求:
  - hook 内**禁止**任何网络请求、禁止 await 子进程;spawn 后立即返回。
  - 超过 `HOOK_PERF_WARN_MS` 写 stderr 告警(同既有惯例)。
- 完成条件:
  - `npm run build`、`npm test` 通过。
  - `node dist/cli/index.js install`(本仓库重装)后 `.claude/settings.json` 出现 3 个 `cgraphx sync-` 项;再装一次不重复;`uninstall --keep-data` 后 3 项消失、其它 hook 不变(验证完重新 install 恢复)。
  - `echo '{"session_id":"x","cwd":"'"$PWD"'"}' | node dist/cli/index.js sync-stop-hook` 耗时 < 100ms(`time`)、stdout 为空,且随后 `ps` 可见 `sync-worker` 进程;worker 存活期间(含尾随睡眠)再触发不重复拉起(删除 `sync-trigger` 绕过节流后再触发,`ps` 仍只有 1 个 worker)。
  - 旧版兜底:`sh -c "$(node -e "…取 settings.json 中 Stop 的 sync 命令…" | sed 's/^cgraphx/cgraphx-not-exist/')"` 退出码 0 且无输出(模拟命令不存在)。
  - 人为在 `sync_state.status` 写入 `pausedReason:"not_project_member"` 后执行 `echo '{…}' | node dist/cli/index.js sync-session-start-hook` 输出含「平台上报已暂停」的 hookSpecificOutput 一行;清除后无输出。验证完恢复状态。
  - `CGRAPHX_NO_TIMELINE=1` 时两个 hook 均无输出、不拉起进程。
  - 【待确认,实测】在 CodeBuddy 会话中确认 timeline / task / sync 三个 SessionStart hook 的上下文均出现;被覆盖时 PLAN_CONFLICT 上报。
- 验证方式:上述命令。
- 独立提交:是 —— `feat(installer): 接入平台同步 hook——Stop/SessionEnd 拉起后台同步 + 会话开始提示`。
- 风险/注意事项:`2>/dev/null || true` 依赖 POSIX shell;Claude Code / CodeBuddy 在 macOS / Linux 以 sh 执行 hook。Windows 下的 hook shell 未实测【待确认】——不影响本期(团队环境为 macOS),实测发现不兼容时 PLAN_CONFLICT 上报。

---

### T-6: docs 精确参考记录、`show --body`、skill 改读法

- 目标:`cgraphx docs` 在执行时记下召回命中的概念与输出了正文的文档;提供正文输出;两个 skill 改用它读正文。
- 对应 spec 条款:§5.6「识别 · 精确记录」「知识库正文的读取方式」、§8「本地 web / 本地命令」。
- 强制引用:`docs/guides/coding-standards.md`、`docs/guides/interface-standards.md`
- 依赖:T-2(`recordReferenceHit`)。
- 涉及范围:`src/core/markdown/cli.ts`;`assets/claude-template/skills/knowledge-recall/SKILL.md`、`assets/claude-template/skills/knowledge-api/SKILL.md`、`assets/claude-template/skills/knowledge-api/agent-prompt.md`、`assets/claude-template/agents/knowledge-recall.md`。
- 必须严格执行:
  - **调用签名**(T-2 原文):`recordReferenceHit(projectRoot: string, hit: { kind: 'concept' | 'file'; value: string; sessionId?: string }): void`(绝不抛错、绝不输出),从 `../sync` 门面导入。
  - `docs find`:新增 `--session <id>`;查询成功后,若 `options.concept` 非空且结果中任一文档的 `concepts` 数组**包含与 `options.concept` 完全相同的字符串** → `recordReferenceHit(projectRoot, { kind: 'concept', value: options.concept, sessionId: options.session })`。其它过滤条件(`--q` / `--domain` / `--tag` …)不记录。**stdout / stderr 输出与改动前逐字节一致**。
  - `docs show`:新增 `--body`、`--session <id>`。不带 `--body` 时行为与输出不变、不记录。带 `--body`:读 `path.join(projectRoot, detail.path)` 原文,`stripFrontmatter` 去头;文本模式输出 `# <title>\n> path: <detail.path>\n\n<正文>`(正文末尾补换行);`--json` 输出 `{ ...detail, body: <正文> }`;读文件失败 → stderr `Document file unreadable: <path>`,退出码 1,不记录。成功后 `recordReferenceHit(projectRoot, { kind: 'file', value: detail.path, sessionId: options.session })`。命令描述改为 `Show metadata + summary for a document (--body prints the full body)`。
  - **skill 改读法**(只改"读知识库正文"的指引,其它内容不动):
    | 文件 | 改为 |
    |---|---|
    | `skills/knowledge-recall/SKILL.md` 第 22–23 行的 "`Read` 它" / "`Read` 子 agent 返回的流程文档 path" | "用 `cgraphx docs show <path> --body` 读正文" |
    | `skills/knowledge-api/SKILL.md` 命令表(第 29 行附近) | 新增一行:`文档正文` → `cgraphx docs show <doc-id-or-path> --body` |
    | `skills/knowledge-api/SKILL.md` 第 45、48、112、118、129 行处"用 Read 看全文 / Read 原文 / 直接 Read / AI 想看就 Read / AI 自己 Read" | 改为 `cgraphx docs show <path> --body`(第 69 行"Read 本 skill 目录下的 `./agent-prompt.md`"是读 skill 附件,**不改**) |
    | `skills/knowledge-api/agent-prompt.md` 第 21、27–28 行的 `Read` | 同上 |
    | `agents/knowledge-recall.md` 第 113 行 "主 agent 要看正文会自己 Read" | "主 agent 要看正文会用 `cgraphx docs show <path> --body`" |
    并在 `knowledge-api/SKILL.md` 与 `knowledge-recall/SKILL.md` 各加一句(放在读正文指引旁):`读 docs/knowledge 正文一律用 docs show --body,不用 cat / sed / Read——这样读过的文档才会被记录为任务参考。`
- 允许局部适配:skill 句子的衔接措辞(语义不变);行号以实际文件为准。
- 具体要求:改 skill 的入口是 `assets/claude-template/`,不改仓库根 `.claude/`。
- 完成条件:
  - `npm run build`、`npm test` 通过。
  - **改动前先留基线**:用当前 dist 执行 `docs find --concept=开发任务 --json`、`docs find --concept=开发任务`、`docs show docs/knowledge/开发任务.md`,输出存到 scratchpad。
  - 改动并 build 后,在有 `CLAUDE_CODE_SESSION_ID` 的环境执行同样三条命令,与基线 diff 为空;`node -e` 查 `sync_reference_records` 新增 `(会话, concept, 开发任务)`。
  - `node dist/cli/index.js docs show docs/knowledge/开发任务.md --body` 输出正文、新增 `(会话, file, docs/knowledge/开发任务.md)`。
  - 无会话环境(`env -u CLAUDE_CODE_SESSION_ID -u CODEBUDDY_SESSION_ID`)执行同样命令:输出相同、不新增记录、无报错。
  - 上表 5 个文件中,原表格列出的"Read 读知识库正文"句子全部替换(逐条对照表格核对;`knowledge-api/SKILL.md` 第 69 行保留)。
- 验证方式:上述命令。
- 独立提交:是 —— `feat(docs): 精确记录召回命中与正文读取——find 记概念 + show --body` 与 `feat(skills): knowledge-recall/knowledge-api 改用 docs show --body 读正文` 两条。
- 风险/注意事项:
  - `find` 的 `--concept` 是精确匹配概念名(大小写敏感);如果实测发现别名也会命中,只记录与结果 `concepts` 完全一致的值,不做别名映射。
  - 旧版全局 cgraphx 不认识 `docs show --body`:skill 改读法后,未升级全局 cgraphx 的机器读正文会报 `unknown option`。在两个 skill 读正文指引旁注明回退:`若提示 unknown option '--body',说明全局 cgraphx 未升级——先 npm i -g cgraphx 升级`(不提供 cat 回退,避免绕开记录)。
