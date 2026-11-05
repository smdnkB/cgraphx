/**
 * 项目标识(spec:2026-11-05-数据按项目放用户目录 D3、D4、D5、D18、D19)
 *
 * 一个根(D2,见 data-location.ts 的 findProjectRoot)属于哪个项目看它的标识:规整后的 origin、项目名称
 * 两项,两项都相同才算同一个项目。按根取:
 *
 * | 根 | 标识 |
 * |---|---|
 * | 工作区根,有 origin,没记名字 | origin |
 * | 工作区根,记了名字 | 名字 |
 * | 工作区里的子目录(一个仓库装了几个项目) | origin 加名字;没有 origin 只用名字 |
 * | 不在 git 仓库里 | 名字 |
 * | 装过、该有名字却没记 | 默认名字(目录名;子目录项目取子目录名),不写回 |
 * | 没有 origin、没记名字、也没装过 | 没有标识 |
 *
 * 名字存放:根在 git 仓库里存本地 git 配置——工作区根 `cgraphx.projectName`,子目录项目
 * `[cgraphx "<子目录>"] projectName`(worktree 共用、`cp -R` 带着、新 clone 没有);不在 git 仓库里存本地
 * `.cgraphx/project.json` 的 `name`。
 *
 * 跑 git:认标识只跑一次 `git config -z --get-regexp`,一次取齐 origin、各级配置里的 `url.*.insteadof` 和
 * `cgraphx.*`。同一进程按根记住标识(git 出错的不记,下一次再试),同一工作区读出的配置也记住;会话登记、
 * git 钩子把认好的标识填进来(rememberRootIdentity),之后的调用不再跑 git。
 */

import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';

import { readLocalProjectJson, updateLocalProjectJson } from './data-location';
import { isInitialized } from './directory';

/** spec D3:按 origin 认 → name 为 null;按名字认 → origin 为 null;子目录项目两项都有(没有 origin 时只有 name)。两项都相同才算同一个标识。 */
export interface ProjectIdentity { origin: string | null; name: string | null }
export type IdentityKind = 'origin' | 'name' | 'origin+name';
export interface RootIdentity {
  root: string;
  /** null = 没有标识(D3 表最后一行:没有 origin、没记名字、也没装过) */
  identity: ProjectIdentity | null;
  /** 根所在的 git 工作区根(从根往上第一个有 .git 的目录,目录或文件都算);不在 git 里为 null */
  workTreeRoot: string | null;
  /** 根相对工作区根的 POSIX 路径;根就是工作区根、或不在 git 里为 null */
  subdir: string | null;
  /** 这个根按名字认:没有 origin 的工作区根、子目录项目、不在 git 里的目录 */
  needsName: boolean;
  /** 名字从哪来:'recorded' 记下的;'default' 按默认名字认、没写回;不按名字认为 null */
  nameSource: 'recorded' | 'default' | null;
}

type NameSource = RootIdentity['nameSource'];

/** 进程内记下的一个根:标识,以及名字从哪来。 */
interface RememberedRoot {
  identity: ProjectIdentity | null;
  nameSource: NameSource;
}

/** 一次配置读取的结果(按工作区根记住)。 */
interface GitConfigSnapshot {
  /** 套过 insteadOf、规整后的 origin;没有 origin 为 null */
  origin: string | null;
  /** 工作区根记的名字(`cgraphx.projectname`);没记为 null */
  rootName: string | null;
  /** 子目录项目:子目录(相对工作区根的 POSIX 路径)→ 记的名字(`cgraphx.<子目录>.projectname`) */
  subdirNames: ReadonlyMap<string, string>;
}

interface InsteadOfRule {
  base: string;
  prefix: string;
}

/** 认标识的那一次配置读取:只取 origin、insteadOf 和 cgraphx 自己的键(D5)。 */
const CONFIG_KEYS_REGEXP = '^(remote\\.origin\\.url|url\\..*\\.insteadof|cgraphx\\..*)$';

/** git 输出的键:节名、键名转小写,子节名原样。 */
const ORIGIN_KEY = 'remote.origin.url';
const INSTEADOF_PREFIX = 'url.';
const INSTEADOF_SUFFIX = '.insteadof';
const ROOT_NAME_KEY = 'cgraphx.projectname';
const SUBDIR_NAME_PREFIX = 'cgraphx.';
const SUBDIR_NAME_SUFFIX = '.projectname';

