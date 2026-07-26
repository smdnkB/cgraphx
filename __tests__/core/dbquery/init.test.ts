/**
 * Tests for db init — creates db-profiles.json template.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';

import { initDbProfiles, templateProfilesContent } from '../../../src/core/dbquery/init';
import { PROFILES_FILENAME } from '../../../src/core/dbquery/constants';

const POSIX = process.platform !== 'win32';

function makeTmpProject(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cg-dbq-init-'));
  fs.mkdirSync(path.join(dir, '.cgraphx'), { recursive: true });
  return dir;
}

describe('initDbProfiles', () => {
  let project: string;

  beforeEach(() => { project = makeTmpProject(); });
  afterEach(() => { fs.rmSync(project, { recursive: true, force: true }); });

  it('creates the template file when absent', () => {
    const report = initDbProfiles(project);
    expect(report.action).toBe('created');
    const content = fs.readFileSync(report.filePath, 'utf8');
    const parsed = JSON.parse(content);
    expect(parsed.enabled).toBe(true);
    expect(parsed.default).toBe('example-mysql');
    expect(parsed['example-mysql'].type).toBe('mysql');
    expect(parsed['example-postgres'].type).toBe('postgres');
  });

  it('refuses to overwrite an existing file by default (idempotent)', () => {
    initDbProfiles(project);
    const report = initDbProfiles(project);
    expect(report.action).toBe('already-exists');
  });

  it('--force overwrites an existing file', () => {
    initDbProfiles(project);
    const customPath = path.join(project, '.cgraphx', PROFILES_FILENAME);
    fs.writeFileSync(customPath, '{"user-wrote-this": true}');
    const report = initDbProfiles(project, { force: true });
    expect(report.action).toBe('overwritten');
    const content = fs.readFileSync(report.filePath, 'utf8');
    const parsed = JSON.parse(content);
    expect(parsed.default).toBe('example-mysql');
    expect(parsed['user-wrote-this']).toBeUndefined();
  });

  it('throws if .cgraphx/ does not exist', () => {
    const noInit = fs.mkdtempSync(path.join(os.tmpdir(), 'cg-dbq-noinit-'));
    try {
      expect(() => initDbProfiles(noInit)).toThrow(/not initialized/);
    } finally {
      fs.rmSync(noInit, { recursive: true, force: true });
    }
  });

  it.runIf(POSIX)('creates file with mode 0600 on POSIX', () => {
    const report = initDbProfiles(project);
    const stat = fs.statSync(report.filePath);
    expect(stat.mode & 0o777).toBe(0o600);
  });

  it.runIf(POSIX)('--force tightens mode from a previously loose file', () => {
    initDbProfiles(project);
    const customPath = path.join(project, '.cgraphx', PROFILES_FILENAME);
    fs.chmodSync(customPath, 0o644);
    initDbProfiles(project, { force: true });
    const stat = fs.statSync(customPath);
    expect(stat.mode & 0o777).toBe(0o600);
  });
});

describe('templateProfilesContent', () => {
  it('is valid JSON with both example profiles', () => {
    const parsed = JSON.parse(templateProfilesContent());
    expect(parsed['example-mysql']).toBeDefined();
    expect(parsed['example-postgres']).toBeDefined();
    expect(parsed.enabled).toBe(true);
  });

  it('uses placeholder passwords', () => {
    const parsed = JSON.parse(templateProfilesContent());
    expect(parsed['example-mysql'].password).toBe('CHANGE_ME');
    expect(parsed['example-postgres'].password).toBe('CHANGE_ME');
  });
});
