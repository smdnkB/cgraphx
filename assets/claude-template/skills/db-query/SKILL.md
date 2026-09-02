---
name: db-query
description: 数据库探索方法论 — 通过 cgraphx db CLI 查数据(MySQL + PostgreSQL 直连,或经 HTTP 只读查询接口访问无法直连的库),沉淀业务知识到 docs/schema-knowledge/。Use when 查数据库/查数据/SQL查询/查表/表结构/DDL/查表结构/验证数据/获取测试数据。
---

## 工具(由 cgraphx 提供,通过 CLI 调用)

```bash
cgraphx db <subcommand> [options]
```

| 操作 | 命令 | 关键参数 |
|---|---|---|
| 列已配置 profiles | `cgraphx db profiles` | — |
| 跑 SELECT | `cgraphx db query` | `--sql "SELECT ..."` `--profile <name>?` `--limit <n>?`(自动 LIMIT,默认 100,上限 1000) |
| 查表结构 | `cgraphx db schema` | `--mode ddl --table <name> [--profile <name>]` |
| 列所有表 | `cgraphx db schema` | `--mode tables [--profile <name>]` |
| 查索引 | `cgraphx db schema` | `--mode indexes --table <name>` |
| 查表注释 | `cgraphx db schema` | `--mode table-comment --table <name>` |

输出格式:所有命令支持 `--format json|table|csv`(schema 命令固定 json)。

**`ddl` 模式输出**:直接打印该表真实的 `CREATE TABLE ...` DDL 文本到 stdout(非 JSON)。MySQL 走 `SHOW CREATE TABLE`(含 ENGINE/CHARSET/外键/二级索引/列注释/表注释);PostgreSQL 由 `pg_get_constraintdef` + `pg_get_indexdef` + 列/表注释拼装(含 `COMMENT ON COLUMN` / `COMMENT ON TABLE` / `CREATE INDEX`)。**这是判断表关系 + 字段语义的首选信息源** —— 数据库外键 + 业务专家写的注释 + 索引都在这,输出可直接回灌给同方言 DB。

## 配置位置

- 项目级:`.cgraphx/db-profiles.json`(优先)
- 用户级:`~/.cgraphx/db-profiles.json`
- 禁用整个子系统:`CGRAPHX_DB_QUERY_DISABLED=1` 或 profiles 文件里 `"enabled": false`(禁用时所有命令输出 "数据库无法连接,请以代码中查询为准" 到 stderr,exit code 4,不实际连库)
- 退出码:0 成功 / 2 配置错误 / 3 安全拦截(写操作) / 4 连接/超时/禁用 / 5 参数错误

profiles 文件结构:每个 profile 含 `type`(`mysql`/`postgres`/`http`)、连接参数、可选 `description`。**密码/token 永不输出**。

### 三种 type

- **mysql/postgres**(直连):配 `host/port/user/password/database`(+postgres 的 `schema`)。用于能直连的库(如测试库)。
- **http**(经只读查询接口):配 `url`(接口地址)、`headers`(鉴权,如 `{"Authorization":"Bearer <token>"}`)、`schema`(默认 schema)。用于**只能经项目 HTTP 接口访问、不能直连的库**(如生产库)。接口须实现固定契约:POST 传 `{mode,sql,args,limit,schema,table}` 返回 `{code:200,data:{columns,rows}}` 或裸 `{columns,rows}`;schema 模式(tables/ddl/indexes/table-comment)由接口内部拼方言 SQL 返回结构化结果。**token 过期需手动换**。

#### http profile 配置示例

```json
"flowable-production": {
  "type": "http",
  "url": "http://生产域名/workflow/dbquery",
  "headers": { "Authorization": "Bearer <生产token>" },
  "schema": "zqpd_sch",
  "description": "生产库(经HTTP接口)"
}
```

## 使用原则

1. **必须先确定目标库避免连错** — 先 `cgraphx db profiles` 列出,确认目标 profile
2. **所有查询只读**(铁律,不可破) — 子系统内置禁止 DELETE/UPDATE/INSERT/DROP/ALTER,只读永不改变数据库
3. **必须带 LIMIT** — `cgraphx db query` 自动 LIMIT,但自定义 SQL 仍建议显式 `LIMIT N`
4. **表结构优先读本地知识库,不主动连库** — 先 `Read docs/schema-knowledge/<project>/ddl/<table>.sql`(含 DDL + DISCOVERED 块,比 DB 多团队沉淀的隐式关系/含义/陷阱);文件不存在才 `cgraphx db schema --mode ddl` 兜底。DB 留给"查数据"和"知识库没有的表"
5. **陌生 schema 探索"先问后试"** — 不确定表关系或字段含义时,**先问业务专家**,不要埋头反复试错(试错既浪费 token,也可能拿错数据误导后续判断)
6. **复用 DAO 时验证参数** — 修改 Mapper XML 中的查询条件前,先用真实数据确认字段值分布

