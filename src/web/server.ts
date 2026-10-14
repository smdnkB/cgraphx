/**
 * web 服务基座:node:http 服务器 + 路由骨架 + 生命周期。
 *
 * `startWebServer` 执行启动预检(经 bootstrap)→ 回环绑定 127.0.0.1 →
 * 返回 `{ url, close }`。本函数保持纯净:不注册进程信号处理器(测试友好),
 * SIGINT/SIGTERM 的优雅退出由 register.ts 装配。
 *
 * 路由骨架:
 *   GET /            知识库总览页(B-3:经 pages-overview 渲染)
 *   GET /doc/<ident> 文档详情页(B-4:markdown 全文渲染 + 双向引用;ident 为
 *                    文档 ID 或项目相对路径,源文件路径仅从索引 DB 解析,spec §5.2)
 *   GET /timeline    开发时间线页(经 pages-timeline 渲染;门面 async,分支用 .then/.catch)
 *   GET /map         系统地图首页(经 pages-codemap 渲染,2026-10-14-cgraphx-web系统地图)
 *   GET /map/system/<name>、/map/flow/<name>
 *                    系统交互 / 流程视图页(名字非法或视图不存在 → 404)
 *   GET /tasks       开发任务列表页(经 pages-tasks 渲染,2026-10-14-cgraphx-web开发任务浏览)
 *   GET /tasks/<id>  任务详情页(id 须为纯数字本地 id;否则或任务不存在 → 404)
 *   GET /assets/*    静态资产(路径穿越防护 + 扩展名白名单)
 *   其他             404 页
 *   处理器抛错       500 页(可读原因,禁输出堆栈)
 *
 * 只读契约(spec §4.1 / §11 #3):除 bootstrap 的 sqlite_master 查询外,
 * web 进程内所有 SQL 为 SELECT;总览页每请求以进程级单连接构造
 * MarkdownQuery(只读),不持有额外 DB 连接。
 */

import * as http from 'node:http';
import * as fs from 'node:fs';
import * as path from 'node:path';
import type { AddressInfo } from 'node:net';

import type { SqliteDatabase } from '../core/db';
import { openVerifiedConnection } from './bootstrap';
import { WebStartupError } from './errors';
import { renderShellPage, type ShellActive } from './layout';
import { renderOverviewPage } from './pages-overview';
import { renderDetailPage } from './pages-detail';
import { renderTimelinePage } from './pages-timeline';
import {
  renderSchemaProjectsPage,
  renderSchemaTablesPage,
  renderSchemaDdlPage,
  renderSchemaInsightsPage,
} from './pages-schema';
import { listTables, listProjects } from './schema-reader';
import { renderCodemapHomePage, renderCodemapViewPage } from './pages-codemap';
import { renderTaskDetailPage, renderTasksListPage } from './pages-tasks';
import { isSafeCodemapName, type CodemapKind } from './codemap-reader';
import { escapeHtml } from './render-utils';

/** 已启动的 web 服务句柄。 */
export interface WebServer {
  /** 可点击的本地访问地址,形如 `http://127.0.0.1:<port>`(port 0 时取实际端口)。 */
  url: string;
  /** 关闭 http server + DB 连接。 */
  close(): Promise<void>;
}

/**
 * 请求处理上下文。`localHost` 在 listen 成功后回填(port 0 时取实际端口);
 * 处理器在请求时读取,绑定完成前不会有请求到达。`projectRoot` 为源文件读取
 * 基准——详情页全文仅从索引 DB 解析出的路径解析到此根内(spec §5.2)。
 */
interface HandlerContext {
  db: SqliteDatabase;
  version: string;
  localHost: string;
  projectRoot: string;
}

/** 静态资产 Content-Type 最小表(扩展名 → MIME)。不在表内的扩展名一律 404。 */
const ASSET_CONTENT_TYPES: Record<string, string> = {
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2',
};

/** 仅回环绑定(安全契约,spec §5.1):字面量,不做 host 参数。 */
const LOOPBACK_HOST = '127.0.0.1';

/** 运行时读 package.json 版本号(与 cli/index.ts 同源同机制,spec §7)。 */
function readVersion(): string {
  try {
    const pkg = JSON.parse(
      fs.readFileSync(path.join(__dirname, '..', '..', 'package.json'), 'utf-8'),
    ) as { version?: string };
    return pkg.version ?? 'unknown';
  } catch {
    return 'unknown';
  }
}

