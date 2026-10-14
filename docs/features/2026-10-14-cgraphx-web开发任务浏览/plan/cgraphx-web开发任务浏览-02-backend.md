# Plan 02 · backend(src/core/task)

> 所属 plan:`cgraphx-web开发任务浏览-index.md`;spec:`../cgraphx-web开发任务浏览-spec.md`

### B-1: task 只读打开 + 归属事件查询收口

- 目标:提供「不写库地打开 task 库」与「按绑定段取归属事件」两个内部基础能力,并让既有 `getTaskDetail` 改用后者(行为不变)。
- 对应 spec 条款:§9(不写库)、§10 首行(没有 task 表)、§13 第 2 条、A2;归属口径沿用上一个需求 spec §3.2。
- 强制引用:`docs/guides/coding-standards.md`
- 依赖:无
- 涉及范围:
  - 修改 `src/core/task/schema-bootstrap.ts`、`src/core/task/errors.ts`、`src/core/task/store.ts`、`src/core/task/feature-link.ts`、`src/core/task/index.ts`
  - 新增 `src/core/task/attribution.ts`
- 必须严格执行:
  - `errors.ts` 新增:
    ```ts
    /** 项目库存在但没有 task 表(task 子系统出现之前安装、之后未重装)。 */
    export class TaskNotEnabledError extends TaskConfigError
    ```
    构造参数与 `TaskConfigError` 相同;`name` 设为 `'TaskNotEnabledError'`;消息:`本项目尚未启用开发任务,运行 \`cgraphx install\` 后可用`。
  - `schema-bootstrap.ts` 新增(不经门面导出,仅供 task 内部使用):
    ```ts
    /**
     * 只读打开项目共享库:不应用 schema、不建表。调用方负责 close()。
     * @throws TaskConfigError 项目未初始化(.cgraphx/cgraphx.db 不存在)——不得创建 DB 文件。
     * @throws TaskNotEnabledError sqlite_master 中没有 task_schema_versions 表。
     */
    export function openTaskDbReadOnly(projectRoot: string): DatabaseConnection
    ```
    顺序固定:先 `fs.existsSync(dbPath)` → 再 `DatabaseConnection.open` → `SELECT name FROM sqlite_master WHERE type='table' AND name='task_schema_versions'`;不存在则先 `close()` 再抛 `TaskNotEnabledError`。任何路径都不得调用 `ensureTaskSchema`。
  - `store.ts` 新增:
    ```ts
    /** 全部绑定,按 task_id、bound_at、id 升序。 */
    listAllBindings(): TaskBinding[]
    ```
    沿用 `BINDING_COLUMNS` / `rowToBinding` / `this.guard`。
  - 新增 `attribution.ts`:
    ```ts
    /** 单条绑定段查询 timeline 的上限(timeline 查询硬上限)。 */
    export const EVENTS_PER_BINDING_LIMIT = 10_000;

    /**
     * 取一条绑定段的归属事件(按 ts、id 升序)。区间左闭右开:bound_at ≤ ts < unbound_at。
     * truncated = timeline 返回条数达到 EVENTS_PER_BINDING_LIMIT(此时保留的是该段最近的 10000 条)。
     */
    export async function queryBindingEvents(
      projectRoot: string,
      binding: TaskBinding,
    ): Promise<{ events: TimelineEvent[]; truncated: boolean }>
    ```
    实现:`queryEvents(projectRoot, { session: binding.sessionId, since: binding.boundAt, until: binding.unboundAt ?? undefined, limit: EVENTS_PER_BINDING_LIMIT })`,剔除 `ts < boundAt` 与 `unboundAt !== null && ts >= unboundAt`,再按 `ts` 升序、`id` 升序排序。`truncated` 以过滤前的返回条数判断。
  - `feature-link.ts` 的 `getTaskDetail`:删除本文件内的 `EVENTS_PER_BINDING_LIMIT` 与逐段过滤代码,改为对每条绑定调 `queryBindingEvents` 后按 id 去重、按 ts/id 升序合并;对外签名、返回值、`DEFAULT_DETAIL_EVENT_LIMIT` 不变。
  - `index.ts` 只新增导出 `TaskNotEnabledError`(B-2 再加其余导出)。
- 允许局部适配:
  - `attribution.ts` 内部排序/过滤写法;`openTaskDbReadOnly` 内部异常包装(DB 异常可包成 `TaskStoreError`)。
- 具体要求:
  - 注释用中文。
  - `openTaskDb`(既有)保持原样,CLI 与 hook 继续用它。
- 完成条件:
  - `npm run build` 通过;`npx vitest run` 全绿(既有测试不红)。
  - `getTaskDetail` 行为不变(见验证方式 2)。
