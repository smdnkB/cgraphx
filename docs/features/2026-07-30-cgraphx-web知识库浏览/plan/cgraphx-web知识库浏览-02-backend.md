# 后端计划: markdown 门面(B-1)+ web 服务基座(B-2)

> 隶属:`cgraphx-web知识库浏览-index.md`(全局契约见 index 第 7 节,本文件任务中重复关键契约原文,自包含可执行)
> feature-id: 2026-07-30-cgraphx-web知识库浏览 · 负责人: liulongfei

---

### T-B-1: markdown 子系统公共门面 + 分页/统计扩展

- **目标**: 补齐 `src/core/markdown/index.ts` 门面(子系统五件套约定中当前缺失的一件),并扩展 `MarkdownQuery` 两个只读方法支撑 web 分页列表与统计条;CLI 行为零变化。
- **对应 spec 条款**: §3.3(列表不静默截断、类型 17 种全集需计数支撑)、§7(CLI 兼容硬契约)、§11 #4/#10;另涉 data-standards「模型层/ORM 映射约定」(Row 不外泄)。implementer 据此读 spec 原文。
- **强制引用**: `docs/guides/coding-standards.md`(边界与结构 / 选型 / 错误与日志)、`docs/guides/data-standards.md`(模型层 / ORM 映射约定)、`docs/guides/testing-standards.md`(Mock 政策与隔离 / 测试描述)。开工前必读。
- **依赖**: 无(批次 1,可与 B-2 并行)。
- **涉及范围**: `src/core/markdown/index.ts`(新建)、`src/core/markdown/query.ts`(提取私有管线 + 新增方法)、`src/core/markdown/types.ts`(新增类型与 FindFilter 复数字段)、`src/core/markdown/frontmatter-parser.ts`(导出/新增 `stripFrontmatter`)、`__tests__/core/markdown/facade.test.ts`(新建)、`__tests__/core/markdown/find-paged.test.ts`(新建)、`__tests__/core/markdown/strip-frontmatter.test.ts`(新建)。
- **必须严格执行**:
  - 门面导出面逐字如下(不增不减;`MarkdownDocumentRow` 等 Row 类型**不得**出现在导出面):
    ```ts
    export { MarkdownQuery } from './query';
    export { openMarkdownDb, MARKDOWN_SCHEMA_VERSION, getCurrentMarkdownSchemaVersion } from './schema-bootstrap';
    export { parseFrontmatter } from './frontmatter-parser';
    export { stripFrontmatter } from './frontmatter-parser';
    export { DOCUMENT_TYPES, DOCUMENT_STATUSES, SOURCE_TYPES, KNOWLEDGE_DIR } from './constants';
    export type { DocumentType, DocumentStatus, SourceType } from './constants';
    export { MarkdownIndexError, SchemaMismatchError, DocumentNotFoundError, ProjectNotInitializedError } from './errors';
    export type { ConceptSummary, DomainSummary, TagSummary, FindFilter, FindPagedResult, KnowledgeStats,
                  DocumentDescriptor, DocumentDetail, ReferenceView, ReferenceTarget } from './types';
    ```
  - `FindFilter` 追加**可选**复数字段(单值字段全部保留,CLI 兼容):`concepts?: string[]; domains?: string[]; tags?: string[]; statuses?: DocumentStatus[]; documentTypes?: DocumentType[]`。语义:维度内 OR(SQL IN 候选集),维度间 AND(候选集求交,沿用现有 Phase 2 交集管线);单值与同维度复数同时出现时,视为该维度两个约束取交(实现上可归一化为复数数组)。非法枚举值 → 该维度返回空候选集(与现有 `status`/`documentType` 非法值返回 `[]` 的行为一致)。
  - 新增类型与方法签名逐字如下:
    ```ts
    export interface FindPagedResult { total: number; items: DocumentDescriptor[]; }

    // MarkdownQuery:
    findPaged(filter: FindFilter,
              opts?: { offset?: number; limit?: number; sort?: 'recency' | 'relevance' | 'title' }): FindPagedResult
    getStats(): KnowledgeStats
    ```
    ```ts
    export interface KnowledgeStats {
      documentCount: number; conceptCount: number; domainCount: number; tagCount: number;
      latestIndexedAt: number | null;                 // SELECT max(indexed_at)
      byType: Record<DocumentType, number>;           // 17 键全在,缺省 0
      byStatus: Record<DocumentStatus, number>;       // 4 键全在,缺省 0
    }
    ```
  - `findPaged` 行为契约:`total` = 分页前匹配总数;`items` = 同一有序列表的 `[offset, offset+limit)` 切片(hydrate 逻辑复用现有 `hydrateDescriptor`,带 q 时保留 `score`);`limit` 缺省 20、钳制 [1,100](沿用 `DEFAULT_LIMIT`/`MAX_LIMIT`);`offset` 缺省 0,`Number.isInteger(offset) && offset >= 0` 守卫,违反抛 `TypeError`(沿用现有 LIMIT 注入边界模式);`sort` 缺省 = 有 q 按相关度(`sortByRelevance`)、无 q 按时间倒序(`sortByRecency`);`sort: 'title'` = title ASC,并列 updated DESC。
  - `DocumentDescriptor` 追加三个**可选**字段(types.ts 接口同步追加;`findPaged` 在 hydrate 阶段填,`find()` **不填**——字段缺省,输出逐字节不变):
    - `referencesCount?: number`(引用数 = 出向 + 入向):对当页 id 集合**一条** IN 聚合查询计数(非 N+1,当页 ≤ limit 条);
    - `owners?: string[]`、`aliases?: string[]`:hydrate 已持有 `MarkdownDocumentRow`,从同行 JSON 列解析(沿用 `hydrateDetail` 的 `parseJsonArray` 模式,零额外查询)。
  - **`find()` 签名与输出逐字节不变**:将现有 find 的候选收集(Phase 1)与求交/排序(Phase 2)提取为私有方法(如 `candidateIds(filter): string[]` + 排序复用现有两个私有排序方法),find 与 findPaged 共用;find 的默认 limit 20/上限 100、无过滤返回全量(按 limit)、非法枚举返回 `[]` 等行为全部保留。
  - `stripFrontmatter(raw: string): string`:去掉文件开头的 `---` … `---` frontmatter 块返回正文;无 frontmatter / frontmatter 未闭合 → 原样返回(与 `parseFrontmatter` 的降级语义一致);实现复用该文件既有块定位逻辑,不新造解析规则。
  - 新代码注释中文;内置导入 `node:` 前缀;不改 CLI(`src/core/markdown/cli.ts` 不动)。
