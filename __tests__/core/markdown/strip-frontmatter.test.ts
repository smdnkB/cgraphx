/**
 * stripFrontmatter 测试:去掉文件开头 frontmatter 块返回正文;
 * 无 frontmatter / 未闭合 → 原样返回(与 parseFrontmatter 的降级语义一致)。
 */

import { describe, expect, it } from 'vitest';

import { stripFrontmatter } from '../../../src/core/markdown/frontmatter-parser';

describe('stripFrontmatter', () => {
  it('strips a closed frontmatter block and returns the body', () => {
    const raw = [
      '---',
      'title: 示例',
      'document_type: lesson',
      '---',
      '',
      '# 正文标题',
      '',
      '正文内容。',
      '',
    ].join('\n');
    expect(stripFrontmatter(raw)).toBe('\n# 正文标题\n\n正文内容。\n');
  });

  it('returns the source unchanged when there is no frontmatter', () => {
    const raw = '# 只有正文\n\n没有 frontmatter。\n';
    expect(stripFrontmatter(raw)).toBe(raw);
    // 首个非空行不是 fence → 同样视为无 frontmatter
    const proseThenFence = '开头是正文\n---\ntitle: x\n---\n';
    expect(stripFrontmatter(proseThenFence)).toBe(proseThenFence);
  });

  it('returns the source unchanged when the frontmatter is unclosed', () => {
    const raw = '---\ntitle: 未闭合\n\n正文混在后面,没有闭合 fence。\n';
    expect(stripFrontmatter(raw)).toBe(raw);
  });

  it('only strips the first fence pair; later --- lines stay in the body', () => {
    const raw = '---\ntitle: x\n---\n正文\n---\n看起来像 fence 的正文分割线\n';
    expect(stripFrontmatter(raw)).toBe('正文\n---\n看起来像 fence 的正文分割线\n');
  });
});
