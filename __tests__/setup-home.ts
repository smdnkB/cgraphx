/**
 * 测试一律用临时 HOME:timeline、task、sync 的数据和会话登记放在用户目录(`~/.cgraphx/`),测试不能碰真实家目录。
 *
 * vitest 的 setupFiles 每个测试文件跑一次,各测试文件各用各的临时 HOME;测试派生的子进程继承这里改过的环境变量。
 * 自己改 HOME 的测试(如 `__tests__/core/dbquery/config.test.ts`)照旧在自己的用例里覆盖。
 */

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { afterAll } from 'vitest';

const originalHome = process.env.HOME;
const originalUserProfile = process.env.USERPROFILE;
const originalCodexThreadId = process.env.CODEX_THREAD_ID;
const originalCodexHome = process.env.CODEX_HOME;
delete process.env.CODEX_THREAD_ID;
delete process.env.CODEX_HOME;

const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), 'cgx-home-'));
// os.homedir() 在 POSIX 上读 HOME,在 Windows 上读 USERPROFILE
process.env.HOME = tempHome;
process.env.USERPROFILE = tempHome;

function restoreEnv(key: 'HOME' | 'USERPROFILE' | 'CODEX_THREAD_ID' | 'CODEX_HOME', value: string | undefined): void {
  if (value === undefined) delete process.env[key];
  else process.env[key] = value;
}

afterAll(() => {
  restoreEnv('HOME', originalHome);
  restoreEnv('USERPROFILE', originalUserProfile);
  restoreEnv('CODEX_THREAD_ID', originalCodexThreadId);
  restoreEnv('CODEX_HOME', originalCodexHome);
  fs.rmSync(tempHome, { recursive: true, force: true });
});
