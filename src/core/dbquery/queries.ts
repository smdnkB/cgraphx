/**
 * SQL query templates for the schema-introspection modes (spec §4.2).
 *
 * Each function returns either a SQL string (for parameterless queries) or
 * an object `{ sql, params }` for parameterized queries. Parameter binding
 * is mandatory — never string-concat user-supplied identifiers.
 *
 * Parameter style:
 *   - MySQL:  uses `?` placeholders (mysql2)
 *   - PG:     uses `$1, $2, ...` placeholders (pg)
 */

export interface ParameterizedSql {
  sql: string;
  params: Array<string | number>;
}

// ─── MySQL (information_schema) ───

export function mysqlTablesSql(database: string): ParameterizedSql {
  return {
    sql:
      'SELECT TABLE_NAME AS name, TABLE_COMMENT AS comment ' +
      'FROM information_schema.TABLES WHERE TABLE_SCHEMA = ? ORDER BY TABLE_NAME',
    params: [database],
  };
}

/**
 * `SHOW CREATE TABLE` for MySQL — the server returns the byte-for-byte real
 * DDL (ENGINE, CHARSET, FK references, PK, UNIQUE, CHECK, auto_increment, …).
 * Identifier is interpolated (SHOW does not accept `?` placeholders); callers
 * MUST run `validateIdentifier` on `database` and `table` first.
 */
export function mysqlShowCreateTableSql(database: string, table: string): ParameterizedSql {
  return {
    sql: `SHOW CREATE TABLE \`${database}\`.\`${table}\``,
    params: [],
  };
}

export function mysqlIndexesSql(table: string, database: string): ParameterizedSql {
  return {
    sql:
      'SELECT INDEX_NAME AS name, COLUMN_NAME AS column_name, NON_UNIQUE = 0 AS is_unique, ' +
      'INDEX_TYPE AS type, SEQ_IN_INDEX AS seq ' +
      'FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? ' +
      'ORDER BY INDEX_NAME, SEQ_IN_INDEX',
    params: [database, table],
  };
}

export function mysqlTableCommentSql(table: string, database: string): ParameterizedSql {
  return {
    sql:
      'SELECT TABLE_COMMENT AS comment FROM information_schema.TABLES ' +
      'WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?',
    params: [database, table],
  };
}

// ─── PostgreSQL (pg_catalog) ───

export function postgresTablesSql(schema: string): ParameterizedSql {
  return {
    sql:
      'SELECT c.relname AS name, ' +
      'COALESCE(obj_description(c.oid), \'\') AS comment ' +
      'FROM pg_class c ' +
      'JOIN pg_namespace n ON n.oid = c.relnamespace ' +
      'WHERE c.relkind IN (\'r\', \'p\') AND n.nspname = $1 ' +
      'ORDER BY c.relname',
    params: [schema],
  };
}

export function postgresDdlSql(table: string, schema: string): ParameterizedSql {
  return {
    sql:
      'SELECT a.attname AS name, pg_catalog.format_type(a.atttypid, a.atttypmod) AS data_type, ' +
      'NOT a.attnotnull AS nullable, pg_get_expr(d.adbin, d.adrelid) AS default_value, ' +
      'COALESCE(col_description(a.attrelid, a.attnum), \'\') AS comment ' +
      'FROM pg_attribute a ' +
      'LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum ' +
      'WHERE a.attrelid = $1::regclass AND a.attnum > 0 AND NOT a.attisdropped ' +
      'ORDER BY a.attnum',
    params: [`${schema}.${table}`],
  };
}

export function postgresPrimaryKeySql(table: string, schema: string): ParameterizedSql {
  return {
    sql:
      'SELECT a.attname AS column_name ' +
      'FROM pg_index i ' +
      'JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = ANY(i.indkey) ' +
      'WHERE i.indrelid = $1::regclass AND i.indisprimary ' +
      'ORDER BY array_position(i.indkey, a.attnum)',
    params: [`${schema}.${table}`],
  };
}

