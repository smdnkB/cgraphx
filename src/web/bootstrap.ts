/**
 * web 服务启动预检(契约,顺序固定)。
 *
 * 承载启动预检序列的前三步;第四步(回环绑定 listen)在 server.ts,因为
 * 它需要 http server 实例。切分见 plan「允许局部适配」。
 *
 * 只读契约(spec §4.1 / §11 #3):web 进程不创建、不迁移、不写入 DB。
 * 因此:
 *   - 存在性检查必须先于 `DatabaseConnection.open` —— open 会创建 DB 文件
 *     (目录不在时连目录一起建),顺序颠倒即违反只读契约;
 *   - 绝不 `ensureMarkdownSchema` / `ensureTimelineSchema`(那是 cgraphx
 *     install 的职责),schema 存在性走 sqlite_master 直查。
 *
 * 知识库读本地库;时间线、任务读项目库(旧库模式下两者是同一个文件)。项目库还不在时不报错,
 * 时间线、任务页按没有数据显示(spec:2026-11-05-数据按项目放用户目录 D16)。
 */

import * as fs from 'node:fs';
import * as path from 'node:path';

import { isInitialized } from '../core/directory';
import { locateData } from '../core/data-location';
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
 * 时间线、任务所在的库(旧库模式是本地库,其余是项目库)在不在:路径拿不到或文件不在 → false。
 * 只读,不建目录。页面据此决定调不调 timeline、task 门面(门面在库不在时抛错)。
 */
export function hasDataDatabase(projectRoot: string): boolean {
  const dbPath = getDatabasePath(projectRoot);
  return dbPath !== null && fs.existsSync(dbPath);
}

/**
 * 时间线 schema 缺在哪个库:缺 → 那份库所在的目录;不缺、不查 → null。旧库模式本地库就是数据库,在同一个
 * 连接里查;项目库在 → 先查存在再开,查完关掉;项目库不在 → 不查。
 */
function timelineSchemaGap(localConnection: DatabaseConnection, root: string): string | null {
  if (locateData(root).mode === 'legacy') {
    return findMissingSchemas(localConnection, ['timeline']).length > 0 ? root : null;
  }
  const dataDbPath = getDatabasePath(root);
  if (dataDbPath === null || !fs.existsSync(dataDbPath)) return null;
  const dataConnection = DatabaseConnection.open(dataDbPath);
  try {
    return findMissingSchemas(dataConnection, ['timeline']).length > 0 ? path.dirname(dataDbPath) : null;
  } finally {
    dataConnection.close();
  }
}

/** 缺的 schema 怎么补:知识库表由 docs index 建在本地库,时间线表由 install 建进项目库。 */
function schemaFix(schema: SchemaName, root: string): string {
  return schema === 'markdown' ? `\`cgraphx docs index ${root}\`` : '`cgraphx install`';
}

/**
 * 执行启动预检第 1–3 步并返回已打开的进程级单连接(知识库连接,即本地库)。
 *
 * 1. `isInitialized` 存在性检查(先于 open,只读契约;看本地库);
 * 2. 开本地库,sqlite_master 直查 `markdown_schema_versions`;
 * 3. 查 `timeline_schema_versions`:旧库模式在同一个连接里查;项目库在 → 开它查完关掉;项目库不在 → 不查。
 *    缺失集合非空 → 抛 `WebStartupError { kind: 'schema-missing', missing }`(知识库缺 → `cgraphx docs index <根>`,
 *    时间线缺 → `cgraphx install`)。
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

  // 第 2 步:进程级单连接 = 本地库(第 1 步已确认存在,open 不创建文件);查知识库 schema。
  const connection = DatabaseConnection.open(getLocalDatabasePath(resolved));
  const missing: Array<{ schema: SchemaName; at: string }> = findMissingSchemas(connection, ['markdown']).map(
    (schema) => ({ schema, at: resolved }),
  );

  // 第 3 步:时间线 schema(旧库模式查本地库,项目库模式查项目库)。
  let timelineAt: string | null;
  try {
    timelineAt = timelineSchemaGap(connection, resolved);
  } catch (err) {
    connection.close();
    throw err;
  }
  if (timelineAt !== null) missing.push({ schema: 'timeline', at: timelineAt });

  if (missing.length > 0) {
    connection.close();
    const fixes = missing.map((m) => schemaFix(m.schema, resolved)).join(' and ');
    throw new WebStartupError(
      'schema-missing',
      `schema missing: ${missing.map((m) => `${m.schema} at ${m.at}`).join(', ')} — run ${fixes} to apply schemas`,
      { missing: missing.map((m) => m.schema) },
    );
  }
  return connection;
}
