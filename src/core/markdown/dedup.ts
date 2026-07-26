/**
 * Normalize a name for dedup comparison.
 *
 * Equivalent to the original bash `tr '[:upper:]' '[:lower:]' | tr -d ' _-,.;:，。、；：'`.
 * Used by both Layer 1 (entry point name) and Layer 2 (concept name) dedup,
 * so behavior must be identical across both.
 *
 * Rules:
 * - Lowercase via String.prototype.toLowerCase() (Unicode-aware, e.g. 'Ě' → 'ě')
 * - Keep: 0-9, a-z (after lowercase), CJK Unified Ideographs (>= 0x4E00) and above
 *   (also keeps CJK Extension A 0x3400-0x4DBF since it sits below 0x4E00 but is
 *    matched by the >= 0x3400 branch below — see note)
 * - Drop: half-width _ - , . ; : space + full-width ， 。 、 ； ： + other punctuation
 *
 * Edge cases:
 * - null / undefined → ''
 * - non-string input → throws TypeError (do not silently coerce)
 */

// Full-width / CJK punctuation that the original bash `tr -d` set included.
// These codepoints are all >= 0x4E00? No — actually:
//   、 = U+3001 (CJK punct, below 0x4E00)
//   。 = U+3002 (CJK punct, below 0x4E00)
//   ， = U+FF0C (fullwidth, >= 0x4E00 — would wrongly be kept by a pure whitelist)
//   ； = U+FF1B (fullwidth, >= 0x4E00)
//   ： = U+FF1A (fullwidth, >= 0x4E00)
// The three fullwidth ones sit at/above 0x4E00, so a pure `code >= 0x4E00`
// whitelist would incorrectly keep them. We exclude this explicit set first.
const FULLWIDTH_PUNCT_DENY = new Set<string>([
  '、', // 、 ideographic comma
  '。', // 。 ideographic full stop
  '，', // ， fullwidth comma
  '；', // ； fullwidth semicolon
  '：', // ： fullwidth colon
]);

export function normalizeName(s: string): string {
  if (s == null) return '';
  if (typeof s !== 'string') {
    throw new TypeError(`normalizeName expects a string, got ${typeof s}`);
  }
  const lower = s.toLowerCase();
  let out = '';
  for (const ch of lower) {
    // Drop the fullwidth / CJK punctuation set first — these would otherwise
    // slip through the `>= 0x4E00` whitelist below.
    if (FULLWIDTH_PUNCT_DENY.has(ch)) continue;
    const code = ch.charCodeAt(0);
    if (
      (code >= 48 && code <= 57)  ||    // 0-9
      (code >= 97 && code <= 122) ||    // a-z (already lowercased)
      (code >= 0x3400 && code <= 0x4DBF) || // CJK Unified Ideographs Extension A
      code >= 0x4E00                    // CJK Unified Ideographs + extensions B-F etc.
    ) {
      out += ch;
    }
    // Other (half-width punctuation _ - , . ; : space, ASCII uppercase already
    // lowercased, Latin-1 supplement letters, etc.) — dropped.
  }
  return out;
}
