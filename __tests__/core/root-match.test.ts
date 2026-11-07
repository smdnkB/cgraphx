import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createRootMatcher } from '../../src/core/root-match';

describe('createRootMatcher', () => {
  const originalCwd = process.cwd();
  let root: string;

  beforeEach(() => {
    root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'cgx-root-match-')));
    process.chdir(root);
  });

  afterEach(() => {
    process.chdir(originalCwd);
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('matches an absolute path under a root', () => {
    const matcher = createRootMatcher([root]);
    expect(matcher.match(path.join(root, 'src', 'a.ts'))).toEqual({ root, rel: 'src/a.ts' });
    expect(matcher.match(root, { allowSelf: true })).toEqual({ root, rel: '' });
  });

  it.skipIf(process.platform === 'win32').each([
    ['Windows 盘符路径', 'D:\\objects\\java\\hy\\flowable-zqassis-service'],
    ['Windows 网络路径', '\\\\server\\share\\project'],
    ['相对路径', 'src/a.ts'],
  ])('does not resolve %s against the process cwd', (_label, foreign) => {
    const matcher = createRootMatcher([root]);
    expect(matcher.match(foreign)).toBeNull();
    expect(matcher.match(foreign, { allowSelf: true })).toBeNull();
  });
});
