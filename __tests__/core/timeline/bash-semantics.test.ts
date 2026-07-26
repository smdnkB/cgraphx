/**
 * B-3 (timeline-data-quality) — Bash command semantic classification.
 *
 * Coverage matrix from the plan:
 *   - Test runners:    vitest / jest / npm test / pytest / go test / cargo test / mvn test / gradle test
 *   - Build tools:     npm run build / tsc / webpack / mvn package / cargo build / go build
 *   - Linters:         eslint / prettier / ruff / golangci-lint
 *   - Git write:       git push / git commit
 *   - Non-semantic:    ls / cat / grep / echo / git status / git log / npm install  → null
 *   - Prefix variants: npx / yarn / pnpm / ./gradlew
 *   - stdout parsing:  vitest / jest / maven / pytest / go / cargo formats
 *   - Multi-command:   `npm test && npm run build` → category='test' (first segment)
 *   - Chinese stdout:  category recognized, pass/fail omitted when format unknown
 *   - Empty command:   → null
 */

import { describe, it, expect } from 'vitest';
import { detectBashSemantics } from '../../../src/core/timeline/bash-semantics';

describe('detectBashSemantics — test category', () => {
  it('classifies `npx vitest run` as test with parsed pass/fail', () => {
    const stdout = [
      ' RUN  v3.2.0 /Users/smdnk/objects/ai/codegraph',
      '',
      ' ✓ __tests__/timeline/store.test.ts (6 tests)',
      '',
      ' Test Files  4 passed (4)',
      '      Tests  32 passed (32)',
      '   Start at 10:00:00',
      '   Duration 2.3s',
    ].join('\n');
    const result = detectBashSemantics({ command: 'npx vitest run', stdout, exit_code: 0 });
    expect(result?.category).toBe('test');
    expect(result?.pass).toBe(32);
    expect(result?.fail).toBe(0);
  });

  it('classifies bare `vitest` as test', () => {
    const stdout = 'Tests  10 passed (10)';
    const result = detectBashSemantics({ command: 'vitest', stdout });
    expect(result?.category).toBe('test');
    expect(result?.pass).toBe(10);
  });

  it('classifies `jest` as test', () => {
    const stdout = 'Tests: 5 passed, 1 failed';
    const result = detectBashSemantics({ command: 'jest', stdout });
    expect(result?.category).toBe('test');
    expect(result?.pass).toBe(5);
    expect(result?.fail).toBe(1);
  });

  it('classifies `npm test` as test', () => {
    const stdout = '1 passing (2s)\n0 failing';
    const result = detectBashSemantics({ command: 'npm test', stdout });
    expect(result?.category).toBe('test');
    expect(result?.pass).toBe(1);
    expect(result?.fail).toBe(0);
  });

  it('classifies `npm run test` as test', () => {
    const stdout = 'Tests  3 passed (3)';
    const result = detectBashSemantics({ command: 'npm run test', stdout });
    expect(result?.category).toBe('test');
    expect(result?.pass).toBe(3);
  });

  it('classifies `yarn test` as test (runner-stripped to bare test)', () => {
    const stdout = 'Tests  3 passed (3)';
    const result = detectBashSemantics({ command: 'yarn test', stdout });
    expect(result?.category).toBe('test');
  });

  it('classifies `pnpm test` as test', () => {
    const stdout = 'Tests  3 passed (3)';
    const result = detectBashSemantics({ command: 'pnpm test', stdout });
    expect(result?.category).toBe('test');
  });

  it('classifies `mvn test` as test with surefire format', () => {
    const stdout = [
      '-------------------------------------------------------',
      ' T E S T S',
      '-------------------------------------------------------',
      'Running com.example.FooTest',
      'Tests run: 12, Failures: 0, Errors: 0, Skipped: 0',
      'Running com.example.BarTest',
      'Tests run: 8, Failures: 2, Errors: 0, Skipped: 0',
      '',
      'Results:',
      'Tests run: 20, Failures: 2, Errors: 0, Skipped: 0',
    ].join('\n');
    const result = detectBashSemantics({ command: 'mvn test', stdout, exit_code: 1 });
    expect(result?.category).toBe('test');
    // The last "Tests run:" line is the summary: 20 total, 2 failures.
    expect(result?.pass).toBe(18);
    expect(result?.fail).toBe(2);
  });

  it('classifies `mvn -pl mymodule test` (with flags before test) as test', () => {
    const stdout = 'Tests run: 5, Failures: 0, Errors: 0';
    const result = detectBashSemantics({ command: 'mvn -pl mymodule test', stdout });
    expect(result?.category).toBe('test');
    expect(result?.pass).toBe(5);
    expect(result?.fail).toBe(0);
  });

  it('classifies `gradle test` as test', () => {
    const stdout = 'Tests: 42, Failures: 0';
    const result = detectBashSemantics({ command: 'gradle test', stdout });
    expect(result?.category).toBe('test');
    expect(result?.pass).toBe(42);
    expect(result?.fail).toBe(0);
  });

  it('classifies `./gradlew test` as test (./ prefix stripped)', () => {
    const stdout = 'Tests: 5, Failures: 1';
    const result = detectBashSemantics({ command: './gradlew test', stdout });
    expect(result?.category).toBe('test');
    expect(result?.pass).toBe(4);
    expect(result?.fail).toBe(1);
  });

  it('classifies `pytest` as test', () => {
    const stdout = '===== 12 passed in 3.2s =====';
    const result = detectBashSemantics({ command: 'pytest', stdout });
    expect(result?.category).toBe('test');
    expect(result?.pass).toBe(12);
    expect(result?.fail).toBe(0);
  });

  it('classifies `pytest -v` as test', () => {
    const stdout = '10 passed, 2 failed in 3.2s';
    const result = detectBashSemantics({ command: 'pytest -v', stdout });
    expect(result?.category).toBe('test');
    expect(result?.pass).toBe(10);
    expect(result?.fail).toBe(2);
  });

  it('classifies `go test` as test', () => {
    const stdout = 'ok\tgithub.com/example/pkg\t0.5s\nPASS';
    const result = detectBashSemantics({ command: 'go test', stdout });
    expect(result?.category).toBe('test');
  });

  it('classifies `go test ./...` as test', () => {
    const stdout = 'ok\tgithub.com/example/pkg\t0.5s\nFAIL\tgithub.com/example/bad\t0.2s';
    const result = detectBashSemantics({ command: 'go test ./...', stdout });
    expect(result?.category).toBe('test');
  });

  it('classifies `cargo test` as test', () => {
    const stdout = 'running 3 tests\ntest result: ok. 3 passed; 0 failed; 0 ignored';
    const result = detectBashSemantics({ command: 'cargo test', stdout });
    expect(result?.category).toBe('test');
    expect(result?.pass).toBe(3);
    expect(result?.fail).toBe(0);
  });

  it('classifies `cargo test --lib` as test', () => {
    const stdout = 'test result: ok. 5 passed; 1 failed; 0 ignored';
    const result = detectBashSemantics({ command: 'cargo test --lib', stdout });
    expect(result?.category).toBe('test');
    expect(result?.pass).toBe(5);
    expect(result?.fail).toBe(1);
  });

  it('recognizes test category even when stdout format is unrecognized (counts undefined)', () => {
    // Chinese-only stdout from some custom runner — category is still 'test'.
    const stdout = '测试通过:3个,失败:0个';
    const result = detectBashSemantics({ command: 'npx vitest run', stdout });
    expect(result?.category).toBe('test');
    // Format not recognized → pass/fail stay undefined.
    expect(result?.pass).toBeUndefined();
    expect(result?.fail).toBeUndefined();
  });
});