/** URL 写法里按主机、路径拆开的协议(D4);其余协议(`file://` 等)只去末尾的 `/`、`.git`。 */
const URL_SCHEMES: ReadonlySet<string> = new Set(['ssh', 'git', 'http', 'https', 'git+ssh', 'ssh+git']);
const SCHEME_RE = /^([A-Za-z][A-Za-z0-9+.-]*):\/\//;
/** Windows 盘符路径(`C:\x`、`C:/x`)是本地路径,不是 scp 写法。 */
const DRIVE_PATH_RE = /^[A-Za-z]:[\\/]/;

/** 项目名称最多多少个字(按码点,D19)。 */
const MAX_NAME_LENGTH = 100;
const CONTROL_CHAR_RE = /[\u0000-\u001f\u007f]/;

/** 往上找工作区根的深度上限(同 resolveProjectRoot)。 */
const MAX_WALK_DEPTH = 128;

/** 进程内记忆的上限:超过整个清掉(长驻进程只碰得到少数几个根)。 */
const MEMO_LIMIT = 1024;

/** 根(path.resolve 后)→ 标识。 */
const rootMemo = new Map<string, RememberedRoot>();
/** 工作区根(不在 git 里时是跑 git 的目录)→ 配置读取结果。 */
const configMemo = new Map<string, GitConfigSnapshot>();

function memoSet<V>(memo: Map<string, V>, key: string, value: V): void {
  if (memo.size >= MEMO_LIMIT && !memo.has(key)) memo.clear();
  memo.set(key, value);
}

/** 目录下有 `.git`(目录或文件都算,链接也算)。 */
function hasDotGit(dir: string): boolean {
  try {
    return fs.lstatSync(path.join(dir, '.git'), { throwIfNoEntry: false }) !== undefined;
  } catch {
    return false;
  }
}

/** 从 start 往上第一个有 `.git` 的目录;没有 → null。 */
function findWorkTreeRoot(start: string): string | null {
  let current = start;
  for (let depth = 0; depth < MAX_WALK_DEPTH; depth++) {
    if (hasDotGit(current)) return current;
    const parent = path.dirname(current);
    if (parent === current) return null;
    current = parent;
  }
  return null;
}

/** 根相对工作区根的 POSIX 路径;根就是工作区根 → null。 */
function subdirOf(workTreeRoot: string, root: string): string | null {
  const rel = path.relative(workTreeRoot, root);
  return rel === '' ? null : rel.split(path.sep).join('/');
}

/** 装过(`.cgraphx/cgraphx.db` 在);判断出错按没装过。 */
function isInstalled(dir: string): boolean {
  try {
    return isInitialized(dir);
  } catch {
    return false;
  }
}

/** 记下的名字:空串、全是空白的按没记。 */
function recordedName(raw: string | null): string | null {
  return raw !== null && raw.trim() !== '' ? raw : null;
}

/** 默认名字:目录名;子目录项目取子目录最后一段。 */
function defaultNameOf(root: string, subdir: string | null): string {
  if (subdir !== null) {
    const segments = subdir.split('/').filter((seg) => seg !== '');
    const last = segments[segments.length - 1];
    if (last !== undefined) return last;
  }
  return path.basename(root) || root;
}

/** 去掉末尾的 `/`、`.git`。 */
function stripRepoSuffix(p: string): string {
  let s = p.replace(/\/+$/, '');
  if (s.endsWith('.git')) s = s.slice(0, -'.git'.length);
  return s.replace(/\/+$/, '');
}

/** `主机/路径`:主机转小写,路径去掉开头的 `/`、`~` 和末尾的 `/`、`.git`。 */
function joinHostPath(host: string, rawPath: string): string {
  const p = stripRepoSuffix(rawPath.replace(/^[/~]+/, ''));
  const h = host.toLowerCase();
  return p === '' ? h : `${h}/${p}`;
}

/** URL 的 authority(`[用户[:密码]@]主机[:端口]`)里的主机;`[IPv6]` 带方括号原样留着。 */
function hostOfAuthority(authority: string): string {
  const hostPort = authority.slice(authority.lastIndexOf('@') + 1);
  if (hostPort.startsWith('[')) {
    const close = hostPort.indexOf(']');
    return close === -1 ? hostPort : hostPort.slice(0, close + 1);
  }
  const colon = hostPort.indexOf(':');
  return colon === -1 ? hostPort : hostPort.slice(0, colon);
}

