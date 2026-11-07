# T-2: 开副本改用 worktree

> 产物: plan
> 依据: spec@e839c10

- 目标:`cgraphx replica create` 改成在主目录旁开 git worktree,只带 agent 配置与 `.worktreeinclude` 里写的文件,把这些文件对 git 藏起来,接上删副本时留下的分支;失败按 ⑧ 回滚。
- 对应 spec 编号:F1;D1、D2、D3、D4、D5、D6、D7、D8、D9;K1、K2、K3、K4、K5、K6、K7、K15、K16;spec「文档」表里 `dev-start` 涉及的返回值
- 强制引用:`docs/guides/coding-standards.md`「边界与结构」「选型」「错误与日志」;`docs/guides/interface-standards.md`「命令注册」「输出」「退出码」
- 涉及范围:`src/core/replica/create.ts`(重写)、`src/core/replica/carry.ts`(新增)、`src/core/replica/constants.ts`、`src/core/replica/errors.ts`、`src/core/replica/types.ts`(只改 create 与错误详情相关的部分)、`src/core/replica/cli.ts`(只改 create 命令)

## 必须严格执行

### 顺序(不可调换)

`assertPlatform` → `assertArgs` → `assertMainDir`(K1)→ 主目录改动只记 warning(K7/D9)→ 需求分支判断(③/K15/D7)→ `assertFeatureHasNoReplica`(K2)→ `assertNameFree`(K2)→ `assertTargetFree` → 读 `baseCommit`(新建分支时) → `git worktree add` → `prepareDataDir`(D5)→ `carryIntoReplica`(D2/D3/D4)→ 把主目录这个需求目录下没被跟踪的文件拷进副本(K6)→ 写登记 → 补钩子片段(D8)→ 旧登记名字不同时标成已删(D7)→ 删主目录那份(K6)→ 返回。

- `prepareDataDir` 必须在 `carryIntoReplica` 之前:D4 的 `replica-exclude` 写在 `<副本>/.cgraphx/` 里,且可见性检查依赖 `.cgraphx` 已建好。
- 登记必须写在「拷需求文件」之后(D6)。
- 主目录那份必须最后删;删不掉只进 warnings,不回滚。

### 契约

- C-3:`carry.ts` 只放 D2/D3/D4,导出 `carryIntoReplica(mainRoot, target): { warnings: string[] }`;`mainRoot` 传主目录 realpath。`prepareDataDir`、`copyFeatureFiles`、`planBranch`、`mainDirtyWarnings`、`hookWarnings` 是 `create.ts` 的私有函数,名字可按「允许局部适配」调整。接上留下的分支时 `baseBranch` 仍取这次主目录所在的分支,只有 `baseCommit` 沿用旧登记。
- C-4:错误码删 `dirty_main`、`no_cow`,加 `worktree_failed`;`ReplicaErrorDetails` 只留 `files`。
- C-5:`CreateReplicaOptions { featureId; prefix; branch }`;`CreateReplicaResult extends ReplicaEntry { movedFiles: string[]; warnings: string[]; reattached: boolean }`。
- C-8:`.worktreeinclude` 的所有规则(文件名常量放 `constants.ts` 的 `WORKTREE_INCLUDE_NAME`)。
- C-9:W1、W2、W3、W4、⑦、③ 的文案。
- C-10:副本目录、登记文件、`shared` 链接、K1 判定都不变。

### 分支判断(D7 / ③ / K15)

