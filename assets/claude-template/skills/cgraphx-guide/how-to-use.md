# cgraphx 怎么用

本地优先的 AI agent 研发工具 · 知识库 / 数据库 / 时间线

最后更新:2026-07-16

---

## 安装流程

- `npm install -g cgraphx` 装 CLI(Node ≥ 20 且 < 25)

### 项目级 · 每项目一次

- 项目目录内执行 `cgraphx install`:建 `.cgraphx/` 数据目录(markdown 知识库 + timeline)+ 部署 skills/commands 到 `.claude/` + 写 hooks/statusLine(一条命令全做)

### 卸载 · 可选

- 项目目录内执行 `cgraphx uninstall`:清 `.claude/` 内包自带的 skills/配置 + 删 `.cgraphx/`(加 `--keep-data` 保留数据)
- `npm uninstall -g cgraphx` 卸载 CLI

---

## 使用流程

### 开发流程

做需求的主线。

- 必经 `/clarify-requirements` 澄清意图、业务边界、技术边界
- 可选 `/write-prd` 写业务文档(给业务方 / 领导确认)
- 核心 `/write-spec` 写技术规格(归档业务行为 / 规则 / 接口 / 数据)
- 可选 `/write-plan` 拆执行计划(给 agent 执行)
- 必经 `/implementation` 实现(简单任务)或 `/subagent-implement`(复杂多任务)

> 日常默认 2 步:澄清 + 实现。复杂需求按需补 prd / spec / plan。timeline 自动记录开发事件,你不需要主动跑命令。

---

### 接口测试流程

**需求开发完成后**

- `/write-api` 基于 spec 或已有代码生成 bruno 测试接口(.bru + 测试规格 + 多环境配置)
- `/run-api-test` 跑接口测试 + 核实写接口 DB 副作用 + 出报告 —— write-api 后执行;写接口必须查 DB 验数据

> 产物落在 `docs/bruno/`(接口定义)+ `docs/features/<前缀>/`(测试规格 + 报告)。两个 skill 顺序依赖,但 run-api-test 也可独立跑(针对已有 .bru)。

---

### 单元测试流程

和开发流程平行,共享 spec 作为输入,时序任意(典型是代码先行、测试补充)。

- `/write-unit-test-spec` 基于 spec 产出单元测试规格文档(零代码依赖,该测哪些路径/边界/异常)—— 可选,write-spec 后任意时机
- `/write-unit-test-code` 基于测试规格 + 已有实现,填实测试代码 + 跑测试 + 出报告 —— 找不到测试规格则退出要求先跑 write-unit-test-spec

```
                         ┌──→ /write-plan → /implementation              开发流程 · 写代码
                         │
/clarify-requirements → /write-spec ──┤
                         │
                         └──→ /write-unit-test-spec → /write-unit-test-code   单元测试 · 写测试
```

> 两条独立线路:开发流程写代码,单元测试流程写测试。产物落在 `docs/features/<前缀>/`(测试规格 + 报告)+ 项目测试目录(.test.ts)。

---

### 知识库管理

沉淀业务决策、概念定义、历史教训到跨需求共享的知识库。

- `/knowledge-write` 任何有价值的会话都可以触发沉淀 —— 你只需要关注这一个指令
- `/knowledge-init` 新项目起步时批量探索 + 写知识库 —— 可选,接手陌生项目时跑
- `knowledge-recall` 聊业务 / 不懂术语 / 对齐黑话时,派子 agent 召回相关概念 —— agent 自动触发
- `knowledge-api` 已知概念名,精确查知识库 —— agent 自动触发

> 产物落在 `docs/knowledge/*.md`。写文件前必须过 `cgraphx docs validate` 校验,非法文件会被索引跳过。

---

### 模型知识库管理

数据库 schema 的 DDL 快照 + 探索补充,让 AI 理解表结构和业务语义。

- `/export-table-ddl` 按 profile 批量导出项目用到的表的 CREATE TABLE DDL,按工程分目录 —— 项目接入时跑一次,schema 变了重跑
- `db-query` 查数据时读本地 DDL 文件(首选),文件不存在才连 DB 兜底;探索发现的隐式关系/含义/陷阱 append 到对应表的 DISCOVERED 块 —— agent 自动触发

> 产物落在 `docs/schema-knowledge/<工程>/`(INDEX.md + ddl/<table>.sql + pending-comments.sql)。重 dump 时 DISCOVERED 块自动保留,积累不丢。

---

## docs/ 目录速查

翻文档时知道去哪儿找 —— 哪个目录由哪个 skill 自动维护。

**图例**:`必有` = 必有 | `可选` = 可选(按需) | `本地测试相关`

```
docs/ 文档工程                                             # 必有
├── bruno/  API接口目录          # write-api + run-api-test 维护; bruno app 可以直接打开这个目录识别为接口列表
│   ├── bruno.json                                 
│   ├── environments/
│   │   ├── local.bru                               
│   │   ├── staging.bru
│   │   └── production.bru
│   ├── common/                                   
│   │   └── <接口名>/<场景>.bru
│   └── <服务名>/                              
│       └── <需求前缀>/                           
│           └── <接口名>/                         
│               ├── <场景1>.bru                   
│               └── <场景2>.bru                   
│
├── features/   需求目录
│   └── <日期>-<编号>-<前缀>/  # 如 2026-07-03-CRM-req19230-号百商品详情查询接口
│       ├── <前缀>-spec.md          /write-spec           必选  clarify 后执行
│       ├── <前缀>-需求文档.md       /write-prd            可选  需要需求文档时,spec 之后
│       ├── plan/                /write-plan           可选  大需求,spec/prd 后
│       ├── <前缀>-单元测试-spec.md  /write-unit-test-spec  可选  spec 后任意时机
│       ├── <前缀>-单元测试报告.md   /write-unit-test-code  可选  spec+开发完成后
│       ├── <前缀>-api-spec.md      /write-api            可选  接口测试,开发完成后
│       ├── <前缀>-测试报告.md       /run-api-test          可选  write-api 后自动产出
│       ├── <前缀>-测试验证.jsonl    /run-api-test          可选  自动产出
│       └── <前缀>-设计文档.md       /write-design-doc     可选  发布后按需执行
│
├── knowledge/   知识库目录                         /knowledge-write 任何有价值的会话都可以触发沉淀;
│                                                 /knowledge-init 新项目起步可以批量写 [可选]
│

├── schema-knowledge/   模型知识库目录  /export-table-ddl 批量初始化工程模型, 按工程分目录
│   ├── xw-inst                      /db-query 自动读文件内的模型, 兜底连接数据库获取数据, 经验回写到对应的 ddl文件
│   │   ├── INDEX.md                 # 表名 + 表注释,agent 进目录第一件事读
│   │   ├── pending-comments.sql     # DBA 待执行 COMMENT SQL(action 队列,执行一条删一条)
│   │   └── ddl/
│   │       ├── <table>.sql          # 完整 DDL + 末尾 DISCOVERED 块(db-query 探索补充的隐式关系/含义/陷阱)
│   │       └── <table>.sql
│   ├── xw-order                     # 结构同 xw-inst
│   └── xw-so                        # 结构同 xw-inst
```

> **两个核心目录** —— `docs/features/` 是单次需求工作目录(必须有 spec.md),`docs/knowledge/` 是跨需求共享的业务知识库。**bruno/ 和 schema-knowledge/ 按需出现**,只在跑接口测试 / 查 DB 时产生。

---

cgraphx 使用说明 · 2026-07-16
