# 后端任务: timeline 采集的数据质量问题

> feature-id: 2026-10-16-timeline采集的数据质量问题
> 来源 spec: `../timeline采集的数据质量问题-spec.md`(有疑义时以 spec 原文为准)

通用约束(每个任务都适用):

- 不改 `src/core/timeline/schema.sql`,不改 `TIMELINE_SCHEMA_VERSION`(=2),不新增 `EventType` 值。
- hook 契约:所有写库都 await;异常只写 stderr;退出码恒为 0;不往 stdout 输出。
- `src/core` 不得 import `src/cli` 或 `src/web`;新代码用中文注释,内置模块用 `node:` 前缀;单文件不超过 600 行。
- 不新增测试用例。改动导致失败的既有测试,同步修正断言,使其符合本 plan 的契约。
- 公共验证命令:`npm run build && npm test`。
- **基线已知失败(不计入"全绿")**:`__tests__/core/dbquery/config.test.ts` 的 `reports invalid driver type`。原因是 db 驱动新增 `http` 后,断言的报错文案没有同步,与本需求无关,不修。本文所说的"全绿",均指除这一条以外的测试全部通过。
- 临时目录变量 `$T` 在 T-2、T-3 之间复用。如果换了 shell,`$T` 丢失,就按 T-2 验证方式的第一行重建,再按顺序重放 T-2 的样本。

---

### T-1: JSON 收口——三个 JSON 列永远合法

- **目标**:`tool_args`、`tool_result_summary`、`metadata` 三列写入的内容一定能 `JSON.parse`,并且不超过各自的上限。超长时只截字符串字段的值。
- **对应 spec 条款**:R1、§7(不改表)
- **强制引用**:`docs/guides/coding-standards.md`
- **依赖**:无
- **涉及范围**:
  - 新增 `src/core/timeline/json-cap.ts`
  - 修改 `src/core/timeline/constants.ts`、`src/core/timeline/store.ts`(`insert` 方法及其上方的截断辅助函数)
- **必须严格执行**:
  - `constants.ts` 的上限常量:
    - `RESULT_SUMMARY_MAX_BYTES = 8 * 1024`(原为 4KB)
    - 新增 `SUMMARY_FIELD_MAX_BYTES = 2 * 1024`
    - `METADATA_MAX_BYTES = 8 * 1024`(不变)
    - 新增 `METADATA_FIELD_MAX_BYTES = 2 * 1024`
    - `ARGS_MAX_BYTES = 64 * 1024`(不变,开始被使用)
    - 新增 `ARGS_FIELD_MAX_BYTES = 16 * 1024`
    - 新增 `EDIT_SNIPPET_MAX_BYTES = 4 * 1024`
    - 新增 `SUMMARY_VERSION = 2`
    - 新增 `CAP_MIN_STRING_BYTES = 256`
  - `json-cap.ts` 导出两个函数。
  - **`truncateUtf8(s: string, maxBytes: number): string`**:
    - UTF-8 字节数 ≤ `maxBytes` 时原样返回;
    - 否则在字符边界截断(不留下半个多字节字符),再接上已有常量 `TRUNCATED_SUFFIX`(`'... [truncated]'`),返回值总字节数 ≤ `maxBytes`。
    - **这是"某个字段有上限"的唯一实现**:T-2 的生成器和 `sanitizeToolArgs` 都调用它,来控制单个字段的长度。
  - **`capJsonValue(value: unknown, opts: { maxStringBytes: number; maxTotalBytes: number }): string`**:**整体超限时的兜底**,保证返回值能 `JSON.parse`,且 `Buffer.byteLength(返回值, 'utf8') <= opts.maxTotalBytes`。算法:
    1. 序列化 `value`。遇到循环引用或其它无法序列化的值,改用 `{"_error":"unserializable payload"}`,与现有行为一致。**若字节数 ≤ `maxTotalBytes`,直接返回,不做任何字段截断(快路径)。**
    2. 否则递归遍历对象和数组里的每个字符串值,对每个值执行 `truncateUtf8(值, maxStringBytes)`。对象的键不截。
    3. 序列化结果仍超过 `maxTotalBytes` 时,把 `maxStringBytes` 减半后从第 2 步重做;减到小于 `CAP_MIN_STRING_BYTES` 时停止重试。
    4. 仍然超限时返回 `JSON.stringify({ _truncated: true, _original_bytes: <第 1 步序列化结果的字节数> })`。
  - 导出名以 `json-cap.ts` 为准:`truncateUtf8`、`capJsonValue`,以及类型 `CapOptions = { maxStringBytes: number; maxTotalBytes: number }`。
  - `store.insert` 中三列的写法:
    - `tool_args`:`input.tool_args !== undefined` 时写 `capJsonValue(input.tool_args, { maxStringBytes: ARGS_FIELD_MAX_BYTES, maxTotalBytes: ARGS_MAX_BYTES })`;否则写 `null`。
    - `metadata`:`input.metadata` 存在时写 `capJsonValue(input.metadata, { maxStringBytes: METADATA_FIELD_MAX_BYTES, maxTotalBytes: METADATA_MAX_BYTES })`;否则写 `null`。
    - `tool_result_summary`(入参仍是 `string | undefined`):
      - `undefined` → `null`;
      - 能 `JSON.parse` 且字节数 ≤ `RESULT_SUMMARY_MAX_BYTES` → 原样写入;
      - 能解析但超限 → `capJsonValue(解析结果, { maxStringBytes: SUMMARY_FIELD_MAX_BYTES, maxTotalBytes: RESULT_SUMMARY_MAX_BYTES })`;
      - 不能解析 → `JSON.stringify({ _invalid: true })`。
    - **删除对这三列做整串截断的代码路径**。`prompt_text`、`commit_message` 是纯文本列,仍用原来的 `truncateString`,不变。
