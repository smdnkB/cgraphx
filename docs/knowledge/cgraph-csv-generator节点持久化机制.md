---
title: csv-generator 节点持久化机制
document_type: mechanism
domains:
  - cgraph引擎
concepts:
  - csv-generator节点持久化
aliases:
  - csv-generator persistence
  - 节点持久化
  - ExternalService 持久化
tags:
  - cgraph
  - csv-generator
  - lbug
  - 持久化
  - LadybugDB
status: active
source_type: debugging
owners:
  - cgraph
related_code:
  - cgraph/src/core/lbug/csv-generator.ts
  - cgraph-shared/src/lbug/schema-constants.ts
  - cgraph/src/core/ingestion/pipeline-phases/rpc-edges.ts
related_documents:
  - docs/knowledge/cgraph-parse-cache与增量索引.md
created: 2026-08-10
updated: 2026-08-10
---

## Summary

cgraph(轻量代码智能引擎)的图节点持久化是**双声明**的:在 `schema-constants.ts`(NODE_TABLES/REL_TYPES/RELATION_SCHEMA)声明节点/边类型只让 LadybugDB 建表,节点真正落盘还要在 `csv-generator.ts` 的 `streamAllCSVsToDisk` 的 `switch(node.label)` 里加对应 case + writer。**漏掉 csv-generator 的 case,节点会被 `default` 分支按"未知标签——故意不持久化"静默丢弃:不报错、不进 DB、图谱里查不到**,但内存图创建时是对的(阶段日志显示创建了 N 个,持久化后变 0)。

这个陷阱在 DEFECT-1 里实际踩过:ExternalService 节点 schema 声明了、rpc-edges 阶段正确创建了 35 个,但 csv-generator 无 case → 全丢 → RCALLS orphan 边因 FK 端点缺失连带丢失。fork(上游 1.6.6)自己也有这个缺陷。

**判据**:某节点类型"阶段说创建了、cypher 查 count 是 0" → 几乎一定是 csv-generator 漏 case。

## 机制双声明

- **schema-constants.ts**(`cgraph-shared/src/lbug/schema-constants.ts`):`NODE_TABLES`(节点表)、`REL_TYPES`(边类型)、`RELATION_SCHEMA`(FROM/TO 标签对)——LadybugDB `CREATE TABLE` 用,声明了才能建表。
- **csv-generator.ts**(`cgraph/src/core/lbug/csv-generator.ts`):`streamAllCSVsToDisk` 把内存图 emit 成 CSV 再 `COPY` 进 LadybugDB。节点 emit 走 `switch(node.label)`,每个标签需要:① 一个 writer(列结构与该标签 schema 匹配,如 `EXTERNAL_SERVICE_SCHEMA`);② `case '<Label>':` 分支;③ 加入 `allWriters`(flush)+ `tableMap`(COPY 注册)。

两处都声明,节点才完整落盘。schema 管建表,csv-generator 管填数据。

## default 分支的静默丢弃

csv-generator 的 `switch(node.label)` 的 `default` 分支走"未知标签——故意不持久化"路径(line ~687-693),**不报错**。设计意图是允许某些纯运行时标签不入库,但副作用是:漏 case 的真节点也被静默吞掉。

边的持久化依赖两端节点都已落盘(FK 约束):节点丢失 → 连带 orphan 边丢失 → 影响统计(RCALLS 总数偏低)。

## 新增节点类型 checklist

加一个图节点类型(如新的合成节点 / 新的关系端点类型)时:

1. `schema-constants.ts`:`NODE_TABLES` 加标签 + `RELATION_SCHEMA` 加涉及的 FROM/TO 标签对
2. `graph/types.ts`(`cgraph-shared`):`NodeLabel` 联合加标签
3. **`csv-generator.ts`**:加 writer + `case` + allWriters/tableMap(参考 Route/Tool/BasicBlock/ExternalService 的显式 case 模式)
4. `registration-table.ts`(若存在):`LABEL_BEHAVIOR` 加条目(编译期 `satisfies Record<NodeLabel,…>` 穷举检查会强制)
5. 验证:阶段创建后立即 `MATCH (n:<Label>) RETURN count(n)` 确认 > 0(不要只看阶段日志的"创建了 N 个")

漏第 3 步是最常见的坑——前 2 步让构建通过、阶段跑通,但持久化静默失败。

## Open Questions

- 是否应把 csv-generator 的 default 分支从"静默丢弃"改成"未知标签告警",让漏 case 早暴露?(当前是 DEFECT-1 那样靠验收 count 才发现;改 default 行为属架构变更,需评估对合法"故意不持久化"标签的影响)
