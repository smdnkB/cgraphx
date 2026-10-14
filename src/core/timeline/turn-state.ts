/**
 * turn 状态文件:把 user_prompt hook 生成的 turn_id 传给同一轮里的
 * pre / post / stop hook。
 *
 * 每个 Claude Code hook 都是独立的短生命周期进程,没有共享内存,所以借文件传递。
 * 文件按会话隔离:`<projectRoot>/.cgraphx/turns/<安全会话名>.json`,并行会话
 * 各写各的,互不覆盖。内容格式为 `{turn_id, session_id, ts}`。
 *
 * 读取方容忍文件缺失 / 损坏(返回 null,duration_ms enricher 随之空转),
 * 写入 / 删除失败只写 stderr —— 任何情况都不阻塞 hook。
 */

import { createHash } from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';

/** 旧版全项目共享的 turn 状态文件名。新逻辑不再读写,只由 install 清理。 */
export const LEGACY_TURN_STATE_FILENAME = 'timeline-current-turn.json';

/** turn 状态目录(相对 `.cgraphx/`)。 */
const TURNS_DIRNAME = 'turns';

/** session_id 为 null 时使用的文件名。 */
const NO_SESSION_NAME = '_nosession';

const SAFE_SESSION_NAME_RE = /^[A-Za-z0-9_-]+$/;

/**
 * 会话 id → 可安全用作文件名的会话名。
 * 只含 `[A-Za-z0-9_-]` 时原样使用;否则取 sha1 hex 前 16 位;null 用 `_nosession`。
 */
export function safeSessionName(session_id: string | null): string {
  if (session_id === null) return NO_SESSION_NAME;
  if (SAFE_SESSION_NAME_RE.test(session_id)) return session_id;
  return createHash('sha1').update(session_id).digest('hex').slice(0, 16);
}

export function turnStateFilePath(projectRoot: string, session_id: string | null): string {
  return path.join(projectRoot, '.cgraphx', TURNS_DIRNAME, `${safeSessionName(session_id)}.json`);
}

/**
 * 读取指定会话当前的 turn_id。
 *
 * 文件缺失、JSON 损坏、或文件里记录的 session_id 与调用方不一致(安全会话名
 * 哈希撞车等极端情况)时返回 null。调用方 session_id 为 null 时接受文件内容。
 */
export async function readCurrentTurnId(
  session_id: string | null,
  projectRoot: string,
): Promise<string | null> {
  try {
    const content = await fs.promises.readFile(turnStateFilePath(projectRoot, session_id), 'utf8');
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
 * 写入本会话当前的 turn 状态(整文件覆盖)。
 * 失败只写 stderr:turn 文件丢了只影响 duration_ms 与 turn 归属,user_prompt 事件照常记录。
 */
export function writeCurrentTurn(
  projectRoot: string,
  turn: { turn_id: string; session_id: string | null; ts?: string },
): void {
  const payload = {
    turn_id: turn.turn_id,
    session_id: turn.session_id,
    ts: turn.ts ?? new Date().toISOString(),
  };
  try {
    const filePath = turnStateFilePath(projectRoot, turn.session_id);
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, JSON.stringify(payload), { flag: 'w' });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    process.stderr.write(`[timeline] turn-state write failed: ${msg}\n`);
  }
}

/** 删除本会话的 turn 状态文件。不存在就忽略,其它失败只写 stderr。 */
export function removeTurnState(projectRoot: string, session_id: string | null): void {
  try {
    fs.rmSync(turnStateFilePath(projectRoot, session_id), { force: true });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    process.stderr.write(`[timeline] turn-state remove failed: ${msg}\n`);
  }
}
