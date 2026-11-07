---
title: 测试用临时 HOME
document_type: lesson
domains:
  - 开发时间线
concepts:
  - 测试临时 HOME
aliases:
  - setup-home
  - 临时 HOME
  - 临时家目录
tags:
  - vitest
  - 隐式约束
  - git
status: active
source_type: work_context
owners:
  - liulongfei
related_code:
  - __tests__/setup-home.ts
  - vitest.config.ts
  - src/core/data-location.ts
related_documents:
  - docs/knowledge/项目.md
  - docs/knowledge/并旧数据.md
created: 2026-11-05
updated: 2026-11-05
---

# 测试用临时 HOME

## Summary

数据按项目放到用户目录(`~/.cgraphx/`)以后,cgraphx 的测试一律用临时 HOME:vitest 的 `setupFiles` 给每个测试文件换一个临时家目录,以免测试数据写进真实的 `~/.cgraphx/projects/`。由此带来三个坑:
- 临时 HOME 下读不到全局 `~/.gitconfig`,测试里做 git 提交要自己设用户身份和分支名。
- 想让数据位置落在本地 `.cgraphx/`,本地库里得有 timeline、task 或 sync 的表(旧库模式)。
- 端到端验证要在临时 HOME 下用 bash 跑,不能在真实目录里跑新版的 install、hook、project 命令。

## Context

需求「数据按项目放用户目录」(2026-11-05)把 timeline、task、sync 的库和会话登记搬到了用户目录。实现期间改测试夹具、跑统一验证时,接连踩到下面几件事。

## Findings

- `__tests__/setup-home.ts` 每个测试文件跑一次,同时改掉 `HOME` 和 `USERPROFILE`(Windows 上 `os.homedir()` 读的是后者);测试派生出来的子进程继承这两个变量。自己改 HOME 的测试,照旧在自己的用例里覆盖。
- 临时 HOME 下没有全局 git 配置,用户身份、`init.defaultBranch` 都没了:测试里做提交要设 `GIT_AUTHOR_*`、`GIT_COMMITTER_*`(或 `-c user.name=…`),建仓库要带 `-b main`。
- 测试项目只建 `.cgraphx/` 目录,不算装过,数据位置是 null。要让数据落在本地,得建出 `.cgraphx/cgraphx.db`,而且库里至少有一张 `timeline_*`、`task_*` 或 `sync_*` 表。只有库、没有这几类表时,走项目库模式,数据会落到临时 HOME 下的 `~/.cgraphx/projects/`。
- 端到端脚本里的 `$OLD`、`$NEW` 写成 `node <路径>` 这种带空格的字符串时,zsh 不会按空格拆开,整串会被当成一个命令名(退出码 127),所以要用 bash 跑。
- 本仓库是需求副本:在真实 HOME 下跑 dist 的 `install`、hook、`project` 命令,会把真实数据迁进 `~/.cgraphx/`。

## Evidence

- `vitest.config.ts` 的 `setupFiles: ['__tests__/setup-home.ts']`。
- `src/core/data-location.ts` 的 `hasLegacyTables`:旧库模式要看本地库里有没有这几类表。
- 统一验证的端到端脚本:`docs/features/2026-11-05-数据按项目放用户目录/plan/数据按项目放用户目录-index.md` 的「统一验证」节。

## Impact For Future Changes

- 新写测试、改测试夹具时,先想清楚这个测试要的数据位置是本地(旧库模式)还是项目目录,再照上面的条件建夹具。
- 不要为了让测试通过去改 `setup-home.ts`,或者让测试读真实 HOME。

## Reuse Guidance

- 写或修 cgraphx 的单元测试(`/unit-code`)、跑统一验证和端到端验证时参考本条。
- 测试里出现「数据位置为 null」「认不出项目」「提交失败:没有身份」这类报错时,先对照本条。
