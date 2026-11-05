# T-6 程序:task

> 产物: plan
> 依据: spec@4d4bf55

- 目标:task 的库和接口配置改走数据位置;根汇总改成「timeline 记下的根 + 当前根 + 这些根上的副本登记」,不再换成主目录;按会话办的命令按会话登记认项目;Stop hook 按会话的根刷新、只查本会话水位;派生按 ts 读事件;新增并 task 表。
- 对应 spec 编号:D8、D11、D14、D15、D28(派生按 ts、进度换算)、D29(task 表);K12、K17
- 强制引用:`docs/guides/coding-standards.md`、`docs/guides/data-standards.md`、`docs/guides/interface-standards.md`
- 涉及范围:
  - `src/core/task/schema-bootstrap.ts`、`source.ts`、`binding.ts`、`cli.ts`、`hooks.ts`、`auto-binding.ts`、`artifacts.ts`、`feature-task.ts`、`feature-link.ts`、`report.ts`、`resolve.ts`、`index.ts`、`roots.ts`(新)、`merge.ts`(新)
- 必须严格执行:
  - 新增门面按 index C-10;用到 timeline 的 C-8(`listTimelineRoots`、`listSessionEventMaxIdsFor`、`listSessionEventsByTs`、`EventIdMapping`)、replica 的 C-9、基础层的 C-4、C-5;task 只经各门面取数(`from '../timeline'`、`from '../replica'`),不 import sync、project
  - 全部 `resolveMainRoot(...)` 删掉:传进来的项目根就是当前根;全部 `listProjectRoots(root)` 换成 `collectProjectRoots(projectRoot)`,调用方一轮里取一次 `ProjectRootSet` 传下去;`locateFeatureRoot` 一律带 `currentRoot`
  - 「主目录兜底」的地方(需求目录哪里都没有、读文件的根已不在等)改成当前根
  - 库:`openTaskDb(start)` 用 `ensureDataDir`,null → `TaskConfigError(missingDataMessage(locateData(start)))`;`openTaskDbReadOnly(start)` 用 `getDatabasePath`,null 或库文件不在 → 同样的 `TaskConfigError`(其余判断不变,不应用 schema、不建目录);删掉 `missingDbMessage` 里 `main-missing` 的分支
  - 接口配置(`source.ts`):`getTaskSourceConfigPath(start)` 改为 `string | null`(`getDataDir` 为 null → null);`loadTaskSourceConfig` 路径为 null → 返回 null;`writeTaskSourceConfig` 目录 = `ensureDataDir(start)`,null → `TaskConfigError(missingDataMessage(…))`,0600 不变;`removeTaskSourceConfig` 路径为 null → false
  - D14:`task use`、`task current`、`task clear` 先 `requireSessionId`,项目根 = `readSessionRegistration(会话 id)?.root ?? resolveProjectRoot(process.cwd())`;其余 task 命令照旧 `resolveProjectRoot(process.cwd())`
  - Stop hook(`hooks.ts` 的 `taskStopHook`):根 = `sessionRootOf(payload.sessionId, process.env[profile.projectDirEnv] ?? payload.cwd ?? process.cwd())?.root`;为 null、或 `getDataDir(根)` 为 null → 直接返回(不写 stderr);其余照旧(首轮全量、之后只刷本会话)。`taskSessionStartHook` 不变
  - D15:`refreshAutoBindings` 给了 `sessionIds` 时,水位用 `listSessionEventMaxIdsFor(currentRoot, sessionIds)`;没给照旧 `listSessionEventMaxIds`
  - D28:派生读会话事件改用 `listSessionEventsByTs`;`deriveSessionAutoBinding` 的入参事件约定改成「ts 升序、同 ts 按 id」,「会话开在哪个副本」取 ts 最早的那条事件(`events[0]`)
  - 并 task 表(`merge.ts`,D29)照下面「具体要求 6」
- 允许局部适配:
  - task 内部函数改收 `ProjectRootSet` 还是收 `(roots, currentRoot)` 两个参数
  - `merge.ts` 的 SQL 写法、内部拆分
