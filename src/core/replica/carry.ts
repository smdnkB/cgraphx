/**
 * 带进副本的文件与对 git 隐藏(spec:2026-11-06-副本改用worktree D2、D3、D4、K4、K16;plan C-3)。
 *
 * worktree 只签出被跟踪的内容,agent 配置与本地配置全在主目录里。这里按固定顺序做三件事:
 *
 * 1. K4:各 agent 的配置目录、指引文件、额外配置文件里没被跟踪的部分(被忽略的一起带,
 *    `.claude/` 这类目录整个带过去)——被跟踪的那部分在 worktree 里本来就有;
 * 2. K16:主目录 `.worktreeinclude` 里写的文件(清单模式就是全部匹配来源);
 * 3. D4:把这些带进来的文件写进副本自己的 `core.excludesFile`,对 git 藏起来——否则它们会成为
 *    副本里没被跟踪的改动,K9 永远不干净。
 *
 * 不写主目录的 `.git/info/exclude`:worktree 共用那份,写进去会连主目录一起盖住。只写副本自己的
 * `.cgraphx/replica-exclude`,并先在主仓库开 `extensions.worktreeConfig`(per-worktree 配置的前提)。
 * 所有 git 命令都带 cwd/`-C`,源与目标路径都拼绝对路径,不看进程当前目录。
 */

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { agentReplicaPaths, listAgentProfiles } from '../agents';
import { codeGraphDirName, getCodeGraphDir } from '../directory';
import { gitPathPattern } from '../git-hooks';
import { listWorktreeRoots } from '../repo-projects';
import { WORKTREE_INCLUDE_NAME } from './constants';
import { firstLine, runGit } from './status';

/** 副本里本地 `core.excludesFile` 的文件名(放在副本 `.cgraphx/` 下)。 */
const REPLICA_EXCLUDE_NAME = 'replica-exclude';

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** 跑一条 git 命令,非零退出直接抛(消息带命令和 git 原话)。 */
function gitOrThrow(cwd: string, args: readonly string[]): string {
  const r = runGit(cwd, args);
  if (r.status !== 0) {
    throw new Error(`git ${args.join(' ')} 失败:${r.error?.message ?? firstLine(r.stderr)}`);
  }
  return r.stdout;
}

/** git `-z` 输出按 NUL 切成路径,去掉空项。 */
function nulList(out: string): string[] {
  return out.split('\0').filter((s) => s !== '');
}

/** 去掉末尾的 `/`(`--directory` 把整个没被跟踪的目录列成 `目录/`)。 */
function stripTrailingSlash(rel: string): string {
  return rel.replace(/\/+$/, '');
}

/** 要带的 agent 配置:各家的配置目录、指引文件、额外配置文件,去重。 */
function agentConfigPaths(mainRoot: string): string[] {
  const paths = new Set<string>();
  for (const profile of listAgentProfiles()) {
    for (const file of agentReplicaPaths(mainRoot, profile)) paths.add(file);
  }
  return [...paths];
}

/**
 * 主目录所在仓库各个 worktree 根的真实路径;`git worktree list` 出错 → null(这时不跳过任何东西)。
 * 用来跳过 agent 自己开的 worktree:`--directory` 列到的目录里可能嵌着别的 worktree,整个拷进副本
 * 既没意义又会把它的 .git 文件带歪。
 */
function worktreeRootReals(mainRoot: string): Set<string> | null {
  const roots = listWorktreeRoots(mainRoot);
  if (roots === null) return null;
  const reals = new Set<string>();
  for (const root of roots) {
    try {
      reals.add(fs.realpathSync(root));
    } catch {
      // 不在了的根没有可跳过的目录
    }
  }
  return reals;
}

/** 把主目录里的相对路径 rel 拷到副本的同一相对位置;目标父目录不存在先建。 */
function copyInto(mainRoot: string, target: string, rel: string, skip: Set<string> | null): void {
  const source = path.join(mainRoot, rel);
  const destination = path.join(target, rel);
  try {
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.cpSync(source, destination, {
      recursive: true,
      // 链接原样带过去,不改成指向副本里的东西
      verbatimSymlinks: true,
      ...(skip === null
        ? {}
        : {
            filter: (entry: string): boolean => {
              try {
                return !skip.has(fs.realpathSync(entry));
              } catch {
                return true;
              }
            },
          }),
    });
  } catch (err) {
    throw new Error(`把 ${rel} 拷进副本失败:${errorMessage(err)}`);
  }
}

