/**
 * 开发时间线页(spec §3.1–§3.4):URL 查询模型 + facade 调用 + web 层聚合 + page 入口。
 *
 * 形态(镜像 `pages-overview.ts`):服务端渲染 HTML,筛选全走 URL 查询参数
 * (可收藏、刷新不丢状态)。URL ↔ 查询模型的解析/序列化为纯函数。
 *
 * 与知识库页的关键差异:timeline 门面 `queryEvents`/`getEventStats` 为 async
 * (返回 Promise,以 projectRoot 自管 DB 连接生命周期),故 `renderTimelinePage`
 * 声明为 async,内部 await facade;`GET /timeline` 路由分支用 `.then/.catch`
 * 兜底(server.ts)。四级分组(日期 > 会话 > 轮次 > 事件)在 web 层对
 * `queryEvents` 扁平结果装配,不新建查询层(spec §8)。
 */

import {
  queryEvents,
  getEventStats,
  type EventType,
  type TimelineEvent,
  type TimelineStats,
} from '../core/timeline';
import {
  TIMELINE_EVENT_TYPES,
  EVENT_TYPE_LABELS,
  EVENT_TYPE_CHIP_TONE,
} from './constants';
import { renderShellPage } from './layout';
import {
  renderTimelineContent,
  type BarModel,
  type CommitRowModel,
  type DayGroupModel,
  type EventRowModel,
  type SessionCardModel,
  type TimelineContentModel,
  type TlFilterChipModel,
  type TlPillModel,
  type TurnGroupModel,
  type Payload,
} from './timeline-templates';

// ----- URL 查询模型(纯函数,逐字镜像 pages-overview.ts:69-148 语义)---------

export interface TimelineQuery {
  /** today(默认)/ 7d。 */
  range: 'today' | '7d';
  types: EventType[];
  tool?: string;
  file?: string;
  session?: string;
}

/** pill 增删可作用的维度。 */
export type TlPillDimension = 'range' | 'types' | 'tool' | 'file' | 'session';

/** 保序去重。 */
function dedupe(list: string[]): string[] {
  return [...new Set(list)];
}

/** 保序追加(已存在则原样)。 */
function added<T>(list: T[], value: T): T[] {
  return list.includes(value) ? list : [...list, value];
}

/**
 * URLSearchParams → 规范化查询模型:
 * - range 非 today/7d → today(默认);type 非法枚举忽略;tool/file/session 空白 → 未传。
 * - 各多值维度去重保序。
 */
export function parseTimelineQuery(params: URLSearchParams): TimelineQuery {
  const rangeRaw = params.get('range');
  const range: 'today' | '7d' = rangeRaw === '7d' ? '7d' : 'today';

  const types = dedupe(params.getAll('type')).filter((t): t is EventType =>
    (TIMELINE_EVENT_TYPES as readonly string[]).includes(t),
  );

  const toolRaw = params.get('tool');
  const tool = toolRaw !== null && toolRaw.trim() !== '' ? toolRaw.trim() : undefined;
  const fileRaw = params.get('file');
  const file = fileRaw !== null && fileRaw.trim() !== '' ? fileRaw.trim() : undefined;
  const sessionRaw = params.get('session');
  const session = sessionRaw !== null && sessionRaw.trim() !== '' ? sessionRaw.trim() : undefined;

  return { range, types, tool, file, session };
}

/**
 * 查询模型 → 规范化 URL。参数顺序固定(range → type* → tool → file → session);
 * 缺省值不出现(range=today 不入 URL)。URLSearchParams 负责百分号编码。
 */
export function buildTimelineUrl(query: TimelineQuery): string {
  const p = new URLSearchParams();
  if (query.range === '7d') p.append('range', '7d');
  for (const t of query.types) p.append('type', t);
  if (query.tool !== undefined) p.append('tool', query.tool);
  if (query.file !== undefined) p.append('file', query.file);
  if (query.session !== undefined) p.append('session', query.session);
  const s = p.toString();
  return s === '' ? '/timeline' : `/timeline?${s}`;
}

