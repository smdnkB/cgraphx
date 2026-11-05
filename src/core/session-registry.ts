/**
 * 会话登记(spec:2026-11-05-数据按项目放用户目录 D6、D19)
 *
 * 会话开始的 hook 按开始的目录认根和标识,写 `~/.cgraphx/sessions/<安全会话名>.json`;同一会话之后的 hook 按
 * session_id 读它,不看 payload.cwd,会话 cd 到别处也记在开始的那个项目里。登记已在就沿用(resume、compact 是
 * 同一个会话 id,不重写);读不到(升级前已开着的会话、文件坏了)由调用方给起点现认一次补写。会话结束不删,
 * 会话开始的 hook 顺手删掉 7 天没改过的登记。
 *
 * 起点由调用方定:会话开始的 hook 用 payload.cwd;其余 hook 用 agent 给的项目目录环境变量(agents 描述的
 * `projectDirEnv`),没有再用 payload.cwd。
 */

import { createHash } from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';

import { findProjectRoot } from './data-location';
import { identityOfRoot, rememberRootIdentity, type ProjectIdentity } from './project-identity';
import { findProjectDir, sessionsRoot, userDataRoot } from './user-data-dir';

export interface SessionRegistration {
  sessionId: string | null;   // null:payload 没给会话 id,这份登记不落盘
  root: string | null;        // D2 的根;没有根为 null
  origin: string | null;
  name: string | null;
  project: string | null;     // 已建的项目目录名;没有标识、还没建为 null(只作加速,读的一方以标识为准)
  writtenAt: string;
}

/** session_id 为 null 时用的文件名。 */
const NO_SESSION_NAME = '_nosession';
const SAFE_SESSION_NAME_RE = /^[A-Za-z0-9_-]+$/;

/** 登记多久没改过就删(D6)。 */
const REGISTRATION_TTL_MS = 7 * 24 * 3600_000;

/** `sessions/` 的权限:登记里有项目根路径,只给自己看。 */
const PRIVATE_DIR_MODE = 0o700;

/**
 * 会话 id → 可安全用作文件名的会话名:只含 `[A-Za-z0-9_-]` 时原样使用;否则取 sha1 hex 前 16 位;null 用
 * `_nosession`。轮次记录的文件名也用它。
 */
export function safeSessionName(sessionId: string | null): string {
  if (sessionId === null) return NO_SESSION_NAME;
  if (SAFE_SESSION_NAME_RE.test(sessionId)) return sessionId;
  return createHash('sha1').update(sessionId).digest('hex').slice(0, 16);
}

function registrationPath(sessionId: string): string {
  return path.join(sessionsRoot(), `${safeSessionName(sessionId)}.json`);
}

function isStringOrNull(value: unknown): value is string | null {
  return value === null || typeof value === 'string';
}

/** 解析一份登记;字段缺、类型不对 → null。 */
function parseRegistration(raw: unknown): SessionRegistration | null {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return null;
  const { sessionId, root, origin, name, project, writtenAt } = raw as Record<string, unknown>;
  if (typeof sessionId !== 'string' || typeof writtenAt !== 'string') return null;
  if (!isStringOrNull(root) || !isStringOrNull(origin) || !isStringOrNull(name) || !isStringOrNull(project)) return null;
  return { sessionId, root, origin, name, project, writtenAt };
}

function readRegistrationFile(file: string): SessionRegistration | null {
  try {
    return parseRegistration(JSON.parse(fs.readFileSync(file, 'utf8')));
  } catch {
    return null;
  }
}

/** 读这个会话的登记;不在、坏了、里面的会话 id 对不上(安全会话名撞车)→ null。 */
export function readSessionRegistration(sessionId: string): SessionRegistration | null {
  const reg = readRegistrationFile(registrationPath(sessionId));
  return reg !== null && reg.sessionId === sessionId ? reg : null;
}

/** 同目录临时文件 + rename。临时文件名以 `.` 开头、`.json` 结尾:改写时跳过,7 天清理时一并清掉。 */
function writeRegistrationFile(file: string, reg: SessionRegistration): void {
  const tmp = path.join(path.dirname(file), `.${path.basename(file, '.json')}.${process.pid}.${Math.random().toString(36).slice(2)}.json`);
  try {
    fs.writeFileSync(tmp, `${JSON.stringify(reg, null, 2)}\n`);
    fs.renameSync(tmp, file);
  } catch (err) {
    try {
      fs.rmSync(tmp, { force: true });
    } catch {
      // 临时文件删不掉不盖住原来的错误
    }
    throw err;
  }
}

