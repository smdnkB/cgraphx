# 后端任务: 任务会话映射与 timeline 采集增强

> 所属 plan: `任务会话映射与timeline采集增强-index.md`
> spec: `../任务会话映射与timeline采集增强-spec.md`(条款编号以 spec 原文为准)

---

### T-1: timeline 采集增强

- 目标:补齐 timeline 中影响归属准确性的采集缺口,并向 task 子系统导出两个公共符号。
- 对应 spec 条款:§8(第 1~6 项与补充约束)、§9「关闭开关」、§10「旧的共享 turn 状态文件」。
- 强制引用:`coding-standards.md`、`interface-standards.md`
- 依赖:无
- 涉及范围:
  - `src/core/timeline/constants.ts`、`types.ts`、`payload.ts`、`hooks.ts`(可抽出 `turn-state.ts`)、`post-tool-summary.ts`、`store.ts`、`cli.ts`、`installer.ts`、`index.ts`
  - `src/web/constants.ts`、`src/web/pages-timeline.ts`(只为编译补映射)
  - `__tests__/core/timeline/turn-id.test.ts`、`duration.test.ts`(约第 403 行手写旧 turn 文件)、`installer.test.ts`(只修正被改动弄红的断言)
- 必须严格执行:
  - `EventType` 新增 `'session_start' | 'session_end'`;`timeline_events` 表结构和 `TIMELINE_SCHEMA_VERSION` 不变。
  - `HOOK_EVENTS_TO_COMMANDS` 追加两项:`{ event: 'SessionStart', subcommand: 'timeline-session-start-hook' }`、`{ event: 'SessionEnd', subcommand: 'timeline-session-end-hook' }`;`cli.ts` 注册同名隐藏命令,调用 `sessionStartHook()` / `sessionEndHook()`。
  - 新常量 `export const CLAUDE_SESSION_ID_ENV = 'CLAUDE_CODE_SESSION_ID';`(constants.ts)。
  - `index.ts` 门面新增导出:`isKillSwitchOn`(来自 hook-runner)、`CLAUDE_SESSION_ID_ENV`。
  - turn 状态文件路径改为 `<projectRoot>/.cgraphx/turns/<安全会话名>.json`。安全会话名:session_id 只含 `[A-Za-z0-9_-]` 时原样使用;否则取 session_id 的 sha1 hex 前 16 位;session_id 为 null 时用 `_nosession`。文件内容格式不变(`{turn_id, session_id, ts}`),读取仍校验 session_id,缺失或损坏返回 null。
  - 新逻辑不再读写 `.cgraphx/timeline-current-turn.json`。`installTimelineHooks` 在写完 settings 之后,若 `<resolvedRoot>/.cgraphx/timeline-current-turn.json` 存在就删除,失败只写 stderr。`debris.ts` 不改。
  - `sessionStartHook`:写入 `event_type: 'session_start'`、`session_id`、`cwd`、`turn_id: null`;payload 带字符串 `source` 时写入 `metadata.source`,否则不带 metadata。
  - `sessionEndHook`:写入 `event_type: 'session_end'`,`metadata.reason` 规则同上;事件写入后删除本会话的 turn 状态文件(不存在就忽略,失败只写 stderr)。
  - `HookPayload` 新增 `source?: string`、`reason?: string`(在 `extractHookPayload` 中只接受 string);`assertEventType` 的合法列表加入两种新类型。
  - `gitCommitHook`:`session_id` 取 `process.env[CLAUDE_SESSION_ID_ENV]`(非空字符串才用,否则 null);`GitCommitInfo` 新增 `branch: string | null`,由 `git rev-parse --abbrev-ref HEAD` 得到,输出为 `HEAD` 或命令失败时为 null;事件 `metadata` 在 branch 非 null 时为 `{ branch }`。
  - `summarizeToolResponse` 新增 `case 'Skill'`:`payload.skill` 取 `toolArgs.skill`(string 才取);`success` 判定沿用 `looksLikeError`;不再写 `response_preview`。
  - `store.stats` 的 `byType` 初值包含两种新类型(值为 0);`cli.ts` 的 `describeEvent` 增加 `session_start` → `session started (<source>)`、`session_end` → `session ended (<reason>)`(缺字段时省略括号);`--type` 帮助文本列出 7 种类型。
  - web:`EVENT_TYPE_LABELS` 增加 `session_start: '会话开始'`、`session_end: '会话结束'`;`EVENT_TYPE_CHIP_TONE` 两者都映射为 `'stop'`;`pages-timeline.ts` 第 537 行附近的计数初值补两个 0。`TIMELINE_EVENT_TYPES`(筛选 chip 顺序)不改。
