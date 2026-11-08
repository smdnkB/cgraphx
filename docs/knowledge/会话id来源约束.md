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
  - DSH_SESSION_ID
  - session_id
  - 会话 id
tags:
  - timeline
  - ingest
  - commit-gate
  - claude-code
  - codebuddy
  - deepseek
  - 隐式约束
status: active
source_type: work_context
owners:
  - liulongfei
related_code:
  - src/core/agents/profiles.ts
  - src/core/agents/index.ts
  - src/core/timeline/ingest/types.ts
  - src/core/timeline/git-commit.ts
  - src/core/session-notices.ts
  - src/core/commit-gate/gate.ts
related_documents:
  - docs/knowledge/开发时间线工具事件契约.md
  - docs/knowledge/git提交记录须在钩子当下固定hash.md
  - docs/knowledge/agent适配.md
created: 2026-10-14
updated: 2026-11-08
---

# 会话 id 来源约束

## Summary

cgraphx 获取 agent 会话 id(session_id)的来源,2026-11-06 起**主力是会话文件行内**:每行自带 sessionId,解析补录的事件(提问、工具、轮次结束、会话开始)全部用它,分叉文件开头拷来的旧会话行也归原会话,不再依赖 hook payload(hook 体系已删)。

**会话环境变量**(宿主注入给 Bash 子进程的 `CLAUDE_CODE_SESSION_ID` / `CODEBUDDY_SESSION_ID`,实测得出、**没有官方文档保证**)还在三处用:

- git post-commit 钩子:提交的会话归属(`git_commit` 的 session_id 与来源 agent;终端手动提交没有,记为未归属);
- commit-msg 门禁片段:判断「是不是 agent 提交」——一个会话变量都没有就不起 node(人手动提交不等约 90ms),判定「跳过门禁」也要先认得出会话;
- 会话提示的频控 scope:有会话变量按 `session:<会话编号>`(每会话一次),没有按 `day:<项目根>:<本地日期>`(每项目每天一次)。

依赖环境变量的地方都必须有降级路径:拿不到时记为未归属或退到 day scope,绝不猜测。

两个 agent 嵌套启动时,两个变量会同时存在,这时按 agent 登记顺序取 Claude Code 的变量。

会话变量名单只来自 agent 描述的 `sessionIdEnv`,只读会话来源(DeepSeek)不在里面:DeepSeek 注入的 `DSH_SESSION_ID` 没被认出,它的提交当成人手动提交——不过门禁、不归属会话(2026-11-08 查明)。

## Context

hook 时代,普通 CLI 进程和 git 钩子没有 stdin payload,只能读宿主注入的环境变量;时间线事件则由 hook 从 payload 拿。hook 退役后,事件侧的会话 id 改从会话文件行内取(补录解析),环境变量只剩提交归属、门禁与提示三处消费方。

## Findings

- 2026-10-14 在 desktop 版 Claude Code(2.1.295)里实测:
  - Bash 子进程环境里有 `CLAUDE_CODE_SESSION_ID`,值等于会话文件行内的 session_id。
  - agent 在会话内执行 `git commit` 时,post-commit 钩子能继承到这个变量,即使钩子在后台运行。
- 2026-10-15 在 CodeBuddy 2.167.0 里实测:
  - Bash 子进程环境里有 `CODEBUDDY_SESSION_ID`,值等于会话文件行内的 session_id(注意:子 agent 文件行内是**独立子会话编号**,与主会话不同;时间线按文件布局把子 agent 事实归主会话,见「开发时间线工具事件契约」)。
  - CodeBuddy 还会把 `CLAUDE_SESSION_ID` 设成同一个值。注意它不是 `CLAUDE_CODE_SESSION_ID`,cgraphx 不读它。
- 2026-11-08 查明(读 DeepSeek Harness 源码,未实测取值):DeepSeek 的每次 shell 调用都带 `DSH_SESSION_ID`(它的 `shell-env` 包把它列为保留的内置变量)。2.0.15 里 DeepSeek 在副本里自己跑了 8 次 `git commit`,提交记录全是未归属、没过门禁。值和会话文件编号(`session-…`)是否一致还没核对。
- 用户在自己的终端里运行命令或 commit 时,两个变量都没有。
- 在 Claude Code 会话的 Bash 里启动 CodeBuddy 时,CodeBuddy 会继承 Claude 的 `CLAUDE_CODE_SESSION_ID`,这时两个变量同时存在。
- 补录侧的归属不用会话 id:会话文件按 start_cwd(开始目录)认项目,认过缓存在 `~/.cgraphx/sessions.db` 的 `start_dirs`,与 session_id 无关。

## Evidence

- 每个 agent 的会话变量名只在 `src/core/agents/profiles.ts` 的 agent 描述里定义,字段是 `sessionIdEnv`。
- 统一读取入口是 agents 门面的 `resolveSessionIdFromEnv`,它按登记顺序取第一个非空值,同时返回所属 agent。
- 读取点:`src/core/timeline/git-commit.ts`(提交归属与「跳过门禁」判定)、`src/core/session-notices.ts`(提示 scope)、`src/core/commit-gate/gate.ts`(门禁片段的会话变量名单,来自各 agent 描述的 `sessionIdEnv`)。
- 事件侧:`src/core/timeline/ingest/types.ts`——每条事实都带 sessionId(行内自带)。

## Impact For Future Changes

- 新功能要在非 hook 进程里拿会话 id 时,复用 agents 门面的 `resolveSessionIdFromEnv`,不要另写变量名。
- 接入新 agent 时,先实测它是否向 Bash 子进程注入会话变量,再写进描述的 `sessionIdEnv`。没有这类变量时,该 agent 的 commit 归属会退化、门禁片段不会为它起 node,需要另定方案。
- 如果宿主改名或取消这个变量:commit 变成未归属、门禁判不了「跳过」、提示退到按天。功能退化,但不会写出错误数据。
- agent 的 Bash 会加载用户的 shell 配置,PATH 里排在前面的是全局安装的 `cgraphx`。所以新读取逻辑要等全局 cgraphx 升级后,才会在 agent 会话里生效。

## Reuse Guidance

排查「commit 没归属到会话」「门禁没拦住 agent 提交」「提示每条命令都重复出」时先看这里。

升级 Claude Code 或 CodeBuddy 后,在对应 agent 的会话里执行 `env | grep -i session`,复核变量是否还在。

## Open Questions

- `claude --resume` 恢复会话后,session_id 和这个环境变量是否沿用原值,还没有实测。CodeBuddy 的 `--resume` 同样没有实测。
- 两个 agent 嵌套启动时按登记顺序取值,会取到外层 Claude Code 的会话。如果以后需要正确识别内层 agent,要另找判别依据。
- `DSH_SESSION_ID` 的值和 DeepSeek 会话文件编号是否同一写法,接进门禁前要实测。
