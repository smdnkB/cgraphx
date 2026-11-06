/**
 * 会话索引库:用户级 `~/.cgraphx/sessions.db`
 *
 * spec:2026-11-06-会话文件解析替代hooks D2、D3、K3。补录进度(session_files)、开始目录归属(start_dirs)、
 * 项目删除记录(removed_projects)、判断过的目录(dirs_checked)、提示记录(notices_shown)的唯一存放;只放路径、
 * 会话编号、进度,不放会话内容。项目按名字认(spec:2026-11-06-项目按名称认 D1、D7):removed_projects 的键就是
 * 项目名字;start_dirs 只记名字、根与项目目录,地址那列留着不读写。
 * 进度不随项目数据删(D2):`project remove` 只写 removed_projects、偏移不动;改名只清 start_dirs,已经记下的不挪。
 *
 * 基础层定位:不 import 任何子系统。建表 SQL 就写在本文件(幂等 CREATE TABLE IF NOT EXISTS),
 * 不新增随包资产;sessions.db 是 cgraphx 自身基础设施,不走 data-standards 的版本表机制(spec 全局约束)。
 * 并发写入安全靠 SQLite 自身(busy_timeout 沿用基础层 5 秒);和项目库是两个库,别在项目库事务里碰它(跨库无法同事务)。
 */

import * as fs from 'node:fs';
import * as path from 'node:path';

import { DatabaseConnection, type SqliteDatabase } from './db';
import type { ProjectIdentity } from './project-identity';
import { userDataRoot } from './user-data-dir';

/** 库文件名(在 userDataRoot() 下,与旧会话登记目录 `sessions/` 不冲突)。 */
const SESSIONS_DB_FILENAME = 'sessions.db';

/** sessions.db 的权限:里面有项目根路径,只给自己看(Windows 照默认)。 */
const PRIVATE_FILE_MODE = 0o600;

/** notices_shown 里超过 30 天的记录打开时删掉(spec D16)。 */
const NOTICE_TTL_MS = 30 * 24 * 3600_000;

/** 建表 SQL(幂等;五表列名钉死,见 spec「sessions.db 数据格式」)。 */
const SCHEMA_SQL = `
  CREATE TABLE IF NOT EXISTS session_files (
    path        TEXT PRIMARY KEY,
    agent       TEXT NOT NULL,
    session_id  TEXT,
    start_cwd   TEXT,
    project_dir TEXT,
    byte_offset INTEGER NOT NULL DEFAULT 0,
    size        INTEGER NOT NULL DEFAULT 0,
    mtime_ms    INTEGER NOT NULL DEFAULT 0,
    updated_at  TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS session_files_agent_idx ON session_files(agent);

  CREATE TABLE IF NOT EXISTS start_dirs (
    cwd           TEXT PRIMARY KEY,
    root          TEXT,
    origin        TEXT, -- 旧列,不再读写
    name          TEXT,
    project_dir   TEXT,
    classified_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS removed_projects (
    identity_key TEXT PRIMARY KEY,
    removed_at   TEXT NOT NULL
  );

  -- 判断过的目录(spec:2026-11-06-项目按名称认 D7):走完重名判断才写一行,不过期
  CREATE TABLE IF NOT EXISTS dirs_checked (
    root       TEXT PRIMARY KEY,
    checked_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS notices_shown (
    scope     TEXT PRIMARY KEY,
    shown_at  TEXT NOT NULL
  );
`;

/** session_files 的一行:一个会话文件一份进度(子 agent 文件的 start_cwd 跟主会话)。 */
export interface SessionFileRow {
  path: string;
  agent: string;
  session_id: string | null;
  start_cwd: string | null;
  project_dir: string | null;
  byte_offset: number;
  size: number;
  mtime_ms: number;
  updated_at: string;
}

/** start_dirs 的一行:一个开始目录认到的项目(认不到的字段留空)。 */
export interface StartDirRow {
  cwd: string;
  root: string | null;
  name: string | null;
  project_dir: string | null;
  classified_at: string;
}