/** 发送一个壳布局 HTML 响应。 */
function sendHtml(
  res: http.ServerResponse,
  status: number,
  opts: { title: string; active: ShellActive; contentHtml: string },
  ctx: HandlerContext,
): void {
  res.writeHead(status, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(
    renderShellPage({
      title: opts.title,
      active: opts.active,
      contentHtml: opts.contentHtml,
      version: ctx.version,
      localHost: ctx.localHost,
    }),
  );
}

/** 404 页:可读文案 + 回首页链接;展示被请求路径(转义)。 */
function sendNotFound(res: http.ServerResponse, ctx: HandlerContext, requestPath: string): void {
  const contentHtml = `
    <section class="placeholder">
      <h1>页面不存在</h1>
      <p>没有与 <code>${escapeHtml(requestPath)}</code> 匹配的页面。</p>
      <p><a href="/">返回知识库首页</a></p>
    </section>`;
  sendHtml(res, 404, { title: '页面不存在', active: 'none', contentHtml }, ctx);
}

/** 500 页:可读错误原因,禁输出堆栈(spec §3.2 全局错误态)。 */
function sendInternalError(res: http.ServerResponse, ctx: HandlerContext, err: unknown): void {
  const reason = err instanceof Error ? err.message : String(err);
  const contentHtml = `
    <section class="placeholder placeholder--error">
      <h1>出错了</h1>
      <p>处理请求时发生内部错误:</p>
      <pre class="error-reason">${escapeHtml(reason)}</pre>
      <p><a href="/">返回知识库首页</a></p>
    </section>`;
  sendHtml(res, 500, { title: '出错了', active: 'none', contentHtml }, ctx);
}

/** /timeline 占位页:平行需求尚未实现。 */
// 2026-09-16:T-5 替换为真实开发时间线页(renderTimelinePage);保留注释占位以备异常态。

/**
 * 静态资产服务。从 `path.join(__dirname, 'public')` 提供(dist 与 src 布局
 * 同构,经 copy-assets 镜像)。
 *
 * 路径穿越防护:decode → `path.resolve` → 校验结果仍在 public 根内,否则
 * 404(`/assets/..%2f..%2fpackage.json` 类请求在此被拦截)。扩展名白名单
 * (css/js/svg/woff2)之外一律 404。
 *
 * @returns true 表示已处理(含 404),调用方无需再分发。
 */
function tryServeAsset(
  res: http.ServerResponse,
  ctx: HandlerContext,
  pathname: string,
): boolean {
  const publicRoot = path.resolve(__dirname, 'public');
  let rel: string;
  try {
    rel = decodeURIComponent(pathname.slice('/assets/'.length));
  } catch {
    sendNotFound(res, ctx, pathname);
    return true;
  }

  const filePath = path.resolve(publicRoot, rel);
  // 根校验:resolve 后必须仍在 public 根内,否则视为穿越 → 404。
  if (filePath !== publicRoot && !filePath.startsWith(publicRoot + path.sep)) {
    sendNotFound(res, ctx, pathname);
    return true;
  }

  const contentType = ASSET_CONTENT_TYPES[path.extname(filePath).toLowerCase()];
  if (contentType === undefined) {
    sendNotFound(res, ctx, pathname);
    return true;
  }

  let data: Buffer;
  try {
    data = fs.readFileSync(filePath);
  } catch {
    sendNotFound(res, ctx, pathname);
    return true;
  }

  res.writeHead(200, { 'Content-Type': contentType });
  res.end(data);
  return true;
}

/**
 * 文档详情页路由(spec §3.4 / §5.2 / §11 #7)。
 *
 * ident = `/doc/` 之后经 decodeURIComponent 的 64 位十六进制 ID **或**项目相对
 * 路径。不存在「给个路径就渲染」的端点:源文件路径由 renderDetailPage 从索引
 * DB 解析(spec §5.2),路由只负责取出 ident 并转发。解码失败(非法百分号
 * 序列)→ 404;文档未找到 / getReferences 抛 DocumentNotFoundError → 404 页
 * (均在 renderDetailPage 内收敛为 status:404)。
 */
function handleDocDetail(
  res: http.ServerResponse,
  ctx: HandlerContext,
  pathname: string,
): void {
  let ident: string;
  try {
    ident = decodeURIComponent(pathname.slice('/doc/'.length));
  } catch {
    sendNotFound(res, ctx, pathname);
    return;
  }
  const result = renderDetailPage(ctx.db, ctx.projectRoot, ident, {
    version: ctx.version,
    localHost: ctx.localHost,
  });
  res.writeHead(result.status, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(result.html);
}

/**
 * schema-knowledge 预览路由(spec §3.2-3.6 / §5.2 / §11 #9,2026-09-16-cgraphx-web数据库预览)。
 *
 * 纯文件系统派生,**不经 db**(契约 C):处理器用 ctx.projectRoot 调 pages-schema,
 * 不用 ctx.db。路由不接受任意文件路径参数:工程名/表名格式非法(含 `..` / `/`)→
 * 404(不调 render);合法但工程不存在 → 详情页 render 返回 status:404;
 * ddl 文件缺失 → status:200 + 缺失提示(spec §3.4 / §8)。
 *
 * 路由形态:
 *   GET /schema                       工程列表(单工程自动 302 折叠;零工程/目录不存在 → 空态)
 *   GET /schema/<工程>                表清单
 *   GET /schema/<工程>/insights       经验沉淀(`insights` 保留词,优先于 <表> 判定)
 *   GET /schema/<工程>/<表>           单表 DDL 详情(返回 { status, html },走 handleDocDetail 同款 writeHead)
 */
function handleSchema(
  res: http.ServerResponse,
  ctx: HandlerContext,
  pathname: string,
): void {
  const ctxSchema = { version: ctx.version, localHost: ctx.localHost };
  const rest = pathname.slice('/schema/'.length); // 去掉前缀,可能为空

  // GET /schema
  if (rest === '') {
    // 始终重定向到首个工程(单工程也重定向;页面层级缩减后工程列表不再独立成页,
    // 多工程切换器内嵌在表清单页顶部)。零工程/目录不存在 → 渲染空态引导。
    const projects = listProjects(ctx.projectRoot);
    if (projects !== null && projects.length >= 1) {
      const first = projects[0];
      if (first !== undefined) {
        res.writeHead(302, { Location: `/schema/${encodeURIComponent(first.name)}` });
        res.end();
        return;
      }
    }
    // 零工程 / 目录不存在 → 空态页(引导 export-table-ddl)。
    const html = renderSchemaProjectsPage(ctx.projectRoot, ctxSchema);
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(html);
    return;
  }

  // 解析 <工程>[/<表或 insights>]:工程名是第一个 / 之前的部分。
  const slashIdx = rest.indexOf('/');
  const projectNameEncoded = slashIdx === -1 ? rest : rest.slice(0, slashIdx);
  const tail = slashIdx === -1 ? '' : rest.slice(slashIdx + 1);

  let projectName: string;
  try {
    projectName = decodeURIComponent(projectNameEncoded);
  } catch {
    sendNotFound(res, ctx, pathname);
    return;
  }
  // 格式非法(含 ../)→ 路由层 404,不调 render(契约 B 分层)。
  if (!isSafeSchemaName(projectName)) {
    sendNotFound(res, ctx, pathname);
    return;
  }

  // GET /schema/<工程>(表清单)
  if (tail === '') {
    // 工程不存在 → 404(契约 B 分层);listTables 返回 null 即工程不存在。
    if (listTables(ctx.projectRoot, projectName) === null) {
      sendNotFound(res, ctx, pathname);
      return;
    }
    const html = renderSchemaTablesPage(ctx.projectRoot, projectName, ctxSchema);
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(html);
    return;
  }

  // GET /schema/<工程>/insights(经验沉淀,保留词优先于 <表>)
  if (tail === 'insights') {
    // 工程不存在 → 404。
    if (listTables(ctx.projectRoot, projectName) === null) {
      sendNotFound(res, ctx, pathname);
      return;
    }
    const html = renderSchemaInsightsPage(ctx.projectRoot, projectName, ctxSchema);
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(html);
    return;
  }

  // GET /schema/<工程>/<表>(DDL 详情)
  let tableName: string;
  try {
    tableName = decodeURIComponent(tail);
  } catch {
    sendNotFound(res, ctx, pathname);
    return;
  }
  if (!isSafeSchemaName(tableName)) {
    sendNotFound(res, ctx, pathname);
    return;
  }
  const result = renderSchemaDdlPage(ctx.projectRoot, projectName, tableName, ctxSchema);
  // 走 handleDocDetail 同款 writeHead + end,不走 sendHtml(防双重 writeHead)。
  res.writeHead(result.status, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(result.html);
}

/**
 * 系统地图路由(spec §3.2 / §3.3 / §5 / §7,2026-10-14-cgraphx-web系统地图)。
 *
 * 路由形态(契约 1):
 *   GET /map、/map/                 地图首页
 *   GET /map/system/<name>          系统交互视图(docs/code-map/<name>.md)
 *   GET /map/flow/<name>            流程视图(docs/code-map/flows/<name>.md)
 * 名字解码失败或格式非法(含 ../)→ 路由层 404,不进页面层;视图不存在 / 坏文件 →
 * 页面层返回 status:404,此处统一出基座 404 页(契约 8)。其他形态 → 404。
 */
function handleCodemap(
  res: http.ServerResponse,
  ctx: HandlerContext,
  pathname: string,
): void {
  const ctxPage = { version: ctx.version, localHost: ctx.localHost };
  if (pathname === '/map' || pathname === '/map/') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(renderCodemapHomePage(ctx.projectRoot, ctxPage));
    return;
  }
  const m = /^\/map\/(system|flow)\/([^/]+)$/.exec(pathname);
  if (m === null) {
    sendNotFound(res, ctx, pathname);
    return;
  }
  const kind = m[1] as CodemapKind;
  let name: string;
  try {
    name = decodeURIComponent(m[2] ?? '');
  } catch {
    sendNotFound(res, ctx, pathname);
    return;
  }
  if (!isSafeCodemapName(name)) {
    sendNotFound(res, ctx, pathname);
    return;
  }
  const result = renderCodemapViewPage(ctx.db, ctx.projectRoot, kind, name, ctxPage);
  if (result.status === 404) {
    sendNotFound(res, ctx, pathname);
    return;
  }
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(result.html);
}

/**
 * 单层名合法性(用于路由层工程名/表名校验,与 schema-reader.isSafeName 同口径)。
 *
 * 拒绝:空 / `.` / `..` / 含路径分隔符 / 含 `..` 子串 / 含 NUL。格式非法 →
 * 路由层 404(spec §5.2 / §11 #9,不进 render)。
 */
function isSafeSchemaName(name: string): boolean {
  if (name === '' || name === '.' || name === '..') return false;
  if (name.includes('/') || name.includes('\\')) return false;
  if (name.includes('\0')) return false;
  if (name.includes('..')) return false;
  return true;
}

/**
 * 开发任务路由:
 *   GET /tasks、/tasks/   列表页
 *   GET /tasks/<纯数字>   详情页(任务不存在 → 404)
 *   其余 /tasks/*         404
 * 门面 async,按 /timeline 分支同款 .then/.catch 兜底 500。
 */
function handleTasks(res: http.ServerResponse, ctx: HandlerContext, pathname: string): void {
  const pageCtx = { version: ctx.version, localHost: ctx.localHost, projectRoot: ctx.projectRoot };
  if (pathname === '/tasks' || pathname === '/tasks/') {
    renderTasksListPage(pageCtx)
      .then((html) => {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(html);
      })
      .catch((err) => sendInternalError(res, ctx, err));
    return;
  }
  const m = /^\/tasks\/(\d+)$/.exec(pathname);
  if (m?.[1] === undefined) {
    sendNotFound(res, ctx, pathname);
    return;
  }
  renderTaskDetailPage(ctx.db, Number(m[1]), pageCtx)
    .then((result) => {
      if (result.status === 404) {
        sendNotFound(res, ctx, pathname);
        return;
      }
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(result.html);
    })
    .catch((err) => sendInternalError(res, ctx, err));
}

/**
 * 构造请求处理器。闭包持有上下文(db / 版本 / 本地地址);处理器抛错
 * 统一兜底为 500 页。仅支持 GET;其它方法走「其他 → 404」。
 */
function createRequestHandler(ctx: HandlerContext): http.RequestListener {
  return (req, res) => {
    try {
      const url = new URL(req.url ?? '/', 'http://internal');
      const pathname = url.pathname;

      if (req.method === 'GET') {
        if (pathname === '/') {
          const html = renderOverviewPage(ctx.db, url.searchParams, {
            version: ctx.version,
            localHost: ctx.localHost,
          });
          res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
          res.end(html);
          return;
        }
        if (pathname === '/timeline') {
          // 门面 queryEvents/getEventStats 为 async(renderTimelinePage 返回 Promise);
          // .then/.catch 兜底:async 错误进 500 页,外层同步 try/catch 覆盖同步抛错路径。
          renderTimelinePage(url.searchParams, {
            version: ctx.version,
            localHost: ctx.localHost,
            projectRoot: ctx.projectRoot,
          })
            .then((html) => {
              res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
              res.end(html);
            })
            .catch((err) => sendInternalError(res, ctx, err));
          return;
        }
        if (pathname === '/assets' || pathname.startsWith('/assets/')) {
          tryServeAsset(res, ctx, pathname);
          return;
        }
        if (pathname === '/schema' || pathname.startsWith('/schema/')) {
          handleSchema(res, ctx, pathname);
          return;
        }
        if (pathname === '/map' || pathname.startsWith('/map/')) {
          handleCodemap(res, ctx, pathname);
          return;
        }
        if (pathname === '/tasks' || pathname.startsWith('/tasks/')) {
          handleTasks(res, ctx, pathname);
          return;
        }
        if (pathname === '/doc' || pathname.startsWith('/doc/')) {
          handleDocDetail(res, ctx, pathname);
          return;
        }
      }

      sendNotFound(res, ctx, pathname);
    } catch (err) {
      // 全局兜底:任何处理器抛错 → 500 页(可读原因,不输出堆栈)。
      sendInternalError(res, ctx, err);
    }
  };
}

/**
 * 启动本地只读 web 服务。
 *
 * 预检序列(契约,顺序固定):
 *   1–3. bootstrap.openVerifiedConnection(存在性 → 单连接 → schema);
 *   4.   `createServer(handler).listen(port, '127.0.0.1')`,EADDRINUSE →
 *        `WebStartupError { kind: 'port-in-use', port }`。
 *
 * @param options.port 允许传 0(测试临时端口;url 用 server.address() 实际端口)。
 */
export async function startWebServer(options: {
  projectRoot: string;
  port: number;
}): Promise<WebServer> {
  const { projectRoot, port } = options;

  // 预检 1–3:存在性 + 进程级单连接 + schema(只读)。
  const connection = openVerifiedConnection(projectRoot);
  const ctx: HandlerContext = {
    db: connection.getDb(),
    version: readVersion(),
    localHost: '', // listen 成功后回填实际 host:port(顶栏只读 pill 用)。
    projectRoot, // 详情页源文件读取基准(路径仅从索引 DB 解析到此根内)。
  };
  const server = http.createServer(createRequestHandler(ctx));

  // 预检 4:回环绑定。Promise 化 listen;EADDRINUSE 在 'error' 事件捕获
  // (不是同步 try/catch)。成功后移除一次性 error 监听,避免误吞运行期错误。
  try {
    await new Promise<void>((resolve, reject) => {
      const onError = (err: NodeJS.ErrnoException): void => {
        if (err.code === 'EADDRINUSE') {
          reject(
            new WebStartupError(
              'port-in-use',
              `port ${port} is already in use — use --port <port> to specify another port`,
              { port },
            ),
          );
        } else {
          reject(err);
        }
      };
      server.once('error', onError);
      server.listen(port, LOOPBACK_HOST, () => {
        server.removeListener('error', onError);
        resolve();
      });
    });
  } catch (err) {
    // 绑定失败:关掉已打开的连接,避免泄漏。
    connection.close();
    throw err;
  }

  const address = server.address() as AddressInfo;
  ctx.localHost = `${LOOPBACK_HOST}:${address.port}`;
  const url = `http://${ctx.localHost}`;

  return {
    url,
    async close(): Promise<void> {
      await new Promise<void>((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()));
      });
      connection.close();
    },
  };
}
