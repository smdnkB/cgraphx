# -02-backend:时间线页控制器逻辑(常量+接口 / URL 模型+facade+聚合)

> 承载 T-1、T-3。全局契约见 `cgraphx-web时间线浏览-index.md`「必须严格执行的契约」。

---

## T-1:web 时间线显示常量 + 视图模型接口

- **目标**:在 `src/web/constants.ts` 增时间线显示常量;在 `src/web/timeline-templates.ts`(本任务起文件骨架)定义视图模型接口,作为 T-2/T-3 的共享契约源。
- **对应 spec 条款**:§3.2(5 类型标签)、§3.3(四级结构/子 agent 行型/git 栏)、§9 #4(标签 + 排序口径)。
- **强制引用**:`coding-standards.md`。
- **依赖**:无。
- **涉及范围**:`src/web/constants.ts`(编辑,追加)、`src/web/timeline-templates.ts`(新建,仅 interface + 常量导入,渲染函数留 T-2)。
- **必须严格执行**:
  - `constants.ts` 追加 `EVENT_TYPE_LABELS: Record<EventType, string>`(Prompt/工具调用/工具完成/Stop/Git 提交)与 `EVENT_TYPE_CHIP_TONE: Record<EventType, 'prompt'|'pre'|'post'|'stop'|'git'>`(对齐 mockup `chip--prompt/pre/post/stop/git`)。`EventType` 从 `../core/timeline` 导入(经门面,不伸手内部)。
  - 视图模型接口(放 `timeline-templates.ts`,镜像 `overview-templates.ts` 的「接口在前」结构):`TimelineContentModel`(顶层:statbar + filters + activePills + dayGroups[] + empty + countBadge + truncationNotice)、`StatbarModel`(todayEvents/activeSessions/topTool{tool,count}|null/last7Bars[]{day,count,label,isToday} + total7d)、`TlFilterChipModel`(label/en/count/href/active/tone)、`TlPillModel`(dimension/value/removeHref)、`DayGroupModel`(label/dateLabel/meta/sessionCards[]/commits[])、`SessionCardModel`(sessionId/title/turnCount/eventCount/todayCount?/fullCount?/isCrossDay/isLive/firstTs/lastTs/events[])、`TurnGroupModel`(turnId/label/events[])、`EventRowModel`(time/tsISO/eventType/label/tone/toolName/path/summary/hasPayload/payload:unknown|null/isSubagent/subagentNote|null)、`CommitRowModel`(time/hash/message/insertions/deletions/files[])、`EmptyModel`('timeline-empty'|'no-match'|'none')。字段命名可自定,结构须承载上述全部信息。
  - **`payload` 字段存已解析对象**(非 JSON 字符串):`tool_args` 经 `rowToEvent` 已 `tryParseJson` 成对象(`store.ts:136`),其余 payload 字段(prompt_text/duration_ms/commit_*)也是原始 JS 值;`payload: Record<string, unknown> | null`(组装后的 payload 对象,见 index「payload 字段矩阵」),交给 T-2 的 `highlightJson(value: unknown)` 直接渲染。**不要**存 JSON 字符串(避免二次解析 + 类型误导)。
- **允许局部适配**:字段命名、是否用可选字段(`?`)表示 null。
- **完成条件**:`constants.ts` 含 2 个新映射;`timeline-templates.ts` 含全部 interface 定义;`tsc --noEmit` 过(接口无运行时,但类型须可 import)。
- **验证方式**:`npx tsc --noEmit` 零错误;接口被 T-2/T-3 import。
- **独立提交**:否(随 T-3 commit B)。耦合:接口是 T-2/T-3 契约源,单独提交是死代码。
- **风险/注意事项**:接口字段遗漏会导致 T-2/T-3 返工;务必对照「payload 字段矩阵」(index)+ 四级结构逐项覆盖。`EventType` 必须经 `../core/timeline` 门面导入,不伸手 `core/timeline/types`(虽同源,但门面是契约层)。

---

## T-3:pages-timeline.ts(URL 模型 + facade + 聚合 + page 入口)

