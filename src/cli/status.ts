/**
 * `cgraphx status` — initialization state + subsystem summaries.
 *
 * Reports the three subsystems cgraphx 2.0 ships — the markdown knowledge
 * base, the developer timeline, and dbquery profiles — plus the shared
 * `.cgraphx/cgraphx.db` initialization state. The status command NEVER reads
 * graph tables (nodes/edges/files); those were removed in 2.0.
 *
 * Lifecycle:
 *   - `<project>/.cgraphx/cgraphx.db` missing → print "not initialized",
 *     exit code 2 (matches the codegraph 1.x convention).
 *   - Otherwise open one connection, run read-only SELECTs against each
 *     subsystem's tables, close. Subsystem schemas are applied by `init`;
 *     status does not apply them. A subsystem whose tables are unexpectedly
 *     absent is reported as `available: false` rather than crashing the whole
 *     report.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';

import { getCodeGraphDir, isInitialized } from '../core/directory';
import { DatabaseConnection, getDatabasePath } from '../core/db';
import { PROFILES_FILENAME } from '../core/dbquery/constants';
import type { EventType } from '../core/timeline/types';

export interface StatusOptions {
  /** Output machine-readable JSON instead of text. */
  json?: boolean;
}

/** Event types surfaced in the timeline breakdown. */
const EVENT_TYPES: readonly EventType[] = [
  'user_prompt',
  'pre_tool_use',
  'post_tool_use',
  'stop',
  'git_commit',
];

export interface MarkdownStatus {
  /** False when the markdown tables are missing entirely (pre-init or corrupted). */
  available: boolean;
  documents: number;
  concepts: number;
  domains: number;
  tags: number;
  /** Highest `version` recorded in `markdown_schema_versions`, 0 if none. */
  schemaVersion: number;
  /** `MAX(indexed_at)` across documents in epoch ms, null when no documents. */
  lastIndexedAt: number | null;
}

export interface TimelineStatus {
  /** False when the timeline tables are missing entirely. */
  available: boolean;
  events: number;
  /** `MAX(ts)` across events (ISO 8601), null when no events. */
  lastEventAt: string | null;
  byEventType: Record<EventType, number>;
}

export interface DbQueryStatus {
  /** False when `.cgraphx/db-profiles.json` is missing or unparseable. */
  available: boolean;
  profilesFileExists: boolean;
  profilesFilePath: string;
  /** Count of profile entries (object values, excluding `default`/`enabled`). */
  profileCount: number;
  defaultProfile: string | null;
  /** Profile names only — never includes credentials. */
  profileNames: string[];
  /** True when the project-local file sets `enabled: false`. */
  disabled: boolean;
}

export interface StatusReport {
  initialized: boolean;
  projectPath: string;
  indexPath: string;
  dbPath: string;
  dbExists: boolean;
  /** File size of cgraphx.db in bytes (0 when absent). */
  dbSizeBytes: number;
  /** Effective SQLite journal mode (e.g. 'wal', 'delete'), null if unopened. */
  journalMode: string | null;
  markdown: MarkdownStatus;
  timeline: TimelineStatus;
  dbquery: DbQueryStatus;
}

/** Empty-but-typed markdown block, used when the subsystem can't be read. */
function emptyMarkdown(): MarkdownStatus {
  return {
    available: false,
    documents: 0,
    concepts: 0,
    domains: 0,
    tags: 0,
    schemaVersion: 0,
    lastIndexedAt: null,
  };
}

/** Empty-but-typed timeline block. */
function emptyTimeline(): TimelineStatus {
  return {
    available: false,
    events: 0,
    lastEventAt: null,
    byEventType: {
      user_prompt: 0,
      pre_tool_use: 0,
      post_tool_use: 0,
      stop: 0,
      git_commit: 0,
    },
  };
}

/**
 * Read the project-local `.cgraphx/db-profiles.json`.
 *
 * Never returns passwords — only counts profiles and surfaces their names. The
 * user-global file under `~/.cgraphx/` is intentionally ignored here: status
 * describes the *project* state, and the project file is what `cgraphx init`
 * owns. A missing or unparseable file yields `available: false`, never throws.
 */
