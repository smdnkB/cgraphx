# 后端计划: UI测试报告改xlsx

> 上级:`UI测试报告改xlsx-index.md` · spec:`../UI测试报告改xlsx-spec.md`

## 共享契约(T-1 输出 = T-2 输入，逐字一致)

`src/core/report/constants.ts`:

```ts
export const UI_TEST_SCHEMA_VERSION = 1;
export const UI_TEST_RESULTS = ['通过', '失败-预期不符', '失败-元素缺失', '失败-环境', '失败-登录', '跳过'] as const;
export const UI_TEST_FAILURE_RESULTS = ['失败-预期不符', '失败-元素缺失', '失败-环境', '失败-登录'] as const;
export const RUN_MODES = ['headed', 'headless'] as const;
export const UI_TEST_RESULT_SUFFIX = '-ui功能测试结果.json';
export const UI_TEST_REPORT_XLSX_SUFFIX = '-ui功能测试报告.xlsx';
export const UI_TEST_REPORT_MD_SUFFIX = '-ui功能测试报告.md';
export const SCREENSHOT_THUMB_HEIGHT_PX = 180;
export const SCREENSHOT_GAP_PX = 8;
```

`src/core/report/types.ts`:

```ts
export type UiTestResultValue = (typeof UI_TEST_RESULTS)[number];
export type RunMode = (typeof RUN_MODES)[number];

export interface UiTestCase {
  index: number;
  featurePoint: string;
  steps: string[];
  expected: string[];
  actual: string;            // 缺省或 null 规范化为 ''
  result: UiTestResultValue;
  reachedStep: number | null; // 缺省规范化为 null
  note: string;              // 缺省或 null 规范化为 ''
  screenshots: string[];
}

export interface UiTestResultFile {
  schemaVersion: number;
  featureId: string;
  executedAt: string;
  mode: RunMode;
  entryUrl: string;
  cases: UiTestCase[];
}

export interface ImageInfo { format: 'png' | 'jpeg'; width: number; height: number; }

export interface LoadedScreenshot { relPath: string; data: Buffer; info: ImageInfo; }

export interface LoadedUiTestResult {
  jsonPath: string;          // 绝对路径
  dir: string;               // JSON 所在目录(绝对路径)
  prefix: string;            // 文件名去掉 UI_TEST_RESULT_SUFFIX
  result: UiTestResultFile;
  screenshots: LoadedScreenshot[][]; // 与 result.cases 同下标、同顺序
}

export interface ValidationIssue { caseIndex: number | null; message: string; }

export interface UiTestSummary {
  total: number; passed: number; failed: number; skipped: number;
  passRate: string;                                  // 如 '33.3%'
  failedByType: Record<(typeof UI_TEST_FAILURE_RESULTS)[number], number>;
}

export interface UiTestReportOutcome {
  xlsxPath: string;
  removedMdPath: string | null;
  summary: UiTestSummary;
}
```

`src/core/report/errors.ts`:`ReportError extends Error`;`ReportArgError extends ReportError`;`ReportValidationError extends ReportError`,带只读字段 `issues: ValidationIssue[]`。

---

### T-1: report 子系统骨架 + JSON 校验器 + 图片识别

