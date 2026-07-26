/**
 * Bash command semantic classification (spec §4.2 / B-3).
 *
 * PostToolUse Bash events carry a `command` string in tool_args and a stdout
 * blob in tool_response. Most commands are noise (ls / cat / grep / git status),
 * but four categories carry high-signal structure worth surfacing as discrete
 * fields instead of a raw stdout blob:
 *
 *   - test       — vitest / jest / npm test / pytest / go test / cargo test ...
 *                  parse `passing` / `failing` / `Tests run` / `ok` / `FAILED`
 *   - build      — npm run build / tsc / webpack / mvn package / cargo build ...
 *                  exit_code 0 → pass=1, fail=0; otherwise pass=0, fail=1
 *   - lint       — eslint / prettier / ruff / golangci-lint ...
 *                  parse `error` / `warning` / `problem`
 *   - git_write  — git push / git commit
 *                  exit_code 0 → pass=1, fail=0
 *
 * The category is decided by COMMAND prefix match (the tool the user invoked);
 * pass/fail counts come from stdout parsing for the category's known formats.
 * If the category matches but the stdout format is unknown, we still return
 * the category — pass/fail stay undefined (caller omits them).
 *
 * Boundary with git_commit events: a `git commit` made in Bash is classified
 * here as `git_write` (marks "user pushed/committed via shell"); the actual
 * commit metadata (hash / insertions / deletions) is captured separately by
 * the post-commit hook's git_commit event. The two are complementary, not
 * overlapping — this category never duplicates commit line counts.
 *
 * Returns null for any command that doesn't match a known category — callers
 * silently fall back to the plain stdout_preview Bash summary.
 */

export type BashCategory = 'test' | 'build' | 'lint' | 'git_write';

export interface BashSemantics {
  category: BashCategory;
  pass?: number;
  fail?: number;
  duration_ms?: number;
}

export interface DetectBashSemanticsInput {
  command: string;
  stdout?: string;
  exit_code?: number;
}

/**
 * Detect the semantic category of a Bash command and parse structured
 * pass/fail counts from stdout when the format is known.
 *
 * Returns null when the command doesn't match any recognized category —
 * callers should fall back to the plain Bash stdout_preview summary.
 */
export function detectBashSemantics(input: DetectBashSemanticsInput): BashSemantics | null {
  const command = typeof input.command === 'string' ? input.command.trim() : '';
  if (!command) return null;

  // For compound commands (cmd1 && cmd2), classify by the FIRST segment —
  // that's the primary action the user initiated. A `npm test && npm run build`
  // is recorded as `test` (the test result is what the user cares about first).
  const firstCommand = firstCommandSegment(command);

  const category = classifyCategory(firstCommand);
  if (!category) return null;

  const stdout = typeof input.stdout === 'string' ? input.stdout : '';
  const exit_code = typeof input.exit_code === 'number' ? input.exit_code : undefined;

  switch (category) {
    case 'test': {
      const parsed = parseTestCounts(stdout);
      return {
        category: 'test',
        pass: parsed?.pass,
        fail: parsed?.fail,
      };
    }
    case 'build': {
      // Build outcome is binary: succeeded (exit 0) or failed.
      if (exit_code === undefined) {
        return { category: 'build' };
      }
      return {
        category: 'build',
        pass: exit_code === 0 ? 1 : 0,
        fail: exit_code === 0 ? 0 : 1,
      };
    }
    case 'lint': {
      const parsed = parseLintCounts(stdout);
      return {
        category: 'lint',
        pass: parsed?.pass,
        fail: parsed?.fail,
      };
    }
    case 'git_write': {
      if (exit_code === undefined) {
        return { category: 'git_write' };
      }
      return {
        category: 'git_write',
        pass: exit_code === 0 ? 1 : 0,
        fail: exit_code === 0 ? 0 : 1,
      };
    }
  }
}

// ─── Command classification ────────────────────────────────────────────────

/**
 * Extract the first segment of a possibly-compound command (split on `&&`,
 * `||`, `;`, `|`). Whitespace trimmed. Returns the trimmed first segment.
 */
function firstCommandSegment(command: string): string {
  // Split on shell separators: &&, ||, ;, |. Take the first non-empty segment.
  // We deliberately don't parse shell quoting — prefix-match on the leading
  // word is sufficient to classify the command's category, and a mis-parse
  // just falls back to null (plain Bash summary), never produces a wrong category.
  const segments = command.split(/&&|\|\||;|\|/);
  for (const seg of segments) {
    const trimmed = seg.trim();
    if (trimmed) return trimmed;
  }
  return command.trim();
}

