/**
 * Bash 命令文本 → 待解析的 (候选基准目录, 片段) 列表(spec §3.1「读」)。
 *
 * sync 的参考推断与 task 的产出目录读识别共用此实现,不得各自复制一份。
 * 纯函数:不读文件系统、不判断目录是否存在。
 */

import path from 'node:path';

/** `cd <目录> && …` / `cd <目录>; …` 前缀。 */
const CD_PREFIX_RE = /^\s*cd\s+("([^"]+)"|'([^']+)'|([^\s;&|]+))\s*(&&|;)/;
/** 命令文本切分符。 */
const TOKEN_SPLIT_RE = /[\s'"`|;&<>()=,]+/;

/**
 * Bash 命令 → 待解析的 (候选基准目录, 片段) 列表。
 *
 * 有 cd 前缀时依次尝试「cwd + cd 目录」与 cwd 本身:宿主记录的 post_tool_use 的 cwd
 * 可能已是 cd 之后的目录(实测 Claude Code 如此),此时前者会多拼一层,退回 cwd 才对。
 */
export function extractCommandPathCandidates(
  command: string,
  cwd: string,
): Array<{ bases: string[]; token: string }> {
  let bases = [cwd];
  let rest = command;
  const m = CD_PREFIX_RE.exec(command);
  if (m !== null) {
    const dir = m[2] ?? m[3] ?? m[4];
    if (dir !== undefined) bases = [path.resolve(cwd, dir), cwd];
    rest = command.slice(m[0].length);
  }
  const result: Array<{ bases: string[]; token: string }> = [];
  for (const token of rest.split(TOKEN_SPLIT_RE)) {
    if (token === '' || token.includes('$')) continue;
    result.push({ bases, token });
  }
  return result;
}