- **允许局部适配**:
  - 私有管线的提取手法与命名;`getStats` 的 SQL 组织(单查询聚合或多查询,性能非关键);复数字段的 IN 子句占位符拼装方式(沿用现有 `checkConceptDedup` 的批量 IN 模式)。
- **具体要求**:
  - 测试(真实栈:`fs.mkdtempSync(os.tmpdir())` 建临时项目,写入带合法 frontmatter 的 .md 文件,跑 `indexMarkdownKnowledgeBase(projectRoot)` 真实索引,`openMarkdownDb` 拿连接构造 `MarkdownQuery`;describe/it 英文;afterEach 清理临时目录):
    - `facade.test.ts`: 断言门面条目可导入且类型正确(编译级 + `typeof` 断言);断言导出面**不含** `MarkdownStore`/`MarkdownDocumentRow`(防 Row 外泄回归)。
    - `find-paged.test.ts` 用例矩阵(≥12 条,标注 spec §3.3):
      1. `total` 等于匹配总数且与 items.length 可不同(造 ≥35 篇文档,limit=30 时 total=35、items=30);
      2. offset 切片正确(page 2 与 page 1 无重叠、合起来等于全量有序集);
      3. 复数 `documentTypes: ['decision','lesson']` = 两类型并集,与分别单值查询结果一致;
      4. 维度间 AND(类型 × 概念组合);
      5. 单值 + 同维度复数共存取交;
      6. 非法枚举值 → 空结果;
      7. `sort: 'title'` 排序正确(含中文标题 localeCompare 不强制,按 SQLite COLLATE 即可,断言稳定性而非具体序);
      8. 有 q 时缺省相关度排序保留;
      9. offset 非整数/负数 → `TypeError`;
      10. limit 超 100 钳制为 100;
      11. 空库 → total=0、items=[];
      12. **CLI 回归基线**:对同一 fixture,重构前后 `find()` 输出一致(以现有 find 相关测试 + 新增快照式断言:同参数 find 输出 JSON 化后与预期逐字段相等);
      13. `referencesCount`:构造含已知引用关系的 fixture(甲→乙),findPaged 结果中甲/乙的计数 = 出+入正确;
      14. `owners`/`aliases`:findPaged 结果含与 fixture frontmatter 一致的 owners/aliases 数组;同参数 `find()` 输出**不含** `referencesCount`/`owners`/`aliases` 键(或为 undefined),证 CLI 面逐字节不变。
    - `strip-frontmatter.test.ts`: 有 frontmatter / 无 / 未闭合 三用例。
  - `getStats` 测试并入 `facade.test.ts`:计数与 fixture 一致;`byType` 含全部 17 键(未出现类型为 0);`byStatus` 含 4 键;空库 `latestIndexedAt` 为 null。
