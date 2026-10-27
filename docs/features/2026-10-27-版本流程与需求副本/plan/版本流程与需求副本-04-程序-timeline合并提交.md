# T-4: 程序——timeline 记合并提交

> 产物: plan
> 依据: spec@3eef166

- 目标:timeline 的 git 钩子改经 git-hooks 写入(跟随 core.hooksPath、紧跟 shebang),新增 post-merge 片段记下合并提交;副本里拒绝 `--purge` 清数据
- 对应 spec 编号:F8(合并提交记进主目录)、D32、D33;全局约束「副本里会删共用数据的操作直接拒绝」
- 强制引用:`docs/guides/coding-standards.md`、`docs/guides/interface-standards.md`(「Hook 子命令契约」)
- 涉及范围:
  - `src/core/timeline/installer.ts`
  - `src/core/timeline/hooks.ts`
  - `src/core/timeline/constants.ts`
  - `src/core/timeline/recorder.ts`
  - `src/core/timeline/cli.ts`
- 必须严格执行:
  - 按 C-2(写钩子只经 `installHookSnippet` / `removeHookSnippet`)
  - 按 C-7(post-merge 两行逐字、post-commit 三行逐字、命令替换带 `|| true`、`COMMIT_HOOK_ENV`、三条记录规则、metadata 形态、`InstallReport.gitHooks` 与 `UninstallReport.mergeHookRemoved`、安装提示原文)
  - 按 C-1(副本判断用 `resolveDataDir(...).state`)、C-12(拒绝清数据的提示原文)
  - 不新增隐藏子命令:post-merge 复用 `timeline-git-commit-hook`
- 允许局部适配:
  - `readGitCommitInfo` 内部的拆分方式(可新增内部函数取父提交和相对第一父提交的统计)
  - 注释措辞
- 具体要求:
  1. `constants.ts`:新增 `COMMIT_HOOK_ENV = 'CGRAPHX_GIT_HOOK'`,注释说明取值 `post-merge`、缺省即 post-commit。
  2. `installer.ts`:
     - 安装:post-commit 片段改为 `installHookSnippet(gitRoot, 'post-commit', GIT_HOOK_MARKER, <C-7 的 post-commit 三行>, { legacyMatch: GIT_COMMIT_SUBCOMMAND })`;再写 post-merge:`installHookSnippet(gitRoot, 'post-merge', GIT_HOOK_MARKER, <C-7 两行>)`;两个结果按顺序放进 C-7 的 `gitHooks`;`gitHookPath` 取 post-commit 结果的 hookPath,`gitHookWritten` 为它的 status 是 `installed` 或 `updated`
     - 卸载(`keepGitHook` 为 false 时):对 post-commit(带 legacyMatch)、post-merge 各调一次 `removeHookSnippet`;`gitHookRemoved` 照旧指 post-commit,`mergeHookRemoved` 指 post-merge
     - `--purge`:`resolveDataDir(resolvedRoot).state` 不是 `own` → 不删表,stderr 输出 C-12 的拒绝原文(主目录路径取 `mainRoot`),`dataDropped` 为 false;是 `own` → 照旧删表,库路径改用 `getDatabasePath(resolvedRoot)`(不再手拼 `.cgraphx/cgraphx.db`)
     - 删掉不再使用的本地函数(`findGitRoot` 若只剩取仓库根的用途可保留;`buildGitPostCommitSnippet` 保留,改为返回三行数组)
  3. `hooks.ts` 的 `gitCommitHook` / `readGitCommitInfo`:
     - 取父提交:`git rev-list --parents -n 1 <ref>`
     - 父提交 ≥ 2:按 C-7 记合并形态(`commit_files: []`、增删行 0、`metadata.merge` 取 `git diff --numstat <第一父提交> <hash>`;二进制行两列为 `-`,计入 files、不计行数);`metadata.branch` 照旧
     - 父提交 1 个且 `process.env[COMMIT_HOOK_ENV] === 'post-merge'` → 直接返回,不记
     - 其余照现有逻辑
  4. `recorder.ts`:`recordEvent` 写 git_commit 事件时,在同一连接上 `exec('BEGIN IMMEDIATE')` → `SELECT id FROM timeline_events WHERE event_type = 'git_commit' AND commit_hash = ? LIMIT 1`,查到就返回这个 id、不写;查不到照常 enrich + insert → `COMMIT`;出错先 `ROLLBACK` 再照旧抛出(C-7 去重)。连接的 `transaction()` 用的是普通 `BEGIN`,两个钩子进程会都查不到、都写进去,这里不用它;其他事件类型照旧,不开事务;不往 `store.ts` 加代码,它已 582 行。
  5. `cli.ts`:`timeline install` 的说明文字由「.git/hooks/」改成「git 钩子目录」;报告照旧由 `writeReports` 输出到 stdout;输出报告后,对每份报告的 `gitHooks` 按 C-7 的安装提示往 stderr 打 `[timeline] …`(`unsupported` 每个钩子一行;`hooksDirTracked` 同一目录只打一行)。
- 完成条件:
  - 新装项目的 post-commit、post-merge 钩子文件里,cgraphx 片段紧跟在 shebang 后面;已装旧版(片段在文件末尾)的项目重装后片段移到 shebang 后、不重复
  - 钩子文件是非 shell 脚本时不改它,`timeline install` 在 stderr 打出提示
  - `timeline-git-commit-hook` 仍然 fail-silent、全部 await、退出码 0
  - 每个改动的文件 ≤ 600 行
- 提交点:
  1. `feat(timeline): 记下合并提交——post-merge 片段 + 钩子跟随 core.hooksPath`:`src/core/timeline/installer.ts`、`hooks.ts`、`constants.ts`、`recorder.ts`、`cli.ts`
- 风险/注意事项:
  - 不改测试文件(超出涉及范围):既有测试里断言 post-commit 片段在文件末尾、断言片段原文、或断言钩子路径是 `.git/hooks/post-commit` 的,属于 spec D33 有意改掉的行为(片段位置与目录,以及 C-7 为此加的 `|| true`),统一验证时由主会话改用例期望;回报的「要人验证的」里写一句「timeline installer 的既有测试可能要按 D33 改期望」
  - 合并提交上 `git diff-tree --no-commit-id --name-only -r` 输出为空(实测),不要用它取合并的文件
  - 快进合并不产生新提交,提交本身在当时已记过,不要重复记
