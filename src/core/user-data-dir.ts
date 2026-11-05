/**
 * 用户目录(spec:2026-11-05-数据按项目放用户目录 D20、D21、D23、D24)
 *
 * ```text
 * ~/.cgraphx/
 * ├── db-profiles.json        用户级连接配置(db-query 管,不归这里)
 * ├── sessions/               会话登记(session-registry.ts)
 * └── projects/<目录名>/       一个项目一个:identity.json、cgraphx.db、轮次记录、配置、backups/
 * ```
 *
 * - 位置每次现取 `os.homedir()`(测试改 HOME 就换);不看 `CGRAPHX_DIR`,它只管本地目录名
 * - 项目目录名按标识取,撞名依次加 `-2`、`-3`…;读的一方按 identity.json 认目录,不按名字猜
 * - 建项目目录只经 ensureProjectDir:先在 `projects/` 下的临时目录(`.` 开头,不列出)写好 identity.json,
 *   再整个改名到位,不会留下没有标识的半个目录;`projects/` 与项目目录 0700(Windows 照默认权限)
 * - `~/.cgraphx/` 根下不放 `cgraphx.db`:放了,家目录下的目录往上找项目根都会停在家目录
 */

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { sameIdentity, type ProjectIdentity } from './project-identity';

export const IDENTITY_FILENAME = 'identity.json';
export const BACKUPS_DIRNAME = 'backups';

/** 用户目录在家目录下的名字(不受 CGRAPHX_DIR 影响,D24)。 */
const USER_DATA_DIRNAME = '.cgraphx';
const PROJECTS_DIRNAME = 'projects';
const SESSIONS_DIRNAME = 'sessions';

const IDENTITY_VERSION = 1;

/** `projects/` 和项目目录的权限(D23)。 */
const PRIVATE_DIR_MODE = 0o700;

/** 项目目录名最多多少个字(按码点,D21)。 */
const MAX_DIR_NAME_LENGTH = 120;
/** 不能做文件名的字符:`/ \ : * ? " < > |` 和控制字符,换成 `-`。 */
const UNSAFE_NAME_CHARS = /[/\\:*?"<>|\u0000-\u001f\u007f]/g;
/** 首尾的 `.` 和空格。 */
const EDGE_DOTS_AND_SPACES = /^[. ]+|[. ]+$/g;
/** 名字清理后什么都不剩(如全是 `.`)时用的目录名。 */
const FALLBACK_DIR_NAME = '-';

/** 建目录用的临时目录前缀(`.` 开头:listProjectDirs 不列,下次建时清掉过期的)。 */
const TEMP_DIR_PREFIX = '.tmp-';
/** 临时目录多久没动算过期。 */
const STALE_TEMP_DIR_MS = 3600_000;
/** 撞名时最多试到 `-<n>`。 */
const MAX_NAME_SUFFIX = 10_000;

/** 用户目录:`~/.cgraphx/`,每次现取。 */
export function userDataRoot(): string {
  return path.join(os.homedir(), USER_DATA_DIRNAME);
}

export function projectsRoot(): string {
  return path.join(userDataRoot(), PROJECTS_DIRNAME);
}

export function sessionsRoot(): string {
  return path.join(userDataRoot(), SESSIONS_DIRNAME);
}

/**
 * spec D21:项目目录的基础名(不含 `-2` 后缀)。按 origin(含 origin 加名字)→ 规整后的 origin 按 `/` 拆段、去掉
 * 空段、用 `-` 连,有名字再接 `-名字`;按名字 → 名字。不能做文件名的字符换成 `-`,去掉首尾的 `.` 和空格,超过
 * 120 个字截断(截断后再去一次首尾的 `.` 和空格)。
 */
export function projectDirBaseName(id: ProjectIdentity): string {
  let raw: string;
  if (id.origin !== null) {
    raw = id.origin.split('/').filter((seg) => seg !== '').join('-');
    if (id.name !== null) raw = `${raw}-${id.name}`;
  } else {
    raw = id.name ?? '';
  }
  const cleaned = raw.replace(UNSAFE_NAME_CHARS, '-').replace(EDGE_DOTS_AND_SPACES, '');
  const truncated = [...cleaned].slice(0, MAX_DIR_NAME_LENGTH).join('').replace(EDGE_DOTS_AND_SPACES, '');
  return truncated === '' ? FALLBACK_DIR_NAME : truncated;
}

function isStringOrNull(value: unknown): value is string | null {
  return value === null || typeof value === 'string';
}

/** 项目目录的 identity.json;读不出、格式不对(版本不是 1、字段类型不对、两项都没有)→ null。 */
export function readIdentityFile(dir: string): ProjectIdentity | null {
  try {
    const parsed: unknown = JSON.parse(fs.readFileSync(path.join(dir, IDENTITY_FILENAME), 'utf8'));
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return null;
    const { version, origin, name } = parsed as Record<string, unknown>;
    if (version !== IDENTITY_VERSION || !isStringOrNull(origin) || !isStringOrNull(name)) return null;
    if (origin === null && name === null) return null;
    return { origin, name };
  } catch {
    return null;
  }
}

/** 目录名是 `<基础名>` → 1,`<基础名>-<n>`(n ≥ 2)→ n,其余 → null。 */
function suffixOf(dirName: string, base: string): number | null {
  if (dirName === base) return 1;
  if (!dirName.startsWith(`${base}-`)) return null;
  const rest = dirName.slice(base.length + 1);
  if (!/^[1-9][0-9]*$/.test(rest)) return null;
  const n = Number(rest);
  return n >= 2 ? n : null;
}

/** `projects/` 下的一级真实目录(不跟随链接);`projects/` 不在 → []。 */
function listRealDirs(root: string): string[] {
  try {
    return fs
      .readdirSync(root, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name);
  } catch {
    return [];
  }
}

/**
 * 找这个标识已建的项目目录:`projects/` 下名字是 `<基础名>` 或 `<基础名>-<n>`(n ≥ 2)、identity.json 与 id 相同
 * 的那个(按 n 从小到大);不跳过中间缺号。只读,不建。
 */
export function findProjectDir(id: ProjectIdentity): { dir: string; name: string } | null {
  const root = projectsRoot();
  const base = projectDirBaseName(id);
  const candidates: Array<{ name: string; n: number }> = [];
  for (const name of listRealDirs(root)) {
    const n = suffixOf(name, base);
    if (n !== null) candidates.push({ name, n });
  }
  candidates.sort((a, b) => a.n - b.n);
  for (const { name } of candidates) {
    const dir = path.join(root, name);
    const found = readIdentityFile(dir);
    if (found !== null && sameIdentity(found, id)) return { dir, name };
  }
  return null;
}

/** 路径上有东西(文件、目录、链接都算)。 */
function pathExists(p: string): boolean {
  try {
    return fs.lstatSync(p, { throwIfNoEntry: false }) !== undefined;
  } catch {
    return true;
  }
}

/** 收紧到 0700;Windows 上不设。 */
function restrictDirMode(dir: string): void {
  if (process.platform !== 'win32') fs.chmodSync(dir, PRIVATE_DIR_MODE);
}

/** `projects/` 不在就建(0700);`~/.cgraphx/` 不在一并建,权限照默认。 */
function ensureProjectsRoot(): string {
  const root = projectsRoot();
  try {
    if (fs.statSync(root).isDirectory()) return root;
  } catch {
    // 不在,往下建
  }
  fs.mkdirSync(userDataRoot(), { recursive: true });
  try {
    fs.mkdirSync(root, process.platform === 'win32' ? undefined : { mode: PRIVATE_DIR_MODE });
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'EEXIST') return root;
    throw err;
  }
  restrictDirMode(root);
  return root;
}

