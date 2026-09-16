# -03-frontend:时间线页呈现层(模板+JSON 高亮器 / CSS / server 接线)

> 承载 T-2、T-4、T-5。全局契约见 `cgraphx-web时间线浏览-index.md`「必须严格执行的契约」。

---

## T-2:timeline-templates.ts(渲染助手 + JSON 高亮器)

- **目标**:实现 `renderTimelineContent(model): string`(contentHtml,被 `renderShellPage` 消费)+ 各片段渲染助手 + `highlightJson`。镜像 `overview-templates.ts` 模式(纯字符串拼接 + 每个插值点 `escapeHtml`)。
- **对应 spec 条款**:§3.3(四级结构/子 agent 行型/git 栏/payload 原文/截断提示)、§3.4(三态空状态)。
- **强制引用**:`coding-standards.md`、`interface-standards.md`(XSS 契约:DB 来源字符串入 HTML 前 escapeHtml)。
- **依赖**:T-1(接口 + 常量)。
- **涉及范围**:`src/web/timeline-templates.ts`(完成渲染函数)。
- **必须严格执行**:
  - 片段助手:`renderStatbar`、`renderTlFilters`(时间范围 seg + 类型多选 chips + 工具/文件/会话 search-box,沿用既有 `.filters/.chip/.seg/.search-box` 类)、`renderTlPills`(`.apill` 复用)、`renderDayGroup`→`renderSessionCard`→`renderTurnGroup`→`renderEventRow`→`renderPayload`、`renderCommitsBar`、`renderTlEmpty`(三态)。
  - 会话卡:`<details class="sess">`,`--live`/`--cross` 标记;头部按 `SessionCardModel` 渲染。
  - 事件行:5 类型 + 子 agent 行型各对应 `evbadge--*` 与 `ev--agent` 类;`hasPayload` 控制是否 `<details>`(可展开)vs 静态行;`model.payload`(已解析对象,见 T-1)经 `highlightJson(payload)` 入 `<pre class="ev__json">`。
  - 子 agent 行型:附「子 agent 数据约束说明文案」(逐字,index「payload 字段矩阵」下的文案)。
  - git_commit:`<div class="commits">` 独立栏,每条 `CommitRowModel`;当日 0 提交 → `.commits__empty` 一行。
  - 空状态:全库 0 事件 → 引导 `cgraphx timeline install`(逐字命令);今天 0 事件 vs 筛选 0 匹配文案严格区分(§3.4);重置入口 = 清除全部过滤参数的 URL(无 range/type/tool/file/session)。
  - 截断提示:`truncationNotice` 非空时渲染 `.tl-contract` 风格提示块(逐字文案见 index「截断感知」)。
  - **每个插值点过 `escapeHtml`**(`render-utils.ts:16`,已存在);payload JSON 经 `highlightJson`(内部已 escape)。
  - 顶层包 `<div class="tl-layout"><aside class="filters">…</aside><div class="tl-main">…</div></div>`。
- **允许局部适配**:助手拆分粒度、HTML 缩进;`highlightJson` 内部递归结构。
- **完成条件**:`renderTimelineContent(model)` 对样例 model 产出含全部四级结构、payload 高亮 span、子 agent 说明、git 栏、三态空状态的 HTML 字符串;XSS 用例(prompt_text 含 `<img onerror=...>`)输出为转义文本。
- **验证方式**:实现后归入 web 测试;本任务 `tsc --noEmit` 过 + 手写一个样例 model 调用 `renderTimelineContent` 打印检查(可临时脚本,不入库)。
- **独立提交**:否(随 T-3 commit B)。
- **风险/注意事项**:
  - JSON 高亮器 XSS——强制"先 escape 每段再入 span";递归发射器对 string/key 字段先 `escapeHtml(JSON.stringify(piece))` 或 `escapeHtml(piece)` 再包 span,**不得**先 tokenize 再 escape。
  - mockup 空态类与既有 `.empty` 冲突——用新类名(`.tl-empty__*`)或复用既有结构,不覆盖知识库空态(与 T-4 协调)。
  - 事件行时间戳:输出 `<time datetime="${ISO}" data-local-time>${进程本地 HH:mm:ss}</time>`(沿用 render-utils `epochTime`/`docTime` 模式,精确到秒;`app.js` 自动按浏览器时区重格式化——但 app.js 现只到分钟,见 T-2 注意:秒级精度需 app.js 同步或服务端不依赖 app.js 重格式化。**实现期定:服务端输出到秒,app.js 重格式化仍到分钟则保留服务端秒级文本——或扩展 app.js。优先不动 app.js,服务端到秒即可**——见 index「不改 app.js」约束,秒级由服务端进程本地时间直出)。

