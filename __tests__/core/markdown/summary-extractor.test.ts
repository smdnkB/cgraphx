import { describe, expect, it } from 'vitest';

import { extractSummary } from '../../../src/core/markdown/summary-extractor';

describe('extractSummary', () => {
  it('extracts the body until the next same-or-higher-level heading', () => {
    const src = `# Doc

## Summary
first line.

second line.

## Context
after.
`;
    expect(extractSummary(src)).toBe('first line.\n\nsecond line.');
  });

  it('accepts Chinese alias `## 摘要`', () => {
    const src = `## 摘要\n这是摘要内容。\n\n## Context\nother\n`;
    expect(extractSummary(src)).toBe('这是摘要内容。');
  });

  it('returns empty when no Summary heading', () => {
    expect(extractSummary('# Doc\n\nbody without summary\n')).toBe('');
  });

  it('takes the first Summary when multiple are present', () => {
    const src = `## Summary\nfirst\n\n## Summary\nsecond\n`;
    expect(extractSummary(src)).toBe('first');
  });

  it('does NOT match `# Summary` (one hash)', () => {
    expect(extractSummary('# Summary\nbody\n')).toBe('');
  });

  it('does NOT match `### Summary` (three hashes)', () => {
    expect(extractSummary('### Summary\nbody\n')).toBe('');
  });

  it('does NOT match `##Summary` (no space)', () => {
    expect(extractSummary('##Summary\nbody\n')).toBe('');
  });

  it('does NOT match `## summary` (lowercase)', () => {
    expect(extractSummary('## summary\nbody\n')).toBe('');
  });

  it('returns empty when Summary heading has no body', () => {
    expect(extractSummary('## Summary\n\n## Context\n')).toBe('');
  });

  it('reads to end of file when no terminator follows', () => {
    const src = `## Summary\nlast paragraph.\nmore text.`;
    expect(extractSummary(src)).toBe('last paragraph.\nmore text.');
  });

  it('normalizes CRLF to LF', () => {
    const src = '## Summary\r\nline one\r\nline two\r\n';
    expect(extractSummary(src)).toBe('line one\nline two');
  });
});
