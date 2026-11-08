# T-1: 会话来源与 DSH_SESSION_ID

> 产物: plan
> 依据: spec@5852da8

- 目标: 让会话来源自己能声明会话变量,把 DeepSeek 的 `DSH_SESSION_ID` 纳入会话 id 解析,并暴露门禁片段需要的变量名单。
- 对应 spec 编号: F1、D1
- 强制引用: `docs/guides/coding-standards.md`(边界与结构、选型、错误与日志)
- 涉及范围: `src/core/agents/types.ts`、`src/core/agents/sources.ts`、`src/core/agents/index.ts`;`__tests__/cli/installer/deepseek-zero-change.test.ts`;`__tests__/core/session-notices.test.ts`(只改 `SESSION_VARS`)
- 必须严格执行:
  - C-1(来源字段、`SessionFromEnv`、解析顺序、`listSessionIdEnvNames`)
  - `SessionFromEnv.agent` 的类型用 `SessionSourceId`,不能用 `AgentId`
- 允许局部适配:
  - 导出位置、注释措辞、`listSessionIdEnvNames` 的内部实现。
- 具体要求:
  1. `types.ts`:`SessionSource` 加 `readonly sessionIdEnv: string | null`;`SessionFromEnv` 改为 `{ sessionId: string; agent: SessionSourceId; sessionIdEnv: string }`。
  2. `sources.ts`:`profileSource` 返回 `sessionIdEnv: profile.sessionIdEnv`;`DEEPSEEK_SOURCE` 返回 `sessionIdEnv: 'DSH_SESSION_ID'`;其余字段与顺序不变。
  3. `index.ts`:`resolveSessionIdFromEnv` 不再遍历 `AGENT_PROFILES`,改遍历 `listSessionSources()`;跳过 `sessionIdEnv === null`;取第一个非空 trim 值,返回 `{sessionId, agent: source.id, sessionIdEnv}`;新增 `listSessionIdEnvNames()`(按登记顺序,过滤 null),从门面导出;`SessionFromEnv` / `SessionSourceId` 导出保持。
  4. 测试:`deepseek-zero-change.test.ts` G1 改成 `resolveSessionIdFromEnv({DSH_SESSION_ID:'session-abc'})` → `{sessionId:'session-abc', agent:'deepseek', sessionIdEnv:'DSH_SESSION_ID'}`;保留 Claude 解析与「两个变量同时存在取 Claude」;G2 不变。
  5. `session-notices.test.ts` 的 `SESSION_VARS` 加 `'DSH_SESSION_ID'`(只做测试隔离,production 修复归 T-3)。
  6. 同步改 `types.ts` / `sources.ts` 里仍写「只读来源不进…提交门禁」的注释:改成「只读来源不进安装器 / 副本;会话 id 进提交归属、门禁与会话提示」。
- 完成条件:
  - `deepseek-zero-change.test.ts` 与 `session-notices.test.ts` 通过;其余既有测试不因本任务变红。
  - 不新增测试文件、不新增测试用例。
- 提交点:
  1. `feat(agents): 会话来源认 DSH_SESSION_ID——DeepSeek 的提交能记到会话`:上述 5 个文件。
- 风险/注意事项:
  - `resolveSessionIdFromEnv` 现在可能返回 deepseek;`session-notices` 的 production 修复在 T-3,本任务不要改 `session-notices.ts`。
  - 不要改 `AGENT_PROFILES` / `AgentId` / `parseAgentList`;不要给 `SessionSource` 加 `rootSessionId`。