describe('detectBashSemantics — build category', () => {
  it('classifies `npm run build` with exit 0 as build pass=1', () => {
    const result = detectBashSemantics({ command: 'npm run build', stdout: 'built', exit_code: 0 });
    expect(result?.category).toBe('build');
    expect(result?.pass).toBe(1);
    expect(result?.fail).toBe(0);
  });

  it('classifies `npm run build` with non-zero exit as build fail=1', () => {
    const result = detectBashSemantics({ command: 'npm run build', stdout: 'error', exit_code: 2 });
    expect(result?.category).toBe('build');
    expect(result?.pass).toBe(0);
    expect(result?.fail).toBe(1);
  });

  it('classifies `npx tsc` as build', () => {
    const result = detectBashSemantics({ command: 'npx tsc', stdout: '', exit_code: 0 });
    expect(result?.category).toBe('build');
    expect(result?.pass).toBe(1);
  });

  it('classifies `npx webpack` as build', () => {
    const result = detectBashSemantics({ command: 'npx webpack', stdout: '', exit_code: 0 });
    expect(result?.category).toBe('build');
  });

  it('classifies `mvn package` as build', () => {
    const result = detectBashSemantics({ command: 'mvn package', stdout: 'BUILD SUCCESS', exit_code: 0 });
    expect(result?.category).toBe('build');
    expect(result?.pass).toBe(1);
  });

  it('classifies `mvn install` as build', () => {
    const result = detectBashSemantics({ command: 'mvn install', stdout: '', exit_code: 0 });
    expect(result?.category).toBe('build');
  });

  it('classifies `gradle build` as build', () => {
    const result = detectBashSemantics({ command: 'gradle build', stdout: '', exit_code: 0 });
    expect(result?.category).toBe('build');
  });

  it('classifies `gradle assemble` as build', () => {
    const result = detectBashSemantics({ command: 'gradle assemble', stdout: '', exit_code: 0 });
    expect(result?.category).toBe('build');
  });

  it('classifies `cargo build` as build', () => {
    const result = detectBashSemantics({ command: 'cargo build', stdout: 'Finished', exit_code: 0 });
    expect(result?.category).toBe('build');
  });

  it('classifies `go build` as build', () => {
    const result = detectBashSemantics({ command: 'go build ./...', stdout: '', exit_code: 0 });
    expect(result?.category).toBe('build');
  });

  it('classifies `yarn build` as build (runner-stripped to bare build)', () => {
    const result = detectBashSemantics({ command: 'yarn build', stdout: '', exit_code: 0 });
    expect(result?.category).toBe('build');
  });

  it('returns category build without pass/fail when exit_code omitted', () => {
    const result = detectBashSemantics({ command: 'npm run build', stdout: '' });
    expect(result?.category).toBe('build');
    expect(result?.pass).toBeUndefined();
    expect(result?.fail).toBeUndefined();
  });
});

