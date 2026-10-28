# T-5: 程序——task 多根换算与副本会话归属

> 产物: plan
> 依据: spec@c1c2920

- 目标:task 的路径换算、找需求目录都认「主目录 + 全部登记过的副本」;副本里开的会话归副本登记的需求;副本里没对上会话的提交算进该需求的 `task show`;在副本里执行和在主目录执行结果一样
- 对应 spec 编号:F8(行为链、①②)、K2、D25、D26、D27、D28(本地部分)、D29(目录任务声明找目录)
- 强制引用:`docs/guides/coding-standards.md`
- 涉及范围:
  - `src/core/task/auto-binding.ts`
  - `src/core/task/artifacts.ts`
  - `src/core/task/feature-task.ts`
  - `src/core/task/report.ts`
  - `src/core/task/feature-link.ts`
  - `src/core/task/resolve.ts`
  - `src/core/task/index.ts`
- 必须严格执行:
  - 按 C-4:只经 `from '../replica'` 用 `resolveMainRoot`、`listProjectRoots`、`matchProjectRoot`、`replicaOfCwd`、`locateFeatureRoot`、`listReplicas`
  - 按 C-13:在 feature-task.ts 实现 `featureBindingTarget`,签名与规则逐字照 C-13,经门面 index.ts 导出(T-6 同一步照签名调用)
  - 已有导出函数的名字和签名一律不变(调用方 sync、web、cli 不改)
  - 没有登记任何副本时,所有函数的结果与改动前逐字相同
- 允许局部适配:
  - 内部辅助函数的拆分与命名(如多根版的 toProjectRelative、normalizeProjectFile)
  - `DeriveSessionAutoBindingInput` 新增字段的命名(它只在 task 内部和测试里用)
  - 注释措辞
