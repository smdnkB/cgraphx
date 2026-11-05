/**
 * project 子系统的 CLI 接线(spec:2026-11-05-数据按项目放用户目录 D17;index C-13)。
 *
 * 导出 `registerProjectCommands(program)`,由主 CLI(src/cli/index.ts)调用一次。命令面:
 *   - cgraphx project show [--json]
 *   - cgraphx project name <名称>
 *   - cgraphx project list [--json]
 *   - cgraphx project remove <目录名> [--backups] [--yes]
 *
 * show、name 的起点是当前目录往上第一个装过的目录(没有就是当前目录)。结果走 stdout,错误走 stderr、前缀
 * `[project]`;退出码经 exitCodeForError:认不出项目、记不下名字、还有没并过去的旧数据 → 2,其余错误 → 1。
 * 文本输出里时间是本地时间 `MM-DD HH:mm`,路径的家目录前缀写成 `~`;--json 原样给绝对路径、字节数、ISO 时间。
 */

import * as readline from 'node:readline';

import type { Command } from 'commander';

import { resolveProjectRoot } from '../directory';
import {
  executeRemoval,
  exitCodeForError,
  listProjects,
  planRemoval,
  ProjectError,
  renameProject,
  showProject,
} from './index';
import { displayPath } from './show';
import type { ProjectKind, ProjectListItem, ProjectShowReport } from './types';

interface JsonOption {
  json?: boolean;
}

interface RemoveOptions {
  backups?: boolean;
  yes?: boolean;
}

const KIND_LABELS: Readonly<Record<ProjectKind, string>> = {
  origin: '按 origin 认',
  name: '按名字认',
  'origin+name': '按 origin 加名字认',
};

/** M15:`project show` 在旧库。 */
const LEGACY_SHOW_NOTICE = '这个目录还有没并过去的旧数据,运行 cgraphx install 并过去';

const NEEDS_YES_MESSAGE = '没给 --yes,非交互终端里不删;确认要删就加 --yes';
const CONFIRM_PROMPT = '确认删除?输入 y 确认:';
/** M18:不确认。 */
const NOT_REMOVED_LINE = '没有删除';

/** 没有时间时写的占位。 */
const NO_TIME_TEXT = '—';

const BYTES_PER_UNIT = 1024;
const SIZE_UNITS = ['K', 'M', 'G', 'T'] as const;

