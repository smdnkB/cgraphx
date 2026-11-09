# T-2: 门禁片段与「跳过门禁」

> 产物: plan
> 依据: spec@5852da8

- 目标: 门禁片段认所有会话来源的变量;DeepSeek 提交记原始会话编号;「跳过门禁」只在片段探针覆盖本来源时判。
- 对应 spec 编号: F1、D2、D3、D5
- 强制引用: `docs/guides/coding-standards.md`(边界与结构、错误与日志)
- 涉及范围: `src/core/commit-gate/gate.ts`、`src/core/timeline/git-commit.ts`;`__tests__/core/commit-gate/snippet-reinstall.test.ts`、`__tests__/core/timeline/git-commit-hook-env.test.ts`
- 必须严格执行:
  - C-2、C-3
  - D3 的「不自动换片段」:不改 `repairHookSnippets`,不新增片段登记版本。
- 允许局部适配:
  - 私有 helper 命名;`hasCommitGateSnippetFor` 内部分行写法;错误文案保持现有。
- 具体要求:
  1. `gate.ts`:把 `listAgentProfiles().map(p => p.sessionIdEnv)` 改成 `listSessionIdEnvNames()`;片段探针按返回顺序拼 `${NAME:-}`;不写死 DSH;片段仍一行、marker、无真换行;同步更新 `commitGateSnippetLines` 头注释(名单来自全部会话来源,不是 agent 描述)。
  2. `git-commit.ts`:`const fromEnv = resolveSessionIdFromEnv(); const session_id = fromEnv?.sessionId ?? null; const agent = fromEnv?.agent ?? null;`;不做任何根映射。调用 `isGateSkipped(info, fromEnv)`。
  3. `isGateSkipped(info, session)`:session null → false;post-merge → false;读 commit-msg;probe 为 `${<sessionIdEnv>:-}`(`<sessionIdEnv>` 换成 `session.sessionIdEnv`);在 `text.split(/\r?\n/)` 里找同时含 `COMMIT_GATE_MARKER` 和 probe 的行;没有 → false;其余 tree / CHERRY_PICK / REBASE / Revert 逻辑不变。
  4. `hasCommitGateSnippet` 改为带 env 名的版本或内联;注释说明「说明行和探针行都带 marker,必须看含探针的那行」。
  5. 测试:`snippet-reinstall` 的 `SESSION_VARS` 加 DSH,第二处 `envWithout` 也带 DSH;`git-commit-hook-env` 的 `TOUCHED_ENV` 加 DSH,`installGateSnippet` 的假片段写成含 `${CLAUDE_CODE_SESSION_ID:-}` 探针的一行;`isGateSkipped` 调用改为传 `{sessionId:'s', agent:'claude-code', sessionIdEnv:'CLAUDE_CODE_SESSION_ID'}` 或 null;保留既有「no snippet / no mark」用例。
  6. 不新增测试用例;新行为验收走 unit-spec / unit-code。
- 完成条件:
  - `snippet-reinstall.test.ts`、`git-commit-hook-env.test.ts` 通过;片段 `sh -n` 通过。
  - 不新增测试文件 / 用例。
- 提交点:
  1. `feat(commit-gate): 门禁片段认会话来源变量——DeepSeek 提交也走门禁`:`src/core/commit-gate/gate.ts`、`__tests__/core/commit-gate/snippet-reinstall.test.ts`。
  2. `fix(timeline): 跳过门禁按来源探针判——旧片段不误标 DeepSeek`:`src/core/timeline/git-commit.ts`、`__tests__/core/timeline/git-commit-hook-env.test.ts`。
- 风险/注意事项:
  - 旧片段没有 DSH 时,DeepSeek 提交不拦也不标;别为了「看起来过了」改回只看 marker。
  - 不要改门禁判定顺序 / 退出码 / `CGRAPHX_PRECOMMIT_REVIEWED` 逻辑。
