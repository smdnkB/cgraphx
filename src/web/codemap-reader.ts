/**
 * 代码地图读取层(spec §2 / §3.2 / §3.5 / §4 / §5 / §7,2026-10-14-cgraphx-web系统地图)。
 *
 * 纯数据读取:从 `docs/code-map/` 目录树读视图文件 + 问 git 是否过期,web 其他
 * 文件只经本模块拿代码地图数据。形态同 schema-reader.ts:
 * - 只用 `node:fs` / `node:path` / `node:child_process`,**不** import `src/core/db`;
 * - 不写任何文件;git 只调 `diff`(只读查询,不改变仓库状态);
 * - 每次调用现读文件、现跑 git,不缓存(spec §3.5 新鲜度)。
 *
 * 文件定位(契约 2):system = 根目录全部 `*.md`(不递归);flow = `flows/*.md`。
 * 过期口径(契约 3)与 code-map-recall skill 的 `git diff` 一致,不含其 `git status`
 * 一项:只看已提交改动。
 */

import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';

import { parseFrontmatter, stripFrontmatter } from '../core/markdown';
import { CODE_MAP_DIR, CODE_MAP_FLOWS_SUBDIR, CODE_MAP_GIT_TIMEOUT_MS } from './constants';

/** 视图种类:system = 系统交互,flow = 流程视图。 */
export type CodemapKind = 'system' | 'flow';

/** 过期判定三态:fresh 未过期 / stale 已过期(附改动文件)/ unknown 无法判断。 */
export type StaleResult =
  | { state: 'fresh' }
  | { state: 'stale'; changedFiles: string[] }
  | { state: 'unknown' };

/** 列表与详情共用的视图条目(纯数据)。 */
export interface CodemapViewEntry {
  kind: CodemapKind;
  /** 文件名去 .md,即 URL 中的 <name>。 */
  name: string;
  /** 含 .md,用于坏文件展示。 */
  fileName: string;
  /** 有 frontmatter 且 title 非空。 */
  parseOk: boolean;
  title: string | null;
  /** 正文「## 一句话」节内容(trim,取到下一个 # 标题前)。 */
  summary: string | null;
  generated: string | null;
  sourceCommit: string | null;
  entry: string | null;
  provider: string | null;
  concepts: string[];
  /** parseOk=false 时固定 unknown,不跑 git。 */
  stale: StaleResult;
}

/** 首页列表:系统交互区 + 流程区。 */
export interface CodemapListing {
  systems: CodemapViewEntry[];
  flows: CodemapViewEntry[];
}

/** 视图详情:条目 + 去掉 frontmatter 后的正文。 */
export interface CodemapViewDetail {
  entry: CodemapViewEntry;
  body: string;
}

/**
 * 单层名合法性(与 server.ts 的 isSafeSchemaName 同口径)。
 *
 * 拒绝:空 / `.` / `..` / 含路径分隔符 / 含 `..` 子串 / 含 NUL。
 */
export function isSafeCodemapName(name: string): boolean {
  if (name === '' || name === '.' || name === '..') return false;
  if (name.includes('/') || name.includes('\\')) return false;
  if (name.includes('\0')) return false;
  if (name.includes('..')) return false;
  return true;
}

/** 某种视图所在目录的绝对路径。 */
function kindDir(projectRoot: string, kind: CodemapKind): string {
  const root = path.join(projectRoot, CODE_MAP_DIR);
  return kind === 'system' ? root : path.join(root, CODE_MAP_FLOWS_SUBDIR);
}

/** 是否为存在的目录(任何 fs 错误视为否)。 */
function isDir(p: string): boolean {
  try {
    return fs.statSync(p).isDirectory();
  } catch {
    return false;
  }
}

/**
 * 列表字段宽松读取。core 的 frontmatter 解析器把 `concepts: []` 解析为字符串
 * `"[]"`(core 的 readList 会因此抛错),故在此兜底:数组原样;`''` / `'[]'` → [];
 * 其他字符串 → 单元素数组;缺失 → []。
 */
function toList(v: string | string[] | undefined): string[] {
  if (v === undefined) return [];
  if (Array.isArray(v)) return v.filter((s) => s.trim() !== '');
  const s = v.trim();
  if (s === '' || s === '[]') return [];
  return [s];
}

/** 标量字段:非空字符串 → 值;否则 null(列表取首项)。 */
function toScalar(v: string | string[] | undefined): string | null {
  if (v === undefined) return null;
  const s = (Array.isArray(v) ? (v[0] ?? '') : v).trim();
  return s === '' ? null : s;
}

