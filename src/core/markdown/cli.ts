/**
 * CLI wiring for the markdown knowledge base.
 *
 * Exposes a single `registerDocsCommands(program)` entry point that the main
 * CLI (`src/cli/index.ts`) calls once. All docs subcommands live under
 * `cgraphx docs <subcommand>` and are implemented in this file.
 */

import path from 'node:path';
import { readFileSync } from 'node:fs';

import type { Command } from 'commander';

import { DocumentNotFoundError, ProjectNotInitializedError } from './errors';
import { indexMarkdownKnowledgeBase } from './indexer';
import { parseFrontmatter } from './frontmatter-parser';
import { validateFrontmatter } from './validator';
import { MarkdownQuery } from './query';
import { openMarkdownDb } from './schema-bootstrap';
import type {
  ConceptSummary,
  DedupResponse,
  DocumentDetail,
  DocumentDescriptor,
  DomainSummary,
  IndexReport,
  ReferenceView,
  SeenNameAddResult,
  SeenNameCheckResult,
  SeenNameCheckResultItem,
  SeenNameClearResult,
  SeenNameListResponse,
  TagSummary,
} from './types';

/**
 * Attach the `docs` command group to a commander program.
 *
 * Called once from `src/cli/index.ts`. Kept as a function (not a top-level
 * side effect) so the main CLI controls when registration happens.
 */
