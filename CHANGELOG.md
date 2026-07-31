# Changelog

## Unreleased

### Breaking — knowledge base `owners` frontmatter is now required

The markdown knowledge base validator (`cgraphx docs validate` / `docs index`)
now treats `owners` as a required frontmatter field, alongside `title`,
`document_type`, `domains`, `concepts`, `status`, `source_type`, and `updated`.
A document with a missing or empty `owners` list is rejected as
`missing_required_field` and skipped during indexing; a scalar `owners` is
still rejected as `field_type_error`.

Existing knowledge documents without `owners` must add at least one owner to
keep validating and indexing. `knowledge-migrate` can backfill the field.

## 2.0.0

cgraphx 2.0 is a rebuild focused on the three subsystems AI coding agents reuse
most — a local markdown knowledge base, read-only database introspection, and a
developer timeline. The code-graph layer that gave cgraphx its 1.x name is gone,
along with its MCP server and telemetry. This is a **breaking** release: 1.x
commands, MCP tools, and project artifacts do not carry forward.

### Breaking — removed code-graph commands

Every code-graph CLI command is gone. Calling any of them now exits with
`error: unknown command '<name>'`:

- `explore`
- `query`
- `node`
- `callers`
- `callees`
- `affected`
- `index`
- `sync`
- `search`
- `files`
- `context`
- `mark-dirty` / `sync-if-dirty` (legacy auto-sync hooks)

The 2.0 `init` command deliberately does **not** build a code-graph index — it
only creates the shared `.cgraphx/cgraphx.db` and applies the markdown + timeline
schemas.

### Breaking — removed MCP server

The `cgraphx serve` command (and `cgraphx serve --mcp`) is removed; there is no
server process in 2.0. The MCP tools that disappeared with it:

- `codegraph_explore`
- `codegraph_node`
- `codegraph_callers`
- `codegraph_callees`
- `codegraph_impact`

The Claude Code installer (`cgraphx install`) no longer writes a `.mcp.json`
into target projects — the three remaining subsystems are driven through the
`cgraphx` CLI and the deployed skills, not through MCP.

### Breaking — removed telemetry

Usage collection is gone entirely: no `cgraphx telemetry` command, no
pre-action usage-record hook, no analytics. 2.0 runs fully offline and reports
nothing outward.

### Breaking — 1.x graph tables are no longer read or written

Existing 1.x projects may still carry a `.cgraphx/cgraphx.db` populated with the
old graph schema (`nodes`, `edges`, `files`, …). 2.0 neither reads nor writes
those tables — they are simply ignored. The 2.0 shared DB only ever contains the
`markdown_*` and `timeline_*` tables. You can keep an old DB around (2.0 won't
touch the graph tables) or delete `.cgraphx/cgraphx.db` and re-run `cgraphx init`
for a clean start.

### What's new in 2.0

- **Single package, layered source.** One npm package (`cgraphx`) with a
  `src/{cli,core/{markdown,dbquery,timeline}}` layout. The CLI entry point is
  `dist/cli/index.js`, wired as the `cgraphx` bin.
- **Reused subsystems.** `docs` (markdown knowledge base), `db` (MySQL /
  PostgreSQL read-only introspection), and `timeline` (Claude Code development
  events) each live behind the shared project-local `.cgraphx/cgraphx.db`.
- **Rebuilt `status`.** `cgraphx status` summarizes all three subsystems in one
  report — docs/concepts/domains counts, recent timeline events by type, and
  configured db profiles.
- **Installer without MCP.** `cgraphx install` deploys the `.claude/` template
  (skills / agents / commands / hooks / plugins) into local projects, wires the
  timeline hooks, and leaves `.mcp.json` untouched.
- **New bin layout.** Tests and tooling that pointed at `dist/bin/codegraph.js`
  (1.x) now resolve `dist/cli/index.js`.

### Upgrading from 1.x

cgraphx 2.0 has no migration path for 1.x code-graph data — the graph is gone by
design. To adopt 2.0:

1. Install: `npm install -g cgraphx@2` (or `cgraphx upgrade` from a 1.x bundle).
2. In each project: `cgraphx init`, then `cgraphx docs index` for the markdown
   knowledge base.
3. Reconfigure Claude Code: `cgraphx install --location local` (this no longer
   writes `.mcp.json`; remove any 1.x `cgraphx serve` entry from your project's
   `.mcp.json` by hand if present).