- 允许局部适配:turn 状态逻辑是否抽出 `turn-state.ts`;私有函数命名。
- 具体要求:
  - **开工第一步**:在真实 Claude Code 会话里用 Bash 执行 `echo $CLAUDE_CODE_SESSION_ID`,确认非空。为空就按 `PLAN_CONFLICT` 上报,不要继续做第 1 项。
  - 所有新 hook 走既有 `runHook`,保持 stdout 为空、退出码为 0、await 写库。
  - `HOOK_EVENTS_TO_COMMANDS` 是 installer 和 cli 的唯一来源,不得另写一份。
  - 被改动的英文注释重写为中文。
- 完成条件:
  - `npm run build` 通过,`npx vitest run` 全绿(只修正被改动弄红的断言:turn 文件路径、hook 事件清单从 4 个变 6 个)。
  - 手动验证(在临时 git 仓库里先跑 `node dist/cli/index.js install -y`):
    - `echo '{"session_id":"s1","cwd":"'$PWD'","source":"startup"}' | node <repo>/dist/cli/index.js timeline-session-start-hook`,然后 `timeline query --type session_start` 能看到 `metadata.source = startup`。
    - 依次对 s1、s2 跑 user-prompt-hook,`.cgraphx/turns/` 下出现两个文件,互不覆盖。
    - `CLAUDE_CODE_SESSION_ID=s1 git commit --allow-empty -m t` 之后,`timeline query --type git_commit` 的最新一条 session_id 为 s1,且带 `metadata.branch`。
- 验证方式:上面的命令输出,加上 `node dist/cli/index.js web` 打开时间线页不报错。
- 独立提交:是。提交 `feat(timeline): 采集增强——commit 记会话与分支 + turn 状态按会话隔离 + 会话起止事件 + Skill 名`
- 风险/注意事项:
  - git hook 是后台运行的(`&`),环境变量仍会被子进程继承,不要改 post-commit 片段。
  - `CGRAPHX_NO_TIMELINE` 的语义不变;新 hook 自动受 `runHook` 里的开关控制。

---

### T-2: task 子系统核心

- 目标:建立 task 的存储、外部接口、解析、绑定、需求目录关联,以及门面。
- 对应 spec 条款:§3.1、§3.2、§3.3、§4、§5.1 / §5.2 / §5.5 的解析与绑定规则、§6.1、§6.2、§6.3(判定逻辑,不含 hook 接线)、§9。
- 强制引用:`coding-standards.md`、`data-standards.md`
- 依赖:T-1(门面导出 `isKillSwitchOn`、`CLAUDE_SESSION_ID_ENV`)
- 涉及范围:
  - 新增 `src/core/task/`:`index.ts`、`types.ts`、`errors.ts`、`constants.ts`、`schema.sql`、`schema-bootstrap.ts`、`store.ts`、`source.ts`、`resolve.ts`、`binding.ts`、`feature-link.ts`
  - `src/core/features/scanner.ts`、`src/core/features/index.ts`(新增函数)
  - `scripts/copy-assets.cjs`(登记 `src/core/task/schema.sql` → `dist/core/task/schema.sql`,并更新文件头注释清单)
