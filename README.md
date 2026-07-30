[English](README.en.md)

# cgraphx

> 给 **Claude Code** 的**本地研发辅助系统**:20+ 个 skill 定义研发流程,四个项目本地能力(知识库 / 数据库 / 时间线 / 需求索引)在背后支撑。

一个 npm 包,一条 `cgraphx install`,把一整套「需求 → 规格 → 实现 → 测试 → 沉淀」的研发流程装进你的项目。Claude Code 读 skill、按流程办事;全程**项目本地、离线运行、数据不出仓库**。

---

## 它不是又一个 CLI 工具

cgraphx = **skill 流程(主体)+ 程序能力(支撑)**:

- **skill 是主体** —— 20+ 个 markdown 流程指引,沉淀「需求该怎么做」:先澄清、再写规格、大需求拆计划、实现后补测试、有价值的结论沉淀成知识。
- **CLI 是支撑** —— 提供 skill 无法替代的四个项目本地能力:

| 子系统 | 命令 | 能力 |
|---|---|---|
| **docs** 知识库 | `cgraphx docs` | 索引并检索 `docs/knowledge/*.md`(LIKE 查询,中文友好) |
| **db** 数据库 | `cgraphx db` | 只读内省 MySQL / PostgreSQL,内建安全层从构造上拒绝写操作 |
| **timeline** 时间线 | `cgraphx timeline` | 通过 hooks 记录 Claude Code 开发事件,支撑日 / 周 / 月报 |
| **features** 需求索引 | `cgraphx features` | 实时索引 `docs/features/`,按负责人 / 关键词定位本人需求(文件系统派生,无 DB) |

Claude Code 读 skill → 按流程调用 CLI 能力。**你的研发方法论,第一次能被 Claude Code 稳定复用。**

每个项目一个独立的 `.cgraphx/cgraphx.db`,自包含,无服务端,无遥测。

## Skill 工作流

```
knowledge-recall → /clarify-requirements → /write-spec ─┬→ /write-plan → /implementation
  聊业务(自动)      澄清                    规格       │    计划         实现
                                                       └→ /write-unit-test-spec → /write-unit-test-code
                                                            单测规格            填实单测
```

| 线路 | skill |
|---|---|
| 需求主线 | `/clarify-requirements` → `/write-spec` →(可选 `/write-prd` `/write-plan`)→ `/implementation` / `/subagent-implement` |
| 接口测试 | `/write-api` → `/run-api-test`(写接口必查 DB 验数据) |
| 单元测试 | `/write-unit-test-spec` → `/write-unit-test-code` |
| 知识沉淀 | `/code-impact-markdown`,`knowledge-recall` 自动召回 |
| DB schema | `/export-table-ddl` 导出 + `db-query` 探索回写 |

日常默认两步:**澄清 + 实现**;复杂需求按需补规格 / 计划 / 测试。完整 skill 目录见 `cgraphx-guide`。

## 安装与三个命令

```bash
npm install -g cgraphx
```

| 命令 | 作用 |
|---|---|
| `cgraphx install` | 项目内一条命令接入:部署 skills 到 `.claude/`、接入 hooks / statusLine、把工作方式写进 `.claude/CLAUDE.md`、初始化 `.cgraphx/` |
| `cgraphx upgrade` | 通过 npm 自更新(纯换包,不动项目);升级后到各项目重跑 `cgraphx install` 刷新 |
| `cgraphx uninstall` | 按包内清单移除 skills / 配置并删 `.cgraphx/`(加 `--keep-data` 保留数据) |

## 快速上手

```bash
cd your-project
cgraphx install          # 接入:建 .cgraphx/、部署 skills、写工作方式
```

重启 Claude Code 即可。怎么真正用好它,见下面的**最佳起步实践**。

## 最佳起步实践

接入只是第一步。要让 Claude Code 真正按你项目的规矩办事,推荐这个起步顺序——**先立规范、再聊业务、然后才做需求**:

**1. 立规范 · `/init-project-guides`**
生成 `docs/guides/` 规范速查(编码 / 接口 / 数据 / 测试 / Git 五份)。规范 = 项目对默认做法的**有意偏离**(如「SQL 禁止 `ORDER BY`」「金额一律 `decimal(12,2)`」「commit 用 A 格式」)——这些最容易偏离、又没有工具兜底。新项目立起步默认(注明「待演进」);已有项目从代码 / git 历史挖既有约定固化成文。这些 guide 是后续任务的强制读点,会被 `/write-plan` 结晶成契约。

**2. 聊业务 · `knowledge-recall`(Claude Code 自动触发)**
做需求前先和 Claude Code 聊一聊业务:它会从项目知识库召回已沉淀的概念、对齐黑话、指出相关决策文档——避免用错术语、重复问已记录过的问题。边聊边用 `/code-impact-markdown` 把业务实体沉淀下来,知识库越用越厚。

**3. 做需求 · `/clarify-requirements` 起步**
进入主工作流:澄清 → 规格(`/write-spec`)→ 实现(`/implementation`)→ 测试。有了前两步,这时的澄清才有共同语境,而不是从零问起。

> 顺序的意义:先有规范(Claude Code 懂项目的「规矩」),再对齐业务(Claude Code 懂项目的「黑话」),然后澄清具体需求才事半功倍。

## 要求

- **Claude Code**(skill 部署、hooks 与 timeline 均依赖其机制,见下)
- Node.js `>=22.5 <27`(使用内置 `node:sqlite`,无原生依赖、无 wasm)
- 项目本地、离线运行

## 为什么只支持 Claude Code

cgraphx 的 skill 部署(`.claude/`)、hooks 接入,以及 **timeline** 的开发事件记录,都依赖 Claude Code 的机制——而不同 agent 的 hooks / skill 机制各不相同,无法一套通用。因此 cgraphx 仅支持 Claude Code。

> `docs` 与 `db` 两个 CLI 能力本身与 agent 无关,可在任何能跑 shell 的环境独立调用;但作为一套研发系统(skills + hooks + timeline),cgraphx 面向 Claude Code。

## 关于名字

cgraphx 得名于 1.x 的代码图谱(code graph)。2.0 是一次破坏性重构:**图谱层已整体移除**(无 `explore` / `query` / `callers`,无 MCP server,无遥测),聚焦到 Claude Code 真正复用的三个子系统。1.x → 2.0 不兼容,详见 `CHANGELOG.md`。

## 许可证

[MIT](LICENSE) © liulongfei
