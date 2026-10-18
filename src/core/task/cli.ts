/**
 * task 子系统的 CLI 接线(spec §5)。
 *
 * 导出 `registerTaskCommands(program)`,由主 CLI(src/cli/index.ts)调用一次。命令面:
 *   - cgraphx task list    [--local] [--json]
 *   - cgraphx task use     <编号或名称> [--manual] [--session <id>] [--json]
 *   - cgraphx task current [--session <id>] [--json]
 *   - cgraphx task clear   [--session <id>] [--json]
 *   - cgraphx task show    <编号或名称> [--events] [--limit <n>] [--json]
 *
 * 「task」指开发任务绑定,与 Claude Code 的 Task 工具无关。
 *
 * 退出码(exitCodeForError):0 成功(含无结果)/ 1 其它(含任务接口不可用)/
 * 2 TaskConfigError / 3 TaskArgError / 4 TaskStoreError。
 */

import type { Command } from 'commander';

import { AGENT_OPTION_FLAG, resolveHookAgent } from '../agents';
import { resolveProjectRoot } from '../directory';
import { describeEvent, type TimelineEvent } from '../timeline';
import {
  bindSession,
  clearBinding,
  findTaskByValue,
  getCurrentEffectiveBinding,
  getTaskDetail,
  listTasks,
  refreshAutoBindings,
  resolveSessionId,
  resolveTaskForUse,
  stopAutoBinding,
  taskPostToolUseHook,
  taskSessionStartHook,
  taskStopHook,
} from './index';
import { TaskArgError, TaskConfigError, TaskStoreError } from './errors';
import type {
  BindResult,
  BindSource,
  EffectiveBinding,
  TaskBinding,
  TaskDetail,
  TaskItem,
  TaskListResult,
  TaskSource,
} from './types';

// ─── 退出码与错误输出 ───────────────────────────────────────────────────────

function exitCodeForError(err: unknown): number {
  if (err instanceof TaskArgError) return 3;
  if (err instanceof TaskConfigError) return 2;
  if (err instanceof TaskStoreError) return 4;
  return 1;
}

/** stderr 输出 `[task] <message>`;消息自带前缀时不重复加。 */
function renderError(err: unknown): void {
  const msg = err instanceof Error ? err.message : String(err);
  process.stderr.write(`${withPrefix(msg)}\n`);
}

function withPrefix(msg: string): string {
  return msg.startsWith('[task]') ? msg : `[task] ${msg}`;
}

/** 会话判定(spec §5.2):--session ?? 当前 Claude Code 会话;都拿不到报参数错误。 */
function requireSessionId(explicit: string | undefined): string {
  const sessionId = resolveSessionId(explicit);
  if (sessionId === null) {
    throw new TaskArgError(
      '[task] 无法确定当前会话:不在 Claude Code 会话内。用 --session <id> 指定(会话开始时注入的上下文中有当前会话 id)',
    );
  }
  return sessionId;
}

function writeJson(value: unknown): void {
  process.stdout.write(JSON.stringify(value, null, 2) + '\n');
}

// ─── 人读输出 ───────────────────────────────────────────────────────────────

const SOURCE_LABELS: Record<TaskSource, string> = { api: '接口', manual: '手动', feature: '目录' };
const BIND_SOURCE_LABELS: Record<BindSource, string> = {
  cli: '显式绑定',
  feature_dir: '需求目录',
  auto_read: '自动(读)',
  auto_write: '自动(写)',
};

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

/** 对齐表格;indent 为每行前缀。 */
function renderTable(headers: string[], cells: string[][], indent = ''): string {
  const widths = headers.map((h, i) =>
    Math.max(displayWidth(h), ...cells.map((c) => displayWidth(c[i] ?? ''))),
  );
  const line = (row: string[]) =>
    indent + row.map((v, i) => padEnd(v, (widths[i] ?? 0) + 2)).join('').trimEnd();
  return [line(headers), ...cells.map(line)].join('\n');
}

/** 缩进两格的「键  值」块,键按显示宽度对齐。 */
function renderKeyValues(pairs: Array<[string, string]>): string {
  const width = Math.max(...pairs.map(([k]) => displayWidth(k)));
  return pairs.map(([k, v]) => `  ${padEnd(k, width + 2)}${v}`).join('\n');
}

/** ISO 8601(UTC)→ 本地 `YYYY-MM-DD HH:MM:SS`;空值或无法解析返回 `-`。JSON 输出保留原始 UTC。 */
function formatLocalTs(iso: string | null | undefined): string {
  if (!iso) return '-';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '-';
  const pad = (n: number) => String(n).padStart(2, '0');
  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ` +
    `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
  );
}