- 验证方式:
  1. `npm run build && npx vitest run`
  2. **动代码前**先在本仓库留一份基线(无任务时先 `node dist/cli/index.js task use <临时名称>` 建一个并绑定当前会话):
     `npm run build && node dist/cli/index.js task show <id> --events --limit 1000 --json > <scratchpad>/before.json`;
     完成后 `npm run build && node dist/cli/index.js task show <id> --events --limit 1000 --json > <scratchpad>/after.json`,用 `node -e` 比较两份 JSON 中 `commits`、`eventCounts`、`events` 的 id 序列一致(当前会话仍在产生事件,只比较 before 里已有的 id 是否都在 after 中且顺序一致)。
  3. 只读打开验证(临时项目):`cp .cgraphx/cgraphx.db <临时目录>/.cgraphx/`,用 `node -e` 在副本上 `DROP TABLE task_items; DROP TABLE task_sessions; DROP TABLE task_reminders; DROP TABLE task_schema_versions;`,再用 `node -e "require('./dist/core/task/schema-bootstrap').openTaskDbReadOnly('<临时目录>')"` 应抛 `TaskNotEnabledError`,且之后 `sqlite_master` 中 `task_%` 表数为 0。
- 独立提交:是。`refactor(task): 只读打开 + 绑定段归属查询收口——为 web 任务页做准备`
- 风险/注意事项:
  - `DatabaseConnection.open` 会在目录不存在时建目录、DB 不存在时建文件,所以存在性检查必须在 open 之前(与 web `bootstrap.ts` 同理)。

### B-2: 任务报告:时长、汇总、产出、参考

- 目标:在 task 子系统内实现 spec 的全部口径,经门面暴露 `listTaskSummaries` / `getTaskReport` 两个只读函数供 web 使用。
- 对应 spec 条款:§3.1–§3.4、§4(数据范围、排序、进行中)、§5、§6、§7.1(数据)、§7.3(上限由调用方传入)、§13 第 1、3、4 条;验收 A4–A14。
- 强制引用:`docs/guides/coding-standards.md`
- 依赖:B-1(`openTaskDbReadOnly`、`queryBindingEvents`、`EVENTS_PER_BINDING_LIMIT`、`TaskStore.listAllBindings`、`TaskNotEnabledError`)
- 涉及范围:
  - 新增 `src/core/task/report.ts`、`src/core/task/artifacts.ts`
  - 修改 `src/core/task/constants.ts`、`src/core/task/types.ts`、`src/core/task/index.ts`