export function registerDocsCommands(program: Command): void {
  const docs = program
    .command('docs')
    .description('Markdown knowledge base — index and query docs/knowledge/');

  // -- docs index ----------------------------------------------------------

  docs
    .command('index [project-path]')
    .description(
      'Scan docs/knowledge/ and rebuild the markdown knowledge base (cover-the-table)',
    )
    .option('--json', 'Output machine-readable JSON instead of progress text')
    .action(async (pathArg: string | undefined, options: { json?: boolean }) => {
      const projectRoot = pathArg ? path.resolve(pathArg) : process.cwd();

      if (options.json) {
        const report = await indexMarkdownKnowledgeBase(projectRoot);
        process.stdout.write(JSON.stringify(report, null, 2) + '\n');
        if (report.error) process.exitCode = 1;
        return;
      }

      const report = await indexMarkdownKnowledgeBase(projectRoot, {
        onProgress: (msg: string) => process.stdout.write(`${msg}\n`),
      });

      if (report.error) {
        process.stderr.write(`Error: ${report.error}\n`);
        process.exitCode = 1;
        return;
      }

      printIndexReport(report);
      if (report.skippedFiles > 0) process.exitCode = 2; // partial: success but skips
    });

  // -- docs concepts / domains / tags -------------------------------------

  // concepts has its own registration (extra --sort / --limit options); the
  // remaining vocabulary commands (domains, tags) still go through
  // registerListCommand below.
  docs
    .command('concepts [project-path]')
    .description('List all concepts (with document count and domains)')
    .option('--sort <mode>', 'Sort mode: doc-count (default) | name', 'doc-count')
    .option(
      '--limit <n>',
      'Cap results (default: no limit)',
      (v: string) => {
        // 严格 regex 校验:只接受纯数字字符串。commander 把 parser 抛出的错误
        // 当作无效参数处理(报错 + exit 1),所以不需要在 action 里再 try/catch。
        if (!/^\d+$/.test(v)) {
          throw new TypeError(
            `--limit expects a non-negative integer, got '${v}'`,
          );
        }
        return parseInt(v, 10);
      },
    )
    .option('--json', 'Output JSON')
    .action(
      async (
        pathArg: string | undefined,
        options: { sort?: string; limit?: number; json?: boolean },
      ) => {
        const projectRoot = pathArg ? path.resolve(pathArg) : process.cwd();
        try {
          const sort = (options.sort ?? 'doc-count') as 'doc-count' | 'name';
          const limit = options.limit; // may be undefined → no limit
          const rows = withQuery(projectRoot, q => q.listConcepts({ sort, limit }));
          if (options.json) {
            process.stdout.write(JSON.stringify(rows, null, 2) + '\n');
          } else {
            process.stdout.write(formatConcepts(rows));
          }
        } catch (err) {
          handleQueryError(err);
        }
      },
    );

  registerListCommand(
    docs,
    'domains',
    'List all domains (with document count)',
    q => q.listDomains(),
    formatDomains,
  );
  registerListCommand(
    docs,
    'tags',
    'List all tags (with document count)',
    q => q.listTags(),
    formatTags,
  );

  // -- docs find -----------------------------------------------------------

  docs
    .command('find [project-path]')
    .description('Find documents by concept/domain/tag/status/type/keyword')
    .option('--concept <name>', 'Filter by concept (case-sensitive)')
    .option('--domain <name>', 'Filter by domain')
    .option('--tag <name>', 'Filter by tag')
    .option('--status <status>', 'Filter by status (draft/active/superseded/deprecated)')
    .option('--type <type>', 'Filter by document_type (decision/architecture/guide/...)')
    .option('--q <keyword>', 'Full-text keyword (matches title + summary)')
    .option('--limit <n>', 'Max results (default 20, max 100)', '20')
    .option('--json', 'Output JSON')
    .action(
      async (
        pathArg: string | undefined,
        options: {
          concept?: string;
          domain?: string;
          tag?: string;
          status?: string;
          type?: string;
          q?: string;
          limit?: string;
          json?: boolean;
        },
      ) => {
        const projectRoot = pathArg ? path.resolve(pathArg) : process.cwd();
        const filter = {
          concept: options.concept,
          domain: options.domain,
          tag: options.tag,
          status: options.status as never,
          documentType: options.type as never,
          q: options.q,
          limit: options.limit ? Number(options.limit) : undefined,
        };

        try {
          const results = withQuery(projectRoot, q => q.find(filter));
          if (options.json) {
            process.stdout.write(JSON.stringify(results, null, 2) + '\n');
          } else {
            process.stdout.write(formatFindResults(results));
          }
        } catch (err) {
          handleQueryError(err);
        }
      },
    );

  // -- docs refs -----------------------------------------------------------

  docs
    .command('refs <doc-id-or-path> [project-path]')
    .description('Show outgoing + incoming references for a document')
    .option('--json', 'Output JSON')
    .action(
      async (
        docIdOrPath: string,
        pathArg: string | undefined,
        options: { json?: boolean },
      ) => {
        const projectRoot = pathArg ? path.resolve(pathArg) : process.cwd();
        try {
          const docRef = normalizeDocRef(docIdOrPath, projectRoot);
          const view = withQuery(projectRoot, q => q.getReferences(docRef));
          if (options.json) {
            process.stdout.write(JSON.stringify(view, null, 2) + '\n');
          } else {
            process.stdout.write(formatReferences(view));
          }
        } catch (err) {
          handleQueryError(err);
        }
      },
    );

  // -- docs dedup ---------------------------------------------------------

  docs
    .command('dedup [project-path]')
    .description(
      'Check concept names against the indexed vocabulary (exact + alias match)',
    )
    .requiredOption('--names <names>', 'Comma-separated candidate names')
    .option('--json', 'Output JSON')
    .action(
      async (
        pathArg: string | undefined,
        options: { names: string; json?: boolean },
      ) => {
        const projectRoot = pathArg ? path.resolve(pathArg) : process.cwd();
        const names = options.names
          .split(',')
          .map(s => s.trim())
          .filter(s => s.length > 0);
        try {
          const resp = withQuery(projectRoot, q => q.checkConceptDedup(names));
          if (options.json) {
            process.stdout.write(JSON.stringify(resp, null, 2) + '\n');
          } else {
            process.stdout.write(formatDedupResponse(resp));
          }
        } catch (err) {
          handleQueryError(err);
        }
      },
    );

  // -- docs seen-names -----------------------------------------------------

  docs
    .command('seen-names [project-path]')
    .description(
      'Layer 1 entry-point name dedup — persist + check which names were already explored',
    )
    .option('--add <names>', 'Add comma-separated names (idempotent)')
    .option('--check <names>', 'Check whether names are already seen')
    .option('--list', 'List all seen names (debug)', false)
    .option('--clear', 'Clear all seen names for this project', false)
    .option('--json', 'Output JSON')
    .action(
      async (
        pathArg: string | undefined,
        options: {
          add?: string;
          check?: string;
          list?: boolean;
          clear?: boolean;
          json?: boolean;
        },
      ) => {
        const projectRoot = pathArg ? path.resolve(pathArg) : process.cwd();

        // Mutually exclusive: exactly one of --add / --check / --list / --clear.
        const modes: Array<'add' | 'check' | 'list' | 'clear'> = [];
        if (options.add !== undefined) modes.push('add');
        if (options.check !== undefined) modes.push('check');
        if (options.list === true) modes.push('list');
        if (options.clear === true) modes.push('clear');
        if (modes.length !== 1) {
          process.stderr.write(
            'Error: exactly one of --add / --check / --list / --clear is required\n',
          );
          process.exitCode = 1;
          return;
        }

        // --add / --check need a non-empty names string.
        const mode = modes[0]!;
        if (mode === 'add' || mode === 'check') {
          const raw = options[mode];
          if (!raw || raw.trim().length === 0) {
            process.stderr.write(`Error: --${mode} requires at least one name\n`);
            process.exitCode = 1;
            return;
          }
        }

        try {
          const result = withQuery(projectRoot, q => {
            if (mode === 'add') {
              return q.addSeenNames(parseNames(options.add!));
            }
            if (mode === 'check') {
              const names = parseNames(options.check!);
              return checkInBatches(q, names);
            }
            if (mode === 'list') return q.listSeenNames();
            return q.clearSeenNames(); // mode === 'clear'
          });

          if (options.json) {
            process.stdout.write(JSON.stringify(result, null, 2) + '\n');
          } else {
            process.stdout.write(formatSeenNamesResult(result, mode));
          }
        } catch (err) {
          handleQueryError(err);
        }
      },
    );

  // -- docs show -----------------------------------------------------------

  docs
    .command('show <doc-id-or-path> [project-path]')
    .description('Show metadata + summary for a document (does not print the full body)')
    .option('--json', 'Output JSON')
    .action(
      async (
        docIdOrPath: string,
        pathArg: string | undefined,
        options: { json?: boolean },
      ) => {
        const projectRoot = pathArg ? path.resolve(pathArg) : process.cwd();
        try {
          const docRef = normalizeDocRef(docIdOrPath, projectRoot);
          const detail = withQuery(projectRoot, q => q.getDocumentDetail(docRef));
          if (detail === null) {
            process.stderr.write(`Document not found: ${docIdOrPath}\n`);
            process.exitCode = 1;
            return;
          }
          if (options.json) {
            process.stdout.write(JSON.stringify(detail, null, 2) + '\n');
          } else {
            process.stdout.write(formatDetail(detail));
          }
        } catch (err) {
          handleQueryError(err);
        }
      },
    );

  // -- docs validate -------------------------------------------------------

  docs
    .command('validate <file>')
    .description('Validate a markdown knowledge file\'s frontmatter before saving')
    .option('--json', 'Output machine-readable JSON instead of text')
    .action((fileArg: string, options: { json?: boolean }) => {
      const filePath = path.resolve(fileArg);
      let source: string;
      try {
        source = readFileSync(filePath, 'utf8');
      } catch {
        process.stderr.write(`Cannot read file: ${filePath}\n`);
        process.exitCode = 2;
        return;
      }

      const parsed = parseFrontmatter(source);
      const result = validateFrontmatter(parsed);
      const payload = {
        file: filePath,
        valid: result.valid,
        skipReason: result.skipReason ?? null,
        detail: result.detail ?? null,
      };

      if (options.json) {
        process.stdout.write(JSON.stringify(payload, null, 2) + '\n');
      } else if (result.valid) {
        process.stdout.write(`✓ valid: ${filePath}\n`);
      } else {
        process.stdout.write(`✗ invalid: ${filePath}\n`);
        process.stdout.write(`  reason: ${result.skipReason}\n`);
        if (result.detail) process.stdout.write(`  detail: ${result.detail}\n`);
      }
      if (!result.valid) process.exitCode = 2;
    });
}

