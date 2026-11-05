/**
 * 已下掉功能的五个兼容空命令(spec:2026-11-05-下掉web与平台同步 F3 D8)
 *
 * `sync-session-start-hook`、`sync-stop-hook`、`task-session-start-hook`、`task-stop-hook`、
 * `task-post-tool-use-hook`:升级了新版、还没重装的项目,agent 配置里还挂着旧的平台上报、开发任务 hook;
 * 子命令已经没有,直接删掉会让每次触发都报 unknown command。这五个留成隐藏空命令兜住:读完 stdin、
 * 不输出、退出码 0——不带容错后缀的旧条目也不报错。不进任何 core 子系统(子系统已删);install/uninstall
 * 的死 hook 清理把配置里的条目删掉之后,它们不再被调起。
 *
 * 名单与 `installer/targets/agent-target.ts` 的 `REMOVED_FEATURE_HOOK_COMMANDS` 同源(完整子命令名)。
 */

import type { Command } from 'commander';

import { AGENT_OPTION_FLAG } from '../core/agents';

/** 已下掉的旧 hook 子命令名(与 agent-target.ts 的死 hook 清理同一批)。 */
const LEGACY_HOOK_SUBCOMMANDS = [
  'sync-session-start-hook',
  'sync-stop-hook',
  'task-session-start-hook',
  'task-stop-hook',
  'task-post-tool-use-hook',
] as const;

/**
 * 把 stdin 读完到 EOF:宿主写完 hook payload 就关管道,不读完宿主会碰到 EPIPE。读到的内容丢弃;手动在
 * 终端调起(没有管道)时直接返回,不挂着等 Ctrl-D。读取出错也一样安静结束。
 */
function drainStdin(): Promise<void> {
  if (process.stdin.isTTY) return Promise.resolve();
  return new Promise((resolve) => {
    process.stdin.setEncoding('utf8');
    process.stdin.resume();
    process.stdin.on('data', () => {
      // 内容丢弃:只为把流读完
    });
    process.stdin.on('end', () => resolve());
    process.stdin.on('error', () => resolve());
  });
}

/**
 * 注册五个隐藏空命令:`{ hidden: true }`;`--agent <id>` 收下不解析(旧配置带着它);其余未知选项也不报错。
 * 行为只有一件事——把 stdin 读完到 EOF,不写 stdout/stderr、不读写任何库与文件,退出码恒 0。
 */
export function registerLegacyHookCommands(program: Command): void {
  for (const subcommand of LEGACY_HOOK_SUBCOMMANDS) {
    program
      .command(subcommand, { hidden: true })
      .allowUnknownOption()
      .description('已下掉的旧 hook 子命令,只为兼容保留:读完输入,不做任何事')
      .option(`${AGENT_OPTION_FLAG} <id>`, '兼容旧配置:收下不解析')
      .action(async () => {
        await drainStdin();
      });
  }
}
