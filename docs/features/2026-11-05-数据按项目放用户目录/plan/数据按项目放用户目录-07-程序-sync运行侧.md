# T-7 程序:sync 运行侧

> 产物: plan
> 依据: spec@4d4bf55

- 目标:sync 的库、锁、存活标记、触发文件都在数据位置(一个项目一个 worker,哪个根触发都一样);hook 按会话登记认项目;上报一律按接入时存下的 origin;`sync status` 显示上报地址;精确参考按会话登记认项目;新增并 sync 表与平台连接。
- 对应 spec 编号:D8、D13、D14(`docs find / show` 记参考)、D29(sync 表、平台连接);K5、K12
- 强制引用:`docs/guides/coding-standards.md`、`docs/guides/data-standards.md`、`docs/guides/interface-standards.md`
- 涉及范围:
  - `src/core/sync/schema-bootstrap.ts`、`lock.ts`、`hooks.ts`、`runner.ts`、`connection.ts`、`cli.ts`、`status.ts`、`platform-spec.ts`、`types.ts`、`store.ts`、`index.ts`、`merge.ts`(新)
  - 既有测试:`__tests__/core/sync/protocol-version.test.ts`(被本任务弄红时)
- 必须严格执行:
  - 按 index C-11;用到 task 的 C-10(本步 T-6 实现,照签名调用)、timeline 的 C-8(`EventIdMapping`)、基础层 C-4、C-5;调 `createSyncContext` 用 T-8 本步实现的新签名(C-11),不等 T-8
  - 全部 `resolveMainRoot(...)` 删掉;CLI 命令的项目根 = `resolveProjectRoot(process.cwd())`;`sync-worker --project <根>` 收到的根就是当前根
  - 库(写):`openSyncDb(start)` 用 `ensureDataDir`,null → `SyncNotInitializedError(missingDataMessage(locateData(start)))`;删掉 `main-missing` 分支
  - 库(读,全局约束 3「读的一方不建」):`schema-bootstrap.ts` 新增 `openSyncDbForRead(start)`——`getDatabasePath(start)` 为 null 或库文件不在 → `SyncNotInitializedError(missingDataMessage(…))`;在就 `DatabaseConnection.open`,不应用 schema;没有 `sync_schema_versions` 表 → 关库后抛同一个错。只读的几处改用它:`status.ts` 的 `getSyncStatus`、`platform-spec.ts` 的 `readCachedProjectArtifactTypes`、`hooks.ts` 的 `readStatus`(抛 `SyncNotInitializedError` 时按 `emptyStatus()` 处理,不提示)、`connection.ts` 的 `readStoredConnection`(抛这个错时按 null 处理)
  - `isInitialized` 的替换:`status.ts` 开头 `!isInitialized(projectRoot)` 改成「`getDatabasePath(projectRoot)` 为 null 或库文件不在」,其后照现在返回只带 connection 的报告;`platform-spec.ts` 的 `readCachedProjectArtifactTypes` 同样判断,不在 → `null`,打开失败(`SyncNotInitializedError`)也 → `null`;两处都不调 `ensureDataDir`
  - 锁、存活标记、触发文件(`lock.ts`、`hooks.ts`):目录 = `getDataDir(start)`;null → 取锁、认领 worker 返回 false,`isWorkerAlive` 返回 false,释放、刷新什么都不做,不建目录;标记文件只在已在的数据目录里 `wx` 创建(规则不变)
  - hook(`hooks.ts`):根 = `sessionRootOf(raw.session_id 是字符串时取它否则 null, process.env[profile.projectDirEnv] ?? cwd)?.root`;为 null、`getDataDir(根)` 为 null、`readConnection(根)` 为 null → 静默返回;不再用 `isInitialized`;拉起 worker 用 `spawnSyncWorker(根)`
  - 上报地址(D13):
    - `SyncConnection` 加 `remoteUrl`(C-11),`store.ts` 的 `setConnection` 写、`getConnection` 读(旧值没有该键 → null);手写的 `SyncConnection` 对象字面量一律补上 `remoteUrl`(现有的在 `status.ts` 返回未初始化报告那处、`status.ts` 里 `getConnection(db) ?? {…}` 那处、`connection.ts` 已接入分支 `stored ?? {…}` 那处,填 `null`;`connectLocked` 里新建的连接填这次的 `remoteUrl`)
    - `connectPlatform`:前置检查改成 `ensureDataDir(projectRoot)` 非 null(否则 `SyncNotInitializedError(missingDataMessage(…))`);`remoteUrl = getOriginUrl(projectRoot)`(没有照旧报「本仓库没有 origin 远程地址」);接入成功时连接里存这个 `remoteUrl`
    - 已接入(task-source.json 有凭据)且没给 `--force`:存的 `remoteUrl` 不为 null 且和这次的不同 → 用存的地址做状态探测,返回 `kind: 'already'`,带 `notice` = C-14 的 M19;存的为 null → 把这次的 origin 补存进连接,照现在走 already;`--force` → 照现在重新接入(清空上报进度、全部重报),存这次的 origin
    - `runner.ts` 新增并导出 `resolveReportRemoteUrl(db: SqliteDatabase, start: string, opts: { save: boolean }): string | null`:连接里的 `remoteUrl` 不为 null 就用它;为 null 时取 `getOriginUrl(start)`,`save` 为真且取到了就写回连接;都没有 → null。`runSync` 里暂停探测、类型表刷新、`createSyncContext` 都用它(`save: true`);取不到 → 本轮按 `failing` 结束,错误文案沿用「当前仓库没有 origin 远程地址,请先运行 \`git remote add origin <url>\`」
    - `status.ts` 用 `resolveReportRemoteUrl(…, { save: false })`(status 只读,不写库);取不到就不算积压(照现在 SyncError 时的处理)
    - `cli.ts` 的 `renderStatus` 在「平台地址」下一行加 `上报地址:<connection.remoteUrl ?? '-'>`;`renderConnect` 对带 `notice` 的 already 结果先打 notice
  - D14:`recordReferenceHit(projectRoot, hit)` 里,会话 id 有值时根 = `readSessionRegistration(会话 id)?.root ?? projectRoot`;`getDataDir(根)` 为 null → 直接返回;照旧绝不抛错、绝不输出
  - `disconnectPlatform`:`isInitialized` 换成 `getDataDir(projectRoot) !== null`
  - 并 sync 表(`merge.ts`,D29)照下面「具体要求 5」
- 允许局部适配:
  - `ConnectOutcome` 里 `notice` 的放法(只要 already 结果能带上 M19)
  - `merge.ts` 内部拆分与 SQL 写法
- 具体要求:
  1. `schema-bootstrap.ts`、`lock.ts`:按「必须严格执行」;文件头注释里「副本里经 `.cgraphx/shared` 落在主目录」改成「在数据位置:并过的目录在用户目录的项目目录里,同一项目的各个目录共用一把锁、一个 worker」
  2. `hooks.ts`、`runner.ts`、`connection.ts`、`status.ts`、`cli.ts`、`types.ts`、`store.ts`:按「必须严格执行」
  3. `runner.ts` 的 `runSync`、`runWorker` 去掉 `resolveMainRoot`;`refreshAutoBindings(projectRoot)` 传当前根
  4. `index.ts`:导出 `mergeSyncTables`、类型 `SyncMergeInput`
  5. `merge.ts`(新)`mergeSyncTables(input)`,`input` 按 C-11 的 `SyncMergeInput`(`mergingRoot` 是并的那个目录,取它的 origin 用);规则照 spec D29 表的 sync 与平台连接两行;旧库没有某张表就跳过那部分;项目库写入包在一个 `BEGIN IMMEDIATE` 事务里(旧库事务由 T-9 持有)
     - 平台连接:旧 = `<oldDataDir>/task-source.json`(原文,不在为空)+ 旧库 `sync_state` 的 `connection`(没有这张表或这个键为空);新 = `<projectDataDir>/task-source.json` + 项目库 `sync_state` 的 `connection`。按顺序判断:
       - 旧的都没有(旧 task-source.json 不在,且旧库没有 `connection`):平台连接什么都不做、不提示
       - 项目里都没有(新 task-source.json 不在,且项目库没有 `connection`):旧的 task-source.json 在就原样复制过去(复制后 chmod 0600);旧库 `sync_state` 的键全部复制过去;`connection.remoteUrl` 为 null 时补上 `getOriginUrl(mergingRoot)`
       - 一样(两份 task-source.json 都在或都不在、在的话逐字相同,且两边 `connection` 的 `serverUrl` 相同、`remoteUrl` 相同——旧的为 null 时拿 `getOriginUrl(mergingRoot)` 比):什么都不做
       - 其余:留项目里的,`notices` 加 M2 的平台连接那句(`<目录名>` = `input.dirName`)
     - `sync_sessions`:只在「接的是同一个平台」(index C-11 定义)或上一条走了「项目里都没有、整份搬过去」时并;其余(旧库没有 `connection`、两边平台地址或上报地址不同)整张表不并,这些会话按项目库的连接重报。并的时候逐行:`newLast = mapping.mapProgress(client_session_id, last_event_id)`;项目库没有这一行 → 插入(其余列照旧库);有 → 项目库这一行的 `last_event_id` 等于 `mapping.projectMaxIdBefore(client_session_id)` 时取 `max(项目库值, newLast)`,否则不动
     - `sync_reference_records`:按 `(session_id, kind, value)` 唯一键 `INSERT OR IGNORE`(不带旧 id)
     - `sync_unreported_artifacts`:按主键 `INSERT OR IGNORE`
- 完成条件:
  - `grep -rn "resolveMainRoot\|resolveDataDir\|main-missing" src/core/sync` 无输出
  - `grep -rn "isInitialized" src/core/sync` 无输出
  - `grep -n "openSyncDbForRead" src/core/sync/status.ts src/core/sync/platform-spec.ts src/core/sync/hooks.ts src/core/sync/connection.ts` 四个文件都有命中
  - `grep -rln "getOriginUrl" src/core/sync --include='*.ts'` 只列出 `git.ts`、`connection.ts`、`runner.ts`、`merge.ts`(`payload.ts` 由 T-8 删掉它的调用)
  - `grep -n "上报地址" src/core/sync/cli.ts` 有命中
- 提交点:
  1. `refactor(sync): 库、锁、触发文件走数据位置——hook 按会话登记认项目,一个项目一个 worker,读的地方不建目录`:`schema-bootstrap.ts`、`lock.ts`、`hooks.ts`、`platform-spec.ts`
  2. `feat(sync): 按接入时的 origin 上报——连接里存上报地址,换目录接入只提示,status 显示上报地址`:`runner.ts`、`connection.ts`、`status.ts`、`cli.ts`、`types.ts`、`store.ts`,以及改过的 `protocol-version.test.ts`
  3. `feat(sync): 并旧库的 sync 表与平台连接——进度按事件对照表换算,配置不一样留项目里的`:`merge.ts`、`index.ts`
- 风险/注意事项:
  - 平台按 origin 原样认项目:存、发的都是 `git remote get-url origin` 的原样结果,不要用规整后的地址
  - hook 里不发网络请求、不等子进程的规则不变
  - 本任务和 T-8 同时改 sync:`payload.ts`、`artifacts.ts`、`paths.ts`、`references.ts`、`git.ts` 归 T-8,不要碰
