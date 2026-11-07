/**
 * 看板本机服务(2026-11-06-agent看板 plan C-7;spec D2 🔒、D3)。
 *
 * 只听回环、随机端口、随机令牌(D2):对外地址一律 `http://127.0.0.1:<端口>/?t=<令牌>`,三个路由
 * (页面 / 只读数据 / 刷新)任一请求都要过令牌 + Host 校验,刷新再过 Origin 校验,任一不过 403。
 * 不接受路径参数、不做静态目录服务、除补录链路(经 refresh 回调,编排归 T-5 的 CLI)外不写任何东西。
 *
 * 服务自身不碰补录、不碰文件系统——唯一例外是 page.html 启动时读一次缓存(经 `__dirname` 相对
 * 路径,dist 镜像 src 布局,写法同 timeline 的 schema-bootstrap;构建期拷贝由 T-5 登记进
 * scripts/copy-assets.cjs)。
 */

import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as http from 'node:http';
import * as path from 'node:path';

import { BoardError } from './errors';
import type { BoardData } from './types';

/** 随机令牌的字节数(hex 后 48 字符;够长即可,无性能顾虑)。 */
const TOKEN_BYTES = 24;

/** createBoardServer 的入参:初始数据与刷新回调都由 CLI 侧的启动编排提供(C-8)。 */
export interface BoardServerOptions {
  /** 初始看板数据(C-6 形状;编排里 computeBoardData 的产出)。 */
  data: BoardData;
  /** 刷新回调:重跑「逐项目补录 + 数据装配」后返回新数据;并发由服务侧挡 409。 */
  refresh: () => Promise<BoardData>;
}

/** createBoardServer 的返回值:监听、对外地址与关闭。 */
export interface BoardServer {
  /** 对外地址(含 `?t=<令牌>`);listen() 完成前为 null。 */
  readonly address: string | null;
  /** 开始监听(127.0.0.1 随机端口);resolve 后 address 可用。 */
  listen(): Promise<void>;
  /** 停止监听并断开现有连接;幂等,可重复调用。 */
  close(): Promise<void>;
}

/** 看板服务的实现细节(不导出;外部只认 createBoardServer 的返回形状)。 */
class RunningBoardServer implements BoardServer {
  private readonly options: BoardServerOptions;
  private readonly token: string;
  /** 内存里的当前数据:初始为构造入参,每次刷新成功后整体替换。 */
  private current: BoardData;
  /** 刷新进行中标记:C-7 的 409 只看它,GET 不受影响。 */
  private refreshing = false;
  /** page.html 启动时读一次的缓存。 */
  private pageHtml: string | null = null;
  private port: number | null = null;
  private closed = false;
  private readonly server: http.Server;

  constructor(options: BoardServerOptions) {
    this.options = options;
    this.token = crypto.randomBytes(TOKEN_BYTES).toString('hex');
    this.current = options.data;
    this.server = http.createServer((req, res) => {
      this.handle(req, res);
    });
  }

  get address(): string | null {
    return this.port === null ? null : `http://127.0.0.1:${this.port}/?t=${this.token}`;
  }

  listen(): Promise<void> {
    if (this.port !== null) return Promise.resolve(); // 已在监听,重复调用不报错
    return new Promise<void>((resolve, reject) => {
      const onError = (err: Error) => reject(err);
      this.server.once('error', onError);
      this.server.listen(0, '127.0.0.1', () => {
        this.server.removeListener('error', onError);
        const addr = this.server.address();
        if (addr === null || typeof addr === 'string') {
          reject(new BoardError(`看板服务监听地址异常:${String(addr)}`));
          return;
        }
        this.port = addr.port;
        try {
          this.pageHtml = fs.readFileSync(path.join(__dirname, 'page.html'), 'utf-8');
        } catch (err) {
          this.port = null;
          this.server.close();
          reject(
            new BoardError(
              `看板页面缺失:${path.join(__dirname, 'page.html')} 读不到;` +
                '构建期应由 scripts/copy-assets.cjs 随包拷贝,请重新构建或重装 cgraphx。',
              { cause: err },
            ),
          );
          return;
        }
        resolve();
      });
    });
  }

