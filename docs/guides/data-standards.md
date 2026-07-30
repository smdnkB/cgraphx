# 数据与模型规范

> 本仓库无业务数据库;数据 = 包内 SQLite(`.cgraphx/cgraphx.db`,markdown / timeline 两子系统共用)。

## 模型层

- DB 原始行类型用 `XxxRow` 后缀,字段保留 SQL snake_case(与表列一一对应),JSON 序列化列尾注 `// JSON`
- 多值字段双轨:不需反查的用 JSON TEXT 列(默认 `'[]'`,如 `markdown_documents.owners` / `aliases`);需反查 / JOIN 的用中间表(如 `markdown_document_concepts`,CASCADE 删除随主表)

## DDL 层

- 表命名空间:每子系统拥有前缀表(`markdown_*` / `timeline_*`),共用一个 `.cgraphx/cgraphx.db`
- `schema.sql` 必须全幂等(一律 `CREATE ... IF NOT EXISTS`),由 schema-bootstrap 重复应用
- 每子系统自有版本表(`<prefix>_schema_versions`,每版本一条 `INSERT OR IGNORE`);表结构变更 = schema.sql 追加 + 加版本号,不改旧版本记录

## ORM 映射约定

- 无 ORM:手写 SQL + `src/core/db/` 适配器(better-sqlite3 风格:`prepare` / `exec` / `pragma` / `transaction`,statement 提供 `run` / `get` / `all` / `iterate`)
- DB 入口唯一走适配器,不直接碰 `node:sqlite` / `DatabaseSync`
- 行 → 领域类型映射在 store 层显式完成,原始行类型不外泄

## Schema 变更约定

> 适用说明:包内表变更(markdown_* / timeline_*)走上面的版本表机制;以下约定约束 cgraphx 接入的目标项目业务 DB(docs/schema-knowledge 沉淀,CLAUDE.md 引用)。

- **全量(最终态,写透)**:`docs/schema-knowledge/ddl/<表名>.sql` 一表一文件、表名命名,始终是该表的最终 CREATE TABLE——模型一变就直接改成最终版,不保留历史;新表登记 INDEX.md。基线与周期校准由 `/export-table-ddl` 负责。
- **增量(流水,只增不改)**:需求变更脚本落在 `docs/features/<feature-id>/sql/`(多工程加一层工程目录,单工程平铺),一次动作一个文件,命名 `<两位序号>-<动作名>.sql`(如 `01-新建用户表.sql`、`02-用户表新增手机号字段.sql`);执行顺序即序号顺序;开发期模型反复 → 追加新文件,不回头改旧的。DML(初始化/订正数据)同目录同命名。
- 改造既有功能:全量直接改到最终,需求内只记增量;全新功能:建表语句同样进需求 sql/(它是一条增量动作),全量正常维护到最终。
- 发版增量集合 = 上次发版以来各需求 `sql/` 的汇集,按需求目录日期 + 文件序号执行。
- **交付自检**:全量终态 = 增量动作依次执行的结果;不一致 = 漏维护,视为交付未完成。
