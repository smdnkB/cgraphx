/**
 * Minimal YAML frontmatter parser.
 *
 * Supports the limited subset of YAML the markdown knowledge base requires:
 *   - `key: value`                 (scalar)
 *   - `key:` followed by a list of `  - item` lines
 *
 * Rejects (throws) on anything more complex — nested objects, anchors/aliases,
 * flow collections, block scalars, tab indentation, full-width colons. This is
 * deliberate: the frontmatter convention is intentionally simple, and a parser
 * that silently accepts surprising shapes is worse than one that errors.
 *
 * Does NOT depend on the `yaml` npm package. No new runtime deps for the
 * subsystem.
 */

export type MetaValue = string | string[];

export interface ParsedFrontmatter {
  values: Map<string, MetaValue>;
}

export class FrontmatterSyntaxError extends Error {
  constructor(
    message: string,
    public readonly line: number,
  ) {
    super(`Line ${line}: ${message}`);
    this.name = 'FrontmatterSyntaxError';
  }
}

/**
 * Extract the YAML frontmatter block delimited by leading `---` lines.
 *
 * Returns `null` when no frontmatter is present. Throws `FrontmatterSyntaxError`
 * when an opening `---` is found but no matching close is.
 *
 * @param source full file source (CRLF normalized to LF)
 * @returns the body between the fences (excluding the fences themselves)
 */
export function extractFrontmatterBlock(source: string): string | null {
  return locateFrontmatterBlock(source)?.inner ?? null;
}

/**
 * 去掉文件开头的 `---` … `---` frontmatter 块,返回正文。
 *
 * 无 frontmatter / frontmatter 未闭合 → 原样返回(降级语义与调用方对
 * parseFrontmatter 的处理一致:剥离失败不破坏原文)。
 */
export function stripFrontmatter(raw: string): string {
  let located: FrontmatterLocation | null;
  try {
    located = locateFrontmatterBlock(raw);
  } catch {
    return raw; // frontmatter 未闭合 → 原样返回
  }
  return located?.body ?? raw; // 无 frontmatter → 原样返回
}

/** 块定位结果:inner = 两 fence 之间的内容;body = 闭合 fence 之后的正文。 */
interface FrontmatterLocation {
  inner: string;
  body: string;
}

/**
 * 共用的 frontmatter 块定位逻辑(extractFrontmatterBlock 与 stripFrontmatter
 * 复用同一套 fence 规则:BOM 容忍、前置空行跳过、闭合 fence 为 `---` 或 `...`)。
 *
 * @returns null 表示没有 frontmatter
 * @throws FrontmatterSyntaxError frontmatter opened with --- but never closed
 */
function locateFrontmatterBlock(source: string): FrontmatterLocation | null {
  const lines = source.split('\n');

  // Optional BOM at the very start
  if (lines[0]?.startsWith('﻿')) {
    lines[0] = lines[0].slice(1);
  }

  // Skip leading blank lines (allow whitespace before the fence)
  let i = 0;
  while (i < lines.length && lines[i]!.trim() === '') {
    i++;
  }

  if (i >= lines.length || lines[i]!.trim() !== '---') {
    return null;
  }

  const startIdx = i + 1;
  // Find the close fence. Spec: a line whose trimmed content is exactly `---` or `...`.
  let endIdx = -1;
  for (let j = startIdx; j < lines.length; j++) {
    const t = lines[j]!.trim();
    if (t === '---' || t === '...') {
      endIdx = j;
      break;
    }
  }
  if (endIdx === -1) {
    throw new FrontmatterSyntaxError(
      'frontmatter opened with --- but never closed',
      startIdx,
    );
  }

  return {
    inner: lines.slice(startIdx, endIdx).join('\n'),
    body: lines.slice(endIdx + 1).join('\n'),
  };
}

/**
 * Parse the YAML-subset frontmatter into a Map.
 *
 * @throws FrontmatterSyntaxError on any unsupported syntax
 */
export function parseFrontmatter(source: string): ParsedFrontmatter {
  const block = extractFrontmatterBlock(source);
  if (block === null) {
    return { values: new Map() };
  }
  return parseFrontmatterBlock(block);
}

