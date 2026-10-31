-- Developer Timeline schema (independent of cgraphx main schema_versions).
-- Spec §2.1.

CREATE TABLE IF NOT EXISTS timeline_schema_versions (
  version INTEGER PRIMARY KEY,
  applied_at INTEGER NOT NULL,
  description TEXT
);

INSERT OR IGNORE INTO timeline_schema_versions (version, applied_at, description)
VALUES (1, strftime('%s', 'now') * 1000, 'Initial timeline schema');

INSERT OR IGNORE INTO timeline_schema_versions (version, applied_at, description)
VALUES (2, strftime('%s', 'now') * 1000, 'Add agent column');

CREATE TABLE IF NOT EXISTS timeline_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ts TEXT NOT NULL,
  session_id TEXT,
  event_type TEXT NOT NULL,
  tool_name TEXT,
  tool_args TEXT,
  tool_result_summary TEXT,
  prompt_text TEXT,
  duration_ms INTEGER,
  commit_hash TEXT,
  commit_message TEXT,
  commit_files TEXT,
  cwd TEXT NOT NULL,
  metadata TEXT,
  turn_id TEXT,
  commit_insertions INTEGER,
  commit_deletions INTEGER,
  agent TEXT
);

CREATE INDEX IF NOT EXISTS timeline_events_ts_idx ON timeline_events(ts);
CREATE INDEX IF NOT EXISTS timeline_events_type_idx ON timeline_events(event_type);
CREATE INDEX IF NOT EXISTS timeline_events_tool_name_idx ON timeline_events(tool_name);
CREATE INDEX IF NOT EXISTS timeline_events_session_idx ON timeline_events(session_id);
CREATE INDEX IF NOT EXISTS idx_timeline_turn_id ON timeline_events(turn_id);

-- 迁移水位等内部状态(如 auto_message 存量改记的扫描进度)。键值表,不占版本号:
-- 升版本号会让比它旧的全局 cgraphx 打开库时报错、hook 不再记录(spec 2026-10-31)。
CREATE TABLE IF NOT EXISTS timeline_meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
