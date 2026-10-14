---
title: cgraphx 库副本须带 WAL 文件
document_type: lesson
domains:
  - 开发时间线
concepts:
  - 库副本验证
aliases:
  - WAL
  - cgraphx.db-wal
  - 复制数据库
  - DB 副本
tags:
  - sqlite
  - 验证
  - 隐式约束
status: active
source_type: debugging
owners:
  - liulongfei
related_code:
  - src/core/db/index.ts
related_documents:
  - docs/knowledge/开发任务浏览.md
created: 2026-10-15
updated: 2026-10-15
---

# cgraphx 库副本须带 WAL 文件

## Summary

`.cgraphx/cgraphx.db` 以 WAL 模式打开,最近的写入(如刚执行的 `cgraphx task use`、刚记录的 timeline 事件)可能还在 `cgraphx.db-wal` 里,没有写回主文件。验证时只复制 `cgraphx.db` 做 DB 副本,会悄悄丢掉这些数据。复制库副本要连同 `-wal`(和 `-shm`)一起复制,或先让占用库的进程退出。

## Context

2026-10-15 验证 web 开发任务页的边界场景时,用 DB 副本构造数据:副本里少了几分钟前刚补绑的任务,本地 id 也被新建任务占用,一度以为是代码 bug。

## Findings

- 连接打开时设置 `journal_mode = WAL`,所有 cgraphx 进程(hook、CLI、web)都是这样。
- 当时 `cgraphx.db-wal` 约 4MB,未写回主文件。

## Evidence

- `src/core/db/index.ts` 的 `configureConnection`:`journal_mode = WAL`。

## Impact For Future Changes

- 测试或手工验证需要「库快照」时:`cp cgraphx.db cgraphx.db-wal cgraphx.db-shm <目标>/`,或用 SQLite 的 `VACUUM INTO` 导出一致副本。
- 现象「副本里缺最近的数据」先查这里,不要先怀疑查询逻辑。

## Reuse Guidance

用 DB 副本做验证、排查「刚写入的数据在副本里看不到」时参考。
