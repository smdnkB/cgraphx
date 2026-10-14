# Plan 03 · frontend(src/web)

> 所属 plan:`cgraphx-web开发任务浏览-index.md`;spec:`../cgraphx-web开发任务浏览-spec.md`;线框:`../cgraphx-web开发任务浏览-线框-v3.html`

### F-1: 时间线事件行渲染抽成公共模块

- 目标:把「事件 → 行模型」与「行 / 轮次 HTML」从时间线页私有实现变为可复用,时间线页行为不变;顺带让 `pages-timeline.ts` 降到 600 行以下。
- 对应 spec 条款:§7.2「事件行样式与时间线页一致」、§13「事件行样式复用时间线页的渲染」、§11「已有页面行为不变」。
- 强制引用:`docs/guides/coding-standards.md`
- 依赖:无
- 涉及范围:
  - 新增 `src/web/timeline-event-rows.ts`
  - 修改 `src/web/pages-timeline.ts`、`src/web/timeline-templates.ts`
- 必须严格执行:
  - `timeline-event-rows.ts` 导出(逐字),函数体从 `pages-timeline.ts` **原样搬移**:
    ```ts
    export function eventTime(ms: number): { datetime: string; text: string }
    export function cardTime(ms: number): { datetime: string; text: string }
    export function truncate(s: string, max: number): string
    export function toEventRow(e: TimelineEvent): EventRowModel
    export function toCommitRow(e: TimelineEvent): CommitRowModel
    ```
    `buildPayload`、`extractPath`、`buildSummary` 一并搬入,保持私有。`pages-timeline.ts` 删除这些定义改为 import;仍被 `pages-timeline.ts` 其它代码使用的 `pad2`、`localDateStr` 留在原处。
  - `timeline-templates.ts`:给既有 `renderEventRow(e: EventRowModel): string`、`renderTurnGroup(t: TurnGroupModel): string` 加 `export`,函数体不改;把 `renderCommitsBar` 中 `.map((c) => \`<div class="commit">…</div>\`)` 的单行模板抽成并导出 `renderCommitRow(c: CommitRowModel): string`,`renderCommitsBar` 改为 `commits.map(renderCommitRow)`,输出 HTML 逐字不变。
  - 时间线页 HTML 输出逐字不变。
- 允许局部适配:import 顺序、搬移后的注释措辞。
- 具体要求:搬移后 `pages-timeline.ts` < 600 行。
- 完成条件:`npm run build`、`npx vitest run` 通过;时间线页输出不变(验证方式 2)。
- 验证方式:
  1. `npm run build && npx vitest run && wc -l src/web/pages-timeline.ts`
  2. **动代码前**:把 `.cgraphx/cgraphx.db` 复制到 scratchpad 下的临时项目 `<tmp>/.cgraphx/`,`node dist/cli/index.js web <tmp> --port 2471` 启动,`curl -s 'http://127.0.0.1:2471/timeline?range=7d' > <scratchpad>/tl-before.html`,停服务;完成后同法得到 `tl-after.html`,`diff` 为空(同一天内执行)。
- 独立提交:是。`refactor(web): 时间线事件行渲染抽成公共模块——供开发任务页复用`
- 风险/注意事项:`toEventRow` 依赖 `EVENT_TYPE_LABELS` / `EVENT_TYPE_CHIP_TONE`(`./constants`)与 `Payload` 等类型(`./timeline-templates`),随搬移一并 import。

### F-2: 开发任务页面:路由、侧栏、列表、详情

- 目标:实现 `/tasks` 与 `/tasks/<id>` 两个页面,布局与交互对齐线框 v3。
- 对应 spec 条款:§1.2、§3.3、§3.4(截断标注)、§4、§5.2(展示)、§6.2(展示)、§7、§8、§10、§11;验收 A1–A5、A10–A18。
- 强制引用:`docs/guides/coding-standards.md`
- 依赖:B-2(task 门面)、F-1(事件行导出)
- 涉及范围:
  - 新增 `src/web/pages-tasks.ts`、`src/web/task-templates.ts`
  - 修改 `src/web/server.ts`、`src/web/layout.ts`、`src/web/constants.ts`、`src/web/render-utils.ts`、`src/web/public/app.css`、`CHANGELOG.md`
