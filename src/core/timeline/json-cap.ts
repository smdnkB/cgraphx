/**
 * timeline JSON 列的长度控制:超长时只截字段的值,整串 JSON 永远合法。
 *
 * - truncateUtf8:单字段上限的唯一实现(摘要生成器、调用参数净化都用它)。
 * - capJsonValue:整体超限时的兜底,store 写入三个 JSON 列前统一经过它。
 */

import { CAP_MIN_STRING_BYTES, TRUNCATED_SUFFIX } from './constants';

export interface CapOptions {
  /** 单个字符串值的 UTF-8 字节上限(超限才生效)。 */
  maxStringBytes: number;
  /** 整串 JSON 的 UTF-8 字节上限。 */
  maxTotalBytes: number;
}

const SUFFIX_BYTES = Buffer.byteLength(TRUNCATED_SUFFIX, 'utf8');

/**
 * 字符串超过 maxBytes 时在字符边界截断并接上截断标记,结果总字节数 ≤ maxBytes。
 * 不超限原样返回。
 */
export function truncateUtf8(s: string, maxBytes: number): string {
  const buf = Buffer.from(s, 'utf8');
  if (buf.length <= maxBytes) return s;
  let end = Math.max(0, maxBytes - SUFFIX_BYTES);
  // 回退到字符起始字节:UTF-8 续字节形如 10xxxxxx
  while (end > 0 && (buf[end]! & 0xc0) === 0x80) end--;
  return buf.subarray(0, end).toString('utf8') + TRUNCATED_SUFFIX;
}

function serialize(value: unknown): string {
  try {
    const json = JSON.stringify(value);
    // undefined / 函数等顶层不可序列化值:按无法序列化处理
    if (json === undefined) return JSON.stringify({ _error: 'unserializable payload' });
    return json;
  } catch {
    // 循环引用等:记录失败,不中断写库
    return JSON.stringify({ _error: 'unserializable payload' });
  }
}

/** 递归复制,把每个字符串值截到 maxStringBytes;对象的键不截。 */
function capStrings(value: unknown, maxStringBytes: number): unknown {
  if (typeof value === 'string') return truncateUtf8(value, maxStringBytes);
  if (Array.isArray(value)) return value.map((v) => capStrings(v, maxStringBytes));
  if (value !== null && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = capStrings(v, maxStringBytes);
    }
    return out;
  }
  return value;
}

/**
 * 序列化 value,保证结果能 JSON.parse 且 UTF-8 字节数 ≤ maxTotalBytes。
 *
 * 不超限直接返回(快路径,只序列化一次);超限时按字段截断字符串值,仍超限则
 * 字符串上限减半重试,降到 CAP_MIN_STRING_BYTES 以下仍超限 → 返回截断占位对象。
 */
export function capJsonValue(value: unknown, opts: CapOptions): string {
  const json = serialize(value);
  const originalBytes = Buffer.byteLength(json, 'utf8');
  if (originalBytes <= opts.maxTotalBytes) return json;

  // 以序列化结果为准做截断,避免 toJSON 等让原值与 JSON 形态不一致
  const parsed: unknown = JSON.parse(json);
  let maxStringBytes = opts.maxStringBytes;
  while (maxStringBytes >= CAP_MIN_STRING_BYTES) {
    const capped = JSON.stringify(capStrings(parsed, maxStringBytes));
    if (Buffer.byteLength(capped, 'utf8') <= opts.maxTotalBytes) return capped;
    maxStringBytes = Math.floor(maxStringBytes / 2);
  }
  return JSON.stringify({ _truncated: true, _original_bytes: originalBytes });
}