- 必须严格执行:
  - **schema.sql**(全部 `IF NOT EXISTS`):

    ```
    task_schema_versions(version INTEGER PRIMARY KEY, applied_at INTEGER NOT NULL, description TEXT)
      + INSERT OR IGNORE (1, 当前毫秒, 'Initial task schema')
    task_items(
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      source TEXT NOT NULL CHECK (source IN ('api','manual')),
      external_id TEXT,
      name TEXT NOT NULL,
      url TEXT,
      status TEXT,
      raw TEXT,            -- JSON
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL)
    UNIQUE INDEX task_items_api_external_idx ON task_items(external_id) WHERE source = 'api'
    UNIQUE INDEX task_items_manual_name_idx  ON task_items(name)        WHERE source = 'manual'
    task_sessions(
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id TEXT NOT NULL,
      task_id INTEGER NOT NULL REFERENCES task_items(id),
      bound_at TEXT NOT NULL,
      unbound_at TEXT,
      bind_source TEXT NOT NULL CHECK (bind_source IN ('cli','feature_dir')))
    UNIQUE INDEX task_sessions_open_idx ON task_sessions(session_id) WHERE unbound_at IS NULL
    INDEX task_sessions_task_idx ON task_sessions(task_id)
    task_reminders(
      session_id TEXT NOT NULL,
      bound_task_id INTEGER NOT NULL,
      other_task_id INTEGER NOT NULL,
      created_at TEXT NOT NULL,
      PRIMARY KEY (session_id, bound_task_id, other_task_id))
    ```

  - `constants.ts`:`TASK_SCHEMA_VERSION = 1`、`TASK_SOURCE_CONFIG_FILENAME = 'task-source.json'`、`TASK_SOURCE_TIMEOUT_MS = 10_000`、`TASK_SOURCES = ['api','manual'] as const`、`BIND_SOURCES = ['cli','feature_dir'] as const`、`FEATURE_TASK_HEADER_KEY = '任务'`。
  - `types.ts`(行类型用 `XxxRow` 加 snake_case,不出 store 层):

    ```ts
    type TaskSource = (typeof TASK_SOURCES)[number];
    type BindSource = (typeof BIND_SOURCES)[number];
    interface TaskItem { id: number; source: TaskSource; externalId: string | null; name: string;
      url: string | null; status: string | null; createdAt: string; updatedAt: string }
    interface TaskBinding { id: number; sessionId: string; taskId: number; boundAt: string;
      unboundAt: string | null; bindSource: BindSource }
    interface TaskSourceConfig { url: string; headers: Record<string, string> }
    interface RemoteTask { id: string; name: string; url: string | null; status: string | null; raw: unknown }
    interface TaskListResult { tasks: TaskItem[]; currentTaskId: number | null; warning: string | null }
    interface BindResult { status: 'bound' | 'already' | 'switched'; task: TaskItem; previous: TaskItem | null; binding: TaskBinding }
    interface CurrentBinding { binding: TaskBinding; task: TaskItem }
    type AutoBindOutcome =
      | { kind: 'none' }
      | { kind: 'bound'; task: TaskItem }
      | { kind: 'remind'; boundTask: TaskItem; otherTask: TaskItem; message: string };
    interface TaskDetail { task: TaskItem; featureDirs: string[]; sessions: TaskBinding[];
      commits: TimelineEvent[]; eventCounts: Record<string, number>; events: TimelineEvent[] | null }
    ```

  - `errors.ts`:`TaskError extends Error`;`TaskConfigError`(未初始化 / 配置非法)、`TaskArgError`(参数、会话、解析失败)、`TaskStoreError`(DB)、`TaskSourceUnavailableError`(接口失败)都继承 `TaskError`。消息带修复提示。
  - `schema-bootstrap.ts`:`ensureTaskSchema(db)`、`openTaskDb(projectRoot)`。行为照搬 timeline:库不存在抛 `TaskConfigError`(提示 `cgraphx install`),版本比本构建新时抛 `TaskConfigError`(提示升级)。
  - **source.ts**:
    - `loadTaskSourceConfig(projectRoot): TaskSourceConfig | null`:文件不存在返回 null;JSON 非法、`url` 不是非空字符串、`headers` 不是 string→string 对象时抛 `TaskConfigError`(消息写明文件路径和问题)。
    - `fetchRemoteTasks(config): Promise<{ tasks: RemoteTask[]; skipped: number }>`:`GET url`,带 headers,`AbortController` 超时 `TASK_SOURCE_TIMEOUT_MS`;非 2xx、超时、body 不是 `{tasks: []}` 时抛 `TaskSourceUnavailableError`(带原因);条目缺 `id` 或 `name` 非空字符串时跳过并计入 skipped。
  - **解析规则 resolve.ts**(spec §5.2、§6.2,逐条照做):
    - `findTask(store, value)`:序 1 纯数字且等于本地 id → 序 2 等于 api 任务的 external_id → 序 4 等于 manual 任务的 name;都不中返回 null。
    - `resolveTaskForUse(projectRoot, value, { manual?: boolean }): Promise<TaskItem>`,严格按 spec §5.2 的顺序执行,先命中先用:
      1. 纯数字且等于本地 id。
      2. 等于 api 任务的 external_id。
      3. 已配置接口时拉取一次并 upsert,再按 external_id 查找。拉取失败时:`manual` 为 true 就在 stderr 输出 `[task]` 警告后继续往下走;否则抛 `TaskSourceUnavailableError`。
      4. 等于 manual 任务的 name。
      5–6. 未配置接口,或 `manual` 为 true → 按 name upsert 手动任务。
      7. 否则抛 `TaskArgError('接口中找不到任务 <value>;核对编号,或加 --manual 建手动任务')`。
    - `resolveDeclaredTask(store, value, configured: boolean)`:先 `findTask`;未命中时,configured 为 true 就以 `external_id = name = value` 插入 api 占位,否则按 name upsert 手动任务。不发网络请求。
  - **upsert 口径**:api 任务按 external_id 更新 `name`、`url`、`status`、`raw`、`updated_at`;接口不再返回的不删除。manual 同名复用。
  - **listTasks(projectRoot, { local?: boolean })**:未配置或 `local` 为 true → 只读本地;已配置 → 拉取并 upsert,失败时 `warning = '<原因>;已显示本地缓存'`,不抛错。返回所有 api 和 manual 任务(按 source、id 排序)。`currentTaskId` 取 `resolveSessionId()` 对应的生效绑定,没有就是 null。
  - **binding.ts**(都在一个事务里完成):
    - `bindSession(projectRoot, sessionId, taskId, bindSource): Promise<BindResult>`(因为 timeline 门面的 `getSessionStats` 是 async):有生效绑定且是同一任务 → `already`;有生效绑定但任务不同 → 旧绑定 `unbound_at = now`,插入新绑定 `bound_at = now` → `switched`;没有生效绑定 → `bound`。这个会话在 `task_sessions` 里一条记录都没有(首次绑定)时,`bound_at` 取 `(await getSessionStats(projectRoot, sessionId)).first_ts`,为 null 时取 now。插入撞上 `task_sessions_open_idx` 的唯一约束时(并发),重新读生效绑定:同任务返回 `already`,不同任务就再做一次切换流程(只重试一次)。
    - `getCurrentBinding(projectRoot, sessionId): CurrentBinding | null`。
    - `clearBinding(projectRoot, sessionId): boolean`(没有生效绑定返回 false)。
    - `resolveSessionId(explicit?: string): string | null` → 非空的 `explicit` ?? 非空的 `process.env[CLAUDE_SESSION_ID_ENV]` ?? null。
  - **feature-link.ts、features 门面**:
    - `features/scanner.ts` 新增并经 `features/index.ts` 导出:
      - `readFeatureTask(projectRoot: string, featureId: string): string | null`
      - `scanFeatureTasks(projectRoot: string): Array<{ featureId: string; path: string; task: string }>`(只列有声明的)
    - 主 spec 的认定规则和读负责人时相同(spec §6.1),复用 `findMetaFile` 中 spec 候选的选择逻辑:按 `compareSpecCandidates` 排序,取第一个头部能读出负责人的 spec,都读不出就取排序后的第一个;**不回退到 plan/index**(任务只在 spec 里声明)。建议把这段选择逻辑抽成私有函数 `findMainSpec(featureDir)`,让 `findMetaFile` 和新函数共用,`findMetaFile` 的行为不变。读头部 30 行内第一条 `^>\s*任务\s*[:：]\s*(.+?)\s*$`。`FeatureEntry` 和 `features list` 的输出不变。
    - task 侧 `autoBindFromFeatureDir(projectRoot, sessionId, filePath): Promise<AutoBindOutcome>`:
      1. `filePath` 相对 `projectRoot` 转成 POSIX 路径,不匹配 `^docs/features/([^/]+)/` → `none`。
      2. `readFeatureTask` 返回 null → `none`。
      3. `resolveDeclaredTask` 得到任务 B(configured 取 `loadTaskSourceConfig(...) !== null`)。
      4. 没有生效绑定 → `await bindSession(..., 'feature_dir')` → `bound`。
      5. 生效绑定就是 B → `none`。
      6. 生效绑定是 A 且不等于 B:`task_reminders` 里已有 (session, A, B) → `none`;否则插入记录并返回 `remind`,message 为 `当前会话绑定任务「<A 名称>」,但本次改动属于任务「<B 名称>」的需求目录(<featureId>);如需切换请与用户确认后执行 cgraphx task use <B 的编号或名称>`。
  - **getTaskDetail(projectRoot, taskId, { events?: boolean; limit?: number })**:
    - `featureDirs`:`scanFeatureTasks` 中声明值经 `findTask` 解析到本任务的 path。
    - `sessions`:该任务的全部绑定,按 bound_at 升序。
    - 事件:对每条绑定调 timeline 门面 `queryEvents(projectRoot, { session, since: bound_at, until: unbound_at ?? undefined, limit: 10000 })`,再在 JS 里剔除 `ts >= unbound_at` 的事件(spec §3.2 是左闭右开),合并后去重、按 ts 升序。
    - `commits` 取其中的 git_commit 事件;`eventCounts` 按 event_type 计数;`events` 只在 `opts.events` 为 true 时返回前 `limit ?? 100` 条,否则为 null。
  - `index.ts` 门面导出:上面所有公共函数、类型、错误类,以及 `ensureTaskSchema`、`openTaskDb`;外部(cli、hooks、installer)只通过它调用。
