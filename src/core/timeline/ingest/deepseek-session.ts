/**
 * DeepSeek Harness 会话文件读取器(~/.dsh/sessions/,行内 version 实测 4)。
 *
 * 实测回填结论(2026-11-07,读本机 ~/.dsh/sessions 全部 208 个 session.v4.jsonl.zstd 样本核对,只读):
 *
 * 布局(spec D13):`<编码项目目录>/<会话编号>/session.v4.jsonl.zstd`,目录名就是会话编号(主会话
 * `session-<uuid>`、子会话裸 uuid)。文件是拼接的 zstd 帧:每帧独立可解压,解压后是若干 JSONL 行
 * (本机 4 万+帧无坏帧)。按帧头结构扫描切帧(魔数、帧头描述符、块头、校验和;参照 deepseek-harness
 * 的 scanZstdFrames 自实现,不引入依赖),逐帧 zstdDecompressSync;尾部不完整的帧留到下次,结构性
 * 损坏(魔数不对等)抛错交补录层报 failed。帧按行边界写,但行切分仍做跨帧拼接(防御)。
 *
 * 行类型(session 文件头、user/message、tool/call、tool/result、turn/end、session/title 等 20 余种,
 * 在增加):不认识的行类型跳过不算错误(K11);`session/title` 行 T-1 按「不认识的行类型」跳过,
 * 标题映射归 T-2。行内不带会话编号与工作目录——会话编号看文件头,所以偏移大于 0 的增量趟也先读
 * 一次文件头(只读第一帧)定归属。
 *
 * 子会话与续接(实测):**子会话的判定标记是文件头 `origin === 'subagent'`**(delegationDepth 1、
 * 目录名裸 uuid、parentSession 指主会话),不能只看「带 parentSession」——续接主会话(isSeeded=true、
 * delegationDepth=0)也带 parentSession,但按 spec K4「续接后换了编号的,各算一行」各自独立。子会话
 * 全部事实的 sessionId 按 parentSession 链归到根主会话(父仍是子会话时沿链再找,本机实测只有一层;
 * 父文件不在 / 读不出时停在那一级),会话头的 startCwd 取子会话文件自己的开始目录;子会话只产会话头
 * 与工具事实(提问与轮次结束不产,与 claude 侧链行、codebuddy 子 agent 文件同口径),工具事实带
 * subagent.id = 子会话自己的编号。
 * 已知限制(plan C-4,记录不修):deepseek 文件按路径排序不保证主文件在子会话文件前,主会话的
 * session_start 事件先写者可能取到子会话的开始目录——子会话与主会话同仓,对匹配与展示无实害。
 *
 * 提问:`user/message` 行,`data.source.kind === 'user'` 是人发的(source 'user');其余 kind 是系统
 * 注入,按自动消息口径(claude 侧靠文本前缀识别,这里行内 kind 直接给了):`agent-message` 记
 * agent_message,`tool-jobs` / `subagent-settled`(后台任务 / 子会话结束通知)记 task_notification,
 * 再过一遍 classifyAutoMessage 兜文本标签;其余 kind(runtime-context / time-context / skill-catalog /
 * agent-instructions / skill-invocation / model-selection / compact-checkpoint / goal 等)跳过。
 * 文本取 data.content 各 text 块拼接;uuid 取 data.id。
 *
 * 工具:`tool/call`(callId、name、arguments——JSON 字符串,解析失败原样透传)配 `tool/result`
 * (data.message 上有 toolCallId、content、isError)按 callId 配对;发出 ts 取调用行、结果 ts 取结果行,
 * 结果载荷取 data.message 原样(摘要交管线);行内不带工作目录,事件 cwd 由管线用会话开始目录兜底。
 * 工具名是小写,映射 read→Read、write→Write、edit→Edit、bash→Bash、grep→Grep、glob→Glob、
 * skill→Skill(下游净化 / 摘要 / 看板查询按 Claude 工具名),不在映射表的原样传(如 web_fetch、
 * todo_write、subagent)。
 *
 * 轮次结束:`turn/end` 行(子会话不产);messageId 用 `<会话编号>:<seq>`——seq 只在本文件内唯一,
 * 拼上会话编号保 source_key 全局唯一。
 *
 * 时间戳:行内 time / 文件头 createdAt,epoch 毫秒数。
 *
 * 增量与「留到下次」:偏移只落在帧边界(0 或上次 consumedBytes)。还没有结果的工具调用:位于最后一个
 * 轮次边界(提问行 / turn/end 行)所在帧之后的,consumedBytes 收到它所在帧的帧头留给下一趟(帧是
 * 原子单位,重读整帧,重复事实由 source_key 去重),边界之前仍没有结果的按死调用丢弃——与 claude /
 * codebuddy 读取器同口径。
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import * as zlib from 'node:zlib';
import { classifyAutoMessage, type AutoMessageSource } from '../auto-message';
import type { PromptSource, SessionFact, SessionFactTs, SessionFileReadResult } from './types';

/** zstd 帧魔数(小端读)。 */
const ZSTD_MAGIC = 0xfd2fb528;

