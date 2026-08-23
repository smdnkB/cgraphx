# cgraphx 怎么用

本地优先的 AI agent 研发系统 · skill 流程 + 知识库 / 数据库 / 时间线

最后更新:2026-07-30

---

## 安装

```bash
npm install -g cgraphx    # Node.js ≥22.5 <27(内置 node:sqlite,无原生依赖)
```

### 项目级 · 每项目一次

```bash
cd your-project
cgraphx install
```

一条命令全做:建 `.cgraphx/` 数据目录(知识库 + timeline)+ 部署 skills/commands 到 `.claude/` + 接入 hooks/statusLine + 写工作方式到 `.claude/CLAUDE.md`。重启 Claude Code 即可。

### 升级

```bash
cgraphx upgrade           # 在项目目录内执行:npm 自更新 + 自动刷新本项目 skills/hooks(自动清理已改名/移除的旧 skill)
                          # 其他项目各自 cd 进去跑一次;只换包不动项目:cgraphx upgrade --no-install
```

### 卸载 · 可选

```bash
cgraphx uninstall         # 按清单清 .claude/ 内包自带 skills/配置 + 删 .cgraphx/
npm uninstall -g cgraphx  # 卸载 CLI
```

加 `--keep-data` 保留 `.cgraphx/` 数据。

---

## 最佳起步实践

接入只是第一步。推荐这个顺序——**先立规范、再聊业务、然后做需求**:

**1. 立规范 · `/init-project-guides`**

生成 `docs/guides/` 五份规范(编码/接口/数据/测试/Git)。规范 = 项目对默认做法的**有意偏离**——「SQL 禁止 `ORDER BY`」「金额一律 `decimal(12,2)`」这类最容易偏离又没有工具兜底的约定。新项目立起步默认(注明「待演进」);已有项目从代码/git 历史挖既有约定固化成文。这些 guide 是后续任务的**强制读点**:编码/接口/数据三份会被 `/write-plan` 结晶成契约(测试规范不走 plan,由 `write-unit-test-code` 执行前自读,内容全是单测向,接口测试规范由 `write-api` 读 `interface-standards.md` 送达;Git 结晶进 plan 提交规范节)。

**2. 聊业务 · 和 Claude Code 聊项目**

做需求前先聊业务。agent 会自动从知识库召回已沉淀的概念、对齐术语;边聊边用 `/knowledge-write` 把业务实体沉淀下来。知识库越用越厚,重复解释和重复踩坑越少。接手陌生项目可以跑 `/knowledge-init` 批量探索建档。

**3. 做需求 · `/clarify-requirements` 起步**

进入主工作流:澄清 → 规格(`/write-spec`)→ 实现 → 测试。有了前两步,澄清才有共同语境,而不是从零问起。

> 先有规范(agent 懂「规矩」),再对齐业务(agent 懂「黑话」),然后做需求才事半功倍。

---

## 工作流全景

```
knowledge-recall(自动召回)
        │
        ▼
/clarify-requirements ──→ /write-spec ──→ /write-plan(可选)
     澄清                  唯一契约          执行计划
        │                                        │
        │            ┌───────────────────────────┘
        ▼            ▼
  /implementation(小规模) 或 /subagent-implement(大规模)
        │
   ┌────┴─────────────────────────────┐
   ▼              ▼                   ▼
/write-api    /write-unit-test-spec  交付收尾:
→ /run-api-test → /write-unit-test-code  /knowledge-write 沉淀
  接口测试       单元测试              /write-delivery-guide 讲解 + commit 门禁

── 发布后 · 按需(不在主链,不参与门禁)──────────────────
/write-prd(业务方审阅)  /write-design-doc(设计文档)  /write-api-doc(接口文档)
```

日常默认两步:**澄清 + 实现**。复杂需求按需补规格/计划/测试。timeline 自动记录开发事件,你不需要主动跑命令。

---

## 各流程详解

### 开发流程

做需求的主线。

- **必经** `/clarify-requirements` 澄清意图、业务边界、技术约束(不拍板实现手段)
- **核心** `/write-spec` 写技术规格——唯一契约,归档业务行为/规则/接口/数据/权限/异常/验收
- **可选** `/write-plan` 拆执行计划(大需求/跨模块;手段选型在这一步结合代码定——纯工程手段 plan 自主,有业务可观察后果的回跳 spec 业务拍板;index 出「执行方式建议」为实现方式终判)
- **必经** `/implementation`(小规模:单点/1-3 文件/单模块)或 `/subagent-implement`(大规模:预估变更文件 ≥10 且跨 ≥3 独立模块,派子 agent 隔离上下文);判据是需求规模,不是任务量

> 日常默认 2 步:澄清 + 实现。spec 是唯一契约——「没有任何业务义务存在于 spec 之外」,变更时只改 spec 一处,下游重新派生。

> **交付收尾**:实现收尾会提示两件事——沉淀(`/knowledge-write`,沉淀业务决策/实体到 `docs/knowledge/`)和讲解(`/write-delivery-guide`,有实质代码改动时提示生成本次交付的故事线讲解,归档进需求目录、可重生成)。

---

### 接口测试流程

**需求开发完成后**,从 spec 到测试报告的全自动闭环。

- `/write-api` 基于 spec 接口章节自动生成 bruno 测试接口(.bru + 内嵌断言 + 真实参数 + 多环境配置)
- `/run-api-test` 跑测试 + 核实写接口 DB 副作用 + 出报告——**写接口必须查 DB 验数据,HTTP 200 ≠ 通过**

