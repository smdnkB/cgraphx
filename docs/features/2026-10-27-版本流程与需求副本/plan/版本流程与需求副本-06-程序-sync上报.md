# T-6: 程序——sync 以主目录上报

> 产物: plan
> 依据: spec@a8b762a

- 目标:上报不论从哪个目录触发都按主目录跑;路径按「主目录 + 全部登记过的副本」换算;副本里的提交在副本仓库里查;副本里没对上会话的提交,每个副本单独上报一个带绑定的会话
- 对应 spec 编号:F8(平台上报那一段)、D25、D26、D28(上报部分)、D29
- 强制引用:`docs/guides/coding-standards.md`
- 涉及范围:
  - `src/core/sync/runner.ts`
  - `src/core/sync/payload.ts`
  - `src/core/sync/artifacts.ts`
  - `src/core/sync/paths.ts`
  - `src/core/sync/git.ts`
  - `src/core/sync/hooks.ts`
  - `src/core/sync/lock.ts`
  - `src/core/sync/cli.ts`
  - `src/core/sync/constants.ts`
  - `src/core/sync/references.ts`
- 必须严格执行:
  - 按 C-1(锁、存活、触发文件改走 `getDataDir`)
  - 按 C-4(只经 `from '../replica'` 用 `resolveMainRoot`、`listProjectRoots`、`matchProjectRoot`、`replicaOfCwd`、`locateFeatureRoot`)
  - 按 C-11(会话 id、收哪些提交、会话内容、绑定口径、发送判断)
  - 按 C-13:副本会话绑定的 taskId、taskKey 只经 task 门面 `featureBindingTarget` 取;sync 不 import features(统一验证 4 查)。T-5 同一步实现它,照 C-13 的签名调用,不等 T-5
  - 上报协议(`types.ts` 里的 Ingest* 结构)不改;平台看到的仍是仓库内相对 POSIX 路径
  - 没有登记任何副本时,上报内容与改动前逐字相同
- 允许局部适配:
  - SyncContext 新增字段、PathResolver 新增参数的命名
  - 内部辅助函数的拆分与命名
  - 注释措辞