function writeJson(value: unknown): void {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

function writeOut(msg: string): void {
  process.stdout.write(`${msg}\n`);
}

/** stderr 输出 `[project] <message>`。 */
function writeErr(msg: string): void {
  process.stderr.write(`[project] ${msg}\n`);
}

/** 失败:退出码按错误类型映射,消息走 stderr。 */
function fail(err: unknown): void {
  process.exitCode = exitCodeForError(err);
  writeErr(err instanceof Error ? err.message : String(err));
}

/** ISO 时间 → 本地 `MM-DD HH:mm`;没有、解析不了 → `—`。 */
function formatMinute(iso: string | null): string {
  if (iso === null) return NO_TIME_TEXT;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return NO_TIME_TEXT;
  const pad = (n: number): string => String(n).padStart(2, '0');
  return `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** 字节数 → `512B`、`3.4K`、`120M`(小于 10 留一位小数)。 */
function formatSize(bytes: number): string {
  if (bytes < BYTES_PER_UNIT) return `${bytes}B`;
  let value = bytes;
  let unit: string = SIZE_UNITS[0];
  for (const u of SIZE_UNITS) {
    value /= BYTES_PER_UNIT;
    unit = u;
    if (value < BYTES_PER_UNIT) break;
  }
  return `${value < 10 ? value.toFixed(1) : String(Math.round(value))}${unit}`;
}

function printShow(report: ProjectShowReport): void {
  const { project } = report;
  const kind = project.kind !== null ? `(${KIND_LABELS[project.kind]})` : '';
  writeOut(`项目:${project.display}${kind}`);
  const data = report.mode === 'none' || report.dataDir === null ? '还没有数据' : displayPath(report.dataDir);
  writeOut(`数据:${data}`);
  writeOut(report.mode === 'legacy' ? `这个目录:旧库——${LEGACY_SHOW_NOTICE}` : '这个目录:项目库');
  writeOut('本机出现过的目录:');
  if (report.roots.length === 0) writeOut('  (还没有记录)');
  for (const root of report.roots) {
    const gone = root.exists ? '' : ',目录已不在';
    writeOut(`  ${displayPath(root.path)}  ${formatMinute(root.lastActiveAt)} 最后活动${gone}`);
  }
}

function printList(items: readonly ProjectListItem[]): void {
  if (items.length === 0) {
    writeOut('用户目录里还没有项目数据');
    return;
  }
  items.forEach((item, index) => {
    if (index > 0) writeOut('');
    const dirName = item.project.dir ?? item.project.display;
    const display = item.identityMissing ? `${dirName}(标识缺失)` : item.project.display;
    writeOut(
      `${display}  ${dirName}  ${formatSize(item.size)}  最近活动 ${formatMinute(item.lastActiveAt)}  ` +
        `备份 ${item.backups.count} 份 ${formatSize(item.backups.size)}`,
    );
    for (const root of item.roots) writeOut(`  ${displayPath(root.path)}${root.exists ? '' : '(目录已不在)'}`);
  });
}

/** 在交互终端里读一行;Ctrl-C、Ctrl-D 没给答案 → null。 */
function askLine(question: string): Promise<string | null> {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    let answered = false;
    rl.once('close', () => {
      if (!answered) process.stdout.write('\n');
      resolve(null);
    });
    rl.on('SIGINT', () => rl.close());
    rl.question(question, (answer) => {
      answered = true;
      resolve(answer);
      rl.close();
    });
  });
}

/** 输入 y 或 yes(不分大小写)才算确认。 */
function isYes(answer: string): boolean {
  return /^(y|yes)$/i.test(answer.trim());
}

/** `project remove`:先打预览;没给 --yes 时交互终端里问一次,非交互终端不删。 */
async function removeProjectData(dirName: string, opts: RemoveOptions): Promise<void> {
  const plan = planRemoval(dirName, { backupsOnly: opts.backups === true });
  for (const line of plan.lines) writeOut(line);
  if (opts.yes !== true) {
    if (process.stdin.isTTY !== true) throw new ProjectError('needs_yes', NEEDS_YES_MESSAGE);
    const answer = await askLine(CONFIRM_PROMPT);
    if (answer === null || !isYes(answer)) {
      writeOut(NOT_REMOVED_LINE);
      return;
    }
  }
  for (const line of executeRemoval(plan).lines) writeOut(line);
}

/** 把 `project` 命令组挂到 commander 程序上。主 CLI 调用一次。 */
export function registerProjectCommands(program: Command): void {
  const project = program
    .command('project')
    .description('项目数据 — 查看这个目录属于哪个项目、改项目名称、列出与删除用户目录里的项目数据');

  project
    .command('show')
    .description('查看这个目录属于哪个项目、数据在哪、项目在本机出现过的目录')
    .option('--json', '输出机器可读 JSON')
    .action((opts: JsonOption) => {
      try {
        const report = showProject(resolveProjectRoot(process.cwd()));
        if (opts.json === true) writeJson(report);
        else printShow(report);
      } catch (err) {
        fail(err);
      }
    });

  project
    .command('name <名称>')
    .description(
      '改项目名称:没有 origin 的仓库、仓库里的子目录项目、不在 git 里的目录按名字认项目;改完之后记到新名字下,之前记的留在原项目',
    )
    .action((rawName: string) => {
      try {
        for (const line of renameProject(resolveProjectRoot(process.cwd()), rawName).lines) writeOut(line);
      } catch (err) {
        fail(err);
      }
    });

  project
    .command('list')
    .description('列出用户目录里的项目数据:大小、最近活动、备份、项目在本机出现过的目录')
    .option('--json', '输出机器可读 JSON')
    .action((opts: JsonOption) => {
      try {
        const items = listProjects();
        if (opts.json === true) writeJson(items);
        else printList(items);
      } catch (err) {
        fail(err);
      }
    });

  project
    .command('remove <目录名>')
    .description('删除用户目录里一个项目的数据(目录名见 cgraphx project list);先打预览,确认后再删')
    .option('--backups', '只删这个项目的备份')
    .option('--yes', '不再确认,直接删(非交互终端里必须带)')
    .action(async (dirName: string, opts: RemoveOptions) => {
      try {
        await removeProjectData(dirName, opts);
      } catch (err) {
        fail(err);
      }
    });
}
