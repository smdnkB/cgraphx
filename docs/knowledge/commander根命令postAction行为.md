---
title: commander 根命令 postAction 行为
document_type: mechanism
domains:
  - CLI
concepts:
  - commander postAction
aliases:
  - program.hook
  - 会话提示挂点
  - commander v14
  - 静态命令名单
tags:
  - cli
  - commander
  - session-notices
  - 隐式约束
status: active
source_type: work_context
owners:
  - liulongfei
related_code:
  - src/cli/index.ts
  - src/core/session-notices.ts
related_documents:
  - docs/knowledge/git提交记录须在钩子当下固定hash.md
created: 2026-11-06
updated: 2026-11-06
---

# commander 根命令 postAction 行为

## Summary

commander v14 在根命令上注册 `program.hook('postAction', fn)` 的三个非显而易见行为,会话提示(cgraphx 的统一挂点)依赖它们:(1) root 上的 hook 按祖先链在 action 时收集,先于 root 注册的子命令同样生效——不用为每个子系统命令补挂;(2) `help` / `--help` / `--version` 走 `--version` 与 help 命令的旁路分发,不进 action 链,天然不会触发 postAction;(3) `Command` 没有公开的 hidden 访问器(只有内部 `_hidden`),要区分「隐藏命令不算一条」只能维护静态命令名名单。

## Context

2026-11-06-会话文件解析替代hooks 的 T-7 把会话开始的提示改由命令输出:每条 cgraphx 命令 action 完成后,根命令的 postAction 挂点统一调 `emitSessionNotices`(stderr、每会话/每日一次)。挂哪个钩子、怎么排除隐藏命令,当时读 commander v14 源码核实过这三个行为。

## Findings

- **祖先链收集**:commander 的 action 分发在执行 command action 前后按 root → 子命令的祖先链收集 pre/postAction 钩子,root 上注册的一份对**先注册**的子命令同样生效(挂点位置不必在命令注册之后,但惯例仍放注册后)。
- **help 旁路**:`help` 子命令与 `--help`、`--version` 不走常规 action 链(内部 `_dispatchHelpCommand` / 版本参数旁路),postAction 不触发——「`--help`、`--version` 不算一条提示」不需要在名单里维护。
- **无公开 hidden 访问器**:`Command` 的 hidden 状态只在内部 `_hidden` 字段(help 输出才读);要判断「当前命令是不是隐藏命令」只能用静态命令名名单(见 `src/core/session-notices.ts` / `src/cli/index.ts` 的名单),新增隐藏命令(git 钩子调起的那类)要记得进名单。

## Evidence

- 挂点与静态名单:`src/cli/index.ts`(根命令 postAction)、`src/core/session-notices.ts`(名单与「不算一条」口径)。
- commander v14 源码:`command.js` 的 action 分发与 `help.js` 的 help 旁路分发。

## Impact For Future Changes

- 新增**隐藏子命令**(尤其 git 钩子/宿主调起的)时,把命令名补进会话提示的静态名单,否则钩子进程跑一条命令也会记一次提示 scope。
- 新增顶层命令不需要挂自己的 postAction——root 那份自动覆盖。
- 升级 commander 大版本时,这三个行为属于其内部实现,`help`/hidden 语义可能变,回归点:同一会话第二条命令不再提示、`--json` 命令的 stdout 不混入提示。

## Reuse Guidance

再往 CLI 入口加「每条命令之后」的横切行为(提示、遥测、计次)时用;排查「提示为什么没出 / 多出了一条」时先看名单与挂点。
