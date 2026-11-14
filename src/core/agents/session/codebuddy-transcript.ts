/**
 * CodeBuddy 会话文件读取器(~/.codebuddy/projects/,本机实测 2.167.0)。
 *
 * 实测回填结论(2026-11-06,读本机 ~/.codebuddy/projects 全部 18 个 .jsonl 样本核对,只读),
 * 回填 spec 待确认项 1 的三点:
 *
 * 布局:`<项目目录>/<会话>.jsonl` 主会话文件 + `<会话>/subagents/agent-<id>.jsonl` 子 agent
 * 文件(与 spec 猜的一致;另有 `<会话>/tool-results/*.txt`,不是 .jsonl 不列)。行类型只有
 * 六种:message(role user/assistant)、reasoning、function_call、function_call_result、
 * file-history-snapshot、session-meta;几乎每行都带 cwd、timestamp(epoch 毫秒数,不是 ISO)。
 *
 * 子 agent 归属:子 agent 文件行内的 sessionId 是独立的子会话编号(**不是**主会话编号,
 * session-meta 行才是 agent-<id>,与文件名一致)——按 K7「子 agent 里的调用算进发起它的
 * 会话」,按文件布局把事实归到主会话(父目录名即主会话编号),subagent.id 取文件名
 * (agent-<id>),subagent.type 取行内 providerData.agent(子 agent 行是类型名如 'Explore',
 * 主会话行是 'cli');子 agent 文件不产提问与轮次结束(与 claude 侧链行同口径)。
 *
 * status 含义(待确认项第 2 点):function_call_result 的 status `completed`=成功、
 * `incomplete`=失败(实测权限拒绝、文件不存在、命令报错全是 incomplete,成功读取/子 agent
 * 交回为 completed),映射进 isError;assistant message 行也有 status,`completed`=流式完成,
 * `incomplete`=认证失败等中断——中断的行不带 usage,不产轮次结束。
 *
 * 斜杠命令与自动消息的原文形式(待确认项第 3 点):驱动 agent 的斜杠命令是人直接敲的
 * 原文(实测 `/clarify-requirements 我想给 demo 加一个导出 CSV 的功能`,带 __codebuddyLocal
 * 标记,原样透传即可);本地 UI 命令是 `<command-name>/skills</command-name>` 且
 * providerData.skipRun=true;本地命令的输出是 `<local-command-stdout>…`;另有
 * `<system-reminder data-role="command-caveat">` 告示。skipRun=true 的行一律不算提问
 * (没有真正跑模型)。CodeBuddy 没有 task-notification / agent-message 的样本,按
 * claude 同款规则过 classifyAutoMessage(含剥子 agent 交回前缀,工具函数同款拷贝)。
 *
 * 工具配对:function_call 行(callId、name、arguments——JSON 字符串,解析失败原样透传)
 * 与 function_call_result 行(callId、output、status)按 callId 配对;发出 ts 取调用行,
 * 结果 ts 取结果行,结果载荷取 output。
 *
 * 轮次结束:一轮里只有最后一条 assistant 回复带行级 message(usage 对象)——实测每个
 * 会话文件恰一条、都在轮次末尾(中断的轮没有),以此作行内的轮次结束标记。
 *
 * 增量与「留到下次」:同 claude-transcript——还没有结果的功能调用,位于最后一个轮次边界
 * (提问行 / usage 回复行)之后的,consumedBytes 收在它前面留给下一趟,之前的按死调用丢弃。
 */

import * as path from 'node:path';
import { classifyAutoMessage } from './auto-message';
import { readJsonlLinesFrom } from './jsonl-lines';
import type { PromptSource, SessionFact, SessionFactTs, SessionFileReadResult } from './types';

/** 待结果的功能调用。 */
interface PendingCall {
  readonly lineStart: number;
  readonly callId: string;
  readonly toolName: string;
  readonly args: unknown;
  readonly issuedTs: SessionFactTs;
  readonly cwd: string | undefined;
  readonly sessionId: string;
  readonly subagent: { readonly id: string; readonly type: string | undefined } | undefined;
}

function asRecord(v: unknown): Record<string, unknown> | null {
  return v !== null && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : null;
}

function str(v: unknown): string | undefined {
  return typeof v === 'string' && v.length > 0 ? v : undefined;
}