/** 移除一个激活值(其余参数保留)。 */
export function withoutTlValue(query: TimelineQuery, dim: TlPillDimension, value: string): TimelineQuery {
  switch (dim) {
    case 'range':
      return { ...query, range: 'today' };
    case 'types':
      return { ...query, types: query.types.filter((v) => v !== value) };
    case 'tool':
      return { ...query, tool: undefined };
    case 'file':
      return { ...query, file: undefined };
    case 'session':
      return { ...query, session: undefined };
  }
}

// ----- 时间辅助(进程本地时区;spec §4 / 基座 §4.2)---------------------------

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

/** 进程本地 YYYY-MM-DD(用于 resolveTimeBound 的本地午夜 since + 按天分桶)。 */
function localDateStr(d: Date): string {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

/** ms → 进程本地 HH:mm:ss(spec §3.3 事件行精确到秒;不用 data-local-time 避免 app.js 降为分钟)。 */
function eventTime(ms: number): { datetime: string; text: string } {
  const d = new Date(ms);
  return {
    datetime: d.toISOString(),
    text: `${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`,
  };
}

/** ms → 进程本地 HH:mm(会话卡/提交时间范围,分钟精度)。 */
function cardTime(ms: number): { datetime: string; text: string } {
  const d = new Date(ms);
  return { datetime: d.toISOString(), text: `${pad2(d.getHours())}:${pad2(d.getMinutes())}` };
}

const WEEKDAYS = ['日', '一', '二', '三', '四', '五', '六'];

/** 截断 + 省略号。 */
function truncate(s: string, max: number): string {
  return s.length <= max ? s : `${s.slice(0, max)}…`;
}

// ----- payload 字段矩阵(spec §3.3,值原样不派生;null 字段省略)--------------

/**
 * 组装单事件 payload 对象(按 event_type)。值为 null 的字段不入对象(省略)。
 * hasPayload = 对象非空(有可展开字段)。子 agent 行型(Agent/Task 的 post)附说明文案。
 */
function buildPayload(e: TimelineEvent): { payload: Payload; isSubagent: boolean; subagentNote: string | null } {
  const isSubagent = e.event_type === 'post_tool_use' && (e.tool_name === 'Agent' || e.tool_name === 'Task');
  const note =
    isSubagent
      ? '记录层现状:子 agent 仅「完成」事件入库——启动时刻与内部工具步骤不记录;此行呈现的是完成时刻。branch 信息未记录,无法呈现。'
      : null;

  const obj: Record<string, unknown> = {};
  const set = (k: string, v: unknown): void => {
    if (v !== null && v !== undefined) obj[k] = v;
  };

  switch (e.event_type) {
    case 'user_prompt':
      set('prompt_text', e.prompt_text);
      set('turn_id', e.turn_id);
      break;
    case 'pre_tool_use':
      set('tool_name', e.tool_name);
      set('tool_args', e.tool_args);
      set('turn_id', e.turn_id);
      break;
    case 'post_tool_use':
      set('tool_name', e.tool_name);
      set('tool_args', e.tool_args);
      set('tool_result_summary', e.tool_result_summary);
      set('duration_ms', e.duration_ms);
      set('turn_id', e.turn_id);
      break;
    case 'stop':
      // metadata 是 Record(可能含 session_event_count / session_duration_ms / session_last_prompt_preview)
      if (e.metadata !== null && Object.keys(e.metadata).length > 0) {
        obj.metadata = e.metadata;
      }
      set('turn_id', e.turn_id);
      break;
    default:
      // git_commit 不走事件行(入 CommitRowModel),此处不触发
      break;
  }

  return { payload: Object.keys(obj).length > 0 ? obj : null, isSubagent, subagentNote: note };
}

/** 从 tool_args(已解析对象)提取主路径/命令,用于事件行 ev__path。 */
function extractPath(e: TimelineEvent): string | null {
  if (e.tool_args === null || typeof e.tool_args !== 'object') return null;
  const a = e.tool_args as Record<string, unknown>;
  const pick = (k: string): string | null => (typeof a[k] === 'string' ? (a[k] as string) : null);
  switch (e.tool_name) {
    case 'Edit':
    case 'Write':
    case 'MultiEdit':
    case 'NotebookEdit':
    case 'Read':
      return pick('file_path');
    case 'Bash':
      return pick('command');
    case 'Grep':
      return pick('pattern') ?? pick('path');
    case 'Glob':
      return pick('path') ?? pick('pattern');
    case 'Agent':
    case 'Task':
      return pick('description');
    default:
      return null;
  }
}

/** 一行摘要(按 event_type)。 */
function buildSummary(e: TimelineEvent): string | null {
  switch (e.event_type) {
    case 'user_prompt':
      return e.prompt_text !== null ? truncate(e.prompt_text, 80) : null;
    case 'pre_tool_use':
      return null;
    case 'post_tool_use':
      return e.tool_result_summary !== null ? truncate(e.tool_result_summary, 100) : null;
    case 'stop':
      return null;
    default:
      return null;
  }
}

// ----- web 层聚合(四级分桶 + 多类型合并 + 概况条)---------------------------

/** 单事件 → EventRowModel(不含分组归属,仅行本身)。 */
function toEventRow(e: TimelineEvent): EventRowModel {
  const { payload, isSubagent, subagentNote } = buildPayload(e);
  return {
    time: eventTime(Date.parse(e.ts)),
    eventType: e.event_type,
    label: EVENT_TYPE_LABELS[e.event_type],
    tone: EVENT_TYPE_CHIP_TONE[e.event_type],
    toolName: e.tool_name,
    path: extractPath(e) !== null ? truncate(extractPath(e) as string, 60) : null,
    summary: buildSummary(e),
    hasPayload: payload !== null,
    payload,
    isSubagent,
    subagentNote,
  };
}

/** git_commit 事件 → CommitRowModel。 */
function toCommitRow(e: TimelineEvent): CommitRowModel {
  // hash 截短到 8 位(短 hash,与 git log --oneline 一致);完整 40 位会挤爆行布局。
  const fullHash = e.commit_hash ?? '';
  return {
    time: cardTime(Date.parse(e.ts)),
    hash: fullHash.length > 8 ? fullHash.slice(0, 8) : fullHash,
    message: e.commit_message ?? '',
    insertions: e.commit_insertions ?? 0,
    deletions: e.commit_deletions ?? 0,
    files: e.commit_files,
  };
}

/** 按事件 ts DESC, id DESC 重排(多类型合并后用)。 */
function sortByTsDescIdDesc(events: TimelineEvent[]): TimelineEvent[] {
  return [...events].sort((a, b) => b.ts.localeCompare(a.ts) || b.id - a.id);
}

/** 查询事件列表(多类型 web 层合并;spec §8 桥接,无 core 改动)。 */
async function queryEventList(
  projectRoot: string,
  query: TimelineQuery,
  since: string,
): Promise<{ events: TimelineEvent[]; capped: boolean }> {
  const baseFilter = {
    since,
    tool: query.tool,
    file: query.file,
    session: query.session,
    limit: 10000,
  };

  if (query.types.length === 0) {
    const events = await queryEvents(projectRoot, baseFilter);
    return { events, capped: events.length >= 10000 };
  }
  if (query.types.length === 1) {
    const events = await queryEvents(projectRoot, { ...baseFilter, type: query.types[0] });
    return { events, capped: events.length >= 10000 };
  }
  // 多类型:N 次查询(每类型一次,其余过滤相同)合并;每事件 event_type 单值,结果集互斥,无需去重。
  const results = await Promise.all(
    query.types.map((t) => queryEvents(projectRoot, { ...baseFilter, type: t })),
  );
  const merged = sortByTsDescIdDesc(results.flat());
  return { events: merged, capped: results.some((r) => r.length >= 10000) };
}

/** 全局会话汇总(跨所有 fetched 日期,供跨天会话卡头部用)。 */
interface SessionSummary {
  firstMs: number;
  lastMs: number;
  fullCount: number;
  turnIds: Set<string>;
  /** 最后一条 user_prompt —— 用作会话标题,反映本会话当前在做的核心工作。 */
  lastPrompt: string | null;
}

/** 一次性遍历事件建 Map<session_id, summary>(排除 git_commit——它们入独立栏)。 */
function buildSessionSummaries(events: TimelineEvent[]): Map<string, SessionSummary> {
  const map = new Map<string, SessionSummary>();
  for (const e of events) {
    if (e.event_type === 'git_commit') continue;
    const sid = e.session_id ?? '__no_session__';
    let s = map.get(sid);
    if (s === undefined) {
      s = { firstMs: Number.MAX_SAFE_INTEGER, lastMs: 0, fullCount: 0, turnIds: new Set(), lastPrompt: null };
      map.set(sid, s);
    }
    const ms = Date.parse(e.ts);
    if (ms < s.firstMs) s.firstMs = ms;
    if (ms > s.lastMs) s.lastMs = ms;
    s.fullCount += 1;
    if (e.turn_id !== null) s.turnIds.add(e.turn_id);
    // events 为 ts DESC(最新在前),遍历中先见最新;取最后一条 user_prompt = 首个遇到的 prompt
    if (s.lastPrompt === null && e.event_type === 'user_prompt' && e.prompt_text !== null) {
      s.lastPrompt = e.prompt_text;
    }
  }
  return map;
}

/** 会话标题(最后一条 user_prompt 截断;无则 tool_name;再无则 session_id 前 8 位)。 */
function sessionTitle(sid: string, s: SessionSummary, fallbackTool: string | null): string {
  if (s.lastPrompt !== null) return truncate(s.lastPrompt, 40);
  if (fallbackTool !== null) return fallbackTool;
  return sid === '__no_session__' ? '无会话归属' : sid.slice(0, 8);
}

/**
 * 四级分桶:events → DayGroupModel[](日期 > 会话 > 轮次 > 事件)。
 * 输入为 ts DESC 排序;桶内每组 reverse 成 ASC(最早在上),日期分组倒序(今天在前)。
 */
function bucketEvents(
  events: TimelineEvent[],
  sessionSummaries: Map<string, SessionSummary>,
  todayStr: string,
  overallMaxMs: number,
): DayGroupModel[] {
  // L1:按本地日期分桶
  const byDate = new Map<string, TimelineEvent[]>();
  for (const e of events) {
    const day = localDateStr(new Date(Date.parse(e.ts)));
    let arr = byDate.get(day);
    if (arr === undefined) {
      arr = [];
      byDate.set(day, arr);
    }
    arr.push(e);
  }

  const days = [...byDate.keys()].sort((a, b) => b.localeCompare(a)); // 倒序(今天在前)

  return days.map((day) => {
    const dayEvents = byDate.get(day) ?? [];
    const isToday = day === todayStr;

    // L2:会话卡(非 git_commit 事件)+ git 独立栏
    const sessionEventsBySid = new Map<string, TimelineEvent[]>();
    const commits: TimelineEvent[] = [];
    for (const e of dayEvents) {
      if (e.event_type === 'git_commit') {
        commits.push(e);
        continue;
      }
      const sid = e.session_id ?? '__no_session__';
      let arr = sessionEventsBySid.get(sid);
      if (arr === undefined) {
        arr = [];
        sessionEventsBySid.set(sid, arr);
      }
      arr.push(e);
    }

    // 会话卡按 lastTs 倒序(当日最活跃在前)
    const sortedSids = [...sessionEventsBySid.keys()].sort((a, b) => {
      const sa = sessionSummaries.get(a);
      const sb = sessionSummaries.get(b);
      const la = sa ? sa.lastMs : 0;
      const lb = sb ? sb.lastMs : 0;
      return lb - la;
    });

    const sessionCards: SessionCardModel[] = sortedSids.map((sid) => {
      const daySessionEvents = sessionEventsBySid.get(sid) ?? [];
      const s = sessionSummaries.get(sid);
      const isCrossDay = s !== undefined && localDateStr(new Date(s.firstMs)) !== localDateStr(new Date(s.lastMs));
      const isLive = s !== undefined && s.lastMs === overallMaxMs && overallMaxMs > 0;

      // L3:轮次(按 turn_id 分;null → 未分轮次尾桶)。
      // daySessionEvents 为 ts DESC(最新在前),按 turn_id 分桶后每组内仍是 DESC;
      // 用户期望会话内时间正序(最早在上、最新在下),故每组内 reverse 成 ASC。
      const byTurn = new Map<string, TimelineEvent[]>();
      let nullTurnEvents: TimelineEvent[] = [];
      for (const e of daySessionEvents) {
        if (e.turn_id === null) {
          nullTurnEvents.push(e);
        } else {
          let arr = byTurn.get(e.turn_id);
          if (arr === undefined) {
            arr = [];
            byTurn.set(e.turn_id, arr);
          }
          arr.push(e);
        }
      }

      // 轮次按首事件 ts ASC 排(最早轮在前),编号 1..M;每组内事件 reverse 成 ASC(最早事件在上)。
      const turnFirstMs = new Map<string, number>();
      for (const [tid, arr] of byTurn) {
        // arr 为 DESC(最新在前),最早 = 末尾
        turnFirstMs.set(tid, Date.parse(arr[arr.length - 1]!.ts));
      }
      const orderedTurnIds = [...byTurn.keys()].sort((a, b) => {
        const ta = turnFirstMs.get(a) ?? 0;
        const tb = turnFirstMs.get(b) ?? 0;
        return ta - tb; // ASC:最早轮在前
      });

      const turns: TurnGroupModel[] = orderedTurnIds.map((tid, idx) => {
        const arr = byTurn.get(tid) ?? [];
        const firstMs = turnFirstMs.get(tid) ?? 0;
        return {
          label: `轮 ${idx + 1} · ${pad2(new Date(firstMs).getHours())}:${pad2(new Date(firstMs).getMinutes())}`,
          events: [...arr].reverse().map(toEventRow), // DESC → ASC:最早事件在上
        };
      });
      if (nullTurnEvents.length > 0) {
        turns.push({ label: '未分轮次', events: [...nullTurnEvents].reverse().map(toEventRow) });
      }

      const turnCount = byTurn.size + (nullTurnEvents.length > 0 ? 1 : 0);
      const fallbackTool = daySessionEvents.find((e) => e.tool_name !== null)?.tool_name ?? null;

      return {
        sessionId: sid === '__no_session__' ? '(无会话)' : sid,
        title: sessionTitle(sid, s ?? { firstMs: 0, lastMs: 0, fullCount: 0, turnIds: new Set(), lastPrompt: null }, fallbackTool),
        turnCount,
        eventCount: daySessionEvents.length,
        fullCount: isCrossDay && s ? s.fullCount : null,
        fullTurnCount: isCrossDay && s ? s.turnIds.size : null,
        isCrossDay,
        isLive,
        firstTs: s ? cardTime(s.firstMs === Number.MAX_SAFE_INTEGER ? 0 : s.firstMs) : null,
        lastTs: s ? cardTime(s.lastMs) : null,
        turns,
      };
    });

    // 日期标题
    const d = new Date(`${day}T00:00:00`);
    const weekday = `周${WEEKDAYS[d.getDay()]}`;
    const label = isToday ? '今天' : isYesterday(day, todayStr) ? '昨天' : `${d.getMonth() + 1}月${d.getDate()}日`;
    const dateLabel = isToday || isYesterday(day, todayStr) ? `${d.getMonth() + 1}月${d.getDate()}日 ${weekday}` : weekday;
    const sessionCount = sessionCards.length;
    const eventCount = dayEvents.filter((e) => e.event_type !== 'git_commit').length;
    const commitCount = commits.length;
    const meta = `${sessionCount} 个会话 · ${eventCount} 条事件 · ${commitCount} 提交`;

    return {
      label,
      dateLabel,
      meta,
      sessionCards,
      commits: commits.map(toCommitRow),
    };
  });
}

/** day(YYYY-MM-DD)是否为 todayStr 的前一天。 */
function isYesterday(day: string, todayStr: string): boolean {
  const t = new Date(`${todayStr}T00:00:00`);
  t.setDate(t.getDate() - 1);
  return localDateStr(t) === day;
}

// ----- 概况条 + 模型组装 ---------------------------------------------------

/** 概况条今日最常用工具(今日事件中非空 tool_name 直方图 top1)。 */
function computeTopTool(todayEvents: TimelineEvent[]): { tool: string; count: number } | null {
  const counts = new Map<string, number>();
  for (const e of todayEvents) {
    if (e.tool_name === null) continue;
    counts.set(e.tool_name, (counts.get(e.tool_name) ?? 0) + 1);
  }
  let top: { tool: string; count: number } | null = null;
  for (const [tool, count] of counts) {
    if (top === null || count > top.count) top = { tool, count };
  }
  return top;
}

/** 近 7 日柱图(7 个本地日,今天在最右;计数取自 stats.byDay)。 */
function buildLast7Bars(stats: TimelineStats, todayStr: string): BarModel[] {
  const today = new Date(`${todayStr}T00:00:00`);
  const bars: BarModel[] = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date(today.getFullYear(), today.getMonth(), today.getDate() - i);
    const day = localDateStr(d);
    const entry = stats.byDay.find((b) => b.day === day);
    bars.push({
      day,
      count: entry ? entry.count : 0,
      label: `周${WEEKDAYS[d.getDay()]}`,
      isToday: i === 0,
    });
  }
  return bars;
}

