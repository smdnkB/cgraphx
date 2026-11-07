/**
 * Claude Code 会话文件读取器(~/.claude/projects/,行内 version 实测 2.1.204)。
 *
 * 实测回填结论(2026-11-06,读本机 ~/.claude/projects 3,239 个 .jsonl 样本核对,只读):
 *
 * 布局(K2/D3):`<项目目录>/<会话>.jsonl` 主会话文件,加 `<项目目录>/<会话>/subagents/`
 * 下的 `agent-<id>.jsonl` 子 agent 文件(subagents 里另有 workflows/<wf>/ 一层嵌套布局,
 * 以及 .meta.json / .prefix.json 同名文件,不是 .jsonl 不列)。子 agent 文件每行都带
 * cwd、agentId、isSidechain=true,sessionId 是**主会话**的编号——工具事实的 subagent.id
 * 取行内 agentId;agent 的 type 行内没有(在 .meta.json,本读取器不读)。
 *
 * 行字段:user / assistant 行带 type、sessionId、uuid、parentUuid、timestamp(ISO 8601)、
 * cwd、gitBranch、version、userType、isSidechain;user 行另有 isMeta、isCompactSummary、
 * message{role, content, stop_reason, id}、行级 toolUseResult;message.content 是字符串或
 * 块数组(user 块:tool_result{tool_use_id, content, is_error} / text / image;assistant
 * 块:tool_use{id, name, input} / text / thinking)。整个库 20 多种行类型且在增加,
 * 不认识的行类型单独跳过、不算错误(K11)。
 *
 * 提问(K5/D6,含实测校准):
 *   - `<task-notification>` / `<agent-message` 开头 → 自动消息(沿用 classifyAutoMessage,
 *     含 isMeta 行);**子 agent 交回的 user 行实测全部(316/316)带
 *     `Another Claude session sent a message:` 前缀且 isMeta=true**——先剥这个已知前缀
 *     再过 classifyAutoMessage,不剥的话 hook 时代 328 条 agent_message 一条都对不上
 *     (校准依据见任务 T-2 交付说明);
 *   - 其余 isMeta、`[Request interrupted` 开头、`<local-command` 开头不算;
 *   - `<command-name>` 还原成 `/命令 参数`;
 *   - queued_command 是 type=attachment 行(attachment.prompt 存排队原文,通常是
 *     task-notification / agent-message):排队先写附件、送达才写 user 行,附件文本
 *     (剥前缀后)没有对上本趟 user 行文本的才算一条。
 *
 * 工具(K7/D7):assistant 行的 tool_use 块与 user 行的 tool_result 块按编号配对成一条,
 * 结果载荷取结果行的行级 toolUseResult,失败取 tool_result 块的 is_error。
 *
 * 轮次结束(K6):stop_reason === 'end_turn' 且非侧链的 assistant 行,取该行 ts 与
 * message.id(msg_…)。侧链(子 agent)回复不产轮次结束。
 *
 * 标题(spec 2026-11-06-agent看板 D8、K5,实测 2026-11-07 全量核对 25,914 行):type 为
 * `custom-title` / `ai-title` 的行,形态 `{ type, customTitle|aiTitle, sessionId }`——不带
 * timestamp 与 cwd,sessionId 全有、标题仅 1 例为空(跳过);同一条标题在文件里反复追加
 * (抽样最近 400 个主会话:92 个有 custom、204 个有 ai、4 个两种都有),只出现在主文件,
 * 子 agent 文件里没有。产 session_title 事实('custom' / 'ai');行内没有时间,ts 取文件里
 * 它前面最近一条带时间行的时间(见 handleTitleRow)。
 *
 * 增量与「留到下次」:按字节偏移读到最后一个完整行;还没有结果的工具调用不产事实——
 * 调用行位于最后一个轮次边界(提问行 / end_turn 行)之后的,consumedBytes 收在它前面,
 * 下一趟重读配对(重读产生的重复事实由 C-2 的 source_key 去重);边界之前仍没有结果的
 * 按死调用丢弃(D7:一直没有结果的不记)。queued_command 附件当趟读完全文后即判定:
 * 排队与送达几乎不重叠(实测本库 61 个会话 0 例撞上),跨趟才送达的极少数会多记一条,
 * 接受(详见 T-2 交付说明)。事实时间戳一律取行内值。
 */

