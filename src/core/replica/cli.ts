/**
 * replica 子系统的 CLI 接线。
 *
 * 导出 `registerReplicaCommands(program)`,由主 CLI(src/cli/index.ts)调用一次。命令面:
 *   - cgraphx replica create <feature-id> --prefix <文件前缀> --branch <分支> [--full-copy] [--json]
 *   - cgraphx replica list [--all] [--json]
 *   - cgraphx replica remove <副本目录名或 feature-id> [--json]
 *
 * create、remove 只在主目录执行(由它们按传入的项目根判断);list 在副本里也能跑。
 *
 * 输出:带 --json 时 stdout 出 `{ "ok": true, ... }`(create、remove 平铺结果字段,list 为
 * `{ "ok": true, "replicas": [...] }`),失败出 `{ "ok": false, "code", "message", ...附加字段 }`
 * (非 ReplicaError 的 code 为 runtime_error);不带 --json 时结果走 stdout,错误与提示走 stderr、
 * 前缀 `[replica]`。
 *
 * 退出码(exitCodeForError):0 成功 / 1 其它运行时错误 / 2 前置条件不满足 / 3 参数不对。
 */

import type { Command } from 'commander';

import { resolveProjectRoot } from '../directory';
import { createReplica, exitCodeForError, listReplicaStatus, removeReplica, ReplicaError } from './index';
import type { CreateReplicaResult, RemoveReplicaResult, ReplicaState, ReplicaStatus } from './types';

interface JsonOption {
  json?: boolean;
}

interface CreateOptions extends JsonOption {
  prefix?: string;
  branch?: string;
  fullCopy?: boolean;
}

interface ListOptions extends JsonOption {
  all?: boolean;
}

