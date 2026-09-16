# Plan: cgraphx web 开发时间线页

> feature-id: 2026-07-30-cgraphx-web时间线浏览
> 负责人: liulongfei
> 日期: 2026-09-16
> 来源 spec: cgraphx-web时间线浏览-spec.md(已确认,2026-09-16 修订)

## Context(为什么做这个)

需求 `2026-07-30-cgraphx-web时间线浏览` 的 spec 已确认(2026-09-16 依设计稿 v2 修订过):在已落地的 `cgraphx web` 基座上,把 `GET /timeline` 从占位页换成真正的**开发时间线页**——按「日期 > 会话 > 轮次 > 事件」四级分组浏览 Claude Code 开发事件流,带概况数据条、多维过滤、单事件 payload 原文展开。

基座已就位(server/layout/bootstrap/errors + 知识库两页 + app.css/app.js),导航里 `/timeline` 现在是占位页(`server.ts:121`)。timeline 读侧门面已就位(`src/core/timeline/index.ts` 导出 `queryEvents`/`getEventStats`/`getSessionStats`/`resolveTimeBound`)。本需求**只读、不改 core 记录侧、不动表**。

## 目标与范围(摘自 spec)

实现时间线页:概况数据条(spec §3.1,今日口径 + 近 7 日柱图)+ 过滤器(时间范围/事件类型多选/工具/文件/会话,§3.2)+ 事件流「日期 > 会话 > 轮次 > 事件」四级分组(§3.3)+ 子 agent 专属行型 + git_commit 独立栏 + 单事件 payload JSON 原文展开 + 三态空状态(§3.4)。全部服务端渲染、URL 驱动(镜像知识库总览页形态)。

## 明确不包含

- 不动 core:不新建查询层、不改 `store.ts`/`indexer.ts`/`hooks.ts`/`recorder.ts`(记录侧写入路径不在范围)。
- 不动表:无 schema 变更(只读 `timeline_*` 表)。
- 不做会话独立路由页(无 `/timeline/session/<id>` / `/timeline/event/<id>`,内联展开)。
- 不做独立统计页、叙事报告、实时推送。
- 不写新单元/集成测试任务(plan 不排测试;新测试走实现后的 `/write-unit-test-spec` → `/write-unit-test-code`)。

## 计划文件清单

- `cgraphx-web时间线浏览-index.md`:本文件(全局 + 任务清单 + 契约)。
- `cgraphx-web时间线浏览-02-backend.md`:页面控制器逻辑——T-1(常量+接口)、T-3(URL 模型 + facade + 聚合 + page 入口)。
- `cgraphx-web时间线浏览-03-frontend.md`:呈现层——T-2(模板+JSON 高亮器)、T-4(CSS)、T-5(server 接线 + 既有测试修正)。
- 无 `-01-schema.md`:不涉表。

## 总任务清单

| 任务 | 名称 | spec 条款 | 独立提交 | 详情 |
|---|---|---|---|---|
| T-1 | web 时间线显示常量 + 视图模型接口 | §3.2 §3.3 §9 #4 | 否(随 T-3) | -02-backend |
| T-2 | timeline-templates.ts(渲染助手 + JSON 高亮器) | §3.3 | 否(随 T-3) | -03-frontend |
| T-3 | pages-timeline.ts(URL 模型 + facade + 聚合 + page 入口) | §3.1 §3.2 §3.3 §4 §6 §8 | 是(commit B) | -02-backend |
| T-4 | app.css 时间线样式(73 类 + chip 色调 + 空态变体) | §3.3 | 是(commit A) | -03-frontend |
| T-5 | server.ts 接线(替换占位页)+ 修正 server.test.ts 占位断言 | §3.3 §7 #5 | 是(commit B) | -03-frontend |

## 全局依赖图

```
T-1(常量+接口) ──┬─→ T-2(templates) ──┐
                 └─→ T-3(pages) ─────────┴─→ T-5(接线+既有测试修正)
T-4(css,与 T-1/T-2 并行) ─────────────────────┘(T-5 前落地,T-5 后页面有样式)
```

无依赖环。T-1 是 T-2/T-3 的契约源;T-3 import T-2 的 `renderTimelineContent`;T-5 把 T-3 的 `renderTimelinePage` 接进路由并修正既有测试。T-4 与 T-1/T-2 可并行(纯 CSS,不碰逻辑)。

## 推荐执行顺序

T-1 → (T-2 ‖ T-4 并行)→ T-3 → T-5。

## 可并行批次

