# T-3 程序:timeline 读取、并旧事件与卸载

> 产物: plan
> 依据: spec@4d4bf55

- 目标:timeline 的读一律只读打开、不建目录不写库;新增按 `timeline_roots` 的读取(根列表、按目录的汇总、受影响的根下的事件数)、按会话取水位、按 ts 取会话事件;统计的文件排行按项目根换算路径;新增并旧事件的合并器(两段并、去重、id 对照与进度换算);卸载时同一仓库还有装着的目录就留 git 钩子,`--purge` 不再删数据。
- 对应 spec 编号:D10、D11(根列表)、D12、D15、D16、D19(N 的口径)、D28、D29(timeline 表)、D31(timeline 部分)、D32、D33(计数);K4、K10、K12、K13、K16
- 强制引用:`docs/guides/coding-standards.md`、`docs/guides/data-standards.md`、`docs/guides/interface-standards.md`
- 涉及范围:
  - `src/core/timeline/store.ts`、`stats.ts`(新)、`roots.ts`(新)、`merge.ts`(新)、`indexer.ts`、`index.ts`、`types.ts`、`installer.ts`、`cli.ts`
  - 既有测试:`__tests__/core/timeline/` 下 `store.test.ts`、`store.timezone.test.ts`、`installer.test.ts`、`cli-format.test.ts`(被本任务弄红时)
- 必须严格执行:
  - 对外接口按 index C-8,经 `index.ts` 导出;打开库用 T-2 同一步实现的 C-7 `openTimelineDbForRead`(读)——照签名调用,不等 T-2
  - 读路径按 C-8「读路径一律…」那条;读 `timeline_events`、`timeline_roots` 前先查 `sqlite_master` 有没有这张表(旧库可能还没被新版写过)
  - 统计(D12):`stats()` 挪进 `stats.ts`(`TimelineStore.stats` 保留为调用它的薄方法,签名不变);读、写文件排行在计数前换算:根列表 = 同一个库的 `timeline_roots` 全部 `root`,用 C-6 `createRootMatcher`;工具参数里的绝对路径 → 匹配中的取 `rel`;提交的每个文件(仓库相对路径)先 `path.join(提交的 cwd, 文件)` 再匹配,中了取 `rel`;都不中照原样计(项目外的路径、相对路径不动)。SELECT 加上 `cwd` 列
  - 合并器(D27、D28、D29 timeline 部分)照 C-8 原文;「同一条事件」= 除 `id` 外各列都相同(NULL 用 `IS` 比),`git_commit` 只比 `commit_hash`(项目库里已有同 hash 的 `git_commit` 就算重复);旧事件按 id 升序插入;`mapProgress` 按 C-8 的规则(含「旧库里没有事件的会话」那条);写进项目库 `timeline_roots` 的根按 C-8 取 realpath
  - `countEventsUnderRoots` 照 C-8 口径;「落在根下」用 `createRootMatcher(roots).match(cwd, { allowSelf: true })` 判断
  - 卸载(D31,`installer.ts`):`uninstallTimelineHooks` 按 C-8 末尾的签名;`keepGitHook` 不为真时先调 C-2 `listOtherInstalledDirs(resolvedRoot)`,非空 → 不动 git 钩子片段,`gitHookKeptFor` 记这个列表;为空 → 照现在删片段,`gitHookKeptFor: []`。删掉 `purgeData` 选项、DROP 表的分支和「这是副本,数据在主目录」的拒绝;`installTimelineHooks` 里 `purgeFirst` 调卸载时去掉 `purgeData` 参数;`installTimelineHooks` 其余行为不变
  - `cli.ts` 的 `timeline uninstall`:`--purge` 选项保留(旧脚本不报错),说明改成 `已不再删数据;项目的数据用 cgraphx project remove 删`;给了 `--purge` 时,卸载完向 stderr 打 C-14 的 M14(前缀 `[timeline] `,目录名取 `locateData(projectRoot).projectDirName`);stdout 照旧只有 JSON 报告;任一报告 `gitHookKeptFor` 非空时,stderr 打一行 `[timeline] <目录用、连> 还装着 cgraphx,git 钩子留着`
- 允许局部适配:
  - 合并器的分批大小、去重查询写法、per-session 进度对照的内存结构
  - `roots.ts`、`stats.ts`、`merge.ts` 内部拆分;`store.ts` 新增方法放 store 还是放新文件
  - `listTimelineRoots` 是同步函数(给 task 的同步代码用),其余新增读函数沿用门面 async 习惯
