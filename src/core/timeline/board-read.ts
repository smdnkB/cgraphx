/**
 * 看板只读查询(2026-11-06-agent看板 D14;plan C-5)
 *
 * 按数据目录只读打开 `<dataDir>/cgraphx.db`,取认任务(K8–K11)与装配(C-12)要用的最小列集合:
 * session_start、user_prompt、git_commit、写/读/Skill 六种工具事件,和标题表全表。写法同 roots.ts 的
 * readDbFile:库文件不在 → null;不应用 schema、不建目录、不写表;json 列的读取一律 json_valid 守卫,
 * 坏行按 NULL 不让一条旧数据炸整个查询。commit_files 在读取侧经 stats.ts 的 parseCommitFiles 统一成
 * 路径数组(含截断存成的 { files, _truncated_count } 形态)。
 *
 * Bash 不取:K11「只在命令文字里出现过的需求路径不算」由列集合天然保证,无需额外逻辑。
 */

import * as fs from 'node:fs';
import * as path from 'node:path';

import { DatabaseConnection, DATABASE_FILENAME, type SqliteDatabase } from '../db';
import { StoreQueryError } from './errors';
import { EVENTS_TABLE, hasTable } from './roots';
import { parseCommitFiles } from './stats';
import { readSessionTitles } from './store';
import type { BoardTimelineData } from './types';

/** 标题表名(与 schema.sql 一致;这里只查它在不在)。 */
const TITLES_TABLE = 'timeline_session_titles';

/** 看板取的工具事件(K9④ 写类 + K10 读 + K9⑤ Skill;Bash 不取,见文件头)。 */
const BOARD_TOOL_NAMES = ['Write', 'Edit', 'MultiEdit', 'NotebookEdit', 'Read', 'Skill'];

/** json 文本列安全取键:列不是合法 JSON(旧数据、截断行)时按 NULL。 */
function jsonExtract(col: string, key: string): string {
  return `CASE WHEN json_valid(${col}) THEN json_extract(${col}, '${key}') ELSE NULL END`;
}

/** 表有没有这一列(PRAGMA,不扫表;未应用 schema 的旧库可能缺 agent 列)。 */
function hasColumn(db: SqliteDatabase, table: string, column: string): boolean {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
  return cols.some((c) => c.name === column);
}

/** 读出来可能不是字符串(json_extract 对非字符串值返回 JSON 文本,理论上还有数字/对象):不是字符串按 NULL。 */
function textOrNull(v: unknown): string | null {
  return typeof v === 'string' ? v : null;
}

interface SessionStartRow { session_id: string; agent: string | null; cwd: string; ts: string }
interface PromptRow { ts: string; session_id: string; prompt_text: string | null }
interface CommitRow { ts: string; session_id: string | null; commit_files: string | null; branch: unknown }
interface ToolRow { ts: string; session_id: string; tool_name: string; file_path: unknown; args: unknown }

function readSessions(db: SqliteDatabase): BoardTimelineData['sessions'] {
  const rows = db
    .prepare(
      'SELECT session_id, agent, cwd, ts FROM timeline_events ' +
        "WHERE event_type = 'session_start' AND session_id IS NOT NULL ORDER BY ts ASC, id ASC",
    )
    .all() as SessionStartRow[];
  // 一个会话只一条(source_key 去重),防旧数据里的重复行:同 id 留最早一条
  const seen = new Set<string>();
  const out: BoardTimelineData['sessions'] = [];
  for (const r of rows) {
    if (seen.has(r.session_id)) continue;
    seen.add(r.session_id);
    out.push({ id: r.session_id, agent: r.agent ?? '', startCwd: r.cwd, ts: r.ts });
  }
  return out;
}

function readPrompts(db: SqliteDatabase): BoardTimelineData['prompts'] {
  const rows = db
    .prepare(
      'SELECT ts, session_id, prompt_text FROM timeline_events ' +
        "WHERE event_type = 'user_prompt' AND session_id IS NOT NULL ORDER BY ts ASC, id ASC",
    )
    .all() as PromptRow[];
  return rows.map((r) => ({ ts: r.ts, sessionId: r.session_id, text: r.prompt_text ?? '' }));
}

function readCommits(db: SqliteDatabase): BoardTimelineData['commits'] {
  const rows = db
    .prepare(
      'SELECT ts, session_id, commit_files, ' +
        `${jsonExtract('metadata', '$.branch')} AS branch ` +
        "FROM timeline_events WHERE event_type = 'git_commit' ORDER BY ts ASC, id ASC",
    )
    .all() as CommitRow[];
  return rows.map((r) => ({
    ts: r.ts,
    sessionId: r.session_id,
    files: parseCommitFiles(r.commit_files),
    branch: textOrNull(r.branch),
  }));
}

function readTools(db: SqliteDatabase): BoardTimelineData['tools'] {
  const rows = db
    .prepare(
      'SELECT ts, session_id, tool_name, ' +
        `${jsonExtract('tool_args', '$.file_path')} AS file_path, ` +
        `CASE WHEN tool_name = 'Skill' AND json_valid(tool_args) ` +
        `THEN json_extract(tool_args, '$.args') ELSE NULL END AS args ` +
        'FROM timeline_events ' +
        "WHERE event_type = 'post_tool_use' AND session_id IS NOT NULL " +
        `AND tool_name IN (${BOARD_TOOL_NAMES.map((n) => `'${n}'`).join(',')}) ` +
        'ORDER BY ts ASC, id ASC',
    )
    .all() as ToolRow[];
  return rows.map((r) => ({
    ts: r.ts,
    sessionId: r.session_id,
    tool: r.tool_name,
    filePath: textOrNull(r.file_path),
    args: textOrNull(r.args),
  }));
}

function readAll(db: SqliteDatabase): BoardTimelineData {
  // 按目录只读打开的旧库可能没被新版写过:事件表不在、或缺 agent 列(补录会补),对应数组按空不报错
  const eventsUsable = hasTable(db, EVENTS_TABLE) && hasColumn(db, EVENTS_TABLE, 'agent');
  return {
    sessions: eventsUsable ? readSessions(db) : [],
    prompts: eventsUsable ? readPrompts(db) : [],
    commits: eventsUsable ? readCommits(db) : [],
    tools: eventsUsable ? readTools(db) : [],
    titles: hasTable(db, TITLES_TABLE) ? readSessionTitles(db) : [],
  };
}

/**
 * 看板的按目录只读读取(plan C-5):`<dataDir>/cgraphx.db` 不在 → null;在则只读打开取五组数据。
 * 看板除补录外不写任何东西——这里同 roots.ts 的 readDbFile,不应用 schema、不建目录。
 *
 * @throws StoreQueryError 表在但查询失败(库坏了)
 */
export function readTimelineBoardData(dataDir: string): BoardTimelineData | null {
  const dbPath = path.join(dataDir, DATABASE_FILENAME);
  if (!fs.existsSync(dbPath)) return null;
  const conn = DatabaseConnection.open(dbPath);
  try {
    try {
      return readAll(conn.getDb());
    } catch (err) {
      throw new StoreQueryError(
        `读 ${dataDir} 的看板数据失败:${err instanceof Error ? err.message : String(err)}`,
      );
    }
  } finally {
    try {
      conn.close();
    } catch {
      // 关不上不影响结果(句柄随进程退出释放)
    }
  }
}