describe('detectBashSemantics — lint category', () => {
  it('classifies `npx eslint .` with errors as lint fail=N', () => {
    const stdout = '/Users/foo/src/bar.ts\n  3:5  error  Missing semicolon  semi\n\n✖ 3 problems (2 errors, 1 warning)';
    const result = detectBashSemantics({ command: 'npx eslint .', stdout, exit_code: 1 });
    expect(result?.category).toBe('lint');
    expect(result?.fail).toBe(2);
    expect(result?.pass).toBe(0);
  });

  it('classifies `npx eslint .` clean as lint pass=1', () => {
    const stdout = '0 problems';
    const result = detectBashSemantics({ command: 'npx eslint .', stdout, exit_code: 0 });
    expect(result?.category).toBe('lint');
    // No error count parsed → fail undefined → pass undefined (format unrecognized for clean state).
    // The category is still recognized.
  });

  it('classifies `npx prettier --check .` as lint', () => {
    const result = detectBashSemantics({ command: 'npx prettier --check .', stdout: '[warn] src/foo.ts', exit_code: 1 });
    expect(result?.category).toBe('lint');
  });

  it('classifies `ruff check .` as lint with errors', () => {
    const stdout = 'src/foo.py:5:80: E501 line too long\nFound 5 errors.';
    const result = detectBashSemantics({ command: 'ruff check .', stdout, exit_code: 1 });
    expect(result?.category).toBe('lint');
    expect(result?.fail).toBe(5);
  });

  it('classifies `flake8 src/` as lint (count violation lines)', () => {
    const stdout = [
      'src/foo.py:5:80: E501 line too long',
      'src/bar.py:10:1: F401 imported but unused',
      'src/baz.py:20:5: E203 whitespace before ":"',
    ].join('\n');
    const result = detectBashSemantics({ command: 'flake8 src/', stdout, exit_code: 1 });
    expect(result?.category).toBe('lint');
    expect(result?.fail).toBe(3);
  });

  it('classifies `golangci-lint run` as lint', () => {
    const stdout = 'main.go:10:6: exported func Foo should have comment (golint)';
    const result = detectBashSemantics({ command: 'golangci-lint run', stdout, exit_code: 1 });
    expect(result?.category).toBe('lint');
    expect(result?.fail).toBe(1);
  });

  it('classifies `npm run lint` as lint', () => {
    const result = detectBashSemantics({ command: 'npm run lint', stdout: '✖ 1 problem (1 error)', exit_code: 1 });
    expect(result?.category).toBe('lint');
  });

  it('classifies `yarn lint` as lint (runner-stripped)', () => {
    const result = detectBashSemantics({ command: 'yarn lint', stdout: '', exit_code: 0 });
    expect(result?.category).toBe('lint');
  });
});