// ----- helpers -----------------------------------------------------------

/**
 * Open the DB, ensure markdown schema, run a query, close.
 *
 * Single connection per command — matches cgraphx's main CLI pattern.
 */
function withQuery<T>(projectRoot: string, fn: (q: MarkdownQuery) => T): T {
  const connection = openMarkdownDb(projectRoot);
  try {
    return fn(new MarkdownQuery(connection.getDb()));
  } finally {
    connection.close();
  }
}

/**
 * Normalize a "doc-id-or-path" argument. Accepts:
 *   - 64-hex document ID (returned unchanged)
 *   - Absolute path under projectRoot (converted to project-relative POSIX)
 *   - Project-relative path (returned unchanged, backslashes → slashes)
 */
function normalizeDocRef(input: string, projectRoot: string): string {
  if (/^[a-f0-9]{64}$/.test(input)) return input;
  const normalized = input.split('\\').join('/');
  if (path.isAbsolute(input)) {
    const rel = path.relative(projectRoot, input).split(path.sep).join('/');
    return rel || normalized;
  }
  return normalized;
}

function registerListCommand<T>(
  parent: Command,
  name: string,
  description: string,
  run: (q: MarkdownQuery) => T[],
  format: (rows: T[]) => string,
): void {
  parent
    .command(`${name} [project-path]`)
    .description(description)
    .option('--json', 'Output JSON')
    .action(async (pathArg: string | undefined, options: { json?: boolean }) => {
      const projectRoot = pathArg ? path.resolve(pathArg) : process.cwd();
      try {
        const rows = withQuery(projectRoot, run);
        if (options.json) {
          process.stdout.write(JSON.stringify(rows, null, 2) + '\n');
        } else {
          process.stdout.write(format(rows));
        }
      } catch (err) {
        handleQueryError(err);
      }
    });
}

