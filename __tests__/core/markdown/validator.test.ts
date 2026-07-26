import { describe, expect, it } from 'vitest';

import { parseFrontmatterBlock } from '../../../src/core/markdown/frontmatter-parser';
import { validateFrontmatter } from '../../../src/core/markdown/validator';

function makeValid() {
  return parseFrontmatterBlock(
    [
      'title: Test',
      'document_type: decision',
      'domains:',
      '  - A',
      'concepts:',
      '  - X',
      'status: active',
      'source_type: ai_session',
      'updated: 2026-06-26',
    ].join('\n'),
  );
}

describe('validateFrontmatter — required fields', () => {
  const REQUIRED = ['title', 'document_type', 'domains', 'concepts', 'status', 'source_type', 'updated'] as const;

  for (const key of REQUIRED) {
    it(`rejects when ${key} is missing`, () => {
      const parsed = makeValid();
      parsed.values.delete(key);
      const r = validateFrontmatter(parsed);
      expect(r.valid).toBe(false);
      expect(r.skipReason).toBe('missing_required_field');
      expect(r.detail).toContain(key);
    });

    it(`rejects when ${key} is empty`, () => {
      const parsed = makeValid();
      parsed.values.set(key, '');
      const r = validateFrontmatter(parsed);
      expect(r.valid).toBe(false);
      expect(r.skipReason).toBe('missing_required_field');
    });
  }

  it('rejects when domains list is empty', () => {
    const parsed = makeValid();
    parsed.values.set('domains', []);
    const r = validateFrontmatter(parsed);
    expect(r.skipReason).toBe('missing_required_field');
  });

  it('accepts when all required fields are present and non-empty', () => {
    expect(validateFrontmatter(makeValid()).valid).toBe(true);
  });
});

describe('validateFrontmatter — enum values', () => {
  it('rejects unknown document_type', () => {
    const parsed = makeValid();
    parsed.values.set('document_type', 'random');
    const r = validateFrontmatter(parsed);
    expect(r.skipReason).toBe('invalid_enum_value');
    expect(r.detail).toContain('document_type=random');
  });

  it('rejects unknown status', () => {
    const parsed = makeValid();
    parsed.values.set('status', 'archived');
    const r = validateFrontmatter(parsed);
    expect(r.skipReason).toBe('invalid_enum_value');
    expect(r.detail).toContain('status=archived');
  });

  it('rejects unknown source_type', () => {
    const parsed = makeValid();
    parsed.values.set('source_type', 'magic');
    const r = validateFrontmatter(parsed);
    expect(r.skipReason).toBe('invalid_enum_value');
  });

  it('is case-sensitive on enum values', () => {
    const parsed = makeValid();
    parsed.values.set('status', 'Active');
    expect(validateFrontmatter(parsed).skipReason).toBe('invalid_enum_value');
  });

  it('accepts every documented document_type', () => {
    const all = [
      'conversation', 'exploration', 'finding', 'analysis', 'lesson',
      'warning', 'decision', 'rule', 'architecture', 'guide', 'tutorial',
      'runbook', 'installation', 'api', 'faq', 'note',
    ];
    for (const t of all) {
      const parsed = makeValid();
      parsed.values.set('document_type', t);
      expect(validateFrontmatter(parsed).valid).toBe(true);
    }
  });
});
