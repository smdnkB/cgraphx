/**
 * 轮次记录:把 user_prompt hook 生成的 turn_id 传给同一轮里的 pre / post / stop hook。
 *
 * 每个 hook 都是独立的短生命周期进程,没有共享内存,所以借文件传递。文件按会话隔离:
 * `<数据目录>/turns/<安全会话名>.json`,并行会话各写各的,互不覆盖;内容为 `{turn_id, session_id, ts}`。
 * 数据目录按会话的根定(基础层 data-location.ts 的 locateDataAtRoot):旧库模式是根的本地 `.cgraphx/`,其余是
 * 用户目录里这个项目的目录。会话中途 cd 到别处也用会话的根,轮次记录不跟着换地方。
 *
 * 只在已在的数据目录里建 `turns/`,不建数据目录本身(项目目录只经基础层建目录的入口建)。数据位置拿不到或目录
 * 不在时,读返回 null,写和删什么都不做。读取方容忍文件缺失 / 损坏(返回 null,duration_ms enricher 随之空转),
 * 写入 / 删除失败只写 stderr —— 任何情况都不阻塞 hook。
 */

import * as fs from 'node:fs';
import * as path from 'node:path';

import { locateDataAtRoot } from '../data-location';
import { safeSessionName } from '../session-registry';

export { safeSessionName } from '../session-registry';

/** 旧版全项目共享的 turn 状态文件名。新逻辑不再读写,只由 install 清理。 */
export const LEGACY_TURN_STATE_FILENAME = 'timeline-current-turn.json';

/** 轮次记录目录(相对数据目录)。 */
export const TURNS_DIRNAME = 'turns';

/** 会话的根的数据目录;拿不到 → null。 */
function dataDirOf(root: string): string | null {
  return locateDataAtRoot(root).dataDir;
}

/** 本会话轮次记录的路径;数据位置拿不到 → null。读、写、删都经这里取。 */
export function turnStateFilePath(root: string, session_id: string | null): string | null {
  const dataDir = dataDirOf(root);
  return dataDir === null ? null : path.join(dataDir, TURNS_DIRNAME, `${safeSessionName(session_id)}.json`);
}

function isDirectory(dir: string): boolean {
  try {
    return fs.statSync(dir).isDirectory();
  } catch {
    return false;
  }
}

/**
 * 读取指定会话当前的 turn_id。root 是会话的根(已知根)。
 *
 * 数据位置拿不到、文件缺失、JSON 损坏、或文件里记录的 session_id 与调用方不一致(安全会话名
 * 哈希撞车等极端情况)时返回 null。调用方 session_id 为 null 时接受文件内容。
 */
export async function readCurrentTurnId(
  session_id: string | null,
  root: string,
): Promise<string | null> {
  try {
    const filePath = turnStateFilePath(root, session_id);
    if (filePath === null) return null;
    const content = await fs.promises.readFile(filePath, 'utf8');
    const data = JSON.parse(content) as {
      turn_id?: string;
      session_id?: string | null;
      ts?: string;
    };
    if (session_id !== null && data.session_id !== session_id) return null;
    return data.turn_id ?? null;
  } catch {
    // 文件缺失 / 不可读 / JSON 损坏 —— 静默返回 null,下游平滑降级。
    return null;
  }
}

/**
 * 写入本会话当前的 turn 状态(整文件覆盖)。root 是会话的根(已知根)。
 * 数据目录拿不到或不在时不写;失败只写 stderr:turn 文件丢了只影响 duration_ms 与 turn 归属,user_prompt
 * 事件照常记录。
 */
export function writeCurrentTurn(
  root: string,
  turn: { turn_id: string; session_id: string | null; ts?: string },
): void {
  const payload = {
    turn_id: turn.turn_id,
    session_id: turn.session_id,
    ts: turn.ts ?? new Date().toISOString(),
  };
  try {
    const dataDir = dataDirOf(root);
    if (dataDir === null || !isDirectory(dataDir)) return;
    const turnsDir = path.join(dataDir, TURNS_DIRNAME);
    try {
      // 不带 recursive:数据目录这时被删掉也只会失败,不会把它建回来
      fs.mkdirSync(turnsDir);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'EEXIST') throw err;
    }
    fs.writeFileSync(path.join(turnsDir, `${safeSessionName(turn.session_id)}.json`), JSON.stringify(payload), { flag: 'w' });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    process.stderr.write(`[timeline] turn-state write failed: ${msg}\n`);
  }
}

/** 删除本会话的 turn 状态文件。数据位置拿不到、文件不存在就忽略,其它失败只写 stderr。 */
export function removeTurnState(root: string, session_id: string | null): void {
  try {
    const filePath = turnStateFilePath(root, session_id);
    if (filePath === null) return;
    fs.rmSync(filePath, { force: true });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    process.stderr.write(`[timeline] turn-state remove failed: ${msg}\n`);
  }
}