- **目标**:URL 查询模型(纯函数)+ facade 调用 + web 层聚合(四级分桶、多类型合并、概况条、截断感知)+ `renderTimelinePage` 入口。镜像 `pages-overview.ts` 的「URL 模型(纯函数,单测覆盖)→ assembleModel(facade + 聚合)→ 渲染入口」三段结构。
- **对应 spec 条款**:§3.1(概况条)、§3.2(过滤器)、§3.3(四级分组/截断/排序)、§4(数据口径/时区)、§6(异常)、§8(复用门面/数据事实)。
- **强制引用**:`coding-standards.md`、`interface-standards.md`。
- **依赖**:T-1(接口)、T-2(`renderTimelineContent`)。
- **涉及范围**:`src/web/pages-timeline.ts`(新建)。
- **必须严格执行**:
  - **URL 模型**(纯函数,逐字镜像 `pages-overview.ts:69-148` 语义):`parseTimelineQuery(params): TimelineQuery`、`buildTimelineUrl(q): string`、`withoutTlValue(q, dim, value)`(激活 pill 移除);`TimelineQuery { range:'today'|'7d'; types:EventType[]; tool?:string; file?:string; session?:string }`。非法 type/range 忽略或默认;多值去重保序;缺省值不入 URL。
  - **facade 调用(经 `../core/timeline` 门面,全部 `await`)**:
    - 概况条:`await queryEvents(projectRoot, {since: todayLocalDateStr, limit:10000})` → 今日事件(计数/distinct session/tool 直方图);`await getEventStats(projectRoot, {since:'7d'})` → `byDay`(7 柱)+ `totalEvents`。今日无工具事件 → topTool=null(占位)。
    - 事件列表:range=today → `since:todayLocalDateStr`;range=7d → `since:'7d'`。type 多选 → N 次 `await queryEvents` 合并(见手段决策 #1);0 类型 → 1 次无 type 子句;其余 filter(`tool`/`file`/`session`)透传。`limit:10000`。`projectRoot` 取自 `ctx.projectRoot`(门面自管 DB 连接,不接收外部 `db`)。
  - **web 层聚合**:
    - 四级分桶:事件按进程本地日期分 L1(`new Date(event.ts)` 的 `getFullYear/Month/Date` → `YYYY-MM-DD`)→ 按 `session_id` 分 L2(null session 的 git_commit 事件入当日 git 栏,不入会话卡)→ 会话内按 `turn_id` 分 L3(null turn_id → "未分轮次"尾桶)→ L4 事件行。
    - 会话卡汇总:一次性 `Map<session_id, {...}>`(见手段决策 #3);跨天会话在多日出现时,每日卡 `todayCount`=当日、`fullCount`=该 session fetched 全集计数、`isCrossDay=true`。
    - 排序:会话卡在日内按 `lastTs` 倒序;轮次内按 `ts DESC` 倒序;git 栏按 `ts DESC` 倒序。
    - 截断:事件列表长度 === 10000 → 设 `truncationNotice`(逐字文案见 index「截断感知」)+ countBadge "10,000+ 条";否则 countBadge = `${len} 条 · ${distinctSessions} 会话`。
    - 概况条:不受 filter 影响(仪表盘口径)。
  - **异常**(§6):facade 抛错 → 让 `server.ts` 全局 500 兜底(不在 page 内吞);全库 0 事件(`getEventStats totalEvents===0` 且事件列表空)→ `empty='timeline-empty'`;筛选 0 匹配(非全库空)→ `empty='no-match'`;有结果 → `empty='none'`。
  - **page 入口(签名已拍板,不留实现期)**:`export async function renderTimelinePage(params: URLSearchParams, ctx: {version: string; localHost: string; projectRoot: string}): Promise<string>` → `await` facade 组装 model → `renderShellPage({title:'开发时间线', active:'timeline', contentHtml:renderTimelineContent(model), version: ctx.version, localHost: ctx.localHost})`。**不接收 `db` 参数**:timeline 门面以 `projectRoot` 自管连接(见 index「门面为 async」),`ctx.projectRoot` 即 facade 所需;`db`(HandlerContext 的 markdown 进程级连接)timeline 页用不到,传入是死参,故签名不收 `db`(与 `renderOverviewPage(db,params,ctx)` 形态不同,这是门面模式差异决定的,不是不一致)。`renderShellPage` 是同步函数,内部不需 await。
- **允许局部适配**:直方图/Map 实现细节;todayLocalDateStr 计算(用 `render-utils` 既有 `formatLocalDateTime` 同源 `new Date()`,或新写 `localDateStr()`)。
- **完成条件**:`renderTimelinePage` 对空库/有数据/多类型/跨天会话/截断各场景产出正确 model;四级分桶与 `getEventStats.byDay` "今天"条目数一致(除 type 过滤);`tsc --noEmit` 过;`pages-overview.ts` 既有行为零变化。
- **验证方式**:实现后归入 web 测试;本任务 `tsc --noEmit` 过 + 临时脚本用真实 `.cgraphx/cgraphx.db`(若有 timeline 数据)调用 `await renderTimelinePage(...)` 打印检查。
- **独立提交**:是(commit B,与 T-1/T-2/T-5 同提交)。
- **风险/注意事项**:
  - **async 签名是硬约束**:门面 `queryEvents`/`getEventStats` 是 `async`,返回 `Promise`;`renderTimelinePage` 必须 `async` + 内部 `await`,T-5 接线处用 `.then().catch()`(签名与 T-5 必须逐字一致)。
  - 今日口径与 7 日柱图"今天"条目数须一致(时区口径统一为进程本地);概况条今日事件数来自 `queryEvents(since=today)`,7 日柱图今日柱来自 `getEventStats({since:'7d'}).byDay[today]`——两者都按进程本地日,但前者是今日全天事件(含非工具),后者是当日 byDay 计数,数值须相等。
  - 多类型合并 N 查询的 filter 透传须除 `type` 外完全一致(`since`/`tool`/`file`/`session`/`limit` 全同)。
  - 跨天会话 `fullCount` 须跨所有 fetched 日期聚合(非仅当日)——`Map<session_id>` 在分桶前一次性建,跨日共享。