  close(): Promise<void> {
    this.closed = true;
    return new Promise<void>((resolve) => {
      // closeAllConnections:长连接(浏览器的 keep-alive)不拖住退出。
      this.server.close(() => resolve());
      this.server.closeAllConnections();
    });
  }

  // ─── 路由与校验(C-7)──────────────────────────────────────────────────────

  private handle(req: http.IncomingMessage, res: http.ServerResponse): void {
    // 客户端半路断开时的写入错误不让进程崩(响应对面已不需要)。
    res.on('error', () => {});

    let url: URL;
    try {
      url = new URL(req.url ?? '/', 'http://127.0.0.1/');
    } catch {
      this.notFound(res);
      return;
    }
    if (url.searchParams.get('t') !== this.token || !this.hostOk(req)) {
      this.forbidden(res);
      return;
    }
    if (req.method === 'GET' && url.pathname === '/') {
      this.servePage(res);
    } else if (req.method === 'GET' && url.pathname === '/api/board') {
      this.sendJson(res, 200, this.current);
    } else if (req.method === 'POST' && url.pathname === '/api/refresh') {
      // 刷新会补录、写库:Origin 必须是看板自己的地址(页面里的刷新是同源 POST,浏览器一定带);
      // 没带也不放行(spec D2)。localhost 和 Host 校验一样算本机。
      const origin = req.headers.origin;
      if (origin !== `http://127.0.0.1:${this.port}` && origin !== `http://localhost:${this.port}`) {
        this.forbidden(res);
        return;
      }
      this.serveRefresh(req, res);
    } else {
      this.notFound(res);
    }
  }

  /** Host 头的 hostname 须是 127.0.0.1 / localhost;带端口时须等于监听端口。 */
  private hostOk(req: http.IncomingMessage): boolean {
    const host = req.headers.host;
    if (typeof host !== 'string' || host.length === 0) return false;
    // IPv6 字面量([::1]:端口)不在允许名单里,整体不剥端口、直接判不过。
    const hasPort = !host.startsWith('[') && host.includes(':');
    const hostname = (hasPort ? host.slice(0, host.lastIndexOf(':')) : host).toLowerCase();
    if (hostname !== '127.0.0.1' && hostname !== 'localhost') return false;
    if (hasPort) {
      const port = Number(host.slice(host.lastIndexOf(':') + 1));
      if (!Number.isInteger(port) || this.port === null || port !== this.port) return false;
    }
    return true;
  }

  private servePage(res: http.ServerResponse): void {
    if (this.pageHtml === null) {
      this.sendJson(res, 500, { error: 'page-missing' });
      return;
    }
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end(this.pageHtml);
  }

  private serveRefresh(req: http.IncomingMessage, res: http.ServerResponse): void {
    req.resume(); // 请求体不用,读完丢弃,免得挂着不结束
    if (this.refreshing) {
      this.sendJson(res, 409, { error: 'refresh-in-progress' });
      return;
    }
    if (this.closed) {
      this.sendJson(res, 503, { error: 'closing' });
      return;
    }
    this.refreshing = true;
    void Promise.resolve(this.options.refresh())
      .then((data) => {
        this.current = data; // 刷新成功才替换;失败保留旧数据
        this.sendJson(res, 200, data);
      })
      .catch((err: unknown) => {
        this.sendJson(res, 500, {
          error: 'refresh-failed',
          message: err instanceof Error ? err.message : String(err),
        });
      })
      .finally(() => {
        this.refreshing = false;
      });
  }

  // ─── 响应小工具(错误响应体格式属局部适配,状态码与语义按 C-7 不变)──────────

  private forbidden(res: http.ServerResponse): void {
    this.sendJson(res, 403, { error: 'forbidden' });
  }

  private notFound(res: http.ServerResponse): void {
    this.sendJson(res, 404, { error: 'not-found' });
  }

  private sendJson(res: http.ServerResponse, status: number, body: unknown): void {
    const text = JSON.stringify(body);
    res.writeHead(status, {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
    });
    res.end(text);
  }
}

/**
 * 建看板服务(函数名钉死,T-5 的 CLI 直接引用)。只创建不监听:启动顺序由 CLI 编排(C-8)——
 * 先补录、装配,再 `await server.listen()`,打印 server.address 后开浏览器。
 */
export function createBoardServer(options: BoardServerOptions): BoardServer {
  return new RunningBoardServer(options);
}
