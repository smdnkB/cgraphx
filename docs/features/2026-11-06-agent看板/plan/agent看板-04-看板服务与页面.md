# T-4: 看板服务与页面

> 产物: plan
> 依据: spec@90c1887

- 目标: board 的本机 HTTP 服务(令牌校验、两个只读接口)与单文件页面 `page.html`——左右分栏、定挂/可能相关、复制编号标题、刷新,布局与交互照线框 v2。
- 对应 spec 编号: F1(页面与③浏览器打不开)、F2(右栏)、F3 与 F3①(复制与降级)、D2、D3、D11、验收 1。
- 强制引用: `docs/guides/coding-standards.md`(动代码;禁框架/禁外部资源、注释中文)。
- 涉及范围: `src/core/board/server.ts`(新)、`src/core/board/page.html`(新)。
- 必须严格执行:
  - 按 C-7(服务安全:回环 + 随机端口 + 随机令牌 + 令牌/Host/Origin 校验 + 409 并发 + 无路径参数)与 C-14(页面契约)。
  - 按 C-6 的 `BoardData` 形状做接口出参与页面渲染,不另起一份。
  - `page.html` 单文件:内联 CSS、JS,无框架、无外部资源、不发起除 `/api/board`、`/api/refresh` 外的任何请求。
  - server 构造传入初始 `BoardData` 与 `refresh: () => Promise<BoardData>` 回调(编排归 CLI,T-5);服务自身不碰补录、不碰文件系统(page.html 启动读一次缓存)。
- 允许局部适配:
  - 页面视觉细节(布局与交互照线框 `../agent看板-线框-v2.html`,灰度低保真可升级为简洁样式);时间显示的跨年格式;DOM 结构与 class 命名。
  - server 的路由分发写法、错误响应体格式(状态码与语义不变)。
- 具体要求:
  1. `board/server.ts`:导出 `createBoardServer`(函数名钉死,T-5 直接引用)——`node:http`、`listen('127.0.0.1', 0)`、`crypto.randomBytes` 令牌;三路由按 C-7;`POST /api/refresh` 期间再收 → 409;刷新成功后替换内存数据;对外暴露地址(含 `?t=<令牌>`)与 `close()`。page.html 经 `__dirname` 相对路径读(与 schema-bootstrap 同款,dist 镜像 src 布局)。
  2. `board/page.html`:按 C-14 全量实现——顶栏(标题、「全部/收起」、「刷新」+ 刷新中提示)、左栏(项目分组:名字+目录、notice、任务行、older 提示、未归类垫底)、右栏(任务名、定挂/可能相关两组、会话行含编号短显与依据、复制按钮)、「已复制」反馈、剪贴板失败降级文本框、`fileExists=false` 灰显+「会话文件已不在」、两套空态文案;默认选中全局最近活动的任务,点行即换不返回;409 刷新冲突提示。
  3. 复制用 `navigator.clipboard.writeText`(127.0.0.1 是安全上下文);编号复制 `Session.id` 完整值、标题复制 `Session.title`。
- 完成条件:
  - `npm run build` 零错误;`npm test` 全量通过。
  - 冒烟:临时脚本起 server(注入假 refresh)后,`curl` 三项校验各拿 403(令牌错 / Host 错 / Origin 错)、正令牌拿 200 与 JSON、并发刷新拿 409;浏览器打开页面走通 C-14 全部交互。
- 提交点:
  1. `feat(board): 本机看板服务与页面——令牌校验、只读接口、复制交互`:本任务 2 个文件。
- 风险/注意事项:
  - 端口与令牌只随机、不固定、不做 `--json`(D4);除补录外不写任何东西(本任务完全不写)。
  - 页面渲染 1000+ 会话时的性能:分组渲染即可,不引虚拟滚动;本机量级(几百会话)足够。
  - `server.ts` 单文件 600 行上限;页面 JS 内嵌在 html 内不计 TS 行数,但同样不写框架。