- 允许局部适配:各文件内部的私有函数拆分;store 方法命名。
- 具体要求:
  - store 层负责行到领域类型的映射;SQL 全部参数化。
  - DB 走 `src/core/db` 适配器,不直接用 `node:sqlite`。
  - 新代码的注释用中文。
- 完成条件:
  - `npm run build` 通过,`dist/core/task/schema.sql` 存在。
  - `npx vitest run` 全绿。
  - 用临时脚本(`node -e` 调 `dist/core/task/index.js`,在已 install 的临时项目里,不入库)验证:两次 `resolveTaskForUse('订单退款改造')` 返回同一个 id;对同一会话先后绑定 X、Y,得到 `bound` → `switched`;首次绑定的 bound_at 等于该会话最早一条 timeline 事件的 ts。
- 验证方式:上面的脚本输出,加上 `sqlite3 .cgraphx/cgraphx.db '.schema task_sessions'` 能看到部分唯一索引。
- 独立提交:是。提交 `feat(task): task 子系统核心——任务存储 + 外部接口 + 会话绑定 + 需求目录关联`
- 风险/注意事项:
  - 部分唯一索引 `WHERE` 子句需要 SQLite 3.8+,Node 内置 sqlite 满足。
  - `getSessionStats` 会单独打开一次库连接;在已持有连接的事务里调用前,先在事务外拿到 first_ts。