/** 提取正文「## 一句话」节内容;没有该节或内容为空 → null。 */
function extractSummary(body: string): string | null {
  const lines = body.split('\n');
  const start = lines.findIndex((l) => /^##\s+一句话\s*$/.test(l.trim()));
  if (start === -1) return null;
  const out: string[] = [];
  for (let i = start + 1; i < lines.length; i++) {
    const line = lines[i] ?? '';
    if (/^#{1,6}\s/.test(line)) break;
    out.push(line);
  }
  const text = out.join('\n').trim();
  return text === '' ? null : text;
}

/**
 * 过期判定(契约 3):`git diff --name-only <source_commit> HEAD -- <related_code...>`。
 * 输出非空 → stale;空 → fresh;命令失败 / 超时 / 缺字段 → unknown。
 */
function checkStale(projectRoot: string, sourceCommit: string | null, relatedCode: string[]): StaleResult {
  if (sourceCommit === null || relatedCode.length === 0) return { state: 'unknown' };
  try {
    const out = execFileSync('git', ['diff', '--name-only', sourceCommit, 'HEAD', '--', ...relatedCode], {
      cwd: projectRoot,
      encoding: 'utf-8',
      timeout: CODE_MAP_GIT_TIMEOUT_MS,
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    const changedFiles = out.split('\n').map((l) => l.trim()).filter((l) => l !== '');
    return changedFiles.length > 0 ? { state: 'stale', changedFiles } : { state: 'fresh' };
  } catch {
    // 非 git 仓库 / 无 git / commit 不存在(含多子工程格式)→ 无法判断。
    return { state: 'unknown' };
  }
}

/** 读一个视图文件为条目 + 正文;文件不可读 → null。 */
function readEntry(projectRoot: string, kind: CodemapKind, fileName: string): CodemapViewDetail | null {
  let raw: string;
  try {
    raw = fs.readFileSync(path.join(kindDir(projectRoot, kind), fileName), 'utf-8');
  } catch {
    return null;
  }
  const name = fileName.slice(0, -'.md'.length);
  const broken: CodemapViewEntry = {
    kind, name, fileName, parseOk: false,
    title: null, summary: null, generated: null, sourceCommit: null,
    entry: null, provider: null, concepts: [], stale: { state: 'unknown' },
  };

  let values: Map<string, string | string[]>;
  try {
    values = parseFrontmatter(raw).values;
  } catch {
    return { entry: broken, body: '' };
  }
  const title = toScalar(values.get('title'));
  if (title === null) return { entry: broken, body: '' };

  const body = stripFrontmatter(raw);
  const sourceCommit = toScalar(values.get('source_commit'));
  return {
    entry: {
      kind, name, fileName, parseOk: true,
      title,
      summary: extractSummary(body),
      generated: toScalar(values.get('generated')),
      sourceCommit,
      entry: toScalar(values.get('entry')),
      provider: toScalar(values.get('provider')),
      concepts: toList(values.get('concepts')),
      stale: checkStale(projectRoot, sourceCommit, toList(values.get('related_code'))),
    },
    body,
  };
}

/** 列出某种视图的全部条目(目录不存在 → []),按 name 中文排序。 */
function listKind(projectRoot: string, kind: CodemapKind): CodemapViewEntry[] {
  const dir = kindDir(projectRoot, kind);
  let names: string[];
  try {
    names = fs.readdirSync(dir, { withFileTypes: true })
      .filter((d) => d.isFile() && d.name.endsWith('.md'))
      .map((d) => d.name);
  } catch {
    return [];
  }
  return names
    .map((f) => readEntry(projectRoot, kind, f)?.entry)
    .filter((e): e is CodemapViewEntry => e !== undefined)
    .sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'));
}

/** 首页列表。`docs/code-map/` 不存在或不是目录 → null;坏文件也在列表中(parseOk=false)。 */
export function listCodemapViews(projectRoot: string): CodemapListing | null {
  if (!isDir(path.join(projectRoot, CODE_MAP_DIR))) return null;
  return {
    systems: listKind(projectRoot, 'system'),
    flows: listKind(projectRoot, 'flow'),
  };
}

/** 视图详情。名字不安全 / 文件不存在 / 格式无法解析 → null。 */
export function readCodemapView(projectRoot: string, kind: CodemapKind, name: string): CodemapViewDetail | null {
  if (!isSafeCodemapName(name)) return null;
  const detail = readEntry(projectRoot, kind, `${name}.md`);
  if (detail === null || !detail.entry.parseOk) return null;
  return detail;
}

/** 按概念反查:parseOk 且 concepts 与入参有交集的视图,systems 在前。 */
export function findCodemapViewsByConcepts(projectRoot: string, concepts: string[]): CodemapViewEntry[] {
  if (concepts.length === 0) return [];
  const listing = listCodemapViews(projectRoot);
  if (listing === null) return [];
  const wanted = new Set(concepts);
  return [...listing.systems, ...listing.flows].filter(
    (e) => e.parseOk && e.concepts.some((c) => wanted.has(c)),
  );
}
