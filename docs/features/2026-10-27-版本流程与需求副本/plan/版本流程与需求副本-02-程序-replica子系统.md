# T-2: 程序——replica 子系统

> 产物: plan
> 依据: spec@a8b762a

- 目标:新增 replica 子系统:登记读写、主目录与副本的路径换算、开 / 列 / 删副本,以及 `cgraphx replica` 命令组
- 对应 spec 编号:F7、F9、D1、D18、D19、D20、D21、D22、D26(换算函数)、D35;K1、K3、K9;spec「细节方案:F7」的登记文件示例、命令契约、K3 / K9 取法
- 强制引用:`docs/guides/coding-standards.md`、`docs/guides/interface-standards.md`
- 涉及范围(全部新建,都在 `src/core/replica/` 下):
  - `index.ts`(门面)、`cli.ts`、`types.ts`、`errors.ts`、`constants.ts`
  - `registry.ts`(登记读写)、`roots.ts`(主目录与副本的换算)、`create.ts`(开副本)、`status.ts`(K3、K9)、`remove.ts`(删副本)
- 必须严格执行:
  - 按 C-1(只用 `resolveDataDir`、`getDataDir`、`getCodeGraphDir`、`codeGraphDirName`、`createDirectory`、`isInitialized`、`resolveProjectRoot`、`SHARED_LINK_NAME`、`REPLICAS_DIRNAME`,不改 directory.ts)
  - 按 C-3(登记文件格式与写法)
  - 按 C-4(门面导出名与签名、各函数规则)
  - 按 C-5(命令、参数、JSON 形态、code、退出码、表格列)
  - 按 C-8(副本目录名 `<主目录名>@<文件前缀>`)
  - 依赖只许:`../directory`、`../db`(只用 `DatabaseConnection`、`getLocalDatabasePath`)、`../agents`(只用 `listAgentProfiles` 取 `configDirName`)、`node:` 内置模块、`commander`(cli.ts);不得 import task、sync、features、timeline、markdown(spec D1)
- 允许局部适配:
  - 内部辅助函数的拆分与命名、git 命令的封装方式
  - 表格的对齐方式、成功时的中文提示措辞
  - 错误 message 的措辞(code 与附加字段固定)