- **允许局部适配**:
  - `json-cap.ts` 内部的递归实现和字符边界算法;
  - `store.ts` 里旧的 `safeStringify` 删除或改为内部调用 `capJsonValue`。`store.ts` 不得超过 600 行。
- **完成条件**:
  - `npm run build` 通过;
  - `npm test` 全绿。`__tests__/core/timeline/store.test.ts` 里的「stores oversized tool_args without truncation」用例会失败,改为断言:超长的 `command` 被截到 `ARGS_FIELD_MAX_BYTES` 以内,以 `'... [truncated]'` 结尾,且整列能解析;
  - 「handles unserializable (cyclic) tool_args」用例保持通过。
- **验证方式**:
  - `npm run build && npm test`;
  - 用下面的脚本确认超长 stdout + stderr 的摘要也能存成合法 JSON(在仓库根执行,输出应为 `ok <字节数>`,且字节数 ≤ 8192):

    ```bash
    node -e "
    const {DatabaseConnection}=require('./dist/core/db');const fs=require('fs'),os=require('os'),path=require('path');
    const dir=fs.mkdtempSync(path.join(os.tmpdir(),'cap-'));fs.mkdirSync(dir+'/.cgraphx');
    const c=DatabaseConnection.open(dir+'/.cgraphx/cgraphx.db');require('./dist/core/timeline/schema-bootstrap').ensureTimelineSchema(c.getDb());
    const {TimelineStore}=require('./dist/core/timeline/store');const s=new TimelineStore(c.getDb());
    s.insert({event_type:'post_tool_use',tool_name:'Bash',tool_result_summary:JSON.stringify({success:true,payload:{stdout_preview:'中'.repeat(5000),stderr_preview:'e'.repeat(5000)}})});
    const v=c.getDb().prepare('select tool_result_summary t from timeline_events').get().t;JSON.parse(v);console.log('ok',Buffer.byteLength(v));"
    ```

  - 如果 `dist/core/db` 的导出名与脚本不符,按实际门面调整导入,但断言(能解析且 ≤ 8192)保持不变。
- **独立提交**:是。完成后,v1 生成器的输出也不会再被截成非法 JSON,第 1 号硬伤单独修好。
  - 提交主题:`fix(timeline): JSON 列按字段截断——三列写入永远是合法 JSON`
- **风险 / 注意事项**:
  - `capJsonValue` 处在每次 hook 的必经路径上。按算法第 1 步的快路径,不超限时只做一次序列化加一次字节计数。

---

### T-2: 摘要 v2 + 调用参数净化 + metadata 扩展

