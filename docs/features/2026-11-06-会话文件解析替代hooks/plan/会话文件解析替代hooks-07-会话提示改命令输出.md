# T-7: 会话开始的提示改由命令输出(F4)

> 产物: plan
> 依据: spec@eac0b58

### 目标

撤掉会话开始 hook 后,三条提示(skill 版本落后、自动记忆去向、钩子片段补不上)改由「这个会话第一条 cgraphx 命令」输出;补回钩子片段也从会话开始挪到这里。

### 对应 spec 编号

D16、K17、K18、K19、K20

### 强制引用

`docs/guides/coding-standards.md`(契约部分)、`docs/guides/interface-standards.md`(命令输出)

### 涉及范围

- 新增 `src/core/session-notices.ts`
- `src/cli/index.ts`

### 必须严格执行

- 挂点(D16):commander 根命令的统一挂点(`program.hook('postAction', …)` 或等效机制)——每条命令 action 完成后调一次;**提示写 stderr、整体 try/catch**(哪条判断出错哪条不出,其余照出,命令结果不受影响);调 `process.exit` 的命令路径(upgrade)拿不到 postAction → 不提示,下一条补上(接受)。
- scope 与频控按 C-9:有会话变量(`resolveSessionIdFromEnv`)→ `session:<id>`,同一会话只提示一次;没有 → `day:<项目根>:<本地日期>`,每个项目每天第一条一次;隐藏命令、git 钩子调起的命令、`--help`、`--version`、`version` 不算一条。记录写 `notices_shown`(C-3)。
- 三条提示的判断与原文从 `timeline/hooks.ts` 挪来(D16:挪到新文件 `src/core/session-notices.ts`),源文件本任务不删(T-8 删):
  1. **K18 skill 版本落后**:`skillVersionNotice`(core/skill-version 门面);有会话变量看那家 agent,没有看 `selectInstalledAgents` 的各家,任一家落后就出一条(提示里带具体版本)。
  2. **K19 自动记忆去向**:仅 Claude Code 会话且本人本地设置 `autoMemoryEnabled === false`;原文照 `autoMemoryOffContext()`。
  3. **K20 补回钩子片段**:`repairHookSnippets(cwd)` 按 `hook-snippets.json` 登记补缺;补不上的经 `hookNotice` 出原因并只说一次(登记已由基础层删,不会每次重试);提交记录片段、门禁片段、版本分支拦截同样对待(按钩子文件名区分说法,同现有 `repairGitHookSnippets` 的写法)。
- 多条提示逐行写 stderr、带 `[cgraphx]` 前缀;一条都没有就什么都不写。

### 允许局部适配

- 「不算一条」的名单实现方式(静态名单 / 注册时收集 hidden 标记);postAction 还是等效钩子。
- 提示拼接与顺序。

### 具体要求

1. `session-notices.ts`:导出 `emitSessionNotices(cwd: string): void`(或 async);内部:判 scope → 已提示过直接返回 → 三条判断 → 写 stderr → `markNoticeShown`。`notices_shown` 打开时删 30 天前的行(C-3,经 session-index)。
2. `cli/index.ts`:注册完全部子系统命令后挂统一 postAction 钩子,调 `emitSessionNotices(process.cwd())`;不在任何子系统 cli 里各调一次(漏一个就不提示——D16 没选)。
3. 挪函数时保持原文与判定逐字等价(`isAutoMemoryOff`、`autoMemoryOffContext`、`skillVersionNoticeSafe` 的 try/catch 包裹方式);`hooks.ts` 里原来的会话开始提示输出(hookSpecificOutput JSON)不动,由 T-8 随文件删除。

### 完成条件

- `npm run build`、`npm test` 通过。
- 手工冒烟(spec 设计验收 9):同一会话第一条 `cgraphx docs concepts` 带提示、第二条不带;`--json` 命令的 stdout 仍能直接 `JSON.parse`(提示只进 stderr);终端里无会话变量时今天第一条带、明天再带;`cgraphx version` / `--help` 不提示、不记 scope。

### 提交点

1. `feat(cli): 会话提示改由命令输出——postAction 统一挂点+scope 每会话/每日一次`:session-notices.ts、cli/index.ts

### 风险/注意事项

- 每条命令多开一次 sessions.db:打开动作要轻(幂等建表 + 一条 scope 查询);30 天清理顺手做、失败不提示。
- 提示绝不能进 stdout:`--json` 的机器消费方在 stdout。
- `process.exit` 路径(upgrade、install 出错)拿不到 postAction 是已知接受项,不要为此给每个 action 手动补调用。
