---
title: Bash 事件 cwd 是执行后的目录
document_type: lesson
domains:
  - 开发时间线
concepts:
  - 开发时间线
aliases:
  - post_tool_use cwd
  - cd 前缀
  - 参考推断漏识别
tags:
  - timeline
  - claude-code
  - 隐式约束
status: active
source_type: debugging
owners:
  - liulongfei
related_code:
  - src/core/sync/references.ts
  - src/core/task/artifacts.ts
  - src/core/timeline/hooks.ts
related_documents:
  - docs/knowledge/平台上报.md
  - docs/knowledge/开发任务浏览.md
created: 2026-10-16
updated: 2026-10-16
---

# Bash 事件 cwd 是执行后的目录

## Summary

同一条 Bash 工具调用,timeline 记下的两条事件 cwd 不同:pre_tool_use 记执行前的目录,post_tool_use 记执行后的目录。命令里有 `cd` 时,这两个值就不相等。按"post 事件的 cwd + cd 目标"去解析命令里的相对路径,会把目录多拼一层(如 `docs/knowledge/docs/knowledge/x.md`),导致参考推断漏识别。从命令文本推断读取路径时,须先按"cwd + cd 目录"解析,找不到再退回事件自身的 cwd;或者改用 pre 事件的 cwd。

## Context

2026-10-16 实现平台上报的参考推断时发现:会话里用 `cd docs/knowledge; for f in 开发任务.md …; do sed …; done` 读了 5 篇知识库,按 cd 前缀规则一篇都没识别出来。

## Findings

- 实测(Claude Code desktop,2026-10-16):命令 `cd docs/knowledge; …` 的 pre_tool_use 事件 cwd 为项目根,post_tool_use 事件 cwd 为 `<项目根>/docs/knowledge`。
- 宿主的 Bash 会话保留了 cd 之后的工作目录,hook payload 的 `cwd` 取的是 hook 触发那一刻的值,所以 post 事件拿到的是 cd 之后的目录。
- 平台上报的推断只看 post_tool_use 事件,所以先按"cwd + cd 目录"解析,失败后退回 e.cwd。改完后 5 篇知识库都能识别出来。

## Evidence

- 事件对:同一会话中相邻的 pre / post 两条 Bash 事件,`tool_args.command` 相同,`cwd` 分别是项目根和 `docs/knowledge`。
- 修复:`src/core/sync/references.ts`(Bash 命令的候选基准目录依次为"cwd + cd 目录"、cwd)。

## Impact For Future Changes

- 任何从 timeline 命令文本里解析相对路径的逻辑,都要考虑 cwd 可能是执行后的目录。本地 web 的 `src/core/task/artifacts.ts` 推断参考时按项目根解析相对路径,cd 进子目录后读取的文件同样会漏掉;本次没改它,本地 web 保持不变。
- 后续 cd 会持续生效:同一会话里,cd 之后的每一条事件 cwd 都是子目录。按项目根解析相对路径的逻辑,对这些事件全部失效。

## Reuse Guidance

排查"任务参考 / 产出漏了文件""推断出的路径多了一层目录"时,先读这里。修改 timeline hook 的 cwd 取值,或者修改基于命令文本的推断逻辑之前,也先读这里。

## Open Questions

- CodeBuddy 的 post 事件 cwd 是不是同样取执行后的目录,还没有实测。