---

### T-3: `cgraphx task` 命令组

- 目标:提供 spec §5 的五个命令。
- 对应 spec 条款:§5.1–§5.5、§3.3(配置非法退出码 2)
- 强制引用:`coding-standards.md`、`interface-standards.md`
- 依赖:T-2
- 涉及范围:新增 `src/core/task/cli.ts`(导出 `registerTaskCommands(program: Command): void`);`src/cli/index.ts` 在 `registerFeaturesCommands` 旁边调用它。
- 必须严格执行:
  - 命令与选项:
    - `task list [--local] [--json]`
    - `task use <value> [--manual] [--session <id>] [--json]`
    - `task current [--session <id>] [--json]`
    - `task clear [--session <id>] [--json]`
    - `task show <value> [--events] [--limit <n>] [--json]`
    - 不带 `--json` 时输出下面的 table 形态,带上时输出 JSON。
  - 项目根用 `resolveProjectRoot(process.cwd())`。
  - 会话判定:`resolveSessionId(opts.session)`;为 null 时抛 `TaskArgError('[task] 无法确定当前会话:不在 Claude Code 会话内。用 --session <id> 指定(会话开始时注入的上下文中有当前会话 id)')`。
  - `show` 只用 `findTask` 解析,解析不到抛 `TaskArgError`。
  - `list` 的 warning 写到 stderr(带 `[task]` 前缀),退出码 0。
  - `exitCodeForError`:`TaskArgError` → 3,`TaskConfigError` → 2,`TaskStoreError` → 4,其他(含 `TaskSourceUnavailableError`)→ 1。action 内 try/catch,设置 `process.exitCode = exitCodeForError(err)`,stderr 输出 `[task] <message>`。
  - `--json` 输出字段(camelCase,和 T-2 类型同名):
    - list → `TaskListResult`
    - use → `BindResult`
    - current → `CurrentBinding | null`
    - clear → `{ cleared: boolean }`
    - show → `TaskDetail`
  - 默认(不带 `--json`)输出:
    - list 列为 `ID / 来源 / 编号 / 名称 / 状态 / 当前`(当前绑定的显示 `*`,空值显示 `-`)
    - use 输出一行:`已绑定` / `已绑定(无变化)` / `已从「A」切换到「B」` + 编号 + 名称
    - current / clear 各输出一行
    - show 按「任务 / 关联需求目录 / 会话 / commit / 事件统计 / 事件明细」分块输出
