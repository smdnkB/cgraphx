/**
 * schema-knowledge 模型知识库读取层(spec §2 / §3.2-3.5 / §4.1 / §5.2 / §5.3)。
 *
 * 纯文件系统派生:扫描 `docs/schema-knowledge/<工程>/` 目录树,解析 INDEX.md
 * 表清单、读 ddl/*.sql 全文、提取 DISCOVERED 块并按标签索引——全部为纯函数。
 *
 * 硬约定(spec §6 / §10 / coding-standards「边界与结构」):
 * - 只用 `node:fs` + `node:path`,**绝不** import `src/core/dbquery` / `src/core/db`
 *   或任何 core 门面;不连库、不读 `.cgraphx/cgraphx.db`(spec §4.1)。
 * - 只读:不写文件、不写 DB。
 *
 * 路径边界(spec §5.2 / §11 #9):工程名/表名仅作目录/文件名,出现 `..` / `/`
 * / `\` / 以 `/` 开头一律视为非法 → 返回 null/缺失(不抛错,由调用方降级)。
 * 任何 readFileSync 前 `path.resolve` 后校验仍在 schema-knowledge 根内
 * (defense-in-depth;格式非法理论上由路由层先拦为 404,本层仍保留校验)。
 *
 * DISCOVERED 解析边界(spec §3.5 / §5.3 / §11 #4 #5):**仅** 识别块内行首
 * `-- [标签]` 前缀用于聚合索引;**不解析 DDL 语句**(CREATE TABLE / COMMENT ON),
 * DDL 本体作为整段字符串原样返回给调用方。容错优先:块未闭合 / 无标签行 /
 * 非六类标签 / 无块 → 优雅降级,绝不抛错。
 */

import * as fs from 'node:fs';
import * as path from 'node:path';

import { SCHEMA_KNOWLEDGE_DIR, INSIGHT_TAGS, type InsightTag } from './constants';

/** 经验标签(六类之一),非六类归"其他"。常量见 constants.ts。 */
const KNOWN_TAGS = new Set<string>(INSIGHT_TAGS.filter((t) => t !== '其他'));

// ----- 视图模型(T-2 消费,签名两端同文见 plan tasks.md T-1)-----------------

/** 工程概览(工程列表页用 + 单工程折叠判定复用)。 */
export interface ProjectSummary {
  /** 工程名 = 目录名。 */
  name: string;
  /** ✓ 状态表数;INDEX 不可读时为 -1(降级标志)。 */
  tableCount: number;
  /** INDEX.md 是否可解析。 */
  indexReadable: boolean;
}

/** 表清单项(表清单页用;✓ 状态表)。 */
export interface TableEntry {
  /** 表名。 */
  name: string;
  /** 表注释(INDEX.md 第二列);无则空串。 */
  comment: string;
}

/** 单表 DDL 详情(详情页用)。 */
export interface DdlDetail {
  /** ddl 文件是否存在。 */
  exists: boolean;
  /** DDL 本体原文(CREATE TABLE + COMMENT ON ...);不含 DISCOVERED 块。 */
  ddlBody: string;
  /** DISCOVERED 块原文(含起止标记行);无块则 null。 */
  discovered: string | null;
}

/** 一条经验(经验沉淀页用)。 */
export interface Insight {
  /** 六类之一或"其他"。 */
  tag: InsightTag;
  /** 标签后的内容(原文,未转义——转义由模板层做)。 */
  text: string;
  /** 归属表名。 */
  table: string;
}

// ----- 路径校验 -------------------------------------------------------------

/**
 * 名字是否合法作单层目录/文件名(spec §5.2)。
 *
 * 拒绝:空 / 含 `..` / 含路径分隔符(`/` `\`) / 以 `/` 开头 / 含 NUL。
 * 这些输入一律不让其参与路径拼接,防穿越。
 */
function isSafeName(name: string): boolean {
  if (name === '' || name === '.' || name === '..') return false;
  if (name.includes('/') || name.includes('\\')) return false;
  if (name.includes('\0')) return false;
  // 防止 `a/../b` 形态(虽然已禁 `/`,双保险)。
  if (name.includes('..')) return false;
  return true;
}

