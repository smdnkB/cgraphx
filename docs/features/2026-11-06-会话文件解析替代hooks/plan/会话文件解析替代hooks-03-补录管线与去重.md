# T-3: 补录管线与去重

> 产物: plan
> 依据: spec@eac0b58

### 目标

把读取器产出的事实变成时间线事件:找这个项目的会话文件、增量读、按 `source_key` 去重写进项目库;timeline 四个查询命令在查询前自动补录,锁与出错的降级路径全部就位。

### 对应 spec 编号

D3、D4、D5 🔒、D6(轮次编号)、D9、K1、K2、K3、K11、K25

### 强制引用

`docs/guides/coding-standards.md`(契约部分)、`docs/guides/data-standards.md`(例外同 T-1)、`docs/guides/interface-standards.md`(CLI 退出码与输出)

### 涉及范围

- `src/core/timeline/schema.sql`、`src/core/timeline/schema-bootstrap.ts`、`src/core/timeline/store.ts`
- `src/core/timeline/cli.ts`、`src/core/timeline/index.ts`(门面)
- 新增 `src/core/timeline/ingest/ingest.ts`
- 新增 `src/core/timeline/kill-switch.ts`(`isKillSwitchOn` 从 `hook-runner.ts` 挪入;`hook-runner.ts` 本任务不删,改为从新位置 re-export 或同步改引用,T-8 删文件)

### 必须严格执行

- 去重按 C-2:`source_key` 列、部分唯一索引、键格式、INSERT OR IGNORE、不升 `TIMELINE_SCHEMA_VERSION`、git_commit 不带键。
- 门面入口与返回形状按 C-4;`skipped-legacy` 用 project 门面导出的 `hasUnmergedLegacyData(start)`(K25;它在 project 子系统,timeline⇄project 双向引用是 spec D3 定的复用,接受);开关判定用 `isKillSwitchOn`。
- 事件映射(F1 K4–K10 的落库侧):
  - `prompt` → `user_prompt` / `auto_message`(自动消息 `metadata.source` 沿用 `classifyAutoMessage` 的来源);`turn_id` 取本条提问的 uuid(重新解析不变);`prompt_text` 用事实文本。
  - `tool` → 一条 `post_tool_use`:`sanitizeToolArgs` 处理参数、`summarizeToolResponse` 处理结果载荷、`is_error` 走失败分支;`ts` 取结果行时间、`cwd` 取调用行(事实里带)、`duration_ms` 取两行时间差、`metadata` 带 `tool_use_id`、`subagent`、`duration_source: 'transcript'`。
  - `turn_end` → `stop`:`ts` 取回复时间,`turn_id` 取本轮提问的 uuid,`source_key` 按 C-2。
  - `session_head` → `session_start`:一个会话只一条(键保证),`cwd` 取 start_cwd,`turn_id` null。
  - 不再产生 `pre_tool_use` / `session_end`(C-10)。
- 找文件与归属(D3、K1、K2、K3):
  - 候选 = T-2 的列文件函数在 `agentSessionsRoot()` 下的输出;只处理「归到当前项目、大小或 mtime 变了」的文件。
  - 新文件的 `start_cwd`:主会话文件取自己的 `session_head`.start_cwd(第一条带 cwd 的行);路径在 `subagents/` 下的子 agent 文件 **跟主会话**(spec D2 表注:按路径所在项目子目录对上主会话文件——同目录下不带 `subagents/` 段的那个 `<会话>.jsonl`;主文件不在时退回子 agent 文件自己第一条带 cwd 的行,再不行留空不处理,该文件的事件记进主会话的目标也随 start_cwd 认)。没认过的开始目录跑一次 `findProjectRoot` + `identityOfRoot` 写进 `start_dirs`(目录不在 → 按**本项目库** `timeline_roots.root`(`roots.ts` 的 `readRootRows`)和副本登记(`listReplicas(root, { includeRemoved: true })`)匹配,命中归当前项目,都不中留空不处理)。
  - K3 门槛:开始目录装过(`isInitialized`)或项目目录已在(`findProjectDir` 非空)才记;`removed_projects` 命中当前项目时,只收 `ts > removed_at` 的事实(旧会话不补回)。