import { classifyAutoMessage } from '../auto-message';
import { readJsonlLinesFrom } from './jsonl-lines';
import type { PromptSource, SessionFact, SessionFactTs, SessionFileReadResult } from './types';

/** 待结果的工具调用(发出时挂起,结果行到达配对成事实)。 */
interface PendingCall {
  readonly lineStart: number;
  readonly toolUseId: string;
  readonly toolName: string;
  readonly args: unknown;
  readonly issuedTs: string;
  readonly cwd: string | undefined;
  readonly sessionId: string;
  readonly subagent: { readonly id: string } | undefined;
}

/** 排队的命令(附件行);全趟读完后再判定有没有对应用户行。 */
interface QueuedCommand {
  readonly uuid: string;
  readonly ts: string;
  readonly sessionId: string;
  readonly text: string;
}

function asRecord(v: unknown): Record<string, unknown> | null {
  return v !== null && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : null;
}

function str(v: unknown): string | undefined {
  return typeof v === 'string' && v.length > 0 ? v : undefined;
}

/** 子 agent 交回的前缀行(实测 316/316 的 agent-message user 行都带它且 isMeta=true);剩余部分确实是交回标签才剥。 */
const HANDBACK_PREAMBLE = 'Another Claude session sent a message:';

function stripHandbackPreamble(text: string): string {
  const head = text.trimStart();
  if (!head.startsWith(HANDBACK_PREAMBLE)) return text;
  const rest = head.slice(HANDBACK_PREAMBLE.length).trimStart();
  return rest.startsWith('<agent-message') ? rest : text;
}

/** `<command-name>/dev-merge</command-name>\n<command-args>…</command-args>` → `/dev-merge …`;取不到命令名原样返回。 */
function restoreCommandText(text: string): string {
  const name = /<command-name>\s*(\/?[^<]*?)\s*<\/command-name>/.exec(text)?.[1];
  if (!name) return text;
  const args = /<command-args>([\s\S]*?)<\/command-args>/.exec(text)?.[1]?.trim();
  const cmd = name.startsWith('/') ? name : `/${name}`;
  return args ? `${cmd} ${args}` : cmd;
}

/** user 行文本:content 为字符串原样;块数组拼接 text 块(多块以换行相连)。 */
function extractUserText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  const parts: string[] = [];
  for (const b of content) {
    const blk = asRecord(b);
    if (blk !== null && blk['type'] === 'text' && typeof blk['text'] === 'string') parts.push(blk['text']);
  }
  return parts.join('\n');
}

/** 单趟扫描状态。 */
interface ScanState {
  readonly facts: SessionFact[];
  /** 本趟已产会话头的 sessionId(跨趟重产的头由 C-2 按会话编号去重)。 */
  readonly headSeen: Set<string>;
  /** user 行文本(剥交回前缀后),供 queued_command 附件比对。 */
  readonly userTexts: Set<string>;
  readonly pendingCalls: Map<string, PendingCall>;
  readonly queuedCommands: QueuedCommand[];
  /** 最近一条带 timestamp 的行的时间:标题行不带时间,ts 取它(见 handleTitleRow)。 */
  lastTimestamp: string | null;
  /** 最后一个轮次边界(提问行 / end_turn 行)的行尾偏移;之后的挂起调用留到下一趟。 */
  boundaryEnd: number;
  lastLineEnd: number;
}