/** 库里读出的原始行(INTEGER 列可能是 bigint,经 Number() 收敛)。 */
interface SessionFileRaw extends Omit<SessionFileRow, 'byte_offset' | 'size' | 'mtime_ms'> {
  byte_offset: number | bigint;
  size: number | bigint;
  mtime_ms: number | bigint;
}

function toSessionFileRow(raw: SessionFileRaw): SessionFileRow {
  return {
    path: raw.path,
    agent: raw.agent,
    session_id: raw.session_id ?? null,
    start_cwd: raw.start_cwd ?? null,
    project_dir: raw.project_dir ?? null,
    byte_offset: Number(raw.byte_offset),
    size: Number(raw.size),
    mtime_ms: Number(raw.mtime_ms),
    updated_at: raw.updated_at,
  };
}

function realpathOrResolve(p: string): string {
  try {
    return fs.realpathSync(p);
  } catch {
    return path.resolve(p);
  }
}

/** sessions.db 的读写门面:openSessionIndex() 打开,用完 close;不跨命令共享连接。 */
export class SessionIndex {
  private readonly conn: DatabaseConnection;
  private readonly db: SqliteDatabase;

  // 经 openSessionIndex() 构造(建库、建表、清理都在那里);TS 没有 internal,
  // 构造器保持可见,外部仍请走 openSessionIndex。
  constructor(conn: DatabaseConnection) {
    this.conn = conn;
    this.db = conn.getDb();
  }

  close(): void {
    this.conn.close();
  }

  // ─── session_files ────────────────────────────────────────────────────────

  /** 这个 agent 的全部会话文件进度(按路径排序,结果稳定)。 */
  listSessionFiles(agent: string): SessionFileRow[] {
    const rows = this.db
      .prepare('SELECT * FROM session_files WHERE agent = ? ORDER BY path')
      .all(agent) as SessionFileRaw[];
    return rows.map(toSessionFileRow);
  }

  /** 按文件路径取一行;没有 → null。 */
  getSessionFile(file: string): SessionFileRow | null {
    const raw = this.db
      .prepare('SELECT * FROM session_files WHERE path = ?')
      .get(file) as SessionFileRaw | undefined;
    return raw === undefined ? null : toSessionFileRow(raw);
  }

