/**
 * 任务的产出与参考(cgraphx-web开发任务浏览 spec §5、§6)。
 *
 * 全部从归属事件与需求目录在查询时派生,不存储;只判断文件是否存在,不读内容。
 * 路径一律归一为项目相对 POSIX 路径,只保留项目根内、当前存在的普通文件。
 */

import fs from 'node:fs';
import path from 'node:path';

import type { TimelineEvent } from '../timeline';
import { ARTIFACT_CATEGORIES, REFERENCE_CATEGORIES } from './constants';
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
  if (relPath.startsWith('docs/features/')) return 'feature-doc';
  if (relPath.startsWith('docs/knowledge/')) return 'knowledge';
  if (relPath.startsWith('docs/schema-knowledge/') || relPath.endsWith('.sql')) return 'schema';
  if (relPath.startsWith('docs/code-map/') || relPath.startsWith('docs/design-map/')) return 'diagram';
  if (relPath.startsWith('docs/bruno/')) return 'api-test';
  return 'code';
}

/**
 * 候选路径 → 项目相对 POSIX 路径;项目外、含 `..`、不存在或不是普通文件 → null。
 * 绝对路径须位于项目根内;相对路径按项目根解析。
 */
function normalizeProjectFile(rootAbs: string, candidate: string): string | null {
  if (candidate === '') return null;
  let rel: string;
  if (path.isAbsolute(candidate)) {
    if (!candidate.startsWith(rootAbs + path.sep)) return null;
    rel = candidate.slice(rootAbs.length + 1);
  } else {
    rel = candidate.startsWith('./') ? candidate.slice(2) : candidate;
  }
  rel = rel.split(path.sep).join('/');
  if (rel === '' || rel.split('/').some((seg) => seg === '..' || seg === '')) return null;
  try {
    return fs.statSync(path.join(rootAbs, rel)).isFile() ? rel : null;
  } catch {
    return null;
  }
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

/** spec §5.1:commit 文件 + 写类工具目标文件 + 关联需求目录下的文件,合并去重。 */
export function collectOutputs(projectRoot: string, events: TimelineEvent[], featureDirs: string[]): ArtifactGroup[] {
  const rootAbs = path.resolve(projectRoot);
  const found = new Set<string>();
  const add = (candidate: string | null): void => {
    if (candidate === null) return;
    const rel = normalizeProjectFile(rootAbs, candidate);
    if (rel !== null) found.add(rel);
  };

  for (const e of events) {
    if (e.event_type === 'git_commit') {
      for (const f of e.commit_files) add(f);
    } else if (e.tool_name !== null && EDIT_TOOLS.has(e.tool_name)) {
      add(e.tool_name === 'NotebookEdit' ? (argString(e, 'notebook_path') ?? argString(e, 'file_path')) : argString(e, 'file_path'));
    }
  }
  for (const dir of featureDirs) {
    for (const f of listFilesRecursive(rootAbs, dir)) add(f);
  }
  return groupPaths(found, ARTIFACT_CATEGORIES);
}

/** spec §6.1、§6.2:工具读取路径 + Bash 命令文本中的路径 + docs 概念查询;outputPaths 为产出中的全部路径。 */
export function collectReferences(
  projectRoot: string,
  events: TimelineEvent[],
  outputPaths: ReadonlySet<string>,
): ReferenceReport {
  const rootAbs = path.resolve(projectRoot);
  const found = new Set<string>();
  const concepts: string[] = [];
  const add = (candidate: string | null): void => {
    if (candidate === null) return;
    const rel = normalizeProjectFile(rootAbs, candidate);
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
