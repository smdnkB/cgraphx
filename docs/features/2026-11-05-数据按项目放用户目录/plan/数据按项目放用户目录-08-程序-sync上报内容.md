# T-8 程序:sync 上报内容

> 产物: plan
> 依据: spec@4d4bf55

- 目标:组一轮上报内容时,根汇总改成「timeline 记下的根 + 当前根 + 副本登记」,路径按它换算(不再只在有副本时多根);读文件、查 git 的兜底从「主目录」改成当前根,查提交先在当前根的仓库查、查不到再到提交记的工作区根查;上报地址、终端会话 id、副本会话 id 都用调用方传入的 `remoteUrl`。
- 对应 spec 编号:D11、D13(上报地址、终端会话 id、副本会话 id);K4、K5
- 强制引用:`docs/guides/coding-standards.md`
- 涉及范围:
  - `src/core/sync/payload.ts`、`artifacts.ts`、`paths.ts`、`references.ts`、`git.ts`(只在需要给多个仓库根复用查询时改)
- 必须严格执行:
  - `createSyncContext(start, opts)` 按 index C-11 的新签名;删掉其中的 `getOriginUrl` 调用,`ctx.remoteUrl = opts.remoteUrl`;仓库根取当前根的 `getRepoToplevel`(取不到照旧抛 `SyncArgError`「… 不在 git 仓库内,请在 git 仓库内运行」)
  - 根汇总用 T-6 本步实现的 C-10 `collectProjectRoots(start)`(照签名调用,不等 T-6):`ctx.projectRoot = rootSet.currentRoot`,`ctx.roots = rootSet.roots`;不再 import replica 的 `listProjectRoots`
  - `terminalSessionId(ctx.remoteUrl)`、`replicaSessionId(ctx.remoteUrl, …)` 的算法不变(D13:都用存下的上报地址)
  - 路径换算(`paths.ts` 的 `createPathResolver`):不再「登记过副本才多根」——`roots` 非空就先 `matchProjectRoot(roots, abs)`,中了按命中的根算项目内路径(`fromProjectRel(hit.rel, hit.root.root)`);不中再照现在比当前根的原样路径和 realpath;项目根在仓库里的相对位置照现在用当前根算(同一项目各根的相对位置相同)
  - 读文件用哪个根:`rootOrMain(root, mainRoot)` 改名 `rootOrCurrent(root, currentRoot)`,语义「这个根的目录还在就用它,不在退回当前根」;`artifacts.ts`、`references.ts` 的调用一并换
  - 查提交(`artifacts.ts`):`gitForCommit` 改成「当前根的仓库有这个提交 → 当前根;否则这条提交事件的 cwd 目录还在 → `ctx.gitFor(cwd)`;否则当前根」;「提交在不在远程」同样先当前根、再提交 cwd 的仓库
  - 提交在哪个根做的:不只看副本——提交事件的 cwd 落在 `ctx.roots` 里哪个根(`matchProjectRoot` 不中时再看 cwd 等于某个根),就按那个根读文件;副本会话的归属(`commitReplicas`、`buildReplicaSessionPayloads`)照现在只看副本
  - 实现中补定(PLAN_CONFLICT,你定的,11-05;依据 D13「哪个根触发都一样」):
    - 子目录项目的提交:事件的 cwd 记的是工作区根(D9),上一条都不中时,再看「cwd 拼上项目根在仓库里的相对位置」是否等于某个根;相对位置为空时和上一条结果相同
    - 移进副本的需求文件(movedFiles):条件是「改它的那个根不是副本」(`ctx.roots` 里该根的 replica 为 null),不是「改它的根是当前根」;判断文件此刻在不在,看改它的那个根。只有主目录加副本时,结果和改动前相同
- 允许局部适配:
  - `gitFor` 的缓存结构;`createPathResolver` 内部写法
  - `payload.ts` 超 600 行时把字段构造类的函数拆到同目录新文件(新文件名写进回报,算本任务范围)
- 具体要求:
  1. `payload.ts`:按「必须严格执行」;`SyncContext` 的注释里「主目录」一律改成「当前根」,`roots` 的注释改成「timeline 记下的根 + 当前根 + 副本登记(C-10)」
  2. `paths.ts`、`artifacts.ts`、`references.ts`:按「必须严格执行」;文件头注释同步改说法
  3. `git.ts`:`getOriginUrl` 保留(T-7 的 connect、补存、并旧连接用);其余按需
- 完成条件:
  - `grep -n "getOriginUrl" src/core/sync/payload.ts` 无输出
  - `grep -rn "rootOrMain\|mainRoot" src/core/sync/payload.ts src/core/sync/artifacts.ts src/core/sync/paths.ts src/core/sync/references.ts` 无输出
  - `grep -n "listProjectRoots" src/core/sync/payload.ts` 无输出;`grep -n "collectProjectRoots" src/core/sync/payload.ts` 有命中
- 提交点:
  1. `refactor(sync): 上报内容按当前根组——根汇总含 timeline 记下的根,路径换算不再只看副本,查提交先当前根再提交的工作区根`:`payload.ts`、`artifacts.ts`、`paths.ts`、`references.ts`,以及改过的 `git.ts`、拆出的新文件
- 风险/注意事项:
  - 本任务和 T-7 同时改 sync:`schema-bootstrap.ts`、`lock.ts`、`hooks.ts`、`runner.ts`、`connection.ts`、`cli.ts`、`status.ts`、`types.ts`、`store.ts`、`index.ts`、`merge.ts` 归 T-7,不要碰
  - 上报白名单、协议、哈希口径一律不变(全局约束 5);这里只换根的来源和兜底