- **目标**:pre / post 两个 hook 写出符合 spec §4 的 v2 摘要。Write 不存正文,Edit 片段截短。metadata 记录 `tool_use_id`、子 agent 归属和耗时来源。Claude Code 的耗时取宿主的值。CodeBuddy 带 `is_error` 的 PostToolUse 记为失败。
- **对应 spec 条款**:R2(CodeBuddy 侧)、R4、R5、R6、R7、R8、R9、R11、R12、§4.1–§4.3
- **强制引用**:`docs/guides/coding-standards.md`
- **依赖**:T-1(`capJsonValue`、上限常量)
- **涉及范围**:
  - 新增 `src/core/timeline/tool-args.ts`
  - 修改 `src/core/timeline/post-tool-summary.ts`、`src/core/timeline/payload.ts`、`src/core/timeline/hooks.ts`(`preToolUseHook`、`postToolUseHook`)
- **必须严格执行**:
  - **T-1 产出的接口(原文)**:
    - `truncateUtf8(s: string, maxBytes: number): string`:超限时在字符边界截断,并接上 `'... [truncated]'`,结果 ≤ `maxBytes`;
    - `capJsonValue(value: unknown, opts: { maxStringBytes: number; maxTotalBytes: number }): string`:不超限原样序列化;超限时按字段截断,保证返回值一定能 `JSON.parse` 且字节数 ≤ `maxTotalBytes`;
    - 常量 `SUMMARY_FIELD_MAX_BYTES = 2 * 1024`、`RESULT_SUMMARY_MAX_BYTES = 8 * 1024`、`EDIT_SNIPPET_MAX_BYTES = 4 * 1024`、`SUMMARY_VERSION = 2`,都在 `constants.ts` 中。
  - **`payload.ts` 的 `HookPayload` 新增可选字段**(都在 `extractHookPayload` 中做类型守卫,类型不对的当作缺失):
    - `tool_use_id?: string`
    - `agent_id?: string`
    - `agent_type?: string`
    - `duration_ms?: number`(仅当是有限数且 ≥0)
    - `error?: string`
    - `is_interrupt?: boolean`
  - **`tool-args.ts` 导出 `sanitizeToolArgs(toolName: string | undefined, toolInput: unknown): unknown`**:
    - `toolName === 'Write'` 且 `toolInput.content` 是字符串:返回去掉 `content` 的浅拷贝,再加上 `content_bytes`(UTF-8 字节数)和 `content_lines`。行数的算法:空串为 0;否则为按 `\n` 切分后的段数,若以 `\n` 结尾则减 1。
    - `toolName === 'Edit'`:`old_string` / `new_string` 用 `truncateUtf8(值, EDIT_SNIPPET_MAX_BYTES)` 截断。
    - `toolName === 'MultiEdit'`:对 `edits` 数组每一项的 `old_string` / `new_string` 做同样处理。
    - 其它情况原样返回入参。不修改入参对象本身。
  - **`post-tool-summary.ts`**:
    - 导出类型 `ToolResultSummaryV2 = { v: 2; success: boolean; payload: Record<string, unknown> }` 和 `ToolFailure = { error?: string; isInterrupt?: boolean }`。
    - 签名 `summarizeToolResponse(toolName: string | undefined, toolResponse: unknown, toolArgs?: unknown, failure?: ToolFailure): string`。
    - 返回 `capJsonValue({ v: SUMMARY_VERSION, success, payload }, { maxStringBytes: SUMMARY_FIELD_MAX_BYTES, maxTotalBytes: RESULT_SUMMARY_MAX_BYTES })`。
    - **payload 里取不到的字段一律不写**(既不写 `null`,也不写 `undefined` 键)。
  - **`success` 判定**:满足任一条即为 `false`,否则为 `true`。
    1. 传入了 `failure`;
    2. `toolResponse` 是对象且 `is_error === true`(CodeBuddy);
    3. `toolResponse.interrupted === true`;
    4. 退出码是非 0 的数字;
    5. `toolResponse.error` 是非空字符串。
  - **`interrupted`**:`toolResponse.interrupted === true` 或 `failure.isInterrupt === true` 时,写 `interrupted: true`(R12);否则不写。
  - **`exit_code`**:按以下优先级取第一个命中的,都没有就不写。Claude Code 成功的 Bash 因此不写 `exit_code`(spec Q1 未决,不编造)。
    1. `toolResponse.exit_code`(数字);
    2. `toolResponse.exitCode`(数字);
    3. `failure.error` 匹配 `/^Exit code (\d+)/` 时取捕获的数字。
  - **`error`**:仅当 `success === false` 时写。取 `failure.error`,没有则取 `toolResponse.error`(字符串)。
  - **单字段上限**:`stdout_preview`、`stderr_preview`、`error`、`response_preview` 这四个字段,写入前一律经 `truncateUtf8(值, SUMMARY_FIELD_MAX_BYTES)`,即每个 ≤2KB,不论摘要整体是否超限。`subject` 沿用现有的 200 字符上限。
  - **各工具的 payload**(R5:能从调用参数取的都取自 `toolArgs`):

    | 工具 | 字段与取法 |
    |---|---|
    | Read / Edit / Write / MultiEdit | `file` = `toolArgs.file_path` |
    | NotebookEdit | `file` = `toolArgs.notebook_path` ?? `toolArgs.file_path` |
    | Bash | `exit_code`(规则见上);`category` / `pass` / `fail` / `duration_ms` 来自 `detectBashSemantics({ command: toolArgs.command ?? '', stdout: 响应 stdout ?? '', exit_code })`,沿用现有逻辑:无输出时只得到 category;无语义时,若 `toolResponse.stdout` 是非空字符串则写 `stdout_preview`;`toolResponse.stderr` 是非空字符串时写 `stderr_preview`;另加 `interrupted` / `error` |
    | Agent / Task | `subagent_type` = `toolArgs.subagent_type` |
    | Skill | `skill` = `toolArgs.skill`(沿用现有逻辑) |
    | WebFetch / WebSearch | `url` = `toolArgs.url`(WebSearch 通常没有,不写即可) |
    | TaskCreate / TaskUpdate / TaskGet | 沿用现有 `taskId` / `subject` / `status` 逻辑 |
    | 其它 | `toolResponse` 是字符串或对象时,写 `response_preview` = 字符串本身或其 JSON 文本 |

    - 失败且没有 `toolResponse` 时(Claude 的失败 payload 不带响应),payload 里只写能取到的字段,外加 `error` / `exit_code` / `interrupted`。
    - 删除 v1 的 `lines_changed` 字段。删除对 `toolResponse.file_path` / `toolResponse.url` / `toolResponse.subagent_type` 的读取。
  - **`hooks.ts`**:
    - `preToolUseHook`:`tool_args: sanitizeToolArgs(payload.tool_name, payload.tool_input)`。payload 有 `tool_use_id` 时,写 `metadata.tool_use_id`;有非空 `agent_id` 时,写 `metadata.subagent = { id: agent_id, type: agent_type ?? null }`。白名单过滤逻辑不变。
    - `postToolUseHook`:
      - `tool_args` 同上做净化;
      - `tool_result_summary: summarizeToolResponse(payload.tool_name, payload.tool_response, payload.tool_input)`,传原始 `tool_input`,因为生成器要读 `file_path` / `command`;
      - metadata 同 pre;
      - payload 带 `duration_ms` 时:事件的 `duration_ms = Math.round(payload.duration_ms)`,并写 `metadata.duration_source = 'host'`,**此时不再进入估算**;
      - 没有时走现有估算 enricher;估算出值时写 `metadata.duration_source = 'estimated'`;估算不出则不写这个键。
    - metadata 只有在至少有一个键时才传入,否则保持 `undefined`,与现状一致。
  - 导出名以本任务为准:`sanitizeToolArgs`、`summarizeToolResponse`、`ToolResultSummaryV2`、`ToolFailure`。T-3 会按原名调用。