- **批 1**:T-2(templates)与 T-4(app.css)——文件不重叠(T-2 新建 `.ts`,T-4 编辑 `.css`),无共享契约冲突(T-2 消费 T-1 接口,T-4 消费 mockup 类名),可并行。
- T-3 必须在 T-2 后(消费 `renderTimelineContent`)。T-5 必须最后(接线 + 测试)。

## 必须严格执行的契约

### 复用门面(spec §8)

- 读侧**只经** `src/core/timeline/index.ts` 导出:`queryEvents(projectRoot, filter)` / `getEventStats(projectRoot, filter)` / `getSessionStats` / `resolveTimeBound`。**不新建查询层、不 import store.ts / indexer.ts 内部**。
- **门面为 async(架构契约,不可留实现期)**:`queryEvents` / `getEventStats` / `getSessionStats` 均声明为 `async`,返回 `Promise<T>`(`indexer.ts:10/28/64`)——函数体虽同步操作,但 `async` 关键字使其返回 Promise,JS 无法同步解包。且门面以 `projectRoot` 为参**自管 DB 连接生命周期**(每调用一次 `openTimelineDb(projectRoot)` → 操作 → `conn.close()`),**不接收外部 `db`**(与 markdown store 的同步 `db` 直调模式不同)。由此派生两条硬约定:
  1. **`renderTimelinePage` 必须声明为 `async`,返回 `Promise<string>`**,内部 `await queryEvents(...)` / `await getEventStats(...)`。
  2. **`GET /timeline` 路由分支须用 `.then().catch()` 兜底**(见 T-5),不能像 `/`、`/doc/` 那样同步 `const html = ...; res.end(html)`;async 错误经 `.catch(err => sendInternalError(...))` 进全局错误态(与同步 `try/catch` 等价覆盖)。
- `queryEvents` 契约(已核实,`store.ts:237-270`):返回扁平 `TimelineEvent[]`,`ORDER BY ts DESC, id DESC`;每条带 `session_id: string|null`、`turn_id: string|null`;`limit` 默认 100、**最大 10000(store 层 clamp)**;`type` 为**单值**(`event_type = ?`)、`tool` 精确、`file` 子串(`tool_args LIKE OR commit_files LIKE`)、`session`/`turn` 精确。
- `getEventStats` 契约(已核实,`store.ts:373-498`):返回 `TimelineStats { totalEvents, byType, byTool(top20), byDay(max366, 进程本地时区分桶 `datetime(ts,'localtime')`), topFilesRead/Written, windowStart, windowEnd }`。`stats()` 的 `until` 默认 now;`query()` 不默认。
- `resolveTimeBound`:`'7d'/'12h'/'30m'/'now'` 相对串、`YYYY-MM-DD`(本地午夜)均支持(`store.ts:76-111`)。

### 分层铁律(spec §8 / 2.0-spec §3.1)

- 新增页面逻辑只在 `src/web/`,只依赖 `../core`。**禁止 `src/core` 反向 import `src/web`**(git-standards 提交前检查点会拦)。

### 记录层数据事实(plan 必须按此呈现,不得补全、不得猜测 — spec §3.3/§8)

- `git_commit` 事件 `session_id = null`(`gitCommitHook` 在 Claude Code 外运行)→ 独立成栏,不猜归属。
- `Agent`/`Task` 工具**无 `pre_tool_use`**(pre 只对白名单 `{Edit,Write,MultiEdit,NotebookEdit,Bash}` 记,`constants.ts:62`)→ 子 agent 行型只呈现"完成"`post_tool_use`,不补启动/内部步骤/branch;`post-tool-summary.ts:178` 对其补 `subagent_type`(在 `tool_result_summary` 内)。
- `tool_args` 入库为**完整 JSON 不截断**(`store.ts:173-176`,MVP 已删除 tool_args 字段截断);`rowToEvent` 已 `tryParseJson` 成对象(`store.ts:136`)→ payload 高亮器接收的是已解析对象。`prompt_text`/`tool_result_summary`/`commit_message` 可能被记录层截断 → 原样呈现,不暗示有更多(§3.3 截断提示)。
  - **spec 偏差标注(PLAN_CONFLICT)**:spec §2/§3.3 截断提示泛称"`tool_args` 等字段可能已被记录层截断",经核实 `tool_args` 实际**不截断**(代码现状),截断仅影响 `prompt_text`/`tool_result_summary`/`commit_message`。**实现按代码现状**(payload 原样展示已解析对象),不按 spec 原文的"tool_args 可能截断"措辞;截断提示文案保持"展开内容即最终内容",不针对 tool_args 特别声明。此偏差不阻塞,记录在案。

