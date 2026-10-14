# Changelog

## Unreleased

### Added — cgraphx web: development tasks page

- New sidebar entry 「开发任务」 with a task list (`/tasks`) and a task detail
  page (`/tasks/<id>`), read through the task facade only.
- Per-task totals: sessions, commits, active time (events split on gaps over
  1 hour) and work time (first-to-last event), summed across bindings.
- Detail page shows outputs (committed / edited files plus the linked
  requirement directory) and references (files and knowledge concepts the
  sessions read, inferred from tool calls and commands), with links into the
  knowledge base, system map and schema pages.
- Strictly read-only: projects without task tables show an install hint and no
  table is created; external task sources are never called.

### Added — `cgraphx task`: session ↔ development task binding

A new `task` subsystem binds Claude Code sessions to development tasks so
timeline events can be grouped per task.

- New command group `cgraphx task list | use | current | clear | show`
  (「task」 here means a development task, unrelated to Claude Code's Task tool).
- Tasks and bindings live in new `task_*` tables in `.cgraphx/cgraphx.db`.
- Optional external task source: `.cgraphx/task-source.json` points at an
  HTTP endpoint listing tasks; without it, tasks are created manually by name.
- A requirement spec can declare its task in the header (`> 任务: <值>`);
  editing files under that `docs/features/<feature-id>/` directory auto-binds
  the current session to the declared task.
- Two hidden hooks are wired by `cgraphx install`: `task-session-start-hook`
  (SessionStart) and `task-post-tool-use-hook` (PostToolUse).

### Changed — timeline capture enhancements

- New `session_start` / `session_end` event types, recorded by two new hidden
  hooks `timeline-session-start-hook` / `timeline-session-end-hook`.
- `git_commit` events now record `session_id` and the current branch in
  `metadata.branch`.
- `Skill` tool summaries now carry the skill name.
- Turn state is isolated per session in `.cgraphx/turns/<session>.json`; the
  old shared `.cgraphx/timeline-current-turn.json` is removed by `install`.
- The human-readable summary of `stop` events (the end of one conversation
  turn) is now `turn ended` / `turn ended (Nms)` instead of `session ended`,
  which is reserved for `session_end`.

Already-installed projects must re-run `cgraphx install` to wire the new hooks.

### Breaking — knowledge base `owners` frontmatter is now required

The markdown knowledge base validator (`cgraphx docs validate` / `docs index`)
now treats `owners` as a required frontmatter field, alongside `title`,
`document_type`, `domains`, `concepts`, `status`, `source_type`, and `updated`.
A document with a missing or empty `owners` list is rejected as
`missing_required_field` and skipped during indexing; a scalar `owners` is
still rejected as `field_type_error`.

Existing knowledge documents without `owners` must add at least one owner to
keep validating and indexing. `knowledge-migrate` can backfill the field.

### Breaking — features status field replaced by derived stage

`cgraphx features` no longer reads the hand-maintained `> 状态:` header line.
The requirement stage is now derived live from the artifacts present in
`docs/features/<feature-id>/`: a test report → 已验证 (verified), a `plan/` →
已规划 (planned), a spec → 已规格 (specified), none of these → unset.

- `features list` and `my-features.md`: the 状态 column is replaced by 阶段.
- `--status` is removed and replaced by `--stage <阶段>` (exact match, no alias).
- The JSON record field `status` is replaced by `stage`; the internal `source`
  field is removed.
- Pre-existing `> 状态:` header lines are ignored and left untouched;
  负责人 / 日期 / `--mine` are unchanged.

### Changed — `upgrade` now refreshes the project it runs in

`cgraphx upgrade` is now meant to be run inside a project directory. After
pulling the latest package it automatically re-runs the project `install`
with the freshly installed CLI, so one command brings both the CLI and the
current project's `.claude/` skills / hooks and `.cgraphx/` up to date — the
old "go re-run `cgraphx install` in every project" reminder is gone.

- Already on the latest version → the pull is skipped but the project
  refresh still runs (idempotent); `--check` remains purely read-only.
- Unsafe directories ($HOME / a filesystem root) skip the refresh with a
  warning; a directory with no `.cgraphx/` or `.claude/` asks for
  confirmation first (non-interactive stdin declines).
- `--no-install` restores the previous package-only behavior.

### Removed — dead "前置注入 prompt-hook" installer option

The `cgraphx prompt-hook` subcommand was removed together with the 1.x code
graph, but the installer still offered to wire it as an opt-in — a dangling
hook that errored (`unknown command`) on every prompt submission, and which
`install -y` even forced on. The installer question and the
`install --prompt-hook <bool>` flag are gone; `install` now self-heals
leftover `hooks.UserPromptSubmit → "cgraphx prompt-hook"` entries (uninstall
already stripped them). Pinning back to an old release still runs that old
installer's behavior — nothing this release can do about old binaries.

### Fixed — Windows `npm` / `npx` spawns no longer fail with EINVAL

Since the CVE-2024-27980 hardening (Node ≥ 20.12), spawning `.cmd` shims
without `shell: true` throws EINVAL on Windows, which broke every npm
invocation `upgrade` makes there (`npm view`, `npm install -g`,
`npm root -g`). All npm spawns now pass `shell: true` on Windows (hardcoded
arg vectors only — no user input reaches the shell).

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