/**
 * 校验 resolved 路径仍在 base 根内(spec §5.2 纵深防御)。
 *
 * resolve 后必须等于 base 或以 `base + path.sep` 开头,否则视为越界。
 */
function isWithinBase(resolved: string, base: string): boolean {
  if (resolved === base) return true;
  return resolved.startsWith(base + path.sep);
}

/** schema-knowledge 根绝对路径。 */
function schemaRoot(projectRoot: string): string {
  return path.resolve(projectRoot, SCHEMA_KNOWLEDGE_DIR);
}

// ----- 工程列表 -------------------------------------------------------------

/**
 * 扫描工程列表(含 tableCount)。dir 不存在 → 返回 null(调用方走空态);
 * 空数组 → 零工程;长度=1 → 单工程折叠(T-3 路由层复用本返回值判折叠)。
 */
export function listProjects(projectRoot: string): ProjectSummary[] | null {
  const root = schemaRoot(projectRoot);
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(root, { withFileTypes: true });
  } catch {
    // 目录不存在 / 不可读 → null(空态)。
    return null;
  }

  const projects: ProjectSummary[] = [];
  for (const ent of entries) {
    if (!ent.isDirectory()) continue;
    if (ent.name.startsWith('.') || ent.name.startsWith('_')) continue; // 跳过隐藏/临时
    const summary = summarizeProject(projectRoot, ent.name);
    projects.push(summary);
  }
  // 按工程名稳定排序。
  projects.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  return projects;
}

/**
 * 单工程概览:读 INDEX.md 统计 ✓ 表数;INDEX 不可读 → tableCount=-1。
 * 工程目录不存在 → 仍返回 summary(tableCount 为降级计数或 0,indexReadable=false)。
 */
export function summarizeProject(projectRoot: string, projectName: string): ProjectSummary {
  const root = schemaRoot(projectRoot);
  const tables = readTableListFromIndex(root, projectName);
  if (tables === null) {
    // INDEX 不可读:降级扫 ddl/ 目录文件名,tableCount 取文件数,indexReadable=false。
    const ddlFiles = listDdlFiles(root, projectName);
    return { name: projectName, tableCount: ddlFiles.length, indexReadable: false };
  }
  return { name: projectName, tableCount: tables.length, indexReadable: true };
}

// ----- 表清单 ---------------------------------------------------------------

/**
 * 读工程表清单(只 ✓ 状态表)。
 *
 * INDEX 不可读 → 扫 ddl/ 目录文件名降级(indexReadable=false 体现在 ProjectSummary,
 * 这里返回 ddl 文件名列表,注释空)。工程不存在 → null。
 */
export function listTables(projectRoot: string, projectName: string): TableEntry[] | null {
  if (!isSafeName(projectName)) return null;
  const root = schemaRoot(projectRoot);
  const projectDir = path.resolve(root, projectName);
  if (!isWithinBase(projectDir, root)) return null;

  // 工程目录不存在 → null。
  try {
    const stat = fs.statSync(projectDir);
    if (!stat.isDirectory()) return null;
  } catch {
    return null;
  }

  // 优先读 INDEX.md。
  const fromIndex = readTableListFromIndex(root, projectName);
  if (fromIndex !== null) return fromIndex;

  // 降级:扫 ddl/ 目录。
  return listDdlFiles(root, projectName).map((name) => ({ name, comment: '' }));
}

/**
 * 解析 INDEX.md 表清单(只 ✓ 状态表)。
 *
 * INDEX.md 表格行格式:`| <表名> | <注释> | <状态> |`,状态列含 `✓` → 入选,
 * 含 `missing` → 过滤(spec §3.3 / §11 #6)。INDEX 文件缺失/读错/非表格 → null。
 */
