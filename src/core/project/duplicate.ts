/**
 * 重名提示(spec:2026-11-06-项目按名称认 F3、D7、D8、D9;K4–K6)
 *
 * 一个目录第一次跑非隐藏的 cgraphx 命令(或 install)时判断一次:这个目录记进去的项目,在本机别的目录也记过
 * 数据(项目库 `timeline_roots` 里还有别的根)时提示一句「已经有数据(在 … 记的),这个目录也记进去」;项目和数据
 * 照样记进去,只提示,不改命令结果与退出码(spec 全局约束 2)。
 *
 * | 判定 | 做法 |
 * |---|---|
 * | K4 | 认根与数据位置:没有根 / 旧库模式 / 项目目录还没建 / 没有标识 → 不判断、不记录,下次再来 |
 * | K5 | 项目库 `timeline_roots` 里去掉这个目录自己,剩下的是「别的根」;一个都没有 → 不算重名 |
 * | K6 | 别的根里已知是同一个项目的(同一仓库的 worktree、登记过的副本、同一个地址)→ 不算重名 |
 *
 * 判过没判过只认 sessions.db 的 `dirs_checked`,不认 `timeline_roots`:命令末尾的 postAction 天然在 action 之后,
 * `timeline/cli.ts` 的 action 会先补录、新目录已经写进根,拿根判断「这个目录判断过没有」会永远不成立(每次都提示)。
 * 判断记录不过期(spec D7):删了项目、改了名字都不重判,不要顺手加清理。
 *
 * 项目记下的地址放 identity.json 的 `origins`(D8):判断时只用来认「同一个地址的另一个 clone」,追加只在本文件收尾
 * 里做;地址不参与「是不是同一个项目」的比较,那是名字的事(D1)。
 */

import * as fs from 'node:fs';
import * as path from 'node:path';

import { findProjectRoot, locateDataAtRoot } from '../data-location';
import { identityOfRoot, type RootIdentity } from '../project-identity';
import { listSiblingRoots } from '../repo-projects';
import { replicaLinkOf } from '../replica';
import { openSessionIndex, type SessionIndex } from '../session-index';
import { readTimelineSummary, type TimelineRoot } from '../timeline';
import { appendProjectOrigin, readIdentityFile } from '../user-data-dir';

/** 提示的一句话前缀(interface-standards「输出」:stderr 消息带 `[子系统]` 前缀)。 */
const NOTICE_PREFIX = '[cgraphx]';

/** 真实路径;路径不在了退回 `path.resolve`(同基础层其他地方的写法)。 */
function realpathOrResolve(p: string): string {
  try {
    return fs.realpathSync(p);
  } catch {
    return path.resolve(p);
  }
}

/** K6①:这个目录的兄弟根(同一仓库的其他 worktree)与别的根有交集。 */
function sharesWorktree(root: string, others: readonly TimelineRoot[]): boolean {
  const self = realpathOrResolve(root);
  const otherReals = new Set(others.map((item) => realpathOrResolve(item.root)));
  return listSiblingRoots(root).some((sibling) => {
    const real = realpathOrResolve(sibling);
    return real !== self && otherReals.has(real);
  });
}

/**
 * K6:别的根里已知是同一个项目的 → 不算重名。按 ①工作区 → ②登记过的副本 → ③项目还没记过地址 → ④地址已记过
 * 依次判断,命中即算同一个项目。这个目录没有地址(不在 git 里、没有 origin)时只看前两条。
 */
function knownSameProject(
  root: string,
  info: RootIdentity,
  origins: readonly string[],
  others: readonly TimelineRoot[],
): boolean {
  if (sharesWorktree(root, others)) return true;
  if (replicaLinkOf(root).state === 'replica') return true;
  if (info.origin === null) return false;
  // 项目还没记过地址:这次判断就是第一次,这个目录的地址就是项目自己的地址
  if (origins.length === 0) return true;
  return origins.includes(info.origin);
}

/** 提示原文(C-7):一行,`[cgraphx] ` 前缀在返回值里;路径用别的根的原值,不缩成 `~`。 */
function duplicateNotice(name: string, otherRoot: string): string {
  return (
    `${NOTICE_PREFIX} ${name} 已经有数据(在 ${otherRoot} 记的),这个目录也记进去,数据库连接配置也共用;` +
    '不是同一个项目的话,运行 cgraphx project name 新名字'
  );
}

/**
 * 收尾(C-6 第 8 步):走到这里的每个分支都做——项目地址追加进 `origins`、这个目录记进 `dirs_checked`。各自
 * try/catch 吞掉失败:写不上只导致下次再判断一次,不能让提示消失或命令失败。
 */
function rememberChecked(
  index: SessionIndex,
  key: string,
  dataDir: string,
  info: RootIdentity,
  origins: readonly string[],
): void {
  if (info.origin !== null && !origins.includes(info.origin)) {
    try {
      appendProjectOrigin(dataDir, info.origin);
    } catch {
      // 写不上 identity.json:下次再追加
    }
  }
  try {
    index.recordDirChecked(key);
  } catch {
    // 写不上判断记录:下次再判断一次(可能重复提示一次)
  }
}

/** 项目库里的根(最近活动在前);库读不出 → null(判断不成立,下次再来)。 */
function projectRoots(dataDir: string): readonly TimelineRoot[] | null {
  try {
    return readTimelineSummary(dataDir)?.roots ?? [];
  } catch {
    return null;
  }
}

/**
 * spec F3 / C-6:这个目录第一次判断重名,重名就返回给命令末尾或 install 的提示(一行,`[cgraphx] ` 开头),否则 null。
 * 判断本身不吞异常(调用方 try/catch,提示失败不影响命令);收尾的两处写失败自己吞。
 *
 * 不记录的分支:K4 任一条件不满足、已经判过、git 出错、项目库读失败——这些都留着下次再判断,否则就再没机会提示。
 */
export function checkDuplicateName(start: string): string | null {
  const root = findProjectRoot(start);
  if (root === null) return null;
  const loc = locateDataAtRoot(root);
  const { dataDir, projectDirName, identity } = loc;
  if (loc.mode === 'legacy' || dataDir === null || projectDirName === null || identity === null) return null;

  const key = realpathOrResolve(root);
  const index = openSessionIndex();
  try {
    if (index.dirCheckedAt(key) !== null) return null;

    const info = identityOfRoot(root);
    if (info === 'git-error') return null;

    const roots = projectRoots(dataDir);
    if (roots === null) return null;

    const others = roots.filter((item) => realpathOrResolve(item.root) !== key);
    const origins = readIdentityFile(dataDir)?.origins ?? [];
    const otherRoot = others[0]?.root ?? null;
    const notice =
      otherRoot !== null && !knownSameProject(root, info, origins, others)
        ? duplicateNotice(identity.name, otherRoot)
        : null;

    rememberChecked(index, key, dataDir, info, origins);
    return notice;
  } finally {
    index.close();
  }
}
