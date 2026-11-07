/**
 * 会话事实模型(C-1,plan 契约钉死):读取器与补录管线(T-3)共用。
 *
 * 读取器只产事实:不打开任何库、不知道项目归属、不生成事件类型与 source_key、
 * 不做摘要与参数净化(sanitizeToolArgs / summarizeToolResponse 由管线在入库前调)。标题同此:
 * 读取器只报「这条标题是什么时候起的」,写不写、谁盖谁(custom > ai > agent、同级取新)归管线。
 * 事实里的时间戳与编号一律取行内自带值,不做任何「现在时间」填充(时间填充归管线)。
 *
 * ts 的两种形态(原样透传,解析归管线):
 *   - claude-transcript:ISO 8601 字符串(行内 timestamp);
 *   - codebuddy-transcript:epoch 毫秒数(行内 timestamp)。
 *
 * 每条事实都带 sessionId(行内自带):K4 一条消息归哪个会话,按消息里自带的会话编号,
 * 分叉文件开头拷来的旧会话行同样归原会话。codebuddy 子 agent 文件行内的会话编号是
 * 独立子会话编号,按 K7「子 agent 里的调用算进发起它的会话」用文件布局归到主会话,
 * 见 codebuddy-transcript 头注释。
 */

import type { AutoMessageSource } from '../auto-message';

/** 行内时间戳:ISO 8601 字符串(claude)或 epoch 毫秒数(codebuddy)。 */
export type SessionFactTs = string | number;

/** 提问来源:user = 人发的(含斜杠命令还原后的原文);其余为自动消息(来源沿用 classifyAutoMessage)。 */
export type PromptSource = 'user' | AutoMessageSource;

/** 人发的提问 / 自动消息(K5)。斜杠命令已还原成敲的原文(/命令 参数);queued_command 附件文本没有对应用户行的也算一条。 */
export interface PromptFact {
  readonly kind: 'prompt';
  readonly sessionId: string;
  readonly ts: SessionFactTs;
  /** 提问消息的 uuid(claude)或消息行 id(codebuddy);source_key 用它。 */
  readonly uuid: string;
  readonly text: string;
  readonly source: PromptSource;
}

/** 一次工具调用:发出与结果按编号配对成一条(K7);参数与结果载荷是原始值,未净化未摘要。 */
export interface ToolFact {
  readonly kind: 'tool';
  readonly sessionId: string;
  /** 调用行的工作目录(D7:cwd 取调用行,不取结果行)。 */
  readonly cwd: string | undefined;
  /** 工具调用 id(claude 的 tool_use 块 id / codebuddy 的 callId);source_key 用它。 */
  readonly toolUseId: string;
  readonly toolName: string;
  /** 发出调用的时间(调用行时间戳)。 */
  readonly issuedTs: SessionFactTs;
  /** 调用参数原始值(codebuddy 的 arguments 是 JSON 字符串,解析失败时原样传字符串)。 */
  readonly args: unknown;
  /** 结果回来的时间(结果行时间戳);耗时 = 结果时间 - 发出时间(K8,减法归管线)。 */
  readonly resultTs: SessionFactTs;
  /** 结果载荷原始值:claude 取结果行的行级 toolUseResult,codebuddy 取结果行 output。 */
  readonly resultPayload: unknown;
  readonly isError: boolean;
  /** 子 agent 里的调用才带(行内有才带);claude 只有 id,codebuddy 有 id 与 type。 */
  readonly subagent?: { readonly id?: string; readonly type?: string };
}

/** 轮次结束:这一轮 agent 最后一条回复(K6);claude 取 stop_reason=end_turn 的回复,codebuddy 取带 usage 的末条回复。 */
export interface TurnEndFact {
  readonly kind: 'turn_end';
  readonly sessionId: string;
  readonly ts: SessionFactTs;
  /** 回复 message.id(claude 的 message.id / codebuddy 的消息行 id);source_key 用它。 */
  readonly messageId: string;
}

/** 会话头:每个 sessionId 在本文件首次出现处产一个(K9);分叉文件开头拷来的旧会话行同样给旧会话产头,键按会话编号去重(C-2)。 */
export interface SessionHeadFact {
  readonly kind: 'session_head';
  readonly sessionId: string;
  /** 该会话首条带工作目录的消息行的 cwd(K1:会话从哪个目录开的)。 */
  readonly startCwd: string;
  readonly ts: SessionFactTs;
}

/**
 * 会话标题(spec 2026-11-06-agent看板 D8、K5):agent 自己起的标题——claude 的 custom-title /
 * ai-title 行(titleKind 对应 'custom' / 'ai')、deepseek 的 session/title 行('agent';codebuddy
 * 没有标题,不产)。标题不是事件:不进 mapFacts、不占 source_key,由补录管线按「custom > ai >
 * agent,同级取新」写标题表。ts:deepseek 取行内 time;claude 的标题行不带时间,取文件里它前面
 * 最近一条带时间行的时间(读取器的局部适配,一条都还没有时为 0,只作同级比较用)。
 */
export interface SessionTitleFact {
  readonly kind: 'session_title';
  readonly sessionId: string;
  readonly ts: SessionFactTs;
  readonly title: string;
  readonly titleKind: 'custom' | 'ai' | 'agent';
}

export type SessionFact = PromptFact | ToolFact | TurnEndFact | SessionHeadFact | SessionTitleFact;

/** 读取器的返回:事实序列 + 新的字节偏移(已消费到最后一个完整行,或为「留到下次」的项收得更少,见各读取器头注释)。 */
export interface SessionFileReadResult {
  readonly facts: SessionFact[];
  readonly consumedBytes: number;
}

/** 读取器签名:输入文件绝对路径与起始字节偏移。 */
export type SessionFactsReader = (filePath: string, fromByteOffset: number) => Promise<SessionFileReadResult>;