function readDbQueryStatus(projectRoot: string): DbQueryStatus {
  const profilesFilePath = path.join(getCodeGraphDir(projectRoot), PROFILES_FILENAME);
  const profilesFileExists = fs.existsSync(profilesFilePath);
  if (!profilesFileExists) {
    return {
      available: false,
      profilesFileExists: false,
      profilesFilePath,
      profileCount: 0,
      defaultProfile: null,
      profileNames: [],
      disabled: false,
    };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(fs.readFileSync(profilesFilePath, 'utf8')) as unknown;
  } catch {
    return {
      available: false,
      profilesFileExists: true,
      profilesFilePath,
      profileCount: 0,
      defaultProfile: null,
      profileNames: [],
      disabled: false,
    };
  }

  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return {
      available: false,
      profilesFileExists: true,
      profilesFilePath,
      profileCount: 0,
      defaultProfile: null,
      profileNames: [],
      disabled: false,
    };
  }

  const obj = parsed as Record<string, unknown>;
  const defaultProfile =
    typeof obj['default'] === 'string' && obj['default'] ? obj['default'] : null;
  const disabled = obj['enabled'] === false;

  const profileNames: string[] = [];
  for (const [name, entry] of Object.entries(obj)) {
    if (name === 'default' || name === 'enabled') continue;
    if (entry && typeof entry === 'object' && !Array.isArray(entry)) {
      profileNames.push(name);
    }
  }
  profileNames.sort((a, b) => a.localeCompare(b));

  return {
    available: true,
    profilesFileExists: true,
    profilesFilePath,
    profileCount: profileNames.length,
    defaultProfile,
    profileNames,
    disabled,
  };
}

/**
 * Query the markdown subsystem tables. Each `SELECT count(*)` is wrapped so a
 * missing table degrades to `available: false` instead of throwing. Counts
 * use `count(*)` directly (cheaper than hydrating via MarkdownQuery).
 */
function queryMarkdownStatus(db: DatabaseConnection): MarkdownStatus {
  const sqlite = db.getDb();
  try {
    const documents = countOf(db, 'SELECT COUNT(*) AS c FROM markdown_documents');
    const concepts = countOf(db, 'SELECT COUNT(*) AS c FROM markdown_concepts');
    const domains = countOf(db, 'SELECT COUNT(*) AS c FROM markdown_domains');
    const tags = countOf(db, 'SELECT COUNT(*) AS c FROM markdown_tags');
    const schemaRow = sqlite
      .prepare(
        'SELECT MAX(version) AS v FROM markdown_schema_versions',
      )
      .get() as { v: number | null } | undefined;
    const lastRow = sqlite
      .prepare('SELECT MAX(indexed_at) AS m FROM markdown_documents')
      .get() as { m: number | null } | undefined;
    return {
      available: true,
      documents,
      concepts,
      domains,
      tags,
      schemaVersion: schemaRow?.v ?? 0,
      lastIndexedAt: lastRow?.m ?? null,
    };
  } catch {
    return emptyMarkdown();
  }
}

/** Query the timeline subsystem tables. Mirrors {@link queryMarkdownStatus}. */
function queryTimelineStatus(db: DatabaseConnection): TimelineStatus {
  const empty = emptyTimeline();
  try {
    const total = countOf(db, 'SELECT COUNT(*) AS c FROM timeline_events');
    const lastRow = db
      .getDb()
      .prepare('SELECT MAX(ts) AS m FROM timeline_events')
      .get() as { m: string | null } | undefined;
    const byTypeRows = db
      .getDb()
      .prepare(
        'SELECT event_type, COUNT(*) AS c FROM timeline_events GROUP BY event_type',
      )
      .all() as Array<{ event_type: string; c: number }>;
    const byEventType: Record<EventType, number> = { ...empty.byEventType };
    for (const r of byTypeRows) {
      if (EVENT_TYPES.includes(r.event_type as EventType)) {
        byEventType[r.event_type as EventType] = r.c;
      }
    }
    return {
      available: true,
      events: total,
      lastEventAt: lastRow?.m ?? null,
      byEventType,
    };
  } catch {
    return empty;
  }
}

/** Run a `SELECT COUNT(*)` and return the integer. Throws on table-missing. */
function countOf(db: DatabaseConnection, sql: string): number {
  const row = db.getDb().prepare(sql).get() as { c: number } | undefined;
  return row?.c ?? 0;
}

/**
 * Build the status report. Pure I/O — no console output. Opens the shared DB
 * once (when initialized) and runs every subsystem read against the same
 * connection, then closes it.
 */
