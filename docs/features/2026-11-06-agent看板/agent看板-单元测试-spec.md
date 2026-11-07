# 单元测试规格: agent看板

> 产物: unit_test_spec
> 依据: spec@90c1887

## 覆盖范围

本需求三块可测代码:**DeepSeek 只读来源与读取器**(D12、D13)、**会话标题链路**(D8、D9)、**board 子系统**(认任务 K8–K11、装配 K1–K3/K12–K14、服务 D2/D3、命令 D4),外加一条「对既有面零变化」的守护(D12)。共 **52** 个场景:主路径 19、边界 30、异常 3。

不测:页面 `page.html` 的浏览器交互(复制按钮、剪贴板降级文本框——建议 `/ui-case` 或手动);spec 验收表标「手工跑一次」的三项(验收 4 本机 17 个主会话对账、验收 7 计算耗时 <1s、验收 8 npm pack 全局安装);文档与知识库(T-6)。

造 DeepSeek 测试文件一律用 `zlib.zstdCompressSync` 拼帧(依据: 验收 3 的原话「用 `zlib.zstdCompressSync` 造文件」);测试一律经 `__tests__/setup-home.ts` 用临时 HOME,不动本机 `~/.cgraphx`。

## 必测场景

### A. DeepSeek 读取器(D13;`zstd 帧式 jsonl`)

主路径:

- A1 全量读:header/user-message/tool-call+result/turn-end/session-title 五种行各产对应事实,工具名映射到 Write/Edit/Read/Bash/Grep/Glob/Skill、不在表的原样传(依据: D13 行映射)
- A2 增量读:从偏移起只出新追加的事实,已消费的不重复产(依据: D13「偏移记到最后一个完整帧的末尾」)
- A3 子会话:文件头带 `origin:'subagent'` 的事实(含标题)归 parentSession 链的根主会话;子会话的开始目录读它自己的文件头(依据: D13、K4)
- A4 续接会话(`isSeeded` 且不带 subagent origin):各算一行,不并进前一会话(依据: K4「续接后换了编号的,各算一行」)

边界:

- A5 尾部不完整的帧留到下次:砍掉尾帧末尾若干字节,consumedBytes 不越过它;补齐后下趟读出(依据: 验收 3、D13)
- A6 增量趟挂起的工具调用(轮次边界后无结果)留到下次:consumedBytes 收回其所在帧,重读配对(依据: D13 与 claude/codebuddy 同口径)
- A7 `DSH_HOME` 设了读 `$DSH_HOME/sessions`(它指 `~/.dsh` 这一层),未设用家目录拼 `.dsh/sessions`(依据: D13、C-1)
- A8 不认识的行类型跳过不算错误,不产事实(依据: D13)

异常:

- A9 Node 无 `zstdDecompressSync`(注入仿造环境或跳过守卫)→ 来源 `unavailableReason()` 返回「DeepSeek 会话要 Node 22.15 以上,没有读取」,补录跳过列举并把提示带进 notices(依据: D13;验收 2 相关)

### B. 补录管线与标题(D8、D9、D12;走 `ensureTimelineUpToDate` 端到端)

主路径:

- B1 DeepSeek 会话补录进项目库:事件 `agent='deepseek'`,session_start/user_prompt/post_tool_use 的 ts/cwd/turn_id 正确(依据: D12、全局约束「timeline query 只是多了 DeepSeek 的事件」)
- B2 标题写入优先级:custom > ai > agent;同级 ts 新者胜(依据: D8)
- B3 claude 标题行(行内不带时间戳)与 deepseek `session/title` 行各产 `SessionTitleFact`(依据: D8、D13)

边界:

- B4 老会话回填:装新版后第一次补录,已归属文件从 0 重读、只写标题不写事件、不推进偏移;`timeline_events` 行数不变(依据: D9、验收 5「事件数不变」)
- B5 回填记号:第二次打开/查询不再重读文件(验收 5「第二次打开不再重读」);重建路径(commitRebuild)同事务写记号,重建过的项目不再回填(依据: D9)
- B6 `timeline_session_titles` 只加表、不升 `TIMELINE_SCHEMA_VERSION`:旧版打开库不受影响、重复应用 schema 幂等(依据: D8、迁移与兼容)
- B7 CodeBuddy 会话文件没有标题来源:不写标题表,显示侧回退(与 C6 合并测)(依据: D8「CodeBuddy 没有标题,不写」)

