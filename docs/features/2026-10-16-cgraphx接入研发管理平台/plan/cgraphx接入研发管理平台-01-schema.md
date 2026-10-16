# 01 · Schema:sync 子系统本地表

> 适用规范:`docs/guides/data-standards.md`「模型层」「DDL 层」「ORM 映射约定」。包内表走版本表机制(`schema.sql` 全幂等 + `sync_schema_versions` 每版本一条 `INSERT OR IGNORE`);**不**产出 `docs/features/<id>/sql/` 增量文件、**不**写 `docs/schema-knowledge/`(该约定只约束目标项目业务 DB)。
> 由 **T-2** 落地(schema.sql + schema-bootstrap.ts + store.ts 一起提交)。

## 迁移目标与执行顺序

| 顺序 | 动作 | 说明 |
|---|---|---|
| 1 | 新建 `sync_schema_versions` + 版本 1 行 | 独立版本表,与 timeline / task / markdown 互不影响 |
| 2 | 新建 `sync_state` | 键值状态(连接信息、同步状态) |
| 3 | 新建 `sync_sessions` | 每个上报会话的进度与隔离标记 |
| 4 | 新建 `sync_reference_records` + 唯一索引 | `cgraphx docs` 写入的精确参考 |

全部在 `src/core/sync/schema.sql` 一个文件内、按上表顺序;`SYNC_SCHEMA_VERSION = 1`(`sync/constants.ts`)。

## 表定义(契约,T-2 照此建表)

### sync_state

| 列 | 类型 | 约束 | 含义 |
|---|---|---|---|
| `key` | TEXT | PRIMARY KEY | 只允许 `connection` / `status` 两个键 |
| `value` | TEXT | NOT NULL | JSON(行类型尾注 `// JSON`) |
| `updated_at` | TEXT | NOT NULL | ISO 8601 |

- `connection` 值:`{ "serverUrl": string, "username": string | null, "projectName": string | null, "connectedAt": string | null }`(手工存量配置时三项为 null)。**不存 token**(token 只在 task-source.json)。
- `status` 值:`{ "lastSuccessAt": string|null, "lastAttemptAt": string|null, "failingSince": string|null, "lastError": string|null, "pausedReason": PauseReason|null, "pausedAt": string|null, "lastProbeAt": string|null, "lastResult": SyncRunResult|null }`;`PauseReason` ∈ `invalid_token | account_disabled | repo_not_registered | repo_disabled | not_project_member`。

### sync_sessions

| 列 | 类型 | 约束 | 含义 |
|---|---|---|---|
| `client_session_id` | TEXT | PRIMARY KEY | 上报用会话 id(agent 会话 = 本地 session_id;终端会话 = `cgraphx-terminal-<16 hex>`) |
| `last_event_id` | INTEGER | NOT NULL DEFAULT 0 | 已被平台确认的最大本地事件 id |
| `bindings_hash` | TEXT | | 最近一次确认时本会话绑定集合的哈希 |
| `extras_hash` | TEXT | | 最近一次确认时 bindings + commits + artifacts + references 的哈希 |
| `pending_push` | INTEGER | NOT NULL DEFAULT 0 | 1 = 存在 `commitHash = null` 的产出(推送后需重算) |
| `uploaded_at` | TEXT | | 最近一次确认时间 |
| `isolated_reason` | TEXT | | 非空 = 被平台以 `validation_failed` 拒收的 message |
| `isolated_client_version` | TEXT | | 被隔离时的 cgraphx 版本;当前版本与之不同即重试 |

### sync_reference_records

| 列 | 类型 | 约束 | 含义 |
|---|---|---|---|
| `id` | INTEGER | PRIMARY KEY AUTOINCREMENT | |
| `session_id` | TEXT | NOT NULL | 本地会话 id |
| `kind` | TEXT | NOT NULL CHECK (kind IN ('concept','file')) | |
| `value` | TEXT | NOT NULL | 概念规范名 / 项目根相对 POSIX 路径 |
| `ts` | TEXT | NOT NULL | 首次记录时间(ISO 8601) |

- 唯一索引 `sync_reference_records_uniq ON (session_id, kind, value)`;写入用 `INSERT OR IGNORE`(保留首次时间)。
- 索引 `sync_reference_records_session_idx ON (session_id)`。

## 引导与兼容

- `openSyncDb(projectRoot)`:`.cgraphx/cgraphx.db` 不存在 → 抛 `SyncNotInitializedError`(消息带"先运行 `cgraphx install`");存在 → `DatabaseConnection.open` + 应用 schema.sql + 版本检查(库内版本 > `SYNC_SCHEMA_VERSION` → `SyncSchemaError`,消息"升级 cgraphx")。
- 旧版 cgraphx 不认识 `sync_*` 表,不读不写,无兼容问题;新版不改 timeline / task / markdown 任何表与版本行。
- 回滚:删除 `sync_*` 四张表即回到改动前(无其他表依赖它们)。`cgraphx uninstall` 删除 `.cgraphx/` 时随库删除。

## 数据校验

- T-2 完成后:`node -e` 打开 `.cgraphx/cgraphx.db` 执行 `SELECT name FROM sqlite_master WHERE name LIKE 'sync_%'` 返回 4 张表 + 2 个索引;重复执行 `openSyncDb` 两次不报错;`SELECT version FROM sync_schema_versions` = 1。
- 既有表行数在执行前后不变(`timeline_events` / `task_sessions` / `markdown_documents` 各取 `count(*)` 对比)。
