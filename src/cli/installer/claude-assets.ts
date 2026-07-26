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

export type ClaudeAssetAction = 'created' | 'overwritten' | 'not-found';

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