- 目标:实现 spec §3 契约的严格校验和截图读取。一次运行收集全部问题
- 对应 spec 条款:§2、§3.1–§3.3、§4.2
- 强制引用:`coding-standards.md`
- 依赖:无
- 涉及范围(全部新增):`src/core/report/constants.ts`、`types.ts`、`errors.ts`、`image.ts`、`ui-test-result.ts`、`index.ts`(本任务只导出类型、常量、错误和 `loadUiTestResult`)
- 必须严格执行:
  - 上方「共享契约」的常量、类型、错误类原文照抄
  - `loadUiTestResult(jsonPath: string): LoadedUiTestResult`。`jsonPath` 先按 `path.resolve` 转为绝对路径;文件名不以 `UI_TEST_RESULT_SUFFIX` 结尾时抛 `ReportArgError`,消息为 `输入文件名须以 -ui功能测试结果.json 结尾:<文件名>`
  - 其余问题一律收集为 `ValidationIssue[]`,最后有问题就抛一次 `ReportValidationError`。消息为 `结构化结果校验未通过(N 项)`,issues 携带全部问题。校验分层短路：文件读不到或 JSON 解析失败时，只报这一条;顶层不是对象时，只报这一条;其余字段级问题全部收集
  - 校验项(对应 spec §4.2,`caseIndex` 取该用例的 `index`,取不到时取数组位置 +1):
    1. 文件不存在 → `找不到文件:<路径>`;JSON 非法 → `无法解析 JSON:<原生错误消息>`
    2. `schemaVersion !== UI_TEST_SCHEMA_VERSION` → `不支持的 schemaVersion:<值>(本命令支持 1)`
    3. 顶层 `featureId` / `executedAt` / `entryUrl` 为非空字符串;`mode` ∈ `RUN_MODES`;`cases` 为非空数组
    4. `executedAt` 匹配 `^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})$`
    5. 每条用例：`index` 为 ≥1 的整数且不重复;`featurePoint` 非空字符串;`steps` / `expected` 为字符串数组且至少 1 项;`result` ∈ `UI_TEST_RESULTS`(否则 `未知结果 "<值>"`);`reachedStep` 为 ≥1 的整数、`null` 或缺省;`actual` / `note` 为字符串、`null` 或缺省;`screenshots` 为字符串数组(允许空)
    6. 视结果必填(spec §3.3):`result` 为 `通过` 或四种失败之一时,`actual` 去掉首尾空白后非空;`跳过` 时 `note` 去掉首尾空白后非空(`用例 N:跳过须填写 note`)
    7. 截图：按 `path.resolve(dir, rel)` 读文件;不存在 → `截图不存在:<rel>`;存在时交给 `readImageInfo`,返回 `null` → issue `截图不是 PNG/JPEG 图片:<rel>`(spec §4.2,P1 已确认)
  - `readImageInfo(data: Buffer): ImageInfo | null`(image.ts):PNG 校验 8 字节签名，宽高读 IHDR(偏移 16 / 20,大端 uint32);JPEG 校验 `FF D8`,顺序扫描段，遇到 SOF0–SOF15(排除 C4 / C8 / CC)时读高(+5)和宽(+7);其余返回 `null`
  - 校验通过后的规范化：缺省或 `null` 的 `actual` / `note` → `''`,缺省的 `reachedStep` → `null`
- 允许局部适配:内部辅助函数拆分;错误消息措辞(须含用例序号和字段名)
- 具体要求:
  - 用例级消息格式统一为 `用例 <caseIndex>:<问题>`。消息由 CLI 拼接,issue 里只存 `caseIndex` 和问题本身
  - 不依赖 `.cgraphx/`,不 import 其它子系统
- 完成条件:`npm run build` 通过;`npx vitest run` 全绿(既有测试)
- 验证方式:在 scratchpad 写临时脚本 `node -e "require('./dist/core/report').loadUiTestResult('<路径>')"`,分别喂入 spec §3.4 示例(截图齐全)、缺 `steps` + 非法 `result` + 缺截图的组合样本，确认前者返回规范化对象，后者 issues 恰好 3 条
- 独立提交:是。新增的模块暂时没有调用方，但能编译，测试不红;主题 `feat(report): UI 测试结构化结果校验——report 子系统骨架 + 图片识别`
- 风险/注意事项:`noUncheckedIndexedAccess` 下 Buffer 下标访问要处理 `undefined`(建议用 `readUInt32BE` / `readUInt16BE`)

### T-2: xlsx 写出器 + UI 报告映射 + 门面 + CLI 接线

