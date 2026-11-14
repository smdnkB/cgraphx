/** 需求 worktree 的独立存放位置；主目录真实路径区分同名仓库。 */
import { createHash } from 'node:crypto';
import * as os from 'node:os';
import * as path from 'node:path';

import { realpathOr } from './roots';

/** 项目名前缀限制在 120 字节，为分隔符和摘要留出文件名空间。 */
const PROJECT_LABEL_MAX_BYTES = 120;
/** SHA-256 摘要保留 16 个十六进制字符，以 64 位区分同名仓库。 */
const PROJECT_PATH_HASH_HEX_LENGTH = 16;

export function replicaProjectDir(mainRoot: string): string {
  const realMain = realpathOr(mainRoot);
  const hash = createHash('sha256').update(realMain).digest('hex').slice(0, PROJECT_PATH_HASH_HEX_LENGTH);
  // 留足文件系统文件名的字节空间，中文等多字节名称也可用。
  let label = '';
  for (const char of path.basename(realMain)) {
    if (Buffer.byteLength(label + char, 'utf8') > PROJECT_LABEL_MAX_BYTES) break;
    label += char;
  }
  return path.join(os.homedir(), '.cgraphx', 'worktrees', `${label || 'project'}-${hash}`);
}

export function replicaTarget(mainRoot: string, name: string): string {
  return path.join(replicaProjectDir(mainRoot), name);
}