---

## T-4:app.css 时间线样式

- **目标**:把 mockup v2 的时间线专属 CSS(73 类 + 5 chip 色调 + 柱图/图例/会话卡/事件行/payload/git 栏/空态)迁入 `src/web/public/app.css`,复用既有设计令牌(:root 变量)与既有组件(`.filters/.chip/.seg/.statbar/.stat/.search-box/.list-head/.count-badge/.empty/.placeholder`)。
- **对应 spec 条款**:§3.3(四级结构视觉)、§3.1(概况条 + 柱图)。
- **强制引用**:`coding-standards.md`(无特定 CSS 规范;遵循既有 app.css 组织)。
- **依赖**:无(可与 T-1/T-2 并行)。
- **涉及范围**:`src/web/public/app.css`(编辑,追加时间线段)。
- **必须严格执行**:
  - 追加 mockup v2 `<style>` 内的全部时间线类(`.tl-layout/.tl-main/.bars*/.legend/.evbadge--*/.tl-day*/.sess*/.turn/.evlist/.ev*/.ev__*/.jk/.js/.jn/.jb/.j-trunc/.ev-fold/.commits*/.commit*/.tl-contract/.appendix*/.stat__num--tool/.topbar__right`),逐字取色值用 `:root` 令牌(不写死十六进制,除令牌未覆盖的过渡色)。
  - 追加 5 个 chip 色调:`.chip--prompt/--pre/--post/--stop/--git`(含 `--on` 态),不覆盖既有 `.chip--entity/process/judgment/lesson`。
  - 空态:mockup 的 `.empty__sub/__code/__btn` 与既有 `.empty__text/__reset` 冲突 → **为时间线空态用独立类名**(`.tl-empty` + 子类)或复用既有结构,保证知识库页空态不回归。实现期择一并在该任务说明。
  - `@media (max-width:1080px)` 与 `prefers-reduced-motion` 段逐字迁入。
- **允许局部适配**:类落地顺序、注释分块;令牌未覆盖的过渡色可用十六进制(标注出处 mockup 行)。
- **完成条件**:app.css 追加时间线段;既有知识库页视觉零回归(对照 commit 前后截图或既有 web 测试不红);`cgraphx web` 启动后 `/` 与 `/doc/*` 样式不变。
- **验证方式**:`npx tsc --noEmit`(不涉 TS,但确认无破坏)+ 既有 web 测试全绿 + 手动 `cgraphx web` 对照知识库页视觉。
- **独立提交**:是(commit A)。理由:纯 CSS 追加,休眠态(类未被引用前不影响任何页面),既有测试不红。
- **风险/注意事项**:覆盖既有 `.empty`/`.chip` 变体导致知识库页回归——强约束用新类名或独立段,不动既有变体。mockup 内嵌的设计令牌(:root)与 app.css 既有的**逐字相同**(mockup 注释已声明"逐字取自 app.css"),无需重复追加令牌,直接用 `var(--xxx)`。

---

## T-5:server.ts 接线 + 修正 server.test.ts 占位断言