> 产物落在 `docs/bruno/`(接口定义,bruno app 可直接打开)+ `docs/features/<前缀>/`(测试规格 + 报告)。两个 skill 顺序依赖,但 run-api-test 也可独立跑(针对已有 .bru)。失败只报告不修代码不重跑,交用户决定。

---

### 单元测试流程

**需求开发完成后**的独立流程,共享 spec 作为输入(与接口测试同节奏)。

- `/write-unit-test-spec` 基于 spec 产出测试规格文档(零代码依赖——该测哪些路径/边界/异常)
- `/write-unit-test-code` 基于测试规格 + 已有实现,填实测试代码 + 跑测试 + 出报告

> 找不到测试规格则退出要求先跑 write-unit-test-spec。产物落在 `docs/features/<前缀>/`(测试规格 + 报告)+ 项目测试目录。

---

### 知识管理

两个知识积累闭环,用得越多越值钱。

**业务知识(沉淀 → 召回)**:

- `/knowledge-write` 把有价值的知识沉淀到 `docs/knowledge/`(开发收尾自动提示,也可随时手动触发)
- `knowledge-recall` 做需求前自动召回相关概念、对齐术语——agent 自动触发,你不用管
- `knowledge-api` 已知概念名时精确查知识库——agent 自动触发
- `/knowledge-init` 接手陌生项目时批量探索建档——可选,只跑一次

> 产物落在 `docs/knowledge/*.md`。写文件前必须过 `cgraphx docs validate` 校验,非法文件会被索引跳过。闭环:沉淀 → 召回 → 新概念再沉淀,知识库越厚,agent 越懂你的项目。

**数据模型(导出 → 探索 → 回写)**:

- `/export-table-ddl` 按工程批量导出 DDL 基线(一表一文件)——项目接入时跑一次,schema 变了重跑
- `db-query` 查数据时**首选读本地 DDL**(便宜),只在知识库没有或要实际数据时才连库(贵,兜底);探索发现的字段含义/隐式关系/陷阱 append 到对应表的 DISCOVERED 块——agent 自动触发

> 产物落在 `docs/schema-knowledge/<工程>/`(INDEX.md + ddl/*.sql + pending-comments.sql)。重 dump 时 DISCOVERED 块**自动保留**,积累不丢。

---

### 事后文档(发布后 · 按需)

不在开发主链上,不参与流程门禁。设计原则:前期文档越少,变更回归成本越低;发布后写的是实际交付的行为,不存在文档与系统漂移。

| skill | 产物 | 推荐时机 |
|---|---|---|
| `/write-prd` | 业务需求文档(给领导/客户/业务方) | 发布后按需 |
| `/write-design-doc` | 设计文档(面向研发/技术负责人/维护者) | 自测通过后 |
| `/write-api-doc` | 接口文档(仅本次新增接口) | 接口开发完毕后 |

---

### 工作回顾

- `/developer-timeline` 从自动记录的开发事件流生成日报/周报/月报/阶段总结/使用习惯分析
- `/write-workload` 产出需求工作量汇报(内部对账/甲方结款依据)

---

## docs/ 目录速查

翻文档时知道去哪儿找——哪个目录由哪个 skill 维护。

```
docs/
├── features/   需求目录(单次需求工作目录,spec 必有)
│   └── <日期>-<编号>-<前缀>/
│       ├── <前缀>-spec.md            /write-spec           必有  唯一契约
│       ├── plan/                     /write-plan           可选  大需求
│       ├── <前缀>-需求文档.md         /write-prd            可选  发布后按需
│       ├── <前缀>-api-spec.md        /write-api            可选  开发完成后
│       ├── <前缀>-测试报告.md         /run-api-test         可选  write-api 后
│       ├── <前缀>-测试验证.jsonl      /run-api-test         可选  自动产出
│       ├── <前缀>-单元测试-spec.md    /write-unit-test-spec 可选  开发完成后
│       ├── <前缀>-单元测试报告.md     /write-unit-test-code 可选  开发完成后
│       ├── <前缀>-交付讲解.md         /write-delivery-guide 可选  交付时
│       └── <前缀>-设计文档.md         /write-design-doc     可选  发布后按需
│
├── knowledge/   业务知识库(跨需求共享)
│   └── *.md                          /knowledge-write 沉淀  /knowledge-init 批量建档
│
├── bruno/   接口测试(bruno app 可直接打开)
│   ├── bruno.json
│   ├── environments/                 local / staging / production
│   └── <服务>/<需求前缀>/<接口>/<场景>.bru
│
├── schema-knowledge/   数据模型知识库
│   └── <工程>/
│       ├── INDEX.md                  表清单 + 注释(agent 入口)
│       ├── pending-comments.sql      DBA 待执行 COMMENT(action 队列)
│       └── ddl/<table>.sql           DDL + DISCOVERED 块(探索积累)
│
└── guides/   项目规范(/init-project-guides 生成)
    ├── coding-standards.md
    ├── interface-standards.md
    ├── data-standards.md
    ├── testing-standards.md
    └── git-standards.md              commit 门禁指向此文件
```

> **两个核心目录**——`docs/features/` 是单次需求工作目录(必须有 spec),`docs/knowledge/` 是跨需求共享的业务知识库。bruno/、schema-knowledge/、guides/ 按需出现。

---

cgraphx 使用说明 · 2026-07-30