异常:

- B8【评审修复行为,spec 锚: D8「同级取新」】claude 改名场景:已补录过的会话追加一条 `custom-title` 行(增量窗口内唯一行,ts 为未知哨兵)→ 新标题覆盖旧 custom;已知 ts 的后续标题仍能盖回
- B9【评审修复行为,spec 锚: 全局约束「补录失败只产 stderr 提示,查询退出码与 stdout 不受影响」】读取器抛错(坏帧/读不出会话头)单文件隔离:只丢该文件、按来源+原因提示、偏移不推进、排序在后的文件照常补录;回填失败提示一次

### C. 认任务(K8–K11、D14;`board/match.ts` 纯函数)

主路径——K9 六条定挂逐条(依据: K9「算」的例子):

- C1 ① 开始目录在需求的副本里(含已删副本)→「开始目录在副本」
- C2 ② 提交在需求的分支上(`metadata.branch` 等于登记 branch)→「提交在需求分支」
- C3 ③ 提交改了需求目录里的文件(commit_files 含 `docs/features/<id>/`)→「提交改了需求目录」
- C4 ④ 写类工具写过需求目录里的文件 →「写需求目录」
- C5 ⑤ 流程命令带了需求名(`^/[a-z][\w-]*\s+(.+)` 参数含标题;Skill 的 args 含标题)→「流程命令」
- C6 ⑥ 人发消息里有需求目录路径 →「消息里有需求路径」
- C7 K10 两条可能相关:读过需求目录(Read 的 file_path);消息提到需求名且标题 ≥4 个字(依据: K10)

边界——「不算」逐条(依据: 各口径表的「不算」例):

- C8 K8:在项目目录及其子目录开的会话参与;在上级目录(如 `objects/ai`)开的不参与;在用与已删副本都算(依据: K8)
- C9 K9:一个会话命中几个需求就挂几个任务(依据: K9「一个会话命中几个需求就挂几个任务」)
- C10 K10:名字只有 3 个字的需求,消息提到不算可能相关(依据: K10「不算:名字只有 3 个字的需求」)
- C11 K11:只在 Bash 命令文字里出现过需求目录路径(`ls docs/features/<id>/`)不算任何挂靠(依据: K11)
- C12 Windows 路径的会话(开始目录 `D:\...`)不参与认任务(依据: 验收 6)
- C13 标题含 `-`、`_` 按原文比较,不做归一化(依据: D14 影响面)

### D. 看板装配(K1–K3、K5、K12–K14;`board/compute.ts`)

主路径:

- D1 K12:用户目录里记过数据的项目都列,与启动目录无关;有活动的项目在前;同名项目几个目录合并任务(按 featureId 去重)(依据: K12、D5)
- D2 任务行:标题(目录名去日期/登记里的需求名)、阶段(已规格/已规划/已验证/无则 `-`)、定挂数、agents、最近活动(依据: K13、K14)
- D3 未归类:≥5 条人发消息且一个任务都没认到的会话,新的在前;有可能相关依据的不进未归类(依据: K3)

边界:

- D4 K1:有 `*-功能方案-v*.md` 或 spec 的目录算任务;只有空目录不算;副本登记了但目录不在也算(标题取登记名、阶段 `-`)(依据: K1、K13)
- D5 K2:最近活动 30 天内进默认列表、其余进 older;只有可能相关会话的任务也列,计数形态「0 个,可能相关 N 个」(依据: K2)
- D6 K5:标题兜底取第一条人发消息前 40 个字;无标题无消息显示 `-`(依据: K5)
- D7 K6 时间窗:会话只挂一个任务取整会话首末;挂多个任务只算命中该任务的区间;副本依据一律整个会话;未归类整个会话(依据: K6)
- D8 F1④ 四种没能补录的提示映射:busy/skipped-legacy/skipped-disabled/failed → 对应文案;synced/rebuilt → null(依据: F1④、D7)
- D9 F1⑤:项目的目录都不在 → 项目照常列出、提示「目录已不在,列不出任务」、只剩未归类(依据: F1⑤)
- D10 F2①:`fileExists` 按 sessions.db 的 path 现查;文件被清理的会话照样列出、照样能复制(数据形状层面)(依据: F2①、D10)
- D11 空态数据:没有项目 → 空 projects(页面文案属页面)(依据: F1①)
- D12 dirLabel:开始目录在副本下 → `副本 <名>`;在主目录下 → `主目录 <项目名>`;否则取 basename(依据: C-11→页面示例,F2 行为链示例)

