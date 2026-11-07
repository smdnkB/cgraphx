# T-1: 会话来源与 DeepSeek 读取器

> 产物: plan
> 依据: spec@90c1887

- 目标: timeline 补录/重建改从 agents 门面的统一「会话来源」列举会话文件,并新增 DeepSeek Harness 的 zstd 帧式 jsonl 读取器——DeepSeek 的会话从此进时间线,但对安装器、副本、门禁、会话提示零变化。
- 对应 spec 编号: F4(机制图:ds 新读取器)、D12、D13、全局约束(AGENT_PROFILES 不变、读取器只产事实)、验收 2、3、4。
- 强制引用: `docs/guides/coding-standards.md`(动代码)。
- 涉及范围: `src/core/agents/types.ts`、`src/core/agents/sources.ts`(新)、`src/core/agents/index.ts`、`src/core/timeline/types.ts`、`src/core/timeline/ingest/deepseek-session.ts`(新)、`src/core/timeline/ingest/reader.ts`、`src/core/timeline/ingest/ingest.ts`、`src/core/timeline/ingest/rebuild.ts`。
- 必须严格执行:
  - 按 C-1(来源与枚举切换)、C-3(agent 列放宽)、C-4(DeepSeek 文件契约)。
  - `AGENT_PROFILES`、`AgentId`、`profiles.ts` 一行不动;claude/codebuddy 两个来源由 profile 派生,行为与现状等价(含 `CLAUDE_CONFIG_DIR` 等环境变量覆盖语义)。
  - 读取器只产事实:不打开库、不知道项目归属、不做净化摘要(交管线)。
  - 事实时间戳与编号一律取行内自带值,不做「现在时间」填充。
- 允许局部适配:
  - zstd 帧切分的内部实现(参照 `/Users/smdnk/objects/ai/deepseek-harness/packages/session/session-persistence-jsonl/src/zstd.ts` 的 scanZstdFrames:魔数 `0xFD2FB528`、帧头描述符解析、不完整尾帧识别;自实现,不引入依赖、不加运行时依赖)。
  - DeepSeek 行 JSON 的防御性解析细节(字段缺省、类型不符的容错);不认识的行类型跳过不算错误。
  - `unavailableReason()` 的检测写法(判 `typeof zlib.zstdDecompressSync === 'function'` 即可)。
- 具体要求:
  1. `agents/types.ts`:`SESSION_READER_IDS` 加 `'deepseek-session'`;新增 `SessionSourceId = AgentId | 'deepseek'` 与 `SessionSource` 接口,字段与语义按 C-1。
  2. 新建 `agents/sources.ts`:`listSessionSources()` 返回三项(claude-code、codebuddy 由 profile 派生,deepseek 独立);deepseek 的 `sessionsRoot()` 读 `DSH_HOME`(非空)否则 `~/.dsh/sessions`;`listFiles` 列 `<root>/*/<会话编号>/session.v4.jsonl.zstd` 按路径升序;`unavailableReason()` 按 zstd 可用性返回 C-1 的文案或 null。同时把 `ingest/reader.ts` 的 `listSessionFiles` 整体移入 `agents/sources.ts`(reader.ts 删除该函数、只留读取器分发),claude/codebuddy 来源的 `listFiles` 即它——agents 不得 import timeline 的内部模块(C-1 落地路径钉死)。
  3. `agents/index.ts` 导出 `listSessionSources`、`SessionSource`、`SessionSourceId`。
  4. `timeline/types.ts`:`TimelineEventInput.agent`、`TimelineEvent.agent` 放宽为 `SessionSourceId | null`(C-3);消费侧(describe/stats/report)不特判。
  5. 新建 `timeline/ingest/deepseek-session.ts`:实现 `SessionFactsReader` 签名,映射规则、子会话归并、consumedBytes 语义按 C-4(`session/title` 行本任务按「不认识的行类型跳过」处理——`SessionTitleFact` 与该行映射归 T-2);文件头注释写清布局与实测结论(参照 `claude-transcript.ts` 的头注释风格)。`reader.ts` 的 `READERS` 登记 `'deepseek-session'`。
  6. `ingest.ts` 与 `rebuild.ts`:会话文件枚举切换到 `listSessionSources()`(C-1 的跳过与 notice 规则),文件列举一律经 `source.listFiles(root)`,不再 import `listSessionFiles`;进度行、事件 agent、K11 提示改用 source 的 id/displayName;`saveRow` 支持显式 sessionId(C-4:claude/codebuddy 仍用 `sessionFileId(file)`,deepseek 取事实的 sessionId,只读了头的取头事实的 sessionId)。
  7. DeepSeek 子会话的开始目录读它自己的文件头(`subagentMainPath` 是 Claude 布局,不适用);已知限制(session_start 先写者可能取子会话目录)写进 `deepseek-session.ts` 头注释,不加机制修。
- 完成条件:
  - `npm run build` 零错误;`npm test` 全量通过(既有断言不改)。
  - 本机验证(spec 验收 4):用 `node dist/cli/index.js timeline query --limit 20` 在 cgraphx 项目里能看到 DeepSeek 的事件;临时 HOME 下用 `zlib.zstdCompressSync` 手工造的 DeepSeek 样本文件能被读取器解析(留作后续单元测试的素材,不在本任务写测试文件)。
  - `grep -rn "AGENT_PROFILES" src/` 确认 profiles.ts 无改动;`cgraphx install` 相关代码无 diff。
- 提交点:
  1. `feat(timeline): DeepSeek 会话只读来源——第三家读取器接进补录与重建`:本任务全部 8 个文件。
- 风险/注意事项:
  - `reader.ts` 的 `sessionFactsReader()` 对未登记 id 抛错——deepseek 来源在读取器未登记前不得进 listSessionSources 的可列举路径(T-1 内两处一起落,不存在中间态)。
  - `zstdDecompressSync` 是 Node 22.15+/实验性 API,engines 下限不抬(全局约束);TS 类型可能缺声明,用 `zlib` 的既有导出类型或局部 `typeof` 收敛,不引入 @types 新依赖。
  - K11 计数对 deepseek 文件同样生效(整份读不出事实按 display + 行内 version 计数)。