export function postgresConstraintsSql(table: string, schema: string): ParameterizedSql {
  return {
    sql:
      'SELECT c.conname AS name, ' +
      'CASE WHEN c.contype = \'p\' THEN \'PRIMARY KEY\' ' +
      'WHEN c.contype = \'u\' THEN \'UNIQUE\' ' +
      'WHEN c.contype = \'f\' THEN \'FOREIGN KEY\' ' +
      'WHEN c.contype = \'c\' THEN \'CHECK\' ELSE c.contype::text END AS type ' +
      'FROM pg_constraint c ' +
      'WHERE c.conrelid = $1::regclass ORDER BY c.conname',
    params: [`${schema}.${table}`],
  };
}

/**
 * Full constraint definition text per constraint, via `pg_get_constraintdef`.
 * Each row's `def` is a complete clause like `PRIMARY KEY (a, b)` or
 * `FOREIGN KEY (a) REFERENCES other (b)` — embeddable directly inside
 * `CREATE TABLE (...)`.
 */
export function postgresConstraintDefsSql(table: string, schema: string): ParameterizedSql {
  return {
    sql:
      'SELECT pg_get_constraintdef(c.oid, true) AS def ' +
      'FROM pg_constraint c ' +
      'WHERE c.conrelid = $1::regclass ORDER BY c.conname',
    params: [`${schema}.${table}`],
  };
}

/**
 * Secondary index definitions via `pg_get_indexdef`. Excludes indexes that
 * back a PRIMARY KEY or UNIQUE constraint (those are already rendered inside
 * the CREATE TABLE body by `postgresConstraintDefsSql`), so plain
 * `CREATE INDEX` / `CREATE UNIQUE INDEX` statements are emitted without
 * duplicating constraint-backed indexes. Each row's `def` is a complete
 * `CREATE [UNIQUE] INDEX ... ON ...` statement.
 */
export function postgresIndexDefsSql(table: string, schema: string): ParameterizedSql {
  return {
    sql:
      'SELECT pg_get_indexdef(i.indexrelid) AS def ' +
      'FROM pg_index i ' +
      'WHERE i.indrelid = $1::regclass ' +
      'AND NOT i.indisprimary ' +
      'AND NOT EXISTS (SELECT 1 FROM pg_constraint c WHERE c.conindid = i.indexrelid) ' +
      'ORDER BY i.indexrelid',
    params: [`${schema}.${table}`],
  };
}

export function postgresIndexesSql(table: string, schema: string): ParameterizedSql {
  return {
    sql:
      'SELECT i.relname AS name, ' +
      'array_to_string(ARRAY(SELECT pg_get_indexdef(ix.indexrelid, k + 1, true) ' +
      'FROM generate_subscripts(ix.indkey, 1) AS k), \',\') AS columns_csv, ' +
      'ix.indisunique AS is_unique, am.amname AS type ' +
      'FROM pg_index ix ' +
      'JOIN pg_class i ON i.oid = ix.indexrelid ' +
      'JOIN pg_class t ON t.oid = ix.indrelid ' +
      'JOIN pg_am am ON am.oid = i.relam ' +
      'WHERE ix.indrelid = $1::regclass ORDER BY i.relname',
    params: [`${schema}.${table}`],
  };
}

export function postgresTableCommentSql(table: string, schema: string): ParameterizedSql {
  return {
    sql: 'SELECT COALESCE(obj_description($1::regclass), \'\') AS comment',
    params: [`${schema}.${table}`],
  };
}

// ─── Helper for executor: pick the right template for a mode ───

export type SchemaQueryMode = 'tables' | 'ddl' | 'indexes' | 'table-comment';

export function mysqlSchemaQuery(
  mode: SchemaQueryMode,
  table: string,
  database: string,
): ParameterizedSql {
  switch (mode) {
    case 'tables': return mysqlTablesSql(database);
    case 'ddl': return mysqlShowCreateTableSql(database, table);
    case 'indexes': return mysqlIndexesSql(table, database);
    case 'table-comment': return mysqlTableCommentSql(table, database);
  }
}

export function postgresSchemaQuery(
  mode: SchemaQueryMode,
  table: string,
  schema: string,
): ParameterizedSql {
  switch (mode) {
    case 'tables': return postgresTablesSql(schema);
    case 'ddl': return postgresDdlSql(table, schema);
    case 'indexes': return postgresIndexesSql(table, schema);
    case 'table-comment': return postgresTableCommentSql(table, schema);
  }
}