/** K4:带上没被跟踪的 agent 配置;返回实际拷过的相对路径。 */
function carryAgentConfigs(mainRoot: string, target: string): string[] {
  // 不加 --exclude-standard:被忽略的配置(`.env`、`.claude/`)也要带,只看「没被跟踪」
  const paths = agentConfigPaths(mainRoot);
  if (paths.length === 0) return [];
  const listed = nulList(gitOrThrow(mainRoot, ['ls-files', '-z', '--others', '--directory', '--', ...paths]));
  const skip = worktreeRootReals(mainRoot);
  const carried: string[] = [];
  for (const item of listed) {
    const rel = stripTrailingSlash(item);
    if (rel === '') continue;
    copyInto(mainRoot, target, rel, skip);
    carried.push(rel);
  }
  return carried;
}

/**
 * 读清单文件的行(C-8):空行、`#` 开头的注释行去掉;保留 `!` 开头的行(照常交给 `--exclude-from`
 * 生效,只是不参与「主目录没有」的判断)。文件不在 → null(什么都不带、不提示);读不了 → 抛。
 */
function readManifestLines(mainRoot: string): string[] | null {
  const file = path.join(mainRoot, WORKTREE_INCLUDE_NAME);
  if (fs.lstatSync(file, { throwIfNoEntry: false }) === undefined) return null;
  let text: string;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch (err) {
    throw new Error(`读不了主目录下的 ${WORKTREE_INCLUDE_NAME}:${errorMessage(err)}`);
  }
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line !== '' && !line.startsWith('#'));
}

/**
 * 清单里的一行主目录有没有(C-8):先看有没有被它忽略的文件,没有再看已跟踪的(按 pathspec 通配匹配,
 * `*.txt` 这类行才对得上)。第二条命令非零退出(路径在仓库外等)按空处理。
 */
function manifestLineExists(mainRoot: string, line: string): boolean {
  const ignored = runGit(mainRoot, ['ls-files', '-z', '--others', '--ignored', `--exclude=${line}`]);
  if (ignored.status !== 0) {
    throw new Error(`git ls-files --exclude=${line} 失败:${firstLine(ignored.stderr)}`);
  }
  if (ignored.stdout !== '') return true;
  const tracked = runGit(mainRoot, ['ls-files', '-z', '--', line]);
  return tracked.status === 0 && tracked.stdout !== '';
}

/**
 * 清单里主目录没有的行(W2):只报,不抛。`!` 开头的行跳过(`!` 只用来取消清单里别的行的忽略)。
 */
function missingManifestLines(mainRoot: string, lines: readonly string[]): string[] {
  const warnings: string[] = [];
  for (const line of lines) {
    if (line.startsWith('!')) continue;
    if (manifestLineExists(mainRoot, line)) continue;
    warnings.push(`清单里的 ${line} 主目录没有,没带`);
  }
  return warnings;
}

/**
 * K16:按清单把文件带进副本;返回拷过的相对路径和清单里主目录没有的行(W2)。`.cgraphx/` 下的不带
 * (副本有自己的数据目录)。注意不能配 `--exclude-standard`:那样 `.gitignore` 忽略的 `node_modules`
 * 会一起带进来,清单的模式才是全部匹配来源。
 */
function carryManifestFiles(mainRoot: string, target: string): { carried: string[]; warnings: string[] } {
  const lines = readManifestLines(mainRoot);
  if (lines === null || lines.length === 0) return { carried: [], warnings: [] };
  const listed = nulList(
    gitOrThrow(mainRoot, ['ls-files', '-z', '--others', '--ignored', `--exclude-from=${WORKTREE_INCLUDE_NAME}`]),
  );
  const localDirPrefix = `${codeGraphDirName()}/`;
  const carried: string[] = [];
  for (const item of listed) {
    const rel = stripTrailingSlash(item);
    if (rel === '' || rel.startsWith(localDirPrefix)) continue;
    copyInto(mainRoot, target, rel, null);
    carried.push(rel);
  }
  return { carried, warnings: missingManifestLines(mainRoot, lines) };
}