export function parseFrontmatterBlock(block: string): ParsedFrontmatter {
  const values = new Map<string, MetaValue>();
  const lines = block.split('\n');

  let i = 0;
  while (i < lines.length) {
    const raw = lines[i]!;
    // Skip blank lines and comments
    if (raw.trim() === '' || raw.trim().startsWith('#')) {
      i++;
      continue;
    }

    const lineNo = i + 1;
    if (raw.startsWith('\t')) {
      throw new FrontmatterSyntaxError(
        'tab indentation is not allowed; use spaces',
        lineNo,
      );
    }

    // Top-level key:value (no leading indentation)
    if (/^\s/.test(raw)) {
      throw new FrontmatterSyntaxError(
        'unexpected indented line (expected a top-level key)',
        lineNo,
      );
    }

    const colonIdx = raw.indexOf(':');
    if (colonIdx === -1) {
      throw new FrontmatterSyntaxError(
        `expected "key: value" but no colon found in: ${raw}`,
        lineNo,
      );
    }

    const key = raw.slice(0, colonIdx).trim();
    const restRaw = raw.slice(colonIdx + 1);

    // Reject full-width colon anywhere in the line — common CJK typo
    // (U+FF1A, not the ASCII ':' that delimits key from value)
    if (raw.includes('：')) {
      throw new FrontmatterSyntaxError(
        'full-width colon (：) is not allowed; use half-width ":"',
        lineNo,
      );
    }

    if (!/^[a-zA-Z_][a-zA-Z0-9_-]*$/.test(key)) {
      throw new FrontmatterSyntaxError(
        `invalid key "${key}"; expected alphanumeric/underscore/dash`,
        lineNo,
      );
    }

    const rest = restRaw.trim();

    if (rest === '') {
      // Could be `key:` with inline null OR `key:\n  - item` list. Peek next lines.
      const listItems: string[] = [];
      let j = i + 1;
      while (j < lines.length) {
        const nl = lines[j]!;
        if (nl.trim() === '') {
          j++;
          continue;
        }
        // List item: starts with whitespace then `-`
        if (/^\s+-\s+/.test(nl) || /^\s+-$/.test(nl)) {
          if (nl.includes('\t')) {
            throw new FrontmatterSyntaxError(
              'tab indentation is not allowed in list items',
              j + 1,
            );
          }
          const item = nl.replace(/^\s+-\s*/, '').trim();
          listItems.push(stripQuotes(item, j + 1));
          j++;
        } else {
          break;
        }
      }
      if (listItems.length > 0) {
        values.set(key, listItems);
        i = j;
      } else {
        // Empty value — treat as empty string
        values.set(key, '');
        i++;
      }
    } else {
      // Inline scalar
      values.set(key, stripQuotes(rest, lineNo));
      i++;
    }
  }

  return { values };
}

/** Remove surrounding matching quotes (single or double). Throws on mismatched. */
function stripQuotes(value: string, line: number): string {
  if (value.length >= 2) {
    const first = value[0];
    const last = value[value.length - 1];
    if ((first === '"' || first === "'") && first === last) {
      return value.slice(1, -1);
    }
    if ((first === '"' || first === "'") && first !== last) {
      throw new FrontmatterSyntaxError(
        `mismatched quote in value: ${value}`,
        line,
      );
    }
  }
  return value;
}

/** Convenience: read a scalar value (default ''). */
export function readScalar(parsed: ParsedFrontmatter, key: string): string {
  const v = parsed.values.get(key);
  if (v === undefined) return '';
  return Array.isArray(v) ? v[0] ?? '' : v;
}

/** Convenience: read a list value (default []). Throws if the key holds a scalar. */
export function readList(parsed: ParsedFrontmatter, key: string): string[] {
  const v = parsed.values.get(key);
  if (v === undefined) return [];
  if (typeof v === 'string') {
    throw new FrontmatterSyntaxError(
      `key "${key}" should be a list, got scalar "${v}"`,
      0,
    );
  }
  return v;
}

/** Convenience: presence + non-empty check. */
export function hasNonEmpty(
  parsed: ParsedFrontmatter,
  key: string,
): boolean {
  const v = parsed.values.get(key);
  if (v === undefined) return false;
  if (typeof v === 'string') return v.trim() !== '';
  return v.length > 0;
}