/** DeepSeek 会话文件名(会话目录下固定这个名字)。 */
const SESSION_FILENAME = 'session.v4.jsonl.zstd';

/** 读文件头时预读的字节数(第一帧里的头一行很短,256KB 足够;读不完整按没有头处理)。 */
const HEADER_PROBE_BYTES = 256 * 1024;

/** 小写工具名 → 下游口径(Claude 风格)工具名;不在表里的原样传。 */
const TOOL_NAMES: Readonly<Record<string, string>> = {
  read: 'Read',
  write: 'Write',
  edit: 'Edit',
  bash: 'Bash',
  grep: 'Grep',
  glob: 'Glob',
  skill: 'Skill',
};

/** 系统注入 kind → 自动消息来源(claude 侧靠文本前缀识别的两类,这里行内 kind 直接给了)。 */
const AUTO_KINDS: Readonly<Record<string, AutoMessageSource>> = {
  'agent-message': 'agent_message',
  'tool-jobs': 'task_notification',
  'subagent-settled': 'task_notification',
};

// ─── zstd 帧扫描(参照 deepseek-harness 的 scanZstdFrames 结构自实现)───────────────

/** 一个完整帧的字节区间(相对读入的缓冲)。 */
interface ZstdFrameRange {
  readonly start: number;
  readonly end: number;
}

/**
 * 按帧头结构切出全部完整帧,不解压:魔数(4 字节)→ 帧头描述符(内容长度字节数由 flag 决定、
 * 单段标志少一个窗口字节、字典 id、校验和标志)→ 逐块块头(最后块标志、块类型、块长;RLE 块
 * 载荷固定 1 字节)→ 可选校验和。结构性损坏(魔数不对、保留位非零、保留块类型)抛错;文件尾
 * 截断在帧中间的,那帧不算完整(留给下次)。
 */
function scanZstdFrames(buf: Buffer): ZstdFrameRange[] {
  const frames: ZstdFrameRange[] = [];
  let offset = 0;
  while (offset < buf.length) {
    const start = offset;
    if (buf.length - offset < 4) return frames; // 连魔数都没写全:帧没写完,留到下次
    if (buf.readUInt32LE(offset) !== ZSTD_MAGIC) {
      throw new Error(`DeepSeek 会话文件 zstd 帧魔数不对(字节 ${start})`);
    }
    offset += 4;
    if (offset === buf.length) return frames;
    const descriptor = buf.readUInt8(offset);
    offset += 1;
    if ((descriptor & 0x18) !== 0) {
      throw new Error(`DeepSeek 会话文件 zstd 帧头保留位非零(字节 ${offset - 1})`);
    }
    const contentSizeFlag = descriptor >>> 6;
    const singleSegment = (descriptor & 0x20) !== 0;
    const checksum = (descriptor & 0x04) !== 0;
    const dictionaryFlag = descriptor & 0x03;
    const dictionaryBytes = dictionaryFlag === 3 ? 4 : dictionaryFlag;
    const contentSizeBytes = contentSizeFlag === 0 ? (singleSegment ? 1 : 0) : 1 << contentSizeFlag;
    const remainingHeaderBytes = (singleSegment ? 0 : 1) + dictionaryBytes + contentSizeBytes;
    if (buf.length - offset < remainingHeaderBytes) return frames;
    offset += remainingHeaderBytes;
    for (;;) {
      if (buf.length - offset < 3) return frames;
      const blockHeader = buf.readUIntLE(offset, 3);
      offset += 3;
      const lastBlock = (blockHeader & 1) !== 0;
      const blockType = (blockHeader >>> 1) & 0x03;
      const blockSize = blockHeader >>> 3;
      if (blockType === 0x03) {
        throw new Error(`DeepSeek 会话文件 zstd 保留块类型(字节 ${offset - 3})`);
      }
      const payloadBytes = blockType === 0x01 ? 1 : blockSize;
      if (buf.length - offset < payloadBytes) return frames;
      offset += payloadBytes;
      if (lastBlock) break;
    }
    if (checksum) {
      if (buf.length - offset < 4) return frames;
      offset += 4;
    }
    frames.push({ start, end: offset });
  }
  return frames;
}

