/**
 * 调用参数(tool_args)入库前的净化:
 *   - Write 不存文件正文,只记字节数和行数(正文就是落盘的文件,库里重复存没有回看价值);
 *   - Edit / MultiEdit 的改前、改后片段保留,但单个片段截到 EDIT_SNIPPET_MAX_BYTES;
 *   - 其它工具原样返回(整体超限由 store 的 capJsonValue 兜底)。
 * 不修改入参对象本身。
 */

import { EDIT_SNIPPET_MAX_BYTES } from './constants';
import { truncateUtf8 } from './json-cap';

function asRecord(v: unknown): Record<string, unknown> | null {
  return v !== null && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : null;
}

/** 行数:空串为 0;否则按 `\n` 切分的段数,以 `\n` 结尾时减 1。 */
function countLines(content: string): number {
  if (content.length === 0) return 0;
  const segments = content.split('\n').length;
  return content.endsWith('\n') ? segments - 1 : segments;
}

/** 截短一个对象上的 old_string / new_string,返回浅拷贝。 */
function capSnippets(rec: Record<string, unknown>): Record<string, unknown> {
  const out = { ...rec };
  for (const key of ['old_string', 'new_string']) {
    const v = out[key];
    if (typeof v === 'string') out[key] = truncateUtf8(v, EDIT_SNIPPET_MAX_BYTES);
  }
  return out;
}

export function sanitizeToolArgs(toolName: string | undefined, toolInput: unknown): unknown {
  const rec = asRecord(toolInput);
  if (!rec) return toolInput;

  if (toolName === 'Write' && typeof rec.content === 'string') {
    const { content, ...rest } = rec;
    return {
      ...rest,
      content_bytes: Buffer.byteLength(content as string, 'utf8'),
      content_lines: countLines(content as string),
    };
  }
  if (toolName === 'Edit') return capSnippets(rec);
  if (toolName === 'MultiEdit' && Array.isArray(rec.edits)) {
    return {
      ...rec,
      edits: rec.edits.map((e) => {
        const edit = asRecord(e);
        return edit ? capSnippets(edit) : e;
      }),
    };
  }
  return toolInput;
}
