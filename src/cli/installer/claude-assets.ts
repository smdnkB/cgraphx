/**
 * Deploy the `.claude/` template (skills / agents / commands / hooks /
 * plugins) shipped with cgraphx into a target project's `.claude/` directory.
 *
 * Template source: `dist/.claude-template/` (populated by `copy-assets` from
 * `<repo-root>/.claude/{skills,agents,commands,hooks,plugins}`). The template
 * excludes `settings.json`, `settings.local.json`, dotfiles, and
 * `node_modules/` — those are either user-owned, platform-specific, or
 * contain binary artifacts. Project guides (coding standards, glossaries,
 * DDL references, etc.) are NOT shipped — users author those themselves
 * under `docs/` (the `knowledge-write` skill indexes that location).
 *
 * Conflict policy: **same-name overwrites unconditionally**.
 *   - File in template, NOT in target → created
 *   - File in template AND in target → overwritten (regardless of content;
 *     the cgraphx version is the source of truth — skills are tools, not
 *     user-owned)
 *   - File in target but NOT in template → untouched (user's custom skills,
 *     commands stay; only files shipped by cgraphx get synced)
 *
 * Rationale: cgraphx skills are tools maintained by the project, just like
 * the CLI itself — upgrades should propagate. If a user wants their own
 * version, they should ship it under a different filename. The filename is
 * the contract; the content is cgraphx's responsibility.
 *
 * Uninstall policy: the template files are NOT removed on uninstall —
 * `cgraphx uninstall` only removes hooks / statusLine entries
 * from settings.json. (Removing user files is destructive; a separate
 * `--purge-claude-assets` flag is a later-stage decision.)
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { applyAssetReplacements, getAgentProfile, type AgentProfile } from '../../core/agents';

/** 默认 agent 描述(claude-code):未传 profile 时的行为即改造前行为。 */
function claudeCodeProfile(): AgentProfile {
  const profile = getAgentProfile('claude-code');
  if (!profile) throw new Error('agent 描述 claude-code 未登记');
  return profile;
}

/** 按 agent 替换规则改写内容的文本扩展名;其余扩展名一律逐字节复制。 */
const TEXT_EXTENSIONS: ReadonlySet<string> = new Set([
  '.md', '.html', '.cjs', '.js', '.mjs', '.json', '.jsonl', '.bru', '.txt', '.sh',
]);

/** 该 agent 不具备对应能力时不部署的模板子目录(相对配置目录)。 */
function isExcludedByCapability(rel: string, profile: AgentProfile): boolean {
  if (!profile.capabilities.statusLine && rel.startsWith('plugins/claude-hud/')) return true;
  if (!profile.capabilities.contextMonitor && rel.startsWith('hooks/context-monitor/')) return true;
  return false;
}

/** 复制单个资产:无替换规则或非文本扩展名逐字节复制,否则 utf8 读入替换后写出。 */
function copyAsset(srcFile: string, destFile: string, profile: AgentProfile): void {
  if (profile.assetReplacements.length === 0 || !TEXT_EXTENSIONS.has(path.extname(srcFile))) {
    fs.copyFileSync(srcFile, destFile); // copyFileSync 默认覆盖
    return;
  }
  const content = fs.readFileSync(srcFile, 'utf-8');
  fs.writeFileSync(destFile, applyAssetReplacements(content, profile));
}

export type ClaudeAssetAction = 'created' | 'overwritten' | 'not-found' | 'removed';

/**
 * deprecated-assets.json 的结构——模板根目录下的清理清单,
 * 列出已改名/移除的包自带资产路径(相对 `.claude/`)。
 */
interface DeprecatedAssetsManifest {
  paths?: string[];
}

export interface ClaudeAssetChange {
  /** Project-relative path under `.claude/`, e.g. `skills/execute-plan/SKILL.md`. */
  path: string;
  action: ClaudeAssetAction;
}

/**
 * Resolve the template directory baked into the dist build.
 *
 * Returns `null` when the template is absent (e.g. running from source before
 * a build, or a stripped-down distribution). Callers should treat this as
 * "no assets to deploy" rather than failing the install.
 */
function resolveTemplateDir(): string | null {
  // dist/cli/installer/claude-assets.js → dist/.claude-template/
  // (installer/ → cli/ → dist/, then .claude-template/ = TWO levels up)
  const candidate = path.join(__dirname, '..', '..', '.claude-template');
  return fs.existsSync(candidate) ? candidate : null;
}

/**
 * Walk a directory tree and return every file's path relative to `root`.
 * Skips `node_modules`, `.DS_Store`, and dotfiles (per the policy in the
 * file header).
 */
function walkFiles(root: string): string[] {
  const out: string[] = [];
  const walk = (dir: string, prefix: string): void => {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry.name === 'node_modules' || entry.name === '.DS_Store') continue;
      if (entry.name.startsWith('.')) continue;
      const fullPath = path.join(dir, entry.name);
      const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        walk(fullPath, rel);
      } else if (entry.isFile()) {
        out.push(rel);
      }
    }
  };
  walk(root, '');
  return out;
}