// ─── 值的防御性读取 ──────────────────────────────────────────────────────────

function asRecord(v: unknown): Record<string, unknown> | null {
  return v !== null && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}

function str(v: unknown): string | undefined {
  return typeof v === 'string' && v.length > 0 ? v : undefined;
}

/** 行内时间戳:实测是 epoch 毫秒数;不是有限数字按没有处理。 */
function msOf(v: unknown): number | undefined {
  return typeof v === 'number' && Number.isFinite(v) ? v : undefined;
}

/** 消息文本:content 为字符串原样;块数组拼接各 text 块(以换行相连)。 */
function extractTextBlocks(content: unknown): string {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  const parts: string[] = [];
  for (const b of content) {
    const blk = asRecord(b);
    if (blk !== null && typeof blk['text'] === 'string') parts.push(blk['text']);
  }
  return parts.join('\n');
}

/** arguments 是 JSON 字符串;解析失败原样透传(解析归管线,与 codebuddy 读取器同款)。 */
function parseArgs(v: unknown): unknown {
  if (typeof v !== 'string') return v;
  try {
    return JSON.parse(v);
  } catch {
    return v;
  }
}

// ─── 文件头与子会话归并 ──────────────────────────────────────────────────────

/** 文件头(session 行)解析结果。 */
interface SessionHeader {
  readonly id: string;
  readonly cwd: string;
  readonly ts: SessionFactTs;
  readonly parentSession: string | undefined;
  readonly origin: string | undefined;
}

/** 子会话头:origin 标 subagent(实测全部子会话带它、续接主会话不带,只看 parentSession 会误伤续接)。 */
function isChildHeader(header: SessionHeader): boolean {
  return header.parentSession !== undefined && header.origin === 'subagent';
}

/** 解析一行 session 头;字段不全 → null。 */
function parseSessionHeader(obj: Record<string, unknown>): SessionHeader | null {
  const id = str(obj['id']);
  const cwd = str(obj['cwd']);
  const ts = msOf(obj['createdAt']);
  if (id === undefined || cwd === undefined || ts === undefined) return null;
  return { id, cwd, ts, parentSession: str(obj['parentSession']), origin: str(obj['origin']) };
}

/** 读一个文件的头(第一帧的第一行 session);读不了 / 头不完整 → null。 */
function readFirstHeader(file: string): SessionHeader | null {
  let buf: Buffer;
  try {
    const fd = fs.openSync(file, 'r');
    try {
      const head = Buffer.alloc(HEADER_PROBE_BYTES);
      const n = fs.readSync(fd, head, 0, head.length, 0);
      buf = head.subarray(0, n);
    } finally {
      try {
        fs.closeSync(fd);
      } catch {
        // 关不上不影响读到的内容
      }
    }
  } catch {
    return null;
  }
  let text: string;
  try {
    const frames = scanZstdFrames(buf);
    const first = frames[0];
    if (first === undefined) return null;
    text = zlib.zstdDecompressSync(buf.subarray(first.start, first.end)).toString('utf8');
  } catch {
    return null;
  }
  const firstLine = text.split('\n').find((l) => l.length > 0);
  if (firstLine === undefined) return null;
  try {
    const obj = asRecord(JSON.parse(firstLine));
    if (obj === null || obj['type'] !== 'session') return null;
    return parseSessionHeader(obj);
  } catch {
    return null;
  }
}

