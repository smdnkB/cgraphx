# T-5: commit-gate 门禁子系统(F2)

> 产物: plan
> 依据: spec@eac0b58

### 目标

新增轻形态子系统 `src/core/commit-gate/`:commit-msg 钩子里的 sh 片段 + 隐藏命令 `commit-gate-hook`,按 F2 的图做版本分支拦截、产物检查、提交说明自查,通过时给 F3 留记号。

### 对应 spec 编号

D10 🔒、D11、D12、D13、K12、K13、K14、K15、K26、K27

### 强制引用

`docs/guides/coding-standards.md`(契约部分:轻形态门面 + cli + errors + constants,同 replica / release)、`docs/guides/interface-standards.md`(隐藏命令、退出码)

### 涉及范围

- 新增 `src/core/commit-gate/index.ts`(门面)、`cli.ts`、`constants.ts`、`gate.ts`(判定主体)、`errors.ts`(CommitGateError 层级)
- `src/core/release/index.ts`(门面补导出 `RELEASE_FLOW_CONFIG_KEY`——现只导出 `VERSION_BRANCH_PATTERN`,commit-gate 按门面铁律不能直接 import `release/constants.ts`)
- `src/cli/index.ts`(注册 `registerCommitGateCommands`)

### 必须严格执行

- 隐藏命令、退出码、记号文件按 C-5;sh 片段行为按 C-6(marker、会话变量名单来自 agents 描述的 `sessionIdEnv`、非 3 一律放行、兼容 `sh -e`)。
- 判定顺序按 D12(F2 的图,顺序钉死):
  1. **K26 版本分支**:`release` 门面取 `RELEASE_FLOW_CONFIG_KEY` 为 true、当前分支匹配 `VERSION_BRANCH_PATTERN`、没有 `MERGE_HEAD`、说明第一行(跳过 `#` 注释与空行)不以 `chore(release):` 开头 → 退出 3,打回原文**同 release 拦截片段**那一句(「dev/x.y.z 是版本分支:需求改动到副本里做…以 chore(release): 开头提交」);规则常量(`VERSION_BRANCH_PATTERN` 等)共用 release 门面导出的那份,不复制。
  2. **K13**:`git rev-parse --absolute-git-dir` 下说明文件名是 `MERGE_MSG` → 放行(记号照写)。
  3. **K27**:`git diff --cached --name-status` 输出为空 → 放行(记号照写)。
  4. **K14 产物检查**:子进程跑 `cgraphx features check --staged --json`(spawnSync、超时 15 秒、stdio 收 stdout),只拦 `failures > 0`;跑不起来 / 超时 / 输出不可解析 → 当没查、往下走(记号照写)。打回原文:「【产物检查】本次暂存的产物有 N 处不合格,改对后才能提交(带 CGRAPHX_PRECOMMIT_REVIEWED=1 也跳不过):…改完重新 git add,再提交。」(逐条 fail 的 path:message;改法——照 `precommit-check.cjs` 的 `formatArtifactCheckReason`)。
  5. **K15 自查**:`CGRAPHX_PRECOMMIT_REVIEWED=1` 在环境 → 放行;没有 → 退出 3,提示原文搬自 `precommit-check.cjs` 第 174–182 行(有 guide 时:读 `docs/guides/git-standards.md`、按检查点自查 `git diff --cached`、按消息规范写说明,处理完带变量重试;没有 guide 时:提示先跑 `/init-guides`);guide 路径相对**工作区根**(`git rev-parse --show-toplevel`)。
- 记号(D13):任一「没打回」的出口(含 K13/K27 放行、检查跑不起来)把 `git write-tree` 输出写进 `<git 目录>/cgraphx/commit-gate-pass`(`rev-parse --absolute-git-dir` 下,`cgraphx/` 目录不存在就建);写失败只 stderr、不影响放行。
- 门面 `installCommitGate(cwd)` / `removeCommitGate(cwd)`:经基础层 `installHookSnippet` / `removeHookSnippet` 写/删 commit-msg 片段(hook 名 `commit-msg`、marker 用 C-6 的);不支持写入时返回 `hookNotice` 的原因(由 T-8 的 install/uninstall 消费)。
- 子系统只依赖 release、agents 门面与基础层 git-hooks;**不 import features 门面**(产物检查走子进程,D12 没选进程内);core 不依赖 cli。

### 允许局部适配

- C-6 片段的逐字写法(行为约束内);`gate.ts` 内部函数拆分;打回提示里 fail 条目的渲染细节。
- `errors.ts` 的错误种类划分。

### 具体要求

1. `constants.ts`:marker、打回提示模板、`features check` 参数与超时常量、记号文件名与目录名;不复制 release 的规则常量(import);`release/index.ts` 补一行 `export { RELEASE_FLOW_CONFIG_KEY } from './constants'`。
2. `gate.ts`:按判定顺序实现;所有 git 调用容错(失败按放行 + 记号照写处理,除了 K26 读不到分支配置本来就是放行)。
3. `cli.ts`:`commit-gate-hook <说明文件>`(隐藏、allowUnknownOption 不需要——参数固定一个);action 里调 gate,退出码 0/3,打回文本写 stderr。退出码 3 是**领域信号**(放行/打回),不走 `exitCodeForError` 的错误映射,直接 `process.exitCode = 3`——记 interface-standards 的一条例外(由 T-10 更新规范时写明)。
4. `index.ts` 门面:`installCommitGate` / `removeCommitGate` / 常量导出(marker 供 T-6 判「钩子文件里有门禁片段」)。
5. `src/cli/index.ts`:import 并调 `registerCommitGateCommands(program)`(在 registerTimelineCommands 之后)。

### 完成条件

- `npm run build`、`npm test` 通过。
- 临时仓库手工冒烟(spec 设计验收 6、7、8 的行为口径):
  - 人手动提交不起 node(片段里没有会话变量);
  - 把 `cgraphx` 从 PATH 拿掉 / 用旧版 cgraphx 时 agent 提交照常成功(command not found 放行);
  - `git merge --no-ff` 的合并提交不被自查拦(K13);`git commit --amend --no-edit` 放行(K27);`git commit -a` 的产物检查看得到要提交的文件;
  - 版本分支(dev/x.y.z + `cgraphx.releaseFlow`)上违规提交被退出 3 打回,`chore(release):` 开头与合并提交放行;
  - 暂存不合规 spec 头部 → 产物检查打回;带 `CGRAPHX_PRECOMMIT_REVIEWED=1` 重试 → 放行且 `commit-gate-pass` 里有 tree。

### 提交点

1. `feat(commit-gate): 门禁搬进 git commit-msg 钩子——隐藏命令退出码 0/3+过门禁记号`:commit-gate/ 五个文件、cli/index.ts

### 风险/注意事项

- 钩子环境里 `GIT_INDEX_FILE` 指向实际索引(spec D12 已实测),`git diff --cached` / `git write-tree` 直接跑即可,不要动这些变量。
- 打回只来自退出码 3;任何异常(读不到说明文件、git 全挂)都放行——门禁挂了不能让人提交不了。
- 片段必须「没有任何会话变量就不起 node」:人每次提交多等 90ms 是 spec 明确不要的。