/** `~/` 开头的配置值展开成家目录(git 读 core.excludesFile 时会展开,`git config --get` 给的是原样)。 */
function expandHome(value: string): string {
  if (value === '~') return os.homedir();
  if (value.startsWith('~/')) return path.join(os.homedir(), value.slice(2));
  return value;
}

/** 用户级忽略文件(C-3):`core.excludesFile` → `$XDG_CONFIG_HOME/git/ignore` → `~/.config/git/ignore`。 */
function userExcludeFile(mainRoot: string): string {
  const configured = runGit(mainRoot, ['config', '--get', 'core.excludesFile']);
  if (configured.status === 0) {
    const value = configured.stdout.replace(/\r?\n$/, '').trim();
    // 配了相对路径时按 git 的 cwd(主目录)算,不按本进程的 cwd
    if (value !== '') return path.resolve(mainRoot, expandHome(value));
  }
  const xdg = process.env.XDG_CONFIG_HOME;
  if (xdg !== undefined && xdg.trim() !== '') return path.join(xdg, 'git', 'ignore');
  return path.join(os.homedir(), '.config', 'git', 'ignore');
}

/** 读文件;读不到按空串(用户级忽略文件不存在很常见)。 */
function readTextOrEmpty(file: string): string {
  try {
    return fs.readFileSync(file, 'utf8');
  } catch {
    return '';
  }
}

/**
 * 副本 `core.excludesFile` 的内容:用户级忽略文件原文(有内容且末尾没换行补一个),加上每个可见项
 * 写成只匹配它自己的一行。
 */
function excludeFileContent(mainRoot: string, visible: readonly string[]): string {
  const base = readTextOrEmpty(userExcludeFile(mainRoot));
  const head = base === '' || base.endsWith('\n') ? base : `${base}\n`;
  const lines = visible.map((rel) => gitPathPattern(stripTrailingSlash(rel)));
  return `${head}${lines.join('\n')}\n`;
}

/**
 * D4:把带进来的文件对 git 藏起来。只查实际带进来的相对路径 + `.cgraphx`(不拿清单原行当 pathspec:
 * `../out` 会让 git 以 128 退出);一个可见项都没有 → 什么都不改。
 *
 * `.cgraphx` 必须一起查:它里面的 `.gitignore` 是 `*` + `!.gitignore`,项目根没忽略 `.cgraphx/`
 * 时它自己会被列出来,K10 就永远不干净。
 */
function hideCarriedFiles(mainRoot: string, target: string, carried: readonly string[]): void {
  const specs = [...new Set([...carried, codeGraphDirName()])].map((rel) => `:(literal)${rel}`);
  const visible = nulList(
    gitOrThrow(target, ['ls-files', '-z', '--others', '--exclude-standard', '--directory', '--', ...specs]),
  );
  if (visible.length === 0) return;
  const excludeFile = path.join(getCodeGraphDir(target), REPLICA_EXCLUDE_NAME);
  fs.writeFileSync(excludeFile, excludeFileContent(mainRoot, visible), 'utf8');
  // per-worktree 配置的前提:不开就会写进共享配置,后面的 --worktree 也直接失败
  gitOrThrow(mainRoot, ['config', 'extensions.worktreeConfig', 'true']);
  gitOrThrow(target, ['config', '--worktree', 'core.excludesFile', excludeFile]);
}

/**
 * 把 agent 配置(K4)与 `.worktreeinclude` 里的文件(K16)带进副本,再把这些文件对 git 藏起来(D4),
 * 顺序固定。git 命令非零退出、文件拷不过去直接抛(由 createReplica 回滚);清单里某行主目录没有
 * 只进 warnings(W2)。
 */
export function carryIntoReplica(mainRoot: string, target: string): { warnings: string[] } {
  const configs = carryAgentConfigs(mainRoot, target);
  const manifest = carryManifestFiles(mainRoot, target);
  hideCarriedFiles(mainRoot, target, [...configs, ...manifest.carried]);
  return { warnings: manifest.warnings };
}