- 具体要求:
  1. `roots.ts`(新):实现 C-10 `collectProjectRoots(start)`;`currentRoot = findProjectRoot(start) ?? path.resolve(start)`;timeline 根转成 `{ root, lastActiveAt: lastTs }`
  2. `feature-task.ts`:`eligibleFeatureRoot`、`isEligibleFeatureDir`、`declaredTaskOf`、`resolveFeatureTargetReadOnly` 改收 `ProjectRootSet`;`scanFeatureTasksAcrossRoots(rootSet)`:候选根依次是 ① 在用副本(登记了需求的)② 当前根 ③ 其余目录还在的根(lastActiveAt 降序);对每个候选根 R 跑 features 门面的 `scanFeatureTasks(R)`,只留 `locateFeatureRoot(roots, featureId, currentRoot) === R` 的条目,`path` 照旧是项目相对路径 `docs/features/<featureId>`;同一 featureId 只出一条。`listMyFeatureTaskDeclarations`、`recordFeatureTaskMappings`、`featureBindingTarget` 去掉 `resolveMainRoot`,根汇总用 `collectProjectRoots`
  3. `auto-binding.ts`:按「必须严格执行」改 D15、D28、根汇总;文件头注释里「一律以主目录为准」改成「以当前根为准,路径按 timeline 记下的根 + 当前根 + 副本登记换算」
  4. `artifacts.ts`:上下文里的 `mainRoot` 改成 `currentRoot`;`locateFeatureRoot` 带 `currentRoot`;找不到需求目录 → 当前根
  5. `feature-link.ts`、`report.ts`、`resolve.ts`:去掉 `resolveMainRoot`,根汇总用 `collectProjectRoots`;`report.ts` 的只读约定不变(经 `openTaskDbReadOnly`)
  6. `merge.ts`(新)`mergeTaskTables(oldDb, projectDb, mapping)`,规则照 spec D29 表的 task 行,逐表:旧库没有这张表就跳过;项目库写入包在一个 `BEGIN IMMEDIATE` 事务里(旧库的事务由调用方 T-9 持有,这里不开旧库事务)
     - `task_items`:接口任务按 `external_id`、本地任务按 `name` 对上就用项目库已有的 id;对不上就插入新行(除 id 外各列照旧库);记 旧任务 id → 新任务 id
     - `task_feature_tasks`:按 `feature_id` 对上就用已有的(已有 `platform_task_id` 的不改,没有的补上旧库的);对不上照 store 现有的目录任务 id 规则(`max(FEATURE_TASK_ID_BASE, MAX(id) + 1)`)新建;记 旧 id → 新 id(并进任务 id 对照,`task_reminders` 等引用目录任务 id 时用)
     - `task_sessions`:`task_id` 换算后,同一 `session_id`、同一 `task_id`、同一 `bound_at` 的算重复(用已有行的 id);这个会话在项目库已有生效绑定(`unbound_at IS NULL`)时,旧库的生效绑定不并;其余插入;记 旧绑定 id → 新绑定 id
     - `task_superseded_bindings`:`binding_id` 换算后插入;换算不到(指向没并的绑定)或已存在的跳过
     - `task_reminders`:`bound_task_id`、`other_task_id` 换算后 `INSERT OR IGNORE`;换算不到的跳过
     - `task_auto_sessions`:项目库没有这个会话 → 插入,`derived_max_event_id = mapping.mapProgress(session_id, 旧值)`,其余列照旧;有 → 不动(K12 不重算)
     - `task_auto_meta`:项目库没有 `history_pass_done` 才写旧库的值
  7. `index.ts`:导出 `collectProjectRoots`、`mergeTaskTables`、类型 `ProjectRootSet`;门面注释改写根汇总的说法
- 完成条件:
  - `grep -rn "resolveMainRoot\|resolveDataDir" src/core/task` 无输出
  - `grep -rn "listProjectRoots(" src/core/task` 只在 `roots.ts` 里出现
  - `grep -rn "listSessionEventsAfter(" src/core/task/auto-binding.ts` 无输出;`grep -n "listSessionEventsByTs\|listSessionEventMaxIdsFor" src/core/task/auto-binding.ts` 两个都有命中
  - `grep -rn "from '\.\./\(sync\|project\)" src/core/task` 无输出
- 提交点:
  1. `refactor(task): 库和接口配置走数据位置——根汇总改成 timeline 记下的根 + 当前根,不再换成主目录`:`schema-bootstrap.ts`、`source.ts`、`roots.ts`、`feature-task.ts`、`artifacts.ts`、`feature-link.ts`、`report.ts`、`resolve.ts`、`index.ts`
  2. `feat(task): 按会话认项目——task use/current/clear 与 Stop hook 读会话登记,Stop 只查本会话水位,派生按 ts 读事件`:`binding.ts`(有改动时)、`cli.ts`、`hooks.ts`、`auto-binding.ts`
  3. `feat(task): 并旧库的 task 表——任务按键对上、绑定去重、派生进度换算`:`merge.ts`(`index.ts` 的导出若第 1 笔没带上,放这一笔)
- 风险/注意事项:
  - Stop hook 预算 50ms:根汇总一轮只取一次;`listTimelineRoots` 一条查询;不要为了找根去跑 git
  - `featureBindingTarget` 被 sync 按旧签名调用,签名不能变
  - 本仓库没有 task 的既有测试;不要新写测试