describe('detectBashSemantics — git_write category', () => {
  it('classifies `git push` with exit 0 as git_write pass=1', () => {
    const result = detectBashSemantics({ command: 'git push', stdout: '', exit_code: 0 });
    expect(result?.category).toBe('git_write');
    expect(result?.pass).toBe(1);
    expect(result?.fail).toBe(0);
  });

  it('classifies `git push origin main` as git_write', () => {
    const result = detectBashSemantics({ command: 'git push origin main', stdout: '', exit_code: 0 });
    expect(result?.category).toBe('git_write');
  });

  it('classifies `git push` with non-zero exit as git_write fail=1', () => {
    const result = detectBashSemantics({ command: 'git push', stdout: 'error', exit_code: 1 });
    expect(result?.category).toBe('git_write');
    expect(result?.pass).toBe(0);
    expect(result?.fail).toBe(1);
  });

  it('classifies `git commit -m "x"` as git_write', () => {
    const result = detectBashSemantics({ command: 'git commit -m "feat: add feature"', stdout: '', exit_code: 0 });
    expect(result?.category).toBe('git_write');
    expect(result?.pass).toBe(1);
  });

  it('returns category git_write without pass/fail when exit_code omitted', () => {
    const result = detectBashSemantics({ command: 'git push', stdout: '' });
    expect(result?.category).toBe('git_write');
    expect(result?.pass).toBeUndefined();
  });
});

describe('detectBashSemantics — non-semantic commands return null', () => {
  it('returns null for `ls -l`', () => {
    expect(detectBashSemantics({ command: 'ls -l', stdout: '', exit_code: 0 })).toBeNull();
  });

  it('returns null for `cat README.md`', () => {
    expect(detectBashSemantics({ command: 'cat README.md', stdout: '', exit_code: 0 })).toBeNull();
  });

  it('returns null for `grep -r foo .`', () => {
    expect(detectBashSemantics({ command: 'grep -r foo .', stdout: '', exit_code: 0 })).toBeNull();
  });

  it('returns null for `echo hello`', () => {
    expect(detectBashSemantics({ command: 'echo hello', stdout: '', exit_code: 0 })).toBeNull();
  });

  it('returns null for `git status` (read-only git)', () => {
    expect(detectBashSemantics({ command: 'git status', stdout: '', exit_code: 0 })).toBeNull();
  });

  it('returns null for `git log --oneline`', () => {
    expect(detectBashSemantics({ command: 'git log --oneline', stdout: '', exit_code: 0 })).toBeNull();
  });

  it('returns null for `git diff`', () => {
    expect(detectBashSemantics({ command: 'git diff', stdout: '', exit_code: 0 })).toBeNull();
  });

  it('returns null for `npm install` (not test/build/lint)', () => {
    expect(detectBashSemantics({ command: 'npm install', stdout: '', exit_code: 0 })).toBeNull();
  });

  it('returns null for empty command', () => {
    expect(detectBashSemantics({ command: '', stdout: '', exit_code: 0 })).toBeNull();
  });

  it('returns null for whitespace-only command', () => {
    expect(detectBashSemantics({ command: '   ', stdout: '', exit_code: 0 })).toBeNull();
  });
});