/** Friendly handling for the two expected error types. */
function handleQueryError(err: unknown): void {
  if (err instanceof ProjectNotInitializedError) {
    process.stderr.write(
      `${err.message}\nRun \`cgraphx install\` in ${err.projectPath} first.\n`,
    );
    process.exitCode = 1;
    return;
  }
  if (err instanceof DocumentNotFoundError) {
    process.stderr.write(
      `Document not found: ${err.queriedIdOrPath}\n` +
        `Use \`cgraphx docs find\` to list valid documents.\n`,
    );
    process.exitCode = 1;
    return;
  }
  process.stderr.write(
    `Error: ${err instanceof Error ? err.message : String(err)}\n`,
  );
  process.exitCode = 1;
}

/** Split a `--add`/`--check` comma-separated names string. */
function parseNames(input: string): string[] {
  return input
    .split(',')
    .map(s => s.trim())
    .filter(s => s.length > 0);
}

/**
 * Batch `checkSeenNames` so a single IN-clause stays manageable.
 * The query layer takes a full array (per spec §3.3); batching lives here.
 */
function checkInBatches(
  q: MarkdownQuery,
  names: string[],
  batchSize = 500,
): SeenNameCheckResult {
  const results: SeenNameCheckResultItem[] = [];
  for (let i = 0; i < names.length; i += batchSize) {
    const slice = names.slice(i, i + batchSize);
    const resp = q.checkSeenNames(slice);
    results.push(...resp.results);
  }
  return { results };
}

