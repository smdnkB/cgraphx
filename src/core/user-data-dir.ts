/**
 * 用户目录(spec:2026-11-05-数据按项目放用户目录 D20、D23、D24;2026-11-06-项目按名称认 D1、D3、D8)
 *
 * ```text
 * ~/.cgraphx/
 * ├── db-profiles.json        用户级连接配置(db-query 管,不归这里)
 * ├── sessions.db             会话文件索引(进度与提示频控,session-index.ts 管,不归这里)
 * └── projects/<目录名>/       一个项目一个:identity.json、cgraphx.db、配置、backups/
 * ```
 *
 * - 位置每次现取 `os.homedir()`(测试改 HOME 就换);不看 `CGRAPHX_DIR`,它只管本地目录名
 * - 项目目录名按名字取(spec D3),撞名依次加 `-2`、`-3`…;读的一方按 identity.json 里的名字认目录,不按
 *   目录名猜
 * - identity.json 版本 2:名字 + 项目记下的地址(`origins`,只给重名判断用,不参与项目比较);版本 1 带名字的
 *   仍读得出,只有 origin 的按没有标识(不自动迁移)
 * - 建项目目录只经 ensureProjectDir:先在 `projects/` 下的临时目录(`.` 开头,不列出)写好 identity.json,
 *   再整个改名到位,不会留下没有标识的半个目录;`projects/` 与项目目录 0700(Windows 照默认权限)
 * - `~/.cgraphx/` 根下不放 `cgraphx.db`:放了,家目录下的目录往上找项目根都会停在家目录
 */

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import type { ProjectIdentity } from './project-identity';

export const IDENTITY_FILENAME = 'identity.json';
export const BACKUPS_DIRNAME = 'backups';

/** 用户目录在家目录下的名字(不受 CGRAPHX_DIR 影响,D24)。 */
const USER_DATA_DIRNAME = '.cgraphx';
const PROJECTS_DIRNAME = 'projects';
const SESSIONS_DIRNAME = 'sessions';

const IDENTITY_VERSION = 2;

/** 项目目录的 identity.json(版本 2):项目名字 + 项目记下的地址。 */
export interface ProjectDirIdentity {
  name: string;
  /** 项目记下的 origin(已规整),一次一个追加;只给重名判断用,不参与项目比较 */
  origins: string[];
}

/** `projects/` 和项目目录的权限(D23)。 */
const PRIVATE_DIR_MODE = 0o700;

/** 项目目录名最多多少个字(按码点)。 */
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

/**
 * hook 时代写会话登记的 `~/.cgraphx/sessions/`(已不再写):时间线按会话文件全量重建时删掉它
 * (spec:2026-11-06-会话文件解析替代hooks D19,`timeline/ingest/rebuild.ts`)。勿再用于写入。
 */
export function sessionsRoot(): string {
  return path.join(userDataRoot(), SESSIONS_DIRNAME);
}

/**
 * spec D3:项目目录的基础名(不含 `-2` 后缀)。就是名字:不能做文件名的字符换成 `-`,去掉首尾的 `.` 和空格,
 * 超过 120 个字截断(截断后再去一次首尾的 `.` 和空格);清空后什么都不剩 → `-`。
 */
export function projectDirBaseName(id: ProjectIdentity): string {
  const cleaned = id.name.replace(UNSAFE_NAME_CHARS, '-').replace(EDGE_DOTS_AND_SPACES, '');
  const truncated = [...cleaned].slice(0, MAX_DIR_NAME_LENGTH).join('').replace(EDGE_DOTS_AND_SPACES, '');
  return truncated === '' ? FALLBACK_DIR_NAME : truncated;
}

/** 是普通对象(不是数组、不是 null)。 */
function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** identity.json 的 origins:是数组时只留其中的字符串元素,不是数组按空数组。 */
function originsOf(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter((item): item is string => typeof item === 'string');
}

/**
 * 项目目录的 identity.json(spec D1、D8)。版本 2 要 name 是去首尾空白后非空的字符串,origins 只留其中的字符串
 * 元素;版本 1 只认带名字的(顶层的 origin 丢掉)。读不出、版本不对、name 不像名字 → null。
 */