### 时区口径(spec §4 / 基座 §4.2)

- DB 存 UTC ISO,界面按本地时区。**约定:web 进程与浏览器同机,进程时区 = 浏览器时区**(render-utils `formatLocalDateTime` 注释已确立;知识库页同此)。
- "今天"判定 / 按天分组 / 概况柱图:均按**进程本地日期**计算(`new Date(ts).getDate()`,等价 `datetime(ts,'localtime')`)。
- 事件行时间戳:服务端输出进程本地时间作合规底线 + `<time datetime=ISO>`,`app.js` 的 `[data-local-time]` 重格式化为浏览器时区(既有逻辑,**不改 app.js**)。
- 跨时区验证沿用 `__tests__/core/timeline/store.timezone.test.ts` 的子进程 `TZ=` 派生约定(实现后的测试关注点,本 plan 不排测试任务)。

### 单事件 payload 字段矩阵(按 event_type 呈现,值原样不派生)

| event_type | payload 对象字段 |
|---|---|
| `user_prompt` | `prompt_text`, `turn_id` |
| `pre_tool_use` | `tool_name`, `tool_args`, `turn_id` |
| `post_tool_use`(非 Agent/Task) | `tool_name`, `tool_args`, `tool_result_summary`, `duration_ms`, `turn_id` |
| `post_tool_use` 且 `tool_name ∈ {Agent, Task}`(子 agent 行型) | `tool_name`, `tool_args`, `tool_result_summary`, `duration_ms`, `turn_id` + **附数据约束说明文案**(见下) |
| `stop` | `metadata`(`session_event_count`/`session_duration_ms`/`session_last_prompt_preview`), `turn_id` |
| `git_commit` | `commit_hash`, `commit_message`, `commit_files`, `commit_insertions`, `commit_deletions` |

子 agent 数据约束说明文案(原样使用):"记录层现状:子 agent 仅「完成」事件入库——启动时刻与内部工具步骤不记录;此行呈现的是完成时刻。branch 信息未记录,无法呈现。"

- 无 payload 可展开字段的事件(`stop` 的 metadata 为空等)→ 不呈现展开入口。
- 字段值为 `null` 的字段**不入** payload 对象(省略,非置 null)。

### URL 查询参数模型(镜像知识库总览页 URL 驱动约定)

- 参数:`range`(today 默认 / 7d)、`type`(多值,英文原值 `user_prompt`/`pre_tool_use`/`post_tool_use`/`stop`/`git_commit`)、`tool`、`file`、`session`。
- `type` 非法枚举值忽略(从激活集剔除,不报错);`range` 非 today/7d → 默认 today;`tool`/`file`/`session` 空白 → 未传。各多值参数去重保序。
- 参数顺序固定(range → type* → tool → file → session);缺省值不出 URL(range=today 不入)。
- pill 增删、清除全部、激活值移除:沿用知识库 `withoutValue`/`added` 纯函数模式(`pages-overview.ts:113-148` 为参照,**逐字镜像其语义**,不抄其字段名)。

### 截断感知(spec §3.3 "不静默截断")

- 事件列表 `queryEvents({..., limit: 10000})`;若**返回长度 === 10000** → 渲染"已达单次查询上限(10,000 条),可能还有更多——收窄时间范围或增加过滤条件"提示 + 计数徽章显示"10,000+ 条"。
- 概况条 7 日柱图用 `getEventStats({since:'7d'}).byDay`(**未受 10000 cap 限制**,stats 是独立 `GROUP BY` 聚合),准确。

## 实现手段决策

### 自主项(plan 拍板,无业务可观察后果)

1. **事件类型多选桥接 = web 层多查询合并**(spec §8 留给 plan 论证)。
   - 0 类型选中 → 1 次 `queryEvents`(无 type 子句);1 类型 → 1 次;2-5 类型 → N 次(每类型一次,其余过滤相同)合并,**无需去重**(每事件 `event_type` 单值,N 查询结果集互斥)→ 合并后重排 `ts DESC, id DESC`。
   - 推荐:web 层合并。理由:零 core 改动、零 CLI 风险、N≤5、localhost SQLite 可承受(5×7d×10000 = 50k 对象,数 MB)。
   - 备选(不采用):扩 `TimelineQueryFilter.type` 为 `EventType[]` + store `IN(...)`——小但触 core/types/cli,风险高于收益。