- 必须严格执行:
  - **只调门面**:从 `../core/task` 只使用 `listTaskSummaries`、`getTaskReport`、`TaskNotEnabledError`、`TaskArgError` 与类型 `TaskSummary`、`TaskTotals`、`TaskReport`、`SegmentReport`、`ArtifactGroup`、`ArtifactCategory`、`ReferenceReport`、`TaskItem`、`TaskBinding`、`TaskSource`、`BindSource`(均已/将由门面导出)。从 `./timeline-templates` 使用 `renderEventRow`、`renderTurnGroup`、`renderCommitRow`;从 `./timeline-event-rows` 使用 `toEventRow`、`toCommitRow`、`truncate`、`eventTime`。B-2 的门面签名(逐字):
    ```ts
    listTaskSummaries(projectRoot: string): Promise<TaskSummary[]>
    getTaskReport(projectRoot: string, taskId: number, opts: { eventLimitPerSegment: number }): Promise<TaskReport>
    ```
    其中 `TaskSummary { task; inProgress; totals: TaskTotals | null; truncated }`;`TaskTotals { sessionCount; bindingCount; eventCount; commitCount; activeMs; workMs; lastActivityAt: string | null }`;`TaskReport { task; featureDirs; inProgress; totals; segments; eventCounts; outputs; references; truncated }`;`SegmentReport { binding; stats: { eventCount; commitCount; activeMs; workMs; firstTs; lastTs }; events; hiddenEventCount }`;`ReferenceReport { groups; concepts; overlapCount }`;`ArtifactGroup { category; paths }`。web 不对这些数字做任何再计算(排序也已由 core 完成)。
  - `constants.ts` 新增:
    ```ts
    /** 会话块事件显示上限(spec §7.3)。 */
    export const TASK_SEGMENT_EVENT_LIMIT = 500;
    export const TASK_SOURCE_LABELS: Record<TaskSource, string> = { api: '接口', manual: '手动' };
    export const BIND_SOURCE_LABELS: Record<BindSource, string> = { cli: '显式绑定', feature_dir: '需求目录自动绑定' };
    export const ARTIFACT_CATEGORY_LABELS: Record<ArtifactCategory, string> = {
      'feature-doc': '需求文档', knowledge: '知识库', schema: '数据库结构', diagram: '业务图', 'api-test': '接口测试', code: '代码',
    };
    ```
  - `render-utils.ts` 新增:
    ```ts
    /** spec §3.3:向下取整到分钟;≥1h → `<h>h <m>m`,否则 `<m>m`;0 → `0m`。 */
    export function formatDuration(ms: number): string
    /** spec §3.3:进程本地时区;与 nowMs 同年 → `MM-DD HH:mm`,否则 `YYYY-MM-DD HH:mm`。 */
    export function formatTaskTime(iso: string, nowMs: number): string
    ```
  - `layout.ts`:`ShellActive` 增加 `'tasks'`;导航在「系统地图」之后加 `navItem('开发任务', '▤', '/tasks', 'tasks', active)`。
  - `pages-tasks.ts` 导出(逐字):
    ```ts
    export interface TaskPageCtx { version: string; localHost: string; projectRoot: string }
    export async function renderTasksListPage(ctx: TaskPageCtx): Promise<string>
    export async function renderTaskDetailPage(
      db: SqliteDatabase,
      taskId: number,
      ctx: TaskPageCtx,
    ): Promise<{ status: 200; html: string } | { status: 404 }>
    ```
    - 两个函数捕获 `TaskNotEnabledError` → 返回 200 的启用提示页(标题「开发任务」,文案「本项目尚未启用开发任务,运行 `cgraphx install` 后可用」);`renderTaskDetailPage` 捕获 `TaskArgError` → `{ status: 404 }`;其它错误上抛(server 的 500 兜底)。
    - 详情调用 `getTaskReport(ctx.projectRoot, taskId, { eventLimitPerSegment: TASK_SEGMENT_EVENT_LIMIT })`。
    - 链接解析(spec §8),输入项目相对路径,输出 `{ href: string | null; text: string }`:
      | 路径 | href | text |
      |---|---|---|
      | `docs/knowledge/**` 且 `new MarkdownQuery(db).getDocumentDetail(path) !== null` | `/doc/${encodeURIComponent(path)}` | 文档 title |
      | `docs/knowledge/**` 未被索引 | null | 路径 |
      | `^docs/code-map/([^/]+)\.md$` 且 `isSafeCodemapName(名)` | `/map/system/${encodeURIComponent(名)}` | 名 |
      | `^docs/code-map/flows/([^/]+)\.md$` 且 `isSafeCodemapName(名)` | `/map/flow/${encodeURIComponent(名)}` | 名 |
      | `^docs/schema-knowledge/([^/]+)/ddl/([^/]+)\.sql$` | `/schema/${enc(工程)}/${enc(表)}` | 表名 |
      | `^docs/schema-knowledge/([^/]+)/.+` 其它 | `/schema/${enc(工程)}` | 路径 |
      | 其余 | null | 路径 |
    - 概念:`new MarkdownQuery(db).listConcepts({ sort: 'name' })` 的名字集合中存在 → `buildOverviewUrl({ types: [], statuses: [], domains: [], concepts: [c], sort: 'updated', page: 1 })`;否则不可点(同系统地图页概念标签口径)。
  - `task-templates.ts`:纯函数,输入视图模型、输出 HTML 字符串,所有动态文本经 `escapeHtml`。导出 `renderTaskListContent`、`renderTaskDetailContent`、`renderTaskNotEnabledContent`(模型类型由本文件定义并导出,命名可自定)。
  - **列表页**(spec §4、线框 v3「任务列表」):
    - 列:任务名(链接 `/tasks/<id>`;`inProgress` 时加「进行中」标签)· 来源 · 状态(`task.status ?? '—'`)· 会话 · commit · 活跃时长 · 最近活动。
    - `totals === null` → 会话 / commit / 活跃时长 / 最近活动显示「—」;`totals.lastActivityAt === null` → 时长 `0m`、最近活动「—」。
    - 表下注「接口任务显示的是上次 `cgraphx task list` 拉取的缓存」(存在接口任务时才显示)。
    - 任一 `truncated` → 表上方注「部分任务的绑定段事件超过 10000 条,统计基于每段最近 10000 条事件」。
    - 空列表 → 空态:「暂无开发任务」+ 两种来源说明(会话中 `cgraphx task use <名称>`;spec 头部写 `> 任务: <名称>` 后改动该需求目录自动绑定)。
  - **详情页**(spec §7、线框 v3「任务详情」),自上而下:
    1. 标题 = 任务名;返回链接「← 返回任务列表」→ `/tasks`。
    2. 任务信息:来源 · 外部编号 · 状态 · 链接(仅 `^https?://` 时渲染 `<a target="_blank" rel="noopener noreferrer">`,否则纯文本;空为「—」)。
    3. 关联需求目录:路径列表,不可点;空为「—」。
    4. `totals === null`(从未绑定)→ 产出、参考、会话三栏各显示「尚未绑定任何会话」,不显示合计与事件类型统计,结束。
    5. 合计:会话数(副文「N 段绑定」)· 活跃时长 · 工作时长 · commit · 事件。`truncated` 时在合计下注明截断文案(同列表页)。
    6. 产出:标题「产出 · N 个文件」;按 `outputs` 顺序逐类显示「类别名 + 文件数」与链接/路径;`code` 类用 `<details>` 默认收起;无产出显示「暂无产出」。
    7. 参考:标题「参考 · 按命令记录推断」;`groups` 逐类同产出写法;`concepts` 非空 → 「查询过知识库概念:」+ 概念标签;`overlapCount > 0` → 「另有 N 个文件既被参考也是本任务产出,只在产出栏显示」;三者都空 → 「未识别到参考」。
    8. 会话:一条 `SegmentReport` 一块,顺序同 `segments`。块头:会话 id 前 8 位(`title` 为完整 id)· 「开始 → 结束 / 生效中」(`formatTaskTime`)· 绑定来源标签 · 「活跃 X · 工作 Y · N commit」。块体 `<details>`(默认收起),summary「事件(stats.eventCount)· M 轮」。展开内容:按时间顺序遍历 `events`,连续且 `turn_id` 相同(非 null)的事件归为一个 `TurnGroupModel`,label =「轮 序号 · HH:mm」,若组内有 `user_prompt` 且 `prompt_text` 非空则追加「 · 」+ `truncate(prompt_text, 40)`;`turn_id` 为 null 的事件单独输出:`git_commit` 用 `renderCommitRow(toCommitRow(e))`(显示 hash · message · 增删行,与时间线页提交行一致),其它类型用 `renderEventRow(toEventRow(e))`;轮次组内若出现 `git_commit` 同样用 `renderCommitRow(toCommitRow(e))` 穿插(轮次组改为自行拼接 `<div class="turn">label</div><div class="evlist">…</div>`,结构与 `renderTurnGroup` 相同)。非 commit 行模型用 `toEventRow`。M = 轮次组数。`hiddenEventCount > 0` → 块末「还有 N 条未显示,用 `cgraphx task show <task.id> --events --limit <totals.eventCount>` 查看」。
    9. 事件类型统计:按 `EVENT_TYPE_LABELS` 的键顺序,只列计数 > 0 的类型,显示中文标签与数量。
  - `server.ts` 路由(放在 `/map` 分支之后、`/doc` 之前):
    - `pathname === '/tasks' || pathname === '/tasks/'` → `renderTasksListPage`,200。
    - `/^\/tasks\/(\d+)$/` → `renderTaskDetailPage(ctx.db, Number(id), …)`;`status: 404` → `sendNotFound`。
    - 其余 `/tasks/*` → `sendNotFound`。
    - 两个 async 调用按 `/timeline` 分支的 `.then/.catch(err => sendInternalError(...))` 写法兜底。
    - 更新文件头部路由注释。
  - `app.css`:在文件末尾追加「开发任务」一节样式;事件行、轮次直接复用时间线页既有 class(`turn`、`evlist`、`ev*`),不复制规则。
  - `CHANGELOG.md` 的 `## Unreleased` 下新增一节 `### Added — cgraphx web: development tasks page`,英文,3–5 条要点(列表 / 详情 / 时长口径 / 产出与参考 / 只读)。
