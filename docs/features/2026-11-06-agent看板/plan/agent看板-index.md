# 实现计划: agent看板

> 产物: plan
> 依据: spec@90c1887

## 设计预览

原来一个任务做下来,会话散在 Claude Code、CodeBuddy、DeepSeek Harness 各自的项目列表里,和别的任务混在一起,找不回当时的会话。这次在 core 里新增只读看板子系统 `src/core/board/`:任意目录跑 `cgraphx board`,先逐项目补录,再打开本机网页(左栏任务、右栏会话),会话自动挂到任务上,点按钮复制会话标题和完整编号,回到对应软件里找回。支撑它有三件底层事:timeline 接入 DeepSeek 只读会话来源(zstd 帧式 jsonl 的第三家读取器)、项目库加一张会话标题表(claude/deepseek 的标题,老会话一次性回填)、以及一个纯函数的「认任务」匹配器(按副本、写需求目录、流程命令、提交等依据把会话挂到需求)。

**难回头的决策落在哪**(决策已在 spec 确认,这里核对落点,其余可略读)

| spec 决策 | 落在 | 怎么守住 |
|---|---|---|
| D1 🔒 新子系统 `src/core/board/`,只经 project、timeline、features、replica、agents 门面取数 | T-3 `board/` 五件套 + T-4 `server.ts`/`page.html` + T-5 注册 | board 不 import 别的子系统内部模块,依赖清单钉死在 C-6 之前的约束里;`src/cli/index.ts` 只加两行注册 |
| D2 🔒 服务只听 127.0.0.1,随机端口 + 随机令牌,接口校验令牌/Host/Origin | T-4 `board/server.ts` | C-7:地址带 `?t=<令牌>`,三项校验任一不过 403,并发刷新 409,无路径参数 |
| D8 🔒 标题存项目库新表 `timeline_session_titles`,不升 schema 版本号 | T-2 `timeline/schema.sql`、`store.ts`、两个读取器、补录管线 | C-2:只加 `CREATE TABLE IF NOT EXISTS`,写入按 custom > ai > agent、同级取新 |
| D12 🔒 DeepSeek 是只读来源,`AGENT_PROFILES`/`AgentId` 不动 | T-1 `agents/sources.ts` + `ingest.ts`/`rebuild.ts` 换 `listSessionSources()` | C-1:新类型 `SessionSource`,安装器/副本/门禁/会话提示零变化;事件 agent 列放宽到 `SessionSourceId`(C-3) |

## 来源 spec 摘要

- 功能方案: F1 任务列表、F2 任务下的会话、F3 复制会话标题和编号、F4 自动把会话挂到任务;边界(空态/打不开浏览器/没能补录/目录不在/会话文件被清理)见 spec 各功能点的边界行。
- 细节方案: D1–D14(见下面「细节方案核对」逐条落点)。
- 全局约束: `timeline query/stats/show/recent` 参数与输出格式不变;`AGENT_PROFILES` 不变;看板除补录外不写任何东西;读取器只产事实不打开库。
- 待确认项: 无。

## 范围

- 覆盖功能点: F1、F2、F3、F4 全部(含各自边界①–⑤)。
- 对应 spec 决策: D1–D14 全部 + 文档节。

## 明确不包含(功能方案不做项)

- 直接打开(恢复)会话;手动建任务、手动挂会话;看板里改数据;看板里看会话内容;任务状态和看板列(待办/进行中/已完成)。
- 没装 cgraphx 的目录出任务(提示先 install 即可)。
- DeepSeek 进安装器、部署配置、过提交门禁。
- Claude Code、CodeBuddy、DeepSeek 之外的 agent。
- 单元测试/接口测试(代码完成后的独立流程,plan 不排;验收表里的「单元测试」项由后续 `/unit-spec` → `/unit-code` 覆盖)。

## 任务清单

