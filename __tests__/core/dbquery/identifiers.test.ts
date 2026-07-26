import { describe, it, expect } from 'vitest';
import { validateIdentifier } from '../../../src/core/dbquery/identifiers';

describe('validateIdentifier', () => {
  it('accepts plain identifiers', () => {
    expect(() => validateIdentifier('users', 'table')).not.toThrow();
    expect(() => validateIdentifier('public', 'schema')).not.toThrow();
    expect(() => validateIdentifier('my_db', 'database')).not.toThrow();
    expect(() => validateIdentifier('a', 'table')).not.toThrow();
  });

  it('rejects empty or non-string', () => {
    expect(() => validateIdentifier('', 'table')).toThrow(/non-empty/);
    expect(() => validateIdentifier(undefined as unknown as string, 'table')).toThrow(/non-empty/);
  });

  it('rejects identifiers exceeding 64 characters', () => {
    const long = 'a'.repeat(65);
    expect(() => validateIdentifier(long, 'table')).toThrow(/64 characters/);
  });

  it('rejects quote / statement-terminator characters', () => {
    expect(() => validateIdentifier('a`b', 'table')).toThrow(/forbidden/);
    expect(() => validateIdentifier('a"b', 'table')).toThrow(/forbidden/);
    expect(() => validateIdentifier("a'b", 'table')).toThrow(/forbidden/);
    expect(() => validateIdentifier('a;b', 'table')).toThrow(/forbidden/);
  });

  it('rejects null bytes and control characters', () => {
    expect(() => validateIdentifier('a\0b', 'table')).toThrow(/forbidden/);
    expect(() => validateIdentifier('a\nb', 'table')).toThrow(/forbidden/);
    expect(() => validateIdentifier('a\tb', 'table')).toThrow(/forbidden/);
    expect(() => validateIdentifier('a\rb', 'table')).toThrow(/forbidden/);
    expect(() => validateIdentifier('a\x01b', 'table')).toThrow(/forbidden/);
  });
});
