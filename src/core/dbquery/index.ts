/**
 * Public facade for the db-query subsystem.
 *
 * External callers (MCP tools, CLI) MUST use this module — never reach into
 * safety / drivers / executor internals directly. Spec §1.2 contract.
 */

export { runQuery, runSchema, listProfiles } from './executor';
export type {
  QueryInput,
  QueryResult,
  SchemaInput,
  SchemaResult,
  ProfilesInput,
  ProfilesResult,
  DBProfile,
  DriverKind,
  QueryMode,
  ConfigSource,
  IndexDefinition,
  TableSummary,
  DdlResult,
  IndexesResult,
  TableCommentResult,
  TablesResult,
} from './types';
export {
  DbQueryError,
  ConfigNotFoundError,
  ProfileNotFoundError,
  SafetyRejectionError,
  ConnectionFailedError,
  QueryTimeoutError,
  DriverError,
  SubsystemDisabledError,
} from './errors';
