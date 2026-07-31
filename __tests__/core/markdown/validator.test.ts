import fs from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  parseFrontmatter,
  parseFrontmatterBlock,
} from '../../../src/core/markdown/frontmatter-parser';
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
      'source_type: work_context',
      'updated: 2026-06-26',
      'owners:',
      '  - team',
    ].join('\n'),
  );
}

describe('validateFrontmatter — required fields', () => {
  const REQUIRED = ['title', 'document_type', 'domains', 'concepts', 'status', 'source_type', 'updated', 'owners'] as const;

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

  it('rejects when owners list is empty', () => {
    const parsed = makeValid();
    parsed.values.set('owners', []);
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
      'business-entity', 'business-flow', 'mechanism', 'decision',
      'rule', 'lesson', 'guide',
    ];
    for (const t of all) {
      const parsed = makeValid();
      parsed.values.set('document_type', t);
      expect(validateFrontmatter(parsed).valid).toBe(true);
    }
  });

  it('accepts every documented source_type', () => {
    const all = [
      'work_context', 'batch_exploration', 'review', 'debugging', 'manual',
    ];
    for (const s of all) {
      const parsed = makeValid();
      parsed.values.set('source_type', s);
      expect(validateFrontmatter(parsed).valid).toBe(true);
    }
  });

  it('accepts business-entity document_type for entity entries', () => {
    const parsed = makeValid();
    parsed.values.set('document_type', 'business-entity');
    parsed.values.set('title', '商品');
    const r = validateFrontmatter(parsed);
    expect(r.valid).toBe(true);
    expect(r.fields?.documentType).toBe('business-entity');
  });

  // 废除 document_type 值(spec §3.1)→ 非法,detail 列举全部合法值(契约消息格式)
  it.each(['exploration', 'architecture', 'concept'])(
    'rejects removed document_type %j and lists valid values in detail',
    (removed) => {
      const parsed = makeValid();
      parsed.values.set('document_type', removed);
      const r = validateFrontmatter(parsed);
      expect(r.valid).toBe(false);
      expect(r.skipReason).toBe('invalid_enum_value');
      expect(r.detail).toBe(
        `document_type=${removed} (valid: business-entity, business-flow, mechanism, decision, rule, lesson, guide)`,
      );
    },
  );

  // 废除 source_type 值(spec §3.2)→ 非法,detail 列举全部合法值
  it.each(['ai_session', 'human_note'])(
    'rejects removed source_type %j and lists valid values in detail',
    (removed) => {
      const parsed = makeValid();
      parsed.values.set('source_type', removed);
      const r = validateFrontmatter(parsed);
      expect(r.valid).toBe(false);
      expect(r.skipReason).toBe('invalid_enum_value');
      expect(r.detail).toBe(
        `source_type=${removed} (valid: work_context, batch_exploration, review, debugging, manual)`,
      );
    },
  );
});

describe('repo knowledge doc migration (spec §3.1, §3.2)', () => {
  it('docs/knowledge/cgraphx-web.md validates under the new enums', () => {
    // 读仓库内真实知识文档(非 tmpdir):迁移后 frontmatter 须过新枚举世校验
    const file = path.join(__dirname, '..', '..', '..', 'docs', 'knowledge', 'cgraphx-web.md');
    const r = validateFrontmatter(parseFrontmatter(fs.readFileSync(file, 'utf-8')));
    expect(r.valid).toBe(true);
    expect(r.fields?.documentType).toBe('business-entity');
    expect(r.fields?.sourceType).toBe('work_context');
  });
});
