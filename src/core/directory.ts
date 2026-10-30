/**
 * 目录管理
 *
 * 管理项目的 `.cgraphx/` 目录:共用库 `cgraphx.db` 与各子系统的运行时文件。目录名
 * 遵从 `CGRAPHX_DIR` 环境变量覆盖。
 *
 * 数据目录(spec D24):副本的 `.cgraphx/` 是普通目录,其中 `shared` 链接指回主目录的
 * `.cgraphx/`;`resolveDataDir` 据此给出共用数据所在的目录。没有链接时就是项目自己的
 * `.cgraphx/`,路径与原来逐字相同。
 */

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

/** The default per-project data directory name. */
const DEFAULT_CGRAPHX_DIR = '.cgraphx';

let warnedBadDirName = false;

/**
 * Resolve the per-project data directory name, honoring the `CGRAPHX_DIR`
 * environment override (default `.cgraphx`). The override is a single path
 * segment that lives in the project root.
 *
 * Two environments that share one working tree must NOT share one `.cgraphx/`
 * — most concretely Windows-native and WSL. SQLite file locking across the
 * WSL2 ↔ Windows filesystem boundary is unreliable, so two processes sharing
 * one index risks corruption. Setting `CGRAPHX_DIR=.cgraphx-win` on one side
 * gives each environment its own data dir in the same tree.
 *
 * Read live (not captured at load) so it is both process-accurate and testable.
 * An override that isn't a plain directory name — empty, containing a path
 * separator, `.`, `..`/traversal, or absolute — is ignored (we keep the
 * default) rather than risk writing outside the project or into the project
 * root itself; we warn once to stderr so the misconfiguration is seen.
 */
export function codeGraphDirName(): string {
  const raw = process.env.CGRAPHX_DIR?.trim();
  if (!raw) return DEFAULT_CGRAPHX_DIR;
  const invalid =
    raw === '.' ||
    raw.includes('..') ||
    raw.includes('/') ||
    raw.includes('\\') ||
    path.isAbsolute(raw);
  if (invalid) {
    if (!warnedBadDirName) {
      warnedBadDirName = true;
      console.warn(
        `[cgraphx] Ignoring invalid CGRAPHX_DIR="${raw}" — it must be a plain ` +
          `directory name (no path separators, no "..", not absolute). Using "${DEFAULT_CGRAPHX_DIR}".`
      );
    }
    return DEFAULT_CGRAPHX_DIR;
  }
  return raw;
}

/**
 * Get the .cgraphx directory path for a project
 */
export function getCodeGraphDir(projectRoot: string): string {
  return path.join(projectRoot, codeGraphDirName());
}

/**
 * Check if a project has been initialized with cgraphx.
 * Requires both `.cgraphx/` directory AND `cgraphx.db` to exist.
 */
export function isInitialized(projectRoot: string): boolean {
  const codegraphDir = getCodeGraphDir(projectRoot);
  if (!fs.existsSync(codegraphDir) || !fs.statSync(codegraphDir).isDirectory()) {
    return false;
  }
  // Must have cgraphx.db, not just .cgraphx folder
  const dbPath = path.join(codegraphDir, 'cgraphx.db');
  return fs.existsSync(dbPath);
}

/** 副本 `.cgraphx/` 里指回主目录 `.cgraphx/` 的符号链接名(spec D18)。 */
export const SHARED_LINK_NAME = 'shared';

/** 主目录数据目录下存放副本登记文件的子目录名(spec D19)。 */
export const REPLICAS_DIRNAME = 'replicas';

/**
 * 数据目录状态:
 * - own:用项目自己的 `.cgraphx/`(没有 shared 链接,或链接不作数)
 * - replica:登记过、没删除的副本,共用数据在主目录
 * - main-missing:shared 链接指向的主目录 `.cgraphx/` 已不在
 */
export type DataDirState = 'own' | 'replica' | 'main-missing';

export interface DataDirInfo {
  /** 共用数据所在目录的绝对路径 */
  dir: string;
  state: DataDirState;
  /** own:项目根本身;replica / main-missing:dir 的上级目录 */
  mainRoot: string;
}

/** realpath;失败(路径不在、没权限等)退回 path.resolve 的结果。 */
function realpathOrResolve(p: string): string {
  try {
    return fs.realpathSync(p);
  } catch {
    return path.resolve(p);
  }
}

