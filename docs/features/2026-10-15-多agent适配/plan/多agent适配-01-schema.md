# Schema 变更: timeline_events 来源 agent 列

> feature-id: 2026-10-15-多agent适配
> 负责人: liulongfei
> 承载任务: B-2(见 `多agent适配-index.md`)
> 对应 spec: §6、§11

本变更属于包内表（`timeline_*`），按 `data-standards.md`「DDL 层」的版本表机制处理，不涉及目标项目业务库的 `sql/` 增量文件。

## 1. 目标态

| 项 | 改前 | 改后 |
|---|---|---|
| `timeline_events` 列 | 17 列 | 新增可空列 `agent TEXT`，追加在最后 |
| `TIMELINE_SCHEMA_VERSION`（`src/core/timeline/constants.ts`） | `1` | `2` |
| `timeline_schema_versions` | 只有版本行 1 | 新增版本行 `(2, …, 'Add agent column')`；版本行 1 不改 |
| 索引 | 5 个 | 不变：本批没有按 agent 查询的需求 |

列的取值：`'claude-code'`、`'codebuddy'`（`AgentId`），或 `NULL`（未归属会话的 git_commit）。

## 2. schema.sql 的改法

1. 在 `CREATE TABLE IF NOT EXISTS timeline_events (...)` 的最后一列 `commit_deletions INTEGER` 后面追加 `agent TEXT`。新建的库直接带上这一列。
2. 在版本行 1 的 INSERT 之后追加：
   `INSERT OR IGNORE INTO timeline_schema_versions (version, applied_at, description) VALUES (2, strftime('%s', 'now') * 1000, 'Add agent column');`
3. 所有语句保持 `IF NOT EXISTS` 或 `OR IGNORE`，确保幂等。**不要**在 schema.sql 里写 `ALTER TABLE`，因为 SQLite 没有 `ADD COLUMN IF NOT EXISTS`，重复执行会报错。

## 3. 旧库迁移（schema-bootstrap.ts 的 `ensureTimelineSchema`）

执行顺序：

1. `db.exec(schema.sql)`，和现在一样。在旧库上，`CREATE TABLE IF NOT EXISTS` 不会补出新列，版本行 2 会被插入。
2. 用 `PRAGMA table_info(timeline_events)` 检查有没有 `agent` 列，**有就结束**。这是每次 hook 都会走的快路径，只多一次 PRAGMA 查询。
3. 没有 `agent` 列时，在 `BEGIN IMMEDIATE` 事务内依次执行：
   1. 再查一次 `PRAGMA table_info`。别的进程已经补过列的话，直接提交并结束。
   2. `ALTER TABLE timeline_events ADD COLUMN agent TEXT`
   3. `UPDATE timeline_events SET agent = 'claude-code'`。只在补列的这一次执行，存量行全部视为 claude-code（spec §6）。
   4. `COMMIT`
4. 迁移过程中如果捕获到消息含 `duplicate column name` 的错误（并发竞争），回滚并视为成功。其他错误照常抛出，由 hook 层吞掉。
5. 现有的版本检查（库中记录的版本大于 `TIMELINE_SCHEMA_VERSION` 时抛 `TimelineSchemaError`）保留。

用 `BEGIN IMMEDIATE` 的原因：hook 进程是并发的短进程，必须先拿到写锁再检查列，避免两个进程都看到「列不存在」。

## 4. 写入与读取

- store 的 INSERT 列清单追加 `agent`，值取 `event.agent ?? null`。
- 原始行类型 `EventRow` 可以加 `agent: string | null`。`rowToEvent` **不映射**这一列，`TimelineEvent` 不加字段，所以所有读取输出不变（index C5、C6）。

## 5. 兼容与回滚

| 场景 | 结果 |
|---|---|
| 新装项目 | 建表时就带 `agent` 列，库中最大版本为 2 |
| 旧项目升级 cgraphx，不重装 | 第一个 hook 进程打开库时自动补列并回填，无需用户操作 |
| 旧版 cgraphx（只认 v1）的 INSERT 打到 v2 库 | 不会发生：旧版打开库时先做版本检查，会抛 `TimelineSchemaError` |
| 降级到旧版 cgraphx | 旧版拒开 v2 库，hook 吞掉错误，timeline 静默停止记录。已接受的风险（index §10），在 B-2 提交 body 里注明 |
| 回滚数据 | 不提供。列是可空的附加列，不影响旧列的读写 |

## 6. 数据校验（B-2 验证方式第 2 步）

- 旧库升级后：`SELECT count(*) FROM timeline_events WHERE agent IS NULL` 应为 0。存量行全部回填，新行由 hook 写入非空值。
- `SELECT max(version) FROM timeline_schema_versions` 应为 2。
- 再触发几次 hook：`PRAGMA table_info(timeline_events)` 中 `agent` 只出现一次。