// ----- formatters --------------------------------------------------------

function printIndexReport(report: IndexReport): void {
  process.stdout.write('\n');
  process.stdout.write(`Indexed ${report.indexedDocuments} document(s)\n`);
  if (report.skippedFiles > 0) {
    process.stdout.write(`Skipped ${report.skippedFiles} file(s):\n`);
    for (const [reason, count] of Object.entries(report.skipBreakdown)) {
      if (count > 0 && reason !== 'dangling_reference') {
        process.stdout.write(`  - ${reason}: ${count}\n`);
      }
    }
  }
  process.stdout.write('\nStatistics:\n');
  process.stdout.write(`  Documents:  ${report.indexedDocuments}\n`);
  process.stdout.write(`  Concepts:   ${report.conceptsCreated}\n`);
  process.stdout.write(`  Domains:    ${report.domainsCreated}\n`);
  process.stdout.write(`  Tags:       ${report.tagsCreated}\n`);
  process.stdout.write(
    `  References: ${report.referencesCreated}` +
      (report.danglingReferences > 0
        ? ` (${report.danglingReferences} dangling)\n`
        : '\n'),
  );
  process.stdout.write(`\nDone in ${(report.durationMs / 1000).toFixed(1)}s\n`);
}

function formatConcepts(rows: ConceptSummary[]): string {
  if (rows.length === 0) return 'No concepts indexed. Run `cgraphx docs index` first.\n';
  const out = ['NAME\tDOCS\tDOMAINS'];
  for (const r of rows) {
    out.push(`${r.name}\t${r.documentCount}\t${r.domains.join(', ') || '-'}`);
  }
  out.push('');
  out.push(`Total: ${rows.length} concept(s)`);
  return out.join('\n') + '\n';
}

function formatDomains(rows: DomainSummary[]): string {
  if (rows.length === 0) return 'No domains indexed.\n';
  const out = ['NAME\tDOCS'];
  for (const r of rows) out.push(`${r.name}\t${r.documentCount}`);
  out.push('');
  out.push(`Total: ${rows.length} domain(s)`);
  return out.join('\n') + '\n';
}

function formatTags(rows: TagSummary[]): string {
  if (rows.length === 0) return 'No tags indexed.\n';
  const out = ['NAME\tDOCS'];
  for (const r of rows) out.push(`${r.name}\t${r.documentCount}`);
  out.push('');
  out.push(`Total: ${rows.length} tag(s)`);
  return out.join('\n') + '\n';
}

function formatFindResults(rows: DocumentDescriptor[]): string {
  if (rows.length === 0) return 'No matching documents.\n';
  const out = ['TITLE\tTYPE\tSTATUS\tUPDATED\tPATH'];
  for (const r of rows) {
    out.push(
      `${r.title}\t${r.documentType}\t${r.status}\t${r.updatedAt ?? '-'}\t${r.path}`,
    );
  }
  out.push('');
  out.push(`Showing ${rows.length} document(s)`);
  return out.join('\n') + '\n';
}

function formatReferences(view: ReferenceView): string {
  const out: string[] = [];
  out.push(`Document: ${view.documentTitle}`);
  out.push(`Path:     ${view.documentPath}`);
  out.push('');
  out.push(`Outgoing references (${view.outgoing.length}):`);
  if (view.outgoing.length === 0) {
    out.push('  (none)');
  } else {
    for (const t of view.outgoing) {
      out.push(`  → ${t.title}  [${t.path}]`);
    }
  }
  out.push('');
  out.push(`Incoming references (${view.incoming.length}):`);
  if (view.incoming.length === 0) {
    out.push('  (none)');
  } else {
    for (const t of view.incoming) {
      out.push(`  ← ${t.title}  [${t.path}]`);
    }
  }
  return out.join('\n') + '\n';
}

