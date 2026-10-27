# Changelog

## Unreleased

### Added — `/knowledge-migrate` moves Claude Code auto memory into the project

Claude Code keeps its auto memory outside the project, under
`~/.claude/projects/<encoded path>/memory/`, where only you and only that
directory can read it. `/knowledge-migrate` reads the memories of the main
directory — and of every copy, when the project uses copies — and lists where
each one goes: decisions, rules and lessons to the knowledge base, written the
`/knowledge-write` way; conventions every turn must follow to the project's root
`CLAUDE.md`; personal preferences to your `~/.claude/CLAUDE.md`. Change a
destination or drop a line, then say 「迁」. Memories that were already migrated,
or that mention branches and files that no longer exist, are left out by
default.

After writing, it turns off your Claude Code auto memory for this project:
`"autoMemoryEnabled": false` in your own `.claude/settings.local.json`, in the
main directory and every existing copy; copies opened later inherit it. The
memory files stay where they are. From then on, the session-start context tells
the agent to ask where to record anything you want it to keep doing — the
knowledge base, the project's conventions, or your personal settings. Projects
that keep auto memory on see no change.

The skill reuses the name of the knowledge-base migration skill retired on
2026-10-19. `skills/knowledge-migrate` is off the `deprecated-assets.json` list,
so upgrades deploy the new skill instead of removing it.

### Changed — clarification locks business definitions before drawing the plan

`/dev-clarify` has a new step before the feature cards: business definitions
(口径). Every word the feature reads data by — which orders count, which date
"the last 90 days" uses, whether amounts subtract refunds — gets a definition
with in/out examples, numbered K1, K2… The AI reuses definitions from the
knowledge base and existing reports first and flags any conflict; the person
corrects the values. Cards, diagrams and the spec refer to definitions by
number, and new ones are offered to `/knowledge-write` when implementation
wraps up. `/unit-spec` and `/ui-case` turn every in/out example into a
boundary case: what counts must appear, what doesn't must not.

For requirements with several feature points, clarification also writes the
feature plan to a draft, `<prefix>-功能方案-v<N>.md`, with a mermaid swimlane
diagram of how users go through it. The diagrams follow the design document's
style, and the drawing rules now live in one shared file. The conversation
still shows the tables, plus the draft's path. `/dev-spec` copies the confirmed
version as the spec's first section, and `/dev-handoff` points new sessions at
the draft instead of copying it. The draft is not a registered artifact, so
`features check` skips it.

### Changed — requirement directories can follow the project's naming rule

Projects can now write their own requirement directory naming rule in
`docs/guides/feature-standards.md`, in the 「需求目录命名」 section — for
example a module prefix in front of the date
(`order-2026-10-25-REQ-1024-订单导出`). The skills that create a requirement
directory read that section and name the directory after it; a project without
the section keeps the default `YYYY-MM-DD-[业务ID-]<标题>` format.

The date segment no longer has to sit at the start of the directory name. The
program takes the first `YYYY-MM-DD` in the name, wherever it appears, and the
file prefix is the feature-id with that date segment removed
(`order-REQ-1024-订单导出-spec.md`).

Directories that start with a date are untouched: the date, title, directory
task name and file prefix are identical to before. Only hand-made old
directories whose date is not at the start show a different local title and
task name (`活动-2026-11-11` now appears as `活动`); the platform keeps the name
declared the first time.

### Changed — skills renamed by stage prefix

Skill names now start with the stage they belong to, so typing `/dev-`,
`/api-` and so on lists one stage's skills together. 20 skills and the `/end`
command are renamed; what they do is unchanged. `cgraphx install` (and
upgrade) removes the old directories through `deprecated-assets.json`, so old
and new names never trigger side by side.