/**
 * spec D4:比的是规整后的 `主机/路径`。scp 写法(`[用户@]主机:路径`,冒号前没有 `/`)和 URL 写法(ssh、git、
 * http、https、git+ssh、ssh+git)拆成主机和路径,去掉用户名、密码、端口,主机转小写,路径去掉开头的 `/`、`~`
 * 和末尾的 `/`、`.git`;其余(本地路径、`file://`)只去末尾的 `/`、`.git`,原样返回。
 */
export function normalizeOrigin(raw: string): string {
  const s = raw.trim();
  const scheme = SCHEME_RE.exec(s);
  if (scheme !== null) {
    if (!URL_SCHEMES.has((scheme[1] ?? '').toLowerCase())) return stripRepoSuffix(s);
    const rest = s.slice(scheme[0].length);
    const slash = rest.indexOf('/');
    const authority = slash === -1 ? rest : rest.slice(0, slash);
    return joinHostPath(hostOfAuthority(authority), slash === -1 ? '' : rest.slice(slash));
  }
  const colon = s.indexOf(':');
  if (colon > 0 && !s.slice(0, colon).includes('/') && !DRIVE_PATH_RE.test(s)) {
    // scp 写法;主机是 [IPv6] 时第一个冒号落在方括号里,分隔路径的是 `]:` 后面那个
    let hostEnd = colon;
    const bracket = s.indexOf('[');
    if (bracket !== -1 && bracket < colon) {
      const close = s.indexOf(']:', bracket);
      if (close !== -1) hostEnd = close + 1;
    }
    const userHost = s.slice(0, hostEnd);
    return joinHostPath(userHost.slice(userHost.lastIndexOf('@') + 1), s.slice(hostEnd + 1));
  }
  return stripRepoSuffix(s);
}

/** origin 以哪个 insteadOf 前缀开头取最长的,换成 `<base>`(和 `git remote get-url origin` 的结果一致)。 */
function applyInsteadOf(url: string, rules: readonly InsteadOfRule[]): string {
  let best: InsteadOfRule | null = null;
  for (const rule of rules) {
    if (url.startsWith(rule.prefix) && (best === null || rule.prefix.length > best.prefix.length)) best = rule;
  }
  return best === null ? url : best.base + url.slice(best.prefix.length);
}

/** 配置里的子目录:规整成相对工作区根的 POSIX 路径;空、绝对路径、跑出工作区的 → null。 */
function normalizeSubdir(raw: string): string | null {
  if (raw === '' || raw.includes('\\') || path.posix.isAbsolute(raw) || path.win32.isAbsolute(raw)) return null;
  const n = path.posix.normalize(raw).replace(/\/+$/, '');
  if (n === '' || n === '.' || n === '..' || n.startsWith('../')) return null;
  return n;
}

/**
 * 解析 `git config -z --get-regexp` 的输出:每条以 `\0` 结尾,第一个 `\n` 前是键、后是值(没有值的键不带 `\n`)。
 * `remote.origin.url` 有多条时取第一条(同 `git remote get-url origin`);名字有多条时取最后一条(同 `git config --get`)。
 */
function parseGitConfig(out: string): GitConfigSnapshot {
  let originRaw: string | null = null;
  const rules: InsteadOfRule[] = [];
  let rootName: string | null = null;
  const subdirNames = new Map<string, string>();
  for (const record of out.split('\0')) {
    if (record === '') continue;
    const nl = record.indexOf('\n');
    const key = nl === -1 ? record : record.slice(0, nl);
    const value = nl === -1 ? '' : record.slice(nl + 1);
    if (key === ORIGIN_KEY) {
      if (originRaw === null) originRaw = value;
    } else if (key === ROOT_NAME_KEY) {
      rootName = recordedName(value);
    } else if (key.startsWith(INSTEADOF_PREFIX) && key.endsWith(INSTEADOF_SUFFIX)) {
      const base = key.slice(INSTEADOF_PREFIX.length, key.length - INSTEADOF_SUFFIX.length);
      if (base !== '' && value !== '') rules.push({ base, prefix: value });
    } else if (key.startsWith(SUBDIR_NAME_PREFIX) && key.endsWith(SUBDIR_NAME_SUFFIX)) {
      const subdir = normalizeSubdir(key.slice(SUBDIR_NAME_PREFIX.length, key.length - SUBDIR_NAME_SUFFIX.length));
      if (subdir === null) continue;
      const name = recordedName(value);
      if (name === null) subdirNames.delete(subdir);
      else subdirNames.set(subdir, name);
    }
  }
  let origin: string | null = null;
  if (originRaw !== null && originRaw.trim() !== '') {
    const normalized = normalizeOrigin(applyInsteadOf(originRaw.trim(), rules));
    origin = normalized === '' ? null : normalized;
  }
  return { origin, rootName, subdirNames };
}