- 具体要求:
  1. **以主目录为准(D25)**:下列导出函数开头先 `const root = resolveMainRoot(projectRoot)`,之后一律用 root:`refreshAutoBindings`(auto-binding.ts)、`listEffectiveBindings`、`listTaskSummaries`、`getTaskReport`(report.ts)、`getTaskDetail`(feature-link.ts)、`listMyFeatureTaskDeclarations`、`recordFeatureTaskMappings`(feature-task.ts)。
  2. **找需求目录(D26)**,feature-task.ts:
     - `isEligibleFeatureDir(projectRoot, featureId)`:单段校验照旧;`const r = locateFeatureRoot(projectRoot, featureId)`,为 null → false;否则 `readFeatureOwner(r, featureId) !== null`
     - 读需求目录头部(`readFeatureTask`、`readFeatureOwner`)的地方,一律先 `locateFeatureRoot(root, featureId) ?? root` 再读
     - 新增内部函数 `scanFeatureTasksAcrossRoots(root)`:`scanFeatureTasks(root)` 的结果,再按每个在用副本(`listReplicas(root)`)登记的那个需求修正——`locateFeatureRoot(root, featureId)` 指向这个副本时(C-4 先找副本),去掉主目录里同一 feature-id 的那条,`readFeatureTask(副本 path, featureId)` 不为 null 时加一条 `{ featureId, path: 'docs/features/<featureId>', task }`(主目录留下的空壳不算数);report.ts、feature-link.ts 里原来调 `scanFeatureTasks(projectRoot)` 的地方改调它
  3. **路径换算(D26)**:
     - auto-binding.ts 的 `toProjectRelative`:改为 `matchProjectRoot(roots, path.resolve(base, candidate))?.rel ?? null`;`featureFromPath` 其余逻辑不变(`FEATURE_DIR_PATTERN`、`requireExisting` 时对绝对路径 statSync)
     - artifacts.ts 的 `normalizeProjectFile`:绝对路径 → `matchProjectRoot` 得到所在根和 rel;rel 含 `..` 或空段照旧丢弃;文件是否存在先在所在根里判断,所在根已不在(副本删了)再到主目录里判断;相对路径照旧按主目录解析
     - `collectOutputs` 里提交事件的 `commit_files`(相对路径):所在根取提交所在的根——`replicaOfCwd(roots, e.cwd)` 命中的副本 path,没命中为主目录;存在判断先在这个根里做,根已不在再到主目录判断;得到的相对路径不变(副本里还没合入的文件也算产出)
     - artifacts.ts 的 `collectOutputs` 列需求目录下的文件:每个 `docs/features/<id>` 先 `locateFeatureRoot(root, id) ?? root` 再列
     - `collectOutputs`、`collectReferences` 的 roots 由调用方(report.ts)按 `listProjectRoots(root)` 取一次传入,或在函数内取一次;不要每个文件取一次
  4. **副本会话的归属(D27、K2)**,auto-binding.ts:
     - `deriveSessionAutoBinding` 的输入加上 roots;函数内取本会话 id 最小的一条事件的 cwd,`replicaOfCwd(roots, cwd)` 命中副本 → 结果 `{ featureId: 副本.featureId, strength: 'write', boundAt: 全部事件里最早的 ts }`;但 `cutoffTs` 不为 null 且最早一条事件的 ts 不早于 cutoffTs 时,结果为 null(显式绑定优先,F8②);命中副本时不再按读写的文件派生(F8①),也不要求需求目录合格
     - 没命中副本(主目录的会话)→ 照旧 R1~R7,只是路径按第 3 条换算、合格判断按第 2 条
     - `refreshAutoBindings` 里 `roots = listProjectRoots(root)` 取一次,传给每个会话的派生;`readFeatureTask(root, auto.featureId)` 改为在 `locateFeatureRoot(root, auto.featureId) ?? root` 上读
     - 需求 → 本机任务行的规则收成一个内部函数:主 spec 头部声明了平台编号(`isPlatformTaskValue`)→ 补建接口任务占位;否则建目录任务。会话派生到需求时用它;另外每个在用副本登记的需求也用它补一行(副本里只有终端提交、没有会话时,`task show <需求>` 也查得到),补行有三个限制:只在全量刷新时做(`opts.sessionIds === undefined`;Stop hook 只刷新本会话,不做);需求目录合格(`isEligibleFeatureDir`,有带负责人的 spec)才建,spec 还没写时不建;先按头部当前的声明查——声明了平台编号查接口任务、否则查目录任务,已有就不开写事务
  5. **副本里没对上会话的提交(D28 本地)**,feature-link.ts 的 `getTaskDetail`:这个任务的需求目录取任务详情里的 `featureDirs`(目录任务是它自己;接口任务是头部声明了它的需求目录,sync 上报时副本会话也绑到这个任务),取 `listCommitEvents(root)`(timeline 门面)里 `session_id === null`、`replicaOfCwd(roots, e.cwd)?.featureId` 是这些需求目录之一的事件,按 id 并进归属事件(去重、按 ts 再 id 排序)后再算 `commits`、`eventCounts`、`events`;`TaskDetail` 类型和输出字段不变。
  6. **需求目录对应的平台任务(C-13)**,feature-task.ts:新增导出 `featureBindingTarget(projectRoot, featureId)`,规则逐条照 C-13;「是 `T-<n>`」用文件里现有的 `isPlatformTaskValue` 判断(导出给 auto-binding.ts 用,task 里不另写平台编号的正则);index.ts 在 feature-task 那组导出里加上它。
  7. **按 feature-id 查任务**,resolve.ts 的 `findTaskByValue`:按目录任务名没找到时,参数是单段目录名(不含 `/`、`\`,不是 `.`、`..`)→ 照 `resolveFeatureTargetReadOnly` 落到这个需求目录对应的任务(头部声明了平台编号的,就是那个接口任务);带路径的参数不拿去拼需求目录。
- 完成条件:
  - 没有登记副本时:`task list --local --json`、`task show <任意任务> --json` 的输出与改动前逐字相同(统一验证 3 比对目录任务名)
  - 在副本里调用上面第 1 条列出的函数,与在主目录调用结果相同
  - `featureBindingTarget` 能从 `src/core/task/index.ts` 导入,签名与 C-13 一致
  - 每个改动的文件 ≤ 600 行
- 提交点:
  1. `feat(task): 副本会话归属——按主目录和副本换算路径 + 副本里的会话归登记的需求`:`src/core/task/auto-binding.ts`、`artifacts.ts`、`feature-task.ts`、`report.ts`、`feature-link.ts`、`resolve.ts`、`index.ts`
- 风险/注意事项:
  - sync 的上报进程会顺手全量刷新归属(`src/core/sync/runner.ts` 调 `refreshAutoBindings`):派生结果不能依赖调用方的项目根,只能依赖 roots 和事件本身
  - 副本删掉后,登记保留(removedAt 非空)仍在 roots 里:旧会话的归属和路径照样换算,重算结果不变
  - `task/store.ts` 已 567 行,本任务不往里加代码