function truncate(s: string, max: number): string {
  const oneLine = s.replace(/\s+/g, ' ').trim();
  return oneLine.length <= max ? oneLine : oneLine.slice(0, max - 1) + '…';
}

/** 「名称」(编号 X,本地 id N) */
function describeTask(task: TaskItem): string {
  return `「${task.name}」(编号 ${task.externalId ?? '-'},本地 id ${task.id})`;
}

function renderList(result: TaskListResult): string {
  if (result.tasks.length === 0) {
    return '暂无任务。用 cgraphx task use <名称> 新建手动任务(已配置任务接口时加 --manual)';
  }
  const cells = result.tasks.map((t) => [
    String(t.id),
    SOURCE_LABELS[t.source],
    t.externalId ?? '-',
    t.name,
    t.status ?? '-',
    t.id === result.currentTaskId ? '*' : '-',
  ]);
  return (
    renderTable(['ID', '来源', '编号', '名称', '状态', '当前'], cells) +
    `\n\n共 ${result.tasks.length} 个任务`
  );
}

function renderUse(result: BindResult): string {
  const target = describeTask(result.task);
  const session = `会话 ${result.binding.sessionId}`;
  switch (result.status) {
    case 'bound':
      return `已绑定${target};${session}`;
    case 'already':
      return `已绑定(无变化)${target};${session}`;
    case 'switched': {
      const from = result.previous ? result.previous.name : '-';
      return `已从「${from}」切换到「${result.task.name}」(编号 ${result.task.externalId ?? '-'},本地 id ${result.task.id});${session}`;
    }
  }
}

function renderCurrent(sessionId: string, current: EffectiveBinding | null): string {
  if (current === null) return `会话 ${sessionId} 未绑定任务`;
  const { binding, task } = current;
  return (
    `会话 ${sessionId} 当前绑定 ${describeTask(task)},` +
    `自 ${formatLocalTs(binding.boundAt)} 起,来源:${BIND_SOURCE_LABELS[binding.bindSource]}`
  );
}

/** clear 的三种结果:解除手动绑定 / 停止自动关联 / 本来未绑定。 */
type ClearOutcome = 'cleared' | 'auto_stopped' | 'none';

function renderClear(sessionId: string, outcome: ClearOutcome): string {
  switch (outcome) {
    case 'cleared':
      return `已解除会话 ${sessionId} 的任务绑定`;
    case 'auto_stopped':
      return '已停止本会话的自动关联';
    case 'none':
      return `会话 ${sessionId} 未绑定任务,无需解除`;
  }
}

function renderSessions(sessions: TaskDetail['sessions']): string {
  if (sessions.length === 0) return '  (无)';
  const cells = sessions.map(({ binding: b }) => [
    b.sessionId,
    formatLocalTs(b.boundAt),
    b.unboundAt === null ? '生效中' : formatLocalTs(b.unboundAt),
    BIND_SOURCE_LABELS[b.bindSource],
  ]);
  return renderTable(['会话', '开始', '结束', '来源'], cells, '  ');
}

function renderCommits(commits: TimelineEvent[]): string {
  if (commits.length === 0) return '  (无)';
  const cells = commits.map((e) => {
    const branch = typeof e.metadata.branch === 'string' ? e.metadata.branch : '-';
    const lines =
      e.commit_insertions === null && e.commit_deletions === null
        ? '-'
        : `+${e.commit_insertions ?? 0}/-${e.commit_deletions ?? 0}`;
    return [
      e.commit_hash ? e.commit_hash.slice(0, 7) : '-',
      branch,
      lines,
      truncate(e.commit_message ?? '', 80) || '-',
    ];
  });
  return renderTable(['hash', '分支', '增删行', 'message'], cells, '  ');
}

function renderEventCounts(counts: Record<string, number>): string {
  const entries = Object.entries(counts);
  if (entries.length === 0) return '  (无归属事件)';
  return renderTable(['事件类型', '数量'], entries.map(([type, n]) => [type, String(n)]), '  ');
}

/** 事件明细,列与 `timeline query --format table` 一致。 */
function renderEvents(events: TimelineEvent[]): string {
  if (events.length === 0) return '  (无)';
  const cells = events.map((e) => [
    String(e.id),
    formatLocalTs(e.ts),
    e.event_type,
    e.tool_name ?? '',
    e.turn_id ? e.turn_id.slice(0, 8) : '-',
    describeEvent(e),
  ]);
  return renderTable(['id', 'ts(local)', 'event_type', 'tool_name', 'turn', 'summary'], cells, '  ');
}

