# T-3: 会话提示在 DeepSeek 会话里不报错

> 产物: plan
> 依据: spec@5852da8

- 目标: `session-notices` 用 `getAgentProfile` 取自己的 agent 描述;取不到(deepseek)时版本提示候选集改为全部已登记 agent,自动记忆提示不触发;scope 仍用会话编号。
- 对应 spec 编号: F1、D4
- 强制引用: `docs/guides/coding-standards.md`(错误与日志)
- 涉及范围: `src/core/session-notices.ts`
- 必须严格执行:
  - C-4
- 允许局部适配:
  - import 顺序、私有变量命名、注释措辞。
- 具体要求:
  1. import `getAgentProfile`;`requireAgentProfile` 若不再使用则移除 import。
  2. `skillVersionNoticeSafe`:`const own = session !== null ? getAgentProfile(session.agent) : undefined; const candidates = own !== undefined ? [own] : listAgentProfiles();`;其余过滤 / 循环不变。
  3. `autoMemoryOffNotice`:`const profile = getAgentProfile(session.agent); if (profile === undefined) return null;`;不再 `requireAgentProfile`。
  4. 不改 `noticeScope`、`repairGitHookSnippets`、提示原文、`emitSessionNotices` 的频控与 try/catch;同步更新文件头注释:DeepSeek 没有 agent 描述,版本提示按已装 agent 判断。
- 完成条件:
  - `session-notices.test.ts` 通过;DeepSeek 会话里不再出现 `[cgraphx] skill version notice failed`。
  - 不新增测试文件 / 用例。
- 提交点:
  1. `fix(notices): DeepSeek 会话提示按已装 agent 判断——不再报 skill version notice failed`:`src/core/session-notices.ts`。
- 风险/注意事项:
  - 不要把 `SessionFromEnv.agent` 改回 `AgentId`;DeepSeek 不是 AgentProfile。
  - 不要给 DeepSeek 造一个假 AgentProfile;`listAgentProfiles()` 保持两家。
