/**
 * 任务的产出与参考(cgraphx-web开发任务浏览 spec §5、§6)。
 *
 * 全部从归属事件与需求目录在查询时派生,不存储;只判断文件是否存在,不读内容。
 * 路径一律归一为项目相对 POSIX 路径,只保留项目内、当前存在的普通文件。
 *
 * 「项目内」按 timeline 记下的根 + 当前根 + 副本登记换算(spec:2026-11-05-数据按项目放用户目录 D11):
 * 绝对路径取所在的根;相对路径按当前根解析,提交里的文件按提交所在的根解析;文件先在所在的根里找,
 * 根已不在(副本删了、目录挪走了)再到当前根里找。
 */

import fs from 'node:fs';
import path from 'node:path';

import { FEATURES_DIR_POSIX, SEDIMENT_TYPE_ROOTS } from '../artifact-registry';
import { locateFeatureRoot, matchProjectRoot, replicaOfCwd, type ProjectRoot } from '../replica';
import type { TimelineEvent } from '../timeline';
import { ARTIFACT_CATEGORIES, REFERENCE_CATEGORIES } from './constants';
import type { ProjectRootSet } from './roots';
import type { ArtifactCategory, ArtifactGroup, ReferenceReport } from './types';

/** 写类工具(产出来源 ②)。 */
const EDIT_TOOLS = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit']);

/** Bash 命令文本切分候选路径的分隔符。 */
const COMMAND_TOKEN_SPLIT = /[\s'"`|;&<>()=,]+/;

/** 命令中含独立词 docs 才视为 cgraphx docs 命令。 */
const DOCS_COMMAND = /(^|\s)docs\s/;

/** --concept=<名> / --concept <名>,名可带引号。 */
const CONCEPT_ARG = /--concept(?:=|\s+)(?:"([^"]+)"|'([^']+)'|([^\s"'|;&]+))/g;

/** spec §5.2,先命中先用;relPath 为项目相对 POSIX 路径。 */
export function classifyArtifactPath(relPath: string): ArtifactCategory {
  if (relPath.startsWith(FEATURES_DIR_POSIX + '/')) return 'feature-doc';
  if (relPath.startsWith(SEDIMENT_TYPE_ROOTS.knowledge)) return 'knowledge';
  if (
    relPath.startsWith(SEDIMENT_TYPE_ROOTS.schema_knowledge) ||
    relPath.endsWith('.sql')
  ) {
    return 'schema';
  }
  if (
    relPath.startsWith(SEDIMENT_TYPE_ROOTS.code_map) ||
    relPath.startsWith(SEDIMENT_TYPE_ROOTS.design_map)
  ) {
    return 'diagram';
  }
  if (relPath.startsWith('docs/bruno/')) return 'api-test';
  return 'code';
}

/** 一次收集用的根:调用方一轮取一次根汇总传进来,不按文件取。 */
interface RootContext {
  currentRoot: string;
  /** timeline 记下的根 + 当前根 + 副本登记(含已删除),collectProjectRoots 的结果。 */
  roots: readonly ProjectRoot[];
  /** 根目录还在不在,按根缓存。 */
  present: Map<string, boolean>;
}

function rootContext(rootSet: ProjectRootSet): RootContext {
  return { currentRoot: path.resolve(rootSet.currentRoot), roots: rootSet.roots, present: new Map() };
}

/** p 是目录(跟随链接);不在、读不了 → false。 */
function isDirectory(p: string): boolean {
  try {
    return fs.statSync(p, { throwIfNoEntry: false })?.isDirectory() === true;
  } catch {
    return false;
  }
}

/** 判断文件存在用的根:当前根或还在的根 → 它自己;根已不在 → 当前根。 */
function existenceRoot(ctx: RootContext, root: string): string {
  if (root === ctx.currentRoot) return root;
  let present = ctx.present.get(root);
  if (present === undefined) {
    present = isDirectory(root);
    ctx.present.set(root, present);
  }
  return present ? root : ctx.currentRoot;
}

/** POSIX 分隔。 */
function toPosix(p: string): string {
  return p.split(path.sep).join('/');
}

/** POSIX 路径含 `..` 或空段(含空串、`//`、结尾 `/`)。 */
function hasUnsafeSegment(posixPath: string): boolean {
  return posixPath.split('/').some((seg) => seg === '..' || seg === '');
}

/**
 * 候选路径 → 项目相对 POSIX 路径;不在任何根内、含 `..` 或空段、不存在或不是普通文件 → null。
 * 绝对路径按所在的根换算;相对路径按 relativeRoot 解析(缺省当前根)。
 */
function normalizeProjectFile(
  ctx: RootContext,
  candidate: string,
  relativeRoot: string = ctx.currentRoot,
): string | null {
  if (candidate === '') return null;
  let root: string;
  let rel: string;
  if (path.isAbsolute(candidate)) {
    // 原样路径里的 `..`、空段照旧丢弃(换算时 path.resolve 会把它们规整掉)
    if (hasUnsafeSegment(toPosix(candidate.slice(path.parse(candidate).root.length)))) return null;
    const hit = matchProjectRoot(ctx.roots, candidate);
    if (hit === null) return null;
    root = hit.root.root;
    rel = hit.rel;
  } else {
    root = relativeRoot;
    rel = toPosix(candidate.startsWith('./') ? candidate.slice(2) : candidate);
    if (hasUnsafeSegment(rel)) return null;
  }
  try {
    return fs.statSync(path.join(existenceRoot(ctx, root), rel)).isFile() ? rel : null;
  } catch {
    return null;
  }
}