function handleUserRow(obj: Record<string, unknown>, line: { start: number; end: number }, s: ScanState): void {
  const message = asRecord(obj['message']);
  if (message === null) return;

  // 工具结果:与挂起的调用配对成一条工具事实
  const content = message['content'];
  if (Array.isArray(content)) {
    for (const b of content) {
      const blk = asRecord(b);
      if (blk === null || blk['type'] !== 'tool_result') continue;
      const id = str(blk['tool_use_id']);
      if (id === undefined) continue;
      const call = s.pendingCalls.get(id);
      if (call === undefined) continue; // 调用在更早的趟里按死调用丢弃,或本就是孤儿结果
      s.pendingCalls.delete(id);
      const ts = str(obj['timestamp']);
      if (ts === undefined) continue;
      s.facts.push({
        kind: 'tool',
        sessionId: call.sessionId,
        cwd: call.cwd,
        toolUseId: call.toolUseId,
        toolName: call.toolName,
        issuedTs: call.issuedTs,
        args: call.args,
        resultTs: ts,
        // D7:结果载荷取行级 toolUseResult;一行多个结果块时共用同一个(实测近乎一行一个)
        resultPayload: obj['toolUseResult'],
        isError: blk['is_error'] === true,
        subagent: call.subagent,
      });
    }
  }

  // 提问判定:侧链、压缩摘要、带工具结果的行不算提问
  if (obj['isSidechain'] === true || obj['isCompactSummary'] === true) return;
  if (Array.isArray(content) && content.some((b) => asRecord(b)?.['type'] === 'tool_result')) return;
  const text = extractUserText(content);
  if (text.length === 0) return;
  const uuid = str(obj['uuid']);
  const ts = str(obj['timestamp']);
  const sessionId = str(obj['sessionId']);
  if (uuid === undefined || ts === undefined || sessionId === undefined) return;

  const stripped = stripHandbackPreamble(text);
  s.userTexts.add(stripped);
  const auto = classifyAutoMessage(stripped);
  if (auto !== null) {
    pushPrompt(s, sessionId, ts, uuid, stripped, auto, line.end);
    return;
  }
  if (obj['isMeta'] === true) return;
  const head = text.trimStart();
  if (head.startsWith('[Request interrupted')) return;
  if (head.startsWith('<local-command')) return;
  if (text.includes('<command-name>')) {
    pushPrompt(s, sessionId, ts, uuid, restoreCommandText(text), 'user', line.end);
    return;
  }
  pushPrompt(s, sessionId, ts, uuid, text, 'user', line.end);
}

function handleAssistantRow(obj: Record<string, unknown>, line: { start: number; end: number }, s: ScanState): void {
  const message = asRecord(obj['message']);
  if (message === null) return;

  // 工具调用挂起(侧链行也挂:子 agent 的调用算进发起它的会话,K7)
  const ts = str(obj['timestamp']);
  if (ts !== undefined && Array.isArray(message['content'])) {
    const sessionId = str(obj['sessionId']);
    const cwd = str(obj['cwd']);
    const agentId = str(obj['agentId']);
    for (const b of message['content']) {
      const blk = asRecord(b);
      if (blk === null || blk['type'] !== 'tool_use') continue;
      const id = str(blk['id']);
      const name = str(blk['name']);
      if (id === undefined || name === undefined || sessionId === undefined) continue;
      s.pendingCalls.set(id, {
        lineStart: line.start,
        toolUseId: id,
        toolName: name,
        args: blk['input'],
        issuedTs: ts,
        cwd,
        sessionId,
        subagent: agentId !== undefined ? { id: agentId } : undefined,
      });
    }
  }

  // 轮次结束:end_turn 且非侧链
  if (obj['isSidechain'] === true || message['stop_reason'] !== 'end_turn') return;
  const messageId = str(message['id']);
  const sessionId = str(obj['sessionId']);
  if (messageId === undefined || sessionId === undefined || ts === undefined) return;
  s.facts.push({ kind: 'turn_end', sessionId, ts, messageId });
  s.boundaryEnd = line.end;
}

function handleAttachmentRow(obj: Record<string, unknown>, s: ScanState): void {
  const attachment = asRecord(obj['attachment']);
  if (attachment === null || attachment['type'] !== 'queued_command') return;
  const prompt = str(attachment['prompt']);
  const uuid = str(obj['uuid']);
  const ts = str(obj['timestamp']);
  const sessionId = str(obj['sessionId']);
  if (prompt === undefined || uuid === undefined || ts === undefined || sessionId === undefined) return;
  s.queuedCommands.push({ uuid, ts, sessionId, text: stripHandbackPreamble(prompt) });
}

