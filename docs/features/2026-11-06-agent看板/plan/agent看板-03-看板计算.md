# T-3: 看板计算

> 产物: plan
> 依据: spec@90c1887

- 目标: 建成 `src/core/board/` 子系统的数据侧——timeline 新增看板只读查询,board 以纯函数认任务(K8–K11)、按口径装配项目/任务/会话数据,产出 C-6 的 `BoardData`;顺带把「没能补录」的提示映射与 K1 需要的文件清单导出落好。
- 对应 spec 编号: F1(K1、K2、K3、K12、K13、K14、边界④⑤)、F2(K4、K6)、F4(K8–K11)、D5、D6、D7、D10、D14、验收 6、7。
- 强制引用: `docs/guides/coding-standards.md`(动代码;「门面是硬约定」「子系统标准形态」为本任务的主约束)。
- 涉及范围: `src/core/timeline/board-read.ts`(新)、`src/core/timeline/types.ts`、`src/core/timeline/index.ts`、`src/core/features/index.ts`、`src/core/board/types.ts`、`src/core/board/constants.ts`、`src/core/board/errors.ts`、`src/core/board/match.ts`、`src/core/board/compute.ts`、`src/core/board/index.ts`(board 七个均为新文件)。
- 必须严格执行:
  - 按 C-5(只读查询与列集合)、C-6(BoardData 形状)、C-9(项目枚举)、C-10(任务认定)、C-11(认任务规则与依据文案)、C-12(时间窗与列表口径)、C-13(提示映射)。
  - D1 🔒:board 只 import 五个门面(project、timeline、features、replica、agents)+ 基础层(`session-index`、`root-match`、`db` 类型等),不 import 任何子系统的内部模块。
  - 不写绑定:匹配每次现算,纯函数,不落任何库表(D14)。
  - `session-index.ts` 不改(D10):fileExists 用现有 `listSessionFiles(agent)` 按来源聚合。
  - `describeSyncOutcome` 不改(D7):board 单写 C-13 的映射。
- 允许局部适配:
  - `match.ts`/`compute.ts` 内部函数拆分与命名;正则与 SQL 具体写法(列集合不变);`board/errors.ts` 的错误类命名(沿用 `XxxError` + `exitCodeForError` 形态)。
  - 任务行/会话行的去重细节(同一会话在同一任务的多个命中合并依据)。
- 具体要求:
  1. `timeline/board-read.ts` + 门面导出:`readTimelineBoardData(dataDir)` 按 C-5(只读打开、列集合、json_valid 守卫的 json_extract、commit_files 读取侧解析成 `string[]`、ts 升序;库不在 → null;`timeline_events`/`timeline_session_titles` 表不在对应数组按空)。`BoardTimelineData` 类型放 `timeline/types.ts`。
  2. `features/index.ts`:从 scanner 导出 `listFeatureFiles`(一行导出,供 C-10 的 K1 判定)。
  3. `board/types.ts`:C-6 的 `BoardData`/`BoardProject`/`Task`/`Session` 与内部计算类型;`board/constants.ts`:30 天阈值、`docs/features/` 路径段、K1 文件名正则、依据文案等常量;`board/errors.ts`:BoardError 层级。
  4. `board/match.ts`:纯函数,输入输出按 C-11(含 K8 参与判定、K9 六条定挂、K10 两条可能相关、依据文案、dirLabel);`session_start` 事件的 startCwd 为会话开始目录。
  5. `board/compute.ts`:编排——listProjects 分组与目录归并(C-9)、逐项目补录调用外的数据装配(补录本身由 CLI 侧触发,compute 只读)、任务认定(C-10)、匹配调用、K6/K12 口径、K3 未归类、K5 标题(titles 表 → 第一条 user_prompt 前 40 字 → `-`)、fileExists(sessions.db 聚合)、C-13 提示映射、项目/任务/会话排序;产出 `BoardData`。
  6. `board/index.ts` 门面:导出 `computeBoardData`、类型与错误;外部(cli、server)只经此门面。
  7. 补录的调用点:门面另导出 `syncProjects(): Promise<Array<{ 项目组, outcome }>>` 之类的薄封装(内部逐组 `ensureTimelineUpToDate`,串行,C-9 的取目录规则),供 CLI 启动与刷新共用——具体签名可局部适配,但补录不进 compute 的纯读路径。
- 完成条件:
  - `npm run build` 零错误;`npm test` 全量通过。
  - 临时 HOME 造一个小项目(一个主目录 + 一个副本登记 + 少量会话文件与事件)或直接以本机数据只读跑:`node -e` 调 `computeBoardData` 能产出结构完整、排序正确的 `BoardData`,K9 的六条依据与 K10 各至少出现一次(冒烟核对,不新建测试文件)。
  - 本机项目从补录完到 `BoardData` 算完 < 1 秒(验收 7;`console.time` 粗测)。
- 提交点:
  1. `feat(board): 看板计算——项目枚举、认任务、会话归属`:本任务全部 10 个文件。
- 风险/注意事项:
  - `listProjects()` 会算目录大小(慢):spec D5 影响面已提示——board 侧不额外触发更多 IO,项目数大时如明显变慢,可在任务交付说明里记录,不改 listProjects 契约。
  - 标题/路径一律原文比较(含 `-`、`_`),不做任何归一化(D14 影响面)。
  - Windows 路径会话不参与:依赖 `createRootMatcher` 的 `path.isAbsolute` 语义即可,不另写判定(验收 6 交给后续单元测试)。
  - 单文件 600 行:`compute.ts` 与 `match.ts` 各自接近上限时先拆内部模块。
