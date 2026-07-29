---
name: export-table-ddl
description: 导出项目用到的全部数据库表的 DDL 到可检索目录(按工程分目录,每工程一个 INDEX.md 列表名+注释,details 目录放完整建表语句)。Use when 导出表结构/导出DDL/导出建表语句/拉表结构/批量查DDL/项目表清单/数据库表导出/dump schema/导出全部表.
---

## 目标

把一个项目(或多个工程)用到的所有表的 `CREATE TABLE ...` DDL 拉下来,存成 AI 可检索的目录:

```
<out-dir>/
  <工程A>/
    INDEX.md          # 表名 + 表注释,一眼扫完
    ddl/
      users.sql        # 完整 DDL(含列注释/索引/外键)
      orders.sql
  <工程B>/
    INDEX.md
    ddl/
      ...
```

AI 后续要理解某张表 → 直接 `Read ddl/<table>.sql`;要扫一个工程有哪些表 → `Read INDEX.md`。不用每次重新连库查。

## 前置

- `cgraphx` CLI 已装(`cgraphx db` 可用),目标项目已配 `.cgraphx/db-profiles.json` 或 `~/.cgraphx/db-profiles.json`。
- 目标 DB profile 可连。先 `cgraphx db profiles` 确认。

## 流程

### 1. 确认 profile

```bash
cgraphx db profiles
```

跟用户确认连哪个 profile(避免连错库)。记下 profile 名。

### 2. 识别项目用到的表名

三种来源,按用户意图选:

**(a) 从代码里 grep 出来**(默认,最贴"项目用到的表"):

按项目主语言/框架选 grep 模式,目标是抽出所有被引用的表名,dedup 后给用户过目。