/** 行内时间戳:实测是 epoch 毫秒数;将来变成字符串也原样透传。 */
function ts(v: unknown): SessionFactTs | undefined {
  return typeof v === 'number' && Number.isFinite(v) ? v : str(v);
}

const HANDBACK_PREAMBLE = 'Another Claude session sent a message:';

function stripHandbackPreamble(text: string): string {
  const head = text.trimStart();
  if (!head.startsWith(HANDBACK_PREAMBLE)) return text;
  const rest = head.slice(HANDBACK_PREAMBLE.length).trimStart();
  return rest.startsWith('<agent-message') ? rest : text;
}

function restoreCommandText(text: string): string {
  const name = /<command-name>\s*(\/?[^<]*?)\s*<\/command-name>/.exec(text)?.[1];
  if (!name) return text;
  const args = /<command-args>([\s\S]*?)<\/command-args>/.exec(text)?.[1]?.trim();
  const cmd = name.startsWith('/') ? name : `/${name}`;
  return args ? `${cmd} ${args}` : cmd;
}

/** 消息行文本:content 为字符串原样;块数组拼接各块的 text(input_text / output_text 都带 text)。 */
function extractMessageText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  const parts: string[] = [];
  for (const b of content) {
    const blk = asRecord(b);
    if (blk !== null && typeof blk['text'] === 'string') parts.push(blk['text']);
  }
  return parts.join('\n');
}

/** arguments 是 JSON 字符串;解析失败原样透传(解析归管线)。 */
function parseArgs(v: unknown): unknown {
  if (typeof v !== 'string') return v;
  try {
    return JSON.parse(v);
  } catch {
    return v;
  }
}

/** 子 agent 文件上下文:路径里含 subagents 目录段的,父目录名即主会话编号。 */
function subagentFileId(filePath: string): string | null {
  const parts = filePath.split(path.sep);
  const idx = parts.lastIndexOf('subagents');
  if (idx < 1) return null;
  const parent = parts[idx - 1];
  return parent !== undefined && parent !== '' ? parent : null;
}

interface ScanState {
  readonly facts: SessionFact[];
  readonly headSeen: Set<string>;
  readonly pendingCalls: Map<string, PendingCall>;
  boundaryEnd: number;
  lastLineEnd: number;
}

function handleUserMessage(obj: Record<string, unknown>, line: { end: number }, s: ScanState, sessionId: string): void {
  const text = extractMessageText(asRecord(obj['message'])?.['content']);
  if (text.length === 0) return;
  const id = str(obj['id']);
  const t = ts(obj['timestamp']);
  if (id === undefined || t === undefined) return;

  // 本地 UI 命令与本地命令输出不算提问(没有真正跑模型)
  if (asRecord(obj['providerData'])?.['skipRun'] === true) return;
  const stripped = stripHandbackPreamble(text);
  const auto = classifyAutoMessage(stripped);
  if (auto !== null) {
    pushPrompt(s, sessionId, t, id, stripped, auto, line.end);
    return;
  }
  const head = text.trimStart();
  if (head.startsWith('<local-command')) return;
  if (head.startsWith('<system-reminder data-role="command-caveat">')) return;
  if (text.includes('<command-name>')) {
    pushPrompt(s, sessionId, t, id, restoreCommandText(text), 'user', line.end);
    return;
  }
  pushPrompt(s, sessionId, t, id, text, 'user', line.end);
}

function handleFunctionCall(obj: Record<string, unknown>, line: { start: number }, s: ScanState, sessionId: string, subagent: { readonly id: string; readonly type: string | undefined } | undefined): void {
  const callId = str(obj['callId']);
  const name = str(obj['name']);
  const t = ts(obj['timestamp']);
  if (callId === undefined || name === undefined || t === undefined) return;
  s.pendingCalls.set(callId, {
    lineStart: line.start,
    callId,
    toolName: name,
    args: parseArgs(obj['arguments']),
    issuedTs: t,
    cwd: str(obj['cwd']),
    sessionId,
    subagent,
  });
}

function handleFunctionCallResult(obj: Record<string, unknown>, s: ScanState): void {
  const callId = str(obj['callId']);
  if (callId === undefined) return;
  const call = s.pendingCalls.get(callId);
  if (call === undefined) return; // 调用在更早的趟里按死调用丢弃,或本就是孤儿结果
  s.pendingCalls.delete(callId);
  const t = ts(obj['timestamp']);
  if (t === undefined) return;
  s.facts.push({
    kind: 'tool',
    sessionId: call.sessionId,
    cwd: call.cwd,
    toolUseId: call.callId,
    toolName: call.toolName,
    issuedTs: call.issuedTs,
    args: call.args,
    resultTs: t,
    resultPayload: obj['output'],
    isError: obj['status'] !== 'completed', // completed=成功,incomplete(及未知的值)按失败
    subagent: call.subagent,
  });
}