/** 读登记文件并解析成对象;读不了、不是合法 JSON、不是对象 → null。 */
function readRegistryObject(file: string): Record<string, unknown> | null {
  try {
    const parsed: unknown = JSON.parse(fs.readFileSync(file, 'utf-8'));
    return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

/**
 * 解析共用数据所在的目录(spec D24)。`local` 指 `getCodeGraphDir(projectRoot)`:
 *
 * 1. `local/shared` 不存在或不是符号链接(lstat)→ own,dir 就是 `local`(与原来逐字相同)
 * 2. 链接目标不存在 → main-missing:写数据目录的地方据此不建目录、不写,
 *    否则会在旧主目录位置重建 `.cgraphx/`,解析随之退成 own、数据悄悄写进副本本地
 * 3. 目标下 `replicas/<项目根 realpath 的目录名>.json` 能解析成对象,其 `path` 的 realpath
 *    就是项目根的 realpath,且 `removedAt` 为 null → replica,dir 为目标的 realpath
 * 4. 其余(没登记、已删除、读不了)→ 同 1
 *
 * 只读登记文件的 `path`、`removedAt` 两个字段,不写登记。任何异常都按 own 处理,不抛。
 */
export function resolveDataDir(projectRoot: string): DataDirInfo {
  const own = (): DataDirInfo => ({
    dir: getCodeGraphDir(projectRoot),
    state: 'own',
    mainRoot: path.resolve(projectRoot),
  });
  try {
    const local = getCodeGraphDir(projectRoot);
    const link = path.join(local, SHARED_LINK_NAME);
    // lstat 只看链接本身;不存在时返回 undefined,不走异常(没有副本的项目每次都走这条)
    const linkStat = fs.lstatSync(link, { throwIfNoEntry: false });
    if (linkStat === undefined || !linkStat.isSymbolicLink()) return own();

    const target = path.resolve(local, fs.readlinkSync(link));
    if (!fs.existsSync(target)) {
      return { dir: target, state: 'main-missing', mainRoot: path.dirname(target) };
    }

    const realRoot = realpathOrResolve(projectRoot);
    const entry = readRegistryObject(
      path.join(target, REPLICAS_DIRNAME, `${path.basename(realRoot)}.json`),
    );
    if (
      entry !== null &&
      typeof entry.path === 'string' &&
      realpathOrResolve(entry.path) === realRoot &&
      entry.removedAt === null
    ) {
      const realTarget = realpathOrResolve(target);
      return { dir: realTarget, state: 'replica', mainRoot: path.dirname(realTarget) };
    }
    return own();
  } catch {
    return own();
  }
}

/** 共用数据所在的目录(= `resolveDataDir(projectRoot).dir`)。 */
export function getDataDir(projectRoot: string): string {
  return resolveDataDir(projectRoot).dir;
}

/**
 * Reason a directory is unsafe to use as a project ROOT, or null when it's
 * fine.
 *
 * Indexing/initializing your home directory or a filesystem root drags in
 * caches, `Library`, every other project, etc. — a multi-GB index and constant
 * file-watcher churn. The classic trigger: running the installer or
 * `cgraphx init` from `$HOME`, which would auto-initialize the current
 * directory. These are never intended project roots, so the installer and
 * `init` refuse them (overridable with `--force`).
 *
 * Pure-ish (reads only `os.homedir()` + realpath) so it's easy to unit-test.
 * The returned string is a human phrase that slots into "… looks like {reason}".
 */
export function unsafeIndexRootReason(projectRoot: string): string | null {
  const resolve = (p: string): string => {
    try {
      return fs.realpathSync(path.resolve(p));
    } catch {
      return path.resolve(p);
    }
  };
  const resolved = resolve(projectRoot);

  // Filesystem root: `/` on POSIX, a drive root like `C:\` on Windows.
  if (path.parse(resolved).root === resolved) {
    return 'the filesystem root';
  }

  const home = resolve(os.homedir());
  // Case-insensitive on macOS/Windows (case-preserving but case-insensitive FS).
  const norm = (p: string): string =>
    process.platform === 'darwin' || process.platform === 'win32' ? p.toLowerCase() : p;
  const r = norm(resolved);
  const h = norm(home);

  if (r === h) {
    return 'your home directory';
  }
  // An ancestor of home (e.g. `/Users`, `/home`) — even broader than home.
  if (h.startsWith(r + path.sep)) {
    return 'a parent of your home directory';
  }
  return null;
}

/**
 * Contents of `.cgraphx/.gitignore`. A single wildcard ignore keeps every
 * transient file in the data dir — the database, logs, cache, and anything
 * future versions add — out of git, without having to enumerate each name. */
const GITIGNORE_CONTENT = `# cgraphx data files — local to each machine, not for committing.
# Ignore everything in .cgraphx/ except this file itself, so transient
# files (the database, logs) never show up in git.
*
!.gitignore
`;

/** Header line that prefixes every .gitignore older cgraphx versions auto-generated — kept to detect+heal stale pre-wildcard files. */
const GITIGNORE_MARKER = '# CodeGraph data files';

/**
 * Is `content` a stale cgraphx-generated `.gitignore` that should be
 * regenerated in place? True when it carries our header but predates the
 * wildcard ignore (it has no bare `*` line). A file WITHOUT our header is
 * user-authored and is left untouched; one that already has the wildcard is
 * current. Matching on the header (not a byte-exact list of past defaults)
 * heals every old variant and is idempotent once upgraded.
 */
function isStaleDefaultGitignore(content: string): boolean {
  if (!content.trimStart().startsWith(GITIGNORE_MARKER)) return false;
  return !content.split('\n').some((line) => line.trim() === '*');
}

/**
 * Write `.cgraphx/.gitignore` if it's absent, or upgrade a stale
 * cgraphx-generated default in place; a user-customized file is left alone.
 * Best-effort — returns `false` only if a needed write failed.
 */
function ensureGitignore(gitignorePath: string): boolean {
  let existing: string | null;
  try {
    existing = fs.readFileSync(gitignorePath, 'utf-8');
  } catch {
    existing = null; // absent (ENOENT) or unreadable — (re)create below
  }
  // Current default or a user-authored file: nothing to do.
  if (existing !== null && !isStaleDefaultGitignore(existing)) return true;
  try {
    fs.writeFileSync(gitignorePath, GITIGNORE_CONTENT, 'utf-8');
    return true;
  } catch {
    return false;
  }
}

/**
 * Create the `.cgraphx` directory structure.
 * Note: Only throws if `cgraphx.db` already exists, not just if `.cgraphx/`
 * exists.
 */
export function createDirectory(projectRoot: string): void {
  const codegraphDir = getCodeGraphDir(projectRoot);
  const dbPath = path.join(codegraphDir, 'cgraphx.db');

  // Only throw if cgraphx is actually initialized (db exists).
  // .cgraphx/ folder alone is fine.
  if (fs.existsSync(dbPath)) {
    throw new Error(`cgraphx already initialized in ${projectRoot}`);
  }

  // Create main directory (if it doesn't exist)
  fs.mkdirSync(codegraphDir, { recursive: true });

  // Write .gitignore inside .cgraphx (create if absent, upgrade a stale
  // pre-wildcard default left by an older version).
  ensureGitignore(path.join(codegraphDir, '.gitignore'));
}

/**
 * 项目根解析 —— db / docs / features / web / timeline 各子系统缺省项目根
 * 的统一入口。
 *
 * 背景(spec:2026-08-13-timeline项目根回溯修复、2026-08-24-项目根解析拉齐):
 * Claude Code 会话的工作目录会随 agent `cd` 漂移,把「当前目录」直接当项目
 * 根,会导致子目录下找不到 `.cgraphx/` 配置、读写散落。
 *
 * 规则:从解析起点逐级向上,第一个「已初始化」目录(见 isInitialized:
 * `.cgraphx/cgraphx.db` 存在,裸 `.cgraphx/` 目录不算)即项目根,就近优先
 * (monorepo 子项目根不被仓库级根吞并);到文件系统根仍无命中则回退起点
 * 本身 —— 未初始化路径行为与「把 cwd 当根」完全一致。
 *
 * 任何异常都按「未命中」处理,绝不抛出 —— 解析失败最坏退化为把起点当根,
 * 不得使命令行为劣于现状。
 */
export function resolveProjectRoot(startDir: string): string {
  const start = path.resolve(startDir);
  let current = start;
  // dirname 链在文件系统根自然终止(parent === current);深度上限仅作
  // 防御性兜底,防御性保护不构成行为语义。
  for (let depth = 0; depth < 128; depth++) {
    try {
      if (isInitialized(current)) return current;
    } catch {
      // 按未命中处理,继续向上(如并发删除导致 stat 失败)。
    }
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return start;
}

/**
 * Remove the .cgraphx directory
 */
export function removeDirectory(projectRoot: string): void {
  const codegraphDir = getCodeGraphDir(projectRoot);

  if (!fs.existsSync(codegraphDir)) {
    return;
  }

  // Verify .cgraphx is a real directory, not a symlink pointing elsewhere
  const lstat = fs.lstatSync(codegraphDir);
  if (lstat.isSymbolicLink()) {
    // Only remove the symlink itself, never follow it for recursive delete
    fs.unlinkSync(codegraphDir);
    return;
  }

  if (!lstat.isDirectory()) {
    // Not a directory - remove the single file
    fs.unlinkSync(codegraphDir);
    return;
  }

  // Recursively remove directory
  fs.rmSync(codegraphDir, { recursive: true, force: true });
}

