/**
 * web 服务启动预检(契约,顺序固定)。
 *
 * 承载启动预检序列的前三步;第四步(回环绑定 listen)在 server.ts,因为
 * 它需要 http server 实例。切分见 plan「允许局部适配」。
 *
 * 只读契约(spec §4.1 / §11 #3):web 进程不创建、不迁移、不写入 DB。
 * 因此:
 *   - 存在性检查(第 1 步)必须先于 `DatabaseConnection.open` —— open 会
 *     创建 DB 文件,顺序颠倒即违反只读契约;
 *   - 绝不 `ensureMarkdownSchema` / `ensureTimelineSchema`(那是 cgraphx
 *     install 的职责),schema 存在性走 sqlite_master 直查。
 *
 * 副本(spec D24):返回的连接只给知识库查询用(ctx.db),用副本自己的本地库;时间线、
 * 任务数据在主目录的共用库里,由各页面经 timeline、task 门面自己开。所以副本里分两个库预检:
 * 共用库先查存在再开(open 会在目录不在时建目录,主目录挪走后会在旧位置建出 `.cgraphx/`),
 * 只查 timeline schema,查完关掉;本地库查 markdown schema。
 */

import * as fs from 'node:fs';
import * as path from 'node:path';

import { isInitialized, resolveDataDir } from '../core/directory';
import { DatabaseConnection, getDatabasePath, getLocalDatabasePath } from '../core/db';
import { WebStartupError } from './errors';

/** 预检要查的 schema 与各自的版本表。 */
const SCHEMA_VERSION_TABLES = {
  markdown: 'markdown_schema_versions',
  timeline: 'timeline_schema_versions',
} as const;

type SchemaName = keyof typeof SCHEMA_VERSION_TABLES;

/**
 * 一条 SELECT 直查 sqlite_master,返回 schemas 里缺版本表的那几个(按传入顺序)。
 * 查询出错时先关掉连接再抛(不泄漏连接)。
 */
function findMissingSchemas(
  connection: DatabaseConnection,
  schemas: readonly SchemaName[],
): SchemaName[] {
  const names = schemas.map((s) => `'${SCHEMA_VERSION_TABLES[s]}'`).join(',');
  try {
    const rows = connection
      .getDb()
      .prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name IN (${names})`)
      .all() as { name: string }[];
    const present = new Set(rows.map((r) => r.name));
    return schemas.filter((s) => !present.has(SCHEMA_VERSION_TABLES[s]));
  } catch (err) {
    connection.close();
    throw err;
  }
}

/**
 * 执行启动预检第 1–3 步并返回已打开的进程级单连接(知识库连接)。
 *
 * 1. `isInitialized` 存在性检查(先于 open,只读契约;看本地库);
 * 2. `DatabaseConnection.open` 打开进程级单连接(DB 已确保存在,不创建文件);
 * 3. sqlite_master 直查 `markdown_schema_versions` / `timeline_schema_versions`,
 *    缺失集合非空 → 抛 `WebStartupError { kind: 'schema-missing', missing }`。
 *
 * 主目录里共用库就是本地库,开这一个库、一条 SELECT 查两套 schema。副本里共用库不在
 * → 抛 `WebStartupError { kind: 'uninitialized' }`(主目录不在了,spec D31),不 open;
 * 在 → 开它只查 timeline schema,查完关掉,再开本地库查 markdown schema 并返回。
 *
 * 任一预检失败都不泄漏连接(失败前已打开的会在抛出前关闭)。
 */
export function openVerifiedConnection(projectRoot: string): DatabaseConnection {
  const resolved = path.resolve(projectRoot);

  // 第 1 步:存在性预检(必须先于 open —— open 会创建 DB 文件)。
  if (!isInitialized(resolved)) {
    throw new WebStartupError(
      'uninitialized',
      `project at ${resolved} is not initialized — run \`cgraphx install\` to set up .cgraphx/ and schemas`,
    );
  }

  const dataDbPath = getDatabasePath(resolved);
  const localDbPath = getLocalDatabasePath(resolved);

  if (localDbPath === dataDbPath) {
    // 第 2 步:进程级单连接(DB 必存在,open 不创建文件)。
    const connection = DatabaseConnection.open(dataDbPath);
    // 第 3 步:schema 存在性检查(sqlite_master 直查,只读 SELECT)。
    const missing = findMissingSchemas(connection, ['markdown', 'timeline']);
    if (missing.length > 0) {
      connection.close();
      throw new WebStartupError(
        'schema-missing',
        `schema missing at ${resolved}: ${missing.join(', ')} — run \`cgraphx install\` to apply schemas`,
        { missing },
      );
    }
    return connection;
  }

  // 副本:共用库先查存在再开 —— 不在就是主目录挪走了,open 会在旧位置建出 `.cgraphx/`。
  const { mainRoot } = resolveDataDir(resolved);
  if (!fs.existsSync(dataDbPath)) {
    throw new WebStartupError('uninitialized', `副本关联的主项目不在 ${mainRoot} 了`);
  }
  const dataConnection = DatabaseConnection.open(dataDbPath);
  const timelineMissing = findMissingSchemas(dataConnection, ['timeline']);
  dataConnection.close();

  // 知识库连接:本地库(第 1 步已确认存在)。
  const connection = DatabaseConnection.open(localDbPath);
  const missing = [...findMissingSchemas(connection, ['markdown']), ...timelineMissing];
  if (missing.length > 0) {
    connection.close();
    const where = (s: SchemaName): string => (s === 'timeline' ? mainRoot : resolved);
    throw new WebStartupError(
      'schema-missing',
      `schema missing: ${missing.map((s) => `${s} at ${where(s)}`).join(', ')} — run \`cgraphx install\` to apply schemas`,
      { missing },
    );
  }
  return connection;
}
