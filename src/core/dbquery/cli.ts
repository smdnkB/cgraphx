/**
 * CLI wiring for the db-query subsystem.
 *
 * Exposes `registerDbCommands(program)` — called once from
 * `src/cli/index.ts`. All db subcommands live under `cgraphx db <sub>`
 * and are implemented in this file. Spec §5.2.
 *
 * Exit codes (spec §5.2):
 *   0  success
 *   2  config error (no profile / bad JSON / missing field)
 *   3  safety rejection (write keyword / multi-statement)
 *   4  connection failed / timeout / disabled
 *   5  argument error (unknown mode, etc.)
 */

import path from 'node:path';

import type { Command } from 'commander';

import {
  DbQueryError,
  SubsystemDisabledError,
  runQuery,
  runSchema,
  listProfiles,
  type QueryResult,
  type SchemaResult,
  type ProfilesResult,
} from './index';
import { initDbProfiles } from './init';
import { validateIdentifier } from './identifiers';

// ─── Output formats ───────────────────────────────────────────────────────

type Format = 'json' | 'table' | 'csv';

function parseFormat(s: string | undefined): Format {
  if (!s || s === 'json') return 'json';
  if (s === 'table') return 'table';
  if (s === 'csv') return 'csv';
  throw new ArgError(`--format must be json, table, or csv (got: ${s})`);
}

class ArgError extends Error {}

