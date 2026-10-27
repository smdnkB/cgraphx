# T-3: 程序——release 子系统

> 产物: plan
> 依据: spec@3eef166

- 目标:新增 release 子系统:K8 版本分支模式、commit-msg 提交拦截的装卸,以及 `cgraphx release guard` 命令
- 对应 spec 编号:F2⑥、F10、D1、D5、D12;K8
- 强制引用:`docs/guides/coding-standards.md`、`docs/guides/interface-standards.md`
- 涉及范围(全部新建,都在 `src/core/release/` 下):`index.ts`(门面)、`cli.ts`、`types.ts`、`errors.ts`、`constants.ts`、`guard.ts`
- 必须严格执行:
  - 按 C-6(导出名与签名、命令、JSON 形态、`not_git_repo` 与退出码 2、`unsupported` 的退出码与提示、git config 记号、片段三行逐字)
  - 按 C-2(只经 `installHookSnippet` / `removeHookSnippet` 写钩子,marker `# cgraphx-release-guard`;非 shell 钩子由 C-2 判定为 `unsupported`,本任务不另写判断)
  - 依赖只许:`../git-hooks`、`node:` 内置模块、`commander`(cli.ts);不得 import 任何子系统
- 允许局部适配:
  - 内部辅助函数的拆分与命名
  - 不带 `--json` 时成功提示的措辞
- 具体要求:
  1. `constants.ts`:`VERSION_BRANCH_PATTERN = /^dev\/[0-9]+\.[0-9]+\.[0-9]+$/`;`RELEASE_GUARD_MARKER = '# cgraphx-release-guard'`;`RELEASE_GUARD_LINES`(C-6 的三行,逐字);`RELEASE_GUARD_CONFIG_KEY = 'cgraphx.releaseGuard'`。
  2. `errors.ts`:`ReleaseError extends Error`,带 `code`(目前只有 `not_git_repo`);`exitCodeForError`:`not_git_repo` → 2,其余 → 1。
  3. `guard.ts`:
     - `installReleaseGuard(cwd)`:`resolveHooksDir(cwd)` 为 null → 抛 `ReleaseError('not_git_repo')`;先读记号 `git config --local --get cgraphx.releaseGuard`;再 `installHookSnippet(cwd, 'commit-msg', RELEASE_GUARD_MARKER, RELEASE_GUARD_LINES)`;C-2 返回 `unsupported` → 原样返回,不写记号;返回 `installed` 且记号原来为 `true` → status 改成 `repaired`;不是 `unsupported` 时最后 `git config --local cgraphx.releaseGuard true`
     - `removeReleaseGuard(cwd)`:不在 git 仓库 → `{ hookPath: null, status: 'absent', hooksDirTracked: false }`;`removeHookSnippet(cwd, 'commit-msg', RELEASE_GUARD_MARKER)` 返回路径 → `removed`,返回 null → `absent`;两种情况都 `git config --local --unset cgraphx.releaseGuard`(没有这个键时忽略错误)
  4. `cli.ts`:`export function registerReleaseCommands(program: Command): void`,注册 `release` 命令组和 `guard` 子命令(`--remove`、`--json`);在 `process.cwd()` 下执行;带 `--json` 按 C-6 输出(成功、失败都是 `JSON.stringify(x, null, 2)` 加换行,失败为 `{ "ok": false, "code", "message" }`),不带时错误走 stderr、前缀 `[release]`;status 为 `unsupported` → 退出码 0,不带 `--json` 时 stderr 打 C-6 的那句提示;`hooksDirTracked` 为 true 时(不带 `--json`)stderr 多打一行 C-7 的安装提示原文 `[release] 钩子目录 <所在目录> 由 git 跟踪,改动会出现在 git status 里`。
  5. `index.ts`:按 C-6 导出。
- 完成条件:
  - C-6 列出的导出全部存在,签名一致
  - 片段三行与 C-6 逐字一致(含中文提示和末尾的 marker)
  - release 目录下没有 import 任何子系统的语句;每个文件 ≤ 600 行
- 提交点:
  1. `feat(release): 版本分支提交拦截——commit-msg 片段 + cgraphx release guard`:`src/core/release/` 下 6 个文件
- 风险/注意事项:
  - 片段在用户每次提交时执行:只在违规时 `exit 1`,不要加其他 `exit`,不要调 cgraphx 或 node
  - `install` 不装拦截(spec D36),拦截只由 release-start 调本命令装上
