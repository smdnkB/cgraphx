import { describe, expect, it } from 'vitest';

import {
  extractFrontmatterBlock,
  FrontmatterSyntaxError,
  parseFrontmatterBlock,
  readList,
  readScalar,
} from '../../../src/core/markdown/frontmatter-parser';

describe('extractFrontmatterBlock', () => {
  it('extracts the YAML body between fences', () => {
    const src = `---\ntitle: Foo\nstatus: active\n---\n\n# Body\n`;
    expect(extractFrontmatterBlock(src)).toBe('title: Foo\nstatus: active');
  });

  it('returns null when no frontmatter is present', () => {
    expect(extractFrontmatterBlock('# No frontmatter\n\nbody')).toBeNull();
  });

  it('skips leading blank lines before the fence', () => {
    expect(extractFrontmatterBlock('\n\n---\ntitle: A\n---\n')).toBe('title: A');
  });

  it('accepts `...` as the close fence', () => {
    expect(extractFrontmatterBlock('---\ntitle: A\n...\n')).toBe('title: A');
  });

  it('throws when the fence is never closed', () => {
    expect(() => extractFrontmatterBlock('---\ntitle: A\n')).toThrow(FrontmatterSyntaxError);
  });

  it('strips a leading BOM', () => {
    expect(extractFrontmatterBlock('﻿---\ntitle: A\n---\n')).toBe('title: A');
  });
});

describe('parseFrontmatterBlock', () => {
  it('parses scalars and lists', () => {
    const parsed = parseFrontmatterBlock(
      [
        'title: Foo',
        'document_type: decision',
        'domains:',
        '  - A',
        '  - B',
        'concepts:',
        '  - X',
        'tags:',
        '  - high',
        'status: active',
        'source_type: work_context',
        'updated: 2026-06-26',
        'aliases:',
        '  - 退款',
      ].join('\n'),
    );
    expect(readScalar(parsed, 'title')).toBe('Foo');
    expect(readScalar(parsed, 'document_type')).toBe('decision');
    expect(readList(parsed, 'domains')).toEqual(['A', 'B']);
    expect(readList(parsed, 'concepts')).toEqual(['X']);
    expect(readList(parsed, 'aliases')).toEqual(['退款']);
  });

  it('throws on full-width colon', () => {
    expect(() => parseFrontmatterBlock('title：Bad\n')).toThrow(FrontmatterSyntaxError);
  });

  it('throws on tab indentation', () => {
    expect(() => parseFrontmatterBlock('domains:\n\t- A\n')).toThrow(FrontmatterSyntaxError);
  });

  it('throws on top-level indented line', () => {
    expect(() => parseFrontmatterBlock('  title: A\n')).toThrow(FrontmatterSyntaxError);
  });

  it('strips matching quotes', () => {
    const parsed = parseFrontmatterBlock('title: "Quoted"\n');
    expect(readScalar(parsed, 'title')).toBe('Quoted');
  });

  it('throws on mismatched quotes', () => {
    expect(() => parseFrontmatterBlock('title: "Mismatch\'\n')).toThrow(FrontmatterSyntaxError);
  });

  it('rejects invalid key characters', () => {
    expect(() => parseFrontmatterBlock('bad key: value\n')).toThrow(FrontmatterSyntaxError);
  });

  it('handles empty value as empty string', () => {
    const parsed = parseFrontmatterBlock('title:\n');
    expect(readScalar(parsed, 'title')).toBe('');
  });

  it('skips blank lines and comments inside the block', () => {
    const parsed = parseFrontmatterBlock('title: A\n\n# comment\nstatus: active\n');
    expect(readScalar(parsed, 'title')).toBe('A');
    expect(readScalar(parsed, 'status')).toBe('active');
  });
});
