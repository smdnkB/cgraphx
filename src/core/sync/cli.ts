/**
 * sync 子系统的 CLI 接线。
 *
 * 导出 `registerSyncCommands(program)`,由主 CLI(src/cli/index.ts)调用一次。本任务命令面:
 *   - cgraphx sync connect    [--server <url>] [--user <name>] [--force] [--password-stdin] [--json]
 *   - cgraphx sync disconnect [--json]
 *   - cgraphx sync now        [--json]
 *   - cgraphx sync status     [--json]
 *   - cgraphx sync-worker     [--project <path>]   (隐藏顶层命令,由 hook / connect 拉起)
 *   - cgraphx sync-session-start-hook [--agent <id>] / sync-stop-hook [--agent <id>](隐藏 hook 入口)
 *
 * 密码不进命令行参数:终端交互关回显输入,或 `--password-stdin` 从 stdin 读第一行。
 * 退出码经 exitCodeForError / exitCodeForRunResult。stderr 错误带 `[sync]` 前缀;错误输出不含 token / 密码。
 */

import readline from 'node:readline';
import { Writable } from 'node:stream';

import type { Command } from 'commander';

import { AGENT_OPTION_FLAG, resolveHookAgent } from '../agents';
import { resolveProjectRoot } from '../directory';
import { PLATFORM_HINTS } from './constants';
import {
  SyncArgError,
  SyncNetworkError,
  SyncNotConnectedError,
  SyncPlatformError,
  connectPlatform,
  disconnectPlatform,
  exitCodeForError,
  exitCodeForRunResult,
  getSyncStatus,
  readConnection,
  runSync,
  runWorker,
  spawnSyncWorker,
  syncSessionStartHook,
  syncStopHook,
} from './index';
import type { ConnectOutcome, SyncRunResult, SyncStatusReport } from './types';

// ─── 输出 ───────────────────────────────────────────────────────────────────

function writeJson(value: unknown): void {
  process.stdout.write(JSON.stringify(value, null, 2) + '\n');
}

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

function renderRunResult(result: SyncRunResult): { stdout: string | null; stderr: string | null } {
  if (result.stoppedBy === 'paused') return { stdout: null, stderr: `[sync] 同步已暂停:${result.error ?? '-'}` };
  if (result.stoppedBy === 'failing') {
    return { stdout: null, stderr: `[sync] 同步失败:${result.error ?? '-'},本地数据已保留,稍后自动重试` };
  }
  let line = `同步完成:上报 ${result.sessionsSent} 个会话、${result.recordsSent} 条记录`;
  if (result.isolatedNew > 0) line += `;${result.isolatedNew} 个会话被平台拒收,已隔离`;
  return { stdout: line, stderr: null };
}

function describeRunResult(result: SyncRunResult): string {
  if (result.stoppedBy === 'paused') return `${result.at} 已暂停:${result.error ?? '-'}`;
  if (result.stoppedBy === 'failing') return `${result.at} 失败:${result.error ?? '-'}`;
  if (result.stoppedBy !== null) return `${result.at} 未执行(${result.stoppedBy})`;
  return `${result.at} 成功,上报 ${result.sessionsSent} 个会话、${result.recordsSent} 条记录${
    result.warnings > 0 ? `,平台提示 ${result.warnings} 条` : ''
  }`;
}

/** `sync status` 的文本输出(`sync connect` 已接入分支复用)。 */
function renderStatus(report: SyncStatusReport): string {
  const c = report.connection;
  const s = report.state;
  const lines = [
    `平台地址:${c?.serverUrl ?? '-'}`,
    `项目:${c?.projectName ?? '-'}`,
    `账号:${c?.username ?? '-'}`,
    `平台协议版本:${s.serverProtocolVersion ?? '未知'}`,
    `最后成功同步:${s.lastSuccessAt ?? '尚未成功同步'}`,
    `积压:${report.backlogEvents} 条事件 / ${report.pendingSessions} 个会话`,
  ];
  if (s.pausedReason !== null) lines.push(`已暂停:${PLATFORM_HINTS[s.pausedReason] ?? s.pausedReason}`);
  if (report.isolatedSessions > 0) lines.push(`有 ${report.isolatedSessions} 个会话被平台拒收`);
  if (s.lastResult !== null) lines.push(`最近一次:${describeRunResult(s.lastResult)}`);
  if (s.lastError !== null && s.lastResult?.stoppedBy !== 'failing') lines.push(`最近错误:${s.lastError}`);
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
          if (outcome.kind === 'already') {
            // spec §3.1:已接入 → 显示同步状态
            const status = await getSyncStatus(projectRoot);
            if (opts.json) writeJson({ ...outcome, status });
            else process.stdout.write(renderConnect(outcome) + '\n' + renderStatus(status) + '\n');
          } else if (opts.json) writeJson(outcome);
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

  sync
    .command('now')
    .description('立即同步:前台上报本仓库积压的研发数据')
    .option('--json', '输出机器可读 JSON')
    .action(async (opts: { json?: boolean }) => {
      try {
        const projectRoot = resolveProjectRoot(process.cwd());
        const result = await runSync(projectRoot, 'foreground');
        if (opts.json) writeJson(result);
        else {
          const out = renderRunResult(result);
          if (out.stdout !== null) process.stdout.write(out.stdout + '\n');
          if (out.stderr !== null) process.stderr.write(out.stderr + '\n');
        }
        process.exitCode = exitCodeForRunResult(result);
      } catch (err) {
        renderError(err, null);
      }
    });

  sync
    .command('status')
    .description('查看本仓库的同步状态(接入信息、积压、暂停原因、最近结果)')
    .option('--json', '输出机器可读 JSON')
    .action(async (opts: { json?: boolean }) => {
      try {
        const projectRoot = resolveProjectRoot(process.cwd());
        const report = await getSyncStatus(projectRoot);
        if (!report.connected) throw new SyncNotConnectedError('未接入平台(cgraphx sync connect 接入)');
        if (opts.json) writeJson(report);
        else process.stdout.write(renderStatus(report) + '\n');
      } catch (err) {
        renderError(err, null);
      }
    });

  // 隐藏顶层命令:后台 worker(stdout 恒空,退出码恒 0)
  program
    .command('sync-worker', { hidden: true })
    .option('--project <path>', '项目根目录')
    .action(async (opts: { project?: string }) => {
      try {
        await runWorker(opts.project ?? resolveProjectRoot(process.cwd()));
      } catch {
        // runWorker 自行写 stderr;此处兜底保证退出码 0
      }
    });

  // 隐藏 hook 入口:由目标项目 agent settings 的 SessionStart / Stop / SessionEnd 调起,退出码恒为 0;
  // --agent 缺省或无法识别时按 Claude Code 处理
  program
    .command('sync-session-start-hook', { hidden: true })
    .option(`${AGENT_OPTION_FLAG} <id>`)
    .action(async (opts: { agent?: string }) => { await syncSessionStartHook(resolveHookAgent(opts.agent)); });
  program
    .command('sync-stop-hook', { hidden: true })
    .option(`${AGENT_OPTION_FLAG} <id>`)
    .action(async (opts: { agent?: string }) => { await syncStopHook(resolveHookAgent(opts.agent)); });
}
