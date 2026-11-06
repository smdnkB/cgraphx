---
title: git 提交记录须在钩子当下固定 hash
document_type: lesson
domains:
  - 开发时间线
concepts:
  - git 提交记录
  - 开发时间线
aliases:
  - git_commit 事件
  - post-commit 钩子
  - 连续提交丢记录
  - CGRAPHX_COMMIT_SHA
  - CGRAPHX_GATE_TREE
  - commit-gate-pass
tags:
  - timeline
  - commit-gate
  - git
  - 隐式约束
status: active
source_type: debugging
owners:
  - liulongfei
related_code:
  - src/core/timeline/installer.ts
  - src/core/timeline/git-commit.ts
  - src/core/timeline/constants.ts
  - src/core/commit-gate/gate.ts
related_documents:
  - docs/knowledge/会话id来源约束.md
  - docs/knowledge/开发时间线工具事件契约.md
  - docs/code-map/flows/开发时间线记录.md
created: 2026-10-15
updated: 2026-11-06
---

# git 提交记录须在钩子当下固定 hash

## Summary

timeline 的 git 提交记录(git_commit 事件)由 post-commit 钩子在后台启动记录进程。后台进程有启动延迟,若它自己去读当时的 HEAD,连续快速提交(`git commit && git commit`)时前面的提交全部丢失,最后一个被记录多次——又称连续提交丢记录。规则:提交的 hash 和分支必须由钩子脚本在提交当下同步取得,经环境变量 `CGRAPHX_COMMIT_SHA` / `CGRAPHX_COMMIT_BRANCH` 交给记录进程。用环境变量而不用位置参数,是为了让旧版 cgraphx 二进制忽略它们、照旧工作。

**门禁记号同理**(2026-11-06 起,提交门禁搬进 commit-msg 钩子后新增):commit-msg 门禁只要没打回,就把 `git write-tree` 的输出写进 `<git 目录>/cgraphx/commit-gate-pass`;post-commit 片段在**前台**读出并删掉这个记号,经 `CGRAPHX_GATE_TREE` 传给后台记录进程——后台进程启动有延迟,自己去读时记号已被下一笔提交覆盖,和读 HEAD 是同一个坑。后台拿这笔提交的 tree 与记号内容对不上等六条判「跳过门禁」(agent `--no-verify` 绕过了门禁),给这条提交标 `metadata.gate = 'skipped'`。

## Context

2026-10-15 查 web 开发任务页的产出时发现:一次 `&&` 连续三次提交,timeline 记成同一个 hash 三条;历史数据里 `2a644c7`、`b3f7ec4` 也各重复两次,说明同类丢失早已发生。依赖 commit 文件清单的任务产出因此缺了这些提交的文件。

## Findings

- 钩子脚本原来是 `cgraphx timeline-git-commit-hook … &`,记录进程启动后才读 HEAD;等它读到时 HEAD 可能已前移,分支也可能已切换(如 `git commit && git checkout main`)。
- 不能改成位置参数:旧版命令没有声明参数,commander 对多余参数报 `too many arguments` 并以退出码 1 退出,输出被钩子丢弃——新脚本配旧版全局 cgraphx 会导致每次提交静默失败。
- `cgraphx install` 原来见到钩子标记就跳过,已安装项目重装也拿不到新脚本;现在会原地替换带标记的行,保留用户自己的钩子内容。
- 门禁记号链路:commit-msg 门禁没打回就写记号(`git write-tree` 只写对象不动索引)→ post-commit 片段前台读删记号、判断 cherry-pick / rebase 是否在进行(`CGRAPHX_CHERRY_PICK` / `CGRAPHX_REBASE`),一并传给后台 → 后台判「这笔提交的 tree 与记号对不上」等六条,成立才标 `metadata.gate='skipped'`(附加信息,任何一步读不出就不标)。
- 已丢失的提交无法回填(拿不到当时的会话 id);已有的重复记录未清理。

## Evidence

- 钩子片段与升级:`src/core/timeline/installer.ts`(提交记录片段;门禁上下文的前台取值——读删 `commit-gate-pass`、判 cherry-pick / rebase)。
- 按固定 hash 读提交:`src/core/timeline/git-commit.ts`(`gitCommitHook`、`readGitCommitInfo`;hash 只接受十六进制,否则退回 HEAD;`isGateSkipped` 判跳过门禁的六条)。
- 变量名唯一定义:`src/core/timeline/constants.ts`(`COMMIT_SHA_ENV`、`COMMIT_BRANCH_ENV`、`GATE_TREE_ENV`、`CHERRY_PICK_ENV`、`REBASE_ENV`)。
- 记号的写入:`src/core/commit-gate/gate.ts`(`writePassMark`,写 `<git 目录>/cgraphx/commit-gate-pass`)。
- 修复提交 `e61ea15`。

## Impact For Future Changes

- 任何由 git 钩子或其它宿主触发、在后台运行的记录逻辑,都要在触发当下把易变状态(HEAD、分支、工作区、门禁记号)取好再交出去,不要在后台进程里读。
- 给钩子调用的隐藏子命令加输入时,优先用环境变量;位置参数会让旧版二进制直接报错。
- 改钩子脚本内容时,确认 install 的升级路径能覆盖已安装项目。
- 门禁记号是前台读删的,不是后台读:想改「读删」的时机,先想连续提交时记号被覆盖的窗口。

## Reuse Guidance

排查「commit 没记录 / 同一 commit 记了多次 / 分支记错 / 跳过门禁的提交没标出来」、或修改 post-commit 钩子、`timeline-git-commit-hook` 与 `commit-gate-hook` 时先读这里。

## Open Questions

- git_commit 事件的 `ts` 是写库时间不是提交时间,连续提交的写库顺序可能与提交顺序不同;是否另存提交时间未定。
- 合并提交不触发 post-commit,目前不记录;是否接入 post-merge 未定。