function readTableListFromIndex(root: string, projectName: string): TableEntry[] | null {
  const indexFile = path.resolve(root, projectName, 'INDEX.md');
  let raw: string;
  try {
    raw = fs.readFileSync(indexFile, 'utf-8');
  } catch {
    return null;
  }

  const tables: TableEntry[] = [];
  const seen = new Set<string>();
  // 表格行:`| ... | ... | ... |`,至少 3 列。状态列含 ✓ 入选。
  const rowRe = /^\|(.+)\|\s*$/;
  for (const line of raw.split(/\r?\n/)) {
    const m = rowRe.exec(line);
    if (m === null || m[1] === undefined) continue;
    const cells = m[1].split('|').map((c) => c.trim());
    if (cells.length < 3) continue;
    const name = cells[0];
    const comment = cells[1];
    const status = cells[2];
    if (name === undefined || comment === undefined || status === undefined) continue;
    // 跳过表头分隔行(|---|---|)与表头行(表名列含「表名」)。
    if (name.startsWith('---')) continue;
    if (name === '表名') continue;
    // 剥反引号:INDEX.md 表名常写作 `customer`,ddl 文件名为 customer。
    const cleanName = name.replace(/^`+|`+$/g, '');
    if (!isSafeName(cleanName)) continue;
    if (!status.includes('✓')) continue; // 只 ✓ 状态
    if (seen.has(cleanName)) continue;
    seen.add(cleanName);
    tables.push({ name: cleanName, comment });
  }
  if (tables.length === 0) {
    // 解析了文件但没得到任何表:可能格式异常 → 视为不可读,返回 null 触发降级。
    return null;
  }
  return tables;
}

/** 扫 ddl/ 目录,返回表名列表(文件名去 .sql)。目录不存在 → 空数组。 */
function listDdlFiles(root: string, projectName: string): string[] {
  const ddlDir = path.resolve(root, projectName, 'ddl');
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(ddlDir, { withFileTypes: true });
  } catch {
    return [];
  }
  return entries
    .filter((e) => e.isFile() && e.name.endsWith('.sql'))
    .map((e) => e.name.slice(0, -'.sql'.length))
    .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
}

// ----- 单表 DDL -------------------------------------------------------------

/**
 * 读单表 DDL 详情。文件缺失/路径越界 → { exists: false, ddlBody: '', discovered: null }。
 *
 * 注:路径越界作纵深防御兜底——格式非法(含 ../)由 T-3 路由层先拦为 404,
 * 不会进到本函数;本函数仍做 isSafeName + isWithinBase 校验作 defense-in-depth。
 */
export function readDdlDetail(
  projectRoot: string,
  projectName: string,
  tableName: string,
): DdlDetail {
  const missing: DdlDetail = { exists: false, ddlBody: '', discovered: null };
  if (!isSafeName(projectName) || !isSafeName(tableName)) return missing;

  const root = schemaRoot(projectRoot);
  const filePath = path.resolve(root, projectName, 'ddl', `${tableName}.sql`);
  if (!isWithinBase(filePath, root)) return missing;

  let raw: string;
  try {
    raw = fs.readFileSync(filePath, 'utf-8');
  } catch {
    return missing;
  }

  return splitDdlAndDiscovered(raw);
}

/**
 * 把 .sql 文件内容切成 DDL 本体与 DISCOVERED 块(spec §3.5 边界)。
 *
 * 块边界:行(去首尾空格后)以 `-- === DISCOVERED` 开头(含 DISCOVERED 即起始)、
 * 以 `-- === END DISCOVERED` 开头(含 END DISCOVERED 即结束)。
 * 块在文件中部 → ddlBody 取起始行前内容;块未闭合 → discovered 取起始到文件尾。
 */
function splitDdlAndDiscovered(raw: string): DdlDetail {
  const lines = raw.split(/\r?\n/);
  let startIdx = -1;
  let endIdx = -1;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line === undefined) continue;
    const trimmed = line.trim();
    if (startIdx === -1 && trimmed.startsWith('-- === DISCOVERED')) {
      // 起始标记行(END 行首是 `-- === END`,不以 `-- === DISCOVERED` 开头,不会误匹配)。
      startIdx = i;
    } else if (startIdx !== -1 && trimmed.startsWith('-- === END DISCOVERED')) {
      endIdx = i;
      break;
    }
  }

  if (startIdx === -1) {
    // 无 DISCOVERED 块。
    return { exists: true, ddlBody: raw, discovered: null };
  }

  const discoveredEnd = endIdx === -1 ? lines.length : endIdx + 1;
  const discovered = lines.slice(startIdx, discoveredEnd).join('\n');
  // DDL 本体 = 块起始前的内容(含块前的空行,保留原貌)。
  const ddlBody = lines.slice(0, startIdx).join('\n').replace(/\n+$/, '');
  return { exists: true, ddlBody, discovered };
}

