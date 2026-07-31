# 实体概念主条目模板

适用的 `document_type` 值：

```text
business-entity
```

实体主条目是知识库**索引层的枢纽**：一个业务实体（能用名词指代、有属性和生命周期、被多个流程引用，如"商品"、"礼包"、"订单"）独占一个文档。条目只做**定位与指引**——定义、黑话、跨文件才看得出的约束、代码入口；行为细节永远由 agent 去代码里读，不写进条目（不存细节，所以不会腐烂）。

## 完整模板

```markdown
---
title: 礼包
document_type: business-entity
domains:
  - product
concepts:
  - 礼包                  # 规范实体名：必须与流程条目 concepts 里的引用名严格一致（反查锚点）
aliases:
  - package
  - Pkg
  - 销售包                 # 黑话/别名：同时写进 Summary 一句话，才能被 find --q 命中
tags:
  - entity
status: active             # 只从一两个流程抽出来、尚未补全时用 draft
source_type: manual
owners:
  - platform
related_code:
  - so-service/so-busi/src/main/java/.../PkgContinueAtom.java   # 文件级入口，不写行号
related_documents:
  - docs/knowledge/礼包新装流程.md
  - docs/schema-knowledge/xw-so/ddl/pkg_inst.sql
created: 2026-07-26
updated: 2026-07-26
---

# 礼包

## Summary

一句话定义 + 系统定位。黑话别名在此各出现一次（如"又称销售包/package"）。
与邻近概念的边界一句话说清（如"礼包是商品的打包形态，成员为商品实例"）。
不写行为细节、不写流程步骤。

## 命名与边界

规范名、英文标识符、黑话变体；与易混概念的区分（商品 vs SKU vs SPU 这类）。

## 关键约束与陷阱

只写**跨文件才看得出的**业务规则、隐式约束、历史地雷。
示例：礼包内商品禁止单独退订；准三层续包对礼包成员的校验顺序。

## 代码入口

实体核心类、关键服务/Atom/Scene —— 文件级路径，agent 从这里进去读真实逻辑。
不写行号（重构即失效）、不复述代码逻辑。

## 相关表

链 docs/schema-knowledge/<工程>/ddl/<表>.sql 的 DDL 快照；没有快照就列核心表名。

## 关联流程

只列 2-3 个核心流程条目供人读。完整"参与业务"清单不在此维护——
`cgraphx docs find --concept=礼包` 反查所有引用该实体的文档，是唯一权威视图。

## Open Questions

尚未确认的语义、边界未清的相邻概念。用 status: draft 配合此章节。
```

## 各章节填写要点

| 章节 | 用途 | 注意事项 |
|------|------|----------|
| Summary | 定义 + 黑话 + 定位 | 唯一进索引的章节；黑话要在此出现才能被关键词搜到；不写行为细节 |
| 命名与边界 | 规范名与易混概念区分 | 防止"商品/Goods/SKU"各建一个条目的碎片化 |
| 关键约束与陷阱 | 跨文件关系与隐式规则 | 单个文件能读出的东西不写（代码是事实来源） |
| 代码入口 | agent 读代码的起点 | 文件级路径；**绝不写行号**；不解释代码做了什么 |
| 相关表 | DDL 快照链接 | 走 docs/schema-knowledge/，不抄表结构 |
| 关联流程 | 人读的 2-3 个核心流程 | 不维护全量清单，全量由 concept 反查派生 |

## 不应写入实体条目的内容

| 不写 | 理由 |
|------|------|
| 流程步骤、时序 | 属于流程条目与代码，写进来必然腐烂 |
| 代码逻辑复述 | 代码是事实来源，agent 应从代码入口去读 |
| 行号（`Foo.java:372`） | 一次重构全部失效 |
| "参与业务"全量清单 | 由 `find --concept=<实体>` 反查派生，手动维护必陈旧 |
| 可从 DDL/代码直接读出的属性列表 | 索引层只给指针，不抄内容 |
