# T-2: 会话标题链路

> 产物: plan
> 依据: spec@90c1887

- 目标: agent 自己起的会话标题进项目库——claude 读取器多读标题事实、DeepSeek 读取器产标题事实、补录管线把标题写进新表 `timeline_session_titles`,老会话一次性回填;看板与时间线的展示从此有标题可用。
- 对应 spec 编号: F2/F3 的 K5、F4 机制图(cc「多读标题,老会话也要补」、ds「取…标题」)、D8、D9、验收 5。
- 强制引用: `docs/guides/coding-standards.md`(动代码);`docs/guides/data-standards.md`(动 schema.sql——「DDL 层」幂等与模型层 Row 命名照办;「加版本号」一条按 index「适用规范」记录的例外不执行,spec D8 定只加表不升版本)。
- 涉及范围: `src/core/timeline/schema.sql`、`src/core/timeline/store.ts`、`src/core/timeline/ingest/types.ts`、`src/core/timeline/ingest/claude-transcript.ts`、`src/core/timeline/ingest/deepseek-session.ts`、`src/core/timeline/ingest/ingest.ts`、`src/core/timeline/ingest/rebuild.ts`、`src/core/timeline/index.ts`。
- 必须严格执行:
  - 按 C-2(事实形状、表结构、写入优先级、回填与重建记号)。表 DDL 逐字:`CREATE TABLE IF NOT EXISTS timeline_session_titles (session_id TEXT PRIMARY KEY, title TEXT NOT NULL, kind TEXT NOT NULL, ts TEXT NOT NULL);`
  - 写入优先级 `custom` > `ai` > `agent`,同级 `ts` 新者胜;一个会话一行。
  - 标题不是事件:不进 `mapFacts`、不占 source_key、`timeline_events` 行数不受影响(验收 5「事件数不变」)。
  - CodeBuddy 没有标题,其读取器不动(展示侧回退第一条 user_prompt,归 T-3)。
  - 旧库兼容:只加 `IF NOT EXISTS` 表,不升 `TIMELINE_SCHEMA_VERSION`,旧版打开库不受影响。
- 允许局部适配:
  - Claude 标题行在 jsonl 里的具体形态:实现时读本机 `~/.claude/projects` 的样本确认(带 `custom-title`、`ai-title` 的行),`custom-title` → `titleKind: 'custom'`、`ai-title` → `'ai'`;事实形状(SessionTitleFact)不变。
  - `upsertSessionTitle` / `readSessionTitles` 放 store.ts 还是独立小模块、SQL 具体写法。
- 具体要求:
  1. `ingest/types.ts`:新增 `SessionTitleFact`(C-2)并入 `SessionFact`;头注释说明读取器只产事实、管线负责优先级。
  2. `schema.sql`:追加标题表 DDL(上述原文),注释写明「只加表、不升版本号」的取舍与 timeline_meta 先例。
  3. `store.ts`:`upsertSessionTitle`(按 C-2 优先级)与 `readSessionTitles`;Row 类型遵守 data-standards 的 `XxxRow` snake_case 约定(领域类型另映射)。
  4. `claude-transcript.ts`:识别标题行,产 `SessionTitleFact`(行形态实测确认,允许局部适配);增量读时标题行在已消费偏移之后才产事实(与现有「读到最后一个完整行」语义一致)。
  5. `deepseek-session.ts`:补上 `session/title` 行的映射——产 `SessionTitleFact`(`titleKind: 'agent'`);T-1 期间该行按「不认识的行类型跳过」处理,本任务把它从跳过名单接进事实流。
  6. `ingest.ts`:`writeFacts` 在写事件同一事务里把 `session_title` 事实经 `upsertSessionTitle` 写入;`ensureTimelineUpToDate` 增加回填步骤(C-2:无 `session_titles_at` 记号时,拿同一把 `ingest.lock`,把 sessions.db 里 `project_dir` 等于本项目的文件从 0 重读、只写标题、不推偏移、写记号;拿不到锁就静默跳过)。
  7. `rebuild.ts`:全量解析同样收标题;`commitRebuild` 短事务里对标题表做 `DELETE` + 从临时库 `INSERT SELECT`,并同事务写 `session_titles_at`(重建不再回填)。
  8. `timeline/index.ts`:导出按 dataDir 只读的标题读取(供 T-3 的 C-5 一并使用,形状见 C-5 `titles`)。
- 完成条件:
  - `npm run build` 零错误;`npm test` 全量通过。
  - 本机验证(验收 5 的手工侧):对已有数据的项目跑一次 `node dist/cli/index.js timeline query --limit 1`(触发补录+回填)后,`timeline_session_titles` 有行且 `custom` 不被 `ai` 覆盖(可写临时脚本只读抽查临时 HOME 下的库,不动本机数据;或等单元测试覆盖);第二次跑不再出现回填读文件的耗时。
  - `timeline_events` 行数在补录前后不变(去重照旧)。
- 提交点:
  1. `feat(timeline): 会话标题入项目库——claude/deepseek 读标题+老会话一次回填`:本任务全部 8 个文件。
- 风险/注意事项:
  - 回填重读全部老文件,第一次会慢几秒(spec D9 影响面已接受);回填不得写事件、不得推进 `session_files` 偏移——否则下次增量会整段重读。
  - `commitRebuild` 的 `DELETE FROM timeline_session_titles` 与事件删除同一事务,失败一起回滚(标题表与事件表同命运)。
  - 标题文本超长时按现有 json-cap 的截断工具处理,不让一行标题撑爆库。