- 允许局部适配:表格对齐实现(可以复制 features cli 的 `displayWidth` / `padEnd`)、table 文案。
- 具体要求:`src/cli/index.ts` 只加一行 import 和一行注册调用;不改其它顶层命令。
  - 门面中返回 Promise 的函数(`listTasks`、`resolveTaskForUse`、`bindSession`、`getTaskDetail`)在 action 中一律 await。
- 完成条件:
  - `npm run build` 通过,`npx vitest run` 全绿。
  - 在已 install 的临时项目里:
    - `task use 订单退款改造 --session s1` 退出码 0。
    - 不设环境变量、不带 `--session` 执行 `task use x`,退出码 3。
    - 写一个非法 JSON 的 `.cgraphx/task-source.json` 后执行 `task list`,退出码 2。
    - 用 `node -e` 起一个返回 `{"tasks":[{"id":"P-1","name":"甲"}]}` 的本地 HTTP 服务并配置 url,`task list` 能列出 P-1;关掉服务再执行,stderr 有 warning,退出码 0。
- 验证方式:上面每条命令的退出码和输出。
- 独立提交:是。提交 `feat(task): cgraphx task 命令组——list/use/current/clear/show`
- 风险/注意事项:`task` 这个命令名与 Claude Code 的 Task 工具无关,帮助文本写清楚是「开发任务绑定」。

---

### T-4: task hook 与安装接入

- 目标:会话开始时提醒 agent,改动需求目录时自动绑定,并由 `cgraphx install` / `uninstall` 接入和移除。
- 对应 spec 条款:§6.3(hook 接线)、§7、§9(耗时、降级、关闭开关)、§10(安装、卸载、重装)
- 强制引用:`coding-standards.md`、`interface-standards.md`
- 依赖:T-1、T-3
- 涉及范围:
  - 新增 `src/core/task/hooks.ts`、`src/core/task/installer.ts`
  - `src/core/task/cli.ts`(注册两个隐藏命令)、`src/core/task/index.ts`(导出 installer)
  - `src/cli/installer/index.ts`
