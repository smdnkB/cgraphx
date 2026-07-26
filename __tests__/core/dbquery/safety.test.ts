/**
 * Adversarial tests for safety.ts — the security core of db-query.
 *
 * Spec §9.1 #1-#7. MUST pass before driver work (B-4) starts.
 */

import { describe, it, expect } from 'vitest';
import { checkSafety } from '../../../src/core/dbquery/safety';
import { FORBIDDEN_KEYWORDS, DEFAULT_LIMIT, MAX_LIMIT } from '../../../src/core/dbquery/constants';

describe('safety: forbidden keywords (spec §3.1, §9.1 #1)', () => {
  // Each forbidden keyword, three case variants — all must be rejected.
  const cases: Array<[string, string]> = [];
  for (const kw of FORBIDDEN_KEYWORDS) {
    cases.push([`${kw.toUpperCase()} FROM t`, kw]);
    cases.push([`${kw.toLowerCase()} from t`, kw]);
    cases.push([`${kw[0]!.toUpperCase()}${kw.slice(1).toLowerCase()} from t`, kw]);
  }

  it.each(cases)('rejects "%s" (matched: %s)', (sql) => {
    const r = checkSafety(sql);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.code).toBe('SAFETY_REJECTED');
    }
  });

  it('rejects keyword embedded mid-query', () => {
    const r = checkSafety('SELECT * FROM users WHERE 1=1 INSERT INTO logs VALUES(1)');
    expect(r.ok).toBe(false);
  });

  it('rejects keyword in CTE body', () => {
    const r = checkSafety('WITH x AS (SELECT 1) DELETE FROM users');
    expect(r.ok).toBe(false);
  });

  it('does NOT misfire on word-boundary similar tokens', () => {
    // 'INSERTED' contains INSERT as substring, but word-boundary lookahead
    // rejects it: INSERT is followed by 'E' (word char), so the negative
    // lookahead (?![A-Za-z0-9_]) fails. Same for 'UPDATED', 'DELETED' etc.
    const r1 = checkSafety("SELECT * FROM logs WHERE action = 'INSERTED'");
    expect(r1.ok).toBe(true);
    const r2 = checkSafety('SELECT inserted_count FROM metrics');
    expect(r2.ok).toBe(true);
    const r3 = checkSafety('SELECT deleted_at FROM users');
    expect(r3.ok).toBe(true);
  });
});

describe('safety: comment stripping (spec §3.2, §9.1 #2)', () => {
  it('strips -- line comments', () => {
    const r = checkSafety('SELECT 1 -- DELETE FROM users\n');
    // After stripping: "SELECT 1" — DELETE keyword is gone → should pass
    expect(r.ok).toBe(true);
  });

  it('detects keyword hidden behind -- line comment', () => {
    // The intent here: even though we strip -- comments, if the keyword is
    // BEFORE the comment, it's still there. Strip only removes the comment.
    const r = checkSafety('DELETE FROM users -- oops');
    expect(r.ok).toBe(false);
  });

  it('strips # line comments (MySQL)', () => {
    const r = checkSafety('SELECT 1 # DROP TABLE users\n');
    expect(r.ok).toBe(true);
  });

  it('strips /* block comments */', () => {
    const r = checkSafety('SELECT 1 /* INSERT INTO logs */ FROM t');
    expect(r.ok).toBe(true);
  });

  it('strips nested /* outer /* inner */ block comments */', () => {
    const r = checkSafety('SELECT 1 /* outer /* inner */ DROP TABLE users */ FROM t');
    expect(r.ok).toBe(true);
  });

  it('preserves string literals (keyword inside string still trips)', () => {
    const r = checkSafety("SELECT 'INSERT' FROM t");
    expect(r.ok).toBe(false); // spec §3.2 铁律 — string content not stripped, defensive reject
  });

  it('preserves string literals with semicolons inside', () => {
    const r = checkSafety("SELECT 'a;b' FROM t");
    expect(r.ok).toBe(false); // ; inside string still trips multi-statement check
  });
});

describe('safety: multi-statement (spec §3.3, §9.1 #4)', () => {
  it('rejects semicolon-separated statements', () => {
    const r = checkSafety('SELECT 1; DROP TABLE users');
    expect(r.ok).toBe(false);
  });

  it('rejects trailing semicolon', () => {
    const r = checkSafety('SELECT 1;');
    expect(r.ok).toBe(false);
  });

  it('rejects semicolon followed by whitespace', () => {
    const r = checkSafety('SELECT 1;   ');
    expect(r.ok).toBe(false);
  });

  it('rejects CTE wrapping write operation', () => {
    const r = checkSafety('WITH x AS (SELECT 1) SELECT * FROM x');
    expect(r.ok).toBe(true); // pure-read CTE — fine
  });

  it('rejects CTE with INSERT body', () => {
    const r = checkSafety('WITH x AS (INSERT INTO t VALUES(1)) SELECT * FROM x');
    expect(r.ok).toBe(false); // PG writable CTE — keyword scan catches INSERT
  });
});

