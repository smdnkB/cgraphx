# 前端计划: 知识库总览页(B-3)+ 文档详情页(B-4)

> 隶属:`cgraphx-web知识库浏览-index.md`(全局契约见 index 第 7 节;本文件任务重复关键契约原文,自包含可执行)
> 形态:服务端渲染 HTML + 极少 JS(index 第 4 节已拍板)。本文件「前端」= TS 模板函数 + 静态 css/js,无框架、无构建。
> feature-id: 2026-07-30-cgraphx-web知识库浏览 · 负责人: liulongfei

---

### T-B-3: 应用壳 + 知识库总览页(五维筛选 / 列表 / 分页 / 统计条)

- **目标**: 替换 B-2 的 `/` 占位,交付壳布局(侧栏导航 + 顶栏只读标识)与知识库总览页:五维多选筛选面板、激活筛选 pill、统计条、文档卡列表、排序、服务端分页、空状态;视觉按设计稿定稿。
- **对应 spec 条款**: §3.2(应用壳)、§3.3(总览页全部行为)、§4.2(新鲜度呈现)、§8(空库/0 匹配空态)、§11 #4(类型状态全集)/#5(索引时间可见)/#10(不静默截断)/#12(导航三入口)。implementer 据此读 spec 原文。
- **强制引用**: `docs/guides/coding-standards.md`(选型:禁 chalk / 中文注释 / 600 行拆分;边界与结构:门面消费)、`docs/guides/testing-standards.md`(Mock 政策与隔离 / 测试描述)、`docs/guides/interface-standards.md`(退出码形态——页面错误经基座 500 页,不新造退出路径)。开工前必读。
- **依赖**: T-B-1(门面 `MarkdownQuery.findPaged` / `getStats` / `listDomains` / `listConcepts` / 常量)、T-B-2(服务器/路由表/基座错误页/`render-utils.ts`/public 资产机制)。
- **涉及范围**: `src/web/layout.ts`(壳模板)、`src/web/pages-overview.ts`(总览页模板 + 视图模型组装)、`src/web/constants.ts`(标签映射/页大小)、`src/web/public/app.css`(全站样式)、`src/web/public/app.js`(`/` 快捷键)、`src/web/server.ts`(路由表 `GET /` 接入总览 handler——仅替换处理器,不动基座契约)、`__tests__/web/knowledge-overview.test.ts`(新建)。预计不新增其他文件;单文件超 600 行 → 按模板/组装再拆(coding-standards)。
- **必须严格执行**:
  - **只经门面消费 markdown 子系统**:`import { MarkdownQuery, DOCUMENT_TYPES, DOCUMENT_STATUSES, type FindFilter, ... } from '../core/markdown'`(即 B-1 门面;禁 `../core/markdown/query` 直引)。每请求以基座进程级连接构造 `new MarkdownQuery(db)`(无状态,廉价);**不持有**额外 DB 连接。
  - URL 查询参数契约(index §7.5 逐字):`q`(单值)、`type`/`status`/`domain`/`concept`(可重复,`URLSearchParams.getAll`)、`sort=updated|title`(缺省 updated)、`page`(缺省 1,正整数守卫;超界 → 渲染末页 + 提示文案)。多值 → FindFilter 复数字段(`documentTypes`/`statuses`/`domains`/`concepts`);非法枚举值忽略(不报错,从激活集剔除);`page` 非法 → 按 1 处理。映射:`offset = (page-1)*30`,`limit = 30`(`PAGE_SIZE = 30` 常量)。
  - 面板数据源与计数口径(全库计数,不随筛选联动——index 第 4 节推荐):
    - 统计条:`getStats()` → 文档/概念/领域/标签四数 + 最近索引时间(`latestIndexedAt` 格式化为本地日期时间;null → 「尚未索引」);
    - 类型筛选:`byType`(17 键全渲染,0 计数也显示),排序 = 计数降序 + 同数按英文原值 ASC;
    - 状态筛选:`byStatus`(4 键全渲染),显示标签见下;
    - 领域筛选:`listDomains()`(名称 + 计数,计数降序——方法已含排序);
    - 概念面板:`listConcepts()`(默认 doc-count 降序)取 **Top 12** 平铺;第 13 个起收进原生 `<details>`(summary 文案「展开全部 N 个概念」),无 JS。**每条目含篇数占比条**(spec §3.3 原文要求;宽度 = `ConceptSummary.documentCount` / `getStats().documentCount`,纯 CSS 宽度)。
  - 显示标签映射(index §7.6,spec §3.3 逐字,`constants.ts`):
    `TYPE_LABELS`: concept 实体概念 / decision 决策 / rule 规则 / lesson 教训 / warning 警示 / finding 发现 / analysis 分析 / exploration 探索 / note 笔记 / runbook 运维手册 / installation 安装部署 / api API / faq FAQ / architecture 架构 / guide 指南 / tutorial 教程 / conversation 对话。
    `STATUS_LABELS`: draft 草稿 / active 现行 / superseded 已被替代 / deprecated 已废弃。
    芯片与徽标同时展示「中文 + 英文原值」(英文原值是 frontmatter 值,URL 参数亦用英文原值)。
  - 激活筛选 pill:每个激活值一个 pill(如「类型: 决策 ✕」),✕ = 移除该值后的 URL(其余参数保留);激活条件 ≥2 → 追加「清除全部」pill → `/`。无激活 → 不渲染 pill 区。
  - 文档卡(index §7.7 视觉基线):类型徽标块(中文 + 英文小标,按类型着色系——17 种按语义归 4–5 个色系,同页同类型同色即可)、标题(17px)+ alias(数据来源 `DocumentDescriptor.aliases`,取首个,无则不显示)、摘要(`-webkit-line-clamp: 3`)、概念标签行(每个 = 追加 `concept=<名>` 的链接,保留其余筛选参数)、负责人(数据来源 `DocumentDescriptor.owners`,「 / 」连接);**右栏四项**:状态 pill / 领域 / 引用数 / 更新时间。引用数数据来源 = `DocumentDescriptor.referencesCount`(B-1 `findPaged` hydrate 时填出,契约见 index §7.2——页面侧**不得**逐卡调 `getReferences` 计数,禁 N+1)。
  - 列表头:「文档」+ 计数徽章(有筛选 `M / N`,无筛选 `N 篇`;N = total?——无筛选时 N = documentCount);排序切换(最近更新 / 名称)为两个链接(当前项高亮);分页区:上一页 / 下一页链接 + 「第 X / Y 页 · 共 N 篇」;末页/首页对应链接禁用;total 始终可见(spec §11 #10)。
  - 空状态区分(spec §8):① 全库 0 文档(documentCount=0)→ 「知识库为空」+ 引导「run `cgraphx docs index` to build the index」;② 有文档但筛选 0 匹配 → 「没有匹配的文档」+ 「重置全部筛选」链接(→ `/`)。两文案不可混用。
  - 壳布局(index §7.7):深松绿侧栏(`#163B2F`,导航:知识库(当前)/ 开发时间线(→`/timeline`)/ 数据库(灰置「后续」,不可点));顶栏:页面标题 + 只读 pill(「本地 · 127.0.0.1:<port> · 只读」);调色板变量按 index §7.7 全量落 `app.css`;字体经 Google Fonts `<link>`(Space Grotesk / Noto Sans SC / JetBrains Mono,`display=swap`),字体栈尾部系统字体兜底。
  - `app.js`:仅「按 `/` 聚焦搜索框(输入框内不触发)」+ 「时间元素本地化」(见下);无其他逻辑。
  - **时间显示**(spec §4.2/§11 #6):服务端输出 `<time datetime="ISO">` + 机器本地格式化文本(本地工具,服务进程时区 = 用户时区);`app.js` 可选增强:按浏览器时区重格式化 `[data-local-time]` 元素(数行,失败不阻塞)——两者取其一即可,契约:用户看到的是本地时区时间。
  - 所有 DB/用户来源字符串插值前过 `escapeHtml`(B-2 render-utils);搜索框 value 回显同样转义。
- **允许局部适配**:
  - 模板函数内部结构与 CSS 类名;类型 17 种的色系归组方案;分页区版式;概念 `<details>` 的 summary 措辞;`app.js` 时间本地化是否实现(服务端本地时间已是合规底线)。
- **具体要求**:
  - 测试 `__tests__/web/knowledge-overview.test.ts`(真实栈:mkdtemp 临时项目 + 内联写入 .md fixture + `indexMarkdownKnowledgeBase` 真实索引 + ensureTimelineSchema(基座预检需要)+ `startWebServer({port: 0})` + 全局 `fetch`;describe/it 英文;标注 spec 条款;afterEach 清理):
    1. 首页 200,含统计条四数(与 fixture 一致)、最近索引时间存在;(spec §3.3/§4.2)
    2. 类型芯片 17 个全渲染(断言全部英文原值出现),按计数降序(断言首个为最高计数类型);(spec §3.3/§11 #4)
    3. `?type=decision` → 列表仅 decision 文档;`?type=decision&type=lesson` → 两类型并集;(spec §3.3)
    4. `?status=draft` 与 `?domain=<名>` 与 `?concept=<名>` 各自过滤正确;组合 `?type=...&concept=...` = AND;(spec §3.3)
    5. `?q=<关键词>` 命中标题/摘要;与类型组合仍为 AND;(spec §3.3)
    6. `?sort=title` 标题序 vs 缺省 updated 序,两种输出不同且各自有序;(spec §3.3)
    7. 分页:造 31 篇文档,`/` 第 1 页 30 卡 + total「共 31 篇」+ 下一页链接;`?page=2` 1 卡;`?page=99` → 末页(第 2 页)+ 超界提示;(spec §11 #10)
    8. 激活 `?type=decision&concept=派单池` → pill 两个 + 「清除全部」;单激活 → 无清除全部;(index §7.5)
    9. 空态①:空 fixture 项目首页 → 「知识库为空」+ `cgraphx docs index` 引导;空态②:有文档 + `?q=不存在` → 「没有匹配的文档」+ 重置链接;(spec §8)
    10. 导航三入口存在,数据库项不可点(无 href 或 aria-disabled);(spec §11 #12)
    11. XSS:fixture 文档标题含 `<script>alert(1)</script>` → 响应体中该串被转义(不含原样 `<script>`);(安全)
    12. 非法参数容错:`?type=bogus` → 忽略该值不报错;`?page=abc` → 按第 1 页。
- **完成条件**: `npx vitest run __tests__/web/knowledge-overview.test.ts` 全绿;`npx vitest run __tests__/web/server.test.ts` 不回归(B-2 用例仍绿);`npx tsc --noEmit` 无错;手工:build 后启动,浏览器逐页面对照设计稿(/tmp/cgraphx-web-mockup.html,若已失效按 index §7.7 视觉描述验收)——筛选组合、pill、分页、空态、`/` 快捷键。
- **验证方式**: 测试命令 + 手工冒烟步骤;回报贴测试输出与手工验收结论。
- **独立提交**: 是(完成后 `GET /` 完整可用,仓库可工作)。建议 subject:`feat(web): 知识库总览页——五维筛选、文档列表分页、统计条`;body 列:壳布局 / 筛选面板(17 类型全集) / pill / 分页 / 空态两态。Co-Authored-By 尾行。提交前过 index 第 9 节检查点。
- **风险/注意事项**:
  - `DocumentDescriptor.referencesCount` 补充契约需与 B-1 同文(本任务消费、B-1 产出);若 B-1 已完成而未含此字段 → 走 PLAN_CONFLICT 上报(index §7.2 补充条为准,由 B-1 补上,不在本任务伸手进 core);
  - pill/分页链接的 URL 拼装(多值参数保留与移除)是最易出 bug 处——写一个纯函数 `buildUrl(current: URLSearchParams, mutate)` 并单测(可并入本测试文件的纯函数用例);
  - 概念/领域名的 URL 编码(中文、空格、特殊字符)——一律 `encodeURIComponent`,`getAll` 解码比对;
  - 页面模板文件超 600 行即拆(coding-standards),勿事后补拆。

---

### T-B-4: 文档详情页(markdown-it 全文渲染 + 双向引用 + 路径边界)

- **目标**: 交付 `GET /doc/<ident>`:元数据网格、摘要块、源文件 markdown 全文服务端渲染、双向引用导航、文档 ID/路径展示、未找到与源文件缺失状态;落地路径边界安全契约(spec §5.2)。
- **对应 spec 条款**: §3.4(详情页全部行为)、§5.2(路径边界)、§8(文档不存在 / 源文件缺失)、§11 #6(时区)/#7(路径边界)。implementer 据此读 spec 原文。
- **强制引用**: `docs/guides/coding-standards.md`(选型:markdown-it 依赖已拍板 / 中文注释 / 600 行;错误与日志:错误消息形态)、`docs/guides/testing-standards.md`(Mock 政策与隔离 / 测试描述)。开工前必读。
- **依赖**: T-B-3(壳布局 `layout.ts`、`render-utils.ts`、路由表接入点、app.css)。
- **涉及范围**: `package.json`(新增依赖 `markdown-it` + devDependency `@types/markdown-it`)、`src/web/markdown.ts`(渲染器单例 + frontmatter 剥离)、`src/web/pages-detail.ts`(详情页模板 + 组装)、`src/web/server.ts`(路由表 `GET /doc/<ident>` 接入)、`__tests__/web/knowledge-detail.test.ts`(新建)。
- **必须严格执行**:
  - 路由:`GET /doc/<ident>`,`ident` = `decodeURIComponent` 后的 64 位十六进制 ID **或**项目相对路径;解析/取数经门面 `MarkdownQuery.getDocumentDetail(ident)`(id 或 path 由其内部解析)与 `getReferences(ident)`;抛 `DocumentNotFoundError` 或返回 null → 404 页(壳布局 + 「文档未找到: <ident>」转义回显 + 回 `/` 链接)。
  - **路径边界**(spec §5.2,安全契约):全文数据源 = `path.join(projectRoot, doc.path)`,其中 `doc.path` **只取自 `getDocumentDetail` 返回值**(DB 记录);路由不接受任何文件路径参数直接渲染;额外防护:读取前校验 `path.resolve(projectRoot, doc.path)` 仍在 projectRoot 内(防索引数据被篡改的纵深防御),否则按源文件缺失处理。
  - 全文渲染(`markdown.ts`):`readFileSync(absPath, 'utf-8')` → `stripFrontmatter(raw)`(门面导出,B-1)→ `markdown-it` 渲染。渲染器单例,选项**固定** `{ html: false, linkify: false, typographer: false }`(XSS 边界:markdown 内原始 HTML 不渲染为标签);启用内置 table / fence。
  - 源文件缺失/不可读(spec §8):`readFileSync` 抛错(ENOENT/EACCES 等)→ 详情页**元数据与引用正常渲染**,全文区域呈现「源文件缺失或不可读: <doc.path>」(转义),HTTP 200(不是错误页)。
  - 元数据网格字段(spec §3.4,来自 `DocumentDetail`):负责人(owners)、领域(domains)、创建时间(createdAt)、更新时间(updatedAt)、概念(concepts)、标签(tags)、相关代码(relatedCode)、索引时间(`indexedAt` 为 epoch ms → 本地日期时间格式化,同 B-3 时间契约);空数组字段渲染「—」占位,不崩。
  - 双向引用(spec §3.4):`getReferences(ident)` → 「引用 →(N)」列出 outgoing、「← 被引用(N)」列出 incoming;每条 = 标题 + 项目相对路径(小字),整条为 `/doc/<target.id>` 链接;空分区显示「无出向引用」/「无入向引用」。引用条目**不含类型徽标**(index 第 4 节推荐,避免 N+1;设计稿细微偏差已记录)。
  - 文档标识区:文档 ID(等宽、可整选)+ 项目相对路径;头部:类型徽标(同 B-3 TYPE_LABELS)+ 大标题 + alias/领域/状态辅助行。
  - 插值转义:所有元数据字段、路径、引用标题过 `escapeHtml`;仅 markdown-it 输出作为可信 HTML 直出(其 `html:false` 保证用户 markdown 中的原始 HTML 被转义为文本)。
  - 依赖引入:`npm install markdown-it`(纯 JS,无 native/wasm)+ `npm install -D @types/markdown-it`;锁 `^` 主版本;不动其他依赖。
- **允许局部适配**:
  - 详情页版式细节(网格列数、引用栏位置——设计稿为右栏 sticky,可沿用);时间格式化复用 B-3 已有辅助函数;404/缺失文案措辞(信息要素固定);markdown-it 插件不引入(内置规则够用,YAGNI)。
- **具体要求**:
  - 测试 `__tests__/web/knowledge-detail.test.ts`(真实栈同 B-3;英文描述;标注条款):
    1. fixture 文档正文含 H2 / 表格 / 代码块 / 引用块 / 列表 → 响应含对应 `<h2>` / `<table>` / `<code>` / `<blockquote>` / `<li>`,且正文不含 frontmatter 内容;(spec §3.4)
    2. 元数据网格八组字段齐全,值与 fixture frontmatter 一致;空 tags 渲染占位;(spec §3.4)
    3. 按 ID 与按路径两种 ident 均 200 且内容一致;(spec §3.4,CLI show 同口径)
    4. outgoing/incoming 分区与 fixture 引用关系一致,链接指向 `/doc/<id>`;(spec §3.4)
    5. 不存在的 ident → 404 页含 ident 回显(转义)+ 回首页链接;(spec §8)
    6. 删除源文件(`rmSync`)后请求 → 200,元数据正常 + 「源文件缺失或不可读」+ 路径;(spec §8/§5.2)
    7. **路径边界**:构造请求 `/doc/..%2f..%2fpackage.json` → 404(非文档),绝不返回文件内容;fixture 文档正文含 `<script>alert(1)</script>` → 响应中为转义文本或代码块文本,无可执行 script 标签;(spec §5.2 + XSS)
    8. markdown 内原始 HTML(`<b>raw</b>`)→ 渲染为转义文本(html:false 生效)。
- **完成条件**: `npx vitest run __tests__/web/` 全绿(含 B-2/B-3 用例不回归);`npx tsc --noEmit` 无错;`npm run build` 成功;手工:浏览器点列表卡片进详情、引用互跳、ID/路径可复制、缺失文件场景(临时 mv 源文件)表现正确。
- **验证方式**: 测试命令 + build + 手工冒烟;回报贴输出。
- **独立提交**: 是。建议 subject:`feat(web): 文档详情页——markdown-it 全文渲染、双向引用、路径边界`;body 列:markdown-it(html:false)/ frontmatter 剥离 / 路径边界两层防护 / 引用导航 / 缺失降级。Co-Authored-By 尾行。提交前过 index 第 9 节检查点(新增依赖无原生编译;无魔法值)。
- **风险/注意事项**:
  - `stripFrontmatter` 来自 B-1 门面——若 B-1 遗漏即 PLAN_CONFLICT,不在本任务自行进 core 补;
  - markdown-it 直出 HTML 与 escapeHtml 的边界:**只有** markdown-it 输出直出,其余一切插值转义——代码审查重点;
  - 大文件全文渲染无上限问题(本地知识库文档体量小,YAGNI,不做截断);
  - `@types/markdown-it` 版本与主包匹配(安装时取 latest,类型不兼容则按主包版本说明调整——属安装期适配,记录即可)。