| 任务 | 文件 | 对应 spec | 涉及范围(改哪些文件) |
|---|---|---|---|
| T-1 会话来源与 DeepSeek 读取器 | `plan/agent看板-01-会话来源与deepseek读取器.md` | F4(D12、D13)、全局约束 | `agents/types.ts`、`agents/sources.ts`(新)、`agents/index.ts`、`timeline/types.ts`、`timeline/ingest/deepseek-session.ts`(新)、`timeline/ingest/reader.ts`、`timeline/ingest/ingest.ts`、`timeline/ingest/rebuild.ts` |
| T-2 会话标题链路 | `plan/agent看板-02-会话标题链路.md` | F2/F3 的 K5、F4 图「多读标题」(D8、D9) | `timeline/schema.sql`、`timeline/store.ts`、`timeline/ingest/types.ts`、`timeline/ingest/claude-transcript.ts`、`timeline/ingest/deepseek-session.ts`、`timeline/ingest/ingest.ts`、`timeline/ingest/rebuild.ts`、`timeline/index.ts` |
| T-3 看板计算 | `plan/agent看板-03-看板计算.md` | F1(K1–K3、K12–K14)、F2(K4、K6)、F4(K8–K11)(D5、D6、D7、D10、D14) | `timeline/board-read.ts`(新)、`timeline/types.ts`、`timeline/index.ts`、`features/index.ts`、`board/types.ts`、`board/constants.ts`、`board/errors.ts`、`board/match.ts`、`board/compute.ts`、`board/index.ts`(后七个为新文件) |
| T-4 看板服务与页面 | `plan/agent看板-04-看板服务与页面.md` | F1③、F2、F3、F3①(D2、D3、D11) | `board/server.ts`、`board/page.html`(均新) |
| T-5 命令与构建接入 | `plan/agent看板-05-命令与构建接入.md` | F1 行为链、D4、D1 | `board/cli.ts`(新)、`src/cli/index.ts`、`scripts/copy-assets.cjs` |
| T-6 文档与知识沉淀 | `plan/agent看板-06-文档与知识沉淀.md` | 文档节 | `CHANGELOG.md`、根 `CLAUDE.md`、`assets/claude-template/skills/cgraphx-guide/SKILL.md`、`assets/claude-template/skills/cgraphx-guide/how-to-use.md`、`assets/claude-template/skills/cgraphx-guide/how-to-use.html`、`assets/claude-template/skills/doc-report/SKILL.md`、`docs/knowledge/开发时间线工具事件契约.md`、`docs/knowledge/agent适配.md` |

## 执行顺序

六步,全部串行(文件重叠拆不出并行边:T-1/T-2 都改 `ingest.ts`、`rebuild.ts`、`deepseek-session.ts`;T-3 产出的数据形状 C-6 是 T-4/T-5 的契约;T-6 要写最终行为):

1. T-1(DeepSeek 来源从登记到补录全线打通)
2. T-2(标题事实、标题表、老会话回填)
3. T-3(看板只读查询 + 认任务 + 数据装配)
4. T-4(本机服务与页面)
5. T-5(`cgraphx board` 命令、注册、page.html 随包分发)
6. T-6(文档、skill 模板、知识库)

每步做完按该任务的提交点提交;中间提交不保证能构建,最后一步完成后跑统一验证。

## 必须严格执行的契约

**C-1 只读会话来源(agents 门面,D12)**

- `agents/types.ts`:`SESSION_READER_IDS` 增加 `'deepseek-session'`;新增类型
  `SessionSourceId = AgentId | 'deepseek'`;新增接口
  `SessionSource { id: SessionSourceId; displayName: string; sessionsRoot(): string | null; listFiles(root: string): string[]; sessionReader: SessionReaderId; unavailableReason(): string | null }`。
- 新文件 `agents/sources.ts`:`listSessionSources(): readonly SessionSource[]`——前两项由 `AGENT_PROFILES` 的 claude-code、codebuddy 派生(`sessionsRoot` 即现有 `agentSessionsRoot(profile)` 语义,含环境变量覆盖;`unavailableReason()` 恒 null),第三项 deepseek:`sessionsRoot()` 取 `DSH_HOME`(设了且非空)否则 `~/.dsh/sessions`;`listFiles` 列 `<root>/<一级目录>/<会话编号>/session.v4.jsonl.zstd`,按路径升序;`unavailableReason()` 在 `zlib.zstdDecompressSync` 不存在时返回「DeepSeek 会话要 Node 22.15 以上,没有读取」,否则 null。
- **`listFiles` 的落地路径钉死**(避免 agents 伸手进 timeline 内部模块):现有 `ingest/reader.ts` 的 `listSessionFiles`(claude/codebuddy 的目录布局列举,含 subagents/ 递归)整体**移入 `agents/sources.ts`**(reader.ts 删除该函数,读取器分发留下),claude/codebuddy 来源的 `listFiles` 即它;`ingest.ts`/`rebuild.ts` 不再 import `listSessionFiles`,一律经 `source.listFiles(root)`。
- `agents/index.ts` 导出 `listSessionSources` 与两个新类型;`AGENT_PROFILES`、`AgentId`、profiles.ts 一律不动。
- `ingest.ts` 与 `rebuild.ts` 的会话文件枚举从 `listAgentProfiles()` + `agentSessionsRoot()` 改为 `listSessionSources()`:跳过 `sessionsRoot()` 为 null 的来源;`unavailableReason()` 非 null 的跳过列举、并把该文案加进本次 `TimelineSyncOutcome.notices`(每趟最多一条)。progress 行(`session_files.agent`)、事件 `agent` 列、K11 提示的 display 都改用 `source.id` / `source.displayName`。

