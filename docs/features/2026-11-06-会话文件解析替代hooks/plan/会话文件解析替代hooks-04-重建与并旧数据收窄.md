# T-4: 重建与并旧数据收窄(F6 + D20)

> 产物: plan
> 依据: spec@eac0b58

### 目标

升级后第一次 install 或第一次查时间线时,清掉 hook 记的旧事件、按解析全量重建(提交记录保留、只重建一次);并旧数据从此只并 `git_commit` 与 `timeline_roots`;install 接上 F6。

### 对应 spec 编号

D19、D20、K23、K24、F6 行为链与图

### 强制引用

`docs/guides/coding-standards.md`(契约部分)、`docs/guides/data-standards.md`(例外同 T-1)

### 涉及范围

- 新增 `src/core/timeline/ingest/rebuild.ts`
- `src/core/timeline/merge.ts`、`src/core/timeline/types.ts`、`src/core/timeline/index.ts`(门面导出)
- `src/core/project/merge-files.ts`、`src/core/project/types.ts`
- `src/cli/installer/index.ts`、`src/cli/installer/project-steps.ts`

### 必须严格执行

- 重建入口挂进 C-4 的 `ensureTimelineUpToDate`:`timeline_meta` 没有 `rebuilt_at` 键 → 先走重建再增量;`status: 'rebuilt'` 带 `sessions` / `events` 数。
- 重建流程(D19,顺序钉死):
  1. 拿 `ingest.lock`(拿不到 → `busy`,下次重来);
  2. `CGRAPHX_NO_TIMELINE` 开 → 直接返回 `skipped-disabled`(不清、不重建,入口层判);
  3. `removed_projects` 有这个项目且项目库无 `rebuilt_at` → 只写 `rebuilt_at`、返回(K23 删过数据的口径),不全量解析;
  4. 全量解析这个项目的会话文件(归属与解析规则以 T-3 已合入的代码为准,复用同一套函数),事件写进**项目目录下的临时库** `rebuild.tmp.db`(先删残留再建,应用 timeline schema);
  5. 项目库一个短事务里:`ATTACH` 临时库 → `DELETE FROM timeline_events WHERE event_type != 'git_commit'`(K24,不备份)→ `INSERT SELECT` 临时库事件(带 source_key)→ 写 `timeline_meta` 的 `rebuilt_at` → 提交;
  6. 提交之后:更新 sessions.db 里这个项目全部文件的偏移(= 文件当前大小)、删数据目录下 `turns/`、删 `~/.cgraphx/sessions/` 整个目录、删临时库(含 -wal/-shm)、项目库 `VACUUM`;
  7. 任何一步失败:短事务回滚(清和写一起撤销,时间线还是旧的)、临时库删掉、返回 `failed`;**锁的持有期内不得长占项目库写锁**(解析写临时库,不碰项目库)。
- 并旧数据收窄(D20):`createTimelineMerger` 只并 `event_type = 'git_commit'` 的行与 `timeline_roots`;`EventIdMapping`、`mapProgress`、`projectMaxIdBefore`(id 对照与进度换算)删掉;`TimelineMerger` 接口与 `TimelineMergeStats` 相应精简(`events`/`sessions` 语义改为并了多少笔提交);`mergeLegacyFiles` 的 `mergeTurns` 删(turns/ 不再有人读写;备份照旧含 turns、`removeMergedLocalFiles` 照旧删 turns,这两处不动)。
- install 接线(F5 图末步):`cli/installer/index.ts` 在 ⑦.5 清理已下掉功能数据之后调 `ensureTimelineUpToDate(projectRoot)`;`rebuilt` 时输出「时间线已重建:N 个会话,M 条事件」,`failed` 只警告「时间线重建失败:原因」、安装照常;`project-steps.ts` 的 `mergeLegacyAndReport` 文案改「已把 N 笔提交并进项目 X」(D20)。

### 允许局部适配

- `rebuild.ts` 与 `ingest.ts` 的函数分工(重建复用 T-3 **已合入代码**的解析与写库内部函数,以其时点的实际实现为准);临时库文件名常量放哪。
- `INSERT SELECT` 的列清单写法(两边 schema 已由 ensure 对齐)。

### 具体要求

1. `rebuild.ts` 实现上述流程;`ensureTimelineUpToDate` 的入口分支在 `ingest.ts` 里接上(先查 `timeline_meta.rebuilt_at`——项目库打开方式沿用 `openTimelineDb`,读不到键视为没重建)。
2. `merge.ts` / `types.ts` 按 D20 精简;`project/merge.ts` 的调用点不在此文件清单里但其接口不变则不动,若接口变化牵连 `project/merge.ts` 可一并小改(以编译通过、行为不变为准)。
3. `merge-files.ts`:`mergeTurns` 删除及其调用;`TURNS_DIRNAME` 改为本地字面量常量 `turns`(T-8 会删 `turn-state.ts` 的导出,先解耦)。
4. `installer/index.ts` / `project-steps.ts`:F6 接线与文案。

### 完成条件

- `npm run build`、`npm test` 通过(merge 相关既有用例按新语义同步修正:只并提交、无 id 对照)。
- 手工冒烟(spec 设计验收 11、12 的行为口径):
  - 重建中途杀进程 → 时间线还是旧的(提交记录一条不少),再跑一次能重来;
  - 重建期间另一进程记提交记录能写进去(短事务持锁在秒级以内);
  - 项目重建过之后,另一个旧库模式的目录 install → 不带回 hook 事件、也不再次重建。

### 提交点

1. `refactor(timeline): 并旧数据只并提交记录与根——id 对照/进度换算删除`:merge.ts、types.ts、merge-files.ts、project-steps.ts、(如牵连)project/merge.ts
2. `feat(timeline): 时间线按会话文件全量重建——清 hook 事件、临时库短事务、只重建一次`:ingest/rebuild.ts、ingest.ts 入口分支、timeline/index.ts、installer/index.ts

### 风险/注意事项

- 「整个解析放一个事务」是 spec 明确没选的方案(持写锁十几秒会弄丢这期间的提交记录)——解析一律写临时库。
- `rebuilt_at` 必须在短事务**内**写(和删、插同生共死),写在事务外中断后会误判「重建过」。
- `~/.cgraphx/sessions/` 删除只此一处;`sessions.db`(T-1)不是它,别误删。
