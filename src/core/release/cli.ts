/**
 * release 子系统的 CLI 接线。
 *
 * 导出 `registerReleaseCommands(program)`,由主 CLI(src/cli/index.ts)调用一次。命令面:
 *   - cgraphx release guard [--remove] [--json]   在当前目录所在仓库装上 / 卸掉版本分支提交拦截
 *
 * 输出:带 --json 时 stdout 出 `{ "ok": true, ...GuardResult }`,失败出 `{ "ok": false, "code", "message" }`
 * (code 取 ReleaseError 的 code,其余错误为 runtime_error);不带 --json 时结果走 stdout,
 * 错误与提示走 stderr、前缀 `[release]`。
 *
 * 退出码(exitCodeForError):0 成功(含 unsupported:钩子文件不是 shell 脚本,没装上)/
 * 1 其它 / 2 不在 git 仓库。
 */

import * as path from 'node:path';

import type { Command } from 'commander';

import { exitCodeForError, installReleaseGuard, ReleaseError, removeReleaseGuard } from './index';
import type { GuardResult } from './types';

interface GuardOptions {
  remove?: boolean;
  json?: boolean;
}

function writeJson(value: unknown): void {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

function writeOut(msg: string): void {
  process.stdout.write(`${msg}\n`);
}

/** stderr 输出 `[release] <message>`。 */
function writeErr(msg: string): void {
  process.stderr.write(`[release] ${msg}\n`);
}

/** 不带 --json 时的结果输出:unsupported 只在 stderr 打提示,其余在 stdout 打一行结果。 */
function printGuard(result: GuardResult): void {
  const hookPath = result.hookPath ?? '';
  switch (result.status) {
    case 'unsupported':
      writeErr(`钩子文件 ${hookPath} 不是 shell 脚本,没装上提交拦截`);
      break;
    case 'installed':
      writeOut(`已装上版本分支提交拦截:${hookPath}`);
      break;
    case 'present':
      writeOut(`版本分支提交拦截已经装好:${hookPath}`);
      break;
    case 'updated':
      writeOut(`已把版本分支提交拦截更新为当前版本:${hookPath}`);
      break;
    case 'repaired':
      writeOut(`提交拦截的钩子片段不见了,已重新装上:${hookPath}`);
      break;
    case 'removed':
      writeOut(`已卸掉版本分支提交拦截:${hookPath}`);
      break;
    case 'absent':
      writeOut(
        result.hookPath === null
          ? '不在 git 仓库里,没有要卸的提交拦截'
          : `没有装过版本分支提交拦截(${hookPath} 里没有拦截片段)`,
      );
      break;
  }
  if (result.hooksDirTracked && result.hookPath !== null) {
    writeErr(`钩子目录 ${path.dirname(result.hookPath)} 由 git 跟踪,改动会出现在 git status 里`);
  }
}

/** 把 `release` 命令组挂到 commander 程序上。主 CLI 调用一次。 */
export function registerReleaseCommands(program: Command): void {
  const release = program
    .command('release')
    .description('版本流程 — 版本分支(dev/<版本号>)的提交拦截');

  release
    .command('guard')
    .description(
      '在 commit-msg 钩子里装上版本分支提交拦截:版本分支只收合并提交和 chore(release): 开头的提交',
    )
    .option('--remove', '卸掉提交拦截(删掉钩子片段和本地 git 配置里的记号)')
    .option('--json', '输出机器可读 JSON')
    .action((opts: GuardOptions) => {
      const cwd = process.cwd();
      try {
        const result = opts.remove === true ? removeReleaseGuard(cwd) : installReleaseGuard(cwd);
        if (opts.json === true) writeJson({ ok: true, ...result });
        else printGuard(result);
      } catch (err) {
        process.exitCode = exitCodeForError(err);
        const message = err instanceof Error ? err.message : String(err);
        if (opts.json === true) {
          const code = err instanceof ReleaseError ? err.code : 'runtime_error';
          writeJson({ ok: false, code, message });
          return;
        }
        writeErr(message);
      }
    });
}
