import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { ensureDataDirAtRoot } from '../../../src/core/data-location';
import { DatabaseConnection, DATABASE_FILENAME } from '../../../src/core/db';
import { openSessionIndex } from '../../../src/core/session-index';
import { ensureTimelineSchema, ensureTimelineUpToDate } from '../../../src/core/timeline';

const WINDOWS_CWD = 'D:\\objects\\java\\hy\\flowable-zqassis-service';

function sessionLine(sessionId: string, cwd: string): string {
  return `${JSON.stringify({
    type: 'user',
    sessionId,
    cwd,
    timestamp: '2026-11-01T08:00:00.000Z',
    uuid: `${sessionId}-prompt`,
    message: { role: 'user', content: '开始' },
  })}\n`;
}

describe.skipIf(process.platform === 'win32')('时间线补录:开始目录不是本机绝对路径', () => {
  const originalCwd = process.cwd();
  let root: string;
  let dataDir: string;
  let sessionsDir: string;

  /** 项目库:记下当前根,rebuilt 为真时写记号,让补录直接走增量。 */
  function seedProjectDb(rebuilt: boolean): void {
    const conn = DatabaseConnection.open(path.join(dataDir, DATABASE_FILENAME));
    const db = conn.getDb();
    ensureTimelineSchema(db);
    db.prepare('INSERT INTO timeline_roots (root, first_ts, last_ts) VALUES (?, ?, ?)').run(
      root,
      '2026-01-01T00:00:00.000Z',
      '2026-01-01T00:00:00.000Z',
    );
    if (rebuilt) {
      db.prepare('INSERT INTO timeline_meta (key, value) VALUES (?, ?)').run('rebuilt_at', '2026-01-01T00:00:00.000Z');
    }
    conn.close();
  }

  function eventCwds(): string[] {
    const conn = DatabaseConnection.open(path.join(dataDir, DATABASE_FILENAME));
    const rows = conn.getDb().prepare('SELECT DISTINCT cwd FROM timeline_events ORDER BY cwd').all() as Array<{ cwd: string }>;
    conn.close();
    return rows.map((row) => row.cwd);
  }

  beforeEach(() => {
    fs.rmSync(path.join(os.homedir(), '.cgraphx'), { recursive: true, force: true });
    sessionsDir = path.join(os.homedir(), '.claude', 'projects', '-any-project');
    fs.rmSync(path.dirname(sessionsDir), { recursive: true, force: true });
    fs.mkdirSync(sessionsDir, { recursive: true });

    root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'cgx-foreign-start-')));
    execFileSync('git', ['init', '-q'], { cwd: root });
    fs.mkdirSync(path.join(root, '.cgraphx'));
    DatabaseConnection.open(path.join(root, '.cgraphx', DATABASE_FILENAME)).close(); // 装过的目录才建项目目录
    const dir = ensureDataDirAtRoot(root);
    if (dir === null) throw new Error('项目目录没建出来');
    dataDir = dir;
    // 错归的条件:进程当前目录就在根下,Windows 路径被 path.resolve 拼到这里
    process.chdir(root);
  });

  afterEach(() => {
    process.chdir(originalCwd);
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('全量重建不收 Windows 开始目录的会话,已删目录的本机会话照旧收', async () => {
    seedProjectDb(false);
    const goneCwd = path.join(root, 'gone-subdir');
    fs.writeFileSync(path.join(sessionsDir, 'foreign.jsonl'), sessionLine('foreign', WINDOWS_CWD));
    fs.writeFileSync(path.join(sessionsDir, 'local.jsonl'), sessionLine('local', goneCwd));

    const outcome = await ensureTimelineUpToDate(root);

    expect(outcome.status).toBe('rebuilt');
    expect(eventCwds()).toEqual([goneCwd]);
  });

  it('增量补录不信 start_dirs 里已写错的 Windows 行,也不改这一行', async () => {
    seedProjectDb(true);
    const poisoned = { cwd: WINDOWS_CWD, root, name: null, project_dir: path.basename(dataDir) };
    const before = openSessionIndex();
    before.saveStartDir(poisoned);
    const classifiedAt = before.getStartDir(WINDOWS_CWD)?.classified_at;
    before.close();
    const foreignFile = path.join(sessionsDir, 'foreign.jsonl');
    fs.writeFileSync(foreignFile, sessionLine('foreign', WINDOWS_CWD));

    const outcome = await ensureTimelineUpToDate(root);

    expect(outcome.status).toBe('synced');
    expect(eventCwds()).toEqual([]);
    const after = openSessionIndex();
    expect(after.getSessionFile(foreignFile)).toMatchObject({ start_cwd: WINDOWS_CWD, project_dir: null, byte_offset: 0 });
    expect(after.getStartDir(WINDOWS_CWD)).toMatchObject({ ...poisoned, classified_at: classifiedAt });
    after.close();
  });
});