/**
 * 把模板部署到某个 agent 的配置目录:按能力过滤(不支持 statusLine 跳过 claude-hud,
 * 不支持 contextMonitor 跳过 context-monitor),按 agent 替换规则改写文本资产。
 *
 * @param targetClaudeDir  目标配置目录绝对路径(如 `/path/to/project/.claude`)。
 * @param profile          目标 agent 描述,默认 claude-code(逐字节复制,与改造前一致)。
 * @returns 每个文件的结果;无模板时返回单条 `not-found`。
 */
export function deployClaudeAssets(
  targetClaudeDir: string,
  profile: AgentProfile = claudeCodeProfile(),
): ClaudeAssetChange[] {
  const templateDir = resolveTemplateDir();
  if (!templateDir) {
    return [{ path: '', action: 'not-found' }];
  }

  const changes: ClaudeAssetChange[] = [];
  const files = walkFiles(templateDir);
  for (const rel of files) {
    // The template-root CLAUDE.md is deployed separately as a marker block
    // (see readTemplateClaudeMd below + targets/claude.ts), NOT verbatim —
    // a verbatim copy would overwrite the user's edits on every install and
    // survive uninstall. Skip it from the same-name-overwrites walk.
    // deprecated-assets.json 是构建期清理清单,不是运行时资产,同样跳过。
    if (rel === 'CLAUDE.md' || rel === 'deprecated-assets.json') continue;
    if (isExcludedByCapability(rel, profile)) continue;
    const srcFile = path.join(templateDir, rel);
    const destFile = path.join(targetClaudeDir, rel);
    const exists = fs.existsSync(destFile);

    try {
      fs.mkdirSync(path.dirname(destFile), { recursive: true });
      copyAsset(srcFile, destFile, profile);
      changes.push({ path: `${profile.configDirName}/${rel}`, action: exists ? 'overwritten' : 'created' });
    } catch {
      // Defensive: a single failed copy shouldn't abort the whole deploy.
      // The dest file (if it existed) is left as-is; report as overwritten
      // so the user knows the sync didn't happen and can investigate.
      changes.push({ path: `${profile.configDirName}/${rel}`, action: exists ? 'overwritten' : 'created' });
    }
  }

  // 清理已废弃的包自带资产(改名/移除的旧 skill 等)
  changes.push(...cleanDeprecatedAssets(targetClaudeDir, templateDir, profile));

  return changes;
}

/**
 * 读取模板根目录的 `deprecated-assets.json`,删除目标 `.claude/` 下对应的
 * 旧路径。幂等:路径不存在则跳过。install 和 uninstall 都调用,确保升级
 * 后改名/移除的包自带资产(如 `skills/code-impact-docgen`)不会残留。
 *
 * 只删清单里列出的路径,绝不 rm -rf 整个分类目录——用户自建的同名
 * 内容不受影响(清单只收录包曾经部署过的路径)。
 *
 * @param targetClaudeDir  目标 `.claude/` 绝对路径
 * @param overrideTemplateDir  可选模板目录(测试用 fixture;默认 dist 内嵌)
 * @param profile  目标 agent 描述(只影响返回路径前缀),默认 claude-code
 */
export function cleanDeprecatedAssets(
  targetClaudeDir: string,
  overrideTemplateDir?: string,
  profile: AgentProfile = claudeCodeProfile(),
): ClaudeAssetChange[] {
  const templateDir = overrideTemplateDir ?? resolveTemplateDir();
  if (!templateDir) return [];

  const manifestPath = path.join(templateDir, 'deprecated-assets.json');
  let manifest: DeprecatedAssetsManifest;
  try {
    manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
  } catch {
    // 清单不存在或不可读——视为空,不阻塞正常部署
    return [];
  }

  const paths = manifest.paths;
  if (!Array.isArray(paths)) return [];

  const changes: ClaudeAssetChange[] = [];
  for (const rel of paths) {
    if (typeof rel !== 'string' || rel.length === 0) continue;
    const dest = path.join(targetClaudeDir, rel);
    if (!fs.existsSync(dest)) continue;
    try {
      fs.rmSync(dest, { recursive: true, force: true });
    } catch {
      // 防御性:单个路径删除失败不阻塞其余清理
    }
    changes.push({ path: `${profile.configDirName}/${rel}`, action: 'removed' });
  }
  return changes;
}