**C-2 会话标题:事实与表(D8、D9)**

- `ingest/types.ts` 新增事实:`SessionTitleFact { kind: 'session_title'; sessionId: string; ts: SessionFactTs; title: string; titleKind: 'custom' | 'ai' | 'agent' }`,并入 `SessionFact` 联合。读取器照旧只产事实。
- `timeline/schema.sql` 追加(幂等,**不升 `TIMELINE_SCHEMA_VERSION`**——spec D8 迁移与兼容节的取舍,沿用 timeline_meta 先例):
  `CREATE TABLE IF NOT EXISTS timeline_session_titles (session_id TEXT PRIMARY KEY, title TEXT NOT NULL, kind TEXT NOT NULL, ts TEXT NOT NULL);`
- `store.ts` 新增 `upsertSessionTitle(db 或 store 上, row: { sessionId, title, kind, ts })`:写入优先级 `custom` > `ai` > `agent`,同级 `ts` 新者胜;一个会话只留一行。同文件新增(或邻近模块导出)只读 `readSessionTitles(db): Array<{ sessionId, title, kind, ts }>`。
- 补录管线:`writeFacts`(增量)与 `writeParsedFacts`(重建)在写事件的同一事务里,把本文件事实中的 `session_title` 按 C-2 优先级写入标题表;偏移推进逻辑不变。事实映射 `mapFacts` 不产标题(标题不是事件)。
- 老会话回填(D9):`ensureTimelineUpToDate` 里,项目库 `timeline_meta` 无 `session_titles_at` 键时执行一次——拿同一把 `ingest.lock`(拿不到就跳过,下次再来),把 sessions.db 里 `project_dir` 等于本项目目录的全部文件从偏移 0 重读,只取 `session_title` 事实写标题表,**不写事件、不推进偏移、不改 size/mtime 行**,完成后在项目库写 `session_titles_at` 记号。回填放在重建判定之后、增量之前。
- `rebuildTimeline` 的全量解析同样收标题(经同一写入路径);`commitRebuild` 的并库短事务里,标题表与事件表同命运:`DELETE FROM timeline_session_titles` → 从临时库 `INSERT SELECT` → 同事务写 `session_titles_at`(重建已从头读过全部文件,不再回填)。
- `timeline/index.ts` 门面导出 `readSessionTitles` 的按 dataDir 只读包装(供看板;与 C-5 一并落也可以,形状见 C-5 的 `titles`)。

**C-3 事件 agent 列放宽(D12)**

- `timeline/types.ts`:`TimelineEventInput.agent` 与 `TimelineEvent.agent` 的类型从 `AgentId | null` 放宽为 `SessionSourceId | null`。describe/stats/report 等消费侧对 agent 值原样透传,不特判 deepseek。

**C-4 DeepSeek 会话文件契约(D13)**