- **允许局部适配**:
  - 生成器内部按工具拆分的函数结构;
  - pre / post 构造 metadata 的公共辅助函数的名称和位置(可以放在 `hooks.ts` 内,或新建 `tool-event-meta.ts`);
  - `looksLikeError` 删除,或改写成上面的 success 判定。
- **完成条件**:
  - `npm run build` 通过;`npm test` 全绿。`post-tool-summary.test.ts`、`duration.test.ts` 等因形状变化失败的断言改为 v2 形状:顶层有 `v: 2`,没有 `lines_changed`,取不到的字段不出现;
  - 用 CodeBuddy 实测 payload 回放(见验证方式),得到的结果为:

    | 回放样本 | 期望 |
    |---|---|
    | `PostToolUse-Bash-失败.json` | `success:false`、`exit_code:1`、带 `error` |
    | `PostToolUse-Bash-exit3.json` | `exit_code:3` |
    | `PostToolUse-Bash-成功.json` | `success:true`、`exit_code:0`,没有 `stdout_preview` |
    | `PostToolUse-Edit.json` | `payload.file` 是 a.txt 的路径 |
    | `PostToolUse-Write.json` / `PreToolUse-Write.json` | `tool_args` 没有 `content`,有 `content_bytes:4`、`content_lines:1` |
    | `PostToolUse-Read-子agent.json` | metadata 带 `subagent.id`、`subagent.type: "Explore"`,`session_id` 与其它样本相同 |
    | `PostToolUse-Read-失败.json` | `success:false`,没有 `error`(样本里只有错误码) |
    | 任意 post 样本 | 带 `tool_use_id` |