## 典型查询流程(已知 schema)

```
0. cgraphx db profiles                                  → 确认连接哪个库哪个 profile
1. Read docs/schema-knowledge/<project>/ddl/work_order.sql  → 看字段、注释、外键 + DISCOVERED 块(本地,首选)
   (文件不存在 → cgraphx db schema --mode ddl --table work_order 兜底)
2. cgraphx db query --sql "SELECT * FROM ... LIMIT 5"   → 用 LIMIT 查样本数据(只有查数据才连库)
3. 确认字段值分布                                          → 编写/修改代码
```

## 陌生 schema 探索流程(不知道表关系时)

按以下优先级链尝试,**每步失败才进入下一步**:

```
1. Read docs/schema-knowledge/<project>/ddl/<table>.sql
   → export-table-ddl skill 导出的 DDL + 团队补充的 DISCOVERED 块(隐式关系/字段含义/陷阱/流程)
   → 找 <project> 目录:在 docs/schema-knowledge/*/ddl/ 下找 <table>.sql;唯一命中直接读,多个问用户
   → 这是首选:比 DB 多 DISCOVERED 块,且不连库

2. 知识库没有 → cgraphx db schema --mode ddl --table A(再 B)
   → 看 DDL 里的外键(MySQL: SHOW CREATE TABLE 内联 / PG: FOREIGN KEY ... REFERENCES)+ 列注释
   → 兜底,且拿到后应沉淀回知识库(见步骤 4)

3. 都没有 → 问用户(不要试错)
   → "这两个表你想通过哪个字段关联?"
   → "你期望这条 SQL 返回什么样的业务实体?"
   → 用户也不知道时,**每一步试错都报告用户**,让用户决定继续还是换思路

4. 探索完成(用户告知或谨慎试错得到结论)后,按"给谁看"分两类落点:
   - **给 agent 看(知识)** → append 到 `ddl/<table>.sql` 的 DISCOVERED 块(格式见下)。这是 agent 读路径上的必经节点,知识必须留在这。
   - **给 DBA 执行(action)** → 若 DB 的 COMMENT/字段注释缺失,生成 `ALTER TABLE ... COMMENT '...'`(MySQL)或 `COMMENT ON COLUMN/TABLE ... IS '...'`(PG),append 到 `<project>/pending-comments.sql`。这是 DBA 的任务队列 —— 执行一条删一条,不在 agent 读路径上,所以放独立文件没问题。
   - 落点口诀:**知识进 DDL 文件,action 进 pending-comments.sql**。两者不混 —— DISCOVERED 块只放"agent 现在要知道的",pending-comments.sql 只放"等 DBA 固化进 DB 的暂存区"。
```

**长期目标**:DB 注释逐渐健全(DBA 执行了 pending-comments.sql)后,`schema --mode ddl` 直接返回业务含义,DISCOVERED 块里对应的 `[字段含义]` 行可删(已被 DB 固化),pending-comments.sql 也 drain 完。DB 自带注释是单一事实源,任何工具/任何人查 DDL 都受益。

## DISCOVERED 块格式(append 到 ddl/<table>.sql 末尾)

```sql
-- === DISCOVERED (db-query 探索补充,非 DB 原生) ===
-- [关系] assignee_id → users.staff_code (处理人工号,业务语义非 DB 外键)
-- [关系] region_id → region.id (地域)
-- [字段含义] status: 0=待派单 1=处理中 2=已完成 3=已取消
-- [陷阱] email 不唯一(同 email 多账号),用 phone 关联更稳
-- === END DISCOVERED ===
```

- 每行 `-- [类别] 内容`,类别:`关系` / `字段含义` / `陷阱` / `流程`(跨表业务流程)。
- 块在 `-- === DISCOVERED` 和 `-- === END DISCOVERED ===` 之间 —— `export-table-ddl` 重 dump 时会保留这个块(不会覆盖)。
- 一张表可多次 append;重复的行不重复加。
- 这是 SQL 注释,不影响 DDL 可执行性。

### 跨表知识往哪张表写 —— 枢纽表原则(重要)

agent 的访问路径是 `INDEX.md → ddl/<table>.sql`,**基本不会主动读独立的 NOTES.md / 项目级笔记文件**。所以跨表知识不能单独建文件,必须塞进 agent 必然落地的表的 DISCOVERED 块:

