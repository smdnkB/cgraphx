/**
 * SQL safety checks for the db-query subsystem.
 *
 * Single responsibility: take a raw SQL string and either (a) approve it with
 * a normalized form and a final LIMIT, or (b) reject it with a structured
 * SafetyRejectionError. All write operations must be blocked — see spec §3.
 *
 * Layering:
 *   1. strip comments (block comments with nesting, plus -- and # line comments)
 *      while preserving string literals (so 'INSERT' still trips detection)
 *   2. multi-statement check (any `;` after stripping → reject)
 *   3. forbidden keyword scan (case-insensitive, word-boundary)
 *   4. LIMIT enforcement (SELECT only; schema queries pass through)
 */

import { FORBIDDEN_KEYWORDS, DEFAULT_LIMIT, MAX_LIMIT } from './constants';
import { SafetyRejectionError } from './errors';

export interface SafetyOk {
  ok: true;
  normalizedSql: string;
  effectiveLimit: number;
  modified: boolean;
}

export interface SafetyFail {
  ok: false;
  normalizedSql: string;
  error: SafetyRejectionError;
}

export type SafetyResult = SafetyOk | SafetyFail;

/**
 * Strip SQL comments while preserving string literals (so a keyword like
 * 'INSERT' inside a string still trips the keyword scan — defense in depth,
 * spec §3.2 铁律).
 *
 * Comment forms handled:
 *   - block: `/* ... *\/` with nesting (MySQL syntax; PG doesn't nest but we
 *     handle it conservatively)
 *   - line:  `-- ...` and `# ...` (MySQL) up to end of line
 *
 * Comments are replaced with single spaces (line/column preservation for
 * error reporting).
 */
function stripComments(sql: string): string {
  let out = '';
  let i = 0;
  const n = sql.length;
  type State = 'normal' | 'single' | 'double' | 'block' | 'line';
  let state: State = 'normal';
  let blockDepth = 0;

  while (i < n) {
    const ch = sql[i]!;
    const next = sql[i + 1];

    switch (state) {
      case 'normal': {
        if (ch === "'") {
          out += ch;
          state = 'single';
          i++;
        } else if (ch === '"') {
          out += ch;
          state = 'double';
          i++;
        } else if (ch === '/' && next === '*') {
          out += ' ';
          i += 2;
          state = 'block';
          blockDepth = 1;
        } else if (ch === '-' && next === '-') {
          out += ' ';
          i += 2;
          state = 'line';
        } else if (ch === '#') {
          out += ' ';
          i++;
          state = 'line';
        } else {
          out += ch;
          i++;
        }
        break;
      }
      case 'single': {
        if (ch === "'") {
          // MySQL/PG both escape ' as ''
          if (next === "'") {
            out += "''";
            i += 2;
          } else {
            out += ch;
            state = 'normal';
            i++;
          }
        } else {
          out += ch;
          i++;
        }
        break;
      }
      case 'double': {
        if (ch === '"') {
          out += ch;
          state = 'normal';
          i++;
        } else {
          out += ch;
          i++;
        }
        break;
      }
      case 'block': {
        if (ch === '/' && next === '*') {
          // nested — MySQL allows; we count depth
          blockDepth++;
          i += 2;
        } else if (ch === '*' && next === '/') {
          blockDepth--;
          i += 2;
          if (blockDepth === 0) {
            state = 'normal';
          }
        } else if (ch === '\n') {
          // preserve newlines so multi-line comments don't collapse lines
          out += '\n';
          i++;
        } else {
          i++;
        }
        break;
      }
      case 'line': {
        if (ch === '\n') {
          out += '\n';
          state = 'normal';
          i++;
        } else {
          i++;
        }
        break;
      }
    }
  }
  return out;
}

/**
 * Find forbidden keywords in the (already comment-stripped) SQL.
 * Case-insensitive, word-boundary matched. Returns matched keywords (deduped).
 */