- 目标:`cgraphx report ui-test <JSON>` 端到端可用
- 对应 spec 条款:§4.1、§4.2(输出语义)、§5.1、§5.2、§8(删除旧 md)、§10 #1–#7、#9
- 强制引用:`coding-standards.md`、`interface-standards.md`
- 依赖:T-1(使用其原样导出的 `loadUiTestResult`、类型和常量)
- 涉及范围:新增 `src/core/report/xlsx/zip.ts`、`src/core/report/xlsx/workbook.ts`、`src/core/report/ui-test-workbook.ts`、`src/core/report/cli.ts`;修改 `src/core/report/index.ts`、`src/cli/index.ts`
- 必须严格执行:
  - **zip.ts**:`buildZip(entries: { name: string; data: Buffer }[]): Buffer`。每个条目用 `zlib.deflateRawSync` 压缩(method 8),`zlib.crc32` 算 CRC;依次写 local file header、数据、central directory、EOCD;修改时间固定为 1980-01-01 00:00(保证输出可复现);通用标志位 bit 11(UTF-8)置 1
  - **workbook.ts**(与 UI 测试无关的通用写出器):
    ```ts
    export type CellStyle = 'default' | 'header' | 'wrap' | 'pass' | 'fail' | 'skip';
    export interface Cell { value: string | number; style?: CellStyle; }
    export interface SheetImage { row: number; col: number; offsetXPx: number; widthPx: number; heightPx: number; data: Buffer; format: 'png' | 'jpeg'; } // row/col 从 0 起
    export interface Sheet { name: string; columnWidths: number[]; rows: { cells: Cell[]; heightPt?: number }[]; freezeHeader: boolean; autoFilter: boolean; images: SheetImage[]; }
    export interface Workbook { sheets: Sheet[]; }
    export function writeWorkbook(wb: Workbook): Buffer;
    ```
    产出部件:`[Content_Types].xml`(Default png / jpeg / xml / rels;Override 列出 workbook、各 sheet、styles、有图片的 drawing)、`_rels/.rels`、`xl/workbook.xml`、`xl/_rels/workbook.xml.rels`、`xl/styles.xml`、`xl/worksheets/sheetN.xml`、有图片时加 `xl/worksheets/_rels/sheetN.xml.rels`、`xl/drawings/drawingN.xml`、`xl/drawings/_rels/drawingN.xml.rels`、`xl/media/imageK.(png|jpeg)`
    - 字符串单元格用 `t="inlineStr"`,数字用 `<v>`;XML 转义 `& < > " '`,并去掉 XML 1.0 非法控制字符
    - 字符串里的 `\n` 原样保留,`wrap` / `pass` / `fail` / `skip` 样式都开启 `wrapText`,垂直对齐 top
    - styles:`header` 加粗 + 浅灰底;`pass` 底色 `FFC6EFCE`;`fail` 底色 `FFFFC7CE`;`skip` 底色 `FFD9D9D9`
    - `freezeHeader` → `<pane ySplit="1" topLeftCell="A2" state="frozen"/>`;`autoFilter` → 覆盖表头到最后一行的 `<autoFilter ref>`
    - 图片：每张图生成一个 `xdr:oneCellAnchor`,`from` 为 (col, row),colOff = offsetXPx × 9525 EMU,`ext` = 宽高 × 9525
    - 有 `heightPt` 的行写 `ht` 和 `customHeight="1"`
  - **ui-test-workbook.ts**:
    - `summarizeCases(cases: UiTestCase[]): UiTestSummary`:失败 = 四种失败状态之和;`passRate` = `(passed / total * 100).toFixed(1) + '%'`
    - `buildUiTestWorkbook(loaded: LoadedUiTestResult): Workbook`,按顺序生成两个工作表:
      - 「汇总」:两列(项 / 值),表头 `header` 样式;行依次为 需求、执行时间、运行模式、入口 URL、总数、通过、失败、跳过、通过率、失败-预期不符、失败-元素缺失、失败-环境、失败-登录。执行时间直接从 `executedAt` 字符串截取 `YYYY-MM-DD HH:mm`(用它自带的时区，不做换算);运行模式 `headed` → `headed`,`headless` → `无头`;计数写数字
      - 「用例」:表头依次为 序号、功能点、操作步骤、预期表现、实际表现、结果、执行到、备注、截图;`freezeHeader` 与 `autoFilter` 为 true;操作步骤 = `steps.map((s, i) => \`${i + 1}. ${s}\`).join('\n')`;预期表现 = `expected.join('\n')`;执行到 = `reachedStep` 有值时为 `步骤 N`,否则 `—`;结果列样式按值取 `pass` / `fail` / `skip`,其余文本列用 `wrap`
      - 截图：放在「截图」列(col 8),每张图的高度为 `SCREENSHOT_THUMB_HEIGHT_PX`,宽度按原图比例缩放，从左到右依次排开，间距 `SCREENSHOT_GAP_PX`;有截图的行 `heightPt = (SCREENSHOT_THUMB_HEIGHT_PX + SCREENSHOT_GAP_PX) * 0.75`
      - 列宽(字符):6、16、40、36、36、14、10、30、48
  - **index.ts 门面**:新增 `generateUiTestReport(jsonPath: string): UiTestReportOutcome`,步骤为：调用 `loadUiTestResult` → `buildUiTestWorkbook` → `writeWorkbook` → 写入 `<dir>/<prefix>-ui功能测试报告.xlsx.tmp-<pid>`,再 `renameSync` 到 `<dir>/<prefix>${UI_TEST_REPORT_XLSX_SUFFIX}` → 若 `<dir>/<prefix>${UI_TEST_REPORT_MD_SUFFIX}` 存在则 `unlinkSync`,并记入 `removedMdPath`。写入失败时删除临时文件后再抛出
  - **cli.ts**:`export function registerReportCommands(program: Command): void`,注册 `report` 命令组和子命令 `ui-test <resultJson>`,带 `--json` 开关
    - 成功(文本):stdout 输出 `已生成 <xlsxPath>`、`共 N 条:通过 a · 失败 b · 跳过 c`,有旧 md 时再加 `已删除旧报告 <removedMdPath>`
    - 成功(`--json`):stdout 输出 `{"ok":true,"xlsxPath":…,"removedMdPath":…,"summary":{…}}`
    - `ReportValidationError`(文本):stderr 先输出 `[report] 结构化结果校验未通过(N 项)`,再逐条输出 `[report]   用例 <caseIndex>:<message>`(`caseIndex` 为 null 时省略「用例」前缀),最后一行 `[report] 修正 <jsonPath> 后重新执行 cgraphx report ui-test <jsonPath>`
    - `ReportValidationError`(`--json`):stdout 输出 `{"ok":false,"errors":[{"case":N|null,"message":…}]}`
    - 其它错误：stderr 输出 `[report] <message>`
    - `exitCodeForError`:`ReportValidationError` → 2,`ReportArgError` → 3,其它 → 1
  - **src/cli/index.ts**:在 `registerTaskCommands(program);` 之后加一行 `registerReportCommands(program);`,import 写在 `registerTaskCommands` 的 import 下面
