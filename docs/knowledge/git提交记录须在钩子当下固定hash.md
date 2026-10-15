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
tags:
  - timeline
  - git
  - 隐式约束
status: active
source_type: debugging
owners:
  - liulongfei
related_code:
  - src/core/timeline/installer.ts
  - src/core/timeline/hooks.ts
  - src/core/timeline/constants.ts
related_documents:
  - docs/knowledge/会话id来源约束.md
  - docs/knowledge/开发任务浏览.md
  - docs/code-map/flows/开发时间线记录.md
created: 2026-10-15
updated: 2026-10-15
---

# git 提交记录须在钩子当下固定 hash

## Summary

timeline 的 git 提交记录(git_commit 事件)由 post-commit 钩子在后台启动记录进程。后台进程有启动延迟,若它自己去读当时的 HEAD,连续快速提交(`git commit && git commit`)时前面的提交全部丢失,最后一个被记录多次——又称连续提交丢记录。规则:提交的 hash 和分支必须由钩子脚本在提交当下同步取得,经环境变量 `CGRAPHX_COMMIT_SHA` / `CGRAPHX_COMMIT_BRANCH` 交给记录进程。用环境变量而不用位置参数,是为了让旧版 cgraphx 二进制忽略它们、照旧工作。

## Context

2026-10-15 查 web 开发任务页的产出时发现:一次 `&&` 连续三次提交,timeline 记成同一个 hash 三条;历史数据里 `2a644c7`、`b3f7ec4` 也各重复两次,说明同类丢失早已发生。依赖 commit 文件清单的任务产出因此缺了这些提交的文件。

## Findings

- 钩子脚本原来是 `cgraphx timeline-git-commit-hook … &`,记录进程启动后才读 HEAD;等它读到时 HEAD 可能已前移,分支也可能已切换(如 `git commit && git checkout main`)。
- 不能改成位置参数:旧版命令没有声明参数,commander 对多余参数报 `too many arguments` 并以退出码 1 退出,输出被钩子丢弃——新脚本配旧版全局 cgraphx 会导致每次提交静默失败。
- `cgraphx install` 原来见到钩子标记就跳过,已安装项目重装也拿不到新脚本;现在会原地替换带标记的行,保留用户自己的钩子内容。
- 已丢失的提交无法回填(拿不到当时的会话 id);已有的重复记录未清理。

## Evidence

- 钩子片段与升级:`src/core/timeline/installer.ts`(`buildGitPostCommitSnippet`、`stripTimelineGitHook`)。
- 按固定 hash 读提交:`src/core/timeline/hooks.ts`(`gitCommitHook`、`readGitCommitInfo`;hash 只接受十六进制,否则退回 HEAD)。
- 变量名唯一定义:`src/core/timeline/constants.ts`(`COMMIT_SHA_ENV`、`COMMIT_BRANCH_ENV`)。
- 修复提交 `e61ea15`。

## Impact For Future Changes

- 任何由 git 钩子或其它宿主触发、在后台运行的记录逻辑,都要在触发当下把易变状态(HEAD、分支、工作区)取好再交出去,不要在后台进程里读。
- 给钩子调用的隐藏子命令加输入时,优先用环境变量;位置参数会让旧版二进制直接报错。
- 改钩子脚本内容时,确认 install 的升级路径能覆盖已安装项目。

## Reuse Guidance

排查「commit 没记录 / 同一 commit 记了多次 / 分支记错」、或修改 post-commit 钩子与 `timeline-git-commit-hook` 时先读这里。

## Open Questions

- git_commit 事件的 `ts` 是写库时间不是提交时间,连续提交的写库顺序可能与提交顺序不同;是否另存提交时间未定。
- 合并提交不触发 post-commit,目前不记录;是否接入 post-merge 未定。