- 布局:`~/.dsh/sessions/<编码目录>/<会话编号>/session.v4.jsonl.zstd`(`DSH_HOME` 设了以它为根,见 C-1);文件是拼接的 zstd 帧,每帧解压后是若干 JSONL 行。
- 读取器 `deepseek-session.ts` 实现现有 `SessionFactsReader` 签名(文件绝对路径 + 起始字节偏移):按 zstd 帧头结构切帧(帧头魔数 `0xFD2FB528`,参照 `deepseek-harness/packages/session/session-persistence-jsonl/src/zstd.ts` 的 scanZstdFrames 结构自实现,不引入依赖),逐帧 `zlib.zstdDecompressSync`,`consumedBytes` 记到最后一个完整帧的末尾,尾部不完整的帧留到下次。
- 行映射:文件头 → `SessionHeadFact`(startCwd 取文件头里的开始目录);`user/message` 且 `data.source.kind === 'user'` → `PromptFact`(source 'user',其余按 auto 口径);`tool/call` 配 `tool/result`(按 callId)→ `ToolFact`,工具名映射到 `Write`、`Edit`、`Read`、`Bash`、`Grep`、`Glob`、`Skill`(不在映射表的原样传);`turn/end` → `TurnEndFact`。不认识的行类型跳过不算错误。`session/title` 行的映射(`SessionTitleFact`,`titleKind: 'agent'`)与该事实类型一起归 T-2(见 C-2)——T-1 先按「不认识的行类型跳过」处理,不算缺口。
- 子会话:文件头带 `parentSession` 的是子会话,其全部事实(含标题)的 `sessionId` 按 parentSession 链归到根主会话;会话头事实的 `startCwd` 取子会话文件自己的开始目录(不跟主会话)。
- `session_files.session_id`:deepseek 文件记事实所属的主会话编号(读到事实时取事实的 sessionId;只读了会话头的取头事实的 sessionId);claude/codebuddy 沿用现有 `sessionFileId(file)` 路径规则。`saveRow` 相应支持显式传入 sessionId。
- 已知限制(记录不修):deepseek 文件按路径排序不保证主文件在子会话文件前,主会话的 `session_start` 事件先写者可能取到子会话的开始目录——子会话与主会话同仓,对 K8 匹配与展示无实害。

**C-5 timeline 看板只读查询(D14)**

- 新文件 `timeline/board-read.ts`,门面 `timeline/index.ts` 导出:
  `readTimelineBoardData(dataDir: string): BoardTimelineData | null`(库文件不在 → null;按目录只读打开,不应用 schema、不建目录,写法同 `roots.ts` 的 `readDbFile`)。
- `BoardTimelineData`(类型放 `timeline/types.ts`;按目录只读打开的旧库可能缺新表——`timeline_events` 或 `timeline_session_titles` 任一表不在,对应数组按空,不报错):
  - `sessions: Array<{ id: string; agent: string; startCwd: string; ts: string }>` —— `session_start` 事件(session_id、agent、cwd、ts)。
  - `prompts: Array<{ ts: string; sessionId: string; text: string }>` —— `user_prompt` 事件的 ts、session_id、prompt_text。
  - `commits: Array<{ ts: string; sessionId: string | null; files: string[]; branch: string | null }>` —— `git_commit` 的 `commit_files` 在读取侧经 `stats.ts` 的 `parseCommitFiles` 解析成路径数组;`branch` 经 `CASE WHEN json_valid(...) THEN json_extract(metadata,'$.branch') ELSE NULL END`。
  - `tools: Array<{ ts: string; sessionId: string; tool: string; filePath: string | null; args: string | null }>` —— `post_tool_use` 且 `tool_name IN ('Write','Edit','MultiEdit','NotebookEdit','Read','Skill')`;`filePath` 取 `CASE WHEN json_valid(tool_args) THEN json_extract(tool_args,'$.file_path') ELSE NULL END`,`args` 仅 Skill 取 `json_extract(tool_args,'$.args')`。**Bash 不取**(K11 天然成立)。
  - `titles: Array<{ sessionId: string; title: string; kind: string; ts: string }>` —— `timeline_session_titles` 全表。
- 各数组按 `ts` 升序(同 ts 按 id);除上述列外不取别的大列(tool_result_summary、整段 tool_args 不出库)。

**C-6 看板数据形状(D3;page ↔ server 契约,也是 T-3 的产出物)**

```ts
interface BoardData { projects: BoardProject[] }
interface BoardProject { name: string; dirs: string[]; notice: string | null; tasks: Task[]; older: Task[]; unsorted: Session[] }
interface Task { featureId: string; title: string; stage: string | null; fixedCount: number; maybeCount: number; agents: string[]; lastActiveAt: string | null; fixed: Session[]; maybe: Session[] }
interface Session { agent: string; id: string; title: string; startCwd: string; dirLabel: string; from: string | null; to: string | null; reasons: string[]; fileExists: boolean }
```

- `agents` 为去重后的来源显示名,按 claude-code、codebuddy、deepseek 顺序;`stage` 为 null 时页面显示 `-`;`from`/`to`/`lastActiveAt` 为 ISO 或 null。

**C-7 服务安全(D2)**