function formatDetail(d: DocumentDetail): string {
  const out: string[] = [];
  out.push(`# ${d.title}`);
  out.push('');
  out.push('| Field | Value |');
  out.push('|---|---|');
  out.push(`| type | ${d.documentType} |`);
  out.push(`| status | ${d.status} |`);
  out.push(`| source | ${d.sourceType} |`);
  out.push(`| updated | ${d.updatedAt ?? '-'} |`);
  out.push(`| created | ${d.createdAt ?? '-'} |`);
  out.push(`| owners | ${d.owners.join(', ') || '-'} |`);
  out.push(`| aliases | ${d.aliases.join(', ') || '-'} |`);
  out.push(`| path | ${d.path} |`);
  out.push('');
  out.push(`**Concepts:** ${d.concepts.join(', ') || '-'}`);
  out.push(`**Domains:** ${d.domains.join(', ') || '-'}`);
  out.push(`**Tags:** ${d.tags.join(', ') || '-'}`);
  out.push('');
  out.push('## Summary');
  out.push('');
  out.push(d.summary || '(no summary)');
  out.push('');
  out.push('---');
  out.push(
    'Read the full document at the path above for sections beyond Summary.',
  );
  return out.join('\n') + '\n';
}

function formatDedupResponse(resp: DedupResponse): string {
  if (resp.results.length === 0) {
    return 'No candidates to check.\n';
  }
  const out = ['NAME\tSTATUS\tMATCHED_VIA\tMATCHED_TO'];
  for (const r of resp.results) {
    const status = r.is_duplicate ? 'DUPLICATE' : 'NEW';
    const matchedTo = r.matched_concept ?? '-';
    const via = r.matched_via ?? '-';
    out.push(`${r.name}\t${status}\t${via}\t${matchedTo}`);
  }
  if (resp.warnings && resp.warnings.length > 0) {
    out.push('');
    out.push('Warnings:');
    for (const w of resp.warnings) {
      out.push(`  - ${w}`);
    }
  }
  return out.join('\n') + '\n';
}

/**
 * Human-readable formatter for the 4 seen-names modes.
 *
 * Union input is safe because each branch only reads fields its mode produced.
 * `--json` bypasses this entirely (raw payload printed in action above).
 */
function formatSeenNamesResult(
  result:
    | SeenNameAddResult
    | SeenNameCheckResult
    | SeenNameListResponse
    | SeenNameClearResult,
  mode: 'add' | 'check' | 'list' | 'clear',
): string {
  if (mode === 'add') {
    const r = result as SeenNameAddResult;
    const out: string[] = [];
    out.push(`Added ${r.added.length} name(s):`);
    for (const n of r.added) out.push(`  - ${n}`);
    if (r.skipped_already_present.length > 0) {
      out.push(`Skipped ${r.skipped_already_present.length} (already present):`);
      for (const n of r.skipped_already_present) out.push(`  - ${n}`);
    }
    out.push(`Total seen: ${r.total_seen}`);
    return out.join('\n') + '\n';
  }

  if (mode === 'check') {
    const r = result as SeenNameCheckResult;
    if (r.results.length === 0) return 'No names to check.\n';
    const out = ['NAME\tSTATUS'];
    for (const item of r.results) {
      out.push(`${item.name}\t${item.is_seen ? 'SEEN' : 'NEW'}`);
    }
    return out.join('\n') + '\n';
  }

  if (mode === 'list') {
    const r = result as SeenNameListResponse;
    if (r.names.length === 0) return 'No seen names yet.\n';
    const out = ['ORIGINAL\tNORMALIZED\tADDED_AT'];
    for (const e of r.names) {
      out.push(`${e.original}\t${e.normalized}\t${new Date(e.added_at).toISOString()}`);
    }
    out.push('');
    out.push(`Total: ${r.total}`);
    return out.join('\n') + '\n';
  }

  // mode === 'clear'
  const r = result as SeenNameClearResult;
  return `Removed ${r.removed} name(s).\n`;
}
