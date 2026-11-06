# T-6: 跳过门禁标记与提交后台任务(F3)

> 产物: plan
> 依据: spec@eac0b58

### 目标

post-commit 片段在前台取走门禁记号与 cherry-pick/rebase 状态传给后台进程;后台进程记完提交后判定「跳过门禁」并打标记,再补钩子片段、调补录。

### 对应 spec 编号

D13(前台侧)、D14、D15、K16、F3 行为链与图

### 强制引用

`docs/guides/coding-standards.md`(契约部分)

### 涉及范围

- `src/core/timeline/git-commit.ts`
- `src/core/timeline/installer.ts`(post-commit / post-merge 片段)
- `src/core/timeline/describe.ts`
- `src/core/timeline/constants.ts`

### 必须严格执行

- 片段新增环境变量按 C-11(`CGRAPHX_GATE_TREE` / `CGRAPHX_CHERRY_PICK` / `CGRAPHX_REBASE`,常量进 `timeline/constants.ts`);post-merge 片段同样取这三样(合并提交不判跳过,但变量照传无害)。
- post-commit 片段前台动作(顺序):取 hash / branch(照旧)→ 读出并删除 `<git 目录>/cgraphx/commit-gate-pass`(`git rev-parse --absolute-git-dir`,读不到传空)→ 判 `CHERRY_PICK_HEAD` 在不在、`rebase-merge` / `rebase-apply` 在不在 → 连同上述变量后台调起 `timeline-git-commit-hook`。命令替换一律 `|| true`,兼容 `sh -e`。
- 后台进程 K16 判定(D14,全部条件同时满足才标):
  1. `resolveSessionIdFromEnv()` 非空(agent 的提交,K12);
  2. `COMMIT_HOOK_ENV` 不是 `post-merge`(post-merge 调起的一律不判);
  3. commit-msg 钩子文件(`resolveHooksDir(cwd)/commit-msg`)内容里有门禁片段的 marker(T-5 门面导出的那个)——没重装、片段没装上时没有门禁可走,不标;
  4. 这笔提交的 tree(`git show -s --format=%T <hash>`,加进 `readGitCommitInfo`)与 `CGRAPHX_GATE_TREE` 不一致(一致或没传都算走过门禁:检查超时、跑不起来时 T-5 照写记号);
  5. `CGRAPHX_CHERRY_PICK` ≠ 1 且 `CGRAPHX_REBASE` ≠ 1;
  6. 说明不是 `Revert "…"` 开头带 `This reverts commit`。
- 标记按 C-8:写 `metadata.gate = 'skipped'`(并进现有 `commitMetadata`,分支等原有键保留);`describe.ts` 的 `git_commit` 分支对带标记的追加「跳过门禁」。
- 后台任务顺序(D15):记提交记录(现有逻辑不动)→ 逐项目判 K16 并写入 → `repairHookSnippets(cwd)` 补缺片段(补不上的经 `hookNotice` 写一行 stderr——后台没人看,但保持与 F4 同源)→ `ensureTimelineUpToDate(cwd)`(C-4,notices 写 stderr)。每一步独立 try/catch:任何一步出错只写 stderr、不影响这笔提交(F3 ④)。

### 允许局部适配

- 片段里三样前台取值的合并写法(可一条命令取齐也可分开);`git show` 取 tree 的时机(进 `readGitCommitInfo` 还是单独跑)。

### 具体要求

1. `constants.ts`:三个环境变量名常量。
2. `installer.ts`:`buildGitPostCommitSnippet` / `buildGitPostMergeSnippet` 按上述前台动作改造;marker、legacyMatch 不变。
3. `git-commit.ts`:`readGitCommitInfo` 增加 tree 字段;`gitCommitHook` 在记完提交后按顺序做 K16 判定、补片段、补录;判「commit-msg 里有门禁片段」经 commit-gate 门面导出的 marker(必要时由门面导出 `hasCommitGateSnippet(cwd)` 之类的只读判断,避免 timeline 直接读文件)。
4. `describe.ts`:C-8 的显示。

### 完成条件

- `npm run build`、`npm test` 通过(git-commit 既有用例如因新字段弄红,同步修正)。
- 临时仓库手工冒烟(spec 设计验收 8 的行为口径):agent 带 `--no-verify` 提交 → 标记;连续两笔快速提交 → 记号不串(第二笔的 tree 对得上第二笔);`cherry-pick`、`revert`、`rebase`、人手动提交、没重装的项目 → 不标;`timeline query --type git_commit --format table` 里能看到「跳过门禁」。

### 提交点

1. `feat(timeline): 跳过门禁的提交可查——post-commit 前台传记号、后台判 K16 标 metadata.gate`:git-commit.ts、installer.ts、constants.ts、describe.ts

### 风险/注意事项

- 「后台进程自己读记号」是 spec 没选的方案(连续提交时记号已被下一笔覆盖)——记号必须在前台读掉删掉、经环境变量传。
- 判定第 3 条依赖 T-5 已合入(marker 可取);本任务在执行顺序上排在 T-5 之后。
- `metadata.gate` 只是附加信息:别动 commit_hash 去重与现有 metadata 键。
