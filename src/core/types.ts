/**
 * cgraphx 2.0 — shared core types.
 *
 * The code-graph types (Node, Edge, FileRecord, NodeKind, EdgeKind, Language,
 * extraction / traversal / context types, …) lived here in the cgraphx 1.x
 * lineage; they were removed together with the graph subsystem. What remains is
 * the small set of schema-agnostic types shared across the DB base layer and
 * the markdown / timeline engines.
 */

/**
 * Database schema version info.
 *
 * This is the shared SHAPE of a version row. The DB base layer itself applies
 * no schema; each subsystem (markdown, timeline) tracks its own version in its
 * own table and reads it back into this shape.
 */
export interface SchemaVersion {
  /** Current schema version */
  version: number;

  /** When schema was created/updated */
  appliedAt: number;

  /** Description of this version */
  description?: string;
}
