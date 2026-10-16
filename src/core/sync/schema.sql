-- sync 子系统 schema(与 timeline / task / markdown 共用 .cgraphx/cgraphx.db,表前缀 sync_)。
-- 全部 IF NOT EXISTS,可重复应用。回滚:删除 sync_* 四张表。

-- 1. 版本表
CREATE TABLE IF NOT EXISTS sync_schema_versions (
  version INTEGER PRIMARY KEY,
  applied_at INTEGER NOT NULL,
  description TEXT
);

INSERT OR IGNORE INTO sync_schema_versions (version, applied_at, description)
VALUES (1, strftime('%s', 'now') * 1000, 'Initial sync schema');

-- 2. 键值状态:只允许 connection / status 两个键;value 为 JSON。不存 token。
CREATE TABLE IF NOT EXISTS sync_state (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL, -- JSON
  updated_at TEXT NOT NULL
);

-- 3. 每个上报会话的进度与隔离标记
CREATE TABLE IF NOT EXISTS sync_sessions (
  client_session_id TEXT PRIMARY KEY,
  last_event_id INTEGER NOT NULL DEFAULT 0,
  bindings_hash TEXT,
  extras_hash TEXT,
  pending_push INTEGER NOT NULL DEFAULT 0,
  uploaded_at TEXT,
  isolated_reason TEXT,
  isolated_client_version TEXT
);

-- 4. cgraphx docs 写入的精确参考
CREATE TABLE IF NOT EXISTS sync_reference_records (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('concept', 'file')),
  value TEXT NOT NULL,
  ts TEXT NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS sync_reference_records_uniq
  ON sync_reference_records(session_id, kind, value);
CREATE INDEX IF NOT EXISTS sync_reference_records_session_idx
  ON sync_reference_records(session_id);
