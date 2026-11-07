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
  - ingest
  - claude-code
  - 隐式约束
status: active
source_type: debugging
owners:
  - liulongfei
related_code:
  - src/core/timeline/ingest/types.ts
  - src/core/timeline/ingest/ingest.ts
related_documents:
  - docs/knowledge/开发时间线工具事件契约.md
created: 2026-10-16
updated: 2026-11-06
---

# Bash 事件 cwd 是执行后的目录

## Summary

**hook 时代的坑**:同一条 Bash 工具调用,timeline 记下的两条事件 cwd 不同——pre_tool_use 记执行前的目录,post_tool_use 记执行后的目录。命令里有 `cd` 时这两个值不相等;按"post 事件的 cwd + cd 目标"去解析命令里的相对路径,会把目录多拼一层(如 `docs/knowledge/docs/knowledge/x.md`),导致参考推断漏识别。

**会话文件解析的新数据没有这个坑**:工具事件的 `cwd` 取调用行的 cwd(执行前的目录,spec 2026-11-06-会话文件解析替代hooks D7),而且只有一条 post_tool_use、没有 pre。从命令文本解析相对路径时,新数据直接用事件的 cwd 即可。

旧数据(hook 记的、升级重建后已清掉,或还没重建的旧库)行为照旧,对它做命令文本推断仍要考虑「cwd 可能是执行后的目录」。

## Context

2026-10-16 实现平台上报的参考推断时发现:会话里用 `cd docs/knowledge; for f in 开发任务.md …; do sed …; done` 读了 5 篇知识库,按 cd 前缀规则一篇都没识别出来。当时的修法是先按"cwd + cd 目录"解析、失败后退回事件自身的 cwd。

## Findings

- 实测(Claude Code desktop,2026-10-16):命令 `cd docs/knowledge; …` 的 pre_tool_use 事件 cwd 为项目根,post_tool_use 事件 cwd 为 `<项目根>/docs/knowledge`。
- 成因:宿主的 Bash 会话保留了 cd 之后的工作目录,hook payload 的 `cwd` 取的是 hook 触发那一刻的值,所以 post 事件(命令跑完后触发)拿到的是 cd 之后的目录。
- 解析侧的口径(2026-11-06 起):`SessionFact.tool.cwd` 明确取**调用行**的 cwd、不取结果行(`src/core/timeline/ingest/types.ts`);`mapFacts` 里 `cwd: fact.cwd ?? startCwd`。会话文件几乎每行都带 cwd,调用行即执行前的目录。
- 平台上报的参考推断已随平台上报下掉(见 `docs/features/2026-11-05-下掉web与平台同步/`);这个坑当时修过的地方已不在,记录保留给同类推断。

## Evidence

- 事件对:同一会话中相邻的 pre / post 两条 Bash 事件,`tool_args.command` 相同,`cwd` 分别是项目根和 `docs/knowledge`(hook 时代数据)。
- 解析侧口径:`src/core/timeline/ingest/types.ts`(`ToolFact.cwd` 的注释「D7:cwd 取调用行,不取结果行」)、`src/core/timeline/ingest/ingest.ts`(`mapFacts` 的 `cwd` 取值)。

## Impact For Future Changes

- hook 时代的旧数据仍在用时,任何从 timeline 命令文本里解析相对路径的逻辑,都要考虑 cwd 可能是执行后的目录。
- 新数据(会话文件解析)不用考虑:cwd 恒为调用行(执行前)的目录。
- 修改读取器的 cwd 取值之前先读这里:改回取结果行会把 cd 之后的状态带进事件。

## Reuse Guidance

排查"推断出的路径多了一层目录"之类的问题时,先读这里。修改基于命令文本的推断逻辑之前,也先读这里。

## Open Questions

- hook 时代 CodeBuddy 的 post 事件 cwd 是不是同样取执行后的目录,没有实测过(该数据面已随重建退役,不再追)。