- **验证方式**:
  - `npm run build && npm test`
  - CodeBuddy 回放(样本目录:`docs/features/2026-10-16-timeline采集的数据质量问题/实测/codebuddy-2.167.0/`)。在仓库根执行:

    ```bash
    T=$(mktemp -d) && git -C "$T" init -q && (cd "$T" && node "$OLDPWD/dist/cli/index.js" install -y >/dev/null)
    S="docs/features/2026-10-16-timeline采集的数据质量问题/实测/codebuddy-2.167.0"
    for f in "$S"/PostToolUse-*.json "$S"/PreToolUse-Write.json; do
      sub=timeline-post-tool-use-hook; case "$f" in */PreToolUse-*) sub=timeline-pre-tool-use-hook;; esac
      node -e "const j=require(process.argv[1]);j.cwd=process.argv[2];process.stdout.write(JSON.stringify(j))" "$PWD/$f" "$T" | node dist/cli/index.js $sub --agent codebuddy
    done
    node -e "const {DatabaseSync}=require('node:sqlite');const d=new DatabaseSync(process.argv[1]+'/.cgraphx/cgraphx.db');for(const r of d.prepare('select event_type,tool_name,tool_args,tool_result_summary,metadata,duration_ms from timeline_events order by id').all())console.log(JSON.stringify(r))" "$T"
    ```

    逐行对照完成条件里的表格。`install -y` 会在临时目录生成 `.cgraphx/`;如果需要 git 仓库之外的前置条件,按实际报错补齐。
  - Claude Code 形状回放(构造的 payload,形状取自本机 transcript),在同一个临时目录执行:

    ```bash
    echo '{"session_id":"s1","cwd":"'"$T"'","hook_event_name":"PostToolUse","tool_name":"Edit","tool_use_id":"toolu_1","duration_ms":37,"tool_input":{"file_path":"'"$T"'/a.txt","old_string":"a","new_string":"b"},"tool_response":{"filePath":"'"$T"'/a.txt","oldString":"a","newString":"b","originalFile":"a\n","structuredPatch":[],"userModified":false,"replaceAll":false}}' | node dist/cli/index.js timeline-post-tool-use-hook
    echo '{"session_id":"s1","cwd":"'"$T"'","hook_event_name":"PostToolUse","tool_name":"Bash","tool_use_id":"toolu_2","duration_ms":5,"tool_input":{"command":"cat big"},"tool_response":{"stdout":"'"$(head -c 9000 /dev/zero | tr '\0' x)"'","stderr":"'"$(head -c 9000 /dev/zero | tr '\0' y)"'","interrupted":false,"isImage":false,"noOutputExpected":false}}' | node dist/cli/index.js timeline-post-tool-use-hook
    ```

    期望:
    - Edit 行:`payload.file` 为 a.txt 的路径,`duration_ms=37`,`metadata.duration_source="host"`,`metadata.tool_use_id="toolu_1"`;
    - Bash 行:摘要能解析,`stdout_preview` / `stderr_preview` 都以 `... [truncated]` 结尾,`success:true`,没有 `exit_code`。
- **独立提交**:是。完成后两个 agent 的 PostToolUse 都写 v2;CodeBuddy 的失败也已经能记录。
  - 提交主题:`feat(timeline): 工具摘要 v2——字段取自调用参数 + Write 不存正文 + 记录 tool_use_id / 子 agent / 耗时来源`