/**
 * 按会话编号找它的文件并读头(目录名就是会话编号,在根的一级目录下找);找不到 / 读不出 → null。
 * 结果按调用缓存(同一次读取里链上多次查找不重复读盘)。
 */
function readHeaderOf(
  sessionId: string,
  rootDir: string,
  cache: Map<string, SessionHeader | null>,
): SessionHeader | null {
  const cached = cache.get(sessionId);
  if (cached !== undefined) return cached;
  let found: SessionHeader | null = null;
  try {
    for (const group of fs.readdirSync(rootDir, { withFileTypes: true })) {
      if (!group.isDirectory()) continue;
      const file = path.join(rootDir, group.name, sessionId, SESSION_FILENAME);
      try {
        if (!fs.statSync(file).isFile()) continue;
      } catch {
        continue;
      }
      found = readFirstHeader(file);
      break;
    }
  } catch {
    // 根目录读不了:按找不到处理
  }
  cache.set(sessionId, found);
  return found;
}

/**
 * 事实归属的根主会话编号:主会话 / 续接是自己;子会话沿 parentSession 链找根(父仍是子会话时
 * 继续往上,本机实测只有一层;父文件不在 / 读不出时停在那一级,事实仍有归属;环停住)。
 */
function resolveRootSessionId(header: SessionHeader, rootDir: string, cache: Map<string, SessionHeader | null>): string {
  if (!isChildHeader(header)) return header.id;
  let rootId = header.id;
  let parent = header.parentSession;
  let origin = header.origin;
  const seen = new Set<string>([header.id]);
  while (parent !== undefined && origin === 'subagent') {
    rootId = parent;
    if (seen.has(parent)) break;
    seen.add(parent);
    const ph = readHeaderOf(parent, rootDir, cache);
    if (ph === null) break;
    parent = ph.parentSession;
    origin = ph.origin;
  }
  return rootId;
}

// ─── 单趟扫描 ───────────────────────────────────────────────────────────────

/** 待结果的工具调用(发出时挂起,结果行到达配对成事实;frameStart 用于「留到下次」的收回)。 */
interface PendingCall {
  readonly frameStart: number;
  readonly callId: string;
  readonly toolName: string;
  readonly args: unknown;
  readonly issuedTs: SessionFactTs;
}

/** 单趟扫描状态。 */
interface ScanState {
  readonly facts: SessionFact[];
  /** 本文件的头(只认第一个;增量趟先读文件头补上,但不重产会话头事实)。 */
  header: SessionHeader | null;
  /** 事实归属的根主会话编号(子会话归并后;主会话 / 续接是自己);没读到头之前为 null。 */
  rootSessionId: string | null;
  /** 本文件是不是子会话。 */
  isChild: boolean;
  readonly pendingCalls: Map<string, PendingCall>;
  /** 最后一个轮次边界(提问 / turn/end)所在帧的帧尾(文件绝对偏移)。 */
  boundaryEnd: number;
}

/** 采纳文件头:定归属与子会话标记;emitHead 只在读到头这一行的那趟为真(增量趟不重产会话头)。 */
function adoptHeader(
  header: SessionHeader,
  s: ScanState,
  rootDir: string,
  headerCache: Map<string, SessionHeader | null>,
  emitHead: boolean,
): void {
  if (s.header !== null) return;
  s.header = header;
  s.rootSessionId = resolveRootSessionId(header, rootDir, headerCache);
  s.isChild = isChildHeader(header);
  if (emitHead) {
    s.facts.push({ kind: 'session_head', sessionId: s.rootSessionId, startCwd: header.cwd, ts: header.ts });
  }
}

