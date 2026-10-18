-- task 子系统 schema(与 timeline / markdown 共用 .cgraphx/cgraphx.db,表前缀 task_)。
-- spec §3.1。全部 IF NOT EXISTS,可重复应用。
-- 只加表不升版本:旧版全局 cgraphx 兼容(旧二进制只跑自己的 schema.sql,新表不影响)。

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

-- 目录任务:一个产出目录对应一个任务,feature_id 即任务键;id 从 1000000001 起与 task_items 隔离。
CREATE TABLE IF NOT EXISTS task_feature_tasks (
  id INTEGER PRIMARY KEY,
  feature_id TEXT NOT NULL UNIQUE,
  platform_task_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- 会话自动绑定派生结果:每会话一行,feature_id 为空表示派生无结果;derived_max_event_id 用于增量刷新。
CREATE TABLE IF NOT EXISTS task_auto_sessions (
  session_id TEXT PRIMARY KEY,
  derived_max_event_id INTEGER NOT NULL,
  feature_id TEXT,
  strength TEXT CHECK (strength IN ('read', 'write')),
  bound_at TEXT,
  stopped_at TEXT,
  derived_at TEXT NOT NULL
);

-- 被取代的旧绑定:首轮历史派生时标记,不删除、不改 task_sessions 原行。
CREATE TABLE IF NOT EXISTS task_superseded_bindings (
  binding_id INTEGER PRIMARY KEY REFERENCES task_sessions(id),
  superseded_at TEXT NOT NULL
);

-- 自动绑定派生元信息:键值对,目前只记 history_pass_done(首轮历史派生是否完成)。
CREATE TABLE IF NOT EXISTS task_auto_meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