function csvEscape(s: unknown): string {
  if (s === null || s === undefined) return '';
  const str = typeof s === 'string' ? s : JSON.stringify(s);
  if (/[",\n\r]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

function renderQueryCsv(result: QueryResult): string {
  const header = result.columns.map(c => csvEscape(c.name)).join(',');
  const rows = result.rows.map(row => result.columns.map(c => csvEscape(row[c.name])).join(','));
  return [header, ...rows].join('\n');
}

function renderQueryTable(result: QueryResult): string {
  if (result.rows.length === 0) return '(no rows)';
  const cols = result.columns.map(c => c.name);
  const allRows: string[][] = [cols, ...result.rows.map(r => cols.map(c => formatCell(r[c])))];
  const widths = cols.map((_, i) => Math.max(...allRows.map(r => String(r[i] ?? '').length)));
  return allRows.map(r => r.map((cell, i) => String(cell).padEnd(widths[i]!)).join('  ')).join('\n');
}

function formatCell(v: unknown): string {
  if (v === null || v === undefined) return '';
  if (typeof v === 'string') return v;
  return JSON.stringify(v);
}

function outputQueryResult(result: QueryResult, format: Format): void {
  if (format === 'json') {
    process.stdout.write(JSON.stringify(result, null, 2) + '\n');
  } else if (format === 'csv') {
    process.stdout.write(renderQueryCsv(result) + '\n');
  } else {
    process.stdout.write(renderQueryTable(result) + '\n');
    if (result.truncated) {
      process.stderr.write(`[db-query] Result truncated (LIMIT ${result.rowCount} rows hit).\n`);
    }
  }
}

function outputSchemaResult(
  result: SchemaResult,
  mode: 'tables' | 'ddl' | 'indexes' | 'table-comment',
  format: Format,
): void {
  if (mode === 'ddl' && 'ddl' in result) {
    // ddl emits the raw CREATE TABLE DDL text, not JSON.
    if (format !== 'json') {
      process.stderr.write(`[db-query] --format=${format} ignored for ddl output (always DDL text).\n`);
    }
    process.stdout.write(result.ddl + '\n');
    return;
  }
  // For other schema results, json is the only first-class format; table/csv
  // fall back to json because the shape varies per mode.
  if (format !== 'json') {
    process.stderr.write(`[db-query] --format=${format} not supported for schema output; using json.\n`);
  }
  process.stdout.write(JSON.stringify(result, null, 2) + '\n');
}

function outputProfilesResult(result: ProfilesResult, format: Format): void {
  if (format !== 'json') {
    process.stderr.write(`[db-query] --format=${format} not supported for profiles output; using json.\n`);
  }
  process.stdout.write(JSON.stringify(result, null, 2) + '\n');
}

// ─── Exit code mapping (spec §5.2) ─────────────────────────────────────────

function exitCodeForError(err: unknown): number {
  if (err instanceof ArgError) return 5;
  if (err instanceof DbQueryError) {
    switch (err.code) {
      case 'CONFIG_NOT_FOUND':
      case 'PROFILE_NOT_FOUND':
        return 2;
      case 'SAFETY_REJECTED':
        return 3;
      case 'CONNECTION_FAILED':
      case 'QUERY_TIMEOUT':
      case 'DRIVER_ERROR':
      case 'SUBSYSTEM_DISABLED':
        return 4;
    }
  }
  return 1; // unknown — process-level failure
}

// ─── Command registration ─────────────────────────────────────────────────

export function registerDbCommands(program: Command): void {
  const db = program
    .command('db')
    .description('Database introspection — MySQL / PostgreSQL read-only queries (thin wrapper, isolated from the code graph)');

  db
    .command('query')
    .description('Execute a read-only SQL query. Writes are pre-rejected; LIMIT auto-applied.')
    .requiredOption('--sql <sql>', 'SQL statement (single statement; no semicolons)')
    .option('--profile <name>', 'Profile from db-profiles.json (default profile if omitted)')
    .option('--limit <n>', 'Override LIMIT (clamped to 1000)', v => parseInt(v, 10))
    .option('--format <format>', 'json / table / csv', 'json')
    .action(async (options: {
      sql: string;
      profile?: string;
      limit?: number;
      format?: string;
    }) => {
      await runQueryAndExit({
        sql: options.sql,
        profile: options.profile,
        limit: options.limit,
      }, options.format);
    });

  db
    .command('schema')
    .description('Introspect DB schema: tables / ddl / indexes / table-comment')
    .requiredOption('--mode <mode>', 'One of: tables, ddl, indexes, table-comment')
    .option('--table <name>', 'Table name (required for ddl/indexes/table-comment)')
    .option('--profile <name>', 'Profile from db-profiles.json')
    .option('--format <format>', 'Output format (schema always emits json)', 'json')
    .action(async (options: {
      mode: string;
      table?: string;
      profile?: string;
      format?: string;
    }) => {
      const validModes = new Set(['tables', 'ddl', 'indexes', 'table-comment']);
      if (!validModes.has(options.mode)) {
        process.stderr.write(`[db-query] Invalid --mode: ${options.mode}. Must be one of: tables, ddl, indexes, table-comment\n`);
        process.exitCode = 5;
        return;
      }
      const mode = options.mode as 'tables' | 'ddl' | 'indexes' | 'table-comment';
      if ((mode === 'ddl' || mode === 'indexes' || mode === 'table-comment') && !options.table) {
        process.stderr.write(`[db-query] --table is required for mode=${mode}\n`);
        process.exitCode = 5;
        return;
      }
      const projectRoot = process.cwd();
      try {
        const format = parseFormat(options.format);
        if (mode === 'ddl' && options.table) {
          try {
            validateIdentifier(options.table, 'table');
          } catch (e) {
            throw new ArgError(e instanceof Error ? e.message : String(e));
          }
        }
        const result = await runSchema(
          { mode, table: options.table, profile: options.profile },
          projectRoot,
        );
        outputSchemaResult(result, mode, format);
      } catch (err) {
        renderErrorAndExit(err);
      }
    });

  db
    .command('profiles')
    .description('List configured DB profiles (never returns passwords)')
    .option('--format <format>', 'Output format (always json)', 'json')
    .action(async (options: { format?: string }) => {
      const projectRoot = process.cwd();
      try {
        const format = parseFormat(options.format);
        const result = await listProfiles({}, projectRoot);
        outputProfilesResult(result, format);
      } catch (err) {
        renderErrorAndExit(err);
      }
    });

  db
    .command('init')
    .description('Create .cgraphx/db-profiles.json template with example MySQL + PostgreSQL profiles')
    .option('--force', 'Overwrite the file if it already exists')
    .action((options: { force?: boolean }) => {
      const projectRoot = process.cwd();
      try {
        const report = initDbProfiles(projectRoot, { force: options.force === true });
        if (report.action === 'already-exists') {
          process.stderr.write(
            `[db-query] ${report.filePath} already exists — use --force to overwrite.\n`,
          );
          process.exitCode = 0;
          return;
        }
        process.stdout.write(
          `[db-query] ${report.action === 'overwritten' ? 'Overwrote' : 'Created'} ${report.filePath}\n` +
          `[db-query] Edit the file to fill in real host/user/password, then run \`cgraphx db profiles\`.\n`,
        );
      } catch (err) {
        renderErrorAndExit(err);
      }
    });
}

async function runQueryAndExit(
  input: { sql: string; profile?: string; limit?: number },
  formatStr: string | undefined,
): Promise<void> {
  const projectRoot = process.cwd();
  try {
    const format = parseFormat(formatStr);
    const result = await runQuery(input, projectRoot);
    outputQueryResult(result, format);
  } catch (err) {
    renderErrorAndExit(err);
  }
}

function renderErrorAndExit(err: unknown): void {
  const code = exitCodeForError(err);
  if (err instanceof SubsystemDisabledError) {
    // Match MCP: same fixed text. Spec §2.5.
    process.stderr.write('数据库无法连接,请以代码中查询为准\n');
  } else if (err instanceof DbQueryError) {
    process.stderr.write(`[db-query] ${err.message}\n`);
  } else if (err instanceof ArgError) {
    process.stderr.write(`[db-query] ${err.message}\n`);
  } else {
    const msg = err instanceof Error ? err.message : String(err);
    process.stderr.write(`[db-query] Unexpected error: ${msg}\n`);
  }
  process.exitCode = code;
}

// `path" import is reserved for future use (resolving projectPath passed via CLI
// flag); kept here so the module compiles cleanly even if unused for now.
void path;
