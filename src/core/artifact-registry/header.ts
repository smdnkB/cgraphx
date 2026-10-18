/**
 * 产物头部与首屏标题的解析。
 *
 * md:第一个一级标题之后的连续引用行;html:文件前若干行内的注释。
 * 只读文件、不抛错:读不了或扩展名不对返回 null / 全空字段。
 */

import { readFileSync } from 'node:fs';
import { extname } from 'node:path';
import { HEADER_SCAN_LINES } from './constants';
import type { ArtifactHeader } from './types';

/** 头部字段行:半角/全角冒号都认。 */
const HEADER_FIELD_PATTERN = /^>\s*(产物|负责人|任务|依据)\s*[:：]\s*(.*?)\s*$/;

/** 一级标题:`#` 后必须紧跟空白。 */
const H1_PATTERN = /^#\s+\S/;

/** 二级标题:`##` 后必须紧跟空白,`###` 不算。 */
const H2_PATTERN = /^##\s+(.+?)\s*#*\s*$/;

/** 代码块围栏。 */
const FENCE_PATTERN = /^\s*```/;

/** 新建四个字段全为 null 的头部。 */
function emptyHeader(): ArtifactHeader {
  return { typeRaw: null, owner: null, task: null, basis: null };
}

/** 去 BOM 后按行拆分(兼容 CRLF)。 */
function splitLines(content: string): string[] {
  const withoutBom =
    content.charCodeAt(0) === 0xfeff ? content.slice(1) : content;
  return withoutBom.split(/\r?\n/);
}

/**
 * 跳过开头 frontmatter 后的起始行号。
 *
 * 首行是 `---` 时找下一个 `---` 行;找不到视为没有 frontmatter,从头开始。
 */
function bodyStartIndex(lines: readonly string[]): number {
  if (lines[0]?.trim() !== '---') {
    return 0;
  }
  for (let i = 1; i < lines.length; i += 1) {
    if (lines[i]?.trim() === '---') {
      return i + 1;
    }
  }
  return 0;
}

/**
 * 解析一行头部字段,写入 header(同一字段只取第一条)。
 *
 * 返回该行是否匹配字段正则;匹配但字段已出现过也算匹配。
 */
function applyHeaderLine(
  line: string,
  header: ArtifactHeader,
  seen: Set<string>,
): boolean {
  const match = HEADER_FIELD_PATTERN.exec(line);
  if (match === null) {
    return false;
  }
  const field = match[1];
  if (field === undefined || seen.has(field)) {
    return true;
  }
  seen.add(field);
  const value = match[2] ?? '';
  switch (field) {
    case '产物':
      header.typeRaw = value;
      break;
    case '负责人':
      header.owner = value === '' ? null : value;
      break;
    case '任务':
      header.task = value === '' ? null : value;
      break;
    case '依据':
      header.basis = value === '' ? null : value;
      break;
  }
  return true;
}

/** 解析 md 头部:第一个一级标题之后的第一组连续引用行。 */
function parseMarkdownHeader(lines: readonly string[]): ArtifactHeader {
  const header = emptyHeader();
  const seen = new Set<string>();
  const start = bodyStartIndex(lines);

  // 在 frontmatter 之后的 HEADER_SCAN_LINES 行内找第一个一级标题。
  let headingIndex = -1;
  const searchEnd = Math.min(lines.length, start + HEADER_SCAN_LINES);
  for (let i = start; i < searchEnd; i += 1) {
    const line = lines[i];
    if (line !== undefined && H1_PATTERN.test(line)) {
      headingIndex = i;
      break;
    }
  }
  if (headingIndex === -1) {
    return header;
  }

  // 标题之后最多再看 HEADER_SCAN_LINES 行:空行跳过,引用行解析,其他行停止。
  const scanEnd = Math.min(lines.length, headingIndex + 1 + HEADER_SCAN_LINES);
  for (let i = headingIndex + 1; i < scanEnd; i += 1) {
    const line = lines[i] ?? '';
    if (line.trim() === '') {
      continue;
    }
    if (!line.startsWith('>')) {
      break;
    }
    applyHeaderLine(line, header, seen);
  }
  return header;
}

/** 解析 html 头部:前 HEADER_SCAN_LINES 行内第一个合规注释。 */
function parseHtmlHeader(content: string): ArtifactHeader {
  const lines = splitLines(content).slice(0, HEADER_SCAN_LINES);
  const text = lines.join('\n');
  const commentPattern = /<!--([\s\S]*?)-->/g;
  let match: RegExpExecArray | null;
  while ((match = commentPattern.exec(text)) !== null) {
    const inner = match[1] ?? '';
    const candidate = emptyHeader();
    const seen = new Set<string>();
    let parsedAny = false;
    for (const raw of inner.split(/\r?\n/)) {
      // 注释内每行去掉行首空白后解析。
      const line = raw.replace(/^\s+/, '');
      if (applyHeaderLine(line, candidate, seen)) {
        parsedAny = true;
      }
    }
    if (parsedAny) {
      return candidate;
    }
  }
  return emptyHeader();
}

/** 读产物头部;只认 .md / .html,读不了或扩展名不对返回 null。 */
export function readArtifactHeader(absPath: string): ArtifactHeader | null {
  const ext = extname(absPath).toLowerCase();
  if (ext !== '.md' && ext !== '.html') {
    return null;
  }
  let content: string;
  try {
    content = readFileSync(absPath, 'utf-8');
  } catch {
    return null;
  }
  if (ext === '.md') {
    return parseMarkdownHeader(splitLines(content));
  }
  return parseHtmlHeader(content);
}

/** 读第一个二级标题;只处理 .md,读不了返回 null。 */
export function readFirstH2Heading(absPath: string): string | null {
  if (extname(absPath).toLowerCase() !== '.md') {
    return null;
  }
  let content: string;
  try {
    content = readFileSync(absPath, 'utf-8');
  } catch {
    return null;
  }
  const lines = splitLines(content);
  const start = bodyStartIndex(lines);
  let inFence = false;
  for (let i = start; i < lines.length; i += 1) {
    const line = lines[i] ?? '';
    if (FENCE_PATTERN.test(line)) {
      inFence = !inFence;
      continue;
    }
    if (inFence) {
      continue;
    }
    const match = H2_PATTERN.exec(line);
    if (match !== null && match[1] !== undefined) {
      return match[1];
    }
  }
  return null;
}