- 必须严格执行:
  - `constants.ts` 新增:
    ```ts
    /** 活跃时长断点:相邻归属事件间隔超过此值即断开(spec §3.1,与 task-history 一致)。 */
    export const ACTIVE_GAP_MS = 60 * 60 * 1000;

    /** 产出分类(spec §5.2,数组顺序即判定与展示顺序)。 */
    export const ARTIFACT_CATEGORIES = ['feature-doc', 'knowledge', 'schema', 'diagram', 'api-test', 'code'] as const;

    /** 参考只列的类别(spec §6.2)。 */
    export const REFERENCE_CATEGORIES = ['feature-doc', 'knowledge', 'schema', 'diagram'] as const;
    ```
  - `types.ts` 新增(逐字):
    ```ts
    export type ArtifactCategory = (typeof ARTIFACT_CATEGORIES)[number];

    /** 一条绑定段的统计(spec §3.1)。无事件或仅 1 条事件时 activeMs / workMs 为 0。 */
    export interface SegmentStats {
      eventCount: number;
      commitCount: number;
      activeMs: number;
      workMs: number;
      /** 段内最早 / 最晚归属事件 ts;无事件为 null。 */
      firstTs: string | null;
      lastTs: string | null;
    }

    /** 任务合计(spec §3.2)。 */
    export interface TaskTotals {
      /** 不同 session_id 个数。 */
      sessionCount: number;
      bindingCount: number;
      eventCount: number;
      commitCount: number;
      activeMs: number;
      workMs: number;
      /** 全部归属事件最大 ts;无归属事件为 null。 */
      lastActivityAt: string | null;
    }

    export interface TaskSummary {
      task: TaskItem;
      /** 至少一条 unboundAt 为 null 的绑定。 */
      inProgress: boolean;
      /** 从未绑定过会话为 null。 */
      totals: TaskTotals | null;
      /** 任一绑定段命中 EVENTS_PER_BINDING_LIMIT。 */
      truncated: boolean;
    }

    export interface SegmentReport {
      binding: TaskBinding;
      stats: SegmentStats;
      /** 段内最早的 eventLimitPerSegment 条归属事件,ts/id 升序。 */
      events: TimelineEvent[];
      /** stats.eventCount - events.length。 */
      hiddenEventCount: number;
    }

    export interface ArtifactGroup {
      category: ArtifactCategory;
      /** 项目相对 POSIX 路径,升序去重。 */
      paths: string[];
    }

    export interface ReferenceReport {
      /** 只含 REFERENCE_CATEGORIES 中非空的类别,按 ARTIFACT_CATEGORIES 顺序。 */
      groups: ArtifactGroup[];
      /** cgraphx docs 命令中按概念查询的概念名,去重,按首次出现顺序。 */
      concepts: string[];
      /** 既被参考又在产出中的文件数(这些文件不进 groups)。 */
      overlapCount: number;
    }

    export interface TaskReport {
      task: TaskItem;
      /** 主 spec 头部声明本任务的需求目录(项目相对 POSIX,如 docs/features/<id>)。 */
      featureDirs: string[];
      inProgress: boolean;
      totals: TaskTotals | null;
      /** 一条绑定段一项,按 bound_at、id 升序。 */
      segments: SegmentReport[];
      /** 全部归属事件按 event_type 计数。 */
      eventCounts: Record<string, number>;
      /** 非空类别,按 ARTIFACT_CATEGORIES 顺序。 */
      outputs: ArtifactGroup[];
      references: ReferenceReport;
      truncated: boolean;
    }
    ```
  - `report.ts` 导出(逐字):
    ```ts
    /** spec §3.1:eventsAsc 为 ts 升序的归属事件。 */
    export function computeSegmentStats(eventsAsc: TimelineEvent[]): SegmentStats

    /**
     * 全部本地任务及汇总(spec §4)。不请求外部接口。
     * 排序:totals?.lastActivityAt 降序;为 null 的排最后;同值或同为 null 按 task.id 降序。
     * @throws TaskConfigError 未初始化;TaskNotEnabledError 没有 task 表。
     */
    export async function listTaskSummaries(projectRoot: string): Promise<TaskSummary[]>

    /**
     * 单任务报告(spec §3、§5、§6、§7)。
     * @throws TaskArgError 本地没有该任务;TaskConfigError / TaskNotEnabledError 同上。
     */
    export async function getTaskReport(
      projectRoot: string,
      taskId: number,
      opts: { eventLimitPerSegment: number },
    ): Promise<TaskReport>
    ```
  - `computeSegmentStats` 口径:`eventCount` = 总数;`commitCount` = `event_type === 'git_commit'` 数;`workMs` = 末条 − 首条(Date.parse);`activeMs` = 依次比较相邻事件,间隔 `> ACTIVE_GAP_MS` 即断开,累加每段「末 − 首」。
  - 合计:`sessionCount` = 绑定段 `sessionId` 去重数;其余各项为各段求和(重叠不扣除);`lastActivityAt` = 各段 `lastTs` 最大值。没有绑定 → `totals = null`。
  - 读取流程(两个函数共用):`openTaskDbReadOnly` → `TaskStore` 读任务与绑定(列表用 `store.listTasks()` + `store.listAllBindings()`——注意不是门面的 `listTasks`,后者走 `openTaskDb` 会建表;详情用 `getTaskById` + `listBindingsForTask`)→ **关闭连接** → 逐段 `queryBindingEvents`。详情的 `featureDirs` 沿用 `getTaskDetail` 的派生方式:`scanFeatureTasks(projectRoot)` 中 `findTask(store, e.task)?.id === taskId` 的 `e.path`(须在连接关闭前完成)。
  - `artifacts.ts` 导出(逐字):
    ```ts
    /** spec §5.2,先命中先用;relPath 为项目相对 POSIX 路径。 */
    export function classifyArtifactPath(relPath: string): ArtifactCategory

    /** spec §5.1:三来源合并去重,只留项目根内且当前存在的普通文件。 */
    export function collectOutputs(projectRoot: string, events: TimelineEvent[], featureDirs: string[]): ArtifactGroup[]

    /** spec §6.1、§6.2:outputPaths 为产出中的全部路径。 */
    export function collectReferences(projectRoot: string, events: TimelineEvent[], outputPaths: ReadonlySet<string>): ReferenceReport
    ```
  - 分类规则(`classifyArtifactPath`,按序):`docs/features/` 开头 → `feature-doc`;`docs/knowledge/` → `knowledge`;`docs/schema-knowledge/` 开头或以 `.sql` 结尾 → `schema`;`docs/code-map/` 或 `docs/design-map/` → `diagram`;`docs/bruno/` → `api-test`;其余 → `code`。
  - 路径归一(两个 collect 共用):绝对路径必须以 `path.resolve(projectRoot) + path.sep` 开头才保留,转为相对;相对路径去掉开头 `./`;统一 `/` 分隔;含 `..` 段的丢弃;最后 `fs.statSync(abs).isFile()` 为真才保留(异常视为不存在)。
  - 产出来源:① `git_commit` 事件的 `commit_files`(按项目相对解析);② `tool_name ∈ {Edit, Write, MultiEdit, NotebookEdit}` 事件的 `tool_args.file_path`(NotebookEdit 取 `notebook_path`,缺省再取 `file_path`);③ 每个 `featureDirs` 目录下递归的全部普通文件(不跟随符号链接)。
  - 参考来源:① `tool_name ∈ {Read, Grep, Glob}` 的 `tool_args.file_path`(Read)/ `tool_args.path`(Grep、Glob);② `tool_name === 'Bash'` 的 `tool_args.command`:按正则 `/[\s'"`|;&<>()=,]+/` 切分为候选,逐个归一;③ 概念:`command` 中含独立词 `docs`(`/(^|\s)docs\s/`)时,用 `/--concept(?:=|\s+)(?:"([^"]+)"|'([^']+)'|([^\s"'|;&]+))/g` 提取概念名。候选路径归一后只保留 `REFERENCE_CATEGORIES` 中的类别;在 `outputPaths` 中的计入 `overlapCount`(按去重后的文件计)且不进 `groups`。
  - `index.ts` 新增导出:`listTaskSummaries`、`getTaskReport`、`computeSegmentStats`(来自 report)、`classifyArtifactPath`(来自 artifacts)、`ACTIVE_GAP_MS`、`ARTIFACT_CATEGORIES`、`REFERENCE_CATEGORIES`(来自 constants)、类型 `SegmentStats`、`TaskTotals`、`TaskSummary`、`SegmentReport`、`ArtifactCategory`、`ArtifactGroup`、`ReferenceReport`、`TaskReport`。`collectOutputs` / `collectReferences` 不经门面导出。
