/**
 * Node.js version compatibility check.
 *
 * 2.0 inherits only the "minimum supported Node major" enforcement from
 * cgraphx 1.x. The Node 25 hard-block and the "untested Node 26+"
 * banner are gone — both were specifically about a V8 JIT Zone allocator
 * bug that fired while compiling the 1.x extraction parser, which 2.0
 * no longer ships. With that path removed, the only remaining concern is
 * the bare language / native-API floor, which `engines` in package.json
 * only warns about on install (unless `engine-strict`), so we hard-block
 * here.
 */

/**
 * Lowest supported Node.js major version. Matches the `engines` floor in
 * package.json (`>=22.5.0`). Below this, cgraphx relies on language
 * features / native APIs that aren't present, and the combination is
 * untested. `engines` alone only *warns* on install (unless the user set
 * `engine-strict`), so the CLI bootstrap also hard-blocks here to actually
 * enforce the floor.
 */
export const MIN_NODE_MAJOR = 22;

/**
 * Build the bordered banner shown when cgraphx detects a Node.js major
 * below {@link MIN_NODE_MAJOR}. Pinned via unit test so the recovery
 * commands and the override env var can't be silently stripped by future
 * edits.
 *
 * Uses ASCII glyphs to stay readable on Windows OEM-codepage consoles
 * (see ./ui/glyphs.ts for the rationale).
 */
export function buildNodeTooOldBanner(nodeVersion: string): string {
  const sep = '-'.repeat(72);
  return [
    sep,
    `[cgraphx] Unsupported Node.js version: ${nodeVersion}`,
    sep,
    `cgraphx requires Node.js ${MIN_NODE_MAJOR} or newer. Older versions lack`,
    'language features and native APIs cgraphx depends on, and are not',
    'tested or supported.',
    '',
    'Fix: install Node.js 22 LTS:',
    '  nvm install 22 && nvm use 22                          # nvm',
    '  brew install node@22 && brew link --overwrite --force node@22  # Homebrew',
    '',
    'To override (NOT recommended - unsupported):',
    '  CGRAPHX_ALLOW_UNSAFE_NODE=1 cgraphx ...',
    sep,
  ].join('\n');
}
