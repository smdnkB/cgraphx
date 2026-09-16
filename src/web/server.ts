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
import { renderShellPage } from './layout';
import { renderOverviewPage } from './pages-overview';
import { renderDetailPage } from './pages-detail';
import { renderTimelinePage } from './pages-timeline';
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
  opts: { title: string; active: 'knowledge' | 'timeline' | 'none'; contentHtml: string },
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