| Stage | New name | Old name |
|---|---|---|
| project setup | `init-guides` | `init-project-guides` |
| | `init-knowledge` | `knowledge-init` |
| | `init-ddl` | `export-table-ddl` |
| requirement main line | `dev-clarify` | `clarify-requirements` |
| | `dev-wireframe` | `write-wireframe` |
| | `dev-handoff` | `handoff-session` |
| | `dev-spec` | `write-spec` |
| | `dev-plan` | `write-plan` |
| | `dev-impl` | `implementation` |
| | `dev-impl-subagent` | `subagent-implement` |
| | `/dev-end` (command) | `/end` |
| API testing | `api-case` | `write-api` |
| | `api-run` | `run-api-test` |
| UI testing | `ui-case` | `write-ui-test` |
| | `ui-run` | `run-ui-test` |
| unit testing | `unit-spec` | `write-unit-test-spec` |
| | `unit-code` | `write-unit-test-code` |
| docs and reports | `doc-delivery` | `write-docs` |
| | `doc-workload` | `write-workload` |
| | `doc-report` | `developer-timeline` |
| | `doc-backfill` | `iboc-check` |

Unchanged: `knowledge-recall`, `knowledge-write`, `db-query`,
`visual-explain`, `audit-login-security`, `cgraphx-guide`.

Platform reporting sends the new names in `skillName` from now on, so
per-skill statistics on the platform break at the rename unless the platform
maps old names to new ones.

### Changed — `my-features.md` links each requirement to its spec

`.cgraphx/my-features.md`, written by `cgraphx features sync`, now has three
columns: 日期 / 阶段 / 需求. Each requirement name links to its main spec
(the file `cgraphx features show` treats as the main spec), so it opens with
one click in the editor. Links are relative to the index file and wrapped in
angle brackets, so directory names with spaces or parentheses still open. A
requirement without a spec yet links to its directory and is marked
「（还没有 spec）」. The old 目录 column is gone. `features list --mine`
output, including `--json`, is unchanged.

### Changed — `doc-delivery` design docs explain the change with diagrams

The design doc was a long technical write-up that leaders could not take in
at a glance. It now explains the change in two layers of diagrams, in
business language. A process panorama marks which steps changed, with 原来
and 现在 side by side when the flow itself changed (steps added, removed,
reordered or triggered at a different time). Then each step whose internal
logic changed gets its own section: a swimlane diagram of caller and service
drawn from the code, changed steps in yellow and the normal path in green.
It still opens with 30 秒看懂 and closes with data changes, key decisions and
risk. Diagrams are mermaid styled after PlantUML activity diagrams
(right-angle edges, grey boxes, white lanes), so they render in GitLab and in
IntelliJ's markdown preview. The design doc is markdown only: the HTML
option is dropped, since its template never loaded mermaid and diagrams did
not render. The first-screen heading that `features check` requires for new
design docs changes from 架构总览 to 30 秒看懂.

### Added — release flow and requirement copies

Until now every requirement of a release was committed onto one shared
branch: a release review could not tell which change came from which
requirement or whether anything slipped in, conflicts were hard to untangle,
and agents working in parallel landed their changes on the same branch. Two
optional flows address this. Projects that use neither keep developing on
the current branch as before.

- Version branches and release review. Right after a release, run
  `/release-start` on `main` (`master` when there is no `main`): it tags the
  release (`git tag -a v2.0.10 -m "发布 2.0.10"`), creates the version branch
  `dev/2.0.11` and switches to it. Requirements reach the version branch only
  as merge commits titled 「合入需求：<title>」. On release day, commit the
  version bump as `chore(release): 版本号 2.0.10→2.0.11` and run
  `/release-review`. It writes `docs/releases/v2.0.11-发版审核.md` — commits,
  files and tests per requirement, suspected smuggled changes, sensitive
  changes (SQL, dependency manifests, `.env*`), files two requirements both
  changed, a dry-run merge into `main`, defects, and requirements still in
  copies — commits it as `chore(release): 2.0.11 发版审核报告` and gives a
  verdict: 可以发, 有风险 or 不能直接合. Say 「发」 and it merges the version
  branch into `main` as 「发布 2.0.11:合入 …」 and lists the copies that can be
  deleted. It does not tag, publish or push: publish the way you do today,
  then run `/release-start` again, which tags the release.
