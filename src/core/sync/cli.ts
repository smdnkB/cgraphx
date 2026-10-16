/**
 * sync 子系统的 CLI 接线。
 *
 * 导出 `registerSyncCommands(program)`,由主 CLI(src/cli/index.ts)调用一次。本任务命令面:
 *   - cgraphx sync connect    [--server <url>] [--user <name>] [--force] [--password-stdin] [--json]
 *   - cgraphx sync disconnect [--json]
 *
 * 密码不进命令行参数:终端交互关回显输入,或 `--password-stdin` 从 stdin 读第一行。
 * 退出码经 exitCodeForError。stderr 错误带 `[sync]` 前缀;错误输出不含 token / 密码。
 */

import readline from 'node:readline';
import { Writable } from 'node:stream';

import type { Command } from 'commander';

import { resolveProjectRoot } from '../directory';
import {
  SyncArgError,
  SyncNetworkError,
  SyncPlatformError,
  connectPlatform,
  disconnectPlatform,
  exitCodeForError,
  readConnection,
  spawnSyncWorker,
} from './index';
import type { ConnectOutcome } from './types';

// ─── 输出 ───────────────────────────────────────────────────────────────────

function writeJson(value: unknown): void {
  process.stdout.write(JSON.stringify(value, null, 2) + '\n');
}

/** 平台错误码 → 提示(spec §3.3)。 */
const PLATFORM_HINTS: Record<string, string> = {
  invalid_credentials: '账号或密码错误',
  account_disabled: '平台账号已停用,请联系平台管理员',
  repo_not_registered: '本仓库未在平台登记,请联系项目管理员',
  repo_disabled: '本仓库的平台登记已停用',
  not_project_member: '你不是该仓库所属项目的成员',
  invalid_token: '上报凭据已失效,请重新接入(cgraphx sync connect)',
};

/** stderr 输出 `[sync] <提示>`,设置退出码。 */
function renderError(err: unknown, serverUrl: string | null): void {
  let msg: string;
  if (err instanceof SyncPlatformError) {
    msg = PLATFORM_HINTS[err.code] ?? `平台返回错误:${err.message}`;
  } else if (err instanceof SyncNetworkError) {
    msg = `无法连接平台${serverUrl ? ` ${serverUrl}` : ''},请检查平台地址与网络`;
  } else {
    msg = err instanceof Error ? err.message : String(err);
  }
  process.stderr.write(`${msg.startsWith('[sync]') ? msg : `[sync] ${msg}`}\n`);
  process.exitCode = exitCodeForError(err);
}

function renderConnect(outcome: ConnectOutcome): string {
  const c = outcome.connection;
  if (outcome.kind === 'already') {
    return `已接入平台(${c.serverUrl},账号 ${c.username ?? '未知'})。如需换账号请加 --force。`;
  }
  const lines = [
    `已接入平台项目「${c.projectName ?? '-'}」(账号 ${c.username ?? '未知'}),正在后台回传本仓库全部历史;用 cgraphx sync status 查看进度。`,
  ];
  if (outcome.replacedExisting) {
    lines.push('已替换本地旧凭据;旧凭据在平台上仍有效(服务端尚不作废旧凭据)。');
  }
  return lines.join('\n');
}

// ─── 密码读取 ───────────────────────────────────────────────────────────────

/** 从 stdin 读第一行(去掉行尾 \r\n)。 */
function readFirstLineFromStdin(): Promise<string> {
  return new Promise((resolve, reject) => {
    let buf = '';
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      process.stdin.removeListener('data', onData);
      process.stdin.removeListener('end', onEnd);
      process.stdin.removeListener('error', onError);
      process.stdin.pause();
      const nl = buf.indexOf('\n');
      resolve((nl === -1 ? buf : buf.slice(0, nl)).replace(/\r$/, ''));
    };
    const onData = (chunk: Buffer | string) => {
      buf += chunk.toString();
      if (buf.includes('\n')) finish();
    };
    const onEnd = () => finish();
    const onError = (err: Error) => {
      if (done) return;
      done = true;
      reject(new SyncArgError(`读取 stdin 失败:${err.message}`));
    };
    process.stdin.on('data', onData);
    process.stdin.on('end', onEnd);
    process.stdin.on('error', onError);
    process.stdin.resume();
  });
}

/** 终端交互读一行,不回显输入(提示写 stderr,不污染 --json 的 stdout)。 */
function readHiddenLineFromTty(prompt: string): Promise<string> {
  return new Promise((resolve) => {
    let muted = false;
    const output = new Writable({
      write(chunk, _encoding, callback) {
        if (!muted) process.stderr.write(chunk);
        callback();
      },
    });
    const rl = readline.createInterface({ input: process.stdin, output, terminal: true });
    process.stderr.write(prompt);
    muted = true;
    rl.question('', (answer) => {
      rl.close();
      process.stderr.write('\n');
      resolve(answer);
    });
  });
}

function makePasswordReader(passwordStdin: boolean): () => Promise<string> {
  return async () => {
    if (passwordStdin) return readFirstLineFromStdin();
    if (process.stdin.isTTY) return readHiddenLineFromTty('平台密码: ');
    throw new SyncArgError('请在终端交互输入密码,或用 --password-stdin');
  };
}

// ─── 注册 ───────────────────────────────────────────────────────────────────

/** 把 `sync` 命令组挂到 commander 程序上。主 CLI 调用一次。 */
export function registerSyncCommands(program: Command): void {
  const sync = program.command('sync').description('接入研发管理平台 — 接入 / 断开,自动上报本仓库的研发数据');

  sync
    .command('connect')
    .description('用平台账号接入本仓库(密码交互输入,或用 --password-stdin)')
    .option('--server <url>', '平台地址,如 https://platform.example.com')
    .option('--user <name>', '平台账号')
    .option('--force', '不管是否已接入都重新接入(换账号 / 换凭据)')
    .option('--password-stdin', '从 stdin 读取密码(第一行)')
    .option('--json', '输出机器可读 JSON')
    .action(
      async (opts: { server?: string; user?: string; force?: boolean; passwordStdin?: boolean; json?: boolean }) => {
        const projectRoot = resolveProjectRoot(process.cwd());
        try {
          const outcome = await connectPlatform(projectRoot, {
            serverUrl: opts.server,
            username: opts.user,
            force: opts.force === true,
            readPassword: makePasswordReader(opts.passwordStdin === true),
          });
          if (outcome.kind === 'connected') spawnSyncWorker(projectRoot);
          if (opts.json) writeJson(outcome);
          else process.stdout.write(renderConnect(outcome) + '\n');
        } catch (err) {
          let serverUrl: string | null = opts.server?.trim().replace(/\/+$/, '') ?? null;
          if (serverUrl === null) {
            try {
              serverUrl = readConnection(projectRoot)?.serverUrl ?? null;
            } catch {
              serverUrl = null;
            }
          }
          renderError(err, serverUrl);
        }
      },
    );

  sync
    .command('disconnect')
    .description('断开平台:删除本地凭据,停止上报(本地与平台数据均保留)')
    .option('--json', '输出机器可读 JSON')
    .action((opts: { json?: boolean }) => {
      try {
        const projectRoot = resolveProjectRoot(process.cwd());
        const removed = disconnectPlatform(projectRoot);
        if (opts.json) writeJson({ removed });
        else
          process.stdout.write(
            (removed ? '已断开平台:本地凭据已删除,停止上报;本地与平台数据均保留。' : '未接入,无需断开。') + '\n',
          );
      } catch (err) {
        renderError(err, null);
      }
    });
}