1. `git show-ref --verify --quiet refs/heads/<branch>` 非零 → 新建分支。
2. 分支已存在:在 `listReplicas(mainRoot, { includeRemoved: true })` 里找 `featureId`、`branch` 都相同、且(`removedAt !== null` 或目录已不在)的登记,取 `createdAt` 最新的那条。
3. 找不到 → `ReplicaError('invalid_args', '主目录已有本地分支 <branch>;换个分支名再开副本')`(③)。
4. 找到 → 接上:`git worktree prune`(失败也继续)后 `git worktree add -q <target> <branch>`;`baseCommit` 用那条登记的 `baseCommit`;结果 `reattached: true`。
5. 新建 → `git worktree add -q -b <branch> <target> HEAD`;`baseCommit` 在 add **之前**用 `git rev-parse --verify -q HEAD` 读;结果 `reattached: false`。
6. add 非零退出 → 删掉可能建了一半的 target、`git worktree prune`,抛 `worktree_failed`(C-9 ⑦)。什么都不留。

### 数据目录(D5)

`prepareDataDir(target, mainRoot)`:

1. `<target>/.cgraphx` 是链接或文件(不是目录)→ 只删链接/文件本身,不进去。
2. `createDirectory(target)`(基础层,已存在 `cgraphx.db` 会抛,按失败回滚处理)。
3. `DatabaseConnection.open(getLocalDatabasePath(target)).close()` 建空本地库。
4. `fs.symlinkSync(fs.realpathSync(getCodeGraphDir(mainRoot)), path.join(getCodeGraphDir(target), SHARED_LINK_NAME), 'dir')`。

### 拷需求目录(K6)

`copyFeatureFiles(mainRoot, target, featureId)`:

- `untrackedFiles(mainRoot)` 为 `null` → 抛 `Error('列不出主目录里没被跟踪的文件(git ls-files 失败);确认 git 正常后重试')`。
- 只取 `docs/features/<featureId>/` 前缀下的项(常量 `FEATURES_DIR_POSIX`),逐个 `fs.cpSync(源, 副本同相对路径, { recursive: true, verbatimSymlinks: true })`,父目录先建;返回拷过的相对路径。
- 登记里的 `movedFiles` 写 `filesToMove(mainRoot, copied)`(含义不变:内嵌的 git 仓库目录不算);返回结果里的 `movedFiles` 写 `moveOutOfMain` 实际从主目录删掉的列表。

### 钩子(D8)

写登记之后、返回之前,在副本里跑 `repairHookSnippets(target)`;每个结果用 `hookNotice(result, '钩子片段没补上')`,非 `null` 的进 warnings。不要再往 `.git/info/exclude` 写任何行(worktree 共用),`localDirPatterns`/`appendGitInfoLines` 的用法一并删掉。

### 失败回滚(⑧)

`git worktree add` 之后的任何一步抛错:

1. `git worktree remove --force <target>`;非零 → `fs.rmSync(target, { recursive: true, force: true })` 再 `git worktree prune`;
2. 新建的分支(`reattach === null`)`git branch -D <branch>`;接上的分支**不删**;
3. 已写的登记文件 `fs.rmSync(file, { force: true })`;旧登记不动;
4. 抛出原错误(不吞、不改写)。

### 删除的旧实现

从 `create.ts` 删掉:`copyTree`、`copyCommand`、`requiredBytes`、`formatGb`、`noCowError`、`darwinCloneBlocker`、`CLONE_UNSUPPORTED`、`localDirPatterns`、`dropUntracked`、`resetDataDir`、`subdirs`、`mentionsPath`、`venvWarnings`、`PYVENV_CFG`、`GITIGNORE`、`assertCleanMain`、`assertBranchFree`(由「分支判断」替代)。保留 `pruneEmptyDirs`、`moveOutOfMain`、`filesToMove`(`filesToMove` 仍用来算登记的 `movedFiles`)。

### CLI 与错误码

- `src/core/replica/errors.ts`:C-4;文件头「十一个 code」改成「十个 code」,并给 `worktree_failed` 补一行说明(开 worktree 失败,带 git 原话)。
- `src/core/replica/types.ts`:`ReplicaEntry` 不动;`CreateReplicaOptions` 删 `fullCopy`;`CreateReplicaResult` 加 `reattached: boolean`。
- `src/core/replica/cli.ts`:`CreateOptions` 删 `fullCopy`;删 `.option('--full-copy', ...)`;`replica` 组与 `create` 子命令的 description 改成 worktree 的说法(不再说「复制整个主目录」「写时复制」);文件头命令面注释同步;`printCreate` 在 `reattached` 时多打一行「接上了留下的分支 <branch>」。
- 失败输出仍走 `reportError`,`--json` 形态与退出码不变。