export function buildStatusReport(projectPath: string): StatusReport {
  const indexPath = getCodeGraphDir(projectPath);
  const dbPath = getDatabasePath(projectPath);
  const initialized = isInitialized(projectPath);
  const dbExists = fs.existsSync(dbPath);
  let dbSizeBytes = 0;
  if (dbExists) {
    try {
      dbSizeBytes = fs.statSync(dbPath).size;
    } catch {
      dbSizeBytes = 0;
    }
  }

  // dbquery is filesystem-only and independent of the SQLite handle — read it
  // unconditionally so a broken DB doesn't hide profile state.
  const dbquery = readDbQueryStatus(projectPath);

  if (!initialized || !dbExists) {
    return {
      initialized,
      projectPath,
      indexPath,
      dbPath,
      dbExists,
      dbSizeBytes,
      journalMode: null,
      markdown: emptyMarkdown(),
      timeline: emptyTimeline(),
      dbquery,
    };
  }

  let connection: DatabaseConnection | null = null;
  let journalMode: string | null = null;
  let markdown = emptyMarkdown();
  let timeline = emptyTimeline();
  try {
    connection = DatabaseConnection.open(dbPath);
    journalMode = connection.getJournalMode();
    markdown = queryMarkdownStatus(connection);
    timeline = queryTimelineStatus(connection);
  } finally {
    if (connection) {
      try {
        connection.close();
      } catch {
        // best-effort close
      }
    }
  }

  return {
    initialized,
    projectPath,
    indexPath,
    dbPath,
    dbExists,
    dbSizeBytes,
    journalMode,
    markdown,
    timeline,
    dbquery,
  };
}

/**
 * Status command entry point. Prints text or JSON; on a not-initialized
 * project, prints the hint and exits with code 2.
 */
export async function runStatus(
  projectPath: string,
  options: StatusOptions = {},
): Promise<void> {
  const resolved = path.resolve(projectPath);
  const report = buildStatusReport(resolved);

  if (options.json) {
    process.stdout.write(JSON.stringify(report, null, 2) + '\n');
    if (!report.initialized) {
      process.exit(2);
    }
    return;
  }

  process.stdout.write('\ncgraphx Status\n\n');
  process.stdout.write(`Project:   ${report.projectPath}\n`);
  process.stdout.write(`Index:     ${report.indexPath}\n`);
  process.stdout.write(`Database:  ${report.dbPath}\n`);
  if (!report.initialized) {
    process.stdout.write('State:     not initialized\n');
    process.stdout.write('\nRun `cgraphx init` to initialize.\n');
    process.exit(2);
  }

  process.stdout.write(
    `State:     initialized (${(report.dbSizeBytes / 1024).toFixed(1)} KB` +
      (report.journalMode ? `, ${report.journalMode}` : '') +
      ')\n\n',

  );

  // ----- markdown ---------------------------------------------------------
  const md = report.markdown;
  process.stdout.write('Markdown knowledge base\n');
  if (!md.available) {
    process.stdout.write('  (tables unavailable)\n\n');
  } else {
    process.stdout.write(`  Documents:  ${md.documents}\n`);
    process.stdout.write(`  Concepts:   ${md.concepts}\n`);
    process.stdout.write(`  Domains:    ${md.domains}\n`);
    process.stdout.write(`  Tags:       ${md.tags}\n`);
    process.stdout.write(`  Schema:     v${md.schemaVersion}\n`);
    process.stdout.write(
      `  Last index: ${md.lastIndexedAt === null ? '—' : new Date(md.lastIndexedAt).toISOString()}\n\n`,
    );
  }

  // ----- timeline ---------------------------------------------------------
  const tl = report.timeline;
  process.stdout.write('Developer timeline\n');
  if (!tl.available) {
    process.stdout.write('  (tables unavailable)\n\n');
  } else {
    process.stdout.write(`  Events:     ${tl.events}\n`);
    process.stdout.write(
      `  Last event: ${tl.lastEventAt ?? '—'}\n`,
    );
    process.stdout.write('  By type:\n');
    for (const t of EVENT_TYPES) {
      process.stdout.write(`    ${t.padEnd(16)} ${tl.byEventType[t]}\n`);
    }
    process.stdout.write('\n');
  }

  // ----- dbquery ----------------------------------------------------------
  const dq = report.dbquery;
  process.stdout.write('Database query profiles\n');
  if (!dq.profilesFileExists) {
    process.stdout.write(
      `  Profiles file: absent (${path.relative(resolved, dq.profilesFilePath) || dq.profilesFilePath})\n`,
    );
    process.stdout.write('  Run `cgraphx db init` to create a template.\n\n');
  } else if (!dq.available) {
    process.stdout.write(
      `  Profiles file: ${path.relative(resolved, dq.profilesFilePath) || dq.profilesFilePath} (unparseable)\n\n`,
    );
  } else {
    process.stdout.write(
      `  Profiles file: ${path.relative(resolved, dq.profilesFilePath) || dq.profilesFilePath}\n`,
    );
    process.stdout.write(`  Profiles:     ${dq.profileCount}\n`);
    if (dq.defaultProfile) {
      process.stdout.write(`  Default:      ${dq.defaultProfile}\n`);
    }
    if (dq.disabled) {
      process.stdout.write('  Subsystem:    disabled (enabled=false)\n');
    }
    if (dq.profileNames.length > 0) {
      process.stdout.write(`  Names:        ${dq.profileNames.join(', ')}\n`);
    }
    process.stdout.write('\n');
  }
}