- **关系(`[关系]`)双向标注**:`A.x → B.y` 在 `A.sql` 和 `B.sql` 的 DISCOVERED 块各写一行。agent 无论从哪头查表,都能看到这条关联。
- **跨表业务流程(`[流程]`)**:塞进该流程的**枢纽表** —— 即流程中心、agent 落地概率最高的那张表。例如"派单→处理→回单"流程,枢纽是 `work_order`(流程主表),写进 `work_order.sql`;不要散到 `dispatch_log`/`receipt` 各一份,更不要建 `派单流程.md`。
- **枢纽表判断**:流程主表 / 被外键指向最多的表 / agent 问"X 业务"时最先被点名的表。多个候选时选那个,其余表用 `[关系]` 双向指回枢纽。
- **绝不建** `NOTES.md` / `<project>-notes.md` / `跨表知识.md` 这类独立文件 —— 那等于把知识埋了,agent 不会主动读。

工程级 meta(profile 对应哪个服务、整体架构一句话)可以放 `INDEX.md` 顶部(agent 进目录第一件事就是读它),但不要沉淀到表级以下的独立文件。

### pending-comments.sql —— 唯一允许的独立文件(DBA action 队列)

`<project>/pending-comments.sql` 是上述"绝不建独立文件"规则的**唯一例外**,因为它服务的不是 agent 而是 DBA:

- **内容**:待执行的 `ALTER TABLE ... COMMENT '...'`(MySQL) / `COMMENT ON COLUMN/TABLE ... IS '...'`(PG)语句,补 DB 缺失的字段/表注释。
- **为什么可以独立**:agent 读路径是 `INDEX.md → ddl/<table>.sql`,**不经过 pending-comments.sql** —— 它不在路径上,放独立文件不会"埋"任何 agent 需要的知识。它只是 DBA 的任务队列。
- **格式**:纯 SQL,按表分组,每组前一行 `-- <table>` 注释。DBA 跑一条删一条(drain 语义)。
- **和 DISCOVERED 块的分工**:同一个字段含义,DISCOVERED 块写"agent 现在要知道的"(立即生效),pending-comments.sql 写"等 DBA 固化进 DB 的"(异步执行)。DBA 执行后:删 pending-comments.sql 里那条 + 删 DISCOVERED 里对应的 `[字段含义]` 行(DB 已固化,文件副本冗余)。
- **重 dump 不动它**:`export-table-ddl` 脚本只写 `INDEX.md` 和 `ddl/*.sql`,不碰 pending-comments.sql。

```sql
-- pending-comments.sql for order-svc
-- 待执行的 COMMENT SQL — DBA 跑完一条删一条,跑完后对应 DISCOVERED [字段含义] 行也可删

-- work_order (MySQL)
ALTER TABLE work_order MODIFY COLUMN status TINYINT NOT NULL COMMENT '0=待派单 1=处理中 2=已完成 3=取消';
ALTER TABLE work_order MODIFY COLUMN assignee_id VARCHAR(64) COMMENT '处理人工号,关联 users.staff_code';

-- users (PG)
COMMENT ON COLUMN users.tenant_id IS '租户隔离字段,所有查询必须带这个过滤';
```

## 何时派子 agent(让上下文更干净)

主 agent **直接调 cgraphx db 工具时,大段原文(DDL 字段列表、SELECT 输出、表关系推断过程)会进自己的上下文**,挤占决策与待办的空间。本 skill 工具适合精确查询,但**模糊意图的重探索型任务**适合派子 agent 在隔离上下文里跑。

### 判断规则(R4:目标精度)

主 agent **已知精确目标**(具体表名 / 字段名 / SQL)→ **不派**,直接调上面工具;主 agent **只有模糊意图**(系统理解 / 梳理 / 调研型)→ **派**。

具体例子:

| 场景 | 不派(直接调工具) | 派(派子 agent) |
|---|---|---|
| 看表结构 | "work_order 表结构" → `Read docs/schema-knowledge/*/ddl/work_order.sql`(没有再 `cgraphx db schema --mode ddl`) | "梳理这个库的所有表关系" |
| 看索引 | "users 表的索引" → `cgraphx db schema --mode indexes --table users` | "系统理解 X 业务的数据模型" |
| 查数据 | "查 work_order 里 status=1 的前 5 条" → `cgraphx db query --sql "SELECT ... LIMIT 5"` | "调研 work_order / payment / users 这套流程涉及的表关系" |

### 派的方法(决定派时执行)