  /** 写一行进度(path 主键,整行覆盖;updated_at 取当前时间)。 */
  saveSessionFile(row: Omit<SessionFileRow, 'updated_at'>): void {
    this.db
      .prepare(
        `INSERT OR REPLACE INTO session_files
           (path, agent, session_id, start_cwd, project_dir, byte_offset, size, mtime_ms, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        row.path,
        row.agent,
        row.session_id,
        row.start_cwd,
        row.project_dir,
        row.byte_offset,
        row.size,
        row.mtime_ms,
        new Date().toISOString(),
      );
  }

  // ─── start_dirs ───────────────────────────────────────────────────────────

  /** 按开始目录取一行;没有 → null。 */
  getStartDir(cwd: string): StartDirRow | null {
    const raw = this.db
      .prepare('SELECT cwd, root, name, project_dir, classified_at FROM start_dirs WHERE cwd = ?')
      .get(cwd) as StartDirRow | undefined;
    return raw === undefined ? null : raw;
  }

  /** 写一行归属(cwd 主键,整行覆盖;classified_at 取当前时间)。 */
  saveStartDir(row: Omit<StartDirRow, 'classified_at'>): void {
    this.db
      .prepare(
        `INSERT OR REPLACE INTO start_dirs
           (cwd, root, name, project_dir, classified_at)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .run(row.cwd, row.root, row.name, row.project_dir, new Date().toISOString());
  }

  /**
   * 清掉认到这些根的开始目录行(改名后用,下次补录重新认;偏移在 session_files,不动)。
   * 根按 realpath 比(写法同原 rewriteSessionRegistrations,链接解析不一致也对得上);返回清了几行。
   */
  deleteStartDirsByRoots(roots: readonly string[]): number {
    const targets = new Set(roots.map(realpathOrResolve));
    const rows = this.db
      .prepare('SELECT cwd, root FROM start_dirs')
      .all() as Array<{ cwd: string; root: string | null }>;
    const doomed = rows
      .filter((row) => row.root !== null && targets.has(realpathOrResolve(row.root)))
      .map((row) => row.cwd);
    if (doomed.length === 0) return 0;
    const del = this.db.prepare('DELETE FROM start_dirs WHERE cwd = ?');
    this.db.transaction(() => {
      for (const cwd of doomed) del.run(cwd);
    })();
    return doomed.length;
  }

  // ─── removed_projects ─────────────────────────────────────────────────────

  /** 记一个删掉的项目(K3;键就是项目名字,同一个项目重复删,时间刷新)。 */
  recordRemovedProject(id: ProjectIdentity): void {
    this.db
      .prepare('INSERT OR REPLACE INTO removed_projects (identity_key, removed_at) VALUES (?, ?)')
      .run(id.name, new Date().toISOString());
  }

  /** 这个项目删过没有;删过 → removed_at,没删过 → null。 */
  removedProjectAt(id: ProjectIdentity): string | null {
    const row = this.db
      .prepare('SELECT removed_at FROM removed_projects WHERE identity_key = ?')
      .get(id.name) as { removed_at: string } | undefined;
    return row === undefined ? null : row.removed_at;
  }

  // ─── dirs_checked ─────────────────────────────────────────────────────────

  /** 这个根的重名判断什么时候做过;没做过 → null。 */
  dirCheckedAt(root: string): string | null {
    const row = this.db
      .prepare('SELECT checked_at FROM dirs_checked WHERE root = ?')
      .get(root) as { checked_at: string } | undefined;
    return row === undefined ? null : row.checked_at;
  }

  /** 记下这个根的重名判断做过了(root 主键,重复判断刷新时间)。 */
  recordDirChecked(root: string): void {
    this.db
      .prepare('INSERT OR REPLACE INTO dirs_checked (root, checked_at) VALUES (?, ?)')
      .run(root, new Date().toISOString());
  }

  // ─── notices_shown ────────────────────────────────────────────────────────

  /** 这个 scope 的提示上回什么时候给过;没给过 → null。 */
  noticeShownAt(scope: string): string | null {
    const row = this.db
      .prepare('SELECT shown_at FROM notices_shown WHERE scope = ?')
      .get(scope) as { shown_at: string } | undefined;
    return row === undefined ? null : row.shown_at;
  }

  /** 记下这个 scope 的提示给过了(scope 主键,重复给刷新时间)。 */
  recordNoticeShown(scope: string): void {
    this.db
      .prepare('INSERT OR REPLACE INTO notices_shown (scope, shown_at) VALUES (?, ?)')
      .run(scope, new Date().toISOString());
  }
}

/**
 * 打开(或建)sessions.db:建目录、应用幂等建表、收紧到 0600、顺手删 30 天前的提示记录。
 * WAL、busy_timeout 5 秒沿用基础层。
 */
export function openSessionIndex(): SessionIndex {
  const dbPath = path.join(userDataRoot(), SESSIONS_DB_FILENAME);
  const conn = DatabaseConnection.open(dbPath);
  try {
    conn.getDb().exec(SCHEMA_SQL);
    if (process.platform !== 'win32') fs.chmodSync(dbPath, PRIVATE_FILE_MODE);
    conn.getDb()
      .prepare('DELETE FROM notices_shown WHERE shown_at < ?')
      .run(new Date(Date.now() - NOTICE_TTL_MS).toISOString());
  } catch (err) {
    conn.close();
    throw err;
  }
  return new SessionIndex(conn);
}