function handleUserMessage(obj: Record<string, unknown>, frame: ZstdFrameRange, s: ScanState): void {
  if (s.isChild) return; // 子会话不产提问(与 claude 侧链、codebuddy 子 agent 文件同口径)
  const data = asRecord(obj['data']);
  if (data === null) return;
  const text = extractTextBlocks(data['content']);
  const kind = str(asRecord(data['source'])?.['kind']);
  if (kind === 'user') {
    pushPrompt(data, obj, text, 'user', frame, s);
    return;
  }
  // 其余 kind 是系统注入,按自动消息口径(kind 直接给了,再兜一遍文本标签);不在口径里的跳过
  const mapped = kind !== undefined ? AUTO_KINDS[kind] : undefined;
  const auto = mapped ?? classifyAutoMessage(text);
  if (auto !== null) pushPrompt(data, obj, text, auto, frame, s);
}

function pushPrompt(
  data: Record<string, unknown>,
  obj: Record<string, unknown>,
  text: string,
  source: PromptSource,
  frame: ZstdFrameRange,
  s: ScanState,
): void {
  if (text.length === 0) return;
  const uuid = str(data['id']);
  const ts = msOf(obj['time']);
  if (uuid === undefined || ts === undefined || s.rootSessionId === null) return;
  s.facts.push({ kind: 'prompt', sessionId: s.rootSessionId, ts, uuid, text, source });
  s.boundaryEnd = frame.end;
}

function handleToolCall(obj: Record<string, unknown>, frame: ZstdFrameRange, s: ScanState): void {
  const data = asRecord(obj['data']);
  if (data === null) return;
  const callId = str(data['callId']);
  const name = str(data['name']);
  const ts = msOf(obj['time']);
  if (callId === undefined || name === undefined || ts === undefined || s.rootSessionId === null) return;
  s.pendingCalls.set(callId, {
    frameStart: frame.start,
    callId,
    toolName: TOOL_NAMES[name] ?? name,
    args: parseArgs(data['arguments']),
    issuedTs: ts,
  });
}

function handleToolResult(obj: Record<string, unknown>, s: ScanState): void {
  const message = asRecord(asRecord(obj['data'])?.['message']);
  const callId = str(message?.['toolCallId']) ?? str(asRecord(message?.['source'])?.['callId']);
  if (callId === undefined) return;
  const call = s.pendingCalls.get(callId);
  if (call === undefined) return; // 调用在更早的趟里按死调用丢弃,或本就是孤儿结果
  s.pendingCalls.delete(callId);
  const ts = msOf(obj['time']);
  if (ts === undefined || s.rootSessionId === null) return;
  s.facts.push({
    kind: 'tool',
    sessionId: s.rootSessionId,
    cwd: undefined, // 行内不带工作目录,事件 cwd 由管线用会话开始目录兜底
    toolUseId: call.callId,
    toolName: call.toolName,
    issuedTs: call.issuedTs,
    args: call.args,
    resultTs: ts,
    resultPayload: message, // 原样交管线摘要(content / isError 都在 message 上)
    isError: message?.['isError'] === true,
    // 子会话里的调用标上发起它的子会话编号(claude 侧链行标 agentId 的同款口径)
    subagent: s.isChild && s.header !== null ? { id: s.header.id } : undefined,
  });
}

function handleTurnEnd(obj: Record<string, unknown>, frame: ZstdFrameRange, s: ScanState): void {
  if (s.isChild) return; // 子会话的轮次不算主会话的轮次结束
  const ts = msOf(obj['time']);
  const seq = obj['seq'];
  if (ts === undefined || s.rootSessionId === null) return;
  if (typeof seq !== 'number' && typeof seq !== 'string') return; // 没有行内 seq 就没有稳定去重键
  s.facts.push({ kind: 'turn_end', sessionId: s.rootSessionId, ts, messageId: `${s.rootSessionId}:${seq}` });
  s.boundaryEnd = frame.end;
}

function handleLine(
  obj: Record<string, unknown>,
  frame: ZstdFrameRange,
  s: ScanState,
  rootDir: string,
  headerCache: Map<string, SessionHeader | null>,
): void {
  if (obj['type'] === 'session') {
    const header = parseSessionHeader(obj);
    if (header !== null) adoptHeader(header, s, rootDir, headerCache, true);
    return;
  }
  if (s.rootSessionId === null) return; // 头还没定:这一行不产事实
  const type = obj['type'];
  if (type === 'user/message') handleUserMessage(obj, frame, s);
  else if (type === 'tool/call') handleToolCall(obj, frame, s);
  else if (type === 'tool/result') handleToolResult(obj, s);
  else if (type === 'turn/end') handleTurnEnd(obj, frame, s);
  // 其余行类型(session/title 等)不认识,跳过不算错误(K11)
}