/** `sessions/` 不在就建(0700,Windows 照默认);`~/.cgraphx/` 不在一并建。 */
function ensureSessionsDir(): void {
  const dir = sessionsRoot();
  try {
    if (fs.statSync(dir).isDirectory()) return;
  } catch {
    // 不在,往下建
  }
  fs.mkdirSync(userDataRoot(), { recursive: true });
  try {
    fs.mkdirSync(dir, process.platform === 'win32' ? undefined : { mode: PRIVATE_DIR_MODE });
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'EEXIST') return;
    throw err;
  }
  if (process.platform !== 'win32') fs.chmodSync(dir, PRIVATE_DIR_MODE);
}

function identityOfRegistration(reg: SessionRegistration): ProjectIdentity | null {
  return reg.origin !== null || reg.name !== null ? { origin: reg.origin, name: reg.name } : null;
}

/**
 * spec D6:这个会话的根和标识。读得到登记就原样返回;读不到以 start 为起点认根(findProjectRoot)和标识
 * (identityOfRoot)、写登记再返回;git 出错不写、返回 null。sessionId 为 null 时不读不写,现认后返回。读到或认好
 * 后把标识填进进程内记忆(rememberRootIdentity),之后按根取标识不再跑 git。登记写不上不影响这一次(下一条 hook
 * 再认一次)。
 */
export function sessionRootOf(sessionId: string | null, start: string): SessionRegistration | null {
  if (sessionId !== null) {
    const existing = readSessionRegistration(sessionId);
    if (existing !== null) {
      if (existing.root !== null) rememberRootIdentity(existing.root, identityOfRegistration(existing));
      return existing;
    }
  }
  const root = findProjectRoot(start);
  let identity: ProjectIdentity | null = null;
  if (root !== null) {
    const info = identityOfRoot(root);
    if (info === 'git-error') return null;
    identity = info.identity;
  }
  const reg: SessionRegistration = {
    sessionId,
    root,
    origin: identity?.origin ?? null,
    name: identity?.name ?? null,
    project: identity !== null ? (findProjectDir(identity)?.name ?? null) : null,
    writtenAt: new Date().toISOString(),
  };
  if (sessionId !== null) {
    try {
      ensureSessionsDir();
      writeRegistrationFile(registrationPath(sessionId), reg);
    } catch {
      // 家目录写不了:这一次照样用认好的结果
    }
  }
  if (root !== null) rememberRootIdentity(root, identity);
  return reg;
}

function realpathOrResolve(p: string): string {
  try {
    return fs.realpathSync(p);
  } catch {
    return path.resolve(p);
  }
}

/**
 * spec D19:改名后改写开在受影响的根上的会话登记——root 的 realpath(失败用 path.resolve)等于 roots 里任一个的
 * realpath 的,改写 origin、name、project、writtenAt。返回改写了几份。
 */
export function rewriteSessionRegistrations(
  roots: readonly string[],
  identity: ProjectIdentity,
  project: string | null,
): number {
  const targets = new Set(roots.map(realpathOrResolve));
  const dir = sessionsRoot();
  let files: string[];
  try {
    files = fs.readdirSync(dir);
  } catch {
    return 0;
  }
  let rewritten = 0;
  for (const file of files) {
    if (file.startsWith('.') || !file.endsWith('.json')) continue;
    const full = path.join(dir, file);
    const reg = readRegistrationFile(full);
    if (reg === null || reg.root === null || !targets.has(realpathOrResolve(reg.root))) continue;
    try {
      writeRegistrationFile(full, {
        ...reg,
        origin: identity.origin,
        name: identity.name,
        project,
        writtenAt: new Date().toISOString(),
      });
      rewritten++;
    } catch {
      // 这一份改不了就跳过
    }
  }
  return rewritten;
}

/** spec D6:删掉 `sessions/` 下 mtime 超过 7 天的登记;目录不在什么都不做,任何异常都吞掉。 */
export function cleanupSessionRegistrations(): void {
  try {
    const dir = sessionsRoot();
    const now = Date.now();
    for (const file of fs.readdirSync(dir)) {
      if (!file.endsWith('.json')) continue;
      const full = path.join(dir, file);
      try {
        const stat = fs.lstatSync(full);
        if (stat.isFile() && now - stat.mtimeMs > REGISTRATION_TTL_MS) fs.unlinkSync(full);
      } catch {
        // 别的进程刚删掉:跳过
      }
    }
  } catch {
    // 目录不在、读不了
  }
}
