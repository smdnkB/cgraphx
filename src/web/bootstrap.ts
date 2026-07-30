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
 */

import * as path from 'node:path';

import { isInitialized } from '../core/directory';
import { DatabaseConnection, getDatabasePath } from '../core/db';
import { WebStartupError } from './errors';

/**
 * 执行启动预检第 1–3 步并返回已打开的进程级单连接。
 *
 * 1. `isInitialized` 存在性检查(先于 open,只读契约);
 * 2. `DatabaseConnection.open` 打开进程级单连接(DB 已确保存在,不创建文件);
 * 3. sqlite_master 直查 `markdown_schema_versions` / `timeline_schema_versions`,
 *    缺失集合非空 → 抛 `WebStartupError { kind: 'schema-missing', missing }`。
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

  // 第 2 步:进程级单连接(DB 必存在,open 不创建文件)。
  const connection = DatabaseConnection.open(getDatabasePath(resolved));

  // 第 3 步:schema 存在性检查(sqlite_master 直查,只读 SELECT)。
  try {
    const rows = connection
      .getDb()
      .prepare(
        `SELECT name FROM sqlite_master WHERE type='table' AND name IN ('markdown_schema_versions','timeline_schema_versions')`,
      )
      .all() as { name: string }[];
    const present = new Set(rows.map((r) => r.name));
    const missing: ('markdown' | 'timeline')[] = [];
    if (!present.has('markdown_schema_versions')) missing.push('markdown');
    if (!present.has('timeline_schema_versions')) missing.push('timeline');
    if (missing.length > 0) {
      connection.close();
      throw new WebStartupError(
        'schema-missing',
        `schema missing at ${resolved}: ${missing.join(', ')} — run \`cgraphx install\` to apply schemas`,
        { missing },
      );
    }
  } catch (err) {
    // WebStartupError 已自行关连接,透传;其它查询错误先关连接再抛。
    if (err instanceof WebStartupError) throw err;
    connection.close();
    throw err;
  }

  return connection;
}