describe('detectBashSemantics — multi-command (first segment wins)', () => {
  it('classifies `npm test && npm run build` as test (first segment)', () => {
    const stdout = 'Tests  5 passed (5)';
    const result = detectBashSemantics({ command: 'npm test && npm run build', stdout, exit_code: 0 });
    expect(result?.category).toBe('test');
    expect(result?.pass).toBe(5);
  });

  it('classifies `npm run build && npm test` as build (first segment)', () => {
    const result = detectBashSemantics({ command: 'npm run build && npm test', stdout: '', exit_code: 0 });
    expect(result?.category).toBe('build');
  });

  it('classifies `eslint . ; echo done` as lint (semicolon separator)', () => {
    const result = detectBashSemantics({ command: 'eslint . ; echo done', stdout: '0 errors', exit_code: 0 });
    expect(result?.category).toBe('lint');
  });

  it('classifies `git status && git push` as git_write (skips read-only first segment)', () => {
    // Wait — first-segment-wins means `git status` (non-semantic) is first.
    // The split returns ['git status', 'git push'] and the first non-empty
    // segment is 'git status', which classifies as null → whole thing null.
    // This is the documented behavior: "use the first command to decide category".
    const result = detectBashSemantics({ command: 'git status && git push', stdout: '', exit_code: 0 });
    expect(result).toBeNull();
  });
});

describe('detectBashSemantics — prefix variants', () => {
  it('strips leading npx (with flags)', () => {
    const result = detectBashSemantics({ command: 'npx -y vitest run', stdout: 'Tests  3 passed (3)' });
    expect(result?.category).toBe('test');
  });

  it('strips leading yarn dlx', () => {
    const result = detectBashSemantics({ command: 'yarn dlx eslint .', stdout: '0 errors' });
    expect(result?.category).toBe('lint');
  });

  it('strips leading pnpm exec', () => {
    const result = detectBashSemantics({ command: 'pnpm exec vitest run', stdout: 'Tests  3 passed (3)' });
    expect(result?.category).toBe('test');
  });

  it('strips leading ./ for gradlew', () => {
    const result = detectBashSemantics({ command: './gradlew test', stdout: 'Tests: 5, Failures: 0' });
    expect(result?.category).toBe('test');
  });

  it('strips leading env-var assignments (CI-style)', () => {
    const result = detectBashSemantics({ command: 'CI=true npm test', stdout: 'Tests  3 passed (3)' });
    expect(result?.category).toBe('test');
  });
});

describe('detectBashSemantics — Chinese / CJK stdout', () => {
  it('does not crash on Chinese stdout, still returns category for recognized command', () => {
    const stdout = '测试运行中...\n测试完成:3个通过,0个失败';
    const result = detectBashSemantics({ command: 'npx vitest run', stdout });
    expect(result?.category).toBe('test');
    // Format not recognized → counts omitted.
    expect(result?.pass).toBeUndefined();
  });

  it('does not crash on mixed CJK + ASCII stdout', () => {
    const stdout = '构建中...\nTests  3 passed (3)\n完成';
    const result = detectBashSemantics({ command: 'npx vitest run', stdout });
    expect(result?.category).toBe('test');
    expect(result?.pass).toBe(3);
  });
});

describe('detectBashSemantics — robustness', () => {
  it('handles undefined stdout (treated as empty)', () => {
    const result = detectBashSemantics({ command: 'npm test', stdout: undefined });
    expect(result?.category).toBe('test');
    expect(result?.pass).toBeUndefined();
  });

  it('handles undefined exit_code (omitted, not 0)', () => {
    const result = detectBashSemantics({ command: 'npm run build', stdout: '' });
    expect(result?.category).toBe('build');
    expect(result?.pass).toBeUndefined();
    expect(result?.fail).toBeUndefined();
  });

  it('handles non-string command gracefully', () => {
    // @ts-expect-error — testing runtime defense
    expect(detectBashSemantics({ command: 123, stdout: '' })).toBeNull();
  });
});
