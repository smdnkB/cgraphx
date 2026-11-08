# T-1: release 读版本历史

> 产物: plan
> 依据: spec@67abbc8

- 目标:release 子系统新增只读的版本历史读取,给看板用:各版本分支自己那一段的第一父链、全部提交、合入说明里的标题,哪些版本打了 tag,以及需求分支的末端提交。
- 对应 spec 编号:D15(release 侧)、D16、D17、D18(取末端)
- 强制引用:`docs/guides/coding-standards.md`
- 涉及范围:
  - `src/core/release/versions.ts`(新建)
  - `src/core/release/types.ts`
  - `src/core/release/constants.ts`(加 C-6 的三个常量)
  - `src/core/release/index.ts`
- 必须严格执行:
  - 类型与函数签名按 C-1;git 命令按 C-6。
  - 主干:`refs/heads/main` 在就用 main,否则 `refs/heads/master`,都没有 → 空历史(C-1 的空返回)。
  - 截段按 D16:先 `git rev-list --first-parent <主干>` 做成集合;对 `git for-each-ref --format=%(refname:short) refs/heads/dev/` 列出的、过 `VERSION_BRANCH_PATTERN` 的每个分支,`git rev-list --first-parent <分支>` 从末端往回逐个取,遇到第一个在主干集合里的提交 B 停下(B 不算进这一段);走过的提交是 `firstParent`;`git rev-list <分支> ^B` 的结果是 `commits`。一路没遇到主干上的提交(和主干没有共同历史)→ 这个分支不出 segment。
  - 合入标题按 D17:`git rev-list --first-parent --format=%H %P%x09%s <分支> ^B` 一次取出这一段第一父链上每个提交的 hash、父提交、说明第一行(不加 `--no-commit-header`,它要 git ≥ 2.33;解析时跳过以 `commit ` 开头的行);父提交两个以上的,说明匹配 `^合入需求：(.+?)(\(第 [0-9]+ 次\))?$`(全角冒号「：」),第一组即标题;去重,保留第一次出现的顺序。这条命令的 hash 列同时就是 `firstParent`,不必为第一父链另跑一次。
  - `releasedVersions`:`git for-each-ref --format=%(refname:short) refs/tags/` 里匹配 `^v[0-9]+\.[0-9]+\.[0-9]+$` 的,去掉 `v`。
  - `resolveBranchTips`:一条 `git for-each-ref --format=%(refname:short) %(objectname) refs/heads/` 取全部本地分支末端,按传入的分支名过滤;不逐个分支调 git。
  - 不抛错:任何 git 失败都按 C-1 的空返回处理;不打印任何东西。
  - `release/index.ts` 只新增导出,原有导出与 `guard.ts` 行为不变。
- 允许局部适配:
  - `versions.ts` 内部的函数拆分、git 输出的分隔符与解析方式;是否复用 `guard.ts` 的 `runGit`(要复用就把它挪成两个文件共用的内部函数,不经门面导出)。
- 具体要求:
  1. `types.ts` 加 `VersionSegment`、`VersionHistory`(C-1 原样,注释中文)。
  2. `versions.ts` 实现 `readVersionHistory`、`resolveBranchTips`,文件头注释写清职责:只读、为看板认版本服务、对应 spec D16–D18。
  3. `index.ts` 导出两个函数和两个类型;门面头注释的职责一句里补上「版本历史的只读读取」。
  4. `execFileSync` 设 `maxBuffer`(如 64MB),`cwd` 用传入的 `dir`。
- 完成条件:
  - `npm run build` 通过。
  - 在本机主目录手工跑 index「统一验证」第 4 条,`dev/2.0.11`–`dev/2.0.15` 的 `mergedTitles` 个数是 4、3、1、10、3;`releasedVersions` 含 2.0.10–2.0.14、不含 2.0.15。
  - 对一个非 git 目录调用返回空历史,不抛错。
  - 既有测试不变红。
- 提交点:
  1. `feat(release): 读版本历史——版本分支各段的合入与 tag`:`src/core/release/versions.ts`、`src/core/release/types.ts`、`src/core/release/constants.ts`、`src/core/release/index.ts`
- 风险/注意事项:
  - 正则里的「：」是全角;「(第 N 次)」的括号是半角,和 dev-merge `SKILL.md:127` 的 grep 一致。
  - 版本分支是从另一个版本分支拉出来的、还没并进主干时,往回走会先走过上一个版本分支的提交才碰到主干;这种情况按 D16 原样截,不特殊处理。