- 必须严格执行:
  - 隐藏命令:`task-session-start-hook` → `taskSessionStartHook()`,`task-post-tool-use-hook` → `taskPostToolUseHook()`;都用 `{ hidden: true }` 注册在 `registerTaskCommands` 内。
  - 两个 hook 共同规则:
    - timeline 门面 `isKillSwitchOn()` 为 true 时直接返回(不读 stdin、不输出)。
    - stdin 解析失败或缺 `session_id` 时静默退出。
    - 项目根取 `resolveProjectRoot(payload.cwd ?? process.cwd())`。
    - 任何异常吞掉,写 stderr `[task] …`,退出码 0。
    - 不发网络请求;所有 DB 写入都 await。
    - 自测耗时超过 50ms 时 stderr 告警(与 timeline 一致)。
  - `taskSessionStartHook`:`getCurrentBinding` 成功后,向 stdout 输出一行 JSON `{"hookSpecificOutput":{"hookEventName":"SessionStart","additionalContext":"<文本>"}}`。查询失败(未初始化、DB 异常)时不输出任何内容。文本:
    - 已绑定:`当前会话已绑定开发任务:<编号或「手动」> <名称>。当前会话 id:<id>。`
    - 未绑定:`当前会话未绑定开发任务。用户开始具体开发任务时,先用 cgraphx task list 列出候选让用户选择,再执行 cgraphx task use <编号或名称>;纯咨询类对话无需绑定。当前会话 id:<id>(执行 cgraphx task 命令拿不到会话时用 --session 传入)。`
  - `taskPostToolUseHook`:只处理 `tool_name ∈ {Edit, Write, MultiEdit, NotebookEdit}` 的情况。文件路径对 NotebookEdit 取 `tool_input.notebook_path`,对其余三种取 `tool_input.file_path`,必须是字符串;`tool_response` 不能含 `error` 字段。满足后 `await autoBindFromFeatureDir(...)`。结果为 `remind` 时向 stdout 输出 `{"hookSpecificOutput":{"hookEventName":"PostToolUse","additionalContext":"<message>"}}`;其它结果不输出。
  - `installer.ts`:`installTaskHooks(projectRoot): { written: string[]; skipped: string[] }` 和 `uninstallTaskHooks(projectRoot): { removed: string[] }`,读写 `<projectRoot>/.claude/settings.json`:
    - SessionStart:`{ hooks: [{ type: 'command', command: 'cgraphx task-session-start-hook' }] }`
    - PostToolUse:`{ matcher: 'Edit|Write|MultiEdit|NotebookEdit', hooks: [{ type: 'command', command: 'cgraphx task-post-tool-use-hook' }] }`
    - 识别标记为命令里包含 `cgraphx task-`;幂等,已存在就跳过;卸载只移除带该标记的项,不碰其他 hook,清掉因此变空的组和事件键。
  - `src/cli/installer/index.ts`:
    - `ensureProjectInitialized` 在 markdown + timeline 之后追加 `ensureTaskSchema(db)`。
    - 在 `chosen.includes('timeline')` 分支里,`installTimelineHooks` 之后对已初始化的项目执行 `ensureTaskSchema`(打开库应用,保证老项目重装后也有 task 表),再执行 `installTaskHooks`。日志一行:`开发任务绑定已装:<事件>` 或 `已存在(幂等)`;失败只 warn,不中断安装。
    - 卸载在 `uninstallTimelineHooks` 之后调用 `uninstallTaskHooks`,日志与失败处理同上。
- 允许局部适配:settings 读写的私有函数(可以参照 timeline installer 的写法复制,但不得 import timeline 的内部模块);上下文文案的标点。
- 具体要求:
  - **先查 Claude Code hooks 文档**,确认 SessionStart 和 PostToolUse 的 `hookSpecificOutput.additionalContext` 字段名(index 待确认 P1)。如果和上面的契约不一致,按 `PLAN_CONFLICT` 上报后再改。
  - 实现后在真实 Claude Code 会话里试一次 resume,把 session_id 是否沿用写进提交 body(index 待确认 P2)。