/**
 * Strip leading package-runner prefixes (npx / yarn / pnpm / ./) and return
 * the "effective" command string that classification should match against.
 *
 *   'npx vitest run'      → 'vitest run'
 *   'yarn test'           → 'test'
 *   'pnpm eslint .'       → 'eslint .'
 *   './gradlew test'      → 'gradlew test'
 *   'npm test'            → 'npm test'   (npm stays — npm test/build are categories)
 *   'npm run build'       → 'npm run build'
 *
 * `npm` and `mvn` and `gradle` are KEPT because `npm test` vs `npm run build`
 * vs `mvn test` vs `mvn package` are the category discriminators themselves.
 */
function stripRunnerPrefix(cmd: string): string {
  // Strip leading env-var assignments (FOO=bar baz → baz). Common in CI.
  const envStripped = cmd.replace(/^(?:[A-Z_][A-Z0-9_]*=\S+\s+)+/i, '');
  // Strip leading npx / yarn / pnpm with optional flags like npx -y, yarn dlx
  const runnerStripped = envStripped.replace(
    /^(?:(?:npx|yarn|pnpm)(?:\s+(?:dlx|run|exec))?(?:\s+--?\S+)*\s+)/,
    '',
  );
  // Strip leading ./ (./gradlew → gradlew)
  return runnerStripped.replace(/^\.\//, '');
}

/**
 * Classify a (already first-segmented, runner-stripped) command into a
 * semantic category, or null if it doesn't match.
 */
function classifyCategory(cmd: string): BashCategory | null {
  const stripped = stripRunnerPrefix(cmd);

  // git_write — must come before generic git checks. Match `git push` /
  // `git commit` exactly (these mutate). `git status` / `git log` / `git diff`
  // are read-only and fall through to null.
  if (/^git\s+push(\s|$)/.test(stripped)) return 'git_write';
  if (/^git\s+commit(\s|$)/.test(stripped)) return 'git_write';

  // test — direct test runners first
  if (/^(vitest|jest)(\s|$)/.test(stripped)) return 'test';
  if (/^pytest(\s|$)/.test(stripped)) return 'test';
  if (/^go\s+test(\s|$)/.test(stripped)) return 'test';
  if (/^cargo\s+test(\s|$)/.test(stripped)) return 'test';
  if (/^mvn(\s+\S+)*\s+test(\s|$)/.test(stripped)) return 'test';
  if (/^gradle(\s+\S+)*\s+test(\s|$)/.test(stripped)) return 'test';
  if (/^gradlew(\s+\S+)*\s+test(\s|$)/.test(stripped)) return 'test';
  // npm test / npm run test / yarn test / pnpm test (already stripped to bare `test`)
  if (/^npm\s+test(\s|$)/.test(stripped)) return 'test';
  if (/^npm\s+run\s+test(\s|$)/.test(stripped)) return 'test';
  // After yarn/pnpm strip, bare `test` is a test command
  if (/^test(\s|$)/.test(stripped) && stripped.startsWith('test')) {
    // Only treat bare `test` as test category if it came from a runner strip.
    // Heuristic: bare `test` in this position came from yarn/pnpm/npx stripping,
    // which is the common case. The risk of mis-classifying a shell `test`
    // builtin (rare in dev workflow) is acceptable — and the worst case is the
    // caller gets a category='test' with undefined pass/fail, not a crash.
    return 'test';
  }

  // build
  if (/^npm\s+run\s+build(\s|$)/.test(stripped)) return 'build';
  if (/^npm\s+run\s+(compile|bundle|pack)(\s|$)/.test(stripped)) return 'build';
  if (/^tsc(\s|$)/.test(stripped)) return 'build';
  if (/^webpack(\s|$)/.test(stripped)) return 'build';
  if (/^rollup(\s|$)/.test(stripped)) return 'build';
  if (/^vite\s+build(\s|$)/.test(stripped)) return 'build';
  if (/^esbuild(\s|$)/.test(stripped)) return 'build';
  if (/^cargo\s+build(\s|$)/.test(stripped)) return 'build';
  if (/^go\s+build(\s|$)/.test(stripped)) return 'build';
  if (/^mvn(\s+\S+)*\s+(package|install|compile)(\s|$)/.test(stripped)) return 'build';
  if (/^gradle(\s+\S+)*\s+(build|assemble|installDist)(\s|$)/.test(stripped)) return 'build';
  if (/^gradlew(\s+\S+)*\s+(build|assemble|installDist)(\s|$)/.test(stripped)) return 'build';
  // After runner strip, bare `build` (from yarn build / pnpm build)
  if (/^build(\s|$)/.test(stripped)) return 'build';

  // lint
  if (/^eslint(\s|$)/.test(stripped)) return 'lint';
  if (/^prettier(\s|$)/.test(stripped)) return 'lint';
  if (/^ruff(\s|$)/.test(stripped)) return 'lint';
  if (/^flake8(\s|$)/.test(stripped)) return 'lint';
  if (/^golangci-lint(\s|$)/.test(stripped)) return 'lint';
  if (/^rubocop(\s|$)/.test(stripped)) return 'lint';
  if (/^npm\s+run\s+lint(\s|$)/.test(stripped)) return 'lint';
  if (/^npm\s+run\s+(check|format)(\s|$)/.test(stripped)) return 'lint';
  // After runner strip, bare `lint`
  if (/^lint(\s|$)/.test(stripped)) return 'lint';

  return null;
}

// ─── stdout parsing ────────────────────────────────────────────────────────

/**
 * Parse pass/fail test counts from a test runner's stdout.
 *
 * Supports the common formats we see in the wild:
 *   - vitest / jest: "Tests  32 passed (32)" / "Tests: 5 passed, 1 failed"
 *   - mocha / karma: "X passing (Ys)" / "X failing"
 *   - maven surefire: "Tests run: 12, Failures: 0, Errors: 0"
 *   - pytest: "12 passed in 3.2s" / "10 passed, 2 failed in 3.2s"
 *   - go test: "ok\tpkg\t0.5s" (no counts) / "FAIL\tpkg\t0.5s"
 *   - cargo test: "test result: ok. 3 passed; 0 failed"
 *   - gradle test: "Tests: 42, Failures: 0" or "BUILD SUCCESSFUL"
 *
 * Returns undefined for both pass and fail when the format is unrecognized
 * (caller still gets category='test', just without counts).
 */
function parseTestCounts(stdout: string): { pass?: number; fail?: number } | null {
  if (!stdout) return null;

  let pass: number | undefined;
  let fail: number | undefined;

  // vitest / jest — "X passed" / "X failed" (may appear in "Test Files" and
  // "Tests" lines; take the LAST match which is usually the per-test count).
  const vitestPassed = stdout.match(/(\d+)\s+passed/gi);
  const vitestFailed = stdout.match(/(\d+)\s+failed/gi);
  if (vitestPassed) {
    const last = vitestPassed[vitestPassed.length - 1]!.match(/(\d+)/);
    if (last) pass = parseInt(last[1]!, 10);
  }
  if (vitestFailed) {
    const last = vitestFailed[vitestFailed.length - 1]!.match(/(\d+)/);
    if (last) fail = parseInt(last[1]!, 10);
  }

  // jest style — "Tests: 5 passed, 1 failed"
  const jestPassed = stdout.match(/Tests:\s*(\d+)\s+passed/i);
  if (jestPassed) pass = parseInt(jestPassed[1]!, 10);
  const jestFailed = stdout.match(/Tests:\s*\d+\s+passed,?\s*(\d+)\s+failed/i);
  if (jestFailed) fail = parseInt(jestFailed[1]!, 10);

  // mocha — "X passing (Ys)" / "X failing"
  const mochaPassing = stdout.match(/(\d+)\s+passing/i);
  if (mochaPassing) pass = parseInt(mochaPassing[1]!, 10);
  const mochaFailing = stdout.match(/(\d+)\s+failing/i);
  if (mochaFailing) fail = parseInt(mochaFailing[1]!, 10);

  // maven surefire — multiple "Tests run:" lines (one per test class) plus a
  // final summary line under "Results:". The summary is the LAST "Tests run:"
  // match in the output, with the aggregated Failures/Errors that follow it.
  // We pair the last Tests-run count with the Failures/Errors counts that
  // appear in the same line or the trailing Results block.
  const mavenTestsRuns = stdout.match(/Tests run:\s*(\d+)/gi);
  if (mavenTestsRuns && mavenTestsRuns.length > 0) {
    const lastRunMatch = mavenTestsRuns[mavenTestsRuns.length - 1]!.match(/(\d+)/);
    const total = lastRunMatch ? parseInt(lastRunMatch[1]!, 10) : 0;
    // Find Failures/Errors in the last "Tests run:" line — look for the line
    // containing the summary. The summary line typically has all three counts.
    const summaryLine = stdout.split('\n').reverse().find(
      l => /Tests run:/i.test(l) && /Failures:/i.test(l),
    );
    const failMatch = summaryLine?.match(/Failures:\s*(\d+)/i);
    const errMatch = summaryLine?.match(/Errors:\s*(\d+)/i);
    const fails = (failMatch ? parseInt(failMatch[1]!, 10) : 0)
      + (errMatch ? parseInt(errMatch[1]!, 10) : 0);
    pass = total - fails;
    fail = fails;
  }

  // pytest — "12 passed in 3.2s" / "10 passed, 2 failed in 3.2s"
  const pytestPassed = stdout.match(/(\d+)\s+passed(?:,|$|\s)/i);
  if (pytestPassed && pass === undefined) pass = parseInt(pytestPassed[1]!, 10);
  const pytestFailed = stdout.match(/(\d+)\s+failed(?:,|$|\s)/i);
  if (pytestFailed && fail === undefined) fail = parseInt(pytestFailed[1]!, 10);

  // cargo test — "test result: ok. 3 passed; 0 failed"
  const cargoPassed = stdout.match(/test result:.*?(\d+)\s+passed/i);
  if (cargoPassed && pass === undefined) pass = parseInt(cargoPassed[1]!, 10);
  const cargoFailed = stdout.match(/test result:.*?(\d+)\s+failed/i);
  if (cargoFailed && fail === undefined) fail = parseInt(cargoFailed[1]!, 10);

  // gradle — "Tests: 42, Failures: 0" (sometimes appears)
  const gradleTests = stdout.match(/Tests:\s*(\d+)/i);
  const gradleFailures = stdout.match(/Failures:\s*(\d+)/i);
  if (gradleTests && pass === undefined) {
    const total = parseInt(gradleTests[1]!, 10);
    const fails = gradleFailures ? parseInt(gradleFailures[1]!, 10) : 0;
    pass = total - fails;
    if (fail === undefined) fail = fails;
  }

  // If we found a pass count but no explicit failure count, the run is all-pass
  // — default fail=0 so callers see a clean {pass, fail} pair. This applies to
  // pytest ("12 passed"), mocha-style ("5 passing"), etc.
  if (pass !== undefined && fail === undefined) {
    fail = 0;
  }

  if (pass === undefined && fail === undefined) return null;
  return { pass, fail };
}

/**
 * Parse error/warning counts from a linter's stdout.
 *
 *   - eslint: "✖ 3 problems (2 errors, 1 warning)"
 *   - prettier --check: "[warn] src/foo.ts" (count = number of [warn] lines)
 *   - ruff: "Found 5 errors."
 *
 * pass = files/problems with no error, fail = error count. When only warnings
 * are present (no errors), pass = 1, fail = 0 (lint "passed" with warnings).
 */
function parseLintCounts(stdout: string): { pass?: number; fail?: number } | null {
  if (!stdout) return null;

  let fail: number | undefined;

  // eslint — "X problems (Y errors, Z warnings)" or "Y errors"
  const eslintProblems = stdout.match(/(\d+)\s+problems?\s*\((\d+)\s+errors?/i);
  if (eslintProblems) {
    fail = parseInt(eslintProblems[2]!, 10);
  } else {
    const eslintErrors = stdout.match(/(\d+)\s+errors?/i);
    if (eslintErrors) fail = parseInt(eslintErrors[1]!, 10);
  }

  // ruff — "Found X errors."
  const ruffErrors = stdout.match(/Found\s+(\d+)\s+errors?/i);
  if (ruffErrors && fail === undefined) fail = parseInt(ruffErrors[1]!, 10);

  // flake8 — count lines, each formatted as path:line:col: CODE message
  if (fail === undefined) {
    const flake8Lines = stdout.split('\n').filter(l => /^[^\s:]+:\d+:\d+:\s/.test(l)).length;
    if (flake8Lines > 0) fail = flake8Lines;
  }

  // golangci-lint — count lines that look like findings
  if (fail === undefined) {
    const gclLines = stdout.split('\n').filter(l => /\.(go|ts|js):\d+:/.test(l)).length;
    if (gclLines > 0) fail = gclLines;
  }

  if (fail === undefined) return null;
  return {
    pass: fail === 0 ? 1 : 0,
    fail,
  };
}
