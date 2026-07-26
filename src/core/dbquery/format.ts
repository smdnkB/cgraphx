/**
 * Result formatting — normalizes driver raw output into the unified
 * result types (QueryResult / SchemaResult / ProfilesResult).
 *
 * Spec §5.1 + §6.3: BLOB/large fields are base64-encoded and truncated at
 * MAX_FIELD_BYTES (8KB).
 */

import { MAX_FIELD_BYTES } from './constants';
import type {
  ProfilesConfig,
  ProfilesResult,
  QueryResult,
  RawResult,
  TablesResult,
  DdlResult,
  IndexesResult,
  TableCommentResult,
  IndexDefinition,
} from './types';

/** Convert Buffer / large string values. Mutates rows in place. */
function clampFields(rows: Record<string, unknown>[]): boolean {
  let truncated = false;
  for (const row of rows) {
    for (const [key, value] of Object.entries(row)) {
      if (Buffer.isBuffer(value)) {
        if (value.length > MAX_FIELD_BYTES) {
          row[key] = value.subarray(0, MAX_FIELD_BYTES).toString('base64');
          truncated = true;
        } else {
          row[key] = value.toString('base64');
        }
      } else if (typeof value === 'string') {
        if (Buffer.byteLength(value, 'utf8') > MAX_FIELD_BYTES) {
          // Truncate by bytes but at a UTF-8 char boundary.
          const sliced = Buffer.from(value, 'utf8').subarray(0, MAX_FIELD_BYTES).toString('utf8');
          row[key] = sliced;
          truncated = true;
        }
      } else if (typeof value === 'bigint') {
        // JSON.stringify can't serialize BigInt directly.
        row[key] = value.toString();
      } else if (value !== null && typeof value === 'object') {
        // Dates and similar — convert to ISO string.
        if (value instanceof Date) {
          row[key] = (value as Date).toISOString();
        } else {
          try {
            row[key] = JSON.parse(JSON.stringify(value));
          } catch {
            row[key] = String(value);
          }
        }
      }
    }
  }
  return truncated;
}

export function formatQueryResult(
  raw: RawResult,
  profileName: string,
  durationMs: number,
  truncated: boolean,
): QueryResult {
  const fieldTruncated = clampFields(raw.rows);
  return {
    columns: raw.columns,
    rows: raw.rows,
    rowCount: raw.rows.length,
    truncated: truncated || fieldTruncated,
    profile: profileName,
    durationMs,
  };
}

export function formatTablesResult(
  raw: RawResult,
  profileName: string,
  durationMs: number,
): TablesResult {
  const tables = raw.rows.map(row => ({
    name: String(row.name ?? ''),
    comment: row.comment !== undefined && row.comment !== null && row.comment !== ''
      ? String(row.comment)
      : undefined,
  }));
  return { tables, profile: profileName, durationMs };
}

/**
 * MySQL DDL — extract the `Create Table` column from `SHOW CREATE TABLE`
 * output. `SHOW CREATE TABLE` returns two columns: `Table` (name) and
 * `Create Table` (the DDL). Access by position to be version-safe (the
 * second column's name varies across MySQL/MariaDB versions).
 */
export function extractMysqlDdl(
  raw: RawResult,
  table: string,
  profileName: string,
  durationMs: number,
): DdlResult {
  const row = raw.rows[0];
  if (!row) {
    throw new Error(`SHOW CREATE TABLE returned no rows for table "${table}".`);
  }
  const values = Object.values(row);
  const ddl = String(values[1] ?? '');
  if (!ddl) {
    throw new Error(`SHOW CREATE TABLE returned empty DDL for table "${table}".`);
  }
  return { table, ddl: ddl.endsWith(';') ? ddl : ddl + ';', profile: profileName, durationMs };
}