- A commit-msg hook keeps the version branch clean: on `dev/x.y.z` it
  rejects direct commits and lets through only merge commits and commits
  starting with `chore(release):`, whether they come from an agent or the
  terminal. `/release-start` installs it with `cgraphx release guard` each
  time it runs, restoring it if a hook manager overwrote it;
  `cgraphx install` does not install it, and `cgraphx uninstall` removes it.
- Requirement copies. `/dev-start <requirement>` clones the project next to
  itself as `<project>@<prefix>` with copy-on-write (`cp -cR` on APFS,
  `cp -R --reflink=always` on Linux: about a second for a 4 GB repository,
  almost no extra disk), creates `feat/<prefix>` (`fix/` for bug fixes) from
  the main directory's current branch, and gives the line for starting a new
  session there; when the disk cannot clone (on macOS: another volume, or a
  disk that is not APFS), it asks before making a full copy. Ignored files
  such as dependencies and `.env` come along, so nothing needs reinstalling;
  untracked files stay behind, except the
  requirement's own drafts, which move into the copy. In the copy,
  `/dev-merge` merges the main directory's current branch in, so conflicts
  are resolved there; in the main directory, `/dev-merge <requirement>`
  dry-runs the merge, then merges. Without a version branch, a copy merges
  back into whatever branch the main directory is on and is offered for
  deletion right after. `/dev-handoff` opens one copy per handoff target when
  the main directory is on a version branch, and by default when copies are
  already in use. The program side is
  `cgraphx replica create | list | remove`; `remove` deletes a copy only when
  it matches its registration and has no uncommitted changes, and never
  follows links.
- Copies share the main directory's data. A copy's `.cgraphx/` holds a
  `shared` link to the main `.cgraphx/`, and every copy is registered in
  `.cgraphx/replicas/<name>.json`. Sessions, tool calls, commits and task
  bindings made in a copy are recorded in the main directory; a session
  started in a copy belongs to the copy's requirement unless it was bound
  with `cgraphx task use`. `task show`, `sync` and `/doc-report` show
  project-relative paths, the records outlive the copy, and `features list`
  also lists requirements being worked on in copies, marked 「在副本 <name>」
  (in JSON, a `replica` field on those entries only). The knowledge-base
  index and `my-features.md` stay per directory, so knowledge written in a
  copy is recalled elsewhere once it is merged. If the main directory is
  moved or renamed, hooks in the copy keep passing and cgraphx commands print
  「副本关联的主项目不在 <path> 了」. `timeline uninstall --purge` is refused in a
  copy. Copies run on macOS and Linux; the dry-run merges need git 2.38 or
  later.
- `CGRAPHX_DIR` now applies to all per-project data. The turn state files
  (`turns/`), `db-profiles.json` and `db-query.log` used to stay in
  `.cgraphx/` even when `CGRAPHX_DIR` named another directory; they now live
  next to the database in that directory. If you set `CGRAPHX_DIR`, move an
  existing `.cgraphx/db-profiles.json` there.
- Merge commits are recorded. `git merge` does not run the post-commit hook,
  so the timeline never saw merges. A post-merge hook now records merge
  commits as `git_commit` events with an empty file list and the merge's
  file and line counts in `metadata.merge`. A conflicted merge finished with
  `git commit` is recorded the same way; fast-forwards are skipped, and no
  commit is recorded twice.
- Git hooks follow `core.hooksPath`. The timeline hooks and the release guard
  are written to the directory `git rev-parse --git-path hooks` reports, so
  commits are now recorded in projects that use husky. Snippets go right
  after the shebang, so a hook ending in `exec` still runs them; a hook that
  is not a shell script is left untouched, with a notice. `cgraphx install`
  and `upgrade` add the missing timeline snippets.
- `/dev-impl-subagent` no longer stops on `main` or `master` to ask whether
  to create a branch; like `/dev-impl`, it works on the current branch. Both
  now stop on a version branch and point to `/dev-start`.

## 2.0.10 - 2026-10-21

### Changed — clarification realignment, second pass: review gates follow the decisions

2.0.9 moved mechanism choices from plan into spec, but the human review
point and the code reading stayed in plan, and some wording of the old split
was left behind. This release closes those gaps:

