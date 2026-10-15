---
title: 会话 id 来源约束
document_type: rule
domains:
  - 开发时间线
concepts:
  - 会话 id 来源
aliases:
  - CLAUDE_CODE_SESSION_ID
  - CODEBUDDY_SESSION_ID
  - session_id
  - 会话 id
tags:
  - task
  - timeline
  - claude-code
  - codebuddy
  - 隐式约束
status: active
source_type: work_context
owners:
  - liulongfei
related_code:
  - src/core/agents/profiles.ts
  - src/core/agents/index.ts
  - src/core/timeline/hooks.ts
  - src/core/task/binding.ts
  - src/core/task/hooks.ts
related_documents:
  - docs/knowledge/开发任务绑定.md
  - docs/knowledge/git提交记录须在钩子当下固定hash.md
  - docs/knowledge/agent适配.md
created: 2026-10-14
updated: 2026-10-15
---

# 会话 id 来源约束

## Summary

cgraphx 获取 agent 会话 id(session_id)有两条路。

- **hook 进程**:从 stdin 的 payload 里读,这条路有文档保证。
- **普通 CLI 进程和 git post-commit 钩子**:比如 `cgraphx task use`,只能读宿主注入给 Bash 子进程的环境变量。
  - Claude Code 注入 `CLAUDE_CODE_SESSION_ID`,CodeBuddy 注入 `CODEBUDDY_SESSION_ID`。
  - 两者都是实测得出的,**没有官方文档保证**。

依赖环境变量的地方都必须有降级路径:拿不到时显式报错,让用户传 `--session`,或者记为未归属,绝不猜测。

两个 agent 嵌套启动时,两个变量会同时存在,这时按 agent 登记顺序取 Claude Code 的变量。

## Context

开发任务绑定需要在 agent 执行的 CLI 命令里知道「当前是哪个会话」,commit 归属需要在 git 钩子里知道同一件事,而这两类进程都没有 hook 的 stdin payload。

## Findings

- 2026-10-14 在 desktop 版 Claude Code(2.1.295)里实测:
  - Bash 子进程环境里有 `CLAUDE_CODE_SESSION_ID`,值等于 hook payload 里的 session_id。
  - agent 在会话内执行 `git commit` 时,post-commit 钩子能继承到这个变量,即使钩子在后台运行。
- 2026-10-15 在 CodeBuddy 2.167.0 里实测:
  - Bash 子进程环境里有 `CODEBUDDY_SESSION_ID`,值等于 hook payload 里的 session_id。
  - CodeBuddy 还会把 `CLAUDE_SESSION_ID` 设成同一个值。注意它不是 `CLAUDE_CODE_SESSION_ID`,cgraphx 不读它。
  - CodeBuddy 会话里的 commit 能正确归属到该会话。
- 用户在自己的终端里运行命令或 commit 时,两个变量都没有。
- 在 Claude Code 会话的 Bash 里启动 CodeBuddy 时,CodeBuddy 会继承 Claude 的 `CLAUDE_CODE_SESSION_ID`,这时两个变量同时存在。
- 依赖这些变量的地方有两处:
  - `cgraphx task` 的会话判定:`--session` 优先,其次读环境变量。
  - git_commit 事件的 session_id 和来源 agent。

## Evidence

- 每个 agent 的会话变量名只在 `src/core/agents/profiles.ts` 的 agent 描述里定义,字段是 `sessionIdEnv`。
- 统一读取入口是 agents 门面的 `resolveSessionIdFromEnv`,它按登记顺序取第一个非空值,同时返回所属 agent。
- 读取点:`src/core/timeline/hooks.ts`(`gitCommitHook`)、`src/core/task/binding.ts`(`resolveSessionId`)。
- 2026-10-15 之前,变量名定义在 timeline 的 `CLAUDE_SESSION_ID_ENV`。多 agent 适配时删除了这个常量,统一改由 agents 描述提供。

## Impact For Future Changes

- 新功能要在非 hook 进程里拿会话 id 时,复用 agents 门面的 `resolveSessionIdFromEnv` 和 task 的 `resolveSessionId`,不要另写变量名。
- 接入新 agent 时,先实测它是否向 Bash 子进程注入会话变量,再写进描述的 `sessionIdEnv`。没有这类变量时,该 agent 的 `task use` 和 commit 归属会退化,需要另定方案。
- 降级方案已经做进去了:会话开始时,task hook 总会把当前会话 id 写进给 agent 的上下文,不论是否绑定。agent 读不到环境变量时,可以用 `--session` 传入。改动这段注入文案时,不要删掉会话 id。
- 如果宿主改名或取消这个变量:绑定命令会以退出码 3 退出并提示 `--session`,commit 会全部变成未归属。功能退化,但不会写出错误数据。
- agent 的 Bash 会加载用户的 shell 配置,PATH 里排在前面的是全局安装的 `cgraphx`。所以新读取逻辑要等全局 cgraphx 升级后,才会在 agent 会话里生效。

## Reuse Guidance

排查「commit 没归属到任务」「task use 报无法确定当前会话」时先看这里。

升级 Claude Code 或 CodeBuddy 后,在对应 agent 的会话里执行 `env | grep -i session`,复核变量是否还在。

## Open Questions

- `claude --resume` 恢复会话后,session_id 和这个环境变量是否沿用原值,还没有实测。CodeBuddy 的 `--resume` 同样没有实测。
- 两个 agent 嵌套启动时按登记顺序取值,会取到外层 Claude Code 的会话。如果以后需要正确识别内层 agent,要另找判别依据。
