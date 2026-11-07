/**
 * 本地库的一次性数据迁移。
 *
 * 2.0 移除了 cgraphx 1.x 得名所由来的代码图谱层。1.x 下初始化的项目,本地 `.cgraphx/cgraphx.db` 里还留着
 * 图谱表——已无人读写,而且往往很大:`nodes` / `edges` / `files` / `unresolved_refs`、FTS5 索引 `nodes_fts`
 * (连同它的影子表),以及图谱层的 `project_metadata` 和不带前缀的 `schema_versions`。`dropLegacyGraphTables`
 * 只删这几张,2.0 的 `markdown_*` 等前缀表原样保留(2.0 的版本表都带前缀,如 `markdown_schema_versions`、
 * `timeline_schema_versions`,从不用不带前缀的 `schema_versions`)。
 *
 * 1.x 遗留表只会在本地库里(数据位置改到用户目录之前,库都在本地),所以固定清本地库(spec:2026-11-05-
 * 数据按项目放用户目录 D8)。
 */

import * as fs from 'node:fs';
import { DatabaseConnection, getLocalDatabasePath } from './index';

/**
 * 2.0 重构后无人读写的 1.x 图谱表(出自已删除的 `src/db/schema.sql`)。`nodes_fts` 是 FTS5 虚表,排在最前,
 * 先于它的内容表 `nodes` 删除;DROP TABLE 它会连带删掉影子表(nodes_fts_data / _idx / _content / _docsize / _config)。
 */
const LEGACY_GRAPH_TABLES = [
  'nodes_fts',
  'nodes',
  'edges',
  'files',
  'unresolved_refs',
  'project_metadata',
  'schema_versions',
] as const;

export interface LegacyGraphCleanup {
  /** 原本在、已删掉的图谱表。 */
  dropped: string[];
}

/**
 * 删掉项目本地 `.cgraphx/cgraphx.db` 里无人读写的 1.x 图谱表。
 *
 * 幂等且开销小——表删过以后、以及 2.0 新建的项目(本来就没有)都是空操作。只删已知的图谱表名(从不「删光所有
 * 非 2.0 的表」),现在和以后的 `markdown_*` / 各子系统前缀表都安全。
 *
 * @returns 原本在、已删掉的图谱表(一张都没有,或项目还没有本地 `.cgraphx/cgraphx.db` 时为空)。
 */
export function dropLegacyGraphTables(projectRoot: string): LegacyGraphCleanup {
  const dbPath = getLocalDatabasePath(projectRoot);
  if (!fs.existsSync(dbPath)) return { dropped: [] };

  const conn = DatabaseConnection.open(dbPath);
  try {
    const db = conn.getDb();
    const dropped: string[] = [];
    for (const table of LEGACY_GRAPH_TABLES) {
      // table 来自固定的 LEGACY_GRAPH_TABLES 常量,直接拼进 SQL 是安全的(没有用户输入)
      const row = db.prepare(
        `SELECT name FROM sqlite_master WHERE type = 'table' AND name = '${table}'`,
      ).get() as { name: string } | undefined;
      if (row) {
        db.prepare(`DROP TABLE "${table}"`).run();
        dropped.push(table);
      }
    }
    return { dropped };
  } finally {
    conn.close();
  }
}
