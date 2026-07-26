/**
 * Tests for logging.ts — spec §2.6, §9.1 (logging coverage).
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';

import { logQuery } from '../../../src/core/dbquery/logging';
import { LOG_FILENAME, LOG_MAX_BYTES } from '../../../src/core/dbquery/constants';
import type { QueryLogRecord } from '../../../src/core/dbquery/types';

const POSIX = process.platform !== 'win32';

function makeTmpProject(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'cg-dbq-log-'));
}

function baseRecord(overrides: Partial<QueryLogRecord> = {}): QueryLogRecord {
  return {
    timestamp: '2026-06-27T00:00:00.000Z',
    profile: 'default',
    mode: 'query',
    sql: 'SELECT 1',
    durationMs: 12,
    rowCount: 1,
    truncated: false,
    status: 'ok',
    ...overrides,
  };
}

describe('logging: JSONL format (spec §2.6)', () => {
  let project: string;
  let logFile: string;

  beforeEach(() => {
    project = makeTmpProject();
    logFile = path.join(project, '.cgraphx', LOG_FILENAME);
  });
  afterEach(() => {
    fs.rmSync(project, { recursive: true, force: true });
  });

  it('appends one JSON line per record', () => {
    logQuery(project, baseRecord());
    logQuery(project, baseRecord({ durationMs: 34 }));
    const content = fs.readFileSync(logFile, 'utf8').split('\n').filter(Boolean);
    expect(content).toHaveLength(2);
    const r1 = JSON.parse(content[0]!) as QueryLogRecord;
    expect(r1.durationMs).toBe(12);
    const r2 = JSON.parse(content[1]!) as QueryLogRecord;
    expect(r2.durationMs).toBe(34);
  });

  it('preserves all required fields', () => {
    const rec = baseRecord({
      profile: 'p1',
      mode: 'ddl',
      sql: 'SHOW TABLES',
      durationMs: 42,
      rowCount: 5,
      truncated: true,
      status: 'ok',
    });
    logQuery(project, rec);
    const line = fs.readFileSync(logFile, 'utf8').trim();
    const parsed = JSON.parse(line) as QueryLogRecord;
    expect(parsed.timestamp).toBe(rec.timestamp);
    expect(parsed.profile).toBe('p1');
    expect(parsed.mode).toBe('ddl');
    expect(parsed.sql).toBe('SHOW TABLES');
    expect(parsed.durationMs).toBe(42);
    expect(parsed.rowCount).toBe(5);
    expect(parsed.truncated).toBe(true);
    expect(parsed.status).toBe('ok');
  });

  it('records disabled status', () => {
    logQuery(project, baseRecord({ status: 'disabled', sql: undefined }));
    const parsed = JSON.parse(fs.readFileSync(logFile, 'utf8').trim()) as QueryLogRecord;
    expect(parsed.status).toBe('disabled');
  });

  it('records safety-rejected with errorMessage', () => {
    logQuery(
      project,
      baseRecord({
        status: 'safety-rejected',
        errorMessage: 'Forbidden keyword: DROP',
        rowCount: undefined,
        truncated: undefined,
      }),
    );
    const parsed = JSON.parse(fs.readFileSync(logFile, 'utf8').trim()) as QueryLogRecord;
    expect(parsed.status).toBe('safety-rejected');
    expect(parsed.errorMessage).toContain('DROP');
  });
});

describe('logging: rotation (spec §2.6, §9.1 #13 log rotation)', () => {
  let project: string;
  let logFile: string;

  beforeEach(() => {
    project = makeTmpProject();
    logFile = path.join(project, '.cgraphx', LOG_FILENAME);
  });
  afterEach(() => {
    fs.rmSync(project, { recursive: true, force: true });
  });

  it('rotates when file exceeds LOG_MAX_BYTES', () => {
    // Write a file that's already at threshold.
    fs.mkdirSync(path.dirname(logFile), { recursive: true });
    fs.writeFileSync(logFile, 'X'.repeat(LOG_MAX_BYTES));

    // Next write should trigger rotation.
    logQuery(project, baseRecord());

    expect(fs.existsSync(logFile)).toBe(true);
    expect(fs.existsSync(`${logFile}.1`)).toBe(true);
    // The rotated file should contain the old oversized content.
    const rotated = fs.readFileSync(`${logFile}.1`, 'utf8');
    expect(rotated.length).toBe(LOG_MAX_BYTES);
    // The current log should contain only the new record.
    const current = fs.readFileSync(logFile, 'utf8');
    expect(current).not.toContain('X'.repeat(10));
  });

  it('keeps at most LOG_KEEP_FILES rotated files', () => {
    fs.mkdirSync(path.dirname(logFile), { recursive: true });
    // Force multiple rotations by repeatedly writing over-threshold data.
    for (let i = 0; i < 8; i++) {
      // Make the file oversized, then write a tiny record to trigger rotation.
      fs.writeFileSync(logFile, 'Y'.repeat(LOG_MAX_BYTES));
      logQuery(project, baseRecord({ durationMs: i }));
    }
    // After 8 rotations, we should have at most LOG_KEEP_FILES files
    // (.log + .log.1 ... .log.4).
    const files = fs.readdirSync(path.dirname(logFile)).filter(f => f.startsWith(LOG_FILENAME));
    expect(files.length).toBeLessThanOrEqual(5);
    // The oldest possible file (.log.4) should NOT exist if it would exceed cap.
    // (It MAY exist if exactly at cap.)
  });
});

describe('logging: file permissions (spec §2.6, POSIX-only)', () => {
  let project: string;
  let logFile: string;

  beforeEach(() => {
    project = makeTmpProject();
    logFile = path.join(project, '.cgraphx', LOG_FILENAME);
  });
  afterEach(() => {
    fs.rmSync(project, { recursive: true, force: true });
  });

  it.runIf(POSIX)('creates file with mode 0600 on POSIX', () => {
    logQuery(project, baseRecord());
    const stat = fs.statSync(logFile);
    // Mask out file type bits, keep permission bits.
    const mode = stat.mode & 0o777;
    expect(mode).toBe(0o600);
  });

  it.runIf(POSIX)('does not change mode if file already exists', () => {
    fs.mkdirSync(path.dirname(logFile), { recursive: true });
    fs.writeFileSync(logFile, '', { mode: 0o644 });
    logQuery(project, baseRecord());
    const stat = fs.statSync(logFile);
    const mode = stat.mode & 0o777;
    expect(mode).toBe(0o644);
  });
});

describe('logging: write-failure tolerance (spec §2.6)', () => {
  let project: string;

  beforeEach(() => {
    project = makeTmpProject();
  });
  afterEach(() => {
    // Restore permissions before cleanup so rmSync works.
    try {
      fs.chmodSync(path.join(project, '.cgraphx'), 0o755);
    } catch {
      /* ignore */
    }
    fs.rmSync(project, { recursive: true, force: true });
  });

  it.runIf(POSIX)('does not throw when write fails', () => {
    // Make .cgraphx/ read-only after creating it.
    fs.mkdirSync(path.join(project, '.cgraphx'), { recursive: true });
    fs.chmodSync(path.join(project, '.cgraphx'), 0o555);
    // Should not throw — write failure is best-effort.
    expect(() => logQuery(project, baseRecord())).not.toThrow();
  });
});