// ----- 经验沉淀 -------------------------------------------------------------

/**
 * 提取工程内全部 DISCOVERED 经验(扫所有 ddl/*.sql)。无经验 → 空数组。
 * 工程不存在 / 路径越界 → null。
 */
export function listInsights(
  projectRoot: string,
  projectName: string,
): Insight[] | null {
  const byTable = listInsightsByTable(projectRoot, projectName);
  if (byTable === null) return null;
  const all: Insight[] = [];
  for (const group of byTable) {
    all.push(...group.insights);
  }
  return all;
}

/** 按表分组的一组经验(表卡片首页用)。 */
export interface TableInsights {
  /** 表名。 */
  table: string;
  /** 该表的全部经验条目(无 DISCOVERED 块则空数组)。 */
  insights: Insight[];
}

/**
 * 提取工程内全部 DISCOVERED 经验,**按表分组**(表卡片首页用:每张表的经验
 * 标签计数 + 摘要)。无经验表也返回(insights 为空数组)。工程不存在/越界 → null。
 */
export function listInsightsByTable(
  projectRoot: string,
  projectName: string,
): TableInsights[] | null {
  if (!isSafeName(projectName)) return null;
  const root = schemaRoot(projectRoot);
  const projectDir = path.resolve(root, projectName);
  if (!isWithinBase(projectDir, root)) return null;

  // 工程目录不存在 → null。
  try {
    const stat = fs.statSync(projectDir);
    if (!stat.isDirectory()) return null;
  } catch {
    return null;
  }

  const tableNames = listDdlFiles(root, projectName);
  const groups: TableInsights[] = [];
  for (const table of tableNames) {
    const detail = readDdlDetail(projectRoot, projectName, table);
    const insights = detail.exists && detail.discovered !== null
      ? parseInsightsFromBlock(detail.discovered, table)
      : [];
    groups.push({ table, insights });
  }
  return groups;
}

/**
 * 解析单个 DISCOVERED 块为 Insight 列表(spec §3.5 / §5.3)。
 *
 * 仅识别块内行首 `-- [标签]` 前缀;六类标签 → 对应 tag;非六类 / 无标签 → "其他"。
 * 起始/结束标记行(`-- === DISCOVERED` / `-- === END DISCOVERED`)不产出 Insight。
 */
function parseInsightsFromBlock(block: string, table: string): Insight[] {
  const insights: Insight[] = [];
  const lines = block.split(/\r?\n/);
  // `[标签]` 行:行(去 `-- ` 前缀与首尾空格后)以 `[xxx]` 开头。
  const tagRe = /^--\s*\[([^\]]+)\]\s*(.*)$/;
  for (const line of lines) {
    const trimmed = line.trim();
    // 跳过块边界标记行。
    if (trimmed.startsWith('-- === DISCOVERED') || trimmed.startsWith('-- === END DISCOVERED')) {
      continue;
    }
    const m = tagRe.exec(line);
    if (m !== null && m[1] !== undefined && m[2] !== undefined) {
      const tagRaw = m[1].trim();
      const text = m[2].trim();
      const tag: InsightTag = KNOWN_TAGS.has(tagRaw) ? (tagRaw as InsightTag) : '其他';
      insights.push({ tag, text, table });
    } else if (trimmed === '' || trimmed.startsWith('--')) {
      // 空行 / 普通注释行(无 [标签] 前缀)→ 归"其他",保留原文(去 `-- ` 前缀)。
      if (trimmed === '') continue; // 空行不产出,避免噪声
      const text = trimmed.replace(/^--\s*/, '');
      if (text === '') continue;
      insights.push({ tag: '其他', text, table });
    }
  }
  return insights;
}
