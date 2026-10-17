# 后端计划: 任务自动关联

> 上级:`任务自动关联-index.md`。spec:`../任务自动关联-spec.md`。

---

### B-1: 命令文本路径候选下沉 timeline

- 目标:把 sync 里「Bash 命令 → 可能读取的路径」的切分逻辑移到 timeline 门面,task 与 sync 共用一处定义。
- 对应 spec 条款:§3.1「读」、§11「Bash 读识别必须复用 sync 现有的命令文本推断口径」
- 强制引用:`docs/guides/coding-standards.md`
- 依赖:无
- 涉及范围:新增 `src/core/timeline/command-paths.ts`;改 `src/core/timeline/index.ts`(导出)、`src/core/sync/references.ts`
- 必须严格执行:
  - 新函数签名:`export function extractCommandPathCandidates(command: string, cwd: string): Array<{ bases: string[]; token: string }>`。
  - 行为与现 `sync/references.ts` 的 `bashCandidates` 逐字一致:`CD_PREFIX_RE = /^\s*cd\s+("([^"]+)"|'([^']+)'|([^\s;&|]+))\s*(&&|;)/`;`TOKEN_SPLIT_RE = /[\s'"`|;&<>()=,]+/`;有 cd 前缀时 `bases = [path.resolve(cwd, dir), cwd]`;跳过空串与含 `$` 的片段。两个正则一并移入新文件。
  - 函数是纯函数:不读文件系统、不判断目录。
  - `sync/references.ts` 删除本地 `bashCandidates`、`CD_PREFIX_RE`、`TOKEN_SPLIT_RE`,改为从 `'../timeline'` 导入 `extractCommandPathCandidates`;其余逻辑(Read / Grep / Glob 分支、沉淀目录过滤、存在性检查)不动。
- 允许局部适配:新文件内注释措辞。
- 完成条件:
  - `npm run build` 通过;`npx vitest run` 全绿(参考推断结果不变)。
  - `grep -n "bashCandidates\|CD_PREFIX_RE" src/core/sync` 无结果。
- 验证方式:上述两条命令。
- 独立提交:是 —— `refactor(timeline): 命令文本路径候选下沉 timeline——sync 参考推断改用共用实现`
- 风险/注意事项:timeline 不得 import sync / task。

---

### B-2: task 新表 + 自动绑定派生核心

- 目标:实现 R1~R7 的唯一派生函数、目录资格与目录 → 任务解析、增量刷新与首轮历史派生,结果落表。本任务不改任何读取方。
- 对应 spec 条款:§2(产出目录、目录任务、目录负责人)、§3.1、§3.2(R1~R7)、§4.1、§4.2、§6
- 强制引用:`docs/guides/coding-standards.md`、`docs/guides/data-standards.md`
- 依赖:B-1
- 涉及范围:
  - 改 `src/core/task/schema.sql`(追加四张表)、`src/core/task/constants.ts`、`src/core/task/store.ts`、`src/core/task/types.ts`、`src/core/task/index.ts`
  - 新增 `src/core/task/auto-binding.ts`、`src/core/task/feature-task.ts`
  - 改 `src/core/features/scanner.ts`、`src/core/features/index.ts`
- 必须严格执行:
  - **schema.sql 追加**(全部 `IF NOT EXISTS`,**不**新增 `task_schema_versions` 记录,`TASK_SCHEMA_VERSION` 保持 1):
    ```
    task_feature_tasks(id INTEGER PRIMARY KEY, feature_id TEXT NOT NULL UNIQUE, platform_task_id TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL)
    task_auto_sessions(session_id TEXT PRIMARY KEY, derived_max_event_id INTEGER NOT NULL, feature_id TEXT, strength TEXT CHECK (strength IN ('read','write')), bound_at TEXT, stopped_at TEXT, derived_at TEXT NOT NULL)
    task_superseded_bindings(binding_id INTEGER PRIMARY KEY REFERENCES task_sessions(id), superseded_at TEXT NOT NULL)
    task_auto_meta(key TEXT PRIMARY KEY, value TEXT NOT NULL)
    ```
    文件内为四张表各写一行中文注释说明用途;顶部注明「只加表不升版本:旧版全局 cgraphx 兼容」。
  - `constants.ts` 新增 `FEATURE_TASK_ID_BASE = 1_000_000_001`、`AUTO_STRENGTHS = ['read', 'write'] as const`、`AUTO_META_KEYS = ['history_pass_done'] as const`。目录任务插入时 `id = max(FEATURE_TASK_ID_BASE, MAX(id) + 1)`。
  - **features 门面新增**:
    - `readFeatureOwner(projectRoot: string, featureId: string): string | null` —— 先取主 spec(`findMainSpec`)头部 `> 负责人:`;主 spec 没有该行或没有主 spec 时,取目录下文件名以 `-交接提示词.md` 结尾的文件(多个时按 `compareSpecCandidates` 取第一个)头部 `> 负责人:`;都没有 → null。头部扫描行数沿用 `HEADER_SCAN_LINES`。
    - 门面导出已有的 `gitUserName`(`src/core/features/sync.ts`)。
  - **`feature-task.ts` 导出**:
    - `featureDatePrefix(featureId: string): string | null` —— 匹配 `^(\d{4}-\d{2}-\d{2})-`,取不到 null。
    - `featureTaskName(featureId: string): string` —— 去掉日期前缀后的部分(即文件前缀);无日期前缀返回原值。
    - `isEligibleFeatureDir(projectRoot: string, featureId: string): boolean` —— `docs/features/<featureId>/` 是目录且 `readFeatureOwner` 非 null。
    - `resolveFeatureTarget(projectRoot: string, store: TaskStore, featureId: string): TaskItem | null` —— 不合格目录 → null;`readFeatureTask` 的值匹配 `^T-\d+$` → `store.findApiTaskByExternalId(值)`,本地没有则 `store.ensureApiPlaceholder(值, now)`;否则 → `store.ensureFeatureTask(featureId, now)` 映射成 `TaskItem`(见下)。**只读调用方**不能写库:提供 `resolveFeatureTargetReadOnly(projectRoot, store, featureId): TaskItem | null`,只查不建(目录任务行或接口任务不存在时返回 null)。
    - `listMyFeatureTaskDeclarations(projectRoot: string): Array<{ featureId: string; name: string; declaredAt: string }>` —— `task_feature_tasks` 中、目录合格、头部没有 `T-\d+`、且 `readFeatureOwner(...).trim() === gitUserName()?.trim()` 的行;`name = featureTaskName`,`declaredAt = created_at`。`gitUserName()` 为 null → 空数组。
    - `recordFeatureTaskMappings(projectRoot: string, mappings: Array<{ featureId: string; taskId: string }>): void` —— 更新 `task_feature_tasks.platform_task_id` 与 `updated_at`;未知 featureId 忽略。
  - **目录任务映射成 `TaskItem`**:`{ id, source: 'feature', externalId: platform_task_id, name: featureTaskName(feature_id), url: null, status: null, featureId: feature_id, createdAt, updatedAt }`。`types.ts`:`TaskSource` 由 `TASK_SOURCES` 推出,`TASK_SOURCES` 改为 `['api', 'manual', 'feature'] as const`(**只改 TS 常量,不改 `task_items` 的 CHECK**);`TaskItem` 增 `featureId: string | null`(api / manual 为 null)。
  - **store 新增方法**:`ensureFeatureTask(featureId, now): TaskItem`、`getFeatureTaskById(id): TaskItem | null`、`findFeatureTaskByFeatureId(featureId): TaskItem | null`、`listFeatureTasks(): TaskItem[]`、`getAutoSession(sessionId)`、`listAutoSessions()`、`upsertAutoSession(row)`、`setAutoStop(sessionId, stoppedAt)`、`supersedeBinding(bindingId, now)`、`listSupersededBindingIds(): Set<number>`、`getMeta(key)` / `setMeta(key, value)`。`getTaskById(id)` 在 `id >= FEATURE_TASK_ID_BASE` 时查 `task_feature_tasks`。行类型用 `XxxRow` 后缀,映射在 store 内完成。
  - **`auto-binding.ts` 导出纯函数**:
    ```
    deriveSessionAutoBinding(input: {
      events: TimelineEvent[];               // 本会话全部事件,id 升序
      cutoffTs: string | null;               // 只看 ts < cutoffTs 的事件;null = 不截止
      projectRoot: string;
      isEligible: (featureId: string) => boolean;
    }): { featureId: string; strength: 'read' | 'write'; boundAt: string } | null
    ```
    规则(逐字对应 spec §3.2):
    1. 只看 `event_type === 'post_tool_use'` 且 `ts < cutoffTs` 的事件。
    2. **写**:`tool_name` ∈ 该事件 `agent` 对应 `requireAgentProfile(agent ?? DEFAULT_AGENT_ID).writeTools`,`tool_result_summary` 解析后 `success !== false`(解析失败按成功),路径取 `tool_args.notebook_path ?? tool_args.file_path`。
    3. **读**:`tool_name === 'Read'` 取 `tool_args.file_path`;`tool_name === 'Bash'` 对 `extractCommandPathCandidates(tool_args.command, e.cwd)` 的每个 `{bases, token}`,依次用每个 base 解析,解析出的文件**存在**才算。Grep / Glob 不算。
    4. 路径解析:相对路径基于 `e.cwd`;转成项目相对 POSIX 路径后须匹配 `^docs/features/([^/]+)/.+`,取第 1 组为 featureId,且 `isEligible(featureId)`。
    5. 状态机:无状态 + 读 D → (D, read);(D, read) + 读 D2 且 `featureDatePrefix(D2) > featureDatePrefix(D)`(null 视为最早)→ (D2, read);(·, read) 或无状态 + 写 D → (D, write);(·, write) + 任何事件 → 不变。
    6. 有状态时 `boundAt` = 本会话**任意类型**最早一条事件的 ts(不受 cutoff 影响);无状态 → null。
  - **`refreshAutoBindings(projectRoot, opts?: { sessionIds?: string[] })`**:
    1. `CGRAPHX_NO_TIMELINE` 开启(`isKillSwitchOn()`)→ 返回 `{ recomputed: 0, historyPass: false }`。
    2. 取 `listSessionEventMaxIds(projectRoot)`;`history_pass_done` 未设置 → 本轮对全部会话重算(`historyPass = true`);否则只重算 `maxId > derived_max_event_id`(或不在 `task_auto_sessions`)的会话;`opts.sessionIds` 给出时再与之取交集。
    3. 每个会话:`cutoffTs` = 该会话**保留的**手动绑定(`task_sessions` 中未被取代的行)最早 `bound_at` 与 `stopped_at` 中的较早者;`events = listSessionEventsAfter(projectRoot, sid, 0)`;调用 `deriveSessionAutoBinding`;结果非空时 `ensureFeatureTask(featureId)` 仅在**目录头部没有 `T-\d+`** 时调用;`upsertAutoSession`(结果为空也写一行,`feature_id = NULL`)。
    4. **首轮历史**(`historyPass`):在第 3 步计算 cutoff **之前**,对「本会话派生(以 cutoff = 仅考虑 `source='api'` 的手动行时)有结果」的会话,把它的 `bind_source = 'feature_dir'` 行、以及 `bind_source = 'cli'` 且任务 `source = 'manual'` 的行写入 `task_superseded_bindings`;然后按第 3 步正式派生。全部完成后 `setMeta('history_pass_done', now)`。
    5. 整个刷新是幂等的:重复执行结果相同;单会话失败写 stderr `[task] 派生失败 <sid>: <原因>` 并跳过,不中断其他会话。
  - task 门面新增导出:`refreshAutoBindings`、`recordFeatureTaskMappings`、`listMyFeatureTaskDeclarations`、`FEATURE_TASK_ID_BASE`。
  - 依赖方向:`auto-binding.ts` 只经 `../timeline`、`../features`、`../agents` 门面取数,不 import sync。
- 允许局部适配:模块内私有函数拆分;路径解析可复用 `src/core/directory.ts` 已有函数。
- 具体要求:
  - `ensureApiPlaceholder` 只用于 `T-\d+` 头部值(保持现有含义「接口任务占位」)。
  - 不删除、不修改 `task_sessions` 任何行。
- 完成条件:
  - `npm run build` 通过;`npx vitest run` 全绿。
  - 在本仓库副本(按「cgraphx 库副本须带 WAL 文件」知识条目复制 `.cgraphx/cgraphx.db*` 到临时目录)上执行一次 `refreshAutoBindings`,`task_auto_sessions` 中:`d510911c…` 的 `feature_id = '2026-09-16-cgraphx-web数据库预览'`、`strength = 'write'`;`ea609e33…` 的 `feature_id = '2026-10-16-timeline采集的数据质量问题'`、`strength = 'write'`;`a680ce3f…` 因有 T-24 手动行,cutoff = 其 bound_at,派生按该截止计算;`b1ac8f3c…` 的手动任务行进入 `task_superseded_bindings`。
  - 同一副本上首轮全量耗时记录在提交 body 中。
- 验证方式:上述命令 + 用 `node -e` 调 `dist/core/task/index.js` 的 `refreshAutoBindings` 后 `sqlite3` 查表。
- 独立提交:是 —— `feat(task): 自动绑定派生核心——读暂定写确定 + 目录任务 + 历史取代标记`(读取方尚未切换,行为对外不变)
- 风险/注意事项:
  - 旧版二进制的 `ensureTaskSchema` 只跑自己的 schema.sql,不受新表影响;新二进制在旧库上首次打开即建表。
  - `listSessionEventsAfter` 每会话一次连接;全量时按会话串行,注意关闭连接。

---

### B-3: 有效绑定合并 + 本地读取方切换

- 目标:所有本地读取方(`task list/current/show`、本地 web、sync)改读同一个「有效绑定」列表;手动命令与派生规则衔接。
- 对应 spec 条款:§3.2 R6、§4.3、§6(取代)、§8「已有手动命令」
- 强制引用:`docs/guides/coding-standards.md`
- 依赖:B-2
- 涉及范围:`src/core/task/report.ts`、`src/core/task/types.ts`、`src/core/task/constants.ts`、`src/core/task/binding.ts`、`src/core/task/resolve.ts`、`src/core/task/cli.ts`(list / current / show / clear 四个命令)、`src/core/task/feature-link.ts`、`src/core/task/index.ts`、`src/web/constants.ts`
- 必须严格执行:
  - `BIND_SOURCES` 改为 `['cli', 'feature_dir', 'auto_read', 'auto_write'] as const`(只改 TS,不改 `task_sessions` 的 CHECK;`auto_*` 只出现在派生绑定上)。
  - 新类型与函数(原文):
    ```
    export interface EffectiveBinding { bindingKey: string; binding: TaskBinding; task: TaskItem; superseded: boolean }
    export function listEffectiveBindings(projectRoot: string, opts?: { includeSuperseded?: boolean }): EffectiveBinding[]
    ```
    组成:① `task_sessions` 中未被取代的行 → `bindingKey = String(id)`,`superseded = false`;② `includeSuperseded` 为 true 时追加被取代的行,`superseded = true`;③ `task_auto_sessions` 中 `feature_id` 非空的行 → 用 `resolveFeatureTargetReadOnly` 解析任务,解析不到则跳过;`binding = { id: 0, sessionId, taskId: task.id, boundAt: bound_at, unboundAt: <见下>, bindSource: strength === 'write' ? 'auto_write' : 'auto_read' }`,`bindingKey = 'auto:' + sessionId`。
    派生绑定的 `unboundAt` = 该会话保留手动行最早 `bound_at` 与 `stopped_at` 中的较早者,都没有为 null;若该值 ≤ `bound_at`,该派生绑定不出现。
    排序:`binding.boundAt` 升序,同值按 `bindingKey` 升序。只读打开库(`openTaskDbReadOnly`),未初始化 / 无 task 表返回空数组。
  - `listBindingsWithTask` 改为 `listEffectiveBindings(projectRoot).map(({ binding, task }) => ({ binding, task }))` 的薄包装并标注 `@deprecated 用 listEffectiveBindings`(B-5 完成后无调用方即删除,B-5 负责删除)。
  - `listTaskSummaries` / `getTaskReport` / `getTaskDetail` 的绑定来源改为 `listEffectiveBindings`(不含被取代);任务列表 = `task_items` ∪ `task_feature_tasks`(`store.listTasks()` 与 `store.listFeatureTasks()` 合并);`getTaskReport` 的 `featureDirs` 对 `source = 'feature'` 的任务为 `[docs/features/<featureId>]`。
  - `queryBindingEvents` 与段统计以 `bindingKey` 区分段,不得再用 `binding.id` 当唯一键。
  - `findTaskByValue` 解析顺序在现有「本地 id → 接口编号 → 手动任务名称」之后追加「feature-id 精确 → 目录任务名称(`featureTaskName`)精确」,只查不建。
  - **CLI**:
    - `task list` / `task current` / `task show` 执行前先 `await refreshAutoBindings(projectRoot)`(失败只 stderr 警告,不影响输出)。
    - 来源标签:`SOURCE_LABELS` 与 `src/web/constants.ts` 的 `TASK_SOURCE_LABELS` 补 `feature: '目录'`。`task current` 输出派生绑定时注明「自动(读)」/「自动(写)」。
    - `task clear`:有生效手动绑定 → 现有行为;否则若该会话有派生绑定且未停止 → `setAutoStop(sessionId, now)` 并输出「已停止本会话的自动关联」;都没有 → 现有「未绑定」提示。任何一种情况之后,该会话自动规则不再恢复(R6)。
    - `task use`:行为不变(首次绑定仍回溯会话起点;派生绑定按上面的 `unboundAt` 规则自然让位)。
  - `feature-link.ts`:删除 `autoBindFromFeatureDir` 及其提醒逻辑(`task_reminders` 表保留不删,不再写入);门面去掉该导出;`getTaskDetail` 保留并按上条改造。
- 允许局部适配:CLI 文案措辞、列宽;report 内部合并实现。
- 具体要求:`AutoBindOutcome` 类型随 `autoBindFromFeatureDir` 一并删除;所有对 `TaskSource` 的穷举分支补 `feature`。
- 完成条件:
  - `npm run build` 通过;`npx vitest run` 全绿(被本任务改动弄红的既有测试同步修正)。
  - 本仓库副本上 `node dist/cli/index.js task list` 列出目录任务(来源「目录」),`task show 2026-09-16-cgraphx-web数据库预览` 显示会话 `d510911c…`。
  - `node dist/cli/index.js web` 打开 `/tasks`,目录任务可见且详情页可打开。
- 验证方式:上述命令;web 用浏览器打开验证列表与详情。
- 独立提交:是 —— `feat(task): 本地读取改读有效绑定——目录任务可见 + clear 停止自动关联`
- 风险/注意事项:`getTaskById` 对大 id 走 `task_feature_tasks`,web 路由 `/tasks/<纯数字>` 无需改动。

---

### B-4: hook 与安装

- 目标:agent 上下文零任务注入;每轮结束刷新派生;撤掉写类工具 PostToolUse hook。
- 对应 spec 条款:§3.3、§8(hook 预算、旧版全局 cgraphx)
- 强制引用:`docs/guides/coding-standards.md`
- 依赖:B-3
- 涉及范围:`src/core/task/hooks.ts`、`src/core/task/installer.ts`、`src/core/task/cli.ts`(仅隐藏命令注册)、`src/core/task/index.ts`
- 必须严格执行:
  - `taskSessionStartHook`:不论是否绑定,`additionalContext` 只输出 `当前会话 id:${sessionId}(执行 cgraphx task 命令拿不到会话时用 --session 传入)。`;不再查询绑定。
  - 新增 `taskStopHook(profile: AgentProfile): Promise<void>`:沿用 `runTaskHook` 骨架(kill switch、stdin 解析、吞异常、耗时告警);调用 `refreshAutoBindings(projectRoot, { sessionIds: [payload.sessionId] })`;**stdout 不输出任何内容**。若 `history_pass_done` 未设置,本次改为全量(不传 `sessionIds`)——除非 B-2 记录的全量耗时 > 1 秒,则始终只传当前会话。
  - `taskPostToolUseHook`:保留命令,函数体改为读完 stdin 后直接返回(旧配置仍会调用它,必须 0 退出、无输出)。
  - 隐藏命令:新增 `task-stop-hook`(`{ hidden: true }`,接受 `--agent`,与现有两个同形);`task-post-tool-use-hook` 保留注册。
  - `taskHookGroups(profile)` 改为两项:`SessionStart` → `cgraphx task-session-start-hook`;`Stop` → `cgraphx task-stop-hook`;两条命令都追加 timeline 的 `LEGACY_BINARY_TOLERANT_SUFFIX`(经 timeline 门面导出,若未导出则在门面补导出)。
  - `installTaskHooks`:写入前先移除该 settings 中所有 `isTaskEntry` 命中、且命令不在新集合里的条目(含旧的 PostToolUse 条目与不带后缀的旧 SessionStart 条目),再按现有逻辑追加;返回值 `written` / `skipped` 语义不变。
  - `uninstallTaskHooks`:不变(按 `cgraphx task-` 前缀移除)。
- 允许局部适配:hook 内部函数拆分。
- 完成条件:
  - `npm run build` 通过;`npx vitest run` 全绿。
  - 在临时项目执行 `node dist/cli/index.js install` 后,`.claude/settings.json` 中 task 条目只有 SessionStart 与 Stop 两条且带 ` 2>/dev/null || true`;再执行一次 install 不重复写入。
  - `echo '{"session_id":"s1","cwd":"<临时项目>"}' | node dist/cli/index.js task-stop-hook` 退出码 0、stdout 为空。
- 验证方式:上述命令。
- 独立提交:是 —— `feat(task): hook 改为会话结束刷新派生——会话开始只注入会话 id`
- 风险/注意事项:CodeBuddy 的 Stop 事件名与 Claude Code 相同(timeline 已接入 Stop,沿用 `agentSettingsPath` 与 `hookCommand`)。

---

### B-5: sync 上报对接

- 目标:上报目录任务声明与任务键、回执映射写回、服务端升级后自动补报、被取代段零长度重报。
- 对应 spec 条款:§5、§6「上报」、§9(他人负责人、不存在的平台编号)
- 强制引用:`docs/guides/coding-standards.md`
- 依赖:B-3
- 涉及范围:`src/core/sync/types.ts`、`src/core/sync/payload.ts`、`src/core/sync/runner.ts`、`src/core/sync/store.ts`、`src/core/sync/status.ts`、`src/core/task/report.ts`(仅删除 `listBindingsWithTask`)、`src/core/task/index.ts`
- 必须严格执行:
  - `types.ts` 协议镜像追加(字段名与可选性逐字同契约包 0.2.0):
    ```
    IngestTaskDeclaration { taskKey: string; name: string; declaredAt: string }
    IngestBinding        + taskKey?: string
    IngestRequest        + taskDeclarations?: IngestTaskDeclaration[]
    IngestWarning        + { kind: 'binding_pending'; bindingId: string; taskKey: string }
                         + { kind: 'task_key_declared_by_other'; taskKey: string }
                         + { kind: 'task_declaration_invalid'; taskKey: string; reason: 'invalid_key' | 'invalid_name' }
    IngestResponse       + taskKeys?: Array<{ taskKey: string; taskId: string }>
                         + protocolVersion?: string
    ConnectResponse      + protocolVersion?: string
    ```
    另加常量 `TASK_KEY_PROTOCOL_VERSION = '1.1'`。
  - `payload.ts`:
    - 绑定来源改为 `listEffectiveBindings(root, { includeSuperseded: true })`。
    - `toIngestBinding(entry: EffectiveBinding, supportsTaskKey: boolean)`:`bindingId = entry.bindingKey`;`superseded` → `end = start`(`taskId` 照旧);`task.source === 'api'` → `taskId = externalId`;`task.source === 'feature'` → `taskKey = task.featureId`,`taskId = task.externalId`(有映射时)否则 `null`;`manual` → `taskId = null`。
    - `bindingsHashOf(entries, supportsTaskKey)`:哈希输入为 `{ supportsTaskKey, bindings: sortedBindings(...) }`,使服务端首次支持 1.1 时各会话哈希变化、自动重报。
    - 批次级 `taskDeclarations`:`listMyFeatureTaskDeclarations(root)` 中、`taskKey` 出现在**本批**任一绑定段 `taskKey` 上的条目,映射为 `{ taskKey: featureId, name, declaredAt }`;本批没有则不带该字段。
  - `runner.ts`:
    - 构造上报前先 `await refreshAutoBindings(projectRoot)`(失败记录为本轮错误之一,不中断同步)。
    - `supportsTaskKey = status.serverProtocolVersion === TASK_KEY_PROTOCOL_VERSION`(字符串相等;未知视为不支持)。
    - 收到 200 后:`response.protocolVersion` 存进状态 `serverProtocolVersion`;`response.taskKeys` 非空 → `recordFeatureTaskMappings(projectRoot, taskKeys.map(({ taskKey, taskId }) => ({ featureId: taskKey, taskId })))`。
    - 新 warning 只记入本轮结果的 warning 计数,不改变暂停 / 隔离判定。
  - `SyncStatusState` 增 `serverProtocolVersion: string | null`(默认 null,读旧状态缺字段时按 null)。`sync status` 输出增加一行「平台协议版本」。
  - `connectPlatform`:`ConnectResponse.protocolVersion` 存入同一状态字段。
  - 白名单:新增上报内容只有 `taskKey`(= feature-id)与 `name`(= `featureTaskName`)、`declaredAt`;白名单断言测试若存在,同步把这三个字段列入允许项。
  - 删除 `listBindingsWithTask`(此时已无调用方)及其门面导出。
- 允许局部适配:runner 内结果统计的组织方式。
- 完成条件:
  - `npm run build` 通过;`npx vitest run` 全绿。
  - 对本地起的契约包 0.2.0 服务端(或 mock)执行 `node dist/cli/index.js sync now`:请求体中目录任务绑定带 `taskKey`,本人负责目录有对应 `taskDeclarations`;回执后 `task_feature_tasks.platform_task_id` 被填;第二轮绑定段同时带 `taskId`。
  - 对不返回 `protocolVersion` 的旧服务端(或 mock)执行一轮:成功、无报错;之后让 mock 返回 `'1.1'`,下一轮全部会话的绑定被重报一次。
  - 被取代段在请求体中 `end === start`。
- 验证方式:上述命令;请求体用 mock 服务端打印核对。
- 独立提交:是 —— `feat(sync): 上报目录任务——任务声明 + 绑定任务键 + 平台编号写回`
- 风险/注意事项:
  - `bindingId` 从数字字符串改为 `bindingKey`:手动行仍是 `String(id)`,与已上报的 id 一致,不产生新段;派生段是新 id。
  - 回执 `taskKeys` 里可能出现本机非负责人的键(他人已声明):同样写回映射,本地展示平台编号。
