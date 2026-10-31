---
title: 新增 skill 的同步清单
document_type: guide
domains:
  - skill 流程
concepts:
  - 新增 skill 的同步清单
aliases:
  - 新增skill
  - 新 skill 接入
  - skill 同步清单
  - 模板同步
  - skill 索引同步
tags:
  - skill 流程
  - 模板
  - 索引
status: active
source_type: work_context
owners:
  - liulongfei
related_code:
  - assets/claude-template/skills/init-tech-stack/SKILL.md
  - assets/claude-template/FLOW-MAP.md
  - assets/claude-template/skills/cgraphx-guide/SKILL.md
  - assets/claude-template/skills/cgraphx-guide/skills.html
  - assets/claude-template/skills/cgraphx-guide/how-to-use.html
  - README.md
  - CLAUDE.md
  - scripts/copy-assets.cjs
related_documents:
  - docs/knowledge/skill-invocation轴.md
created: 2026-10-31
updated: 2026-10-31
---

# 新增 skill 的同步清单

## Summary

新增一个 cgraphx skill,除了写 `assets/claude-template/skills/<name>/SKILL.md`,还要同步模板与索引:FLOW-MAP(流程落位)、cgraphx-guide 的阶段表与 skill 导航、skills.html(分组/chip/条目)、how-to-use.html(起步实践/全景/docs 树)、README(问题表/起步实践)、根 CLAUDE.md(skill 计数与主线)、知识库 `skill-invocation轴`(计数与调用类型)。漏一处,用户或 agent 就找不到它。

## 何时用

往 cgraphx 模板新增一个 skill、或把已有 skill 从一个位置迁进模板时。只改 skill 正文、不新增/移除 skill 时不用走全表。

## 同步清单

| # | 位置 | 改什么 | 为什么 |
|---|---|---|---|
| 1 | `assets/claude-template/skills/<name>/SKILL.md` | 新增 skill 源文件 | 模板是唯一源;`cgraphx install` 按目录递归部署 |
| 2 | `assets/claude-template/FLOW-MAP.md` | 依赖总览图、所属流程章节(链/前置/强制读/产物/边界)、相关流程的前置 | 流程地图是用户与 agent 找流程的入口 |
| 3 | `assets/claude-template/skills/cgraphx-guide/SKILL.md` | 「整体使用流程」阶段表 + 「各 skill 导航」一行 | 用户问「有哪些 skill / 该怎么用」时的导航 |
| 4 | `assets/claude-template/skills/cgraphx-guide/skills.html` | 所属分组 + chip 文案 + `<details class="skill">` 条目 | 可视化 skill 一览;搜索/分组靠 DOM |
| 5 | `assets/claude-template/skills/cgraphx-guide/how-to-use.html` | 最佳起步实践、工作流全景、`docs/` 目录树(若新增产物目录) | 给人类看的整体使用页 |
| 6 | `README.md` | 「解决什么问题」表、「最佳起步实践」 | 仓库首页的产品叙事与起步顺序 |
| 7 | 根 `CLAUDE.md` | 「共 N 个 skill」计数 + skill 主线 bullet | 仓库维护者的总览;计数写死易漏 |
| 8 | `docs/knowledge/skill-invocation轴.md` | 追加当日更新段(总数、model/user 计数、判据);`related_code` 加新路径 | 调用类型是 context load 的决策依据 |
| 9 | `scripts/copy-assets.cjs` | 仅当 skill 带 `assets/claude-template/**` 之外的运行时资产 | 否则不随包发布,运行时 ENOENT |
| 10 | `deprecated-assets.json` | 仅改名/移除时登记旧路径 | 新增 skill 不登记,否则会被升级清理掉 |
| 11 | `docs/knowledge/` | 若 skill 改变了流程口径或带来新机制,补/改对应知识条目 | 下一次 recall 直接命中 |

## 先定调用类型

在写 frontmatter 前先按 `skill-invocation轴` 判:

- **model-invoked**:agent 需要自主触发,或被另一个 skill 正文**调用**;description 常驻上下文。
- **user-invoked**(`disable-model-invocation: true`):只有人敲命令才跑;零常驻上下文。别的 skill 只做**文字推荐**(「提示用户跑」)不算调用。

判完再写清单第 8 项;改判要同步改相关 skill 的措辞(如把「跑 X」改成「提示用户跑 X」)。

## 验证

- `ls assets/claude-template/skills` 数出新的目录数;与根 `CLAUDE.md`、知识库计数一致。
- `npm run build` 后 `test -f dist/.claude-template/skills/<name>/SKILL.md`。
- `grep -rn "<name>" assets/claude-template README.md CLAUDE.md docs/knowledge` 应有预期命中。
- 知识库文件改过则 `cgraphx docs validate <file>`。
- `npm test`(模板资产改动会进 installer 相关测试的视野)。

## 常见漏项

- 只加了 skill 目录,没加 FLOW-MAP / cgraphx-guide / skills.html,用户找不到。
- 改了计数只改一处:根 `CLAUDE.md` 和 `skill-invocation轴` 容易漏。
- 新产物目录(如 `docs/adr/`)只写进 skill,没写进 `how-to-use.html` 的 `docs/` 树。
- 调用类型与调用方措辞不一致:user-invoked 的 skill 被别的 skill 写成「跑」,agent 会尝试调用一个被禁用的 skill。
