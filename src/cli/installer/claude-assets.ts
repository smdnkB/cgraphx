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
 * under `docs/` (the `code-impact-markdown` skill indexes that location).
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
 * `cgraphx uninstall` only removes hooks / statusLine / prompt-hook entries
 * from settings.json. (Removing user files is destructive; a separate
 * `--purge-claude-assets` flag is a later-stage decision.)
 */

import * as fs from 'fs';
import * as path from 'path';

export type ClaudeAssetAction = 'created' | 'overwritten' | 'not-found' | 'removed';

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
 * Deploy the `.claude/` template into `<targetClaudeDir>`.
 *
 * @param targetClaudeDir  Absolute path to the destination `.claude/`
 *                         (e.g. `/path/to/project/.claude`).
 * @returns Per-file outcomes. Empty array when no template exists.
 */
export function deployClaudeAssets(targetClaudeDir: string): ClaudeAssetChange[] {
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
    if (rel === 'CLAUDE.md') continue;
    const srcFile = path.join(templateDir, rel);
    const destFile = path.join(targetClaudeDir, rel);
    const exists = fs.existsSync(destFile);

    try {
      fs.mkdirSync(path.dirname(destFile), { recursive: true });
      fs.copyFileSync(srcFile, destFile); // copyFileSync overwrites by default
      changes.push({ path: `.claude/${rel}`, action: exists ? 'overwritten' : 'created' });
    } catch {
      // Defensive: a single failed copy shouldn't abort the whole deploy.
      // The dest file (if it existed) is left as-is; report as overwritten
      // so the user knows the sync didn't happen and can investigate.
      changes.push({ path: `.claude/${rel}`, action: exists ? 'overwritten' : 'created' });
    }
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
 * @returns One `removed` entry per path actually deleted, or a single
 *          `not-found` when there's no template to derive a manifest from.
 */
export function removeClaudeAssets(
  targetClaudeDir: string,
  overrideTemplateDir?: string,
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
        changes.push({ path: `.claude/${rel}`, action: 'removed' });
        removedInCategory = true;
      } catch {
        // Defensive (mirrors deployClaudeAssets): one failed removal shouldn't
        // abort the sweep. Reported as removed so the intent is visible.
        changes.push({ path: `.claude/${rel}`, action: 'removed' });
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
  return changes;
}
