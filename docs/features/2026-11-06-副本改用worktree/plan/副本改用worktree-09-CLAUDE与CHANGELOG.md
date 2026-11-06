# T-9: 本仓库 CLAUDE.md 与 CHANGELOG

> 产物: plan
> 依据: spec@e839c10

- 目标:仓库说明里的副本改成 worktree 口径;CHANGELOG 记这次变更与破坏性(旧版写时复制副本要在升级前清掉)。
- 对应 spec 编号:spec「文档」表「本仓库 `CLAUDE.md`、`CHANGELOG.md`」;迁移与兼容
- 强制引用:无(文档任务)
- 涉及范围:`CLAUDE.md`、`CHANGELOG.md`(两个文件,与其它任务不重叠)

## 必须严格执行

- `CLAUDE.md` 不再说副本是「写时复制」;补上 worktree、只带配置与清单、依赖不带的说法。
- `CHANGELOG.md` 在 `## Unreleased` 最前面加一节 `### Changed — replicas are git worktrees`,用英文(与现有 Unreleased 各节一致);写清破坏性:`--full-copy` 与 `no_cow`/`dirty_main` 没了、旧版写时复制副本不兼容、升级前用旧版本清掉。
- 历史 CHANGELOG 条目一字不动。

## 允许局部适配

- CHANGELOG 的句子组织与用词(保持现有英文风格即可);`CLAUDE.md` 的中文措辞。
- 可以只改与本需求直接相关的两句,不重写整个「架构」段。

## 具体要求

### A. `CLAUDE.md`

1. 「产品全貌」里的需求主线(第 26 行):
   `每个需求 `/dev-start` 开写时复制副本 `<主目录名>@<文件前缀>`、在副本里做`
   改成
   `每个需求 `/dev-start` 开 worktree 副本 `<主目录名>@<文件前缀>`(只带 agent 配置和 `.worktreeinclude` 清单里的文件,依赖默认不带)、在副本里做`。
2. 「架构」里 replica 那句(第 45 行):
   - 「只依赖基础层(directory、db、`git-hooks.ts`)与 agents 门面」改成「只依赖基础层(directory、db、`git-hooks.ts`、`repo-projects.ts`)与 agents 门面」。
   - 「`replica` 管需求副本的开、列、删与登记(`cgraphx replica create / list / remove`),登记是……」之前补一句:「副本是 git worktree(主目录旁 `<主目录名>@<文件前缀>`,只带 agent 配置与 `.worktreeinclude` 清单里的文件;带进来的文件用副本自己的 `core.excludesFile` 藏起来,合入、同步直接读同一个仓库的 `refs/heads/<分支>`)」。
3. 全文搜一遍 `写时复制`,确认没有残留(本需求的旧实现说明只允许出现在 `CHANGELOG.md` 的历史条目里)。

### B. `CHANGELOG.md`

在 `## Unreleased` 与现有的 `### Changed — projects are recognized by name` 之间插入(英文,标题与正文按现有风格):

```markdown
### Changed — replicas are git worktrees

A replica is now a git worktree (`git worktree add`) next to the main
directory instead of a copy-on-write copy of the whole directory. Only what
an agent needs is carried over: each agent's config directory, instructions
file and extra config (Claude Code's `.mcp.json`), plus the files listed in
the project's `.worktreeinclude` (gitignore syntax, paths relative to the
project root; cgraphx neither creates nor commits it). Dependencies and
build output are not copied — install and build once inside the replica.
The carried files are hidden from git in the replica through a per-worktree
`core.excludesFile` (the main repository gains
`extensions.worktreeConfig`), so the replica's `git status` stays clean
while the main directory still sees them; the shared `.git/info/exclude` is
no longer written. A main directory with uncommitted tracked changes no
longer blocks replica creation — it only produces a warning. Merging and
syncing use the requirement branch from the same repository
(`refs/heads/<branch>`), so the `git fetch` steps are gone. Deleting a
replica removes the worktree with `git worktree remove --force` and keeps
the branch when it still has unmerged commits; opening the same
requirement again reattaches to that branch and keeps the original base
commit.

**Breaking:** `--full-copy` and the `no_cow` / `dirty_main` error codes are
gone, and copy-on-write replicas created by an older version are not
supported. Remove them with the previous version's `cgraphx replica remove`
before upgrading: for an old replica the branch does not exist in the main
repository, so the new commands report it as undecided and refuse to delete
it rather than deleting the wrong thing.
```

## 完成条件

```bash
grep -n "写时复制" CLAUDE.md || echo "OK: CLAUDE.md 无旧说法"
grep -n "worktree" CLAUDE.md
grep -n "replicas are git worktrees" CHANGELOG.md
grep -n "Breaking" CHANGELOG.md | head -3
```

第一条无输出;后三条命中;`git diff CHANGELOG.md` 只多出这一节(历史条目不出现改动)。

## 提交点

1. `docs: CLAUDE.md 与 CHANGELOG 记 worktree 副本`: `CLAUDE.md`、`CHANGELOG.md`

## 风险/注意事项

- CHANGELOG 的破坏性必须点明「升级前用旧版本清掉」;不要写成新版本会自动迁移(它不会)。
- 不要把 `--full-copy` 写进「仍然可用」的列表;它是删除项。
- `CLAUDE.md` 的「共享 DB」与「基础层」两段只改上述句子,别顺手重写其它架构描述。