export function readIdentityFile(dir: string): ProjectDirIdentity | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(fs.readFileSync(path.join(dir, IDENTITY_FILENAME), 'utf8'));
  } catch {
    return null;
  }
  if (!isPlainObject(parsed)) return null;
  const name = typeof parsed['name'] === 'string' ? parsed['name'].trim() : '';
  if (name === '') return null;
  if (parsed['version'] === IDENTITY_VERSION) return { name, origins: originsOf(parsed['origins']) };
  if (parsed['version'] === 1) return { name, origins: [] };
  return null;
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
 * 找这个项目已建的项目目录:`projects/` 下名字是 `<基础名>` 或 `<基础名>-<n>`(n ≥ 2)、identity.json 里的名字
 * 是 `id.name` 的那个(按 n 从小到大);不跳过中间缺号。只读,不建。
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
    if (found !== null && found.name === id.name) return { dir, name };
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

/** 在临时目录里写 identity.json(spec D1、D8:两空格缩进 + 换行,字段顺序 version、name、origins、createdAt)。 */
function writeIdentityFile(dir: string, id: ProjectIdentity): void {
  const content = { version: IDENTITY_VERSION, name: id.name, origins: [], createdAt: new Date().toISOString() };
  fs.writeFileSync(path.join(dir, IDENTITY_FILENAME), `${JSON.stringify(content, null, 2)}\n`);
}

/**
 * spec D8:把项目记下的 origin 追加进 identity.json(同目录临时文件 + rename 写回)。保留 name、createdAt 和其
 * 余不相干的字段;写回的版本一律是 2,版本 1 的顶层 `origin` 字段丢掉(版本 2 里地址只在 origins 里)。已经记过
 * 就不写。返回是否追加;文件读不出、不是对象 → false,不动它。写不上抛错(调用方吞掉)。
 */
export function appendProjectOrigin(dir: string, origin: string): boolean {
  const file = path.join(dir, IDENTITY_FILENAME);
  let parsed: unknown;
  try {
    parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return false;
  }
  if (!isPlainObject(parsed)) return false;
  const origins = originsOf(parsed['origins']);
  if (origins.includes(origin)) return false;
  const next: Record<string, unknown> = { version: IDENTITY_VERSION };
  if (typeof parsed['name'] === 'string') next['name'] = parsed['name'];
  next['origins'] = origins.concat(origin);
  if (typeof parsed['createdAt'] === 'string') next['createdAt'] = parsed['createdAt'];
  for (const [key, value] of Object.entries(parsed)) {
    if (key === 'version' || key === 'name' || key === 'origins' || key === 'createdAt' || key === 'origin') continue;
    next[key] = value;
  }
  const tmp = path.join(dir, `${IDENTITY_FILENAME}.${process.pid}.tmp`);
  try {
    fs.writeFileSync(tmp, `${JSON.stringify(next, null, 2)}\n`);
    fs.renameSync(tmp, file);
  } catch (err) {
    try {
      fs.unlinkSync(tmp);
    } catch {
      // 没写成功就没有临时文件
    }
    throw err;
  }
  return true;
}

/** 这个目录名已在、而且 identity.json 里的名字就是这个项目的 → 返回它。 */
function ownedDir(root: string, name: string, id: ProjectIdentity): { dir: string; name: string } | null {
  const dir = path.join(root, name);
  const found = readIdentityFile(dir);
  return found !== null && found.name === id.name ? { dir, name } : null;
}

/**
 * 建项目目录的唯一入口(spec D3):已建就返回;没有就先在 `projects/` 下的临时目录写好 identity.json,再改名到
 * 第一个空着的 `<基础名>`、`<基础名>-2`、`<基础名>-3`…。路过已在的名字时看 identity.json 是不是这个项目的
 * (别的进程刚建好);改名时目标已在 → 重新 findProjectDir,还没有就试下一个名字。返回目录绝对路径和目录名。
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

export interface ProjectDirEntry { name: string; dir: string; identity: ProjectDirIdentity | null }

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