- 允许局部适配:
  - 模板 HTML 结构与 class 命名、视图模型字段名、css 写法;区块顺序与文案须与上文一致。
  - `pages-tasks.ts` 与 `task-templates.ts` 之间的辅助函数分布(各 < 600 行)。
- 具体要求:
  - 渲染前不做任何 DB 写入;`MarkdownQuery` 只用于查文档与概念。
  - 不新增前端 JS(展开收起用 `<details>`)。
- 完成条件:
  - `npm run build`、`npx vitest run` 通过。
  - 验证方式 2–5 全部符合。
- 验证方式:
  1. `npm run build && npx vitest run`
  2. **主场景(本仓库,真实数据)**:用正常 CLI 给两个真实会话补绑任务(首次绑定回溯到会话第一条事件):
     ```bash
     node dist/cli/index.js task use 任务会话映射与timeline采集增强 --session b1ac8f3c-9396-4a85-a5c4-1541a8822f6d
     node dist/cli/index.js task use cgraphx-web开发任务浏览
     node dist/cli/index.js web --port 2470
     ```
     浏览器面板打开 `http://127.0.0.1:2470/tasks` 与两个任务的详情,对照线框 v3 检查:区块顺序;产出里有该需求的 spec / plan、3 篇知识库、2 个代码地图;参考里有知识库与代码地图且可点进;会话块展开后按轮次分组。记录列表页与详情页打开耗时(spec Q1:2 秒内)。
  2b. **边界场景(DB 副本,不写本仓库库)**:把 `.cgraphx/cgraphx.db` 复制到 scratchpad 下临时项目 `<tmp>/.cgraphx/`,在 `<tmp>` 目录内执行:
     - `node <仓库>/dist/cli/index.js task use 从未绑定的任务 --session tmp-a` 后再 `node -e` 在副本上 `DELETE FROM task_sessions WHERE session_id='tmp-a'` → 得到一个从未绑定的任务(A4:排最后、数字列「—」;详情三栏「尚未绑定任何会话」)。
     - `task use X --session b1ac8f3c-…` → `task use Y --session b1ac8f3c-…` → `task use X --session b1ac8f3c-…` → X 的详情出现同一会话两块、列表会话数 1(A5)。
     - 另一份副本清空 `task_items`、`task_sessions` → 列表空态(A3)。
     用 `node <仓库>/dist/cli/index.js web <tmp> --port 2473` 查看。
  3. A2 只读:临时项目 `<tmp>` 用 `.cgraphx/cgraphx.db` 副本并删除 4 张 `task_*` 表;`node dist/cli/index.js web <tmp> --port 2472` 启动;`curl -s http://127.0.0.1:2472/tasks` 含「尚未启用开发任务」,`/`、`/timeline` 正常 200;停服务后查副本 `SELECT count(*) FROM sqlite_master WHERE name LIKE 'task_%'` 为 0。
  4. A15:`curl -o /dev/null -w '%{http_code}' http://127.0.0.1:2470/tasks/abc` 与 `/tasks/99999` 均为 404。
  5. A16:访问列表与详情前后,对本仓库库执行 `SELECT max(id) FROM task_sessions`、`SELECT count(*) FROM task_items`、`SELECT count(*) FROM task_reminders` 结果不变。
- 独立提交:是。`feat(web): 开发任务页——任务列表 + 详情(合计 · 产出 · 参考 · 会话块)`
- 风险/注意事项:
  - 示例数据不足时用临时 DB 副本构造,不得向本仓库库写入构造数据(本仓库的 `cgraphx task use` 是正常 CLI 用法,允许)。
  - `server.ts` 改动后须 < 600 行。
