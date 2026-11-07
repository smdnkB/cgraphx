# T-2: 会话文件读取器(Claude Code + CodeBuddy)

> 产物: plan
> 依据: spec@eac0b58

### 目标

`timeline/ingest/` 下定义统一「会话事实」模型,并实现两家 agent 的会话文件读取器:输入文件路径与起始字节偏移,输出事实序列与新偏移,不碰任何库、不感知项目归属。

### 对应 spec 编号

D1 🔒、D6、D7、D8(解析规则)、K4、K5、K6、K7、K8、K9、K10

### 强制引用

`docs/guides/coding-standards.md`(契约部分)

### 涉及范围

- 新增 `src/core/timeline/ingest/types.ts`(C-1 事实模型)
- 新增 `src/core/timeline/ingest/claude-transcript.ts`
- 新增 `src/core/timeline/ingest/codebuddy-transcript.ts`
- 新增 `src/core/timeline/ingest/reader.ts`(读取器接口与按 `sessionReader` 标识的分发)

### 必须严格执行

- 事实模型五种事实与「读取器不碰库、不知道项目归属、不生成事件类型与 source_key」按 C-1。
- 读取器经 agents 门面只取 `agentSessionsRoot`(C-7);文件布局:列 `sessionsRoot()` 下每个项目子目录里的 `*.jsonl` 与 `subagents/*.jsonl`(布局核对见完成条件第 1 条)。
- Claude Code 解析规则按 D6/D7/D8:
  - 提问:`type=user`、非侧链、非 `isCompactSummary`、没有工具结果附件;`<task-notification>` / `<agent-message` 开头 → 自动消息(**沿用 `classifyAutoMessage`**,含 `isMeta` 行也过它);其余 `isMeta`、`[Request interrupted` 开头、`<local-command` 开头不算;`<command-name>` 还原成 `/命令 参数`;`queued_command` 附件文本没有对应用户行的才算一条。
  - 工具:assistant 行的 `tool_use` 块与 user 行的 `tool_result` 块按 `tool_use_id` 配对成一条 `tool` 事实;结果行 `is_error` → 失败;`tool` 事实带 `subagent {id, type}`(行内有才带);还没有结果的调用不产事实(留给下次)。
  - 回复:`stop_reason=end_turn` 的 assistant 行产 `turn_end`(ts、回复 message.id)。
  - 会话头:**每个 sessionId 在本文件首次出现处**产一个 `session_head`(sessionId、该行的 cwd、该行 ts)——分叉文件开头拷来的旧会话行,同样给旧会话产头(C-1;键按会话编号去重,不会重复记)。
- 事实里保留行内自带的时间戳与 uuid,不做任何「现在时间」填充(时间填充归 T-3 管线)。

### 允许局部适配

- 行级 JSON 字段的读取与防御(字段缺失、类型不对的行跳过;**不认识的行类型单独跳过、不算错误**,K11)。
- 读取器内部函数拆分与命名;`reader.ts` 的分发形状。

### 具体要求

1. **第一步(实测回填)**:读本机 `~/.claude/projects/` 与 `~/.codebuddy/projects/` 的真实样本核对——Claude Code 的行字段名(`type`、`sessionId`、`uuid`、`cwd`、`isMeta`、`isCompactSummary`、`message.content` 块结构、`toolUseResult`、`subagents/` 布局)、**子 agent 文件的行内是否带 `cwd`**(T-3 的归属兜底要用)与 CodeBuddy 的【待确认】三点(子 agent 文件在 `<会话>/subagents/agent-<id>.jsonl`、`status` 字段 completed/incomplete 的成败含义、斜杠命令与自动消息的原文形式);把核对结论写进读取器文件头注释。
2. `types.ts` 定义 C-1 的五种事实与读取器返回形状;`claude-transcript.ts`、`codebuddy-transcript.ts` 各实现 `readSessionFacts(path, fromByteOffset)`;`reader.ts` 按 agents 描述的 `sessionReader` 标识分发,并导出「列出某个 sessionsRoot 下全部会话文件」的函数(返回绝对路径列表,供 T-3 用)。
3. 复用现有纯函数做摘要不做:本任务**不做**摘要/参数净化(`sanitizeToolArgs` / `summarizeToolResponse` 在 T-3 管线里调),事实里带原始参数与结果载荷。
4. 大文件流式读:按字节偏移用 `fs.createReadStream` / `fs.read` 增量读,不整文件进内存(本机单文件最大百 MB 级)。

### 完成条件

- `npm run build`、`npm test` 通过。
- 本机回放对比(spec 设计验收 1,手工跑、不进统一验证):用本仓库 10-18 以来 59 个会话的会话文件回放——工具事实与 hook 记录按 `tool_use_id` 全部对上、名字与失败标记一致;人发提问对上率 ≥99%;自动消息差异逐类解释清(404 vs 503 的 99 条,结论写进本任务交付说明;若结论要求改 C-1 事实种类,停下按 PLAN_CONFLICT 上报)。
- 分叉拷贝样本(如 spec 提到的 c512fa32 前 1,880 行)读出的旧会话事实能被 `sessionId` 区分(为 T-3 的 C-2 去重做好准备)。

### 提交点

1. `feat(timeline): 会话事实模型与两家读取器——ingest/ 只产事实不碰库`:ingest/ 四个新文件

### 风险/注意事项

- Claude Code 会话文件有 19 种行类型且在增加:宁可多跳过、不可抛错;整份文件读出内容却一条事实都没有(K11)由 T-3 判定,读取器只保证「读出多少给多少」。
- 时间戳直接用行内值;CodeBuddy 的时间字段格式实测确认(ISO 字符串按原样透传,解析归 T-3)。
- 不改 `timeline/index.ts` 门面(本任务的产物只被 T-3 消费)。
