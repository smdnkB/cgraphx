# cgraphx

> 给 Claude Code 的本地研发辅助系统——20+ 个 skill 定义研发流程,四个项目本地能力在背后支撑。

一条 `cgraphx install`,把「需求澄清 → 规格 → 实现 → 测试 → 知识沉淀」的完整研发流程装进你的项目。全程**项目本地、离线运行、数据不出仓库**。

---

## 解决什么问题

市面上的 AI 辅助研发工具(包括开源的)基本只覆盖到「代码生成」为止。cgraphx 解决的是代码生成**之后**和**之前**的问题:

| # | 痛点 | cgraphx 的解法 |
|---|---|---|
| 1 | **文档漂移返工**——PRD/Spec/Plan 三份文档,改一条规则要回归全部,最终没一份能信 | Spec 是唯一契约,变更只改一处;PRD、设计文档、接口文档**发布后按需生成**,不在开发主链上 |
| 2 | **业务知识随会话消失**——和 agent 聊出来的理解,关掉窗口就丢了,下次从零开始 | `knowledge-write` 沉淀 → `knowledge-recall` 召回,闭环积累,越用越厚 |
| 3 | **数据模型每次从零理解**——字段含义、隐式关系,上次踩的坑下次又踩 | `export-table-ddl` 建本地 DDL 基线,`db-query` 探索发现回写 DISCOVERED 块,重 dump 保留积累 |
| 4 | **需求理解偏差**——拿到一句话就开写,做完发现理解错了 | `/clarify-requirements` 先锁业务边界和技术约束,不急着写代码 |
| 5 | **规范靠人记**——编码/接口/数据/提交规范,写了没人看 | 规范在执行期自动送达:plan 打「强制引用」标注 + commit 门禁拦截 |
| 6 | **流程到写完代码就断了**——测试是人的事,手动录接口、手动跑、手动验 | `/write-api` 从 spec 自动生成测试用例 → `/run-api-test` 执行 + 强制查 DB 验数据,闭环不断链 |
| 7 | **工作不可追溯**——领导问「这个月做了什么」,翻 git log 拼凑 | timeline 自动记录开发事件(每次 ~5ms),`/developer-timeline` 按需生成日报/周报/月报 |
| 8 | **工具升级留残渣**——skill 改名后旧版本残留,agent 仍能触发过时逻辑 | `deprecated-assets.json` 清单 + install 自动清理 |

## 它怎么工作

cgraphx = **skill 流程(主体)+ CLI 能力(支撑)**。

- **skill 是主体**——20+ 个 markdown 流程指引,定义「需求该怎么做」。agent 读 skill、按流程办事。
- **CLI 是支撑**——提供 skill 无法替代的四个项目本地能力:

| 子系统 | 命令 | 能力 |
|---|---|---|
| **docs** 知识库 | `cgraphx docs` | 索引并检索 `docs/knowledge/*.md`(LIKE 查询,中文友好) |
| **db** 数据库 | `cgraphx db` | 只读内省 MySQL / PostgreSQL,安全层从构造上拒绝写操作 |
| **timeline** 时间线 | `cgraphx timeline` | 通过 hooks 自动记录开发事件,支撑日/周/月报 |
| **features** 需求索引 | `cgraphx features` | 按负责人/关键词定位需求(文件系统派生,无 DB) |

每个项目一个独立的 `.cgraphx/cgraphx.db`,自包含,无服务端,无遥测。

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
  /implementation(简单) 或 /subagent-implement(复杂)
        │
   ┌────┴─────────────────────────────┐
   ▼              ▼                   ▼
/write-api    /write-unit-test-spec  交付收尾:
→ /run-api-test → /write-unit-test-code  /knowledge-write 沉淀
  接口测试       单元测试              commit 门禁

── 发布后 · 按需(不在主链)──────────────
/write-prd(业务方审阅)  /write-design-doc(设计文档)  /write-api-doc(接口文档)
```

日常默认两步:**澄清 + 实现**。复杂需求按需补规格/计划/测试。

## 安装

```bash
npm install -g cgraphx    # Node.js >=22.5 <27(内置 node:sqlite,无原生依赖)
```

```bash
cd your-project
cgraphx install           # 部署 skills → .claude/ + 接入 hooks + 初始化 .cgraphx/
```

重启 Claude Code 即可。

| 命令 | 作用 |
|---|---|
| `cgraphx install` | 项目内一条命令接入全部能力 |
| `cgraphx upgrade` | npm 自更新;升级后到各项目重跑 `install` 刷新 skill |
| `cgraphx uninstall` | 按清单移除 skills/配置 + 删 `.cgraphx/`(`--keep-data` 保留数据) |

## 最佳起步实践

接入只是第一步。推荐这个顺序——**先立规范、再聊业务、然后做需求**:

**1. 立规范 · `/init-project-guides`**

生成 `docs/guides/` 五份规范(编码/接口/数据/测试/Git)。规范 = 项目对默认做法的**有意偏离**——「SQL 禁止 `ORDER BY`」「金额一律 `decimal(12,2)`」这类最容易偏离又没有工具兜底的约定。这些 guide 是后续任务的强制读点。

**2. 聊业务 · 和 Claude Code 聊项目**

做需求前先聊业务。agent 会自动从知识库召回已沉淀的概念、对齐术语;边聊边用 `/knowledge-write` 把业务实体沉淀下来。知识库越用越厚,重复解释和重复踩坑越少。

**3. 做需求 · `/clarify-requirements` 起步**

进入主工作流:澄清 → 规格(`/write-spec`)→ 实现 → 测试。有了前两步,澄清才有共同语境。

> 先有规范(agent 懂「规矩」),再对齐业务(agent 懂「黑话」),然后做需求才事半功倍。

## 知识闭环

cgraphx 有两个知识积累闭环,用得越多越值钱:

**业务知识**:`/knowledge-write` 沉淀到 `docs/knowledge/` → `knowledge-recall` 下次开发前自动召回 → 新概念继续沉淀 → 知识库越厚,agent 越懂你的项目。

**数据模型**:`/export-table-ddl` 建 DDL 基线 → `db-query` 查数据时首选读本地(便宜) → 探索发现回写 DISCOVERED 块 → 重 dump 保留积累 → agent 不再重复踩坑。

## 要求

- **Claude Code**(skill 部署、hooks、timeline 均依赖其机制)
- **Node.js** `>=22.5 <27`(内置 `node:sqlite`,无原生依赖、无 wasm)
- 项目本地、离线运行

> `docs` 与 `db` 两个 CLI 能力本身与 agent 无关,可独立调用;但作为一套研发系统(skills + hooks + timeline),cgraphx 面向 Claude Code。

## 关于名字

cgraphx 得名于 1.x 的代码图谱(code graph)。2.0 是破坏性重构:图谱层已整体移除,聚焦到 skill 流程 + 四个本地能力。1.x → 2.0 不兼容,详见 `CHANGELOG.md`。

## 许可证

[MIT](LICENSE) © liulongfei
