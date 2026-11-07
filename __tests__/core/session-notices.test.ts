/**
 * 会话提示里的「skill 版本落后」(spec 2026-11-06-会话文件解析替代hooks K18):只看在这个项目里装过
 * cgraphx 的 agent。命令在哪都能跑——没装过的目录、没装过的那家 agent 没有版本记录,不能当成
 * 「2.0.11 之前装的」。
 *
 * 提示记录写在 setup-home 换好的临时用户目录里;项目都建在临时目录。
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';

import { CGRAPHX_SECTION_START } from '../../src/core/agents';
import { emitSessionNotices } from '../../src/core/session-notices';

const SESSION_VARS = ['CLAUDE_CODE_SESSION_ID', 'CODEBUDDY_SESSION_ID'];

let tmp: string;
let savedEnv: Record<string, string | undefined>;
let stderr: string[];

/** 跑一次提示,返回写到 stderr 的内容。 */
function noticesAt(cwd: string, sessionVars: Record<string, string> = {}): string {
  for (const name of SESSION_VARS) delete process.env[name];
  Object.assign(process.env, sessionVars);
  stderr = [];
  emitSessionNotices(cwd);
  return stderr.join('');
}

/** 建一个给 Claude Code 装过 cgraphx 的项目;version 为 null 时不写版本记录(2.0.11 之前装的)。 */
function claudeProject(name: string, version: string | null): string {
  const root = path.join(tmp, name);
  fs.mkdirSync(path.join(root, '.claude'), { recursive: true });
  fs.mkdirSync(path.join(root, '.cgraphx'), { recursive: true });
  fs.writeFileSync(path.join(root, '.claude', 'CLAUDE.md'), `${CGRAPHX_SECTION_START}\nworkflow\n`);
  if (version !== null) {
    fs.writeFileSync(path.join(root, '.claude', 'cgraphx-version.json'), JSON.stringify({ version }));
  }
  return root;
}

beforeEach(() => {
  tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'cg-notices-')));
  savedEnv = Object.fromEntries(SESSION_VARS.map((k) => [k, process.env[k]]));
  vi.spyOn(process.stderr, 'write').mockImplementation((chunk: string | Uint8Array) => {
    stderr.push(String(chunk));
    return true;
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  for (const [k, v] of Object.entries(savedEnv)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe('skill version notice', () => {
  it('says nothing in a directory where cgraphx was never installed', () => {
    const plain = path.join(tmp, 'plain');
    fs.mkdirSync(plain);
    expect(noticesAt(plain)).toBe('');
    expect(noticesAt(plain, { CLAUDE_CODE_SESSION_ID: 'plain-s1' })).toBe('');
  });

  it('says nothing for a CodeBuddy session when only Claude Code is installed', () => {
    const root = claudeProject('claude-only', '2.0.1');
    expect(noticesAt(root, { CODEBUDDY_SESSION_ID: 'cb-s1' })).toBe('');
  });

  it('reports the recorded version when the installed skill is older than the CLI', () => {
    const root = claudeProject('older', '2.0.1');
    expect(noticesAt(root, { CLAUDE_CODE_SESSION_ID: 'old-s1' })).toContain('还是 2.0.1');
    expect(noticesAt(root)).toContain('还是 2.0.1'); // 终端里自己跑:看装过的各家
  });

  it('still reports an install from before version records existed', () => {
    const root = claudeProject('pre-2-0-11', null);
    expect(noticesAt(root)).toContain('2.0.11 之前装的');
  });
});