- 具体要求:
  1. `store.ts`:
     - 新增 `listSessionMaxIdsFor(sessionIds)`:`SELECT session_id, max(id) … WHERE session_id IN (…) GROUP BY session_id`,一次最多 500 个参数,超过分批;空数组直接返回 `[]`
     - 新增 `listSessionEventsByTs(sessionId)`:`ORDER BY ts ASC, id ASC`
     - `stats` 主体挪到 `stats.ts`
  2. `roots.ts`(新):`listTimelineRoots(start)`(经 `openTimelineDbForRead`,打开失败——库不在、认不出项目——返回 `[]`)、`readTimelineSummary(dataDir)`(`<dataDir>/cgraphx.db` 不在 → null;在就 `DatabaseConnection.open` 只读查询,不应用 schema)、`countEventsUnderRoots(dataDir, roots)`(库不在 → 0;会话的「第一条事件」按 ts 最早、同 ts 按 id);两个返回根列表的函数都按 `lastTs` 降序
  3. `merge.ts`(新):`createTimelineMerger(oldDb, projectDb)`、`maxTimelineEventId(db)`:
     - 建时:取旧库里出现的会话,查项目库这些会话的 `max(id)`,存成 `projectMaxIdBefore` 的数据
     - `mergeEventsUpTo(N)`:旧库 `id ≤ N` 按 id 升序分批读;每批在项目库一个 `BEGIN IMMEDIATE` 事务里逐条去重或插入(插入时写除 id 外的全部列),记 旧 id → 新 id
     - `mergeTail(afterId, attributionRoots)`:同样处理 `id > afterId`(调用方已持旧库写锁,这里不碰旧库事务);然后并 `timeline_roots`:候选根 = `attributionRoots` ∪ 旧库 `timeline_roots` 的根;每个旧会话按它第一条事件(ts 最早)的 cwd、每个 `git_commit` 按自己的 cwd,用 `createRootMatcher(候选根).match(cwd, { allowSelf: true })` 归到根,该根的最早、最近活动取归到它的事件 ts 的最小、最大;旧库 `timeline_roots` 已有的行一并取较早的 `first_ts`、较晚的 `last_ts`;最后 upsert 进项目库(冲突时 `first_ts` 取较小、`last_ts` 取较大,同 C-7 的 upsert 写法)
     - 归根要用的「每个会话第一条事件的 cwd、各事件 ts」在两段处理事件时顺手累计,不在 `mergeTail` 里重读整张旧表
     - `timeline_meta`、`timeline_schema_versions` 不并
  4. `indexer.ts`:既有门面函数全部改用 `openTimelineDbForRead`;新增 `listSessionEventMaxIdsFor`、`listSessionEventsByTs` 的门面包装
  5. `index.ts`:按 C-8 增加导出(`listTimelineRoots`、`listSessionEventMaxIdsFor`、`listSessionEventsByTs`、`readTimelineSummary`、`countEventsUnderRoots`、`maxTimelineEventId`、`createTimelineMerger`、`ensureTimelineSchema`、`TURNS_DIRNAME`,以及类型 `TimelineRoot`、`TimelineDataSummary`、`EventIdMapping`、`TimelineMergeStats`、`TimelineMerger`);既有导出(含 `installTimelineHooks`、`uninstallTimelineHooks`)不删
  6. `types.ts`:放上面新增的类型
  7. `installer.ts`、`cli.ts`:按「必须严格执行」的卸载两条
  8. 既有测试:被弄红的只改准备数据(如需要 `timeline_roots` 的,建表即可)与调用方式(`uninstallTimelineHooks` 去掉 `purgeData` 后,purge 用例改成断言数据还在、stderr 有 M14),断言意图不变
- 完成条件:
  - `grep -n "ensureTimelineSchema\|openTimelineDb(" src/core/timeline/indexer.ts src/core/timeline/roots.ts src/core/timeline/stats.ts` 无输出(读路径不应用 schema、不走写打开)
  - `grep -n "export" src/core/timeline/index.ts` 含 C-8 列的全部新名字
  - `grep -n "purgeData\|DROP TABLE" src/core/timeline/installer.ts` 无输出;`grep -n "gitHookKeptFor" src/core/timeline/installer.ts` 有命中
  - `src/core/timeline/store.ts`、`stats.ts`、`merge.ts` 各不超过 600 行
- 提交点:
  1. `feat(timeline): 读路径只读打开——按会话取水位、按 ts 取事件、统计按项目根换算路径`:`store.ts`、`stats.ts`、`roots.ts`、`indexer.ts`、`types.ts`、`index.ts`,以及改过的 `store.test.ts`、`store.timezone.test.ts`
  2. `feat(timeline): 并旧事件的合并器——两段并、去重、id 对照与进度换算`:`merge.ts`
  3. `feat(timeline): 卸载只卸这个目录——同仓库还有装着的目录就留 git 钩子,--purge 不再删数据`:`installer.ts`、`cli.ts`,以及改过的 `installer.test.ts`、`cli-format.test.ts`
- 风险/注意事项:
  - 去重查询走 `timeline_events_ts_idx`:把 `ts = ?` 放第一个条件;5.8 万条级别要在几秒内并完
  - 进度换算是平台不重报、不漏报的关键(K12、设计验收 3):`mapProgress` 对「旧值不在表里」的情形必须取「不大于它的最大旧 id」,不能取 0
  - `listTimelineRoots` 被 Stop hook 每轮调用(经 task),只做一条查询,不要扫事件表
  - 本任务和 T-2 同时改 timeline:`schema.sql`、`schema-bootstrap.ts`、`recorder.ts`、`hook-runner.ts`、`hooks.ts`、`git-commit.ts`、`turn-state.ts`、`constants.ts` 归 T-2,不要碰