/** 从 from 起读到文件末尾(单 buffer;本机 DeepSeek 会话文件最大几 MB,不做分块流式)。 */
function readTailSync(file: string, from: number, size: number): Buffer {
  const fd = fs.openSync(file, 'r');
  try {
    const out = Buffer.alloc(size - from);
    let read = 0;
    while (read < out.length) {
      const n = fs.readSync(fd, out, read, out.length - read, from + read);
      if (n <= 0) break;
      read += n;
    }
    return read === out.length ? out : out.subarray(0, read);
  } finally {
    try {
      fs.closeSync(fd);
    } catch {
      // 关不上不影响读到的内容
    }
  }
}

/** 读 DeepSeek 会话文件,产出本趟新增的会话事实(契约见 types.ts 与本文件头注释)。 */
export async function readDeepSeekSessionFacts(
  filePath: string,
  fromByteOffset: number,
): Promise<SessionFileReadResult> {
  const size = fs.statSync(filePath).size;
  let start = fromByteOffset;
  if (start > size) start = 0; // 文件变短(截断重写):从头重读,重复事实靠 source_key 去重
  if (start >= size) return { facts: [], consumedBytes: start };

  const tail = readTailSync(filePath, start, size);
  const frames = scanZstdFrames(tail);
  // 会话根目录(<root>/<一级目录>/<会话编号>/文件 再上两层),找父会话文件用
  const rootDir = path.dirname(path.dirname(path.dirname(filePath)));
  const headerCache = new Map<string, SessionHeader | null>();
  const s: ScanState = {
    facts: [],
    header: null,
    rootSessionId: null,
    isChild: false,
    pendingCalls: new Map(),
    boundaryEnd: start,
  };
  // 增量趟:行内不带会话编号,先读文件头定归属(不重产会话头事实,它在读偏移 0 的那趟产过)
  if (start > 0) {
    const header = readFirstHeader(filePath);
    if (header !== null) adoptHeader(header, s, rootDir, headerCache, false);
  }

  let carry = ''; // 帧尾没有换行时,行在下一帧续(实测帧按行边界写,纯防御)
  let lastFrameEnd = start;
  for (const frame of frames) {
    const absolute: ZstdFrameRange = { start: start + frame.start, end: start + frame.end };
    lastFrameEnd = absolute.end;
    const text = zlib.zstdDecompressSync(tail.subarray(frame.start, frame.end)).toString('utf8');
    const lines = (carry + text).split('\n');
    carry = lines.pop() ?? ''; // 最后一段没有换行结尾:留给下一帧;最终仍没有的按未完行丢弃
    for (const line of lines) {
      if (line.length === 0) continue;
      let obj: Record<string, unknown> | null = null;
      try {
        obj = asRecord(JSON.parse(line));
      } catch {
        continue; // 坏行跳过,不算错误(K11)
      }
      if (obj === null) continue;
      // 单行处理异常只丢这一行,不拖垮整趟(宁可多跳过、不可抛错)
      try {
        handleLine(obj, absolute, s, rootDir, headerCache);
      } catch {
        // 跳过该行
      }
    }
  }

  // 还没有结果的调用:轮次边界之后的留到下一趟(帧是原子单位,consumedBytes 收到它所在帧的
  // 帧头),之前的按死调用丢弃——与 claude / codebuddy 读取器同口径
  let heldStart = Number.MAX_SAFE_INTEGER;
  for (const call of s.pendingCalls.values()) {
    if (call.frameStart >= s.boundaryEnd && call.frameStart < heldStart) heldStart = call.frameStart;
  }
  const consumedBytes = heldStart !== Number.MAX_SAFE_INTEGER ? heldStart : lastFrameEnd;
  return { facts: s.facts, consumedBytes };
}