- `node:http`;`listen('127.0.0.1', 0)` 随机端口;每次启动 `crypto.randomBytes` 生成随机令牌,对外地址一律 `http://127.0.0.1:<端口>/?t=<令牌>`。
- 三个路由,其余 404:`GET /?t=` 返回 `page.html`(启动时读一次缓存);`GET /api/board?t=` 返回内存里的 `BoardData`;`POST /api/refresh?t=` 重跑刷新回调(见 C-8)后返回新数据。
- 校验:令牌不对 → 403;`Host` 头的 hostname 不是 `127.0.0.1`/`localhost`(或带了端口但不等于监听端口)→ 403;`POST /api/refresh` 的 `Origin` 头存在且 origin 不是 `http://127.0.0.1:<端口>` → 403。
- 刷新进行中再收到 `POST /api/refresh` → 409,页面照旧显示旧数据;`GET` 不受影响。
- 不接受路径参数、不做静态目录服务、除补录链路外不写任何东西。

**C-8 启动与刷新编排(D4)**

- 启动顺序钉死:枚举项目(C-9)→ 逐项目 `ensureTimelineUpToDate(<该项目的在用主目录>)`(串行)→ 认任务与数据装配(T-3)→ `listen` → 终端打印带令牌地址 → `spawn` 打开浏览器(darwin `open`、win32 `start`、其余 `xdg-open`;失败打印「浏览器没打开,手动访问 <带令牌地址>」,服务照常跑)→ 等待 Ctrl+C/SIGTERM 退出。不做 `--json`、不做固定端口。
- 刷新 = 重跑「逐项目补录 + 数据装配」;服务侧只接一个 `refresh: () => Promise<BoardData>` 回调(由 CLI 侧提供),并发由服务侧按 C-7 挡 409。
- 终端输出:`正在补录 N 个项目…`(N = 有在用目录、会真的补录的项目数)开头;逐项目一行——`synced`/`rebuilt` 打 `  <项目名>  已补录 X 个会话`(X 取 `TimelineSyncOutcome.sessions`,undefined 按 0),`busy`/`skipped-*`/`failed` 打 C-13 对应文案;然后 `看板已打开:<地址>`(或手动访问那句)、`按 Ctrl+C 退出`。
- 打开浏览器的函数做成可注入(参数传入),供测试与降级。

**C-9 项目枚举与目录(K12、D5)**

- 经 project 门面 `listProjects()` 取全部项目;按 `project.name`(identity 读不出时按目录名单独成组,显示名用 `project.display`)分组;同名项目几个目录就合并。
- 每组目录 = 各 `ProjectListItem.roots` 里 `exists` 的根,逐个经 `replicaLinkOf(root).mainRoot` 换成主目录后去重(= 「在用主目录」集合,即 `dirs`,原样放进 C-6)。
- 补录:组内有在用主目录的,取第一个传 `ensureTimelineUpToDate`;全部不在的组不补录,`notice` 置「目录已不在,列不出任务」。
- 项目排序:组内最新会话活动(任务 `lastActiveAt` 与未归类 `to` 的最大值)降序,null 在后,同值按名字。

**C-10 任务认定(K1、K13、D5)**

- 每组任务 = 各在用主目录 `listFeatures(d)` 中满足 K1 的条目 ∪ `listReplicas(d, { includeRemoved: true })` 的 `featureId`,按 featureId 去重;`listFeatures` 已优先取副本那份,同 id 不重复出。
- K1(哪些算任务):需求目录顶层文件名匹配 `*-功能方案-v*.md`(如 `/-功能方案-v[^/]*\.md$/`)或 `spec.md` / `*-spec.md`(如 `/(^|-)spec\.md$/`)。文件清单经 features 门面新增导出的 `listFeatureFiles`(scanner 已有实现,门面加一行导出),只看顶层。
- K13:标题与阶段取 `FeatureEntry`(title、stage;stage null 显示 `-`);目录不在(只有副本登记)的取 `parseFeatureId(featureId).title`,阶段 null。

**C-11 认任务规则(K8–K11、D14;`board/match.ts` 纯函数,补录后现算,不写绑定)**