function findForbiddenKeywords(sql: string): string[] {
  const matched = new Set<string>();
  for (const kw of FORBIDDEN_KEYWORDS) {
    // \b boundary handles word edges; case-insensitive.
    // MySQL backtick-quoted identifiers: `INSERT` is a table name, but we
    // still reject it defensively (spec §3.1 last bullet).
    const re = new RegExp(`(^|[^A-Za-z0-9_])${escapeRegex(kw)}(?![A-Za-z0-9_])`, 'i');
    if (re.test(sql)) {
      matched.add(kw);
    }
  }
  return Array.from(matched);
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Multi-statement check: any semicolon in the comment-stripped SQL rejects.
 * Single-statement-only is the contract (spec §3.3).
 *
 * Trailing `;` or `;   ` also rejected (spec §3.3).
 */
function hasMultipleStatements(sql: string): boolean {
  // Semicolons inside string literals are preserved by stripComments, so they
  // still trigger this — which is correct (a string literal with `;` is rare
  // and the defensive choice is to reject).
  return sql.includes(';');
}

/**
 * Detect whether this query should bypass LIMIT enforcement.
 * Spec §3.4: SHOW / DESCRIBE / EXPLAIN / information_schema.* / pg_catalog.*
 * are schema queries — they return small fixed result sets.
 *
 * Anything that's not a `SELECT` (USE / SET / etc.) also bypasses — drivers
 * will reject most non-SELECT statements anyway, and our keyword blacklist
 * already blocks writes.
 */
function isSchemaQuery(sql: string): boolean {
  const trimmed = sql.trimStart().toUpperCase();
  if (!trimmed.startsWith('SELECT')) {
    return true;
  }
  return informationSchemaQuery(sql);
}

/**
 * True if this SELECT queries information_schema or pg_catalog — those return
 * small fixed result sets and never need LIMIT forced.
 */
function informationSchemaQuery(sql: string): boolean {
  const lower = sql.toLowerCase();
  return (
    lower.includes('information_schema') ||
    lower.includes('pg_catalog') ||
    lower.includes('pg_attribute') ||
    lower.includes('pg_class') ||
    lower.includes('pg_index') ||
    lower.includes('pg_indexes') ||
    lower.includes('pg_description') ||
    lower.includes('pg_namespace')
  );
}

/**
 * Detect and parse existing LIMIT clause. Returns the limit value if present.
 */
function detectExistingLimit(sql: string): number | null {
  // Match `LIMIT <number>` or `limit <number>` near end of query.
  // We don't try to handle OFFSET or subqueries — just a top-level LIMIT.
  const m = sql.match(/\blimit\s+(\d+)\b/i);
  return m && m[1] ? parseInt(m[1], 10) : null;
}

/**
 * Normalize whitespace: collapse runs of whitespace into single spaces,
 * preserving newlines as-is. The output is what's logged + returned in errors.
 */
function normalizeWhitespace(sql: string): string {
  return sql
    .split('\n')
    .map(line => line.replace(/[ \t]+/g, ' ').trim())
    .join('\n')
    .trim();
}

/**
 * Wrap or rewrite the SELECT with the final LIMIT.
 *
 * Spec §3.4 matrix:
 *   - no LIMIT          → append ` LIMIT N` (default 100, or requestedLimit)
 *   - LIMIT ≤ cap       → unchanged
 *   - LIMIT > cap       → rewrite down to cap (1000)
 *
 * For schema queries, returns SQL unchanged (no LIMIT added).
 */
function enforceLimit(
  sql: string,
  requestedLimit: number | undefined,
): { sql: string; effectiveLimit: number; modified: boolean } {
  if (informationSchemaQuery(sql)) {
    return { sql, effectiveLimit: 0, modified: false };
  }

  const existing = detectExistingLimit(sql);
  if (existing !== null) {
    if (existing > MAX_LIMIT) {
      const rewritten = sql.replace(
        new RegExp(`\\blimit\\s+\\d+`, 'i'),
        `LIMIT ${MAX_LIMIT}`,
      );
      return { sql: rewritten, effectiveLimit: MAX_LIMIT, modified: true };
    }
    return { sql, effectiveLimit: existing, modified: false };
  }

  // No existing LIMIT — append.
  const finalLimit =
    requestedLimit !== undefined
      ? Math.min(requestedLimit, MAX_LIMIT)
      : DEFAULT_LIMIT;
  return {
    sql: `${sql.replace(/;\s*$/, '')} LIMIT ${finalLimit}`,
    effectiveLimit: finalLimit,
    modified: true,
  };
}

/**
 * Main entry point. Performs all safety checks.
 *
 * Returns SafetyOk if the query is approved, SafetyFail otherwise. Never
 * throws — callers branching on `.ok` get full type narrowing.
 */
export function checkSafety(
  rawSql: string,
  requestedLimit?: number,
): SafetyResult {
  const stripped = stripComments(rawSql);
  const normalizedSql = normalizeWhitespace(stripped);

  // 1. Empty SQL
  if (normalizedSql.length === 0) {
    return {
      ok: false,
      normalizedSql,
      error: new SafetyRejectionError(['(empty)'], normalizedSql),
    };
  }

  // 2. Multi-statement
  if (hasMultipleStatements(normalizedSql)) {
    return {
      ok: false,
      normalizedSql,
      error: new SafetyRejectionError([';'], normalizedSql),
    };
  }

  // 3. Forbidden keyword scan
  const matched = findForbiddenKeywords(normalizedSql);
  if (matched.length > 0) {
    return {
      ok: false,
      normalizedSql,
      error: new SafetyRejectionError(matched, normalizedSql),
    };
  }

  // 4. LIMIT enforcement (skipped for schema queries)
  if (isSchemaQuery(normalizedSql)) {
    return { ok: true, normalizedSql, effectiveLimit: 0, modified: false };
  }

  const limited = enforceLimit(normalizedSql, requestedLimit);
  return {
    ok: true,
    normalizedSql: limited.sql,
    effectiveLimit: limited.effectiveLimit,
    modified: limited.modified,
  };
}
