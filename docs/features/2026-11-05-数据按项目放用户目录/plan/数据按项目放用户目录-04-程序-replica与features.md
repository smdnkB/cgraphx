# T-4 程序:replica 与 features

> 产物: plan
> 依据: spec@4d4bf55

- 目标:「是不是副本、主目录在哪」从基础层挪进 replica,只给版本流程和 features 用;副本登记改读本地 `.cgraphx/replicas/`;根汇总改成收外部传入的根(timeline 记下的根 + 当前根),再挂上这些根上的副本登记;按需求找目录改成「在用副本 → 当前根 → 其余还在的根(最近活动的在前)」。版本流程的开、列、删、合入行为不变。
- 对应 spec 编号:D8、D11、D22;全局约束「版本流程行为不变,副本登记的位置不变;数据不看 shared 链接和登记」
- 强制引用:`docs/guides/coding-standards.md`
- 涉及范围:
  - `src/core/replica/main-dir.ts`(新)、`roots.ts`、`registry.ts`、`create.ts`、`remove.ts`、`index.ts`、`types.ts`
  - `src/core/features/index.ts`
  - 既有测试:`__tests__/core/features/scanner.test.ts`(被本任务弄红时)
- 必须严格执行:
  - 门面按 index C-9;replica 照旧只依赖基础层(`directory`、`db`)与 agents 门面,不 import timeline、task、sync、project
  - `replicaLinkOf(projectRoot)` 的判定与改动前 `src/core/directory.ts` 里按 shared 链接找主目录的那个函数逐条相同(link 不在或不是符号链接 → own;目标不在 → main-missing;登记对得上且未删 → replica;其余 → own;任何异常 → own),只是返回 `mainRoot`(own 时 = `path.resolve(projectRoot)`,replica / main-missing 时 = 链接目标的上级目录,replica 取 realpath)
  - 代码和注释里都不写那个旧函数的名字(统一验证会 grep 它,写进注释也算命中)
  - 登记目录 `registryDir(mainRoot)` = `path.join(getCodeGraphDir(mainRoot), REPLICAS_DIRNAME)`(本地,不再经数据目录);`replicas/` 不在时只建这一层的规则不变
  - `remove.ts` 的第 4 条核对:shared 链接要指回 `realpath(getCodeGraphDir(mainRoot))`
  - `listProjectRoots`、`locateFeatureRoot` 按 C-9 的新签名与顺序;`matchProjectRoot`、`replicaOfCwd`、`listReplicas`、`resolveMainRoot`、`createReplica`、`listReplicaStatus`、`removeReplica` 签名与行为不变(`resolveMainRoot` 改为经 `replicaLinkOf` 取主目录)
  - features:`listFeatures` 里「在主目录才另外列出副本里的需求」的判断改成 `replicaLinkOf(projectRoot).state === 'own'`,其余不变
- 允许局部适配:
  - `matchProjectRoot`、`replicaOfCwd` 内部可以改用基础层 C-6 `createRootMatcher`,结果不变
  - `registry.ts` 新增「按登记目录读全部登记」的内部函数,给 `listProjectRoots` 读 shared 链接目标下的 `replicas/` 用
- 具体要求:
  1. `main-dir.ts`(新):实现 `replicaLinkOf`;读登记只读 `path`、`removedAt` 两个字段(同原实现)
  2. `roots.ts`:
     - `listProjectRoots(baseRoots, currentRoot)`:根路径集合 = baseRoots 的 `root` ∪ `currentRoot`(都 `path.resolve`);对集合里每个根 R 读登记:`registryDir(R)` 下的,以及 `getCodeGraphDir(R)/shared` 是符号链接时链接目标下 `replicas/` 的;同一个登记(name + path 相同)只算一次;每个登记一条 `ProjectRoot { replica: entry }`;集合里的根只有路径不等于任何登记的 `path.resolve(entry.path)` 时,才出一条 `ProjectRoot { replica: null }`(和登记同路径的只留登记那条,C-9);`lastActiveAt` 按路径从 baseRoots 取(没有为 null,登记那条同样按它的路径取);`realRoot` 照现在的 `realDir` 一次算好;按 `root` 长度降序(同长时 replica 为 null 的在前、登记按 createdAt)
     - `locateFeatureRoot(roots, featureId, currentRoot)`:① `replica` 非 null、`removedAt` 为 null、`featureId` 相同、目录里有这个需求目录的,按 createdAt 升序取第一个;② `currentRoot` 有这个需求目录 → 它;③ 其余 `root` 目录还在的(去掉已经看过的),按 `lastActiveAt` 降序(null 在后)取第一个有这个需求目录的;都没有 → null
     - `resolveMainRoot(projectRoot)` = `replicaLinkOf(projectRoot).mainRoot`
  3. `registry.ts`:`registryDir` 改本地;`readEntries(mainRoot)` 不变;文件头注释里「directory.ts 的 … 只读其中的 path、removedAt」那句改成「`main-dir.ts` 的 `replicaLinkOf` 只读其中的 path、removedAt」
  4. `create.ts`、`remove.ts`:`resolveDataDir` 换成 `replicaLinkOf`(`info.state`、`info.mainRoot` 的用法照旧);`remove.ts` 的 `getDataDir(mainRoot)` 换成 `getCodeGraphDir(mainRoot)`
  5. `types.ts`:`ProjectRoot` 加 `lastActiveAt`;加 `ReplicaLinkState`、`ReplicaLink`
  6. `index.ts`:导出 `replicaLinkOf` 和两个新类型;门面注释里「主目录与副本的路径换算」改成「根汇总:调用方传入 timeline 记下的根和当前根,这里挂上副本登记」
  7. 既有测试:被弄红的只改准备数据,断言意图不变
- 完成条件:
  - `grep -rn "resolveDataDir\|getDataDir" src/core/replica src/core/features` 无输出
  - `grep -rn "from '\.\./\(timeline\|task\|sync\|project\)" src/core/replica` 无输出
  - `grep -n "export function listProjectRoots" -A2 src/core/replica/roots.ts` 的参数是 `(baseRoots, currentRoot)`
- 提交点:
  1. `refactor(replica): 副本判断挪进 replica——登记读本地,数据侧不再看 shared 链接`:`main-dir.ts`、`registry.ts`、`create.ts`、`remove.ts`、`features/index.ts`,以及改过的 `scanner.test.ts`
  2. `feat(replica): 根汇总收外部传入的根——挂上各根的副本登记,找需求目录先副本再当前根`:`roots.ts`、`types.ts`、`index.ts`
- 风险/注意事项:
  - 本任务提交后,task、sync 里按旧签名调 `listProjectRoots(root)`、`locateFeatureRoot(roots, id)` 的地方编译不过,由 T-6、T-8 改;不要改那两个子系统的文件
  - 副本的开、删要原样能用:`assertMainDir`、`verifyTarget` 的五条核对只换取主目录的来源,不改判定