- 输入:一个项目的 `BoardTimelineData`(C-5)、该项目的任务清单(featureId → title)、副本登记(该主目录 `listReplicas(includeRemoved: true)`:featureId → path/branch)、K8 根匹配器(`createRootMatcher`,根 = 该项目 `timeline_roots` 全部根 ∪ 全部副本 path)。输出:每任务 fixed/maybe 的会话集合 + 每会话命中该任务的依据与命中事件,以及未归类清单。
- K8(哪些会话参与):`session_start` 事件的 startCwd 经根匹配器命中(allowSelf true)。Windows 路径等非本机绝对路径自然不命中。
- K9(定挂,命中任一条):
  ① startCwd 落在该需求的某个副本登记 path 下(含已删,单独一个只含该需求副本路径的匹配器,allowSelf true)→ 依据「开始目录在副本」;
  ② `git_commit` 的 `metadata.branch` 等于该需求副本登记的 `branch` → 「提交在需求分支」;
  ③ `git_commit` 的 `commit_files` 里有路径含 `docs/features/<featureId>/` → 「提交改了需求目录」;
  ④ 工具 `Write`/`Edit`/`MultiEdit`/`NotebookEdit` 的 `filePath` 含 `docs/features/<featureId>/` → 「写需求目录」;
  ⑤ `user_prompt` 文本匹配 `^/[a-z][\w-]*\s+(.+)` 且捕获参数含任务标题,或 `Skill` 工具的 `args` 含任务标题 → 「流程命令」;
  ⑥ `user_prompt` 文本含 `docs/features/<featureId>/` → 「消息里有需求路径」。
- K10(可能相关;没有定挂才有):`Read` 的 `filePath` 含 `docs/features/<featureId>/` → 「读过需求目录」;或 `user_prompt` 含任务标题且标题 ≥ 4 个字 → 「消息提到需求名」。
- K11:只在 Bash 命令文字里出现过的需求路径不算——Bash 事件不进查询(C-5),无需实现额外逻辑。
- 标题/路径比较一律按原文(含 `-`、`_` 照原样);一个会话可挂多个任务。
- `dirLabel`:startCwd 在某副本登记(在用+已删)path 下 → `副本 <副本目录名>`;在该项目某在用主目录下 → `主目录 <项目名>`;否则取 `path.basename(startCwd)`。

**C-12 时间窗与列表口径(K2、K6、K14、K3、D6;全部内存现算)**

- K6:会话只挂一个任务 → 该会话全部事件的最早/最晚 ts;挂多个任务 → 每任务取「命中该任务的事件」最早/最晚 ts,但靠 K9① 挂上的任务一律算整个会话;未归类算整个会话。
- K14:任务 `lastActiveAt` = 其各会话(定挂优先,没有定挂取可能相关)窗口 `to` 的最大值。
- K2:`lastActiveAt >= 现在 - 30 天` 进 `tasks`,其余进 `older`(页面点「全部」才显示);只有可能相关会话的任务也列。
- K3(未归类):K8 参与但没有任何定挂且没有任何可能相关的会话,且 `user_prompt` 事件数 ≥ 5;按 `to` 降序。
- 任务排序:`lastActiveAt` 降序(同值按 featureId);fixed/maybe 两组内会话各按窗口 `to` 降序。
- 标题(K5):titles 表有行取行;没有取该会话第一条 `user_prompt` 的文本前 40 字;再没有显示 `-`。

**C-13 没能补录的提示(D7;board 单写一份映射,不改 `describeSyncOutcome`)**

`TimelineSyncOutcome.status` → 项目 `notice`:`busy` → 「正在补录,可能缺最新的会话」;`skipped-legacy` → 「这个目录还没跑新版 cgraphx install,没有补录」;`skipped-disabled` → 「CGRAPHX_NO_TIMELINE 开着,没有补录」;`failed` → 「补录失败,可能缺最新的会话」;`synced`/`rebuilt` → null。目录全不在的组用 C-9 的那句,不用本映射。

**C-14 页面契约(D3、D11、线框 v2)**

- `page.html` 单文件,内联 CSS、JS,无框架、无外部资源;布局与交互照 `../agent看板-线框-v2.html`:左右分栏(左任务右会话),默认选中全局最近活动的任务,点左栏行右栏即换;「全部/收起」切换 older;「刷新」按钮触发 `POST /api/refresh`,期间显示「正在补录…」提示、完成后用返回数据重渲,409 时提示正在刷新并保留旧数据。
- 右栏:上面「定挂(N)」、下面「可能相关(N)」;会话行显示 agent、标题、编号短显(`session-` 前缀取前 16 字符,否则前 8)、dirLabel、时间(MM-DD,跨年格式局部适配)、依据(reasons 用「、」连接);未归类单组、无依据栏。
- 复制(D11):`navigator.clipboard.writeText` 复制完整编号/标题,按钮旁显示「已复制」;失败显示「没能写进剪贴板,手动复制」+ 已选中文本框。
- `fileExists` 为 false 的行灰显并标「会话文件已不在」,复制按钮照常。
- 空态:无项目 → 「还没有项目:在项目里跑 cgraphx install」;项目无任务 → 「还没有挂上会话的任务」,`older` 非空时加「还有 N 个超过 30 天,点「全部」看」。