- 具体要求:
  1. `constants.ts`:`FEATURES_DIR_POSIX = 'docs/features'`(注释写明与 artifact-registry 同值,replica 按 D1 不依赖它);敏感字符集 `/ \ : * ? " < > |`;支持的平台 `darwin`、`linux`。
  2. `errors.ts`:`ReplicaError extends Error`,带 `code`(C-5 的九个 code 联合类型)和 `details`(如 `{ files }`、`{ requiredBytes }`);`exitCodeForError(err)`:`invalid_args` → 3,其余八个 code → 2,非 ReplicaError → 1。
  3. `registry.ts`:按 C-3 读写;`readEntries(mainRoot)` 返回全部登记(含已删除),解析失败的文件跳过,每次都读文件、不缓存(C-4);`writeEntry(mainRoot, entry)` 走临时文件 + rename;`markRemoved(mainRoot, name, at)` 只改 `removedAt`。
  4. `roots.ts`:按 C-4 实现 `resolveMainRoot`、`listProjectRoots`、`matchProjectRoot`、`replicaOfCwd`、`locateFeatureRoot`、`listReplicas`;`realRoot` 只在 `listProjectRoots` 里给每个根算一次(走目录 realpath 缓存,目录不在时取最近一级在的上级),`matchProjectRoot`、`replicaOfCwd` 不再给根算 realpath,按 C-4 用查找表逐级往上找;`locateFeatureRoot(roots, featureId)` 先找副本再找主目录,roots 由调用方传入(C-4)。
  5. `create.ts`(`createReplica`,spec D20、D21、D22),按顺序:
     - 前置检查,任一不过就抛对应 code,什么都不改:
       - 平台不是 darwin / linux → `unsupported_platform`
       - featureId、prefix 不是单段目录名或含敏感字符、branch 为空或 `git check-ref-format --branch <branch>` 不通过 → `invalid_args`
       - 按调用方传入的项目根(不先换成主目录)逐条查 C-5 列出的 `not_main_dir` 情形:在副本里或主目录已不在、未初始化、项目根不是 `git rev-parse --show-toplevel`、`.git` 不是 `<项目根>/.git` 目录(worktree、子模块)、detached HEAD → `not_main_dir`(message 说明是哪一种、怎么改)。下面各步的「主目录」就是这个项目根
       - 已有同 featureId、removedAt 为空、目录还在的登记 → 直接返回该登记,`created: false`、`movedFiles` 照登记(以前的登记为 `[]`)、`warnings: []`(F7②)
       - 主目录 `git status --porcelain --untracked-files=no` 有输出 → `dirty_main`,`files` 为这些路径(F7①)
       - 主目录已有同名本地分支(`git show-ref --verify --quiet refs/heads/<branch>` 成功)→ `invalid_args`(提示换分支名)
       - 副本目录名 `<主目录名>@<prefix>` 已登记给别的 featureId(在用、已删都算)→ `name_taken`(spec D22)
       - 目标路径 `<主目录的上级>/<主目录名>@<prefix>` 已存在 → `target_exists`
     - 复制:darwin 先判断目标目录和主目录同卷(`fs.statSync(…).dev` 相同)、且卷是 APFS(`/usr/bin/stat -f %Sd` 取设备名,`/sbin/mount` 里这个设备那一行的文件系统类型),不满足或判断不了 → 抛 `no_cow`,满足才 `/bin/cp -cR <主目录> <目标>`;linux `cp -R --reflink=always <主目录> <目标>`;cp 子进程的环境加 `LC_MESSAGES=C`、去掉继承的 `LC_ALL`(报错按英文认,文件名照原样不转义);复制命令失败 → 删掉已产生的目标目录;报错是克隆不了(`failed to clone`、`clonefile`、`not supported`、`cross-device`、`EOPNOTSUPP`、`EXDEV`)才抛 `no_cow`,其余(读不了的文件、权限)照实抛运行时错误,message 写明已删掉复制了一半的目标目录、检查读权限后重跑。`requiredBytes` = `du -sk <主目录>` × 1024。`fullCopy` 为 true 时用 `cp -R`,不做判断。
     - 整理(spec D21 ①~⑥,①~⑤ 任一步失败:`fs.rmSync(目标, { recursive: true, force: true })`,已写的登记文件删掉,抛原错误;主目录不动):
       1. 先按 C-5 写副本的 exclude:各 agent 配置目录(`listAgentProfiles()` 各项的 `configDirName`,如 `.claude`)里开副本时没被跟踪的部分加 `codeGraphDirName()`,经 C-2 的 `gitPathPattern`、`appendGitInfoLines` 追加(仓库跟踪了配置目录的一部分时,被跟踪的位置之后新建的文件 git 看得见);再在副本里取 `git ls-files --others --exclude-standard -z`(这时已不含上面这些目录):位于 `docs/features/<featureId>/` 下的保留,其余逐个删除,删完顺手删掉因此变空的目录(`docs/features/<featureId>/` 本身不删)
       2. `<副本>/<codeGraphDirName()>/` 下除 `.gitignore` 以外的条目逐个 `fs.rmSync(…, { recursive: true, force: true })`,`.gitignore` 原样保留、不改写;目录不在或没有 `.gitignore` 时才调 `createDirectory(副本)`(它会建目录和 `.gitignore`)→ `DatabaseConnection.open(getLocalDatabasePath(副本)).close()`(空的本地库)→ `fs.symlinkSync(realpath(getCodeGraphDir(主目录)), path.join(getCodeGraphDir(副本), SHARED_LINK_NAME), 'dir')`
       3. 副本里 `git checkout -q -b <branch>`;`fs.mkdirSync(<副本>/docs/features/<featureId>, { recursive: true })`
       4. 副本根下一层、两层目录里的 `pyvenv.cfg`,内容含主目录绝对路径 → warnings 加一条「副本里的 <目录> 写死了主目录路径,在副本里重建虚拟环境」
       5. 写登记(C-3):`baseBranch` = 主目录 `git symbolic-ref --short HEAD`,`baseCommit` = 复制前主目录 `git rev-parse --verify -q HEAD`,`createdAt` = 当前时间,`removedAt: null`
       6. 删掉主目录 `docs/features/<featureId>/` 下没被跟踪的文件(第 1 步保留的那些),路径记进 `movedFiles`,再删掉因此变空的目录;被忽略的文件(如 `.DS_Store`、`*.local.md`)留在原处(spec D21⑥);删不掉的记进 warnings,不回滚
     - 返回 C-4 的 `CreateReplicaResult`,`created: true`
  6. `status.ts`(`listReplicaStatus`,spec「F7」K3、K9 取法):
     - state:removedAt 非空 → `removed`;目录不在 → `missing`;否则 `present`
     - dirty(只对 present):副本里 `git status --porcelain --untracked-files=no` 的路径,加上 `git ls-files --others --exclude-standard` 的路径
     - merged、ahead(只对 present,目标分支 = 主目录当前分支):`git ls-remote <副本路径> refs/heads/<branch>` 取提交;主目录里 `git fetch --no-tags --no-write-fetch-head <副本路径> <branch>`;按 C-5 的 K3 取法两条计数:`git rev-list --count --first-parent --no-merges <提交> ^<baseCommit>` 为 0 → `merged: false, ahead: 0`(还没有提交);否则同一条加 `^HEAD` 的计数为 `ahead`,0 → `merged: true`;登记里没有 baseCommit(旧登记)→ 照旧 `git merge-base --is-ancestor <提交> HEAD` 与 `git rev-list --count HEAD..<提交>`;副本里分支不存在、git 出错 → `merged: null, ahead: null`
     - 默认不含 removed,`includeRemoved` 为 true 时含
  7. `remove.ts`(`removeReplica`,spec D35):
     - 按调用方传入的项目根查 C-5:`resolveDataDir(projectRoot).state` 不是 `own` → `not_main_dir`
     - 按 name 或 featureId 找 removedAt 为空的登记;找不到 → `not_found`
     - 目录不在 → `markRemoved`,返回 `{ name, state: 'missing' }`
     - 五条核对,任一条不过 → `unsafe_target`(message 写明哪一条):realpath(目录) 等于 realpath(登记的 path);它不是主目录、也不是主目录的上级;目录名以 `<主目录名>@` 开头;`<目录>/<codeGraphDirName()>/shared` 是符号链接且 realpath 等于 realpath(主目录数据目录);(第五条)K9 没有改动,否则抛 `dirty`,`files` 为改动列表
     - `fs.rmSync(目录, { recursive: true, force: true })`(不跟随链接,不调 shell)→ `markRemoved` → 返回 `{ name, state: 'removed' }`
  8. `cli.ts`:`export function registerReplicaCommands(program: Command): void`,注册 C-5 的三个子命令;项目根取 `resolveProjectRoot(process.cwd())`,原样传给 `createReplica`、`removeReplica`(由它们按 C-5 判断在不在主目录);action 内 try/catch,按 C-5 输出(`--json` 一律 `JSON.stringify(x, null, 2)` 加换行,失败时 `details` 的字段平铺进对象),退出码用 `exitCodeForError`(不散落 `process.exitCode = n` 字面量)。
  9. `index.ts`:按 C-4 导出;`registerReplicaCommands` 留在 cli.ts(和其他子系统一样由 `src/cli/index.ts` 从 cli 模块导入,T-8 接入)。
