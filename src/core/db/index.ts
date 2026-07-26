/**
 * Database Base Layer
 *
 * SQLite connection management over the built-in `node:sqlite`. This is the
 * shared, SCHEMA-AGNOSTIC base layer: `open()` creates (or opens) `cgraphx.db`
 * and applies connection-level PRAGMAs, but applies NO schema and runs NO
 * migrations. Subsystems that need tables (markdown, timeline) own their own
 * `ensureSchema` and apply it on top of a connection from `open()`.
 *
 * What was removed vs. the cgraphx 1.x lineage:
 *   - the graph `schema.sql` application (this layer serves non-graph subsystems)
 *   - `runMigrations` / `getCurrentVersion` / `CURRENT_SCHEMA_VERSION`
 *   - the `initialize()` factory (open() now creates-or-opens) and
 *     `getSchemaVersion()` (no shared `schema_versions` table at this layer)
 */

import { SqliteDatabase, SqliteBackend, createDatabase } from './sqlite-adapter';
import * as fs from 'fs';
import * as path from 'path';
import { getCodeGraphDir } from '../directory';

export { SqliteDatabase, SqliteBackend } from './sqlite-adapter';

/**
 * Apply connection-level PRAGMAs.
 *
 * `busy_timeout` is set FIRST, before any pragma that might touch the database
 * file (notably `journal_mode`). If another process holds a write lock at open
 * time, the later pragmas — and the connection's first query — then wait out
 * the lock instead of throwing "database is locked" immediately.
 *
 * The 5s window rides out a normal write; with WAL, reads never block on a
 * writer, so this timeout only governs cross-process write contention.
 */
function configureConnection(db: SqliteDatabase): void {
  db.pragma('busy_timeout = 5000');      // MUST be first — see above
  db.pragma('foreign_keys = ON');
  db.pragma('journal_mode = WAL');       // node:sqlite supports WAL on every platform
  db.pragma('synchronous = NORMAL');     // safe with WAL mode
  db.pragma('cache_size = -64000');      // 64 MB page cache
  db.pragma('temp_store = MEMORY');      // temp tables in memory
  db.pragma('mmap_size = 268435456');    // 256 MB memory-mapped I/O
}

/**
 * Database connection wrapper with lifecycle management. Schema-agnostic — no
 * table is assumed to exist. Use `open()` to get a connection, then have the
 * caller apply its own schema if it needs tables.
 */
export class DatabaseConnection {
  private db: SqliteDatabase;
  private dbPath: string;
  private backend: SqliteBackend;
  /**
   * `dev:ino` of the DB file at the moment we opened it (or null when the
   * platform/filesystem reports no usable inode). Lets us notice when the file
   * we hold open has been unlinked and REPLACED by a new file at the same path
   * — `.cgraphx/` deleted and re-`init`ed under a long-lived process — at which
   * point our fd reads a now-dead inode forever. See `isReplacedOnDisk`.
   */
  private openedInode: string | null;

  private constructor(db: SqliteDatabase, dbPath: string, backend: SqliteBackend) {
    this.db = db;
    this.dbPath = dbPath;
    this.backend = backend;
    this.openedInode = statInode(dbPath);
  }

