# T-2: 看板认版本与装配

> 产物: plan
> 依据: spec@67abbc8

- 目标:看板给每个任务算出版本(纯函数),装配时带上 `versions`,把本机没挂会话但有版本的任务放进 `noSession`;同一目录的版本历史只读一次。
- 对应 spec 编号:F5、D15(看板侧)、D18(集合判断)、D19、D20、D21
- 强制引用:`docs/guides/coding-standards.md`
- 涉及范围:
  - `src/core/board/versions.ts`(新建)
  - `src/core/board/types.ts`
  - `src/core/board/compute.ts`
  - `src/core/board/index.ts`(只改头注释)
- 必须严格执行:
  - 数据形状按 C-2;纯函数签名与规则按 C-3;版本号比较按 C-5。
  - 看板只经 release 门面(`../release`)取 `readVersionHistory`、`resolveBranchTips`、`VERSION_BRANCH_PATTERN` 与 C-1 类型;`board/versions.ts` 不 import `node:child_process`、不读文件系统。
  - D20:`computeBoardData` 一次调用里建一个缓存,键是项目组 `dirs[0]` 的 `fs.realpathSync`(取不到就用原路径);值是 `{ history, branchTips }`。第一次遇到这个键:`readVersionHistory` 一次,`resolveBranchTips` 传当前组副本登记里的全部需求分支名一次;后面同键的组只把缓存里还没查过的分支名(不管查没查到)再传给 `resolveBranchTips` 一次,结果并进缓存;没有新分支名就不再调。`dirs` 为空的组(目录全不在)不读 git,用空历史、空末端。
  - D21:`assembleProject` 里对 K1 的全部任务调 `assignTaskVersions`;有会话的任务照旧进 `tasks` / `older`(只多 `versions`);`hits.length === 0` 且 `versions` 非空的进 `noSession`(字段按 C-2 填空值),按标题 `localeCompare(…, 'zh')` 升序;没会话又无版本的照旧丢掉。
  - `tasks`、`older`、`unsorted` 的内容和排序不变;`projectActivityOf` 等项目排序逻辑不看 `noSession`。
  - 「项目没任务也没会话」的提前返回(`compute.ts:352`,条件 `tasks.length === 0 && data.sessions.length === 0`)条件不变,只在返回对象里加 `noSession: []`。
  - `ReplicaRef` 按 C-2 加 `baseBranch`、`createdAt`;`compute.ts` 传给 `matchSessionsToTasks` 的仍是 `ReplicaEntry`(结构上满足),不改 `match.ts`。
- 允许局部适配:
  - `versions.ts` 内部辅助函数、缓存的具体数据结构、`assembleProject` 的参数怎么加(新增一个参数传版本信息即可)。
- 具体要求:
  1. `types.ts`:加 `TaskVersion`,`BoardTask.versions`,`BoardProject.noSession`,`ReplicaRef` 两个字段;注释写 spec 编号(D19、D21)。
  2. `versions.ts`:实现 `assignTaskVersions`(C-3),文件头注释写清「纯函数,输入版本历史与副本登记,不碰 git」和对应 spec K15–K20、D17–D19。
  3. `compute.ts`:`computeBoardData` 建 D20 缓存,`assembleProject` 用它算 `versions` 和 `noSession`;文件头注释的门面列表加 release。
  4. `index.ts`:头注释「只 import project、timeline、features、replica、agents 五个门面」改成六个,加 release;导出 `TaskVersion` 类型。
- 完成条件:
  - `npm run build` 通过;`compute.ts` 不超过 600 行。
  - `npm test` 通过,`__tests__/core/board/` 现有测试不改断言。
  - 本机手工:`node -e` 调 `require('./dist/core/board').computeBoardData()`,`cgraphx` 项目里「agent看板」的 `versions` 是 `[{ version: '2.0.14', released: true, merged: true }]`,「dev-del丢弃副本」是 `[{ version: '2.0.14', released: true, merged: false }]`,「skill瘦身」是 `[]`,「发版后打tag并退出版本流程」是 `[]`。
- 提交点:
  1. `feat(board): 任务认版本——合入记录与副本起点分支现算`:`src/core/board/versions.ts`、`src/core/board/types.ts`、`src/core/board/compute.ts`、`src/core/board/index.ts`
- 风险/注意事项:
  - 任务标题按 K13 取(`TaskDef.title`),和合入说明里的标题全等比较,不做任何归一化。
  - 同一个 `featureId` 可能有多份副本登记(开过几次);计划版本只看 `createdAt` 最大的那份,合入判断看全部登记的分支。
