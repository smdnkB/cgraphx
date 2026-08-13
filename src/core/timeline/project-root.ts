/**
 * timeline 项目根解析 —— 五个 hook 与查询/安装命令的统一入口。
 *
 * 背景(spec:2026-08-13-timeline项目根回溯修复):Claude Code 会话的工作
 * 目录会随 agent `cd` 漂移,旧实现把「当前目录」直接当项目根,导致子目录
 * 下散落 `.cgraphx/`、事件丢失、turn 链断裂。
 *
 * 规则:从解析起点逐级向上,第一个「已初始化」目录(`.cgraphx/cgraphx.db`
 * 存在)即项目根,就近优先(monorepo 子项目根不被仓库级根吞并);到文件
 * 系统根仍无命中则回退起点本身 —— 未初始化路径行为与旧版完全一致。
 *
 * 用 DB 文件而非裸 `.cgraphx/` 目录做标记:cwd 漂移 bug 时代散落的碎片
 * 目录(仅 turn 文件、无 DB)会被跳过并继续向上找到真根 —— 存量碎片在
 * 清理执行前即自愈,不依赖清理先跑。
 */

import * as fs from 'node:fs';
import * as path from 'node:path';

import { getDatabasePath } from '../db';

/** 目录是否「已初始化」:`.cgraphx/cgraphx.db` 文件存在。 */
function isInitializedRoot(dir: string): boolean {
  try {
    return fs.statSync(getDatabasePath(dir)).isFile();
  } catch {
    return false;
  }
}

/**
 * 解析 timeline 项目根。任何异常都按「未命中」处理,绝不抛出 ——
 * 解析失败最坏退化为旧版行为(把起点当根),不能阻塞 hook。
 */
export function resolveTimelineProjectRoot(startDir: string): string {
  const start = path.resolve(startDir);
  let current = start;
  // dirname 链在文件系统根自然终止(parent === current);深度上限仅作
  // 防御性兜底,防御性保护不构成行为语义。
  for (let depth = 0; depth < 128; depth++) {
    if (isInitializedRoot(current)) return current;
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return start;
}