/** 提交所在的根:cwd 落在副本里 → 副本目录,否则当前根。 */
function commitRootOf(ctx: RootContext, e: TimelineEvent): string {
  const replica = replicaOfCwd(ctx.roots, e.cwd);
  return replica === null ? ctx.currentRoot : path.resolve(replica.path);
}

/** 需求目录 `docs/features/<id>` 所在的根(locateFeatureRoot,带当前根);不是需求目录或哪里都没有 → 当前根。 */
function featureRootOf(ctx: RootContext, dir: string): string {
  const prefix = `${FEATURES_DIR_POSIX}/`;
  if (!dir.startsWith(prefix)) return ctx.currentRoot;
  return locateFeatureRoot(ctx.roots, dir.slice(prefix.length), ctx.currentRoot) ?? ctx.currentRoot;
}

/** 取 tool_args 中的字符串字段。 */
function argString(e: TimelineEvent, key: string): string | null {
  if (e.tool_args === null || typeof e.tool_args !== 'object') return null;
  const v = (e.tool_args as Record<string, unknown>)[key];
  return typeof v === 'string' ? v : null;
}

/** 目录下递归的全部普通文件(不跟随符号链接),返回项目相对 POSIX 路径。 */
function listFilesRecursive(rootAbs: string, relDir: string): string[] {
  const out: string[] = [];
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(path.join(rootAbs, relDir), { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    const rel = `${relDir}/${entry.name}`;
    if (entry.isDirectory()) out.push(...listFilesRecursive(rootAbs, rel));
    else if (entry.isFile()) out.push(rel);
  }
  return out;
}

/** 路径集合 → 按 ARTIFACT_CATEGORIES 顺序的非空分组,组内升序。 */
function groupPaths(paths: Iterable<string>, allowed: readonly ArtifactCategory[]): ArtifactGroup[] {
  const byCategory = new Map<ArtifactCategory, string[]>();
  for (const p of paths) {
    const category = classifyArtifactPath(p);
    if (!allowed.includes(category)) continue;
    const list = byCategory.get(category) ?? [];
    list.push(p);
    byCategory.set(category, list);
  }
  return ARTIFACT_CATEGORIES.filter((c) => byCategory.has(c)).map((category) => ({
    category,
    paths: [...new Set(byCategory.get(category))].sort(),
  }));
}

/**
 * spec §5.1:commit 文件 + 写类工具目标文件 + 关联需求目录下的文件,合并去重。
 * commit 文件按提交所在的根解析(副本里还没合入的文件也算产出);需求目录在它所在的根里列。
 * rootSet 是调用方这一轮取的根汇总(collectProjectRoots)。
 */
export function collectOutputs(rootSet: ProjectRootSet, events: TimelineEvent[], featureDirs: string[]): ArtifactGroup[] {
  const ctx = rootContext(rootSet);
  const found = new Set<string>();
  const add = (candidate: string | null, relativeRoot?: string): void => {
    if (candidate === null) return;
    const rel = normalizeProjectFile(ctx, candidate, relativeRoot);
    if (rel !== null) found.add(rel);
  };

  for (const e of events) {
    if (e.event_type === 'git_commit') {
      const commitRoot = commitRootOf(ctx, e);
      for (const f of e.commit_files) add(f, commitRoot);
    } else if (e.tool_name !== null && EDIT_TOOLS.has(e.tool_name)) {
      add(e.tool_name === 'NotebookEdit' ? (argString(e, 'notebook_path') ?? argString(e, 'file_path')) : argString(e, 'file_path'));
    }
  }
  for (const dir of featureDirs) {
    const featureRoot = featureRootOf(ctx, dir);
    for (const f of listFilesRecursive(featureRoot, dir)) add(f, featureRoot);
  }
  return groupPaths(found, ARTIFACT_CATEGORIES);
}

/**
 * spec §6.1、§6.2:工具读取路径 + Bash 命令文本中的路径 + docs 概念查询;outputPaths 为产出中的全部路径。
 * rootSet 是调用方这一轮取的根汇总(collectProjectRoots)。
 */
export function collectReferences(
  rootSet: ProjectRootSet,
  events: TimelineEvent[],
  outputPaths: ReadonlySet<string>,
): ReferenceReport {
  const ctx = rootContext(rootSet);
  const found = new Set<string>();
  const concepts: string[] = [];
  const add = (candidate: string | null): void => {
    if (candidate === null) return;
    const rel = normalizeProjectFile(ctx, candidate);
    if (rel !== null && (REFERENCE_CATEGORIES as readonly string[]).includes(classifyArtifactPath(rel))) {
      found.add(rel);
    }
  };

  for (const e of events) {
    switch (e.tool_name) {
      case 'Read':
        add(argString(e, 'file_path'));
        break;
      case 'Grep':
      case 'Glob':
        add(argString(e, 'path'));
        break;
      case 'Bash': {
        const command = argString(e, 'command');
        if (command === null) break;
        // 含 $ 的是 shell 变量 / 展开,不是字面路径或概念名,跳过
        for (const token of command.split(COMMAND_TOKEN_SPLIT)) if (!token.includes('$')) add(token);
        if (DOCS_COMMAND.test(command)) {
          for (const m of command.matchAll(CONCEPT_ARG)) {
            const name = m[1] ?? m[2] ?? m[3];
            if (name !== undefined && !name.includes('$') && !concepts.includes(name)) concepts.push(name);
          }
        }
        break;
      }
      default:
        break;
    }
  }

  let overlapCount = 0;
  const referenced: string[] = [];
  for (const p of found) {
    if (outputPaths.has(p)) overlapCount++;
    else referenced.push(p);
  }
  return { groups: groupPaths(referenced, REFERENCE_CATEGORIES), concepts, overlapCount };
}