1. **Read** 本 skill 目录下的 `./agent-prompt.md`
2. **Agent tool 调用**:
   ```
   Agent({
     subagent_type: "general-purpose",
     prompt: <agent-prompt.md 文件内容> + "\n\n当前任务: " + <用户原话或你的转述>
   })
   ```
3. **直接采纳**子 agent 返回的提炼结论 —— 不要再自己调 `cgraphx db schema/query` 重新查(那是浪费)
4. 结论不够 → 再派一次(换 prompt 重点,如"重点看 X 表的关联")或回头自己调工具补
5. 子 agent 在返回里明确说"这些表关系不明,建议问用户"→ 主 agent 决定是否问,**不要让子 agent 自己问用户**(主 agent 才是用户对话入口)

### 代价

- **不派的代价**:大段 DDL / SELECT 输出进主上下文,后续决策可用 budget 变小
- **派的代价**:子 agent 本身耗 token,简单查询派反而更贵
- **R4 是平衡点**:只在"模糊意图 + 主 agent 无法精确判断目标"时派

## schema-knowledge 目录结构(由 export-table-ddl 建基线,db-query 探索补充)

```
docs/schema-knowledge/
  <工程A>/
    INDEX.md                # 表名 + 表注释,一眼扫完(agent 入口)
    pending-comments.sql    # DBA 待执行的 COMMENT SQL(action 队列,不在 agent 读路径上)
    ddl/
      users.sql             # 完整 DDL + 末尾 DISCOVERED 块(agent 读路径)
      work_order.sql
  <工程B>/
    ...
```

**两类落点,各服务不同对象**:
- **给 agent 看(知识)** → `ddl/<table>.sql` 的 DISCOVERED 块。agent 读路径必经。
- **给 DBA 执行(action)** → `pending-comments.sql`。DBA 任务队列,不在 agent 读路径上。

**两张表的 DDL 文件示例**(work_order.sql):

```sql
CREATE TABLE `work_order` (
  `id` bigint NOT NULL AUTO_INCREMENT,
  `assignee_id` varchar(64) NOT NULL COMMENT '处理人工号',
  `status` tinyint NOT NULL,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
-- === DISCOVERED (db-query 探索补充,非 DB 原生) ===
-- [关系] assignee_id → users.staff_code (处理人工号,关联 users.staff_code)
-- [字段含义] status: 0=待派单 1=处理中 2=已完成 3=已取消
-- [陷阱] 跨 schema 查询时 schema 前缀必须显式
-- === END DISCOVERED ===
```

**闭环工作流**:
1. `export-table-ddl` 跑一次 → 建基线(DDL + 注释 + 索引,无 DISCOVERED 块,无 pending-comments.sql)
2. 日常 `db-query` 查数据踩坑 → 发现隐式关系/含义/陷阱 → 知识进 `ddl/<table>.sql` 的 DISCOVERED 块;DB 注释缺失则 action 进 `pending-comments.sql`
3. 重跑 `export-table-ddl`(schema 变了)→ DISCOVERED 块保留,新 DDL 接上;pending-comments.sql 不动
4. DBA 执行 pending-comments.sql 里的语句 → DB 注释固化 → 删 pending-comments.sql 里那条 + 删 DISCOVERED 里对应的 `[字段含义]` 行(DB 已是单一事实源,文件副本冗余)

## 期望错误(CLI 退出码语义)

| 退出码 | 含义 | 处理 |
|---|---|---|
| 0 | 成功 | — |
| 2 | 配置错误(profiles 文件缺失/无效) | 创建 `.cgraphx/db-profiles.json` |
| 3 | 安全拦截(SQL 含写操作) | 只读 SELECT,改 SQL |
| 4 | 连接失败/查询超时/子系统禁用 | 检查 profile 连接参数,或 `CGRAPHX_DB_QUERY_DISABLED` 是否设置 |
| 5 | 参数错误(缺 --sql / 缺 --table) | 补全必填参数 |

stderr 文本能直接读,无需额外解析。

## 探索结果收口(给 clarify/spec/plan)

只有当本 skill 用于需求澄清、spec 或 plan 前置探索时,才做简短收口。简单精确查询(如"看某表 DDL")可以直接回答,不套模板。

按需使用以下 4 项,无内容可省略:

- **查到的关键事实**:表、字段、注释、索引、外键/隐式关联、样本分布、状态枚举或异常数据。
- **对决策的影响**:哪些统计口径、过滤条件、兼容策略、迁移/回填策略需要确认或锁定。
- **应进入 PRD/spec/plan 的内容**:数据口径、状态含义、权限隔离字段、迁移任务、验证 SQL、索引风险等。
- **仍不确定/需确认**:需要业务方、DBA、代码探索或 schema 注释补充的点。