- **完成条件**:
  - `npx vitest run __tests__/core/markdown/` 全绿(含全部既有测试文件——这是 CLI 兼容的回归基线);
  - `npx tsc --noEmit` 无错;
  - `node dist/cli/index.js docs concepts`(先 `npm run build`)在未初始化目录与已初始化目录的行为与改动前一致(手工抽查一次)。
- **验证方式**: 上述测试命令 + 手工抽查命令;验证输出贴入任务回报。
- **独立提交**: 是。完成后仓库可工作(门面为纯新增 + 内部重构,CLI 不变)。建议 commit subject:`feat(markdown): 补 docs 子系统公共门面——findPaged 分页 + getStats 统计`;body 一行背景 +「-」列要点(门面导出面 / findPaged / getStats / stripFrontmatter / 复数过滤字段);尾行 `Co-Authored-By: Claude <noreply@anthropic.com>`。提交前过 index 第 9 节检查点。
- **风险/注意事项**:
  - 提取私有管线时最易改变 find 输出(排序 tie-break、limit 语义)——先跑基线全绿再动手,改完立即回归;
  - `byType` 的 Record 需由 `DOCUMENT_TYPES` 常量全键初始化(不能只放 DB 出现的键),否则页面 17 芯片缺键;
  - 门面导出 `openMarkdownDb` 是为子系统门面完整性(它确实应用 schema——**web 侧禁用**,该约束在 B-2 契约中,不在本任务)。

---

### T-B-2: web 服务基座——node:http 服务器、启动预检、命令注册、资产清单

