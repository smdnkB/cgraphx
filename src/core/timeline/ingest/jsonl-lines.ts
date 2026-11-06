/**
 * JSONL 行级增量读取(ingest 内部共用基建,非事实契约):
 *   - 从 fromByteOffset 起按字节流式读到当前文件末尾的最后一个完整换行,不整文件进内存
 *     (本机单个会话文件最大五十多 MB,流式按 64KB 块走);
 *   - 文件比偏移短(被截断重写)→ 从头重读,重复事实靠 C-2 的 source_key 去重;
 *   - 行以字节 0x0A 切分:UTF-8 多字节字符的续字节不会等于 0x0A,跨块边界的字符天然安全;
 *   - 写到一半的行(没有换行结尾)留在缓冲里不吐出,返回值也不包含它(F1 ①);
 *   - fromByteOffset 必须是 0 或读取器上次返回的 consumedBytes(行边界)。
 *
 * 文件打不开 / 读流出错时抛出,由调用方(T-3 补录管线)整体 try/catch。
 */

import * as fs from 'node:fs';
import * as fsp from 'node:fs/promises';

/** 一条完整行:文本(不含换行符)与其起止字节偏移;end 已跳过换行符,即下一行的 start。 */
export interface JsonlLine {
  readonly text: string;
  readonly start: number;
  readonly end: number;
}

const CHUNK_BYTES = 64 * 1024;

/**
 * 从 fromByteOffset 起逐行回调,返回「最后一个完整行的行尾偏移」
 * (本趟没有读到任何完整行时返回实际起点偏移)。
 */
export async function readJsonlLinesFrom(
  filePath: string,
  fromByteOffset: number,
  onLine: (line: JsonlLine) => void,
): Promise<number> {
  const size = (await fsp.stat(filePath)).size;
  let start = fromByteOffset;
  if (start > size) start = 0; // 文件变短:从头重读(D4)
  if (start >= size) return start; // 没有新内容

  return new Promise<number>((resolve, reject) => {
    let pending: Buffer = Buffer.alloc(0); // 未切出完整行的字节(从 lineStart 起)
    let lineStart = start;
    let lastLineEnd = start;
    const stream = fs.createReadStream(filePath, { start, end: size - 1, highWaterMark: CHUNK_BYTES });
    stream.on('data', (chunk: Buffer) => {
      pending = pending.length === 0 ? chunk : Buffer.concat([pending, chunk]);
      let nl = pending.indexOf(0x0a);
      while (nl >= 0) {
        const text = pending.subarray(0, nl).toString('utf8');
        const end = lineStart + nl + 1;
        onLine({ text, start: lineStart, end });
        lineStart = end;
        lastLineEnd = end;
        pending = pending.subarray(nl + 1);
        nl = pending.indexOf(0x0a);
      }
    });
    stream.on('end', () => resolve(lastLineEnd));
    stream.on('error', reject);
  });
}