通用 SQL 引用(任何语言,SQL 字符串里):
```bash
grep -rhoE '\b(FROM|JOIN|INTO|UPDATE|DELETE\s+FROM)\s+`?[a-zA-Z_][a-zA-Z0-9_]*`?' --include='*.sql' --include='*.xml' --include='*.java' --include='*.ts' --include='*.py' --include='*.go' \
  | sed -E 's/^(FROM|JOIN|INTO|UPDATE|DELETE\s+FROM)\s+`?([^` ]+)`?$/\2/' \
  | tr '[:upper:]' '[:lower:]' | sort -u
```

ORM 装饰器(按框架补):
- JPA/Hibernate:`@Table(name\s*=\s*"([^"]+)")` / `@Entity`
- MyBatis-Plus:`@TableName\("([^"]+)"\)`
- SQLAlchemy:`__tablename__\s*=\s*['"]([^'"]+)['"]`
- Django:`db_table\s*=\s*['"]([^'"]+)['"]`
- TypeORM:`@Entity\({?\s*name:\s*['"]([^'"]+)['"]`

把 SQL 引用 + ORM 声明的表名合并、dedup、过滤掉明显非真实表的(subquery 别名、`information_schema.*`、`pg_*`、`dual`、`t`/`t1`/`tmp` 这种短别名 —— 命名太短且不在 DB 表清单里的丢掉)。

**(b) 用户给清单文件**(每行一个表名,或 JSON 数组)—— 用户已有列表时最省事。

**(c) 全库导出**(`--tables all`)—— 不区分项目用没用,把 profile 里所有表都拉下来。适合建知识基线。

把最终表清单写到一个临时文件(如 `/tmp/tables-<project>.txt`),给用户看一眼确认再进下一步。**确认前不要连库批量拉** —— 表清单错了会浪费 N 次查询。

### 3. 按工程分目录(多工程项目)

如果项目有多个工程(微服务 / monorepo / Maven 多模块),每个工程单独跑一次脚本,`--project <工程名>` 区分目录。

工程划分来源(按可靠度排序):
1. 用户显式指定(最可靠)—— 问用户"这些表哪些归工程 A,哪些归工程 B",或用户给每个工程的表清单文件。
2. 代码目录结构推断 —— `packages/*/`、`services/*/`、`apps/*/` 下每个子目录一个工程;Maven 看 `*/pom.xml`;Go workspace 看 `go.work` member。推断后**给用户确认**。
3. 不分 —— 单工程直接 `--project <项目名>` 一个目录。

### 4. 批量拉 DDL

对每个工程跑一次 bundled 脚本:

```bash
node <skill-dir>/scripts/export-ddl.mjs \
  --profile <profile名> \
  --tables <表清单文件|all> \
  --out <输出根目录> \
  --project <工程名>
```

脚本流程:
1. 一次 `cgraphx db schema --mode=tables` 拿全表 + 表注释(用于 INDEX.md + 校验表是否存在)。
2. 对清单里每张表 `cgraphx db schema --mode=ddl --table=X` 拿 DDL 文本,写到 `<out>/<project>/ddl/<table>.sql`。
3. 生成 `<out>/<project>/INDEX.md`:markdown 表格,每行 `| 表名 | 注释 | DDL链接 | 状态 |`。
4. stderr 报告成功/缺失/失败计数。

表清单里某张表在 DB 中不存在 → INDEX.md 标"缺失",不中断其余表导出。

### 5. 报告

跟用户报告:
- 每个工程导出了多少张表、输出目录路径。
- 缺失的表(清单里有、DB 里没有)—— 可能是表名拼错、或属于另一个库,让用户决定。
- 失败的表(连接/超时)—— 列出来,建议重跑或单独查。

## INDEX.md 格式(脚本自动生成)

```markdown
# customer-svc 表清单

共 42 张表(成功 40 / 缺失 2 / 失败 0),DDL 见 `ddl/` 目录。

| 表名 | 注释  | 状态 |
|---|---|---|
| `users` | 用户资料表  | ✓ |
| `orders` | 订单主表 | ✓ |
| `tmp_x` | (表中不存在) | missing |
```

## 输出目录放哪

放 `docs/schema-knowledge/`

## 何时不该用这个 skill

- 只查一两张表 → 直接 `cgraphx db schema --mode=ddl --table=X`,不用批量导出。
- 查数据(不是结构)→ 用 `db-query` skill。
- 表关系探索(不是导出)→ 用 `db-query` skill 的子 agent 流程。

## 代价意识

每张表一次 DB 连接(dbquery 子系统无连接池)。100 张表 ≈ 101 次连接(`--mode=tables` 1 次 + DDL 100 次),远程库可能几十秒。表清单越大越慢,所以**先确认表清单再批量拉**,避免拉了一堆没用的。

## 闭环:和 db-query skill 配合

**全量保鲜的分工**:日常开发改模型 → 开发流程**写透**(全量 `ddl/<表名>.sql` 直接改到最终态,增量流水记在需求目录 `sql/`,见项目 `docs/guides/ddl.md`「Schema 变更约定」节);本 skill 建**基线**并做**周期校准**(初始化、全量重导、漂移复核,DDL + 列注释 + 表注释 + 索引来自 DB);`db-query` 在日常查数据时**补充**探索发现:

```
export-table-ddl  →  docs/schema-knowledge/<project>/ddl/<table>.sql  (基线 DDL)
       ↑                          ↑ 重 dump 保留
       │                          │
       └── 周期校准 / 漂移重跑 ──┘
                                  │
db-query 探索踩坑 → append DISCOVERED 块(隐式关系/字段含义/陷阱/流程)
```

DISCOVERED 块格式(`ddl/<table>.sql` 末尾):

```sql
-- === DISCOVERED (db-query 探索补充,非 DB 原生) ===
-- [关系] assignee_id → users.staff_code (处理人工号)
-- [字段含义] status: 0=待派单 1=处理中 2=已完成 3=已取消
-- [陷阱] email 不唯一,用 phone 关联更稳
-- [流程] 派单→处理→回单:work_order.status 驱动,见 dispatch_log/receipt
-- === END DISCOVERED ===
```

重跑本 skill 时,脚本自动保留每张表已有的 DISCOVERED 块(不会覆盖)。所以可以放心重 dump —— DB schema 变了拿新 DDL,探索积累的知识不丢。详见 `db-query` skill 的"陌生 schema 探索流程"。

### 知识落在哪 —— 顺着 agent 的访问路径

agent 进这个目录的访问路径固定是 `INDEX.md → ddl/<table>.sql`,**不会主动读独立笔记文件**。所以知识只能落在两个地方:

- **`INDEX.md`**:工程级 meta(profile 对应哪个服务、架构一句话)。agent 进目录第一件事就是读它。
- **`ddl/<table>.sql` 的 DISCOVERED 块**:一切表级 + 跨表知识。

跨表知识塞**枢纽表**(流程主表 / 被指向最多的表 / agent 最先点名的表),关系 `A.x → B.y` 双向标注(写进 `A.sql` 和 `B.sql` 各一行)。**绝不建** `NOTES.md` / `跨表知识.md` 这类独立文件 —— 那等于把知识埋了,agent 不会主动读。详见 `db-query` skill 的"枢纽表原则"。
