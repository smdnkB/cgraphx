/**
 * `cgraphx web [project-path]` 命令注册。
 *
 * 由组合根 src/cli/index.ts 接入(plan index 第 4 节记录的分层例外,仅此
 * 一处 wiring import)。action 内:解析/校验参数 → startWebServer → 装配
 * SIGINT/SIGTERM 优雅退出。startWebServer 本身不注册信号处理器(测试友好,
 * 防测试间信号处理器泄漏),进程级信号装配集中在此。
 */

import * as path from 'node:path';

import type { Command } from 'commander';

import { startWebServer, type WebServer } from './server';
import { exitCodeForWebError } from './errors';
import { resolveProjectRoot } from '../core/directory';

/** 把 `cgraphx web` 挂到 commander 程序上。 */
export function registerWebCommand(program: Command): void {
  program
    .command('web [project-path]')
    .description('Start the local read-only web viewer (knowledge base)')
    .option('-p, --port <port>', 'port to listen on (default 2468)', '2468')
    .action(async (pathArg: string | undefined, options: { port: string }) => {
      const projectRoot = pathArg ? path.resolve(pathArg) : resolveProjectRoot(process.cwd());

      // 端口解析:Number + 整数 + [1,65535]。CLI 层拒绝 0(0 仅测试经
      // startWebServer 直传使用)。非法 → stderr + exitCode 1(参数错误)。
      const port = Number(options.port);
      if (!Number.isInteger(port) || port < 1 || port > 65535) {
        process.stderr.write(
          `[web] invalid port "${options.port}" — must be an integer between 1 and 65535\n`,
        );
        process.exitCode = 1;
        return;
      }

      let srv: WebServer;
      try {
        srv = await startWebServer({ projectRoot, port });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        process.stderr.write(`[web] ${msg}\n`);
        process.exitCode = exitCodeForWebError(err);
        return;
      }

      console.log(`cgraphx web running at ${srv.url}`);

      // 优雅退出:SIGINT/SIGTERM → 关 server + DB,exit 0。
      const shutdown = (): void => {
        void srv
          .close()
          .catch(() => {
            // 关闭异常不阻塞退出。
          })
          .finally(() => process.exit(0));
      };
      process.once('SIGINT', shutdown);
      process.once('SIGTERM', shutdown);
    });
}