/**
 * Read the workflow-guidance content shipped at the template root
 * (`dist/.claude-template/CLAUDE.md`, authored as
 * `assets/claude-template/CLAUDE.md` and copied by `copy-assets`).
 *
 * The Claude target wraps this content in a `<!-- CGRAPHX_START/END -->`
 * marker block and upserts it into the project's `.claude/CLAUDE.md` (see
 * `targets/claude.ts`) instead of deploying it verbatim — that keeps it
 * regenerable on reinstall and strippable on uninstall without clobbering
 * any surrounding user content. `deployClaudeAssets` correspondingly skips
 * the template-root CLAUDE.md.
 *
 * @param overrideDir  Optional template directory; tests point this at a
 *                     fixture. Defaults to the baked-in `dist/.claude-template/`.
 * @returns The file content, or `null` when the template dir or the file is
 *          absent (e.g. running from source before a build). Callers treat
 *          `null` as "skip the instructions write" rather than failing.
 */
export function readTemplateClaudeMd(overrideDir?: string): string | null {
  const dir = overrideDir ?? resolveTemplateDir();
  if (!dir) return null;
  try {
    return fs.readFileSync(path.join(dir, 'CLAUDE.md'), 'utf-8');
  } catch {
    return null;
  }
}

/**
 * Remove the `.claude/` assets this package deploys — the inverse of
 * `deployClaudeAssets`. Driven by the package's own template manifest (NOT a
 * hardcoded list): we enumerate the immediate children of each top-level
 * category dir the template ships (`skills/<name>`, `commands/<name>.md`,
 * `agents/<name>.md`, `hooks/<name>`, `plugins/<name>`, …) and remove the
 * matching path under `<targetClaudeDir>`.
 *
 * Two consequences worth noting:
 *  - Removing by top-level unit (a whole skill dir, a command file) makes the
 *    internal file count irrelevant — a skill that gained/lost files across
 *    versions is still cleanly removed, with no orphans.
 *  - Anything the user added that ISN'T in this version's manifest (e.g. a
 *    copied-and-renamed skill) is left untouched — we never `rm -rf` a whole
 *    category dir.
 *
 * The template-root `CLAUDE.md` is excluded here — it's owned by the marker
 * block in `.claude/CLAUDE.md`, which the Claude target strips separately.
 *
 * @param overrideTemplateDir  Optional template dir (tests pass a fixture;
 *                             defaults to the baked-in `dist/.claude-template/`).
 * @param profile  目标 agent 描述(只影响返回路径前缀),默认 claude-code。
 * @returns One `removed` entry per path actually deleted, or a single
 *          `not-found` when there's no template to derive a manifest from.
 */
export function removeClaudeAssets(
  targetClaudeDir: string,
  overrideTemplateDir?: string,
  profile: AgentProfile = claudeCodeProfile(),
): ClaudeAssetChange[] {
  const templateDir = overrideTemplateDir ?? resolveTemplateDir();
  if (!templateDir || !fs.existsSync(templateDir)) {
    return [{ path: '', action: 'not-found' }];
  }

  const changes: ClaudeAssetChange[] = [];
  let categories: fs.Dirent[];
  try {
    categories = fs.readdirSync(templateDir, { withFileTypes: true });
  } catch {
    return changes;
  }

  for (const category of categories) {
    if (category.name === 'node_modules' || category.name === '.DS_Store') continue;
    if (category.name.startsWith('.')) continue;
    if (category.name === 'CLAUDE.md') continue; // marker-block owned, not an asset dir
    if (!category.isDirectory()) continue; // no top-level files are deployed as assets

    let children: fs.Dirent[];
    try {
      children = fs.readdirSync(path.join(templateDir, category.name), { withFileTypes: true });
    } catch {
      continue;
    }
    let removedInCategory = false;
    for (const child of children) {
      if (child.name === '.DS_Store' || child.name.startsWith('.')) continue;
      const rel = `${category.name}/${child.name}`;
      const dest = path.join(targetClaudeDir, rel);
      if (!fs.existsSync(dest)) continue;
      try {
        fs.rmSync(dest, { recursive: true, force: true });
        changes.push({ path: `${profile.configDirName}/${rel}`, action: 'removed' });
        removedInCategory = true;
      } catch {
        // 防御性(同 deployClaudeAssets):单个删除失败不中断清扫,仍报 removed 让意图可见
        changes.push({ path: `${profile.configDirName}/${rel}`, action: 'removed' });
      }
    }
    // Prune the now-empty category dir the package created on deploy. Never
    // remove a non-empty dir — that means the user keeps their own entries
    // there (e.g. a copied-and-renamed skill).
    if (removedInCategory) {
      const catDest = path.join(targetClaudeDir, category.name);
      try {
        if (fs.existsSync(catDest) && fs.readdirSync(catDest).length === 0) {
          fs.rmSync(catDest, { recursive: true, force: true });
        }
      } catch { /* best-effort prune */ }
    }
  }

  // 卸载也清理已废弃资产——否则改名前的旧目录会永久残留
  changes.push(...cleanDeprecatedAssets(targetClaudeDir, templateDir, profile));

  return changes;
}