- **目标**: 落地 `cgraphx web` 命令与本地只读 HTTP 服务骨架:回环绑定、启动预检(未初始化/schema 缺失/端口占用)、进程级 DB 单连接与优雅退出、路由骨架(占位首页/`/timeline` 占位/静态资产/404/500)、`src/web/public/` 资产经 copy-assets 随包分发。页面内容由 B-3/B-4 填充。
- **对应 spec 条款**: §3.1(启动与访问)、§3.2(应用壳与全局——本任务落路由/错误态骨架,壳视觉在 B-3)、§4.1(只读数据访问)、§5.1(localhost 边界)、§6(命令接口/依赖边界)、§8(启动类异常)、§11 #1/#3/#6/#8/#9/#12。implementer 据此读 spec 原文。
- **强制引用**: `docs/guides/coding-standards.md`(边界与结构 / 选型 / 错误与日志)、`docs/guides/interface-standards.md`(命令注册 / 输出 / 退出码)、`docs/guides/testing-standards.md`(Mock 政策与隔离 / 测试描述)。开工前必读。
- **依赖**: 无(批次 1,可与 B-1 并行;不依赖门面——schema 存在性检查走 sqlite_master 直查)。
- **涉及范围**: `src/web/index.ts`(改写占位为门面导出)、`src/web/register.ts`、`src/web/server.ts`、`src/web/bootstrap.ts`、`src/web/errors.ts`、`src/web/render-utils.ts`(escapeHtml + 最小 html 辅助,占位页即用)、`src/web/public/`(空目录占位或最小 `app.css`——完整样式在 B-3)、`src/cli/index.ts`(一处 import + 一处注册)、`scripts/copy-assets.cjs`(登记 public)、`__tests__/web/server.test.ts`(新建)。**不动** `package.json`(本任务零新依赖)。
- **必须严格执行**:
  - **分层**: `src/web/**` 只 import `../core/**` 与 `node:` 内置;`src/cli/index.ts` 允许 `import { registerWebCommand } from '../web'`(index 第 4 节已记录的组合根例外,**仅此一处**)。
  - `src/web/index.ts` 门面导出逐字:
    ```ts
    export { registerWebCommand } from './register';
    export { startWebServer } from './server';
    export type { WebServer } from './server';
    export { WebError, WebStartupError, exitCodeForWebError } from './errors';
    ```
    `WebServer` = `{ url: string; close(): Promise<void> }`。
  - 命令注册(`register.ts`):`program.command('web [project-path]').description('Start the local read-only web viewer (knowledge base)').option('-p, --port <port>', 'port to listen on (default 2468)', '2468')`;action 内:projectRoot = `path.resolve(pathArg ?? process.cwd())`;port 解析(`Number(portRaw)` + `Number.isInteger` + [1,65535],端口 0 仅测试经 `startWebServer` 直传使用,CLI 层拒绝 0),非法 → stderr `[web] invalid port ...` + exitCode 1;`try { const srv = await startWebServer({projectRoot, port}); console.log(`cgraphx web running at ${srv.url}`) } catch (err) { process.stderr.write(`[web] ${msg}\n`); process.exitCode = exitCodeForWebError(err); }`(禁字面量退出码散落——interface-standards)。
  - **启动预检序列**(契约,顺序固定,`bootstrap.ts` + `server.ts` 协作):
    1. `isInitialized(projectRoot)` 假 → `WebStartupError { kind: 'uninitialized' }`,消息:`project at <resolved> is not initialized — run \`cgraphx install\` to set up .cgraphx/ and schemas`;
    2. `DatabaseConnection.open(getDatabasePath(projectRoot))`(进程级单连接;DB 已确保存在,open 不会创建);**绝不**调用 `ensureMarkdownSchema` / `ensureTimelineSchema`;
    3. `SELECT name FROM sqlite_master WHERE type='table' AND name IN ('markdown_schema_versions','timeline_schema_versions')` → 缺失集合非空 → `WebStartupError { kind: 'schema-missing', missing }`,消息点名 `markdown`/`timeline` + `run \`cgraphx install\` to apply schemas`;
    4. `createServer(handler).listen(port, '127.0.0.1')`;`'error'` 且 `err.code === 'EADDRINUSE'` → `WebStartupError { kind: 'port-in-use', port }`,消息:`port <port> is already in use — use --port <port> to specify another port`。
  - `exitCodeForWebError(err: unknown): number`:`uninitialized` → 2、`schema-missing` → 2、`port-in-use` → 1、其他 → 1(沿用 `status` 未初始化退出码 2 的先例)。
  - 绑定地址**仅 `127.0.0.1`**(字面量,不做 host 参数——安全契约,spec §5.1);`url` = `http://127.0.0.1:<actualPort>`(port 0 时取 `server.address()` 实际端口)。
  - 生命周期:`close()` 关 http server + 关 DB 连接;进程级 SIGINT/SIGTERM 处理在 `register.ts` 装配(`await srv.close(); process.exit(0)`);`startWebServer` 本身不注册信号(测试友好)。
  - 路由骨架(`server.ts`,表驱动或 switch 均可):
    | 方法 + 路径 | 本任务行为 |
    |---|---|
    | `GET /` | 占位页:壳骨架 + 「知识库页面实现中(B-3)」+ cgraphx 版本(版本号运行时读 `path.join(__dirname, '..', '..', 'package.json')`,与 cli/index.ts 同源同机制) |
    | `GET /timeline` | 占位页:「开发时间线属平行需求,尚未实现(feature-id: 2026-07-30-cgraphx-web时间线浏览)」 |
    | `GET /assets/<file>` | 从 `path.join(__dirname, 'public')` 提供;**路径穿越防护**:`path.resolve` 后校验仍在 public 根内,否则 404;Content-Type 按扩展名(css/js/svg/woff2,最小表),其余 404 |
    | 其他 | 404 页(可读文案 + 回 `/` 链接) |
    | 处理器抛错 | 500 页(可读错误原因,**禁输出堆栈**) |
  - `render-utils.ts` 导出 `escapeHtml(s: string): string`(转义 `& < > " '`);所有插值(版本、路径、错误消息)过 escapeHtml——占位页即执行此约束。
  - **只读契约**: web 进程内除 bootstrap 的 sqlite_master 查询外仅 SELECT;不调任何 store 写入方法、不调 ensure*Schema、不创建文件。
  - `copy-assets.cjs`:新增 `src/web/public/` → `dist/web/public/` 递归拷贝(沿用现有 `walk` 函数 + `SKIP_NAMES`),更新文件头注释清单;public 目录不存在时静默跳过(与 claude-template 同模式)。
  - 新代码注释中文;`node:` 前缀;终端着色手写 ANSI(禁 chalk);错误消息带修复提示(coding-standards)。
