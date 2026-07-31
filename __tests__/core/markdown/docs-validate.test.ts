import { describe, expect, it } from 'vitest';

import { parseFrontmatter } from '../../../src/core/markdown/frontmatter-parser';
import { validateFrontmatter } from '../../../src/core/markdown/validator';

/**
 * These tests pin the `cgraphx docs validate <file>` code path — the CLI
 * reads the file, runs parseFrontmatter + validateFrontmatter, and exits
 * 0 (valid) / 2 (invalid). We exercise the same two-function chain here
 * against the same inputs the CLI would see.
 */

const VALID = `---
title: Redis 本地安装指南
document_type: guide
domains:
  - infra
concepts:
  - Redis
status: active
source_type: manual
updated: 2026-07-14
owners:
  - team
---

## Summary
安装 Redis。
`;

describe('docs validate (parseFrontmatter + validateFrontmatter)', () => {
  it('accepts a file with all required fields + valid enums', () => {
    const result = validateFrontmatter(parseFrontmatter(VALID));
    expect(result.valid).toBe(true);
    expect(result.skipReason).toBeUndefined();
    expect(result.fields?.title).toBe('Redis 本地安装指南');
    expect(result.fields?.documentType).toBe('guide');
    expect(result.fields?.status).toBe('active');
    expect(result.fields?.sourceType).toBe('manual');
  });

  it('rejects when a required field is missing (title)', () => {
    const src = VALID.replace('title: Redis 本地安装指南\n', '');
    const result = validateFrontmatter(parseFrontmatter(src));
    expect(result.valid).toBe(false);
    expect(result.skipReason).toBe('missing_required_field');
    expect(result.detail).toMatch(/title/);
  });

  it('rejects when owners is missing', () => {
    const src = VALID.replace('owners:\n  - team\n', '');
    const result = validateFrontmatter(parseFrontmatter(src));
    expect(result.valid).toBe(false);
    expect(result.skipReason).toBe('missing_required_field');
    expect(result.detail).toMatch(/owners/);
  });

  it('rejects when a required list field is malformed (concepts: [])', () => {
    // Inline [] parses as a scalar "[]" rather than an empty list, so the
    // validator rejects it as a field_type_error. Either way the file is
    // invalid — that's what matters for the CLI exit code.
    const src = VALID.replace('concepts:\n  - Redis\n', 'concepts: []\n');
    const result = validateFrontmatter(parseFrontmatter(src));
    expect(result.valid).toBe(false);
    expect(result.skipReason).toBe('field_type_error');
  });

  it('rejects an invalid document_type enum', () => {
    const src = VALID.replace('document_type: guide', 'document_type: bogus');
    const result = validateFrontmatter(parseFrontmatter(src));
    expect(result.valid).toBe(false);
    expect(result.skipReason).toBe('invalid_enum_value');
    expect(result.detail).toMatch(/document_type=bogus/);
  });

  it('rejects an invalid status enum', () => {
    const src = VALID.replace('status: active', 'status: live');
    const result = validateFrontmatter(parseFrontmatter(src));
    expect(result.valid).toBe(false);
    expect(result.skipReason).toBe('invalid_enum_value');
    expect(result.detail).toMatch(/status=live/);
  });

  it('rejects an invalid source_type enum', () => {
    const src = VALID.replace('source_type: manual', 'source_type: guessed');
    const result = validateFrontmatter(parseFrontmatter(src));
    expect(result.valid).toBe(false);
    expect(result.skipReason).toBe('invalid_enum_value');
    expect(result.detail).toMatch(/source_type=guessed/);
  });

  it('rejects a file with no frontmatter block at all', () => {
    const result = validateFrontmatter(parseFrontmatter('# Just a README\nno frontmatter'));
    expect(result.valid).toBe(false);
    expect(result.skipReason).toBe('missing_required_field');
  });
});