- `write-spec` reads the code a design depends on before deciding (existing
  mechanisms, reuse, callers) instead of relying only on the clarify
  exploration. Decision tables gain a 没选的(为什么) column and reasons cite
  the files or tables they rest on. Hard-to-reverse decisions (persisted data
  structures, external interfaces and URLs, module boundaries, security
  boundaries) are marked 🔒 and listed in the closing reply for explicit
  confirmation; the rest are adopted unless changed. D numbers run through
  the whole spec so plan can cite them.
- `write-plan`'s design preview becomes a placement table: where each 🔒
  decision lands (tasks, files) and which contract guards it. A new
  hard-to-reverse decision found while planning goes back to spec.
  `plan-document-reviewer-prompt` now blocks plans that pick mechanisms the
  spec did not decide.
- `implementation` without a spec or plan lists hard-to-reverse changes (new
  tables or fields, external interfaces, module or security boundaries)
  before touching code and waits for confirmation.
- `clarify-requirements` cards show what the user actually gets (exported
  columns, page content, message text) and add a ⚠️ 边界 line for empty
  data, oversize, missing permission and repeats, carried into the 功能方案
  table. A table of common technical forks (sync/async, live/cached,
  hard/soft delete, full/paged, all-or-nothing/partial) shows how to phrase
  each as an experience variant. The wireframe prompt moves from ⓪ to ③,
  when a card touches the interface. The flow opens with a trimming table for
  single-point requirements, bug fixes, refactors and data tasks; only
  multi-point requirements run the ⑤ review.
- New `clarify-requirements/function-plan-reviewer-prompt.md` for the ⑤
  adversarial review: inputs, four dimensions with examples, output format.
- Leftover wording of the old split (plan decides mechanisms) removed from
  FLOW-MAP.md, `clarify-requirements`, `write-spec`, `write-plan` and the plan
  reviewer prompt; red lines that only restated the body dropped from
  `clarify-requirements` and `write-spec`. FLOW-MAP.md's 人工确认点 and
  cgraphx-guide (how-to-use.md/html) updated.

## 2.0.9 - 2026-10-21

### Changed — clarification realignment: proposal-and-review instead of Q&A

Alignment failures in the clarify stage (questions people cannot read,
consequences people cannot foresee, errors surfacing only after
implementation) are now addressed across the main line:

- `clarify-requirements` rewritten as stage one, 定业务. It explores project
  reality first (code, local DDL knowledge, knowledge base — also reused by
  spec later), then walks ⓪–⑥: explore → identify functional points with
  classes (核心 / 支撑 / 建议新增 default-dropped / 边界外) → align the
  list → per-point proposal cards (end-to-end behavior chain with concrete
  values, ⚓ grounding in existing tables/impl, 🔗 dependencies, 🎭
  experience variants) → collect a 需求功能方案 draft → adversarial review
  by an independent subagent (矛盾/遗漏/过度/分类失真) → user sign-off.
  People review and edit proposals instead of answering abstract questions;
  business-value edits are accepted instantly, chain-structure edits get an
  impact echo first.
- `write-spec` is now stage two, 细节方案设计 + the sole contract. It
  consumes the 功能方案 (point list, variant choices, reality constraints)
  and decides, per functional point, mechanism, data model
  (tables/key fields/constraints — indexes and full DDL stay in plan),
  interface contracts and failure strategy via design decision tables
  (option / choice / reason / blast radius) reviewed in batch. Detail
  choices that change observable behavior bounce back to clarify.
- `write-plan` no longer picks mechanisms. It decomposes and orders only;
  missing decisions go back to spec instead of being decided in plan. The
  index drops the 实现手段决策 section for a 细节方案核对 checklist.
- Flow descriptions updated everywhere they are retold: template CLAUDE.md,
  FLOW-MAP.md, cgraphx-guide (SKILL.md, how-to-use.md/html).

### Breaking — skills slimmed from 33 to 25