function renderShow(detail: TaskDetail): string {
  const { task } = detail;
  const out: string[] = [];
  out.push('任务');
  out.push(
    renderKeyValues([
      ['本地 id', String(task.id)],
      ['来源', SOURCE_LABELS[task.source]],
      ['编号', task.externalId ?? '-'],
      ['名称', task.name],
      ['链接', task.url ?? '-'],
      ['状态', task.status ?? '-'],
    ]),
  );
  out.push('');
  out.push('关联需求目录');
  out.push(detail.featureDirs.length === 0 ? '  (无)' : detail.featureDirs.map((d) => `  ${d}`).join('\n'));
  out.push('');
  out.push('会话');
  out.push(renderSessions(detail.sessions));
  out.push('');
  out.push('commit');
  out.push(renderCommits(detail.commits));
  out.push('');
  out.push('事件统计');
  out.push(renderEventCounts(detail.eventCounts));
  if (detail.events !== null) {
    out.push('');
    out.push(`事件明细(${detail.events.length} 条)`);
    out.push(renderEvents(detail.events));
  }
  return out.join('\n');
}

// ─── 命令 ───────────────────────────────────────────────────────────────────

/** `--limit` 解析:正整数,否则参数错误。 */
function parseLimit(raw: string | undefined): number | undefined {
  if (raw === undefined) return undefined;
  if (!/^\d+$/.test(raw.trim()) || Number(raw) <= 0) {
    throw new TaskArgError(`--limit 必须是正整数,收到 ${raw}`);
  }
  return Number(raw);
}

/** `show` 只按本地 id → 接口编号 → 手动任务名称 → 目录任务解析(spec §5.5),不联网、不新建。 */
function findTaskOrThrow(projectRoot: string, value: string): TaskItem {
  const task = findTaskByValue(projectRoot, value);
  if (!task) {
    throw new TaskArgError(
      `找不到任务 ${value};用 cgraphx task list 查看可用任务的本地 id / 编号 / 名称 / 目录任务`,
    );
  }
  return task;
}

/** 本地读取前刷新自动派生;失败只警告,不影响已有数据展示。 */
async function refreshAutoBindingsForRead(projectRoot: string): Promise<void> {
  try {
    await refreshAutoBindings(projectRoot);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    process.stderr.write(`${withPrefix(`自动关联刷新失败,已按现有数据展示:${msg}`)}\n`);
  }
}

/** 派生绑定的来源标记(auto_* 只出现在读取时合成的绑定上)。 */
function isAutoBinding(binding: TaskBinding): boolean {
  return binding.bindSource === 'auto_read' || binding.bindSource === 'auto_write';
}