- 允许局部适配:
  - report.ts / artifacts.ts 内部辅助函数的拆分与命名;目录递归写法;两个文件各自不超过 600 行即可。
  - 事件同时有 pre / post 两条时,路径靠集合去重,不需要区分事件类型。
- 具体要求:
  - 不发网络请求;不调用 `loadTaskSourceConfig` / `fetchRemoteTasks`。
  - 不读取文件内容,只判断存在。
  - `getTaskReport` 中 `segments[i].events` = 该段事件前 `opts.eventLimitPerSegment` 条;`eventCounts`、`outputs`、`references`、`totals` 基于全部归属事件(各段合并,按 `id` 去重)。
- 完成条件:
  - `npm run build`、`npx vitest run` 通过。
  - 以下脚本验证口径(在本仓库,先确保存在至少一个已绑定会话的任务):
    - `computeSegmentStats` 对构造事件 09:00、09:30、10:00、11:30、12:00 返回 `activeMs = 1.5h`、`workMs = 3h`(spec A7)。
    - `listTaskSummaries` 返回顺序符合排序规则;从未绑定的任务 `totals === null`。
    - `getTaskReport` 的 `references.concepts` 能识别 `cgraphx docs find --concept=开发任务`(可用构造事件直接调 `collectReferences` 验证;该函数未导出,用 `require('./dist/core/task/artifacts')`)。
- 验证方式:
  ```bash
  npm run build && npx vitest run
  node -e "const {computeSegmentStats}=require('./dist/core/task');const t=h=>({ts:new Date(Date.UTC(2026,9,14,...h)).toISOString(),event_type:'pre_tool_use'});console.log(computeSegmentStats([t([9,0]),t([9,30]),t([10,0]),t([11,30]),t([12,0])]))"
  node -e "require('./dist/core/task').listTaskSummaries(process.cwd()).then(r=>console.log(JSON.stringify(r.map(s=>[s.task.id,s.task.name,s.inProgress,s.totals]),null,1)))"
  node -e "require('./dist/core/task').getTaskReport(process.cwd(), <id>, {eventLimitPerSegment:500}).then(r=>console.log(JSON.stringify({totals:r.totals,outputs:r.outputs,references:r.references,segments:r.segments.map(s=>[s.binding.sessionId.slice(0,8),s.stats,s.events.length,s.hiddenEventCount])},null,1)))"
  ```
- 独立提交:是。`feat(task): 任务报告只读能力——时长口径 + 列表汇总 + 产出与参考派生`
- 风险/注意事项:
  - 读取流程里先关连接再逐段查 timeline,避免同进程同时持有两条连接的锁等待。
  - `commit_files` 相对 git 仓库根;项目根不是仓库根时对不上的会被「不存在」过滤,属已知局限(index 风险表)。