- **风险 / 注意事项**:
  - `summarizeToolResponse` 的前三个参数的含义不变,`task` / `sync` 不调用它。
  - Skill 分支现在提前 return,改造时要保证它也输出 `v` 并经过 `capJsonValue`。

---

### T-3: Claude Code 的 PostToolUseFailure 接入

- **目标**:Claude Code 的失败工具调用记为 `post_tool_use` + `success:false`。安装器只给支持该事件的 agent 写入新 hook,命令带旧版容错后缀。已有 6 个 hook 的命令串逐字不变。
- **对应 spec 条款**:R2(Claude 侧)、R3、R12、§5「hook 接入」、§7(旧版全局 cgraphx、Claude 侧零变化、agent 差异只经描述表达)
- **强制引用**:`docs/guides/coding-standards.md`
- **依赖**:T-2(`summarizeToolResponse` 的 `failure` 参数、`sanitizeToolArgs`、metadata 构造方式)
- **涉及范围**:
  - 修改 `src/core/agents/types.ts`、`src/core/agents/profiles.ts`
  - 修改 `src/core/timeline/constants.ts`、`src/core/timeline/hooks.ts`、`src/core/timeline/cli.ts`、`src/core/timeline/installer.ts`
- **必须严格执行**:
  - **T-2 产出的接口(原文)**:
    - `summarizeToolResponse(toolName: string | undefined, toolResponse: unknown, toolArgs?: unknown, failure?: { error?: string; isInterrupt?: boolean }): string`
    - `sanitizeToolArgs(toolName: string | undefined, toolInput: unknown): unknown`
    - `HookPayload` 已有可选字段 `tool_use_id`、`agent_id`、`agent_type`、`duration_ms`、`error`、`is_interrupt`
    - metadata 键为 `tool_use_id`、`subagent: { id, type }`、`duration_source: 'host' | 'estimated'`
  - **agents**:
    - `AgentProfile.capabilities` 增加 `readonly postToolUseFailure: boolean`;
    - `CLAUDE_CODE` 设为 `true`,`CODEBUDDY` 设为 `false`(实测:CodeBuddy 2.167.0 的失败走 PostToolUse 并带 `is_error`)。
  - **`constants.ts`**:
    - `HOOK_EVENTS_TO_COMMANDS` 末尾追加一项:`{ event: 'PostToolUseFailure', subcommand: 'timeline-post-tool-use-failure-hook', requiresCapability: 'postToolUseFailure', tolerateLegacyBinary: true }`;
    - 已有 6 项不变,也不加这两个字段;
    - **保留字面量推导**:数组仍用 `as const`,类型约束用 `satisfies`。不得给数组加显式类型注解,否则 `event` 会被拓宽成 `string`,`HookEventName` 跟着退化,`HOOK_HANDLERS` 漏配处理函数时编译期就不再报错;
    - 新增常量 `LEGACY_BINARY_TOLERANT_SUFFIX = ' 2>/dev/null || true'`。
  - **`installer.ts` 的 `installTimelineHooks`**:遍历名单时,
    - `requiresCapability` 存在且 `profile.capabilities[requiresCapability] !== true` 的项跳过,不写,也不计入 `written` / `skipped`;
    - 命令串 = `hookCommand(\`cgraphx ${subcommand}\`, profile) + (tolerateLegacyBinary ? LEGACY_BINARY_TOLERANT_SUFFIX : '')`;
    - 结果:Claude Code 的命令为 `cgraphx timeline-post-tool-use-failure-hook 2>/dev/null || true`。幂等判断仍按完整命令串精确匹配。
    - `uninstallTimelineHooks` 按 `'cgraphx timeline-'` 子串匹配,已经覆盖新命令,不改。
  - **`hooks.ts` 新增 `postToolUseFailureHook(agent: AgentId = DEFAULT_AGENT_ID): Promise<void>`**:
    - 经 `runHook` 构造事件:
      - `event_type: 'post_tool_use'`;
      - `tool_name`;
      - `tool_args: sanitizeToolArgs(...)`;
      - `tool_result_summary: summarizeToolResponse(payload.tool_name, undefined, payload.tool_input, { error: payload.error, isInterrupt: payload.is_interrupt })`;
      - `turn_id`:读法同 `postToolUseHook`;
      - `cwd`、`agent`;
      - metadata 规则同 T-2(`tool_use_id`、`subagent`);
      - payload 带 `duration_ms` 时写入,并加 `duration_source: 'host'`;不带时**不估算**。
    - 没有 `tool_name` 时返回 null,不记录。
  - **`cli.ts`**:`HOOK_HANDLERS` 增加 `PostToolUseFailure: postToolUseFailureHook`。注册循环已经遍历名单,新子命令自动隐藏注册,并接受 `--agent`。