- Removed 10 skills. `cgraphx install` deletes their directories on upgrade;
  files under `docs/` are left alone.
  - `knowledge-api`: merged into `knowledge-recall`.
  - `code-map-write`, `code-map-recall`: code maps are no longer maintained.
    The web 系统地图 page and existing `docs/code-map/` files stay, marked
    as no longer maintained.
  - `write-prd`, `write-design-doc`, `write-api-doc`: merged into
    `/write-docs`, which asks which documents to write. File names are
    unchanged.
  - `knowledge-migrate`: no replacement.
  - `write-delivery-guide`: no more after-the-fact delivery guides. Use
    `/visual-explain` when something needs explaining.
  - `handdrawn-deck`, `handdrawn-sketch-engine`: dropped; they are not part of
    the development workflow.
- New `visual-explain`: turns what was just discussed, or a named file or
  topic, into a one-page HTML explainer: one picture for the whole, then the
  key points with examples. Pages for a feature go into its directory; others
  go into `.cgraphx/visual/`, which is never committed.
  `/clarify-requirements` ends with a flow chart and a decision table in chat
  and points to it.
- `subagent-implement` stays, rewritten: one session hands each task of the
  plan to a subagent in the plan's order; the main session commits each task,
  runs the plan's verification once at the end, fixes failures, then suggests
  `/code-review`.
- Plans are an `index` plus one file per task. Tasks are split by type first;
  a task that would touch more than 15 files is split further where its parts
  can run in parallel.
- Specs drop the 「一图看懂」 section; plan design previews keep only the
  key-decisions table.
- Skills write the `> 产物:` header and the registered opening section for
  every new artifact; `/end` writes a release record once the work is live.
- New `cgraphx features check --staged` checks only staged files under
  `docs/features/`. The precommit hook runs it before AI commits and blocks
  on failures, even with `CGRAPHX_PRECOMMIT_REVIEWED=1`.
- `features check` no longer requires 「一图看懂」 in specs, checks the
  opening section of seven more artifact types, and skips that check for
  HTML files.

### Added — cgraphx sync: report to the R&D management platform

- New `cgraphx sync connect | now | status | disconnect`. `connect` asks for
  the password at a prompt or reads it from `--password-stdin`; the password
  is never stored. Use `--force` to switch to another account.
- Hooks never touch the network: they only spawn a detached `sync-worker`.
  `cgraphx install` adds Stop / SessionEnd / SessionStart hooks, wrapped with
  `2>/dev/null || true` so older global binaries stay silent.
- Upload whitelist: event type / tool name / skill name, task bindings,
  commits, artifacts mapped to platform types, and references to
  `docs/knowledge/`, `docs/schema-knowledge/`, `docs/code-map/` and
  `docs/design-map/`. Prompts, command text, file contents and absolute paths
  are never sent.
- Failures are retried; account / repo / membership rejections pause syncing
  with a one-line notice at session start; sessions the platform rejects are
  isolated instead of blocking the rest.
- New `sync_*` tables with their own schema version.
- `cgraphx docs show --body`, and `--session` on `docs find` / `docs show`,
  record precise references for the session.
- knowledge-recall / knowledge-api skills now read bodies via
  `docs show --body`.

### Fixed — sync stopped declaring tasks on platform protocol 1.2 and later

- Sync checked the platform protocol version for an exact `1.1`, so against a
  1.2 or later platform it stopped sending task declarations and binding task
  keys: tasks for new `docs/features/` directories were never created on the
  platform, and their sessions were reported as unassigned. Versions are now
  compared numerically by major.minor.
- Projects that already synced against such a platform re-send their
  bindings once on the next sync, which fills in the missing declarations and
  task keys.

### Fixed — git commits lost when committing in quick succession

- The post-commit hook ran the recorder in the background, which read `HEAD`
  only after it started; back-to-back commits (`git commit && git commit`)
  were recorded as the last commit several times and the earlier ones were
  lost. The hook now captures the commit hash and branch synchronously and
  passes them via `CGRAPHX_COMMIT_SHA` / `CGRAPHX_COMMIT_BRANCH`.
- `cgraphx install` now upgrades an existing cgraphx post-commit snippet in
  place (your own hook lines are kept). Re-run it in already-installed
  projects to pick up the fix; older cgraphx binaries ignore the new
  variables and keep the previous behavior.
- Already-lost or duplicated commit events are not backfilled.

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
