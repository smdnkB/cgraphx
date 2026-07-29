/**
 * Initialize a db-profiles.json template at <projectRoot>/.cgraphx/.
 *
 * Writes a starter file with two example profiles (MySQL + PostgreSQL)
 * containing placeholder credentials the user edits in place. Mode 0600
 * on POSIX because the file may hold real passwords once filled in.
 *
 * Idempotent: by default, refuses to overwrite an existing file; pass
 * `--force` to clobber.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';

import { PROFILES_FILENAME } from './constants';

const POSIX = process.platform !== 'win32';

export interface InitReport {
  projectRoot: string;
  filePath: string;
  action: 'created' | 'already-exists' | 'overwritten';
}

/** The template content. Uses placeholder passwords so the user knows to fill. */
export function templateProfilesContent(): string {
  const obj = {
    enabled: true,
    default: 'example-mysql',
    'example-mysql': {
      description: '示例 MySQL 配置 — 改成实际值后重命名 profile',
      type: 'mysql',
      host: 'localhost',
      port: 3306,
      user: 'readonly_user',
      password: 'CHANGE_ME',
      database: 'your_database',
    },
    'example-postgres': {
      description: '示例 PostgreSQL 配置 — 改成实际值后重命名 profile',
      type: 'postgres',
      host: 'localhost',
      port: 5432,
      user: 'readonly_user',
      password: 'CHANGE_ME',
      database: 'your_database',
      schema: 'public',
    },
  };
  return JSON.stringify(obj, null, 2) + '\n';
}

/**
 * Write the db-profiles.json template.
 *
 * @param projectRoot  Project root (must already have a .cgraphx/ dir)
 * @param opts.force   Overwrite an existing file. Default false.
 *
 * Behavior:
 *   - .cgraphx/ missing → throws (caller should tell user to run `cgraphx install` first)
 *   - File exists + !force → returns action='already-exists', no write
 *   - File exists + force  → action='overwritten'
 *   - File absent          → action='created'
 */
export function initDbProfiles(projectRoot: string, opts: { force?: boolean } = {}): InitReport {
  const resolved = path.resolve(projectRoot);
  const codegraphDir = path.join(resolved, '.cgraphx');
  if (!fs.existsSync(codegraphDir)) {
    throw new Error(
      `cgraphx not initialized at ${resolved} — run \`cgraphx install\` first.`,
    );
  }

  const filePath = path.join(codegraphDir, PROFILES_FILENAME);
  const exists = fs.existsSync(filePath);

  if (exists && !opts.force) {
    return {
      projectRoot: resolved,
      filePath,
      action: 'already-exists',
    };
  }

  fs.writeFileSync(filePath, templateProfilesContent(), {
    encoding: 'utf8',
    mode: POSIX ? 0o600 : 0o644,
  });
  // Re-chmod: writeFileSync's `mode` only applies on file *creation*; on a
  // --force overwrite of an existing file the existing mode is kept. Force
  // 0600 so a previously loose mode (e.g. 0644) gets tightened.
  if (POSIX) {
    try { fs.chmodSync(filePath, 0o600); } catch { /* non-fatal */ }
  }

  return {
    projectRoot: resolved,
    filePath,
    action: exists && opts.force ? 'overwritten' : 'created',
  };
}