- **允许局部适配**:
  - `requiresCapability` 的类型表达方式(`keyof AgentProfile['capabilities']` 或字面量联合);
  - `postToolUseFailureHook` 与 `postToolUseHook` 公共部分的抽取方式。
- **完成条件**:
  - `npm run build` 通过;
  - `npm test` 全绿。
    - `__tests__/core/timeline/installer.test.ts` 中 `writtenHookEvents` 的断言用的是 `expect.arrayContaining`,新增一项后不改也能通过;如果要改,只能追加 `'PostToolUseFailure'`。
    - 其它断言 Claude 侧 hook 命令串的用例,除新增项外不得改动期望值;
  - CodeBuddy 的 settings 中没有 PostToolUseFailure。
- **验证方式**:
  - `npm run build && npm test`
  - **失败事件回放**(在 T-2 的临时目录 `$T` 中执行):

    ```bash
    echo '{"session_id":"s1","cwd":"'"$T"'","hook_event_name":"PostToolUseFailure","tool_name":"Bash","tool_use_id":"toolu_3","tool_input":{"command":"ls /nope"},"error":"Exit code 1\nls: /nope: No such file or directory","is_interrupt":false,"duration_ms":12}' | node dist/cli/index.js timeline-post-tool-use-failure-hook; echo "exit=$?"
    ```

    期望:
    - 输出只有 `exit=0`,stdout 没有其它内容;
    - 库里新增一行 `post_tool_use`,摘要为 `{"v":2,"success":false,"payload":{"exit_code":1,"error":"Exit code 1\nls: /nope: …"}}`,`duration_ms=12`,`metadata` 含 `tool_use_id` 和 `duration_source:"host"`。
  - **旧版全局容错**(全局 cgraphx 2.0.7 没有这个子命令):

    ```bash
    echo '{}' | sh -c 'cgraphx timeline-post-tool-use-failure-hook 2>/dev/null || true'; echo "exit=$?"
    ```

    期望只输出 `exit=0`。
  - **Claude 侧零变化**(A10):

    ```bash
    A=$(mktemp -d) && B=$(mktemp -d) && git -C "$A" init -q && git -C "$B" init -q
    (cd "$A" && cgraphx install -y >/dev/null)
    (cd "$B" && node "$OLDPWD/dist/cli/index.js" install -y >/dev/null)
    diff <(node -e "console.log(JSON.stringify(require('$A/.claude/settings.json').hooks,null,1))") <(node -e "console.log(JSON.stringify(require('$B/.claude/settings.json').hooks,null,1))")
    ```

    期望:diff 只有新增的 `PostToolUseFailure` 一组;已有事件的命令串没有任何差异。

    再执行 `diff -rq "$A/.claude" "$B/.claude"`,期望只报 `settings.json` 不同(spec A10 要求对比整个 `.claude/`)。如果全局 2.0.7 与当前 HEAD 在本需求之外还有其它差异(比如 sync hook),逐条确认这些差异与本需求无关,并在提交说明里写明。
  - 再用 `-t codebuddy` 安装到另一个临时目录,确认 `.codebuddy/settings.json` 中没有 PostToolUseFailure。
- **独立提交**:是。
  - 提交主题:`feat(timeline): 接入 PostToolUseFailure——失败调用记为 post_tool_use + 旧版全局容错后缀`
- **风险 / 注意事项**:
  - 本会话的宿主不会因为改了 dist 就加载新 hook,因为 hook 在会话启动时就固定了。真实环境的验证(spec A2 / Q1)要在部署后的新会话里做,提交说明里写明"Claude Code 真实失败 payload 待新会话验证"。
  - 已部署项目需要重跑 `cgraphx install` 或 upgrade 才能获得新 hook。这是既有的升级路径,不额外处理。

---

### T-4: 契约文档 + 读取方容错核对 + 知识库订正