function pushPrompt(
  s: ScanState,
  sessionId: string,
  t: SessionFactTs,
  id: string,
  text: string,
  source: PromptSource,
  boundaryLineEnd: number,
): void {
  s.facts.push({ kind: 'prompt', sessionId, ts: t, uuid: id, text, source });
  s.boundaryEnd = boundaryLineEnd;
}

/** 读 CodeBuddy 会话文件,产出本趟新增的会话事实(契约见 types.ts 与本文件头注释)。 */
export async function readCodebuddySessionFacts(filePath: string, fromByteOffset: number): Promise<SessionFileReadResult> {
  const s: ScanState = {
    facts: [],
    headSeen: new Set(),
    pendingCalls: new Map(),
    boundaryEnd: 0,
    lastLineEnd: fromByteOffset,
  };
  // 子 agent 文件:事实归主会话(subagentFileId 为主会话编号,null 表示主会话文件)
  const parentSessionId = subagentFileId(filePath);
  const subagentId = parentSessionId !== null ? path.basename(filePath, '.jsonl') : undefined;

  s.lastLineEnd = await readJsonlLinesFrom(filePath, fromByteOffset, (line) => {
    let obj: Record<string, unknown> | null = null;
    try {
      obj = asRecord(JSON.parse(line.text));
    } catch {
      return; // 坏行跳过,不算错误(K11)
    }
    if (obj === null) return;
    const type = obj['type'];

    // 会话归属:主会话文件用行内 sessionId;子 agent 文件按布局归主会话(K7)
    const sessionId = parentSessionId ?? str(obj['sessionId']);
    if (sessionId === undefined) return;
    // 子 agent 标识:类型取行内 providerData.agent(主会话行是 'cli',不算类型)
    const providerAgent = str(asRecord(obj['providerData'])?.['agent']);
    const subagent = subagentId !== undefined
      ? { id: subagentId, type: providerAgent !== undefined && providerAgent !== 'cli' ? providerAgent : undefined }
      : undefined;

    // 会话头:每个 sessionId 在本文件首次出现处产一个(要求该行带 cwd 与 ts)
    const cwd = str(obj['cwd']);
    const t = ts(obj['timestamp']);
    if (cwd !== undefined && t !== undefined && !s.headSeen.has(sessionId)) {
      s.headSeen.add(sessionId);
      s.facts.push({ kind: 'session_head', sessionId, startCwd: cwd, ts: t });
    }

    // 单行处理异常只丢这一行,不拖垮整趟(宁可多跳过、不可抛错)
    try {
      if (type === 'message' && obj['role'] === 'user' && subagent === undefined) {
        handleUserMessage(obj, line, s, sessionId);
      } else if (type === 'message' && obj['role'] === 'assistant' && subagent === undefined) {
        // 轮次结束:带行级 message(usage 对象)的 assistant 行是这一轮最后一条回复
        const usage = asRecord(obj['message']);
        if (usage !== null) {
          const id = str(obj['id']);
          if (id !== undefined && t !== undefined) {
            s.facts.push({ kind: 'turn_end', sessionId, ts: t, messageId: id });
            s.boundaryEnd = line.end;
          }
        }
      } else if (type === 'function_call') {
        handleFunctionCall(obj, line, s, sessionId, subagent);
      } else if (type === 'function_call_result') {
        handleFunctionCallResult(obj, s);
      }
    } catch {
      // 跳过该行
    }
  });

  // 还没有结果的调用:轮次边界之后的留到下一趟(consumedBytes 收在它前面),之前的按死调用丢弃
  let heldStart = Number.MAX_SAFE_INTEGER;
  for (const call of s.pendingCalls.values()) {
    if (call.lineStart >= s.boundaryEnd && call.lineStart < heldStart) heldStart = call.lineStart;
  }
  const consumedBytes = heldStart !== Number.MAX_SAFE_INTEGER ? heldStart : s.lastLineEnd;
  return { facts: s.facts, consumedBytes };
}