- 允许局部适配:XML 的拼装方式;workbook.ts 超过 600 行时在 `xlsx/` 内拆分;header 浅灰的具体色值;图片在单元格内的上 / 左留白(≤ 8px)
- 完成条件:`npm run build` 通过;`npx vitest run` 全绿;下列验证全部通过
- 验证方式(样本放在 scratchpad):
  1. 用 spec §3.4 示例作为 `示例-ui功能测试结果.json`,配 3 张真实 PNG(可从 `other_docs/images/` 复制并重命名为 `新建客户.png` / `编辑客户.png` / `编辑客户-2.png`),执行 `node dist/cli/index.js report ui-test <路径>`,退出码 0
  2. `python3 -c "import openpyxl as o; wb=o.load_workbook('<xlsx>'); print(wb.sheetnames, [[c.value for c in r] for r in wb['汇总'].iter_rows()], len(wb['用例']._images), wb['用例'].freeze_panes, wb['用例'].auto_filter.ref)"`,期望输出:`['汇总','用例']`、汇总中 总数 3 / 通过 1 / 失败 1 / 跳过 1 / 通过率 33.3% / 失败-预期不符 1、图片 3 张、`A2`、`A1:I4`
  3. `soffice --headless --convert-to pdf --outdir <scratchpad> <xlsx>` 成功，生成的 PDF 中能看到截图;再用 WPS 打开，确认没有修复提示(人工，需截图留证)
  4. 把 xlsx 单独复制到其它目录后打开，截图仍在(spec §10 #2)
  5. 删除一张截图，同时把一条用例的 `result` 改成 `失败`:退出码 2,stderr 同时列出 2 条问题，第 1 步生成的 xlsx 的 mtime 不变
  6. 在同目录放一个 `示例-ui功能测试报告.md`,重新生成：md 被删除，输出含「已删除旧报告」;再重复第 5 步的错误样本:md 不会被删(spec §10 #4 / #5)
  7. 把文件名改成 `结果.json` 后执行，退出码 3
  8. `--json` 模式下成功和失败各执行一次，输出可以被 `JSON.parse` 解析
  9. 在 `/tmp` 下没有 `.cgraphx` 的目录里执行，正常生成(spec §10 #7)
- 独立提交:是;主题 `feat(report): report ui-test 生成 xlsx——自写 OOXML + zip,零依赖`
- 风险/注意事项:
  - 工作表名「汇总」「用例」是中文,`workbook.xml` 要按 UTF-8 写入
  - JPEG 在 Content_Types 里的扩展名是 `jpeg`,media 文件名要和 Default Extension 一致
  - 如果某个打开方不认 inlineStr,按 PLAN_CONFLICT 上报，不要自行改用 sharedStrings

### T-3: 阶段派生识别 `.xlsx`

- 目标:`ui功能测试/*-ui功能测试报告.xlsx` 也能派生出「已验证」
- 对应 spec 条款:§7
- 强制引用:`coding-standards.md`
- 依赖:无
- 涉及范围:`src/core/features/scanner.ts`(只改 `hasUiTestReport` 及其上方注释，以及 `deriveStage` 文档注释里的 UI 报告描述)
- 必须严格执行:
  - 判定条件改为 `n.endsWith('-ui功能测试报告.md') || n.endsWith('-ui功能测试报告.xlsx')`
  - 不 import report 子系统，直接写字面量
  - JSON、截图、用例规格都不参与判定
- 允许局部适配:注释措辞
- 完成条件:`npm run build` 通过;`npx vitest run __tests__/core/features` 全绿
- 验证方式:在 scratchpad 建一个临时项目，按 spec §7 表格的三种目录内容分别建需求目录，执行 `node <repo>/dist/cli/index.js features list --json`(cwd 为临时项目),确认阶段依次为 已验证 / 已验证 / 已规格
- 独立提交:是;主题 `feat(features): 阶段派生识别 xlsx UI 测试报告`
- 风险/注意事项:无
