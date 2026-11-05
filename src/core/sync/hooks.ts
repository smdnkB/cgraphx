/**
 * sync 的 agent hook 入口(spec §4.1 自动触发、§4.4 员工感知、§8 hook 预算)。
 *
 * 两个隐藏命令共用的规则:
 *   - CGRAPHX_NO_TIMELINE 生效时直接返回:不读 stdin、不输出、不拉起进程;
 *   - 项目根按会话登记认(spec D6):整个会话按开始的那个项目判断,中途 cd 到别处也不换;登记读不到时以
 *     agent 给的项目目录环境变量(没有再用 payload.cwd)为起点现认一次;
 *   - stdin 非 JSON 对象、认不出根、数据位置拿不到、未接入平台时静默返回;
 *   - 拉起的 worker 按这个根跑;锁、存活标记、触发文件在数据位置,同一项目的各个目录共用一个 worker;
 *   - 不发网络请求、不等待子进程:拉起 detached worker 后立即返回;
 *   - 任何异常吞掉,只写 stderr `[sync] …`,退出码恒为 0。
 *
 * Stop / SessionEnd(`sync-stop-hook`):stdout 恒空,不打开 sync 的库,只做文件检查。
 * SessionStart(`sync-session-start-hook`):读一次 `sync_state.status`,暂停 / 连续失败时
 * 向 stdout 输出一行 `hookSpecificOutput` 提示,随后同样尝试拉起 worker。
 */

import fs from 'node:fs';
import path from 'node:path';

import type { AgentProfile } from '../agents';
import { getDataDir } from '../data-location';
import { sessionRootOf } from '../session-registry';
import { isKillSwitchOn } from '../timeline';
import { readConnection } from './connection';
import { FAIL_NOTICE_MS, HOOK_PERF_WARN_MS, PAUSE_NOTICES, TRIGGER_FILENAME, TRIGGER_THROTTLE_MS } from './constants';
import { SyncNotInitializedError } from './errors';
import { isWorkerAlive } from './lock';
import { openSyncDbForRead } from './schema-bootstrap';
import { spawnSyncWorker } from './spawn';
import { emptyStatus, getStatus } from './store';
import type { SyncStatusState } from './types';

/** Stop / SessionEnd 共用:节流通过且无存活 worker 时拉起后台同步。 */
export async function syncStopHook(profile: AgentProfile): Promise<void> {
  await runSyncHook(profile, (projectRoot, dataDir) => {
    triggerWorker(projectRoot, dataDir);
  });
}

/** SessionStart:暂停 / 连续失败超时时注入一行提示,然后同 Stop hook 尝试拉起后台同步。 */
export async function syncSessionStartHook(profile: AgentProfile): Promise<void> {
  await runSyncHook(profile, (projectRoot, dataDir) => {
    const notice = sessionStartNotice(readStatus(projectRoot), Date.now());
    if (notice !== null) {
      process.stdout.write(
        JSON.stringify({ hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext: notice } }) + '\n',
      );
    }
    triggerWorker(projectRoot, dataDir);
  });
}

// ─── 共用骨架 ───────────────────────────────────────────────────────────────

/** 关闭开关 → stdin → 会话的根 → 数据位置 → 已接入;全部满足才交给 handler。 */
async function runSyncHook(
  profile: AgentProfile,
  handler: (projectRoot: string, dataDir: string) => void,
): Promise<void> {
  const start = Date.now();
  if (isKillSwitchOn()) return;

  try {
    const raw = await readStdinJson();
    if (raw === null) return;
    const cwd = typeof raw.cwd === 'string' && raw.cwd ? raw.cwd : process.cwd();
    const sessionId = typeof raw.session_id === 'string' ? raw.session_id : null;
    const projectRoot = sessionRootOf(sessionId, registrationStart(profile, cwd))?.root ?? null;
    if (projectRoot === null) return;
    const dataDir = getDataDir(projectRoot);
    if (dataDir === null) return;
    if (readConnection(projectRoot) === null) return;
    handler(projectRoot, dataDir);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    process.stderr.write(`[sync] hook 失败(已忽略,不影响会话):${msg}\n`);
  }

  const durationMs = Date.now() - start;
  if (durationMs > HOOK_PERF_WARN_MS) {
    process.stderr.write(`[sync] hook 耗时 ${durationMs}ms(超出 ${HOOK_PERF_WARN_MS}ms 预算)\n`);
  }
}

/** 会话登记读不到时认根的起点(spec D6):agent 给的项目目录环境变量(projectDirEnv),没有再用 payload.cwd。 */
function registrationStart(profile: AgentProfile, cwd: string): string {
  const fromEnv = process.env[profile.projectDirEnv]?.trim();
  return fromEnv !== undefined && fromEnv !== '' ? fromEnv : cwd;
}

/** 读 stdin 到 EOF 并解析为 JSON 对象;交互终端、空输入、解析失败、非对象都返回 null。 */
async function readStdinJson(): Promise<Record<string, unknown> | null> {
  if (process.stdin.isTTY) return null;
  const text = await new Promise<string>((resolve) => {
    let data = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (chunk) => { data += chunk; });
    process.stdin.on('end', () => resolve(data));
    process.stdin.on('error', () => resolve(data));
  });
  if (!text.trim()) return null;
  try {
    const parsed: unknown = JSON.parse(text);
    return parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

// ─── 拉起与提示 ─────────────────────────────────────────────────────────────

/** 节流窗口内或已有存活 worker 时不拉起;否则 touch 数据目录里的触发文件并拉起 detached worker。 */
function triggerWorker(projectRoot: string, dataDir: string): void {
  const triggerPath = path.join(dataDir, TRIGGER_FILENAME);
  const now = Date.now();
  try {
    if (now - fs.statSync(triggerPath).mtimeMs < TRIGGER_THROTTLE_MS) return;
  } catch {
    // 触发文件不存在:视为节流已过
  }
  // worker 尾随睡眠期间仍存活,不重复拉起
  if (isWorkerAlive(projectRoot)) return;

  fs.writeFileSync(triggerPath, '');
  spawnSyncWorker(projectRoot);
}

/** 读同步状态;库或 sync 的表还没有(SyncNotInitializedError)按全空处理,不提示。 */
function readStatus(projectRoot: string): SyncStatusState {
  let conn: ReturnType<typeof openSyncDbForRead>;
  try {
    conn = openSyncDbForRead(projectRoot);
  } catch (err) {
    if (err instanceof SyncNotInitializedError) return emptyStatus();
    throw err;
  }
  try {
    return getStatus(conn.getDb());
  } finally {
    conn.close();
  }
}

/** 暂停优先;否则连续失败超过 FAIL_NOTICE_MS 提示;都不满足返回 null。 */
function sessionStartNotice(status: SyncStatusState, now: number): string | null {
  if (status.pausedReason !== null) {
    return `平台上报已暂停:${PAUSE_NOTICES[status.pausedReason]}。本地照常记录,恢复后自动补传。`;
  }
  if (status.failingSince !== null) {
    const since = Date.parse(status.failingSince);
    if (Number.isFinite(since) && now - since > FAIL_NOTICE_MS) {
      return (
        `平台上报已连续失败超过 1 小时(最近错误:${status.lastError ?? '-'}),本地数据已保留;` +
        '可运行 cgraphx sync now 重试。'
      );
    }
  }
  return null;
}
