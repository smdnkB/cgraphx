/**
 * Unit tests for the DDL renderers (`extractMysqlDdl`, `renderPostgresDdl`).
 * No DB connection — feeds mocked `RawResult` inputs and asserts the
 * rendered DDL text.
 */
import { describe, it, expect } from 'vitest';
import { extractMysqlDdl, renderPostgresDdl } from '../../../src/core/dbquery/format';
import type { RawResult } from '../../../src/core/dbquery/types';

function raw(rows: Record<string, unknown>[]): RawResult {
  return { columns: [], rows };
}

describe('extractMysqlDdl', () => {
  it('extracts the DDL from the second column of SHOW CREATE TABLE', () => {
    const r = extractMysqlDdl(
      raw([{ Table: 'users', 'Create Table': 'CREATE TABLE `users` (\n  `id` int NOT NULL\n) ENGINE=InnoDB' }]),
      'users', 'p', 10,
    );
    expect(r.table).toBe('users');
    expect(r.ddl).toBe('CREATE TABLE `users` (\n  `id` int NOT NULL\n) ENGINE=InnoDB;');
    expect(r.profile).toBe('p');
    expect(r.durationMs).toBe(10);
  });

  it('does not double-append semicolon if already present', () => {
    const r = extractMysqlDdl(
      raw([{ Table: 't', 'Create Table': 'CREATE TABLE `t` (`id` int);' }]),
      't', 'p', 0,
    );
    expect(r.ddl).toBe('CREATE TABLE `t` (`id` int);');
  });

  it('throws when SHOW CREATE TABLE returns no rows', () => {
    expect(() => extractMysqlDdl(raw([]), 't', 'p', 0)).toThrow(/no rows/);
  });

  it('throws when the DDL column is empty', () => {
    expect(() => extractMysqlDdl(raw([{ Table: 't', 'Create Table': '' }]), 't', 'p', 0)).toThrow(/empty DDL/);
  });
});

describe('renderPostgresDdl', () => {
  const cols = raw([
    { name: 'id', data_type: 'integer', nullable: false, default_value: null, comment: '' },
    { name: 'email', data_type: 'text', nullable: false, default_value: null, comment: 'user email' },
    { name: 'created_at', data_type: 'timestamp with time zone', nullable: true, default_value: 'now()', comment: '' },
  ]);
  const constraints = raw([
    { def: 'PRIMARY KEY (id)' },
    { def: 'UNIQUE (email)' },
  ]);
  const noTableComment = raw([{ comment: '' }]);
  const noIndexes = raw([]);

  it('assembles CREATE TABLE with columns, NOT NULL, DEFAULT, constraints, column comments', () => {
    const r = renderPostgresDdl(cols, constraints, noIndexes, noTableComment, 'users', 'public', 'p', 5);
    expect(r.table).toBe('users');
    expect(r.profile).toBe('p');
    expect(r.durationMs).toBe(5);
    expect(r.ddl).toBe(
      'CREATE TABLE "public"."users" (\n' +
      '  "id" integer NOT NULL,\n' +
      '  "email" text NOT NULL,\n' +
      '  "created_at" timestamp with time zone DEFAULT now(),\n' +
      '  PRIMARY KEY (id),\n' +
      '  UNIQUE (email)\n' +
      ');\n' +
      'COMMENT ON COLUMN "public"."users"."email" IS \'user email\';',
    );
  });

  it('emits COMMENT ON TABLE when a table comment is present', () => {
    const tableComment = raw([{ comment: 'application users' }]);
    const r = renderPostgresDdl(cols, constraints, noIndexes, tableComment, 'users', 'public', 'p', 0);
    expect(r.ddl).toContain("COMMENT ON TABLE \"public\".\"users\" IS 'application users';");
  });

  it('appends CREATE INDEX statements for secondary indexes', () => {
    const indexes = raw([
      { def: 'CREATE INDEX idx_email_lower ON "public"."users" (lower(email))' },
      { def: 'CREATE UNIQUE INDEX idx_created ON "public"."users" (created_at)' },
    ]);
    const r = renderPostgresDdl(cols, constraints, indexes, noTableComment, 'users', 'public', 'p', 0);
    expect(r.ddl).toContain('CREATE INDEX idx_email_lower ON "public"."users" (lower(email));');
    expect(r.ddl).toContain('CREATE UNIQUE INDEX idx_created ON "public"."users" (created_at);');
    // indexes come after the CREATE TABLE body
    expect(r.ddl.indexOf('CREATE TABLE')).toBeLessThan(r.ddl.indexOf('CREATE INDEX'));
  });

  it('does not double-append semicolon on index defs that already end with one', () => {
    const indexes = raw([{ def: 'CREATE INDEX i ON t (c);' }]);
    const r = renderPostgresDdl(cols, constraints, indexes, noTableComment, 'users', 'public', 'p', 0);
    expect(r.ddl).toContain('CREATE INDEX i ON t (c);');
    expect(r.ddl).not.toContain('CREATE INDEX i ON t (c);;');
  });

  it('quotes identifiers with embedded double quotes (doubled)', () => {
    const weirdCols = raw([
      { name: 'col"quote', data_type: 'int', nullable: true, default_value: null, comment: '' },
    ]);
    const r = renderPostgresDdl(weirdCols, raw([]), noIndexes, noTableComment, 't', 'public', 'p', 0);
    expect(r.ddl).toContain('"col""quote" int');
  });

  it('escapes single quotes in COMMENT literals', () => {
    const c = raw([
      { name: 'x', data_type: 'int', nullable: true, default_value: null, comment: "it's a col" },
    ]);
    const r = renderPostgresDdl(c, raw([]), noIndexes, noTableComment, 't', 'public', 'p', 0);
    expect(r.ddl).toContain("COMMENT ON COLUMN \"public\".\"t\".\"x\" IS 'it''s a col';");
  });

  it('handles nullable boolean true / string YES / t / 1', () => {
    const variants = raw([
      { name: 'a', data_type: 'int', nullable: true, default_value: null, comment: '' },
      { name: 'b', data_type: 'int', nullable: 'YES', default_value: null, comment: '' },
      { name: 'c', data_type: 'int', nullable: 't', default_value: null, comment: '' },
      { name: 'd', data_type: 'int', nullable: 1, default_value: null, comment: '' },
    ]);
    const r = renderPostgresDdl(variants, raw([]), noIndexes, noTableComment, 't', 'public', 'p', 0);
    expect(r.ddl).not.toContain('NOT NULL');
  });
});