- **目标**:把 `GET /timeline` 从占位页换成 `renderTimelinePage`;同步修正 `__tests__/web/server.test.ts` 的占位断言。
- **对应 spec 条款**:§3.3(页面接线上线)、§7 #5(CLI 回归,web 不动 CLI)。
- **强制引用**:`coding-standards.md`、`interface-standards.md`、`git-standards.md`(提交规范)。
- **依赖**:T-3(`renderTimelinePage`)、T-4(样式已落地,T-5 后页面有样式)。
- **涉及范围**:`src/web/server.ts`(编辑,替换占位)、`__tests__/web/server.test.ts`(编辑,修断言)。
- **必须严格执行**:
  - `server.ts:229-237` 占位分支替换为 **async 兜底形态**(门面 `queryEvents`/`getEventStats` 是 `async`,`renderTimelinePage` 返回 `Promise<string>`,不能像 `/`、`/doc/` 同步 `res.end(html)`):
    ```ts
    if (pathname === '/timeline') {
      renderTimelinePage(url.searchParams, { version: ctx.version, localHost: ctx.localHost, projectRoot: ctx.projectRoot })
        .then((html) => {
          res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
          res.end(html);
        })
        .catch((err) => sendInternalError(res, ctx, err));
      return;
    }
    ```
    - 外层 `createRequestHandler` 的同步 `try/catch` 仍覆盖同步抛错路径(URL 构造等);async 错误经 `.catch` → `sendInternalError` 进 500 页(与同步路径等价覆盖)。
    - 签名与 T-3 逐字一致:`renderTimelinePage(params: URLSearchParams, ctx: {version, localHost, projectRoot}): Promise<string>`(**不传 `ctx.db`**,timeline 门面用 `projectRoot` 自管连接)。
  - 删除 `renderTimelinePlaceholder` 函数(`server.ts:121-128`)及其注释。
  - `server.ts` 顶部注释块更新:`GET /timeline` 描述从"占位页(平行需求未实现)"改为"开发时间线页(经 pages-timeline 渲染;门面 async,分支用 .then/.catch)"。
  - 既有 import:新增 `import { renderTimelinePage } from './pages-timeline';`(与 `pages-overview`/`pages-detail` 并列)。
  - **`__tests__/web/server.test.ts`**:`:84` 处断言 `/timeline` 含"平行需求" + feature-id 字符串 → 改为真实页面最小可观察断言:HTTP 200 + 响应含 `开发时间线` 标题 + 导航 `aria-current="page"`(active=timeline)+ 壳结构(如 `class="shell"`)。**注意**:`fetch('/timeline')` 会自动 await Promise 响应,测试无需特殊 async 处理;但断言须容忍空态(测试 fixture 有 `ensureTimelineSchema` 但可能无 timeline 事件 → 空态无事件行)。不引入新场景(新场景归实现后 web 测试任务),仅把占位断言升级为真实页断言。
  - 只读契约:接线后 `/timeline` 不产生 DB 写/文件写(沿用 server.ts 既有只读契约,`renderTimelinePage` 内只 SELECT;门面 `openTimelineDb` 打开的是只读连接)。
- **允许局部适配**:最小断言的具体字符串(须稳定、不脆)。
- **完成条件**:`cgraphx web` 启动后 `GET /timeline` 返回 200 + 真实时间线页(含概况条/过滤/事件流,有 timeline 数据时见四级分组);`__tests__/web/server.test.ts` 占位断言升级后通过;`__tests__/web/` 全部测试绿;`__tests__/core/timeline/` 全绿(CLI 零变化)。
- **验证方式**:`npx vitest run __tests__/web/` 全绿;`npx vitest run __tests__/core/timeline/` 全绿(回归);手动 `node dist/cli/index.js web`(或 `npx tsx src/cli/index.ts web`)→ 浏览器访问 `http://127.0.0.1:2468/timeline` 对照 mockup v2。
- **独立提交**:是(commit B,与 T-1/T-2/T-3 同提交)。理由:T-5 接线 + 既有测试修正必须原子(T-5 不改则占位断言不红,但页面不活;T-5 改不断言则测试红)。
- **风险/注意事项**:占位断言升级为真实页断言时若 timeline 库为空(测试 fixture 无 timeline 事件),断言须容忍空态——测试 fixture 已 `ensureTimelineSchema`(见探索报告),表存在但可能无数据 → 断言落在"标题 + 壳"而非"事件行"(空态下无事件行)。**签名与 T-3 已逐字锁定**:`renderTimelinePage(params, ctx)` async 返回 `Promise<string>`,接线处 `.then().catch()`,不传 `ctx.db`。
