/**
 * 按文件内容识别截图格式与尺寸(不看扩展名)。只认 PNG / JPEG。
 */

import type { ImageInfo } from './types';

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** 识别 PNG / JPEG 并读出宽高;其它格式或数据损坏返回 null。 */
export function readImageInfo(data: Buffer): ImageInfo | null {
  return readPng(data) ?? readJpeg(data);
}

function readPng(data: Buffer): ImageInfo | null {
  // 签名 8 字节 + IHDR 长度 4 + 类型 4 + 宽 4 + 高 4
  if (data.length < 24 || !data.subarray(0, 8).equals(PNG_SIGNATURE)) return null;
  const width = data.readUInt32BE(16);
  const height = data.readUInt32BE(20);
  if (width === 0 || height === 0) return null;
  return { format: 'png', width, height };
}

function readJpeg(data: Buffer): ImageInfo | null {
  if (data.length < 4 || data.readUInt8(0) !== 0xff || data.readUInt8(1) !== 0xd8) return null;
  let pos = 2;
  while (pos + 4 <= data.length) {
    if (data.readUInt8(pos) !== 0xff) return null;
    const marker = data.readUInt8(pos + 1);
    // 填充字节
    if (marker === 0xff) {
      pos += 1;
      continue;
    }
    // 无长度段(SOI / RSTn / TEM)
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      pos += 2;
      continue;
    }
    // EOI / SOS 之前仍未遇到 SOF → 无法识别
    if (marker === 0xd9 || marker === 0xda) return null;
    const segLen = data.readUInt16BE(pos + 2);
    const isSof = marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
    if (isSof) {
      if (pos + 9 > data.length) return null;
      const height = data.readUInt16BE(pos + 5);
      const width = data.readUInt16BE(pos + 7);
      if (width === 0 || height === 0) return null;
      return { format: 'jpeg', width, height };
    }
    pos += 2 + segLen;
  }
  return null;
}