/** 把 `task` 命令组挂到 commander 程序上。主 CLI 调用一次。 */
export function registerTaskCommands(program: Command): void {
  const task = program
    .command('task')
    .description(
      '开发任务绑定(与 Claude Code 的 Task 工具无关)— 把会话绑定到开发任务,按任务归集 timeline 事件',
    );

  task
    .command('list')
    .description('列出开发任务(已配置任务接口时先刷新;失败时显示本地缓存)')
    .option('--local', '不请求任务接口,只列本地')
    .option('--json', '输出机器可读 JSON')
    .action(async (opts: { local?: boolean; json?: boolean }) => {
      try {
        const projectRoot = resolveProjectRoot(process.cwd());
        await refreshAutoBindingsForRead(projectRoot);
        const result = await listTasks(projectRoot, { local: opts.local === true });
        // 当前任务以有效绑定为准(含派生绑定);listTasks 内部的 open binding 只是兜底。
        const sessionId = resolveSessionId();
        if (sessionId !== null) {
          result.currentTaskId = getCurrentEffectiveBinding(projectRoot, sessionId)?.task.id ?? null;
        }
        if (result.warning !== null) process.stderr.write(`${withPrefix(result.warning)}\n`);
        if (opts.json) writeJson(result);
        else process.stdout.write(renderList(result) + '\n');
      } catch (err) {
        renderError(err);
        process.exitCode = exitCodeForError(err);
      }
    });

  task
    .command('use <value>')
    .description('把会话绑定到开发任务(按本地 id / 接口编号 / 手动任务名称解析)')
    .option('--manual', '已配置任务接口时,接口中找不到就以该名称新建手动任务')
    .option('--session <id>', '指定会话 id(默认当前 Claude Code 会话)')
    .option('--json', '输出机器可读 JSON')
    .action(async (value: string, opts: { manual?: boolean; session?: string; json?: boolean }) => {
      try {
        const projectRoot = resolveProjectRoot(process.cwd());
        const sessionId = requireSessionId(opts.session);
        const target = await resolveTaskForUse(projectRoot, value, { manual: opts.manual === true });
        const result = await bindSession(projectRoot, sessionId, target.id, 'cli');
        if (opts.json) writeJson(result);
        else process.stdout.write(renderUse(result) + '\n');
      } catch (err) {
        renderError(err);
        process.exitCode = exitCodeForError(err);
      }
    });

  task
    .command('current')
    .description('显示会话当前绑定的开发任务')
    .option('--session <id>', '指定会话 id(默认当前 Claude Code 会话)')
    .option('--json', '输出机器可读 JSON')
    .action(async (opts: { session?: string; json?: boolean }) => {
      try {
        const projectRoot = resolveProjectRoot(process.cwd());
        const sessionId = requireSessionId(opts.session);
        await refreshAutoBindingsForRead(projectRoot);
        const current = getCurrentEffectiveBinding(projectRoot, sessionId);
        if (opts.json) writeJson(current === null ? null : { binding: current.binding, task: current.task });
        else process.stdout.write(renderCurrent(sessionId, current) + '\n');
      } catch (err) {
        renderError(err);
        process.exitCode = exitCodeForError(err);
      }
    });

  task
    .command('clear')
    .description('解除会话当前的开发任务绑定(未绑定时为空操作)')
    .option('--session <id>', '指定会话 id(默认当前 Claude Code 会话)')
    .option('--json', '输出机器可读 JSON')
    .action(async (opts: { session?: string; json?: boolean }) => {
      try {
        const projectRoot = resolveProjectRoot(process.cwd());
        const sessionId = requireSessionId(opts.session);
        const current = getCurrentEffectiveBinding(projectRoot, sessionId);
        let outcome: ClearOutcome;
        if (current === null) {
          outcome = 'none';
        } else if (isAutoBinding(current.binding)) {
          // R6:停止本会话的自动关联,之后的刷新不再恢复。
          stopAutoBinding(projectRoot, sessionId);
          outcome = 'auto_stopped';
        } else {
          clearBinding(projectRoot, sessionId);
          outcome = 'cleared';
        }
        if (opts.json) {
          writeJson({ cleared: outcome === 'cleared', autoStopped: outcome === 'auto_stopped' });
        } else {
          process.stdout.write(renderClear(sessionId, outcome) + '\n');
        }
      } catch (err) {
        renderError(err);
        process.exitCode = exitCodeForError(err);
      }
    });

  task
    .command('show <value>')
    .description('开发任务详情:关联需求目录、绑定过的会话、归属 commit 与事件统计')
    .option('--events', '追加归属事件明细(按时间升序)')
    .option('--limit <n>', '事件明细条数(默认 100)')
    .option('--json', '输出机器可读 JSON')
    .action(async (value: string, opts: { events?: boolean; limit?: string; json?: boolean }) => {
      try {
        const projectRoot = resolveProjectRoot(process.cwd());
        const limit = parseLimit(opts.limit);
        await refreshAutoBindingsForRead(projectRoot);
        const target = findTaskOrThrow(projectRoot, value);
        const detail = await getTaskDetail(projectRoot, target.id, { events: opts.events === true, limit });
        if (opts.json) writeJson(detail);
        else process.stdout.write(renderShow(detail) + '\n');
      } catch (err) {
        renderError(err);
        process.exitCode = exitCodeForError(err);
      }
    });

  // 隐藏 hook 入口:由目标项目 agent settings 的 SessionStart / Stop 调起,退出码恒为 0;
  // task-post-tool-use-hook 保留注册,兼容旧配置的 PostToolUse 调用(读 stdin 后直接返回)。
  // --agent 缺省或无法识别时按 Claude Code 处理
  program
    .command('task-session-start-hook', { hidden: true })
    .option(`${AGENT_OPTION_FLAG} <id>`)
    .action(async (opts: { agent?: string }) => { await taskSessionStartHook(resolveHookAgent(opts.agent)); });
  program
    .command('task-stop-hook', { hidden: true })
    .option(`${AGENT_OPTION_FLAG} <id>`)
    .action(async (opts: { agent?: string }) => { await taskStopHook(resolveHookAgent(opts.agent)); });
  program
    .command('task-post-tool-use-hook', { hidden: true })
    .option(`${AGENT_OPTION_FLAG} <id>`)
    .action(async (opts: { agent?: string }) => { await taskPostToolUseHook(resolveHookAgent(opts.agent)); });
}
