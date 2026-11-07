/**
 * commit-gate 子系统的 CLI 接线。
 *
 * 导出 `registerCommitGateCommands(program)`,由主 CLI(src/cli/index.ts)调用一次。命令面只有
 * 一个隐藏顶层命令(commit-msg 片段经 PATH 调起,不供人直接使用):
 *   - cgraphx commit-gate-hook <说明文件>   门禁判定,打回原文写 stderr
 *
 * 退出码是领域信号,不走 exitCodeForError 的错误映射(interface-standards 的一条例外,由
 * T-10 更新规范时写明):
 *   - 0 放行 —— 含检查跑不起来 / 超时 / 一切降级与放行分支,以及自身任何意外
 *     (门禁挂了不能让人提交不了,全局约束)
 *   - 3 打回 —— stderr 打打回原文,由 git 钩子片段回显给提交的人 / agent
 */

import type { Command } from 'commander';

import { runCommitGate } from './index';
import { COMMIT_GATE_HOOK_COMMAND } from './constants';

/** 把 commit-gate 的隐藏命令挂到 commander 程序上。主 CLI 调用一次。 */
export function registerCommitGateCommands(program: Command): void {
  program
    .command(`${COMMIT_GATE_HOOK_COMMAND} <messageFile>`, { hidden: true })
    .description('commit-msg 钩子里的提交门禁(由 git 钩子片段调起,不供人直接使用)')
    .action((messageFile: string) => {
      try {
        const outcome = runCommitGate(process.cwd(), messageFile);
        if (outcome.decision === 'rejected') {
          if (outcome.reason !== undefined) process.stderr.write(`${outcome.reason}\n`);
          process.exitCode = 3;
        }
      } catch (err) {
        // 兜底:任何意外都放行 —— 门禁挂了不能让人提交不了
        const msg = err instanceof Error ? err.message : String(err);
        process.stderr.write(`[commit-gate] 门禁检查没跑成,放行:${msg}\n`);
      }
    });
}