/** 今日各类型计数(从今日事件直方图;用于 chip 计数,range=today 时)。 */
function todayByType(todayEvents: TimelineEvent[]): Record<EventType, number> {
  const out = { user_prompt: 0, pre_tool_use: 0, post_tool_use: 0, stop: 0, git_commit: 0, session_start: 0, session_end: 0 } as Record<EventType, number>;
  for (const e of todayEvents) out[e.event_type] += 1;
  return out;
}

/** 组装全量视图模型。所有 href 在此计算,模板侧只渲染。 */
async function assembleTimelineModel(projectRoot: string, query: TimelineQuery): Promise<TimelineContentModel> {
  const now = new Date();
  const todayStr = localDateStr(now);
  const sevenDayStr = (() => {
    const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 6);
    return localDateStr(d);
  })();

  // ---- 概况条(仪表盘口径,不受用户过滤影响)----
  const todayEventsRaw = await queryEvents(projectRoot, { since: todayStr, limit: 10000 });
  const todayEvents = todayEventsRaw.filter((e) => e.event_type !== 'git_commit'); // 概况"事件数"不含提交
  const todayActiveSessions = new Set(
    todayEventsRaw.map((e) => e.session_id).filter((s): s is string => s !== null),
  ).size;
  const topTool = computeTopTool(todayEventsRaw);

  const stats7d = await getEventStats(projectRoot, { since: sevenDayStr });
  const last7Bars = buildLast7Bars(stats7d, todayStr);

  // ---- 事件列表(受用户过滤影响)----
  const since = query.range === '7d' ? sevenDayStr : todayStr;
  const { events, capped } = await queryEventList(projectRoot, query, since);

  // ---- 筛选面板 ----
  const typeCounts = query.range === 'today' ? todayByType(todayEventsRaw) : stats7d.byType;
  const typeChips: TlFilterChipModel[] = TIMELINE_EVENT_TYPES.map((t) => {
    const active = query.types.includes(t);
    const href = active
      ? buildTimelineUrl(withoutTlValue(query, 'types', t))
      : buildTimelineUrl({ ...query, types: added(query.types, t) });
    return {
      label: EVENT_TYPE_LABELS[t],
      en: t,
      count: typeCounts[t] ?? 0,
      href,
      active,
      tone: EVENT_TYPE_CHIP_TONE[t],
    };
  });

  const rangeSeg = [
    { label: '今天', href: buildTimelineUrl({ ...query, range: 'today' }), active: query.range === 'today' },
    { label: '近 7 天', href: buildTimelineUrl({ ...query, range: '7d' }), active: query.range === '7d' },
  ];

  const searchBoxes = [
    { name: 'tool' as const, placeholder: 'tool_name,如 Bash', value: query.tool ?? '' },
    { name: 'file' as const, placeholder: '路径片段', value: query.file ?? '' },
    { name: 'session' as const, placeholder: 'session_id', value: query.session ?? '' },
  ];

  // ---- 激活 pill ----
  const pills: TlPillModel[] = [];
  if (query.range === '7d') {
    pills.push({ dimension: '时间范围', value: '近 7 天', removeHref: buildTimelineUrl(withoutTlValue(query, 'range', '')) });
  }
  for (const t of query.types) {
    pills.push({ dimension: '类型', value: EVENT_TYPE_LABELS[t], removeHref: buildTimelineUrl(withoutTlValue(query, 'types', t)) });
  }
  if (query.tool !== undefined) pills.push({ dimension: '工具', value: query.tool, removeHref: buildTimelineUrl(withoutTlValue(query, 'tool', '')) });
  if (query.file !== undefined) pills.push({ dimension: '文件', value: query.file, removeHref: buildTimelineUrl(withoutTlValue(query, 'file', '')) });
  if (query.session !== undefined) pills.push({ dimension: '会话', value: query.session, removeHref: buildTimelineUrl(withoutTlValue(query, 'session', '')) });

  // ---- 四级分桶 ----
  const sessionSummaries = buildSessionSummaries(events);
  const overallMaxMs = events.length > 0 ? Math.max(...events.map((e) => Date.parse(e.ts))) : 0;
  const dayGroups = bucketEvents(events, sessionSummaries, todayStr, overallMaxMs);

  // ---- 计数徽章 + 截断提示 ----
  const distinctSessions = new Set(
    events.filter((e) => e.event_type !== 'git_commit').map((e) => e.session_id).filter((s): s is string => s !== null),
  ).size;
  const countBadge = capped ? `${events.length}+ 条` : `${events.length} 条 · ${distinctSessions} 会话`;
  const truncationNotice = capped
    ? '已达单次查询上限(10,000 条),可能还有更多——收窄时间范围或增加过滤条件。'
    : null;

  // ---- 空状态(spec §3.4 三态)----
  const hasActiveFilter = query.types.length > 0 || query.tool !== undefined || query.file !== undefined || query.session !== undefined;
  let empty: TimelineContentModel['empty'];
  if (events.length > 0) {
    empty = 'none';
  } else if (stats7d.totalEvents === 0) {
    empty = 'timeline-empty';
  } else if (!hasActiveFilter) {
    empty = 'today-empty';
  } else {
    empty = 'no-match';
  }

  return {
    statbar: {
      todayEvents: todayEvents.length,
      todayActiveSessions,
      topTool,
      last7Bars,
      total7d: stats7d.totalEvents,
    },
    filters: { rangeSeg, typeChips, searchBoxes },
    pills,
    clearAllVisible: pills.length >= 2,
    clearAllHref: '/timeline',
    countBadge,
    truncationNotice,
    dayGroups,
    empty,
  };
}

// ----- 页面入口 ------------------------------------------------------------

/**
 * 渲染开发时间线页完整 HTML(壳 + 主区)。
 *
 * @param params 请求 URL 的查询参数。
 * @param ctx 版本 / 本地地址 / projectRoot(facade 以 projectRoot 自管连接)。
 */
export async function renderTimelinePage(
  params: URLSearchParams,
  ctx: { version: string; localHost: string; projectRoot: string },
): Promise<string> {
  const query = parseTimelineQuery(params);
  const model = await assembleTimelineModel(ctx.projectRoot, query);
  return renderShellPage({
    title: '开发时间线',
    active: 'timeline',
    contentHtml: renderTimelineContent(model),
    version: ctx.version,
    localHost: ctx.localHost,
  });
}