### E. 看板服务(D2、D3;`board/server.ts`)

主路径:

- E1 `GET /?t=` 返回页面、`GET /api/board?t=` 返回内存数据、`POST /api/refresh?t=` 跑刷新回调后返回新数据(依据: D3 接口契约)

边界:

- E2 令牌不对 403;`Host` 不是本机回环(或端口不对)403;`POST /api/refresh` 的 Origin 不对 403(依据: 验收 1、D2)
- E3 刷新进行中再收到刷新 → 409,期间 `GET /api/board` 照常返回旧数据(依据: D3 错误列)
- E4 只监听 `127.0.0.1`(绑定地址断言,不监听 0.0.0.0)(依据: 验收 1)

### F. 命令启动链(D4;`board/cli.ts`,打开函数注入)

主路径:

- F1 完整链:枚举 → 逐项目补录进度行(「正在补录 N 个项目…」「已补录 X 个会话」)→ 起服务 → 打印带令牌地址 → 调打开函数(注入记录器)→ 等信号退出码 0(依据: F1 行为链、D4)

边界:

- F2 打开函数抛错/退出码非 0 → 打「浏览器没打开,手动访问 <带令牌地址>」,服务照常跑(依据: F1③、验收 9)
- F3 任意目录可跑:cwd 不是项目目录也正常(枚举与 cwd 无关)(依据: K12「和从哪个目录启动无关」)

### G. 零变化守护(D12;验收 2)

- G1 `install -t all` 不部署 `.dsh/`;开副本不带 DeepSeek;带 `DSH_SESSION_ID` 环境变量提交不触发门禁(依据: 验收 2、D12)——前两条走 installer/carry 现有测试基建断言,第三条断言 `resolveSessionIdFromEnv` 不认新变量
- G2 `AGENT_PROFILES` 与 `AgentId` 不动:描述清单断言只有 claude-code/codebuddy(依据: D12、全局约束)

## 测试骨架映射

| 场景组 | 测试文件(vitest,describe 中文) | describe |
|---|---|---|
| A1–A8 读取器 | `__tests__/core/timeline/deepseek-session.test.ts` | `DeepSeek 读取器` |
| A9/B1/B9 来源接入与隔离 | `__tests__/core/timeline/ingest-sources.test.ts` | `只读来源与补录隔离` |
| B2–B8 标题链路 | `__tests__/core/timeline/session-titles.test.ts` | `会话标题` |
| C1–C13 认任务 | `__tests__/core/board/match.test.ts` | `认任务 K8–K11` |
| D1–D12 装配 | `__tests__/core/board/compute.test.ts` | `看板装配` |
| E1–E4 服务 | `__tests__/core/board/server.test.ts` | `看板服务` |
| F1–F3 命令链 | `__tests__/core/board/cli.test.ts` | `board 命令` |
| G1–G2 零变化 | `__tests__/cli/installer/deepseek-zero-change.test.ts` | `DeepSeek 零变化守护` |

风格沿用既有测试:临时 HOME(`setup-home.ts`)、TZ=UTC 已由 vitest.config 钉死、DeepSeek 文件用 `zlib.zstdCompressSync` 造、claude 会话文件手写 jsonl、副本登记写 `.cgraphx/replicas/*.json`。

## 待确认项

- **B8、B9 是评审修复引入的行为**(标题未知 ts 覆盖、读取器错误单文件隔离):spec 只写到 D8「同级取新」与全局约束「补录失败只产提示」,没写这两条的具体机制。测试按当前实现行为写;建议下次动 spec 时补两条决策记录(D 编号),不阻塞本规格。
- 页面交互(复制/剪贴板降级/灰显)不在单元测试范围:数据形状由 C/D/E 组覆盖,浏览器行为留给 `/ui-case` → `/ui-run` 或手动验证。
- G1 的「开副本不带 DeepSeek」依赖 replica carry 的现有测试基建,若搭建成本高,可降级为只测「DSH_SESSION_ID 不触发门禁」+「AGENT_PROFILES 不变」,在测试报告里注明。
