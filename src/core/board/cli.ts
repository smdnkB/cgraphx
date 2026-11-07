/**
 * board 子系统的 CLI 接线(2026-11-06-agent看板 T-5;spec F1 行为链、D4、D1)。
 *
 * 导出 `registerBoardCommands(program)`,由主 CLI(src/cli/index.ts)调用一次。命令面只有一个:
 *   - cgraphx board —— 任意目录可跑,不依赖 cwd 是项目目录(项目经 project 门面 listProjects 枚举)。
 *
 * 启动编排照 plan C-8 钉死的顺序:枚举项目 → 逐项目补录(一组一行进度)→ 数据装配 → 起本机服务
 * (只听 127.0.0.1,随机端口 + 随机令牌)→ 打印带令牌地址 → 打开浏览器(可注入;失败只打降级提示,
 * 服务照常跑)→ 等 Ctrl+C / SIGTERM 关服务退出(退出码 0)。刷新 = 重跑「逐项目补录 + 数据装配」,
 * 经 refresh 回调由服务侧调回(并发被服务侧按 C-7 挡 409)。不做 --json、不做固定端口(spec D4)。
 *
 * 输出:进度与地址走 stdout;错误与降级提示走 stderr、前缀 `[board]`。错误退出码经 exitCodeForError
 * 映射,不散落错误码字面量(收尾兜底的 process.exit(0) 不是错误路径)。
 */

import { spawn } from 'node:child_process';

import type { Command } from 'commander';

import { NOTICE_DIRS_GONE, SYNC_NOTICE_BY_STATUS } from './constants';
import { BoardError, exitCodeForError } from './errors';
import { computeBoardData, enumerateBoardGroups, syncProjects } from './index';
import { createBoardServer } from './server';
import type { BoardServer } from './server';
import type { BoardData, BoardSyncItem } from './types';

function writeOut(msg: string): void {
  process.stdout.write(`${msg}\n`);
}

/** stderr 输出 `[board] <message>`。 */
function writeErr(msg: string): void {
  process.stderr.write(`[board] ${msg}\n`);
}

/**
 * 逐项目进度行(C-8):synced/rebuilt 打「已补录 X 个会话」(X 取 outcome.sessions,undefined 按 0);
 * busy/skipped-*/failed 打 C-13 对应文案;目录全不在没补录的(outcome 为 null)打 C-9 那句。
 */
function syncLine(item: BoardSyncItem): string {
  const name = `  ${item.group.name}  `;
  const { outcome } = item;
  if (outcome === null) return `${name}${NOTICE_DIRS_GONE}`;
  const notice = SYNC_NOTICE_BY_STATUS[outcome.status];
  if (notice !== null) return `${name}${notice}`;
  return `${name}已补录 ${outcome.sessions ?? 0} 个会话`;
}

/**
 * 逐项目补录 + 数据装配(C-8 启动与刷新共用)。逐组单调 syncProjects——门面收预枚举组,一组一调
 * 正是为了每组补完就能打一行进度;全部完成后 computeBoardData 装配。有在用主目录的组才算进
 * 「正在补录 N 个项目」的 N,目录全不在的组不补录、只打一行提示。
 */
async function syncAndCompute(): Promise<BoardData> {
  const groups = enumerateBoardGroups();
  const syncable = groups.filter((group) => group.dirs.length > 0);
  writeOut(`正在补录 ${syncable.length} 个项目…`);
  const items: BoardSyncItem[] = [];
  for (const group of groups) {
    let item: BoardSyncItem = { group, outcome: null };
    if (group.dirs.length > 0) {
      const [synced] = await syncProjects([group]);
      if (synced !== undefined) item = synced;
    }
    items.push(item);
    writeOut(syncLine(item));
  }
  return computeBoardData(items);
}

// ─── 打开浏览器(可注入;C-8)────────────────────────────────────────────────

/** C-8 的降级文案:浏览器没打开时提示手动访问带令牌地址,服务照常跑。 */
function browserFallback(url: string): void {
  writeErr(`浏览器没打开,手动访问 ${url}`);
}

/**
 * 默认打开函数:darwin `open`、win32 `cmd /c start`(空标题占位,免得 start 把 URL 当窗口标题)、
 * 其余 `xdg-open`。起不来(error)或退出码非 0 都算失败,异步打降级提示。
 */
function defaultOpenBrowser(url: string): void {
  let command = 'xdg-open';
  const args: string[] = [url];
  if (process.platform === 'win32') {
    command = 'cmd';
    args.unshift('/c', 'start', '');
  } else if (process.platform === 'darwin') {
    command = 'open';
  }
  const child = spawn(command, args, { stdio: 'ignore' });
  let reported = false;
  const fail = (): void => {
    if (reported) return;
    reported = true;
    browserFallback(url);
  };
  child.once('error', fail);
  child.once('exit', (code) => {
    if (code !== 0) fail();
  });
}

/** 等 Ctrl+C / SIGTERM:收到信号关掉服务、正常返回(进程自然退出,退出码 0);关停期间再来一次信号直接退,免得卡住终端。 */
function waitForExitSignal(server: BoardServer): Promise<void> {
  return new Promise<void>((resolve) => {
    let closing = false;
    const onSignal = (): void => {
      if (closing) {
        process.exit(0); // 收尾兜底,不是错误路径
        return;
      }
      closing = true;
      process.removeListener('SIGINT', onSignal);
      process.removeListener('SIGTERM', onSignal);
      void server.close().then(
        () => resolve(),
        () => resolve(),
      );
    };
    process.on('SIGINT', onSignal);
    process.on('SIGTERM', onSignal);
  });
}

/** runBoard 的可注入参数:打开浏览器的函数(默认按平台 spawn),测试注入记录器即可不真开窗口。 */
export interface RunBoardOptions {
  openBrowser?: (url: string) => void;
}

/**
 * `cgraphx board` 的完整启动链(C-8):补录 → 装配 → 起服务 → 打地址 → 开浏览器 → 等信号退出。
 * 单独导出是为了可注入 openBrowser;registerBoardCommands 无参调它。
 */
export async function runBoard(options: RunBoardOptions = {}): Promise<void> {
  const openBrowser = options.openBrowser ?? defaultOpenBrowser;

  const data = await syncAndCompute();
  const server = createBoardServer({
    data,
    refresh: async () => {
      writeOut(''); // 刷新的进度行与启动输出空开一行
      return syncAndCompute();
    },
  });
  await server.listen();

  const address = server.address;
  if (address === null) {
    // listen 已 resolve 而 address 为 null:理论到不了,守住类型与运行时
    void server.close();
    throw new BoardError('看板服务没有拿到监听地址,启动失败');
  }

  writeOut('');
  writeOut(`看板已打开:${address}`);
  try {
    openBrowser(address);
  } catch {
    browserFallback(address); // 打开函数同步抛了:打降级提示,服务照常跑
  }
  writeOut('按 Ctrl+C 退出');
  await waitForExitSignal(server);
}

/** 把 `board` 命令挂到 commander 程序上。主 CLI 调用一次(interface-standards 的注册形态)。 */
export function registerBoardCommands(program: Command): void {
  program
    .command('board')
    .description(
      '打开本机任务看板:先逐项目补录时间线,再启动只听本机的网页(左栏任务、右栏会话),Ctrl+C 退出',
    )
    .action(() => {
      // commander 的 parse 不 await 异步 action:异常自己接住,经 exitCodeForError 映射退出码,
      // 不留未处理的 rejection
      runBoard().catch((err: unknown) => {
        process.exitCode = exitCodeForError(err);
        writeErr(err instanceof Error ? err.message : String(err));
      });
    });
}