function pushPrompt(
  s: ScanState,
  sessionId: string,
  ts: SessionFactTs,
  uuid: string,
  text: string,
  source: PromptSource,
  boundaryLineEnd: number,
): void {
  s.facts.push({ kind: 'prompt', sessionId, ts, uuid, text, source });
  s.boundaryEnd = boundaryLineEnd;
}

/**
 * 标题行(D8、K5):`custom-title` / `ai-title`,标题字段名随类型(customTitle / aiTitle)。
 * 行内不带时间,ts 取文件里它前面最近一条带时间行的时间(一条都还没有 → 0,只作同级比较,
 * 输给任何真实时间);同一条标题在文件里反复追加,由管线「同级取新」收敛成一个会话一行。
 * 增量趟只产已消费偏移之后的行,与「读到最后一个完整行」语义一致。
 */
function handleTitleRow(obj: Record<string, unknown>, titleKind: 'custom' | 'ai', s: ScanState): void {
  const title = str(obj[titleKind === 'custom' ? 'customTitle' : 'aiTitle']);
  const sessionId = str(obj['sessionId']);
  if (title === undefined || sessionId === undefined) return;
  s.facts.push({ kind: 'session_title', sessionId, ts: s.lastTimestamp ?? 0, title, titleKind });
}

/** 读 Claude Code 会话文件,产出本趟新增的会话事实(契约见 types.ts 与本文件头注释)。 */
export async function readClaudeSessionFacts(filePath: string, fromByteOffset: number): Promise<SessionFileReadResult> {
  const s: ScanState = {
    facts: [],
    headSeen: new Set(),
    userTexts: new Set(),
    pendingCalls: new Map(),
    queuedCommands: [],
    lastTimestamp: null,
    boundaryEnd: 0,
    lastLineEnd: fromByteOffset,
  };

  s.lastLineEnd = await readJsonlLinesFrom(filePath, fromByteOffset, (line) => {
    let obj: Record<string, unknown> | null = null;
    try {
      obj = asRecord(JSON.parse(line.text));
    } catch {
      return; // 坏行跳过,不算错误(K11)
    }
    if (obj === null) return;
    const type = obj['type'];

    // 会话头:每个 sessionId 在本文件首次出现处产一个(要求该行带 cwd 与 ts;mode 等行没有)
    const sessionId = str(obj['sessionId']);
    const cwd = str(obj['cwd']);
    const ts = str(obj['timestamp']);
    if (sessionId !== undefined && cwd !== undefined && ts !== undefined && !s.headSeen.has(sessionId)) {
      s.headSeen.add(sessionId);
      s.facts.push({ kind: 'session_head', sessionId, startCwd: cwd, ts });
    }

    // 单行处理异常只丢这一行,不拖垮整趟(宁可多跳过、不可抛错)
    try {
      if (type === 'user') handleUserRow(obj, line, s);
      else if (type === 'assistant') handleAssistantRow(obj, line, s);
      else if (type === 'attachment') handleAttachmentRow(obj, s);
      else if (type === 'custom-title') handleTitleRow(obj, 'custom', s);
      else if (type === 'ai-title') handleTitleRow(obj, 'ai', s);
    } catch {
      // 跳过该行
    }

    // 标题行不带时间:记住最近一条带时间行的时间,给它后面出现的标题行当 ts(handleTitleRow)
    if (ts !== undefined) s.lastTimestamp = ts;
  });

  // queued_command 附件:文本没有对应用户行的才算一条(D6)
  for (const q of s.queuedCommands) {
    if (s.userTexts.has(q.text)) continue;
    const auto = classifyAutoMessage(q.text);
    s.facts.push({ kind: 'prompt', sessionId: q.sessionId, ts: q.ts, uuid: q.uuid, text: q.text, source: auto ?? 'user' });
  }

  // 还没有结果的调用:轮次边界之后的留到下一趟(consumedBytes 收在它前面),之前的按死调用丢弃
  let heldStart = Number.MAX_SAFE_INTEGER;
  for (const call of s.pendingCalls.values()) {
    if (call.lineStart >= s.boundaryEnd && call.lineStart < heldStart) heldStart = call.lineStart;
  }
  const consumedBytes = heldStart !== Number.MAX_SAFE_INTEGER ? heldStart : s.lastLineEnd;
  return { facts: s.facts, consumedBytes };
}
