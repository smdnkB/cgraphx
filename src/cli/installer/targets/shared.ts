/**
 * Helpers shared across `AgentTarget` implementations.
 *
 * Kept deliberately small — only the generic file-write / atomicity /
 * marked-section utilities. Target-specific concerns (which file paths,
 * which hooks) live in each target file.
 */

import * as fs from 'fs';
import * as path from 'path';

/**
 * Read a JSON file, returning `{}` when missing or unparseable.
 *
 * Unparseable files are backed up to `<path>.backup` BEFORE we return
 * `{}` — so an idempotent re-run never silently deletes a user's
 * existing config that happened to break JSON parse temporarily.
 */
export function readJsonFile(filePath: string): Record<string, any> {
  if (!fs.existsSync(filePath)) {
    return {};
  }
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`  Warning: Could not parse ${path.basename(filePath)}: ${msg}`);
    console.warn(`  A backup will be created before overwriting.`);
    try {
      fs.copyFileSync(filePath, filePath + '.backup');
    } catch { /* ignore backup failure */ }
    return {};
  }
}

/**
 * Write a file atomically: write to `<path>.tmp.<pid>`, then rename.
 *
 * Prevents corruption if the process crashes mid-write. The temp
 * file is cleaned up on rename failure.
 */
export function atomicWriteFileSync(filePath: string, content: string): void {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  const tmpPath = filePath + '.tmp.' + process.pid;
  try {
    fs.writeFileSync(tmpPath, content);
    fs.renameSync(tmpPath, filePath);
  } catch (err) {
    try { fs.unlinkSync(tmpPath); } catch { /* ignore */ }
    throw err;
  }
}

/**
 * Atomic JSON write. Trailing newline matches the convention every
 * existing target had — preserves diff-friendly file shape.
 */
export function writeJsonFile(filePath: string, data: Record<string, any>): void {
  atomicWriteFileSync(filePath, JSON.stringify(data, null, 2) + '\n');
}

/**
 * Compare two JSON values for deep equality, ignoring key order.
 *
 * Used for idempotency: when the on-disk config already exactly
 * matches what we'd write, return action=`unchanged` instead of
 * re-writing (and emitting a confusing "Updated" log line).
 */
export function jsonDeepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== typeof b) return false;
  if (a === null || b === null) return a === b;
  if (typeof a !== 'object') return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false;
    return a.every((v, i) => jsonDeepEqual(v, b[i]));
  }
  const ao = a as Record<string, unknown>;
  const bo = b as Record<string, unknown>;
  const ak = Object.keys(ao).sort();
  const bk = Object.keys(bo).sort();
  if (ak.length !== bk.length) return false;
  if (!ak.every((k, i) => k === bk[i])) return false;
  return ak.every((k) => jsonDeepEqual(ao[k], bo[k]));
}

/**
 * Inverse of `replaceOrAppendMarkedSection`. Strips the marker
 * block from `filePath` if present. If the file becomes empty after
 * removal, deletes the file entirely (matches the existing Claude
 * uninstall behavior).
 *
 * Returns `removed` when content was stripped, `not-found` when
 * the markers weren't present, `kept` when the file didn't exist.
 */
export function removeMarkedSection(
  filePath: string,
  startMarker: string,
  endMarker: string,
): 'removed' | 'not-found' | 'kept' {
  if (!fs.existsSync(filePath)) return 'kept';

  let content: string;
  try {
    content = fs.readFileSync(filePath, 'utf-8');
  } catch {
    return 'kept';
  }

  const startIdx = content.indexOf(startMarker);
  const endIdx = content.indexOf(endMarker);
  if (startIdx === -1 || endIdx <= startIdx) return 'not-found';

  const before = content.substring(0, startIdx).trimEnd();
  const after = content.substring(endIdx + endMarker.length).trimStart();
  const joined = before + (before && after ? '\n\n' : '') + after;

  if (joined.trim() === '') {
    try { fs.unlinkSync(filePath); } catch { /* ignore */ }
  } else {
    atomicWriteFileSync(filePath, joined.trim() + '\n');
  }
  return 'removed';
}

/**
 * Inverse of `removeMarkedSection`. Upserts a marker-delimited block:
 * creates the file (and block) when missing, appends the block when the
 * file exists without our markers, or replaces the existing block in
 * place — always preserving any surrounding user content verbatim.
 *
 * Idempotent: when a block already exists with an identical body the file
 * is left byte-for-byte untouched and `unchanged` is returned, so re-running
 * install doesn't emit a spurious "Updated" line (mirrors the `jsonDeepEqual`
 * guard used for the JSON configs).
 *
 * @param body Inner block content WITHOUT the markers — they are wrapped
 *             around it here. Trailing whitespace is normalized so the
 *             wrapped block is deterministic across runs.
 * @returns `created` when the file didn't exist, `updated` when the block
 *          was appended or replaced, `unchanged` when it already matched
 *          (or the existing file was unreadable — we never clobber on a
 *          read failure).
 */
export function replaceOrAppendMarkedSection(
  filePath: string,
  startMarker: string,
  endMarker: string,
  body: string,
): 'created' | 'updated' | 'unchanged' {
  const inner = body.replace(/\s+$/, '');
  const block = `${startMarker}\n${inner}\n${endMarker}`;

  if (!fs.existsSync(filePath)) {
    atomicWriteFileSync(filePath, block + '\n');
    return 'created';
  }

  let content: string;
  try {
    content = fs.readFileSync(filePath, 'utf-8');
  } catch {
    return 'unchanged'; // exists but unreadable — leave it alone
  }

  const startIdx = content.indexOf(startMarker);
  const endIdx = content.indexOf(endMarker);

  if (startIdx === -1 || endIdx <= startIdx) {
    // No existing block — append, separated from any prior content.
    const prefix = content.length > 0 ? content.replace(/\s+$/, '') + '\n\n' : '';
    atomicWriteFileSync(filePath, prefix + block + '\n');
    return 'updated';
  }

  // Existing block — rewrite only when the body actually differs.
  const existingBlock = content.substring(startIdx, endIdx + endMarker.length);
  if (existingBlock === block) {
    return 'unchanged';
  }

  const before = content.substring(0, startIdx);
  const after = content.substring(endIdx + endMarker.length);
  atomicWriteFileSync(filePath, before + block + after);
  return 'updated';
}