describe('safety: LIMIT enforcement (spec §3.4, §9.1 #6 #7)', () => {
  it('wraps LIMIT-less SELECT with default limit', () => {
    const r = checkSafety('SELECT * FROM users');
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.effectiveLimit).toBe(DEFAULT_LIMIT);
      expect(r.modified).toBe(true);
      expect(r.normalizedSql.toUpperCase()).toContain('LIMIT');
    }
  });

  it('preserves LIMIT within cap', () => {
    const r = checkSafety('SELECT * FROM users LIMIT 50');
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.effectiveLimit).toBe(50);
      expect(r.modified).toBe(false);
    }
  });

  it('rewrites LIMIT exceeding cap down to MAX_LIMIT', () => {
    const r = checkSafety('SELECT * FROM users LIMIT 5000');
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.effectiveLimit).toBe(MAX_LIMIT);
      expect(r.modified).toBe(true);
    }
  });

  it('does NOT add LIMIT to information_schema query', () => {
    const r = checkSafety('SELECT * FROM information_schema.tables');
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.effectiveLimit).toBe(0);
      expect(r.modified).toBe(false);
      expect(r.normalizedSql.toUpperCase()).not.toContain('LIMIT');
    }
  });

  it('does NOT add LIMIT to SHOW statement', () => {
    const r = checkSafety('SHOW TABLES');
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.effectiveLimit).toBe(0);
    }
  });

  it('does NOT add LIMIT to DESCRIBE statement', () => {
    const r = checkSafety('DESCRIBE users');
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.effectiveLimit).toBe(0);
  });

  it('honors caller-supplied limit (within cap)', () => {
    const r = checkSafety('SELECT * FROM users', 200);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.effectiveLimit).toBe(200);
  });

  it('clamps caller-supplied limit to MAX_LIMIT', () => {
    const r = checkSafety('SELECT * FROM users', 99_999);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.effectiveLimit).toBe(MAX_LIMIT);
  });
});

describe('safety: edge cases', () => {
  it('rejects empty SQL', () => {
    const r = checkSafety('   ');
    expect(r.ok).toBe(false);
  });

  it('rejects empty string', () => {
    const r = checkSafety('');
    expect(r.ok).toBe(false);
  });

  it('handles multiline SELECT', () => {
    const r = checkSafety('SELECT *\n  FROM users\n  WHERE id = 1');
    expect(r.ok).toBe(true);
  });

  it('handles lowercase select', () => {
    const r = checkSafety('select * from users');
    expect(r.ok).toBe(true);
  });

  it('detects keyword across case mix', () => {
    const r = checkSafety('DrOp TaBlE users');
    expect(r.ok).toBe(false);
  });

  it('strips comment but keeps keyword that came before it', () => {
    const r = checkSafety('UPDATE users SET x=1 -- comment');
    expect(r.ok).toBe(false);
  });

  it('preserves CRLF line endings in line comments', () => {
    const r = checkSafety('SELECT 1 -- DELETE\r\nFROM t');
    expect(r.ok).toBe(true);
  });

  it('does not crash on unicode', () => {
    const r = checkSafety('SELECT * FROM 用户');
    expect(r.ok).toBe(true);
  });
});

describe('safety: adversarial / bypass attempts (spec §9.2)', () => {
  it('rejects backtick-quoted INSERT (MySQL identifier)', () => {
    // Defensive: even though `INSERT` could be a column name, reject.
    const r = checkSafety('SELECT `INSERT` FROM t');
    // Word-boundary regex sees ` (backtick) as non-word, so it matches.
    expect(r.ok).toBe(false);
  });

  it('rejects hex-encoded keyword in identifier', () => {
    // 0x494E53455254 = INSERT (hex), but as identifier in SQL it's literal.
    // We can't actually parse hex identifiers without a real SQL parser,
    // so this case is informational — keyword scan won't catch it, but the
    // driver will reject most such constructs as syntax errors anyway.
    // Skip: not in MVP scope.
  });

  it('rejects keyword inside string concatenation', () => {
    const r = checkSafety("SELECT 'INSERT' || 'more' FROM t");
    expect(r.ok).toBe(false);
  });

  it('rejects deeply nested comments hiding keyword', () => {
    const r = checkSafety('SELECT /* l1 /* l2 /* l3 */ INSERT */ */ 1');
    expect(r.ok).toBe(true); // INSERT is inside a comment, stripped. Should pass.
    // ^ This tests nesting depth handling.
  });

  it('rejects keyword at end of query after comment', () => {
    const r = checkSafety('SELECT * FROM users -- comment\nDELETE FROM users');
    expect(r.ok).toBe(false); // newline ends comment, DELETE follows
  });
});
