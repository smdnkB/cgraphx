---
title: 会话 id 来源约束
document_type: rule
domains:
  - 开发时间线
concepts:
  - 会话 id 来源
aliases:
  - CLAUDE_CODE_SESSION_ID
  - session_id
  - 会话 id
tags:
  - task
  - timeline
  - claude-code
  - 隐式约束
status: active
source_type: work_context
owners:
  - liulongfei
related_code:
  - src/core/timeline/constants.ts
  - src/core/timeline/hooks.ts
  - src/core/task/binding.ts
  - src/core/task/hooks.ts
related_documents:
  - docs/knowledge/开发任务绑定.md
  - docs/knowledge/git提交记录须在钩子当下固定hash.md
created: 2026-10-14
updated: 2026-10-15
---

# 会话 id 来源约束

## Summary

cgraphx 拿 Claude Code 的会话 id(session_id)有两条路:hook 进程从 stdin 的 payload 里拿,这有文档保证;普通 CLI 进程(`cgraphx task use`)和 git post-commit 钩子只能读宿主注入给 Bash 子进程的环境变量 `CLAUDE_CODE_SESSION_ID`,这个变量**没有官方文档保证**。依赖这个环境变量的地方都必须有降级路径:拿不到时显式报错让用户传 `--session`,或者记为未归属,绝不猜测。

## Context

开发任务绑定需要在 agent 执行的 CLI 命令里知道「当前是哪个会话」,commit 归属需要在 git 钩子里知道同一件事,而这两类进程都没有 hook 的 stdin payload。

## Findings

- 2026-10-14 在 desktop 版 Claude Code(2.1.295)里实测:Bash 子进程环境里有 `CLAUDE_CODE_SESSION_ID`,值等于 hook payload 里的 session_id。agent 在会话内执行 `git commit` 时,post-commit 钩子(即使在后台运行)也能继承到它。
- 用户在自己的终端里运行命令或 commit 时没有这个变量。
- 依赖这个变量的地方:`cgraphx task` 的会话判定(`--session` 优先,其次读环境变量)、git_commit 事件的 session_id。

## Evidence

- 变量名只在一处定义:`src/core/timeline/constants.ts` 的 `CLAUDE_SESSION_ID_ENV`,经 timeline 门面导出,task 从门面取。
- 读取点:`src/core/timeline/hooks.ts`(`gitCommitHook`)、`src/core/task/binding.ts`(`resolveSessionId`)。

## Impact For Future Changes

- 新功能要在非 hook 进程里拿会话 id 时,复用 `CLAUDE_SESSION_ID_ENV` 和 `resolveSessionId`,不要另写变量名。
- 降级方案已经做进去了:会话开始的 task hook 总会把当前会话 id 写进给 agent 的上下文(不论是否绑定),agent 读不到环境变量时可以用 `--session` 传入。改动这段注入文案时,不要删掉会话 id。
- 如果宿主改名或取消这个变量:绑定命令会退出码 3 并提示 `--session`,commit 会全部变成未归属。功能退化,但不会出错数据。

## Reuse Guidance

排查「commit 没归属到任务」「task use 报无法确定当前会话」时先看这里;升级 Claude Code 后,用 `echo $CLAUDE_CODE_SESSION_ID` 复核变量是否还在。

## Open Questions

- `claude --resume` 恢复会话后,session_id 和这个环境变量是否沿用原值,还没有实测。