## 细节方案核对(spec 设计决策表逐条落点)

| spec 决策 | 落点 | 核对 |
|---|---|---|
| D1 🔒 board 子系统边界 | T-3/T-4/T-5;契约 C-6 前的依赖约束 | ✅ 只经五个门面;`cli/index.ts` 加注册、`copy-assets.cjs` 加 page.html |
| D2 🔒 服务安全 | T-4;C-7 | ✅ 令牌/Host/Origin、回环、无路径参数 |
| D3 页面与接口 | T-4;C-6、C-14 | ✅ 单文件页面 + 两接口一页面 |
| D4 启动顺序 | T-5;C-8 | ✅ 先补录后开服务;不做 --json/固定端口 |
| D5 项目与任务(K12、K1、K13) | T-3;C-9、C-10 | ✅ listProjects + replicaLinkOf 换主目录;listFeatures + listReplicas;parseFeatureId 兜底 |
| D6 列表口径(K2、K14、K3) | T-3;C-12 | ✅ 内存现算、older、未归类 |
| D7 补录提示 | T-3;C-13 | ✅ 单写映射,不动 describeSyncOutcome |
| D8 🔒 标题存哪(K5) | T-2;C-2 | ✅ 新表不升版本;CodeBuddy 不写标题(其读取器不动) |
| D9 老会话补标题 | T-2;C-2 | ✅ session_titles_at 记号、同锁、只写标题 |
| D10 fileExists、K4、K6 | T-3;C-4(session_id 主会话)、C-12 | ✅ sessions.db 只读现查;子会话归并靠事实编号 |
| D11 复制(K7、F3①) | T-4;C-14 | ✅ clipboard + 降级文本框;完整编号 = Session.id |
| D12 🔒 DeepSeek 只读登记 | T-1;C-1、C-3 | ✅ listSessionSources;AGENT_PROFILES/AgentId 不动 |
| D13 DeepSeek 读取器 | T-1;C-4 | ✅ 帧切分、行映射、子会话、无 zstd 降级 |
| D14 认任务(K8–K11) | T-3;C-5、C-11 | ✅ 纯函数现算;Bash 不取 |

## 适用规范(写前已读,契约已结晶)

- `docs/guides/coding-standards.md`「边界与结构」「选型」「错误与日志」——分层/门面/注释中文/600 行拆分等已落进各任务(全部动代码任务强制引用)。
- `docs/guides/interface-standards.md`「命令注册」「输出」「退出码」——T-5 的 CLI 接入依据。**记例外**:「新命令统一提供 `--json`」在本需求不适用——spec D4 显式定 `cgraphx board` 不做 `--json`、不做固定端口;spec > 规范,按 spec 执行。
- `docs/guides/data-standards.md`「模型层」「DDL 层」——T-2 动 schema.sql 依据。**记例外**:「表结构变更 = 加版本号」在本需求不适用——spec D8 显式定 `timeline_session_titles` 只加表、不升 `TIMELINE_SCHEMA_VERSION`(旧版打开库不受影响,沿用 timeline_meta/source_key 先例);spec > 规范,按 spec 执行。
- `docs/guides/git-standards.md`——结晶进下面「提交规范」节。

## 提交规范(从 git-standards.md 结晶,实施期不再现读)

**提交消息格式**:`type(scope): 中文描述`(Conventional Commits + 中文)。type 用 feat / fix / refactor / docs;scope 常用 timeline / board / skills,仓库级改动省 scope。补充说明用「——」,并列用「+」,数值对比用「→」。无票据关联;非琐碎提交写 body(背景一行 +「-」列要点)。各任务的提交点已写明提交说明,照抄即可。

**提交前检查点**(每笔提交前对照 `git diff --cached` 逐项判断):