/** 在 cwd 下跑那一次配置读取;同一工作区读过就用记住的。git 跑不起来、报错(没有匹配项不算)→ 'git-error',不记。 */
function loadGitConfig(cwd: string, workTreeRoot: string | null): GitConfigSnapshot | 'git-error' {
  const key = workTreeRoot ?? cwd;
  const cached = configMemo.get(key);
  if (cached !== undefined) return cached;
  let out: string;
  try {
    out = execFileSync('git', ['config', '-z', '--get-regexp', CONFIG_KEYS_REGEXP], {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
  } catch (err) {
    // 退出码 1 = 没有匹配项,按空结果处理
    if ((err as { status?: unknown }).status !== 1) return 'git-error';
    out = '';
  }
  const snapshot = parseGitConfig(out);
  memoSet(configMemo, key, snapshot);
  return snapshot;
}

/**
 * 读 cwd 所在仓库的配置(基础层内部用:repo-projects.ts 列出仓库里的项目时复用同一次读取)。同一工作区读过
 * 就用记住的;git 跑不起来、报错 → 'git-error'。
 */
export function readGitConfig(cwd: string): GitConfigSnapshot | 'git-error' {
  const resolved = path.resolve(cwd);
  return loadGitConfig(resolved, findWorkTreeRoot(resolved));
}

/** 装过才按默认名字认;没装过就没有标识。 */
function defaultIdentity(root: string, subdir: string | null, origin: string | null): RememberedRoot {
  if (!isInstalled(root)) return { identity: null, nameSource: null };
  return { identity: { origin, name: defaultNameOf(root, subdir) }, nameSource: 'default' };
}

/** 按 D3 的表认标识;在 git 里时读一次配置。 */
function readRootIdentity(root: string, workTreeRoot: string | null, subdir: string | null): RememberedRoot | 'git-error' {
  if (workTreeRoot === null) {
    const name = recordedName(readLocalProjectJson(root)?.name ?? null);
    if (name !== null) return { identity: { origin: null, name }, nameSource: 'recorded' };
    return defaultIdentity(root, null, null);
  }
  const config = loadGitConfig(root, workTreeRoot);
  if (config === 'git-error') return 'git-error';
  if (subdir === null) {
    if (config.rootName !== null) return { identity: { origin: null, name: config.rootName }, nameSource: 'recorded' };
    if (config.origin !== null) return { identity: { origin: config.origin, name: null }, nameSource: null };
    return defaultIdentity(root, null, null);
  }
  const name = config.subdirNames.get(subdir);
  if (name !== undefined) return { identity: { origin: config.origin, name }, nameSource: 'recorded' };
  return defaultIdentity(root, subdir, config.origin);
}

function needsNameOf(workTreeRoot: string | null, subdir: string | null, identity: ProjectIdentity | null): boolean {
  return workTreeRoot === null || subdir !== null || identity === null || identity.origin === null;
}

/**
 * spec D3、D5:根的标识。根在 git 工作区里时在根下跑且只跑一次配置读取(同一工作区读过的不再跑);不在 git
 * 里不跑 git,名字取本地 `.cgraphx/project.json`。git 跑不起来或报错 → 'git-error',不进记忆。同一进程按
 * `path.resolve(root)` 记住标识;workTreeRoot、subdir、needsName 每次现算。
 */
export function identityOfRoot(root: string): RootIdentity | 'git-error' {
  const resolved = path.resolve(root);
  const workTreeRoot = findWorkTreeRoot(resolved);
  const subdir = workTreeRoot === null ? null : subdirOf(workTreeRoot, resolved);
  let remembered = rootMemo.get(resolved);
  if (remembered === undefined) {
    const read = readRootIdentity(resolved, workTreeRoot, subdir);
    if (read === 'git-error') return 'git-error';
    remembered = read;
    memoSet(rootMemo, resolved, remembered);
  }
  const needsName = needsNameOf(workTreeRoot, subdir, remembered.identity);
  return {
    root: resolved,
    identity: remembered.identity,
    workTreeRoot,
    subdir,
    needsName,
    nameSource: needsName ? remembered.nameSource : null,
  };
}

function sameOptionalIdentity(a: ProjectIdentity | null, b: ProjectIdentity | null): boolean {
  if (a === null || b === null) return a === b;
  return sameIdentity(a, b);
}

/**
 * spec D8:把认好的标识(会话登记、git 钩子读出来的)填进进程内记忆,之后 identityOfRoot(root) 不跑 git。
 * 和已记住的相同就不动;不同时名字一律按记下的算(按默认名字认只在现读配置时分得出)。
 */
export function rememberRootIdentity(root: string, identity: ProjectIdentity | null): void {
  const key = path.resolve(root);
  const current = rootMemo.get(key);
  if (current !== undefined && sameOptionalIdentity(current.identity, identity)) return;
  memoSet(rootMemo, key, { identity, nameSource: identity !== null && identity.name !== null ? 'recorded' : null });
}

/** 改名以后清掉这个根记住的标识和它所在工作区的配置,同进程后面的 identityOfRoot 重新读。 */
function clearRootIdentity(root: string): void {
  const resolved = path.resolve(root);
  rootMemo.delete(resolved);
  configMemo.delete(findWorkTreeRoot(resolved) ?? resolved);
}

export function identityKind(id: ProjectIdentity): IdentityKind {
  if (id.origin !== null) return id.name !== null ? 'origin+name' : 'origin';
  return 'name';
}

/** spec D18:按 origin 认 → `github.com/smdnkB/cgraphx`;按 origin 加名字 → `github.com/org/platform#server`;按名字 → 名字本身。 */
export function projectDisplayName(id: ProjectIdentity): string {
  if (id.origin !== null && id.name !== null) return `${id.origin}#${id.name}`;
  return id.origin ?? id.name ?? '';
}

export function sameIdentity(a: ProjectIdentity, b: ProjectIdentity): boolean {
  return a.origin === b.origin && a.name === b.name;
}

/** 默认名字:目录名;子目录项目取子目录最后一段。 */
export function defaultProjectName(info: RootIdentity): string {
  return defaultNameOf(info.root, info.subdir);
}

/** spec D19:去掉首尾空白;不能为空、不能有换行和控制字符、不超过 100 个字(按码点)。 */
export function validateProjectName(raw: string): { ok: true; name: string } | { ok: false; reason: string } {
  const name = raw.trim();
  if (name === '') return { ok: false, reason: '项目名称不能为空' };
  if (CONTROL_CHAR_RE.test(name)) return { ok: false, reason: '项目名称不能有换行和控制字符' };
  if ([...name].length > MAX_NAME_LENGTH) return { ok: false, reason: `项目名称不能超过 ${MAX_NAME_LENGTH} 个字` };
  return { ok: true, name };
}

/**
 * spec D3、D19:记下项目名称。根在 git 工作区里 → 写本地 git 配置(工作区根 `cgraphx.projectName`,子目录
 * 项目 `cgraphx.<子目录>.projectName`);不在 git 里且装过 → 写本地 `.cgraphx/project.json` 的 `name`;
 * 不在 git 里也没装过 → 抛错。写完清掉这个根的进程内记忆。
 */
export function writeProjectName(root: string, name: string): void {
  const resolved = path.resolve(root);
  const workTreeRoot = findWorkTreeRoot(resolved);
  if (workTreeRoot !== null) {
    const subdir = subdirOf(workTreeRoot, resolved);
    const key = subdir === null ? 'cgraphx.projectName' : `cgraphx.${subdir}.projectName`;
    try {
      execFileSync('git', ['config', '--local', key, name], {
        cwd: resolved,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new Error(`项目名称写不进 ${resolved} 的 git 配置(${key}):${msg}`);
    }
  } else if (isInstalled(resolved)) {
    updateLocalProjectJson(resolved, { name });
  } else {
    throw new Error(`${resolved} 没装过 cgraphx,也不在 git 仓库里,记不下项目名称;先在这里运行 cgraphx install`);
  }
  clearRootIdentity(resolved);
}