/** Quote a PostgreSQL identifier with double quotes, doubling embedded ones. */
function quotePgIdent(name: string): string {
  return '"' + String(name).replace(/"/g, '""') + '"';
}

/** Escape a string literal body (single-quote, doubling embedded quotes). */
function quotePgLiteral(s: string): string {
  return "'" + String(s).replace(/'/g, "''") + "'";
}

/**
 * PostgreSQL DDL — assemble `CREATE TABLE "schema"."tbl" (...)` from the
 * column query + `pg_get_constraintdef` rows + optional table comment.
 * Column comments emit `COMMENT ON COLUMN` statements after the CREATE TABLE
 * (PG comments cannot go inline in CREATE TABLE). Secondary indexes
 * (non-constraint-backed) emit as `CREATE INDEX ...` statements last.
 */
export function renderPostgresDdl(
  columnRows: RawResult,
  constraintDefRows: RawResult,
  indexDefRows: RawResult,
  tableCommentRows: RawResult,
  table: string,
  schema: string,
  profileName: string,
  durationMs: number,
): DdlResult {
  const qualifiedTable = `${quotePgIdent(schema)}.${quotePgIdent(table)}`;

  const columnLines: string[] = [];
  const columnComments: string[] = [];
  for (const row of columnRows.rows) {
    const colName = quotePgIdent(String(row.name ?? ''));
    const dataType = String(row.data_type ?? '');
    const nullable = row.nullable === true || row.nullable === 't' || row.nullable === 1 ||
      String(row.nullable ?? '').toUpperCase() === 'YES';
    const defaultValue = row.default_value !== null && row.default_value !== undefined
      ? String(row.default_value)
      : undefined;
    const comment = row.comment !== undefined && row.comment !== null && row.comment !== ''
      ? String(row.comment)
      : undefined;

    let line = `  ${colName} ${dataType}`;
    if (!nullable) line += ' NOT NULL';
    if (defaultValue) line += ` DEFAULT ${defaultValue}`;
    columnLines.push(line);

    if (comment) {
      columnComments.push(
        `COMMENT ON COLUMN ${qualifiedTable}.${colName} IS ${quotePgLiteral(comment)};`,
      );
    }
  }

  for (const row of constraintDefRows.rows) {
    const def = String(row.def ?? '').trim();
    if (def) columnLines.push(`  ${def}`);
  }

  const body = columnLines.join(',\n');
  let ddl = `CREATE TABLE ${qualifiedTable} (\n${body}\n);`;

  if (columnComments.length > 0) {
    ddl += '\n' + columnComments.join('\n');
  }

  const tableCommentRow = tableCommentRows.rows[0];
  const tableComment = tableCommentRow && tableCommentRow.comment !== undefined &&
    tableCommentRow.comment !== null && tableCommentRow.comment !== ''
    ? String(tableCommentRow.comment)
    : null;
  if (tableComment) {
    ddl += `\nCOMMENT ON TABLE ${qualifiedTable} IS ${quotePgLiteral(tableComment)};`;
  }

  const indexLines: string[] = [];
  for (const row of indexDefRows.rows) {
    const def = String(row.def ?? '').trim();
    if (def) indexLines.push(def.endsWith(';') ? def : def + ';');
  }
  if (indexLines.length > 0) {
    ddl += '\n' + indexLines.join('\n');
  }

  return { table, ddl, profile: profileName, durationMs };
}

export function formatIndexesResult(
  raw: RawResult,
  table: string,
  profileName: string,
  durationMs: number,
): IndexesResult {
  // For MySQL: rows come as one-per-column per index. Group by index name.
  // For PG: rows come pre-grouped with a CSV string in `columns_csv`.
  const byName = new Map<string, IndexDefinition>();

  for (const row of raw.rows) {
    const name = String(row.name ?? '');
    if (!name) continue;

    // PG path: columns_csv is a comma-separated list of quoted column names.
    const csv = row.columns_csv;
    if (typeof csv === 'string') {
      byName.set(name, {
        name,
        columns: csv.split(',').map(s => s.trim().replace(/^"|"$/g, '')).filter(Boolean),
        unique: Boolean(row.is_unique),
        type: typeof row.type === 'string' ? row.type : undefined,
      });
      continue;
    }

    // MySQL path: one row per (index, column) pair.
    const existing = byName.get(name);
    const column = String(row.column_name ?? '');
    if (existing) {
      if (column) existing.columns.push(column);
    } else {
      byName.set(name, {
        name,
        columns: column ? [column] : [],
        unique: Boolean(row.is_unique),
        type: typeof row.type === 'string' ? row.type : undefined,
      });
    }
  }

  return {
    table,
    indexes: Array.from(byName.values()),
    profile: profileName,
    durationMs,
  };
}

export function formatTableCommentResult(
  raw: RawResult,
  table: string,
  profileName: string,
  durationMs: number,
): TableCommentResult {
  const first = raw.rows[0];
  const comment = first && first.comment !== undefined && first.comment !== null
    ? String(first.comment)
    : null;
  return { table, comment: comment === '' ? null : comment, profile: profileName, durationMs };
}

/**
 * Build ProfilesResult — NEVER returns password (spec §2.4).
 */
export function formatProfilesResult(config: ProfilesConfig): ProfilesResult {
  return {
    profiles: config.profiles.map(p => ({
      name: p.name,
      description: p.description,
      type: p.type,
      host: p.host,
      port: p.port,
      database: p.database,
      hasCredentials: Boolean(p.password),
    })),
    defaultProfile: config.defaultProfile,
    configSources: config.sources,
    enabled: config.enabled,
  };
}