- **允许局部适配**:
  - 路由分发器内部结构;静态资产 Content-Type 表的具体条目;500/404 页版式(信息要素固定);bootstrap 逻辑在 `bootstrap.ts` 与 `server.ts` 间的切分;信号处理的装配细节。
- **具体要求**:
  - 测试 `__tests__/web/server.test.ts`(真实栈,禁 vi.mock;describe/it 英文;标注 spec 条款):
    - fixture 助手:`mkdtempSync` 建临时项目;「已初始化」= `createDirectory(projectRoot)`(directory.ts)+ `DatabaseConnection.open` + `ensureMarkdownSchema` + `ensureTimelineSchema`(测试里允许调——这是构造 fixture,不是 web 行为)+ close;
    - 用例:
      1. 已初始化项目:`startWebServer({projectRoot, port: 0})` 成功;`fetch(srv.url)` 200 且含占位文案;`fetch(url + '/timeline')` 200 含平行需求文案;`fetch(url + '/nope')` 404;(spec §3.1/§3.2)
      2. **回环绑定断言**:server 内部地址为 `127.0.0.1`(经 `WebServer` 暴露或 fetch `http://127.0.0.1:<port>` 成功即证;断言 url 以 `http://127.0.0.1:` 开头)(spec §5.1)
      3. 未初始化目录 → 抛 `WebStartupError`、`kind === 'uninitialized'`、`exitCodeForWebError` === 2、消息含 `cgraphx install`(spec §3.1/§11 #9)
      4. 有 DB 但无 timeline schema(只建 markdown)→ `kind === 'schema-missing'`、`missing` 含 `'timeline'`、退出码 2(spec §3.1)
      5. 端口占用:先占一个固定端口(测试内 net.createServer listen 0 拿到后复用其端口号启动占用 server),`startWebServer` 指同端口 → `kind === 'port-in-use'`、消息含 `--port`、退出码 1(spec §3.1)
      6. **只读断言**:对已初始化 fixture,记录 `markdown_documents` / `timeline_events` 行数,发起 `/` + `/timeline` + `/assets/x.css`(404)+ 404 共 5 个请求后行数不变(spec §4.1/§11 #3)
      7. `close()` 后再 fetch 失败(连接关闭)(生命周期)
    - afterEach:关闭所有 server 与连接、`rmSync(tmp, {recursive:true, force:true})`。
- **完成条件**:
  - `npx vitest run __tests__/web/` 全绿;`npx tsc --noEmit` 无错;
  - `npm run build` 成功且 `dist/web/public/` 镜像存在(copy-assets 日志可见);
  - 手工冒烟:临时目录 `cgraphx install` 等价操作不便时,直接在本仓库(已初始化)`node dist/cli/index.js web` → 终端打印地址、浏览器(或 curl)访问 200、`--port` 指定被占端口报错正确、Ctrl-C 优雅退出。
- **验证方式**: 测试命令 + build + 手工冒烟命令序列;输出贴入任务回报。
- **独立提交**: 是。建议 commit subject:`feat(web): cgraphx web 服务基座——本地回环 HTTP、启动预检、命令注册`;body 列:node:http 骨架 / 预检四步 / 退出码映射 / copy-assets 登记 / cli wiring(组合根例外见 plan)。尾行 Co-Authored-By。提交前过 index 第 9 节检查点(尤其:public 已登记 copy-assets;cli→web import 仅 wiring 一处;无魔法值——端口默认值在 commander 默认参数中以字符串 '2468' 声明,属配置声明不是散落魔法值)。
- **风险/注意事项**:
  - `DatabaseConnection.open` 会创建 DB 文件——预检第 1 步(`isInitialized`)必须先于 open,顺序颠倒即违反只读契约;
  - EADDRINUSE 需在 `listen` 的 `'error'` 事件捕获(不是 try/catch 同步捕获);Promise 化 listen 时注意 reject 语义;
  - 静态资产路径穿越:`/assets/..%2f..%2fpackage.json` 类请求必须被 resolve 后根校验拦截;
  - SIGINT 处理在 register.ts 装配,`startWebServer` 保持纯净(否则测试间信号处理器泄漏)。