function writeJson(value: unknown): void {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

function writeOut(msg: string): void {
  process.stdout.write(`${msg}\n`);
}

/** stderr 输出 `[replica] <message>`。 */
function writeErr(msg: string): void {
  process.stderr.write(`[replica] ${msg}\n`);
}

/** 失败输出 + 退出码;--json 时附加字段(files、requiredBytes)平铺进对象。 */
function reportError(err: unknown, json: boolean): void {
  process.exitCode = exitCodeForError(err);
  const message = err instanceof Error ? err.message : String(err);
  if (!json) {
    writeErr(message);
    return;
  }
  if (err instanceof ReplicaError) writeJson({ ok: false, code: err.code, message, ...err.details });
  else writeJson({ ok: false, code: 'runtime_error', message });
}

/** 跑一个子命令:成功时 --json 输出 `{ ok: true, ...toJson(结果) }`,否则 print;失败走 reportError。 */
function runAction<T>(
  json: boolean,
  fn: () => T,
  toJson: (result: T) => object,
  print: (result: T) => void,
): void {
  let result: T;
  try {
    result = fn();
  } catch (err) {
    reportError(err, json);
    return;
  }
  if (json) writeJson({ ok: true, ...toJson(result) });
  else print(result);
}

/** 终端显示宽度:CJK / 全角字符按 2 列计,其余 1 列(表格对齐用)。 */
function displayWidth(s: string): number {
  let w = 0;
  for (const ch of s) {
    const code = ch.codePointAt(0) ?? 0;
    const wide =
      (code >= 0x1100 && code <= 0x115f) ||
      (code >= 0x2e80 && code <= 0xa4cf) ||
      (code >= 0xac00 && code <= 0xd7a3) ||
      (code >= 0xf900 && code <= 0xfaff) ||
      (code >= 0xfe30 && code <= 0xfe6f) ||
      (code >= 0xff01 && code <= 0xff60) ||
      (code >= 0xffe0 && code <= 0xffe6) ||
      (code >= 0x20000 && code <= 0x3fffd);
    w += wide ? 2 : 1;
  }
  return w;
}

function padEnd(s: string, width: number): string {
  const gap = width - displayWidth(s);
  return gap > 0 ? s + ' '.repeat(gap) : s;
}

function renderTable(headers: readonly string[], rows: readonly string[][]): string {
  const widths = headers.map((h, i) =>
    Math.max(displayWidth(h), ...rows.map((r) => displayWidth(r[i] ?? ''))),
  );
  const line = (cells: readonly string[]): string =>
    cells.map((c, i) => padEnd(c, (widths[i] ?? 0) + 2)).join('').trimEnd();
  return [line(headers), ...rows.map(line)].join('\n');
}

const STATE_LABELS: Readonly<Record<ReplicaState, string>> = {
  present: '在',
  missing: '已不在',
  removed: '已删除',
};

function mergeLabel(s: ReplicaStatus): string {
  if (s.merged === true) return '已合入';
  if (s.merged === false && s.ahead === 0) return '还没有提交';
  if (s.merged === false && s.ahead !== null) return `差 ${s.ahead} 个提交`;
  return '-';
}

function printCreate(r: CreateReplicaResult): void {
  if (!r.created) {
    writeOut(`需求 ${r.featureId} 的副本已经有了:${r.path}(分支 ${r.branch}),没重建`);
    return;
  }
  writeOut(`已开副本 ${r.name}:${r.path}`);
  writeOut(`  需求 ${r.featureId},分支 ${r.branch}(从 ${r.baseBranch} 拉出)`);
  if (r.movedFiles.length > 0) {
    writeOut('  移进副本的文件:');
    for (const file of r.movedFiles) writeOut(`    ${file}`);
  }
  for (const warning of r.warnings) writeErr(warning);
}

function printList(rows: readonly ReplicaStatus[], all: boolean): void {
  if (rows.length === 0) {
    writeOut(all ? '没有登记过副本' : '没有在用的副本(--all 连已删除的一起列)');
    return;
  }
  writeOut(
    renderTable(
      ['副本', '需求', '分支', '状态', '合入'],
      rows.map((r) => [r.name, r.featureId, r.branch, STATE_LABELS[r.state], mergeLabel(r)]),
    ),
  );
  writeOut(`\n共 ${rows.length} 个副本`);
  for (const r of rows) {
    if (r.dirty.length > 0) writeOut(`${r.name} 有 ${r.dirty.length} 个文件没提交`);
  }
}

function printRemove(r: RemoveReplicaResult): void {
  writeOut(
    r.state === 'removed'
      ? `已删除副本 ${r.name};登记和副本里的会话、提交记录都留在主目录`
      : `副本 ${r.name} 的目录已经不在了,已在登记里记为删除`,
  );
}

/** 把 `replica` 命令组挂到 commander 程序上。主 CLI 调用一次。 */
export function registerReplicaCommands(program: Command): void {
  const replica = program
    .command('replica')
    .description('需求副本 — 在主目录旁开、列、删写时复制的整仓副本,登记在主目录 .cgraphx/replicas/');

  replica
    .command('create <feature-id>')
    .description(
      '开副本 <主目录名>@<文件前缀>:复制整个主目录,副本里从主目录当前分支拉出需求分支并登记(只在主目录执行)',
    )
    .option('--prefix <prefix>', '文件前缀(必填):feature-id 去掉日期段,如 订单导出')
    .option('--branch <branch>', '需求分支(必填):feat/<文件前缀>,bug 修复用 fix/<文件前缀>')
    .option('--full-copy', '不用写时复制,整份复制(磁盘不支持写时复制时,问过用户再带)')
    .option('--json', '输出机器可读 JSON')
    .action((featureId: string, opts: CreateOptions) => {
      const projectRoot = resolveProjectRoot(process.cwd());
      runAction(
        opts.json === true,
        () =>
          createReplica(projectRoot, {
            featureId,
            prefix: opts.prefix ?? '',
            branch: opts.branch ?? '',
            fullCopy: opts.fullCopy === true,
          }),
        (result) => result,
        printCreate,
      );
    });

  replica
    .command('list')
    .description('列出副本:需求、分支、在不在、合入没有、没提交的改动(在副本里也能跑)')
    .option('--all', '连已删除的副本一起列')
    .option('--json', '输出机器可读 JSON')
    .action((opts: ListOptions) => {
      const projectRoot = resolveProjectRoot(process.cwd());
      const all = opts.all === true;
      runAction(
        opts.json === true,
        () => listReplicaStatus(projectRoot, { includeRemoved: all }),
        (replicas) => ({ replicas }),
        (replicas) => printList(replicas, all),
      );
    });

  replica
    .command('remove <name-or-feature-id>')
    .description('删副本:核对是本主目录的副本、没有没提交的改动后删掉目录,登记留下(只在主目录执行)')
    .option('--json', '输出机器可读 JSON')
    .action((nameOrFeatureId: string, opts: JsonOption) => {
      const projectRoot = resolveProjectRoot(process.cwd());
      runAction(
        opts.json === true,
        () => removeReplica(projectRoot, nameOrFeatureId),
        (result) => result,
        printRemove,
      );
    });
}