- 完成条件:
  - `npm run build` 通过,`npx vitest run` 全绿。
  - 在临时项目里执行 `node dist/cli/index.js install -y` 两次:settings 中 SessionStart 和 PostToolUse 各只有一条 task 命令,timeline 命令也各一条;`.cgraphx/timeline-current-turn.json` 不存在。
  - `echo '{"session_id":"s9","cwd":"'$PWD'"}' | node <repo>/dist/cli/index.js task-session-start-hook` 输出未绑定的 JSON;`task use 甲 --session s9` 之后再跑一次,输出已绑定的 JSON。
  - 新建 `docs/features/2026-10-14-X/X-spec.md`,头部写 `> 任务: 乙`,然后对一个新会话 s10 管道输入 `{"session_id":"s10","cwd":…,"tool_name":"Write","tool_input":{"file_path":"<abs>/docs/features/2026-10-14-X/a.md"},"tool_response":{}}` 给 `task-post-tool-use-hook`:`task current --session s10` 显示乙,来源为 feature_dir。对已绑定甲的 s9 输入同样的内容:第一次输出提醒 JSON,第二次没有输出。
  - `CGRAPHX_NO_TIMELINE=1` 时上面两个 hook 都没有输出。
  - `node dist/cli/index.js uninstall -y --keep-data` 之后,settings 中没有 `cgraphx task-` 和 `cgraphx timeline-` 命令,用户自己的 hook 保留。
- 验证方式:上面每步的 settings.json 内容、stdout 和 `task current` 输出。
- 独立提交:是。提交 `feat(task): 会话开始提醒 + 需求目录自动绑定——接入 cgraphx install/uninstall`
- 风险/注意事项:
  - 与 timeline hook 不同,task hook 会往 stdout 输出。不要把 timeline 的 `runHook` 拿来复用(它的契约是 stdout 恒空)。
  - PostToolUse 的 matcher 只能限定工具;真正的路径判断在 hook 内完成,不匹配时要尽早返回。

---

### T-5: skill 与文档

- 目标:write-spec 支持在头部声明任务;仓库文档和新行为保持一致。
- 对应 spec 条款:§6.4、§10(旧 turn 文件)
- 强制引用:无
- 依赖:无(措辞使用本 plan 锁定的名字)
- 涉及范围:
  - `assets/claude-template/skills/write-spec/SKILL.md`
  - 仓库根 `CLAUDE.md`
  - `docs/guides/interface-standards.md`
  - `docs/guides/data-standards.md`
- 必须严格执行:
  - write-spec「命名先行」追加第 ④ 项:`任务——默认取当前会话绑定(cgraphx task current),展示给用户确认;可改填或留空,留空则不写该行`。
  - 「结构 / 头部」一条改为:feature-id / 负责人 / 任务(可选)/ 日期,每行 `> 字段: 值`。
  - 不改 write-spec 的其它段落。
  - `CLAUDE.md`:
    - timeline 段落的「五个隐藏 hook」改为七个,补上 `timeline-session-start-hook` / `timeline-session-end-hook`。
    - turn 状态文件改为 `.cgraphx/turns/<会话>.json`(按会话隔离)。
    - 「本仓库是什么」的工具列表和架构「子系统形态」各补一句 task 子系统:会话 ↔ 开发任务绑定,`task_*` 表,两个隐藏 hook `task-session-start-hook` / `task-post-tool-use-hook`,依赖单向 task → timeline / features。
  - `interface-standards.md`「Hook 子命令契约」:标题改为 timeline-*-hook ×7;turn 文件路径改为 `.cgraphx/turns/<会话>.json`;追加一条 task hook 契约(两个隐藏命令,fail-silent,允许向 stdout 输出 `hookSpecificOutput` JSON)。
  - `data-standards.md`「DDL 层」的前缀表示例加上 `task_*`。
- 允许局部适配:措辞贴合所在段落的文风。
- 具体要求:skill 只改 `assets/claude-template/` 下的源文件,不改仓库根 `.claude/`。
- 完成条件:
  - `grep -n "任务" assets/claude-template/skills/write-spec/SKILL.md` 能看到上面两处改动。
  - `grep -rn "timeline-current-turn" CLAUDE.md docs/guides` 无结果。
- 验证方式:上面两条 grep,加上人工读一遍 diff。
- 独立提交:是。提交 `docs(skills): write-spec 头部声明任务 + 仓库文档同步 task 子系统与 hook 变更`
- 风险/注意事项:`docs/code-map/flows/开发时间线记录.md` 会因为 T-1 过期。它是派生视图,**不手工修改**;实现收尾时提示运行 `/code-map-write` 刷新。