/** 删掉 `projects/` 下过期(mtime 超过 1 小时)的建目录临时目录;删不掉的跳过。 */
function removeStaleTempDirs(root: string): void {
  const now = Date.now();
  for (const name of listRealDirs(root)) {
    if (!name.startsWith(TEMP_DIR_PREFIX)) continue;
    const dir = path.join(root, name);
    try {
      if (now - fs.lstatSync(dir).mtimeMs > STALE_TEMP_DIR_MS) fs.rmSync(dir, { recursive: true, force: true });
    } catch {
      // 别的进程刚删掉、没权限:跳过
    }
  }
}

/** 在临时目录里写 identity.json(C-15:两空格缩进 + 换行,字段顺序 version、origin、name、createdAt)。 */
function writeIdentityFile(dir: string, id: ProjectIdentity): void {
  const content = { version: IDENTITY_VERSION, origin: id.origin, name: id.name, createdAt: new Date().toISOString() };
  fs.writeFileSync(path.join(dir, IDENTITY_FILENAME), `${JSON.stringify(content, null, 2)}\n`);
}

/** 这个目录名已在、而且就是这个标识的 → 返回它。 */
function ownedDir(root: string, name: string, id: ProjectIdentity): { dir: string; name: string } | null {
  const dir = path.join(root, name);
  const found = readIdentityFile(dir);
  return found !== null && sameIdentity(found, id) ? { dir, name } : null;
}

/**
 * 建项目目录的唯一入口(D21):已建就返回;没有就先在 `projects/` 下的临时目录写好 identity.json,再改名到第一个
 * 空着的 `<基础名>`、`<基础名>-2`、`<基础名>-3`…。路过已在的名字时看它是不是这个标识的(别的进程刚建好);
 * 改名时目标已在 → 重新 findProjectDir,还没有就试下一个名字。返回目录绝对路径和目录名。
 */
export function ensureProjectDir(id: ProjectIdentity): { dir: string; name: string } {
  const existing = findProjectDir(id);
  if (existing !== null) return existing;
  const root = ensureProjectsRoot();
  removeStaleTempDirs(root);
  const tmp = fs.mkdtempSync(path.join(root, TEMP_DIR_PREFIX));
  try {
    restrictDirMode(tmp);
    writeIdentityFile(tmp, id);
    const base = projectDirBaseName(id);
    for (let n = 1; n <= MAX_NAME_SUFFIX; n++) {
      const name = n === 1 ? base : `${base}-${n}`;
      const target = path.join(root, name);
      if (pathExists(target)) {
        const owned = ownedDir(root, name, id);
        if (owned !== null) return owned;
        continue;
      }
      try {
        fs.renameSync(tmp, target);
        return { dir: target, name };
      } catch (err) {
        if (!pathExists(target)) throw err;
        const found = findProjectDir(id);
        if (found !== null) return found;
      }
    }
    throw new Error(`${root} 下以 ${base} 开头的目录太多,建不了项目目录;用 cgraphx project list 看看,清掉不要的`);
  } finally {
    // 改名成功后临时目录已不在;没改名(别的进程建好了、出错)时清掉
    if (pathExists(tmp)) fs.rmSync(tmp, { recursive: true, force: true });
  }
}

export interface ProjectDirEntry { name: string; dir: string; identity: ProjectIdentity | null }

/** `projects/` 下每个一级目录(不跟随链接),不含 `.` 开头的;按名字排序。只读。 */
export function listProjectDirs(): ProjectDirEntry[] {
  const root = projectsRoot();
  return listRealDirs(root)
    .filter((name) => !name.startsWith('.'))
    .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))
    .map((name) => {
      const dir = path.join(root, name);
      return { name, dir, identity: readIdentityFile(dir) };
    });
}