2. **概况条数据来源 = 2 次 facade 调用**(spec §3.1 今日口径)。
   - `queryEvents({since: todayLocalDateStr, limit: 10000})` → 今日事件 → 今日事件数、distinct `session_id`(去重,排除 null)数、今日最常用工具(非空 `tool_name` 直方图 top1)。今日事件量 < 10000,无 cap 问题。
   - `getEventStats({since: '7d'})` → `byDay`(7 柱,进程本地日,= 浏览器本地日 by 约定)+ `totalEvents`(柱图标签"共 N 条")。
   - 概况条**不受用户 type/tool/file/session 过滤影响**(仪表盘快照,固定今日 + 7 日)。
   - 当日无工具事件 → 最常用工具优雅降级(占位"—",spec §3.1)。
3. **会话卡头部汇总 = web 层聚合 fetched 事件**(spec §8 "优先 web 层聚合")。
   - 从事件列表的扁平结果一次性建 `Map<session_id, {events, turnIds:Set, firstTs, lastTs, lastPrompt}>`:会话标题取该会话**首条** `user_prompt` 的 `prompt_text` 截断预览(无 prompt → 取 `tool_name` 或 session_id);`turn_id` 去重计数 = 轮次数;`first_ts`/`last_ts` = 活跃时间范围;跨天会话标注"跨天"+ 当日计数/全天计数(全天 = 该 session 在 fetched 集合内跨所有日期的总数)。
   - **不调 `getSessionStats`**(它不提供轮次数/逐日分解,且每会话一次调用成本高);其 `last_user_prompt` 字段不被采用——标题从 fetched 事件派生,口径自洽。
4. **JSON 语法高亮 = 递归发射器(非 regex-on-escaped)**。
   - `highlightJson(value: unknown): string`:对解析后的值递归走 → 字符串/键 `escapeHtml` 后包 `<span class="js|jk">`、数字 `<span class="jn">`、布尔/null `<span class="jb">`、结构字符 `{ } [ ] , :` 原样。`tool_args` 已是解析对象,直接 `highlightJson(tool_args)`;整个 payload 对象先组装再逐字段经发射器。
   - 安全:XSS 面收敛于"每个字符串片段先 escape 再入 span",不存在 regex 误注入。畸形(已解析为 null 的原非空字段)→ 降级为可读占位"原文不可解析"(§6 兜底)。
5. **会话内折叠 = 不做**(spec §3.3 未要求)。
   - 会话卡展开后渲染该会话在 fetched 集合内的全部事件(受 10000 cap + 截断提示约束)。mockup 的 `.ev-fold`("本会话其余 56 条")**不实现**(非契约);保留 CSS 类以备后续。
6. **展开/折叠 = 原生 `<details>`**(无 JS,无状态):会话卡 `<details>`、事件行 payload `<details>`。状态不进 URL(知识库 pill 模式只管过滤维度,不管展开态)。

### 回跳项

无。spec 已于 2026-09-16 修订,v2 呈现模型(四级分组/会话固定子分组/子 agent 行型/git 独立栏)已是 spec 契约,plan 忠实派生。

## 执行方式建议

**`/implementation`**(非 subagent-implement)。判据:变更文件 ≈6 个(`web/constants.ts` 编辑、`web/timeline-templates.ts` 新建、`web/pages-timeline.ts` 新建、`web/app.css` 编辑、`web/server.ts` 编辑、`__tests__/web/server.test.ts` 修正),全部位于单一模块 `src/web/`,任务强耦合(共享视图模型接口 + 接线需实时反馈四级分桶细节)。不满足 subagent 判据(≥10 文件且 ≥3 独立模块、可独立派任)。建议串行执行,四级分组 + JSON 高亮器这类有实时反馈价值的点留在主会话。

## 适用规范(强制引用,执行期 implementer 开工前必读)

- **动代码**:`docs/guides/coding-standards.md`(命名/目录/分层契约部分)。
- **接口(HTTP 路由)**:`docs/guides/interface-standards.md`(新增 `/timeline` 路由沿用既有 web 路由约定:仅 GET、回环、只读、XSS escapeHtml)。
- **schema**:不涉(只读 `timeline_*` 表,无建表/改表)。
- **提交**:`docs/guides/git-standards.md`(结晶进下节「提交规范」,一次)。

## 提交规范(从 git-standards.md 结晶,实施期据此提交,precommit 门禁仅兜底)