- 与 TS 同放的运行时资产未登记 `scripts/copy-assets.cjs` —— 不随包发布,用户机器运行时 ENOENT
- `src/core` 出现对 `src/cli` / `src/web` 的 import —— 分层硬约定破坏,无 lint 拦截,只靠人眼
- `schema.sql` 丢失 `IF NOT EXISTS` —— 已初始化项目重复应用 schema 直接报错
- timeline hook 链路出现未 await 的 DB 写入 / 抛错不吞 —— 阻塞宿主 Claude Code 工具调用
- `vitest.config.ts` 的 `TZ: 'UTC'` 钉死被改 —— 日期断言失去跨机器可复现性
- 被注释掉的命令注册 / hook 接入项(commander `.command(...)` / settings.json hooks)—— 功能静默失效
- 写死的魔法值:绝对路径、密钥、阈值、版本号写进源码
- 新增 TODO / FIXME:确认是否应转任务,不随提交入库

## 统一验证(全部任务完成后跑)

1. `npm run build` —— tsc 零错误,copy-assets 输出包含 page.html。
2. `npm pack --dry-run` 的文件清单里有 `dist/core/board/page.html`(spec 验收 8 的包侧)。
3. `npm test` —— 全量通过,既有时间线测试不改断言(spec 验收 10)。
4. 本机冒烟:`node dist/cli/index.js board` —— 终端先打「正在补录…」逐项目一行,再打带令牌地址并打开浏览器;页面左栏项目/任务/未归类,右栏定挂+可能相关;复制编号/标题出「已复制」;「刷新」再补录一次;Ctrl+C 干净退出。
5. `node dist/cli/index.js timeline query --limit 3` —— 参数与输出格式不变,结果里能看到 DeepSeek 的事件(agent 列)。
6. 从补录完到页面可用的计算耗时明显低于 1 秒(spec 验收 7,冒烟时体感计时;精确断言留给后续单元测试)。

## 允许局部适配的范围

- T-1:zstd 帧切分与 DeepSeek 行解析的内部实现细节(防御性判空、字段容错);`unavailableReason` 的检测写法。
- T-2:Claude 标题行的具体判定——标题以何种行/字段出现在 jsonl 里(本机 `~/.claude/projects` 实测确认,`custom-title` → custom、`ai-title` → ai),事实形状按 C-2 不变。
- T-3:`match.ts`/`compute.ts` 的内部拆分、局部命名与 SQL 写法(保持 C-5 列集合);`board/` 内部错误类型命名。
- T-4:页面视觉细节(布局与交互必须照线框 v2)、时间显示的跨年格式。
- T-5:打开浏览器命令的平台分支写法、可注入参数的设计形态。
- T-6:文档与知识条目的具体措辞。

## Plan 冲突上报规则(PLAN_CONFLICT)

权威链:任务 ← plan ← spec,冲突以上层为准。执行中发现:任务与 spec 矛盾、两个任务契约不一致、契约引用的符号不存在、按任务做会违反全局约束 —— 停下,把问题与建议报给主会话,不在实现期就地拍板改契约。

## 关键风险与防跑偏约束

- **AGENT_PROFILES / AgentId 零变化**:安装器、副本带配置、commit-gate、会话提示对 DeepSeek 不得有任何行为变化;T-1 只新增文件与导出,`profiles.ts` 一行不动。
- **看板除补录外不写任何东西**:board 侧对项目库只读打开(C-5 写法同 roots.ts),写只发生在补录链路(ensureTimelineUpToDate / 标题表);不改用户的会话文件。
- **现有命令面不动**:`timeline query/stats/show/recent`、`features`、`docs` 等参数与输出格式不变;只加不改。
- **不升 TIMELINE_SCHEMA_VERSION**(data-standards 例外已在「适用规范」记录)。
- **单文件 600 行上限**:page.html 不计;`server.ts`、`compute.ts`、`match.ts`、`deepseek-session.ts` 接近上限先拆内部文件,不硬塞。
- **deepseek 子会话的 session_start 先写者可能取到子会话开始目录**(C-4 已知限制,记录不修,不为此加机制)。
- **测试基建**:测试一律经 `__tests__/setup-home.ts` 临时 HOME,不动本机 `~/.cgraphx`;实现期不写新测试(完成定义 = 既有测试不红)。

## 待确认项

- 无阻塞项。两处实现期核实点(属局部适配,不影响契约):Claude 标题行的具体形态(T-2)、DeepSeek 各行 JSON 的字段细节(T-1,本机 `~/.dsh/sessions` 有真实样本,`deepseek-harness` 仓库有参考实现)。

## 启动语

本需求预估改动 30+ 文件、跨 agents / timeline / board / cli / docs 多个模块,按大需求走:

`/dev-impl-subagent docs/features/2026-11-06-agent看板/plan/agent看板-index.md`