- 增量读(D4):按 `session_files.byte_offset` 读到最后一个换行,写完项目库再更新偏移;文件比偏移短从头重读(靠 C-2 去重)。
- 并发与出错(D9):项目数据目录下 `ingest.lock`(写法沿用 `project/merge-files.ts` 的锁:`wx` 独占创建、pid 不活或超 2 小时算陈旧;等待上限 3 秒);等不到 → `busy`,提示「时间线正在补录,结果可能缺最近的」;补录中途出错 → `failed`,提示「时间线补录失败:原因,结果可能缺最近的」;整份文件读出内容却零事实 → 计入 K11,提示带行内 `version`(如「Claude Code 2.2.0 的会话文件有 3 个解析不出,时间线可能不全;升级 cgraphx 或反馈」)。所有提示走 `notices`,由调用方写 stderr,查询照常执行、退出码不变。

### 允许局部适配

- `ingest.ts` 内部函数拆分;`start_dirs` 归属判定的实现顺序(先查缓存再认新);批量写库的批次大小。
- 提示原文的具体拼接(在 F1 图的口径内,数字与变量按实际填)。

### 具体要求

1. `schema.sql`:`timeline_events` 建表语句加 `source_key TEXT`,加部分唯一索引(C-2 原文);`schema-bootstrap.ts` 加 `ensureSourceKeyColumn`(写法照抄 `ensureAgentColumn`:BEGIN IMMEDIATE、二次确认、`duplicate column name` 视为成功),`ensureTimelineSchema` 里在 `ensureAgentColumn` 之后调用。
2. `store.ts`:`TimelineEventInput` 加 `source_key?: string`;INSERT 改 `INSERT OR IGNORE`(无键行不进部分索引,现有路径行为不变)。
3. `ingest.ts`:实现 C-4 的增量补录主体(不含重建——重建在 T-4);输出 `status: 'synced' | 'busy' | 'failed' | 'skipped-disabled' | 'skipped-legacy'` 与 notices。锁的获取/释放自带(拿不到锁不阻塞查询)。
4. `timeline/index.ts`:导出 `ensureTimelineUpToDate` 与 `describeSyncOutcome`(C-4);`isKillSwitchOn` 改从 `kill-switch.ts` 导出。
5. `timeline/cli.ts`:`query` / `show` / `stats` / `recent` 四个 action 在查询之前调 `ensureTimelineUpToDate(process.cwd())`,notices 逐行写 stderr;查询逻辑与 stdout 输出一概不动。

### 完成条件

- `npm run build`、`npm test` 通过(`store.ts` / `schema-bootstrap` 的既有用例如因新列弄红,同步修正)。
- 本机实测(spec 设计验收 2,手工):3,221 个文件、无新内容时,补录 + 查询的额外耗时 ≤150ms。
- 手工冒烟:同一文件二次补录事件不多(去重生效);文件写到半行时补录不记该行、下次补上;两个进程同时查时间线不死锁(等不到锁 3 秒内返回 busy 提示)。

### 提交点

1. `feat(timeline): timeline_events 加 source_key 部分唯一索引——解析事件按键去重不升版本`:schema.sql、schema-bootstrap.ts、store.ts
2. `feat(timeline): 会话文件补录管线——查询前增量解析写入+ingest.lock 并发`:ingest/ingest.ts、kill-switch.ts、cli.ts、index.ts

### 风险/注意事项

- 读路径从只读变可能写库:`cli.ts` 里补录调用必须整体 try/catch,任何异常只写 stderr、不碰退出码与 stdout(含 `--json`)。
- 写库必须走「项目库提交之后再更新 sessions.db 偏移」的顺序,反过来会在中断时丢事件(D4)。
- 别在补录里跑 `git`(60 个目录约 450ms 的教训,spec D3 没选每次跑 git):归属只按 start_dirs 缓存 + 首次认定。
