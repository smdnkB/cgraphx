-- task 子系统 schema(与 timeline / markdown 共用 .cgraphx/cgraphx.db,表前缀 task_)。
-- spec §3.1。全部 IF NOT EXISTS,可重复应用。

CREATE TABLE IF NOT EXISTS task_schema_versions (
  version INTEGER PRIMARY KEY,
  applied_at INTEGER NOT NULL,
  description TEXT
);

INSERT OR IGNORE INTO task_schema_versions (version, applied_at, description)
VALUES (1, strftime('%s', 'now') * 1000, 'Initial task schema');

CREATE TABLE IF NOT EXISTS task_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source TEXT NOT NULL CHECK (source IN ('api', 'manual')),
  external_id TEXT,
  name TEXT NOT NULL,
  url TEXT,
  status TEXT,
  raw TEXT, -- JSON
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS task_items_api_external_idx
  ON task_items(external_id) WHERE source = 'api';
CREATE UNIQUE INDEX IF NOT EXISTS task_items_manual_name_idx
  ON task_items(name) WHERE source = 'manual';

CREATE TABLE IF NOT EXISTS task_sessions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id TEXT NOT NULL,
  task_id INTEGER NOT NULL REFERENCES task_items(id),
  bound_at TEXT NOT NULL,
  unbound_at TEXT,
  bind_source TEXT NOT NULL CHECK (bind_source IN ('cli', 'feature_dir'))
);

-- 同一会话最多一条生效绑定(存储层强制)。
CREATE UNIQUE INDEX IF NOT EXISTS task_sessions_open_idx
  ON task_sessions(session_id) WHERE unbound_at IS NULL;
CREATE INDEX IF NOT EXISTS task_sessions_task_idx ON task_sessions(task_id);

-- 自动绑定提醒去重:同一会话内同一组 (已绑定任务, 改动所属任务) 只提醒一次。内部实现表。
CREATE TABLE IF NOT EXISTS task_reminders (
  session_id TEXT NOT NULL,
  bound_task_id INTEGER NOT NULL,
  other_task_id INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (session_id, bound_task_id, other_task_id)
);
