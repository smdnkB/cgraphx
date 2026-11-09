# T-5: 子会话标题不归主会话 + 一次重算

> 产物: plan
> 依据: spec@5852da8

- 目标: DeepSeek 子会话不产标题;升级后第一次补录把 DeepSeek 已有标题按新规则重算一遍,只删「本机还有文件的 DeepSeek 会话」的行。
- 对应 spec 编号: F3、D9、D10、D11、D12
- 强制引用: `docs/guides/coding-standards.md`(边界与结构、错误与日志)
- 涉及范围: `src/core/timeline/ingest/deepseek-session.ts`、`src/core/timeline/ingest/ingest.ts`、`src/core/timeline/ingest/rebuild.ts`;`__tests__/core/timeline/deepseek-session.test.ts`
- 必须严格执行:
  - C-6、C-7
  - 只跑 `deepseek` 来源;只删 covered 行;不删全表;不升 schema 版本。
- 允许局部适配:
  - 私有 helper 命名;DELETE 分批大小(≤500);临时变量组织;注释措辞。
- 具体要求:
  1. `deepseek-session.ts` 的 `handleSessionTitle`:开头 `if (s.isChild) return;`;子会话不再产 `session_title`;会话头 / 工具事实归 `s.rootSessionId` 不变;同步更新文件头注释(子会话不再产标题)。
  2. `ingest.ts`:
     - 导出 `SESSION_TITLES_REFRESH_AT_KEY = 'session_titles_refresh_at'`;模块常量 `TITLE_REFRESH_SOURCE_ID = 'deepseek'`。
     - 新增 `refreshDeepSeekSessionTitles(start): Promise<string[]>`:按 C-7 的保护 / 锁 / 来源 / 读文件 / covered / 事务删除 + upsert / 写记号 / 失败提示。
     - `ensureTimelineUpToDate` 在 `backfillSessionTitles` 之后、`ingestIncremental` 之前调用;notices 顺序 `backfill → refresh → incremental`。
     - `backfillSessionTitles` 写完 `SESSION_TITLES_AT_KEY` 后也写 refresh 键。
  3. `rebuild.ts`:import 新 key;`commitRebuild` 的正常重建与 mark-only 两处 `writeMetaNow(..., SESSION_TITLES_AT_KEY)` 都同时写 refresh 键。
  4. `deepseek-session.test.ts` A3:子会话 facts 里不再有 `session_title`;`session_head` 的 `startCwd` 取子会话自己的;工具事实仍归 parent。
  5. `session-titles.test.ts` 不改;它覆盖 backfill 与增量改名,refresh 写键不应影响。若统一验证它红了,先回查 refresh 是否误删 / 误写、是否破坏回填记号,修正实现。
- 完成条件:
  - `deepseek-session.test.ts` 通过;`session-titles.test.ts` 不改仍通过;`npm test` 不因本任务变红。
  - 不新增测试文件 / 用例。
- 提交点:
  1. `fix(timeline): DeepSeek 子会话标题不归主会话——已有标题重算一次`:`src/core/timeline/ingest/deepseek-session.ts`、`src/core/timeline/ingest/ingest.ts`、`src/core/timeline/ingest/rebuild.ts`、`__tests__/core/timeline/deepseek-session.test.ts`。
- 风险/注意事项:
  - 重算失败不写记号,下一趟重试;读不出的文件跳过、旧行保留。
  - 来源不可用(旧 Node 没有 zstd)不写记号,等能读时再算。
  - 别在 `titleUpserts` 里过滤子会话——那里没有子会话标记;必须改读取器。
  - 别把 refresh 放在增量之后;新文件的标题要由增量按新规则写。
  - 规范例外:`ingest.ts` 存量已 999 行(超 coding-standards 的 600 行);本次 refresh 留在同文件,避免与 backfill / lock 的私有 helper 形成循环依赖;不要顺手大拆,例外已记在 index。
