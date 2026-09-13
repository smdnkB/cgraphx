---
title: cgraph parse-cache 与增量索引的区分
document_type: decision
domains:
  - cgraph引擎
concepts:
  - parse-cache与增量索引
aliases:
  - warm cache
  - 热解析缓存
  - incremental indexing
  - 增量索引
tags:
  - cgraph
  - parse-cache
  - incremental
  - 性能
  - spec5.3
status: active
source_type: debugging
owners:
  - cgraph
related_code:
  - cgraph/src/core/ingestion/pipeline-phases/parse-impl.ts
  - cgraph/src/storage/parse-cache.ts
  - cgraph/src/core/run-analyze.ts
related_documents:
  - docs/knowledge/cgraph-csv-generator节点持久化机制.md
created: 2026-08-10
updated: 2026-08-10
---

## Summary

cgraph v1 有**两个名字都带 cache 但语义正交**的机制,极易混淆(实际踩过:T-7 把 parse-cache 当增量索引一起禁了,导致 warm re-analyze 退化 ~2.75×):

- **parse-cache(热解析缓存,保留)**:内容寻址的"解析结果复用"——文件分 chunk,chunkHash = 块内文件 contentHash 的组合;re-analyze 时 chunkHash 命中 → 跳过 tree-sitter parse、byte-copy ParsedFile。**图每次仍全量重建**(spec §5.3 合规)。
- **增量索引(incremental indexing,禁止)**:基于 **git diff** 把变更应用到旧图,不重建图。spec §5.3 明确禁止(v1 手动全量重建)。

判据:**看"复用什么"**——parse-cache 复用"解析结果"(AST),图仍全量重建;增量索引复用"图",不重建。前者合规,后者禁止。

## 决策:v1 保留 parse-cache、禁止增量索引

spec §5.3"v1 仅手动全量重建,不提供增量索引"。全量重建指的是**图**(scope-resolution/communities/processes/图构建/LadybugDB 加载每次都跑),不是**解析**(解析结果可按内容哈希复用)。parse-cache 只省解析这一步,不违背全量重建。

替代方案(增量索引)被排除:它复用旧图、只应用 diff,违背"全量重建"语义,且引入 git-diff→图变更的复杂状态机(v1 要轻量)。

## 性能现实:warm ~270s,非 ~2min

parse-cache 只优化**解析阶段**(hx 占总流水线 ~20%:冷 ~60s → 暖 ~6s,10×)。其余 ~265s(scope-resolution/图构建/LadybugDB 加载/communities/processes)是全量重建固有成本,parse-cache 碰不到。所以 cgraph warm ~270s(4.5min),**到不了 ~2min**——除非增量索引(按设计移除)。

原 spec §11.1"~2min"锚点对 v1 全量重建架构不可达,已据实改为"冷 ~320s / 暖 ~270s,耗时不再作移植正确性锚点"。

## 机制入口

- `parse-impl.ts`:`parseCache = options?.parseCache`(T-7 曾设 undefined,warm-cache fix 补回);`chunkHash` 计算 + `durableHitKeys.has(chunkHash)` 命中判定 + `prepareDurableParsedFileChunk` 写 durable shard
- `parse-cache.ts`(`cgraph/src/storage/`):`loadParseCache`/`saveParseCache`/`loadDurableParsedFileIndex`(write/read 两路,按 PARSE_CACHE_VERSION 版本门控)
- `run-analyze.ts`:`loadParseCache` 构造 + 传入 pipeline + `saveParseCache`(从 usedKeys 建索引)

## 调试陷阱:HIT 日志被 isDev 门控

parse-cache 的 `📦 parse-cache HIT` / `summary` 日志原本被 `isDev`(NODE_ENV=development)门控,生产模式不打印。warm-cache fix 已去掉 summary 日志的 isDev 门控(生产可见 HIT/MISS 计数)。**判断 parse-cache 是否工作,看生产 summary 日志的 "N chunk hit(s)" ,不是看耗时**(耗时只降 ~10%,易误判为 OS 缓存)。

## Open Questions

- 是否值得为 warm < 2min 重新评估增量索引?(当前 v1 明确移除;若未来 hx 规模再涨或重建频繁到不可忍,可作为独立需求重评估,但会破坏 spec §5.3 全量重建的简洁性)
