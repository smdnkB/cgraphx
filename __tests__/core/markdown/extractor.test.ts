import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { extractFromFile, toProjectRelative } from '../../../src/core/markdown/extractor';

function writeTemp(content: string): { dir: string; file: string } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cg-md-test-'));
  const file = path.join(dir, 'docs', 'knowledge', 'test.md');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content, 'utf-8');
  return { dir, file };
}

describe('extractFromFile', () => {
  it('returns ok with parsed fields for a valid document', () => {
    const { dir, file } = writeTemp(
      [
        '---',
        'title: 测试决策',
        'document_type: decision',
        'domains:',
        '  - 订单域',
        'concepts:',
        '  - 退订',
        'status: active',
        'source_type: work_context',
        'updated: 2026-06-26',
        'aliases:',
        '  - 退款',
        'tags:',
        '  - high',
        '---',
        '',
        '# 测试决策',
        '',
        '## Summary',
        '这是摘要。',
        '',
        '## Context',
        '其他内容。',
        '',
      ].join('\n'),
    );
    const result = extractFromFile(file, dir);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.parsed.document.title).toBe('测试决策');
    expect(result.parsed.document.documentType).toBe('decision');
    expect(result.parsed.concepts).toEqual(['退订']);
    expect(result.parsed.domains).toEqual(['订单域']);
    expect(result.parsed.tags).toEqual(['high']);
    expect(result.parsed.document.aliases).toEqual(['退款']);
    expect(result.parsed.document.summaryText).toBe('这是摘要。');
    expect(result.parsed.document.path).toBe('docs/knowledge/test.md');
  });

  it('returns skip when frontmatter is missing', () => {
    const { dir, file } = writeTemp('# No frontmatter\n\nbody\n');
    const r = extractFromFile(file, dir);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.skip.reason).toBe('no_frontmatter');
  });

  it('returns skip when a required field is missing', () => {
    const { dir, file } = writeTemp(
      [
        '---',
        'title: A',
        'document_type: decision',
        'status: draft',
        'source_type: manual',
        '---',
        '',
        'body',
      ].join('\n'),
    );
    const r = extractFromFile(file, dir);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.skip.reason).toBe('missing_required_field');
  });

  it('returns skip on invalid enum value', () => {
    // exploration 为废除枚举值(spec §3.1),新契约下非法 → invalid_enum_value
    const { dir, file } = writeTemp(
      [
        '---',
        'title: A',
        'document_type: exploration',
        'domains:',
        '  - A',
        'concepts:',
        '  - X',
        'status: active',
        'source_type: manual',
        'updated: 2026-06-26',
        '---',
        '',
        'body',
      ].join('\n'),
    );
    const r = extractFromFile(file, dir);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.skip.reason).toBe('invalid_enum_value');
  });

  it('normalizes project-relative path with POSIX separators', () => {
    expect(toProjectRelative('/root/docs/knowledge/a.md', '/root')).toBe(
      'docs/knowledge/a.md',
    );
  });
});
