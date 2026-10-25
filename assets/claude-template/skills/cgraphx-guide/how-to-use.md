# cgraphx 怎么用

本地优先的 AI agent 研发系统 · skill 流程 + 知识库 / 数据库 / 时间线

最后更新:2026-07-30

每个 skill 怎么用,见同目录的 [skill 一览](skills.html):一个 skill 一行,默认折叠,可搜索。

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
/clarify-requirements ──→ /write-spec ──→ /write-plan(大需求必走)
  澄清 + 功能方案           唯一契约          一个任务一个文件
        │                                        │
        │            ┌───────────────────────────┘
        ▼            ▼
  /implementation(小需求)· /subagent-implement(大需求,一个会话跑完,做完 /code-review)
        │
   ┌────┴─────────────────────────────┐
   ▼              ▼                   ▼
/write-api    /write-unit-test-spec  交付收尾:
→ /run-api-test → /write-unit-test-code  /knowledge-write 沉淀
  接口测试       单元测试              /end 收口 + 发布记录
                                      commit 门禁(含产物检查)

── 发布后 · 按需(不在主链)──────────────
/write-docs(需求文档、设计文档、接口文档)
```

日常默认两步:**澄清 + 实现**。大需求先 `/write-plan`,再 `/subagent-implement` 一个会话跑完;复杂需求按需补规格和测试;哪里没看懂,说「画个图讲讲」出一页图解。timeline 自动记录开发事件,你不需要主动跑命令。

---

## 各流程详解

### 开发流程

做需求的主线。

- **必经** `/clarify-requirements` 澄清(先探索项目现实,再以功能点为单位给行为链提案、人审稿式改稿,体验变体让人选);结束时在对话里给《需求功能方案》
- **核心** `/write-spec` 环节二:唯一契约——第一节原样收录功能方案,主体写怎么实现:每个功能点出设计决策表(机制选型/数据模型/接口契约),🔒 难回头的等你确认
- **大需求必走** `/write-plan`(小需求可跳过):拆执行计划,不重新选型(以 spec 设计决策表为准,缺口回 spec);index 加一个任务一个文件,先按任务类型拆,一个任务预估超过 15 个文件再按并行度拆;大需求给一句 `/subagent-implement` 启动语
- **必经** `/implementation`(小需求)或 `/subagent-implement`(大需求):大需求在一个会话里按任务派子 agent,主会话按提交点提交,全部做完统一验证、修复,最后提示跑 `/code-review`;判据是需求规模(预估变更文件 ≥10,且跨 ≥3 个相互独立的模块),不是任务量
- **随时** `/visual-explain`:哪里没看懂,说「画个图讲讲」,出一页图解;clarify 结尾、write-spec 请你确认难回头决策、write-plan 请你确认设计预览时会提醒

> 日常默认 2 步:澄清 + 实现。spec 是唯一契约——「没有任何业务义务存在于 spec 之外」,变更时只改 spec 一处,下游重新派生。

> **交付收尾**:实现收尾会提示沉淀知识(`/knowledge-write`)和平台环节缺口;需求做完跑 `/end` 写收口档案,已上线时写发布记录。

---

### 接口测试流程

**需求开发完成后**,从 spec 到测试报告的全自动闭环。测试产物基于开源工具 **bruno**:`docs/bruno/` collection 可用 bruno app(GUI)直接打开,可视化浏览、手工调试接口;自动化执行依赖其 CLI(`@usebruno/cli`),需 `npm install -g @usebruno/cli`(每机器一次,也可项目本地装;未装时 `/run-api-test` 报错退出并指向该命令)。

- `/write-api` 基于 spec 接口契约自动生成 bruno 测试接口(.bru + 内嵌断言 + 真实参数 + 多环境配置)
- `/run-api-test` 跑测试 + 核实写接口 DB 副作用 + 出报告——**写接口必须查 DB 验数据,HTTP 200 ≠ 通过**

> 产物落在 `docs/bruno/` + `docs/features/<前缀>/`(测试规格 + 报告)。两个 skill 顺序依赖,但 run-api-test 也可独立跑(针对已有 .bru)。失败只报告不修代码不重跑,交用户决定。

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
- `knowledge-recall` 做需求前自动召回相关概念、对齐术语,精确查询也走它——agent 自动触发,你不用管
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
| `/write-docs` | 需求文档、设计文档、接口文档(运行时选,可多选) | 发布后按需 |

---

### 工作回顾

- `/developer-timeline` 从自动记录的开发事件流生成日报/周报/月报/阶段总结/使用习惯分析
- `/write-workload` 产出需求工作量汇报,按功能点 × 工作内容拆工时(内部对账/甲方结款依据)

---

### 安全审计(按需)

上线前、等保或甲方测评前自查用的独立审计,不在开发主链上。

- `/audit-login-security` 审登录/认证:先枚举**全部**认证入口(密码、短信验证码、扫码、第三方 SSO、token 刷新、后台登录),再沿认证链路五段(入口 → 凭据校验 → 会话签发 → 鉴权执行 → 终结与找回)逐条查绕过、越权、凭据、会话、爆破
- 每条发现给三段式证据链:`攻击者输入 → 代码路径(file:line) → 结果`,按致命/高/中/低 + 置信度排序
- 白盒为主;用户许可时在**本地或测试环境**用测试账号做最小动态验证,不碰生产、不爆破、不扫描
- **只报告不修代码**,默认只在对话里给结论;设计缺陷走 `/write-spec`,实现 bug 走 `/implementation`

> 产物默认不落盘;用户要归档时才写 `docs/security/<日期>-登录安全审计.md`。已怀疑被入侵(要查谁怎么进来的)不是这个 skill,是日志取证。

---

## docs/ 目录速查

翻文档时知道去哪儿找——哪个目录由哪个 skill 维护。

```
docs/
├── features/   需求目录(单次需求工作目录,spec 必有)
│   └── <日期>-<编号>-<前缀>/
│       ├── <前缀>-spec.md             /write-spec           必有  唯一契约
│       ├── plan/                      /write-plan           可选  大需求
│       ├── <前缀>-<主题>-v<N>.html    /visual-explain       可选  要图解时
│       ├── <前缀>-需求文档.md         /write-docs           可选  发布后按需
│       ├── <前缀>-设计文档.md         /write-docs           可选  发布后按需
│       ├── <前缀>-接口文档.html       /write-docs           可选  发布后按需
│       ├── <前缀>-接口测试-spec.md    /write-api            可选  开发完成后
│       ├── <前缀>-接口测试报告.md     /run-api-test         可选  write-api 后
│       ├── <前缀>-接口测试验证.jsonl  /run-api-test         可选  自动产出
│       ├── <前缀>-单元测试-spec.md    /write-unit-test-spec 可选  开发完成后
│       ├── <前缀>-单元测试报告.md     /write-unit-test-code 可选  开发完成后
│       ├── <前缀>-收口档案.md         /end                  可选  需求做完
│       └── <前缀>-发布记录.md         /end                  可选  已上线时
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
├── security/   安全审计报告(/audit-login-security,默认不落盘,要归档才写)
│   └── <日期>-登录安全审计.md
│
└── guides/   项目规范(/init-project-guides 生成)
    ├── coding-standards.md
    ├── interface-standards.md
    ├── data-standards.md
    ├── testing-standards.md
    └── git-standards.md              commit 门禁指向此文件
```

> **两个核心目录**——`docs/features/` 是单次需求工作目录(必须有 spec),`docs/knowledge/` 是跨需求共享的业务知识库。bruno/、schema-knowledge/、security/、guides/ 按需出现。

---

cgraphx 使用说明 · 2026-10-24