- **目标**:把摘要契约写成知识库文档(spec §4.4)。逐项核对读取方满足 R10 / R11,确认不需要改代码。订正知识库里已经被实测推翻的说法。
- **对应 spec 条款**:§4.4、R10、R11、§6
- **强制引用**:无(只动文档;读取方核对不改代码。若核对时发现必须改代码,按 PLAN_CONFLICT 上报)
- **依赖**:T-3(文档要对照最终代码写)
- **涉及范围**:
  - 新增 `docs/knowledge/开发时间线工具事件契约.md`
  - 修改 `docs/knowledge/agent适配.md`
- **必须严格执行**:
  - 用 `/knowledge-write` 的格式写,frontmatter 字段参照同目录的 `agent适配.md`:`document_type: mechanism`,`concepts` 含「开发时间线」,`related_code` 列出 `src/core/timeline/post-tool-summary.ts`、`json-cap.ts`、`tool-args.ts`、`hooks.ts`、`constants.ts`。写完必须通过 `cgraphx docs validate`。
  - 文档正文必须包含:
    1. v2 形状和 `v` 的含义;
    2. spec §4.2 的可得性表(Claude Code / CodeBuddy 两列,按最终实现填写;Task* 和 NotebookEdit 在 CodeBuddy 列标「未实测」);
    3. metadata 新增的三个键;
    4. 各上限常量的名字和值;
    5. v1 与 v2 的区别(v1 没有 `v`;字段缺失表示没采到;v1 的 Bash 摘要可能是残缺的);
    6. 读取方规则 R10、R11 的原文;
    7. 失败的两种来源(Claude 的 PostToolUseFailure、CodeBuddy 带 `is_error` 的 PostToolUse),以及权限拒绝不记录这一点;
    8. 字段缺省的含义:`interrupted` 只在为 true 时才写,缺省表示"未中断或未知";Claude Code 成功的 Bash 没有 `exit_code`(spec Q1 未决);
    9. Bash 的 `pass` / `fail`:test 类命令的计数来自输出解析,CodeBuddy 下拿不到;build / git_write 类的 pass / fail 由退出码推出,CodeBuddy 下也有。可得性表要把这两种口径分开写。
  - `agent适配.md` 中「CodeBuddy 与 Claude Code 同构」这一条补充实测结论(2026-10-16,CodeBuddy 2.167.0):
    - 工具响应形状不同:Bash 给 `exitCode`,不给 stdout / stderr;Read / Edit / Write 的响应是纯文本;
    - CodeBuddy 没有 PostToolUseFailure,失败走 PostToolUse 并带 `is_error`;
    - 指向新的契约文档。
    - 不删除原文中仍然成立的部分。
  - **读取方核对**:逐个确认下列代码在摘要不能解析或是 v1 形状时不抛异常,把核对结论写进契约文档的「读取方」一节:
    - `src/core/timeline/store.ts` 的 `rowToEvent`
    - `src/core/sync/artifacts.ts` 的 `isSuccessful`
    - `src/web/timeline-event-rows.ts` 的摘要显示
    - `src/core/task/artifacts.ts`
    - 另外正向确认 spec A11:`src/core/sync/artifacts.ts` 只采信 `post_tool_use` 且 `isSuccessful` 为真的编辑事件,因此 `success:false` 的 Edit / Write 不会进入上报的产出;上报的事件字段(`toIngestEvent`)没有改动。结论写进文档。
- **允许局部适配**:文档的章节组织和措辞(遵守知识库规范:陈述事实,不写防御性措辞)。
- **完成条件**:
  - `cgraphx docs validate docs/knowledge/开发时间线工具事件契约.md` 和 `cgraphx docs validate docs/knowledge/agent适配.md` 都通过。若全局 cgraphx 版本不支持带路径的 validate,改用 `node dist/cli/index.js docs validate`。
  - `cgraphx docs index` 之后,`cgraphx docs find --concept=开发时间线` 能找到新文档。
- **验证方式**:同完成条件中的两条命令。
- **独立提交**:是。
  - 提交主题:`docs(timeline): 工具事件摘要契约 v2 成文 + agent 适配补充 CodeBuddy 响应差异`
- **风险 / 注意事项**:
  - 不要在文档里写本次开发过程的协作细节(谁问了什么、哪轮改了什么),只写契约和事实。