  /**
   * Open a database at `dbPath`, creating it (and its parent directory) if
   * missing. Applies connection PRAGMAs. Applies NO schema and runs NO
   * migrations — callers that need tables apply their own `ensureSchema`.
   */
  static open(dbPath: string): DatabaseConnection {
    // Ensure parent directory exists so a first-run db can be created.
    const dir = path.dirname(dbPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    const { db, backend } = createDatabase(dbPath);
    configureConnection(db);
    return new DatabaseConnection(db, dbPath, backend);
  }

  /**
   * Get the underlying database instance
   */
  getDb(): SqliteDatabase {
    return this.db;
  }

  /**
   * Get the SQLite backend serving this connection. Per-instance so
   * cross-project queries report the right backend even when multiple project
   * DBs are open in the same process.
   */
  getBackend(): SqliteBackend {
    return this.backend;
  }

  /**
   * Get database file path
   */
  getPath(): string {
    return this.dbPath;
  }

  /**
   * The journal mode actually in effect (e.g. 'wal', 'delete').
   *
   * SQLite silently keeps the prior mode if WAL can't be enabled — e.g. on
   * filesystems without shared-memory support (some network/virtualized mounts,
   * WSL2 /mnt). So the effective mode can differ from what
   * `configureConnection` requested. Surfaced in `cgraphx status` so a
   * "database is locked" report is triageable: 'wal' ⇒ readers never block on
   * a writer; anything else ⇒ they can.
   */
  getJournalMode(): string {
    const raw = this.db.pragma('journal_mode');
    const row = Array.isArray(raw) ? raw[0] : raw;
    const mode = row && typeof row === 'object'
      ? (row as Record<string, unknown>).journal_mode
      : row;
    return String(mode ?? '').toLowerCase();
  }

  /**
   * Execute a function within a transaction
   */
  transaction<T>(fn: () => T): T {
    return this.db.transaction(fn)();
  }

  /**
   * Get database file size in bytes
   */
  getSize(): number {
    const stats = fs.statSync(this.dbPath);
    return stats.size;
  }

  /**
   * Optimize database (vacuum and analyze)
   */
  optimize(): void {
    this.db.exec('VACUUM');
    this.db.exec('ANALYZE');
  }

  /**
   * Lightweight, non-blocking maintenance to run after bulk writes. Two
   * operations:
   *
   *   - `PRAGMA optimize` — incremental ANALYZE; SQLite only re-analyzes tables
   *     whose row counts changed materially since the last ANALYZE.
   *
   *   - `PRAGMA wal_checkpoint(PASSIVE)` — fold pending WAL pages back into the
   *     main database file so the WAL file doesn't grow unboundedly between
   *     automatic checkpoints.
   *
   * Both operations are silently swallowed on failure — they're a best-effort
   * optimization, never load-bearing for correctness.
   */
  runMaintenance(): void {
    try {
      this.db.exec('PRAGMA optimize');
    } catch {
      // ignore
    }
    try {
      this.db.exec('PRAGMA wal_checkpoint(PASSIVE)');
    } catch {
      // ignore (e.g., not in WAL mode)
    }
  }

  /**
   * Close the database connection
   */
  close(): void {
    this.db.close();
  }

  /**
   * Check if the database connection is open
   */
  isOpen(): boolean {
    return this.db.open;
  }

  /**
   * True when the DB file at our path has been REPLACED on disk since we opened
   * it — a different inode now lives at the same path, so the fd we still hold
   * points at a now-unlinked inode that can never receive new writes. The
   * trigger is removing and recreating `.cgraphx/` at the same path under a
   * long-lived process (`rm -rf .cgraphx` + `cgraphx init`). Returns false when
   * the inode is unchanged, when the file is momentarily absent (mid-recreate —
   * nothing to reopen onto yet), or when the platform doesn't report a usable
   * inode (Windows can't unlink an open file and its st_ino is unreliable, so
   * this never fires there).
   */
  isReplacedOnDisk(): boolean {
    if (this.openedInode === null) return false;
    const current = statInode(this.dbPath);
    return current !== null && current !== this.openedInode;
  }
}

/**
 * `dev:ino` for a path, or null if it can't be stat'd or the platform doesn't
 * report a usable inode. Windows st_ino is unreliable across handle reopens, so
 * we deliberately return null there — the deleted-but-open-inode hazard this
 * guards is a POSIX file-semantics issue that doesn't arise on Windows (an open
 * file can't be unlinked).
 */
function statInode(p: string): string | null {
  if (process.platform === 'win32') return null;
  try {
    const s = fs.statSync(p);
    return `${s.dev}:${s.ino}`;
  } catch {
    return null;
  }
}

/**
 * Default database filename
 */
export const DATABASE_FILENAME = 'cgraphx.db';

/**
 * Get the default database path for a project
 */
export function getDatabasePath(projectRoot: string): string {
  return path.join(getCodeGraphDir(projectRoot), DATABASE_FILENAME);
}