## 允许局部适配

- 私有函数的名字、参数顺序、内部拆分;`carry.ts` 内部怎么分函数。
- 错误/警告文案的措辞(除 C-9 固定的几句);`printCreate` 的展示顺序。
- `create.ts` 若超 600 行,可把私有函数再拆一个文件,但不得改 C-3/C-5 的导出面,也不得把 D2/D3/D4 挪出 `carry.ts`。

## 具体要求(按文件)

1. **`src/core/replica/constants.ts`**:加 `export const WORKTREE_INCLUDE_NAME = '.worktreeinclude';`(带一行中文注释)。
2. **`src/core/replica/carry.ts`**:新建,按 C-3、C-8 实现(所有 git 命令带 `cwd`/`-C`,拷贝路径一律拼绝对路径,不看进程 cwd);`visible` 路径 = K4 条目 + K16 实际拷入的相对路径 + `:(literal).cgraphx`;有可见项才写 `extensions.worktreeConfig` 与副本的 `core.excludesFile`;不碰 `<main>/.git/info/exclude`。
3. **`src/core/replica/create.ts`**:按上面「顺序」「分支判断」「数据目录」「拷需求目录」「钩子」「失败回滚」重写入口,文件头注释一并重写(不再说写时复制);`assertMainDir` 里提到「整仓复制」「整仓复制出的副本会和原仓库共用引用」的文案改成 worktree 的说法(判定逻辑不动);`assertArgs`、`assertFeatureHasNoReplica`、`assertNameFree`、`assertTargetFree` 不动。
4. **`src/core/replica/errors.ts`**、**`src/core/replica/types.ts`**、**`src/core/replica/cli.ts`**:见上面「CLI 与错误码」。

## 完成条件

```bash
npm run build
node dist/cli/index.js replica create --help        # 无 --full-copy;描述是 worktree
grep -rn "no_cow\|fullCopy\|dirty_main\|copyTree\|appendGitInfoLines" src/core/replica/ || echo "OK: 旧实现已清"
```

再按 index「统一验证」的冒烟脚本跑 F1、F2、F3、K15、K7、③ 各段;至少 F1 段必须全绿(worktree、带文件、藏文件、移讨论稿、`.cgraphx` 不脏)。

## 提交点

1. `feat(replica): 开副本改用 git worktree——带 agent 配置与清单文件、接上留下的分支`: `src/core/replica/create.ts`、`src/core/replica/carry.ts`、`src/core/replica/constants.ts`、`src/core/replica/errors.ts`、`src/core/replica/types.ts`、`src/core/replica/cli.ts`

## 风险/注意事项

- `git ls-files --exclude-from` 不要加 `--exclude-standard`,否则 `node_modules` 会被带进来。
- `--directory` 的输出可能是文件、也可能是带末尾 `/` 的目录;目录项要带 `filter` 跳过 `listWorktreeRoots` 里的 worktree,否则会把 agent 自己开的 worktree 拷进副本。
- D4 的可见性检查只传实际路径 + `:(literal)`,不要把 `.worktreeinclude` 的原行当 pathspec(`../out` 会让 git 以 128 退出)。
- `.cgraphx` 必须参与可见性检查:否则项目根没忽略 `.cgraphx/` 时,副本里的 `.cgraphx/.gitignore` 会让 K10 永远不干净,`/dev-merge` 与删副本都被拦。
- 设置 `core.excludesFile` 前必须先在主仓库开 `extensions.worktreeConfig`,否则 `git config --worktree` 直接失败(回滚)。
- 回滚先删 worktree 再删分支;接上的分支任何失败都留着。