- 消息格式:`type(scope): 中文描述`(Conventional Commits + 中文);type=`feat`,scope=`web`。
- 补充用"——",并列用"+",数值对比用"→"。
- **无票据关联**:需求追踪走 `docs/features/` 目录,不进标题。
- body:非琐碎写 body(背景一行 + "-" 要点);琐碎可只留 subject。
- **提交前检查点**(本需求相关,逐项自查):
  - 与 TS 同放的运行时资产已登记 `scripts/copy-assets.cjs`——本需求**无**新运行时资产(`app.css`/`app.js` 已在清单;不新增 schema.sql)。
  - `src/core` 未出现对 `src/cli`/`src/web` 的 import(分层铁律)。
  - 无被注释掉的命令注册 / hook 接入项。
  - 无写死魔法值(绝对路径/密钥/阈值/版本号)。
  - 无新增 TODO/FIXME。
  - `vitest.config.ts` 的 `TZ:'UTC'` 未改。

### 建议提交粒度

- **commit A**(T-4):`feat(web): 时间线页样式——73 类会话卡/事件行/柱图 + 5 事件类型 chip 色调`。独立提交:是(CSS 休眠态,不碰逻辑,既有测试全绿)。
- **commit B**(T-1+T-2+T-3+T-5):`feat(web): 开发时间线页——日期>会话>轮次>事件四级分组 + 概况条 + payload 原文`。独立提交:是(页面接线 + 既有 server.test.ts 占位断言同步修正,原子落地,既有测试不红)。body 列:四级分桶、多类型 web 层合并、子 agent 行型/git 独立栏、截断感知。

## 允许局部工程适配的范围

- `highlightJson` 内部递归实现细节、span class 命名(沿用 mockup `jk/js/jn/jb`)。
- 视图模型接口字段命名(镜像 `overview-templates.ts` 风格,字段名可自定)。
- CSS 类落地顺序与是否拆分注释块。
- 日期分组标题文案("今天"/"昨天"/"7月28日 周二",沿用 mockup)。
- 会话标题截断长度(≤40 字符,ellipsis)。
- `getEventStats` 调用次数:若发现可合并(如 `byDay[today]` 复用为今日事件数)可在实现期优化,但**不得牺牲今日口径准确性**(今日事件数须排除其他日期)。

## Plan 冲突上报规则

- 任务执行中发现 spec 契约与代码现状不符 → 以 spec 为准,按 `PLAN_CONFLICT` 上报,不在实现期擅自改 spec。
- 发现 `queryEvents`/`getEventStats` 实际行为与「必须严格执行的契约」描述不符 → 停下上报(契约基于 store.ts 已核实,但实现期若发现版本漂移以代码为准并报告)。

## 关键风险与防跑偏约束

1. **多类型合并性能**:5 类型 × 7d × 10000 = 50k 对象。localhost 可承受,但实现期须确认合并 + 重排不阻塞(单请求 <500ms 目标)。若超时 → 回退方案:限事件列表默认 range=today(今日远低于 cap),7d 视图作为重操作。
2. **时区一致性**:概况柱图(`getEventStats.byDay`,进程本地)与事件列表按天分组(web 层 `new Date(ts).getDate()`,进程本地)须同口径。实现期断言两者"今天"条目数一致(除 type 过滤影响概况条为仪表盘口径)。
3. **JSON 高亮器 XSS**:所有字符串片段过 `escapeHtml` 后再入 span;**不得**先 tokenize 再 escape(顺序反了会漏)。实现后须有 XSS 用例(payload 含 `<script>` 标签的 prompt_text,验证输出为转义文本)——归入实现后测试。
4. **null session_id / null turn_id 兜底**:git_commit(null session)入独立栏;个别 null turn_id 事件归入会话卡内"未分轮次"尾桶(不崩)。
5. **server.test.ts 占位断言**:`server.test.ts:84` 断言 `/timeline` 含"平行需求" + feature-id 字符串。T-5 接线后此断言必红 → **T-5 必须同步改为真实页面最小可观察断言**(含"开发时间线"标题 + 导航 active)。此项是 T-5 完成条件的硬性部分,不是独立测试任务。
6. **app.css 类冲突**:mockup 重新定义了 `.empty__sub/__code/__btn`(与既有 `.empty__text/__reset` 不同)。T-4 落地时**不覆盖**既有 `.empty` 变体,而是为时间线空态用新类名(`.tl-empty__*`)或复用既有结构——实现期择一,保证知识库页空态不回归。

## 待确认项

无阻塞项。以下为实现期可自决(不阻塞):
- 会话标题截断长度具体值(建议 40)。
- 7 日柱图 x 轴标签(周几 vs 日期)——沿用 mockup(周几)。
- 概况条是否在 7d 视图下仍显示"今日"口径——是(spec §3.1 固定今日 + 7 日柱图)。

---

任务详情见 `-02-backend.md`(T-1、T-3)与 `-03-frontend.md`(T-2、T-4、T-5)。
