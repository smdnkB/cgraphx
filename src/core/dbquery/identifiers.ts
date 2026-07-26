/**
 * Identifier validation for SQL identifiers interpolated into schema
 * introspection queries (e.g. `SHOW CREATE TABLE \`db\`.\`tbl\``).
 *
 * The dbquery safety layer (`safety.ts`) only gates user-supplied SQL in
 * `runQuery`; `runSchema` builds its own SQL from CLI-provided identifiers
 * and bypasses safety. This module is the boundary check for those
 * identifiers — rejects anything that could break out of the quoted context
 * or inject a statement. Identifiers come from `--table` / `--profile` /
 * `--schema`, not from user SQL, so this is input validation, not the
 * primary SQL-injection defense.
 */

/** MySQL/PG identifiers are at most 64 bytes. */
const MAX_IDENTIFIER_LENGTH = 64;

/**
 * Reject identifiers that are empty, too long, or contain characters that
 * could break out of a backtick/double-quote context or terminate the
 * statement. Throws on invalid input; returns void on valid.
 */
export function validateIdentifier(name: string, field: string): void {
  if (typeof name !== 'string' || name.length === 0) {
    throw new Error(`Invalid ${field}: must be a non-empty string.`);
  }
  if (name.length > MAX_IDENTIFIER_LENGTH) {
    throw new Error(`Invalid ${field}: exceeds ${MAX_IDENTIFIER_LENGTH} characters.`);
  }
  // Reject any character that could escape the quoting context or inject SQL.
  // Backtick (MySQL quote), double-quote (PG quote), single-quote (string
  // literal), semicolon (statement terminator), null byte, and control chars.
  if (/[`"';\0\r\n\t]/.test(name) || /[\x00-\x1f]/.test(name)) {
    throw new Error(`Invalid ${field}: contains forbidden characters.`);
  }
}