- 具体要求:
  1. **以主目录为准(D25)**:
     - runner.ts:`runSync`、`runWorker` 开头 `projectRoot = resolveMainRoot(projectRoot)`
     - cli.ts:各命令里的 `resolveProjectRoot(process.cwd())`(及 worker 的 `--project` 取值)外面包一层 `resolveMainRoot`
     - hooks.ts:`runSyncHook` 里 `const projectRoot = resolveMainRoot(resolveProjectRoot(cwd))`,其后的 `isInitialized`、`readConnection`、handler 都用它;`triggerWorker` 的触发文件改为 `path.join(getDataDir(projectRoot), TRIGGER_FILENAME)`
     - lock.ts:锁文件路径的拼法由 `getCodeGraphDir` 改为 `getDataDir`
  2. **路径(D26)**:
     - paths.ts:`createPathResolver(projectRoot, repoRoot, roots?)`;给了 roots 时 `fromAbs` 用 `matchProjectRoot(roots, abs)` 定根,`projectRel` 相对命中的根算;`RelPaths` 加 `root`(命中的根的绝对路径;`fromRepoRel`、`fromProjectRel` 可传入 root,不传为主目录);`repoRel` 照旧按主目录的「项目根在仓库内的相对位置」拼(副本整仓复制,布局相同)
     - payload.ts:`SyncContext` 加 `roots: ProjectRoot[]`(`createSyncContext` 里 `listProjectRoots(root)` 取一次)
     - artifacts.ts、references.ts:建 resolver 时传 `ctx.roots`;读文件头(`identifyArtifact`)和判断文件存在(`fs.existsSync`、`isExistingFile`)都在路径所在的根里做,那个根已不在就退回主目录
     - 提交在哪个根里做的,全文件只用一个内部函数判断:该提交事件 cwd 所在的根(`replicaOfCwd(ctx.roots, e.cwd)?.path`,不在副本里就是主目录);提交里的文件(`fromRepoRel`)落在这个根里,artifacts.ts 用 `ctx.commitEvents` 建 hash → 根的映射
     - 产出对提交:文件只对上同一个根里的提交(副本里的文件对副本里的提交,主目录的对主目录的),不跨根认
     - 在主目录写、开副本时移进副本的需求文件(spec D21⑥、D29):改它时所在的根是主目录、列在某个副本登记的 `movedFiles` 里、最后一次改早于这个副本的 `createdAt` → 这个产出的根算那个副本(改过之后最早开的那个,副本删了也算;读文件头、找提交都按副本),不看文件此刻在不在主目录——合入后文件回到主目录,归属不变;登记没有 `movedFiles`(以前的登记)时照旧推断:主目录里已没有这个文件、路径在这类副本登记的需求目录下、文件在那个副本里 → 那个副本
  3. **git 查询(D29)**:
     - git.ts:`GitCache` 加 `hasCommit(hash: string): boolean`(`git cat-file -e <hash>^{commit}`,结果缓存)
     - payload.ts:`SyncContext` 加 `gitFor(root: string): GitCache`(按根懒建、缓存;主目录返回现有的 `ctx.git`)
     - artifacts.ts:提交相关的查询(`fileAddedIn`、`isOnRemote`)先用主目录的 GitCache;`hasCommit` 为 false 且该提交的根是还在的副本 → 改用 `ctx.gitFor(副本 path)`;查推送没有也一样:主目录查不到就到提交所在的副本仓库查;`isTracked`、文件存在判断用路径所在的根
  4. **副本会话(D28,C-11)**,payload.ts:
     - `buildTerminalPayload` 只收 session_id 为空、`replicaOfCwd` 没命中副本的提交(主目录的终端提交)
     - 新增 `buildReplicaSessionPayloads(ctx): BuiltSession[]`:session_id 为空、命中副本的提交按副本分组,每组按 C-11 构造一个会话(id、空 events / references、commits、artifacts、一条绑定);绑定的 taskId、taskKey 取 `featureBindingTarget(ctx.projectRoot, 副本.featureId)`(C-13),`taskKey` 只在它不为 null 且协议支持任务键(与 `toIngestBinding` 的 `supportsTaskKey` 同一判断)时带
     - constants.ts:`REPLICA_SESSION_PREFIX = 'cgraphx-replica-'`
     - runner.ts 的 `collectChunks`:仓库终端会话之后,对 `buildReplicaSessionPayloads(ctx)` 的每个会话照终端会话的处理(`replaceUnreported`、`terminalNeedsSend` 判断后放进待发列表)
  5. 目录任务声明(D29):`taskDeclarationsFor` 不改;它调的 task 门面 `listMyFeatureTaskDeclarations` 已由 T-5 改成认副本里的需求目录
- 完成条件:
  - 没有登记副本时,一轮上报构造出的会话与改动前逐字相同(仓库终端会话 id、内容不变;不产生 `cgraphx-replica-` 会话)
  - 副本会话里的产出、提交文件路径都是仓库内相对路径,不含副本绝对路径
  - 每个改动的文件 ≤ 600 行(`runner.ts` 已 541 行:新增的构造逻辑放 payload.ts)
- 提交点:
  1. `feat(sync): 以主目录上报——副本路径换算 + 副本里没对上会话的提交单独成会话`:`src/core/sync/` 下 10 个文件
- 风险/注意事项:
  - 上报一轮会全量刷新任务归属(`refreshAutoBindings(projectRoot)`):传主目录;派生本身已由 T-5 做到与调用方的根无关
  - D28 平台侧还没确认:代码照 C-11 写完;若平台不支持,退回时只删第 4 条里构造副本会话的部分,让这些提交回到仓库终端会话(见 index 待确认项)