- 完成条件:
  - C-4 列出的导出全部存在,签名一致
  - 没有登记任何副本时,`listReplicas` 返回 `[]`,`listProjectRoots` 只含主目录,`locateFeatureRoot` 只看主目录
  - list 表格的合入列:`merged` 为 false 且 `ahead` 为 0 → 「还没有提交」(C-5)
  - 删除只经 `fs.rmSync`,代码里没有 `rm -rf` 字样的 shell 调用
  - 刚开出的副本 K9 为空:`.claude/` 等 agent 配置目录、`.cgraphx/`(含保留的 `.gitignore`)都不算改动
  - replica 目录下没有 import task、sync、features、timeline、markdown 的语句
  - 每个文件 ≤ 600 行
- 提交点:
  1. `feat(replica): 副本子系统——登记、路径换算、开 / 列 / 删副本`:`src/core/replica/` 下 10 个文件
- 风险/注意事项:
  - 复制前主目录工作区必须干净(F7①),否则副本会带走没提交的改动
  - macOS 的 `cp -c` 克隆不了时会悄悄退成整份复制、命令照样成功,只看命令失败判不出 `no_cow`(spec D20)——复制前先判断同卷且是 APFS;Linux 的 `--reflink=always` 不能克隆就失败,以命令失败为准
  - `.git/info/exclude` 只写副本自己的,主目录的不动
  - 符号链接目标写 realpath 绝对路径,保证主目录、副本里打开的是同一个库文件(WAL 文件跟着走)
