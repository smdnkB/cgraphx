# Changelog

## Unreleased

### Changed — clarify and plan reviews are narrower and no longer block

In a real requirement the dev-clarify adversarial review took about 16
minutes and the dev-plan review about 19, mostly re-verifying facts the main
agent had already read. Every real problem they found sat in a claim that
looked verified but was inferred, or in something a deterministic check could
have caught.

- dev-clarify: each row of the reality-constraint list is marked verified or
  inferred (verified = the deciding line of code, library source included, or
  the data was read), and the draft lists high-risk assertions. The review
  runs in the background right after consolidation while the user reads the
  draft, skips verified rows, chases inferred rows and assertions, and stops
  at 30 tool calls, listing what it did not finish. Clarify ends only after
  its findings are settled.
- dev-plan: a new pre-write self-check step, recorded in the index — run every
  unified-verification command on the baseline, check each repository's
  staged and untracked files, list callers of changed shared methods and
  whether their results leak into API responses, put everything the
  dev-impl-subagent main session needs into the four index sections it reads,
  and spell out how fix commits are numbered. The plan review now runs only
  for large requirements, trusts the self-check, focuses on spec alignment
  and cross-task contracts, and stops at 30 tool calls.
- dev-impl-subagent: fix commits follow the fix-commit format in the index's
  commit section, falling back to `fix(<scope>): ...` only when it says none.
- dev-spec: re-checks inferred rows and high-risk assertions it depends on.

### Changed — knowledge base index refreshes itself before queries

`cgraphx docs concepts / domains / tags / find / refs / dedup / show` now check
the files under `docs/knowledge/` (path, size, modification time, plus the
cgraphx version) before querying, and rebuild the index when anything changed.
Writing a knowledge file, merging a requirement or pulling a branch no longer
needs a manual `cgraphx docs index`; the skills that asked for one
(dev-start, dev-merge, knowledge-write, knowledge-migrate, knowledge-recall)
no longer do. `docs index` still rebuilds on demand and prints the skip
report. A failed refresh only prints a note to stderr and queries the previous
index. The fingerprint lives in a new `markdown_index_state` table in the local
`.cgraphx/cgraphx.db`; the markdown schema version is unchanged, so an older
cgraphx can still read the database.

### Fixed — DeepSeek commits pass the gate and are recorded to their session

DeepSeek Harness exports `DSH_SESSION_ID`, and the commit-msg gate snippet now
probes every session source instead of a fixed list, so a DeepSeek commit is
gated like one from Claude Code or CodeBuddy and a rejected commit stops with
the same message. The post-commit hook records the commit to that session; a
commit made inside a sub-session keeps the sub-session's own id instead of
being mapped to its parent. Projects that only upgraded cgraphx without
re-running `cgraphx install` keep the old snippet: their DeepSeek commits are
not gated, and they are not falsely marked as skipped in the timeline either.

### Fixed — flow commands and session titles attach to the right task

Board flow commands are now matched only by the command's first argument, and
only when it equals the full task title, feature id or replica directory name;
a shorter name that used to prefix-match a longer one no longer pulls the
session into the wrong task. Skill arguments still match by first word, or by
containing the requirement directory. DeepSeek sub-session titles are no longer
recorded against their parent session, and the titles already stored for a
project are recomputed once, so a sub-session title no longer overwrites the
main session's own.

### Added — board shows versions and filters by version

Tasks on the board now show the version they belong to: merged versions display
as `2.0.14`, unreleased ones as `2.0.15 未发`, a version planned from a replica's
base branch as `计划 2.0.15`, and one that never made it as
`计划 2.0.14 · 没赶上`. A version dropdown in the header filters the task list
and shows how many tasks each version has; when a version is selected, tasks
with no local sessions are listed too. Versions are computed from merge records
in each version branch and from replica base branches — no new records are
written.

### Changed — install keeps only the selected agents

`cgraphx install` now leaves exactly the agents you selected. An agent that
already had cgraphx installed but is unchecked in the interactive list, or
left out of `-t`, has its cgraphx config removed — the same files
`cgraphx uninstall -t <agent>` removes; your own files in that agent's
directory, the local `.cgraphx/`, project data and the git hook snippets
stay. `install -y` without `-t` (what `cgraphx upgrade` runs) still updates
every installed agent, and `-t none` leaves agent configs alone. The
"skill is behind" notice now names the agent it is about.

### Changed — replicas are git worktrees

A replica is now a git worktree (`git worktree add`) next to the main
directory instead of a copy-on-write copy of the whole directory. Only what
an agent needs is carried over: each agent's config directory, instructions
file and extra config (Claude Code's `.mcp.json`), plus the files listed in
the project's `.worktreeinclude` (gitignore syntax, paths relative to the
project root; cgraphx neither creates nor commits it). Dependencies and
build output are not copied — install and build once inside the replica.
The carried files are hidden from git in the replica through a per-worktree
`core.excludesFile` (the main repository gains
`extensions.worktreeConfig`), so the carried files stay out of the
replica's `git status` while the main directory still sees them; the shared `.git/info/exclude` is
no longer written. A main directory with uncommitted tracked changes no
longer blocks replica creation — it only produces a warning. Merging and
syncing use the requirement branch from the same repository
(`refs/heads/<branch>`), so the `git fetch` steps are gone. Deleting a
replica removes the worktree with `git worktree remove --force` and keeps
the branch when it still has unmerged commits; opening the same
requirement again reattaches to that branch and keeps the original base
commit.

**Breaking:** `--full-copy` and the `no_cow` / `dirty_main` error codes are
gone, and copy-on-write replicas created by an older version are not
supported. Remove them with the previous version's `cgraphx replica remove`
before upgrading: for an old replica the branch does not exist in the main
repository, so the new commands report it as undecided and refuse to delete
it rather than deleting the wrong thing.

### Changed — projects are recognized by name

A project is now identified by its name alone; the remote address no longer
takes part in deciding whether two directories are the same project.
`cgraphx install` asks for the name once per project (with `-y`, or when
`upgrade` re-runs it, the suggested default is used and written back) and
stores it in the local git config (`cgraphx.projectName`, or
`cgraphx.<subdir>.projectName` for a project in a subdirectory of the
repository; a directory outside git keeps it in `.cgraphx/project.json`).
Changing the remote, forking, or cloning from a different URL no longer
splits a project's history. The project directory is named after the
project (`~/.cgraphx/projects/cgraphx/`), so directories with the same name
share one timeline and the same project-level connection profiles. A
directory that meets an existing project with that name gets one notice (on
stderr, and inside `install`) while the data is still recorded; rename with
`cgraphx project name`. `identity.json` moves to version 2 (`name` plus the
`origins` used only by that notice). Removal records and duplicate checks
live in `~/.cgraphx/sessions.db`, the latter in a new `dirs_checked` table.
A start directory that still exists is classified on the spot, so changing
the remote no longer makes ingestion miss new events; a rebuild no longer
re-parses session files already recorded to another project.

### Changed — the timeline is parsed from agent session files instead of hooks

cgraphx no longer records agent events through hooks in the agent's
configuration. The seven hidden `timeline-*-hook` commands and the
`precommit-check` PreToolUse hook are deleted, and `cgraphx install` /
`uninstall` remove their dead entries from agent settings; the seven
timeline commands stay registered as hidden no-op commands that read
stdin and exit 0, so a project that upgraded but has not re-run install
sees no errors. Events now come from the session files the agents
themselves leave behind: before a timeline query, after a commit (the
post-commit hook's background process), and after `install` merges old
data, cgraphx parses whatever is new in Claude Code's
`~/.claude/projects` (`CLAUDE_CONFIG_DIR` wins) and CodeBuddy's
`~/.codebuddy/projects` transcripts — each agent has one reader that
produces uniform session facts — and appends the events to the project's
database. A tool event is one row per call: timestamp from the result
line, cwd from the call line (the directory before the command ran), and
duration as the difference between the two
(`metadata.duration_source: "transcript"`); the turn number is the uuid
of the turn's question. `pre_tool_use` and `session_end` are no longer
recorded — `--type` still accepts them, but the hook-era data is gone
after the rebuild below. Per-file offsets and start-directory
classifications live in a new user-level `~/.cgraphx/sessions.db`
(mode 0600) that does not follow a project's data: `project remove`
records the removal and later ingests only pick up facts from after it,
and `project name` clears the remembered start directories so they are
reclassified. A start directory that is not an absolute path on this
machine (a `D:\...` path in a session file read on macOS) belongs to no
project. The three session-start notices (skill version, auto-memory
direction, git hook repair) now print with the first cgraphx command of
a session, on stderr, once per session (or once per project per day
outside a session).

The first `cgraphx install` (or first timeline query) after upgrading
wipes the events the hooks recorded and rebuilds the timeline from
session files in one pass — commits, which the git hooks recorded, are
kept, and the merge of old data now copies only commits and
`timeline_roots`. A project rebuilds once and only once. **Sessions whose
files are gone cannot come back**: agents clean up their session files
after about 30 days, so on a machine where those files were already
cleaned up the history before the upgrade is lost.

### Changed — the commit gate moved into the git commit-msg hook

Agent commits are gated by a `commit-msg` git hook snippet now — a new
hidden `commit-gate-hook` command with exit 0 (pass, including any
failure to run the checks) and exit 3 (reject, message on stderr) —
instead of the PreToolUse hook in the agent's settings. The snippet only
starts the check when a session variable is set, so a person's manual
commits wait for nothing. Version-branch interception, the
`features check` artifact check and the message self-check run in the
same place, under the same rules. The gate's own failure never blocks a
commit: `command not found`, a timeout, any error passes. `--no-verify`
now skips the gate — it could not skip the PreToolUse hook before. A
commit that skipped the gate is marked `metadata.gate = "skipped"` in
the timeline (「跳过门禁」 in human-readable output), and the release
review lists such commits.

### Changed — data lives per project under the user directory

Until now every directory recorded into its own `.cgraphx/cgraphx.db`. Only
a copy opened by `/dev-start` recorded into the main directory, through its
`shared` link; another clone, a git worktree or a directory copied by hand
kept separate records of the same project. Events were filed under the
directory they happened in, so a session that also worked in an additional
directory was split across two projects.

Data now lives per project in `~/.cgraphx/projects/<dir>/`. A session
belongs to the project of the directory it started in — worked out once at
session start and kept in `~/.cgraphx/sessions/` — and stays there wherever
it goes; a commit belongs to the project of its work tree. A project is
recognized by its normalized origin (`git@github.com:smdnkB/cgraphx.git`
and `https://github.com/smdnkB/cgraphx/` are both
`github.com/smdnkB/cgraphx`, kept in `github.com-smdnkB-cgraphx/`), by a
project name in the local git config (`cgraphx.projectName`) when the
repository has no origin, or by both for a project in a subdirectory
(`github.com/org/platform#server`). `cgraphx install` asks for that name;
with `-y` it takes the directory's name. Clones, worktrees and copies of a
project therefore record into the same data, including directories where
cgraphx was never installed, once the project has data on this machine.
When one repository holds several projects — cgraphx installed in its
subdirectories — a commit is split between them by the files it changed.
The knowledge-base index and `my-features.md` stay in each directory's
`.cgraphx/`, and a `/dev-start` copy's `shared` link no longer decides
where data goes. `CGRAPHX_DIR` moves only that per-directory `.cgraphx/`;
the user directory is always `~/.cgraphx/`.

`cgraphx install` moves the directory's old data over. It first backs up
the old database and files into the project's `backups/`, then merges
events, task bindings, sync state and the db-query connection file and log.
Events the project already has — from a directory copied by hand, for
instance — are kept once, and sync's reporting progress carries over, so
reporting picks up where it left off. A db-query connection file or
platform connection that differs from the project's is not merged; it
stays in the backup and install says so. Afterwards the local database
holds only the knowledge-base index, and installing again reports that the
directory was already merged. Until `cgraphx install` runs in a directory,
it keeps recording into its local database as before; this version only
adds the `timeline_roots` table there, so older versions can still open it.

New `cgraphx project show | name | list | remove`. `show` prints which
project this directory belongs to and how it is recognized, where the data
is, whether the directory still has old data to merge, and every directory
the project was seen in on this machine with its last activity. `name`
renames the project for this repository: new records go under the new
name, existing ones stay under the old name, and a name that already has
data is joined. A clone recognized by its origin becomes a project of its
own when renamed; the other clones keep recording under the origin.
Renaming is refused while the directory still has old data to merge.
`list` shows every project in `~/.cgraphx/projects/` with its size, last
activity, backups and directories; `show` and `list` take `--json`.
`remove <dir>` deletes a project's data — or only its backups, with
`--backups` — after listing what goes and asking for confirmation; without
a terminal it needs `--yes`. It deletes nothing but a real directory right
under `~/.cgraphx/projects/`, and names the directories that still have
cgraphx installed, since they record again once worked in.

`cgraphx uninstall` now uninstalls only the directory it runs in. The
project's data stays in `~/.cgraphx/projects/<dir>/`, and the git hooks
stay while another directory of the same repository still has cgraphx
installed, so its commits keep being recorded. `timeline uninstall --purge`
no longer deletes data; it points to `cgraphx project remove`. Sync now
reports under the origin saved by `sync connect` — a connection made by an
earlier version saves the current one on its next run — so every directory
of a project reports as the same repository. Running `sync connect` where
the origin differs says so, and `--force` switches to that origin, clearing
the reporting progress so everything is reported again.

### Removed — local web viewer, platform sync, and dev-task tracking

cgraphx no longer has the parts that existed only to report to an R&D
management platform or to browse data in a browser. The `cgraphx web` local
read-only viewer, the `cgraphx sync` reporting subsystem with its hidden
`sync-worker` command, and the `cgraphx task` binding of sessions to
development tasks are deleted; typing those commands now prints
`error: unknown command` and exits 1. The `/dev-handoff` session-handoff
skill and the `task-history` agent are retired with them, and both joined
the `deprecated-assets.json` list, so `cgraphx install` deletes a copy an
earlier release deployed. What cgraphx records now stays on this machine —
nothing is reported to any platform.

`cgraphx install` also cleans up after the removal, on install and
uninstall alike. The dead reporting and task hooks an earlier release wrote
into agent configurations — `sync-session-start-hook`, `sync-stop-hook`,
`task-session-start-hook`, `task-stop-hook`, `task-post-tool-use-hook` —
are removed whatever subsystems were ticked, and hooks that are not
cgraphx's are left alone. The thirteen `sync_*` and `task_*` tables are
dropped and the four run files (`sync.lock`, `sync-trigger`,
`sync-worker.pid`, `task-source.json`) deleted from the project's data
directory and the local `.cgraphx/`; the backup taken while merging old
data is kept. Five hidden no-op commands named after the dead hooks stay
registered, so a project that upgraded the package but has not re-run
`cgraphx install` sees no errors from old hook entries: they read stdin,
print nothing and exit 0.

`features check` accepts only the built-in artifact types — the platform's
type table went with sync — and its `unknown_type` warning now says to use
a built-in type. `features show` renames its 「平台环节」 heading to
「需求环节(按默认类型表)」 and closes with 「实现、知识经验:由提交和
会话承载,不按产物算」. A spec's `> 任务:` header line is no longer read,
shown or checked; the line in an old spec is left alone and raises no new
warning. `cgraphx replica create` refuses to open a second copy of a
requirement that already has one (`feature_has_replica`: split the
requirement into several requirement directories to parallelize). The
`/dev-end` closing record keeps a single 历时 line — 立项 · 完成 · 日历跨度,
taken from the first and last commit of the range — instead of dispatching
`task-history` for the per-task actual effort.

### Added — `cgraphx board`, a local read-only task board

Running `cgraphx board` in any directory first catches every project's
timeline up (parsing what is new in the agents' session files, one line
per project), then starts a server that listens on 127.0.0.1 with a
random port and a random token, prints the tokened URL and opens it in
the browser. The left column lists projects with their requirement
tasks — `docs/features/` directories that carry a spec or a feature-plan
draft, plus replica registrations — and the right column lists the
sessions attached to the selected task, matched on the fly each
refresh: the session started inside the task's replica, a commit on the
task's branch, a commit or a write touching `docs/features/<id>/`, a
flow command naming the task, or a prompt mentioning the task's path or
title, each row showing why it matched ("definitely" vs. "maybe").
Copy a session's title or full id from the page and jump back to the
agent app to reopen it. This is not the removed `cgraphx web` viewer
coming back: the board writes nothing but ingestion, serves no
directory listing, validates the token and Host on every request,
and additionally validates Origin on the refresh endpoint.

The timeline gains a third read-only session source: DeepSeek Harness
(`~/.dsh/sessions/`, or `$DSH_HOME/.dsh/sessions/` when `DSH_HOME` is
set). Its files are concatenated zstd frames of JSONL; a third reader
splits the frames, maps the lines to the same session facts as the
other two readers, and merges subagent sessions into their main session
(continuations count as their own session). DeepSeek never enters the
installer, the replica carry-over or the commit gate — `AGENT_PROFILES`
is untouched; the events' agent column simply gains `deepseek`. Reading
it requires Node 22.15+ (`zlib.zstdDecompressSync`); on older Node the
source is skipped with a notice and everything else works.

Claude Code and DeepSeek session titles (custom beats AI beats agent,
newest wins within a rank) now live in a per-project
`timeline_session_titles` table — one row per session, created with
`IF NOT EXISTS` without bumping the schema version. Sessions recorded
before this version are backfilled once per project (marker
`session_titles_at` in `timeline_meta`), titles only, without touching
events or offsets; CodeBuddy has no titles and keeps falling back to
the first prompt as the display title.

## 2.0.13 - 2026-11-01

### Changed — clarification drops feature cards and writes straight into the draft

`/dev-clarify` no longer posts feature cards in the conversation. Cards
repeated what the draft's diagrams said and soon drifted from them, and a
business definition that only came up while drawing a step had nowhere to
go. The proposal is now written straight into the draft,
`<prefix>-功能方案-v<N>.md`, which exists from step ④ on whether or not
anything is drawn: a one-line summary, a feature list with 「从哪进 → 到哪去」
for each point (items not being done are listed too), and one section per
feature point — a short description, the diagram (or a behavior chain and
boundaries when no diagram fits), a definition table under it, and the
experience decision. The conversation only says which sections were written
and what needs your call; anything you don't change is accepted, and changes
are given by number (F1②, K2).

Business definitions (口径) now sit under the step that uses them. Each step
that fetches, judges or computes data has a row: the step, the rule, in/out
examples and the basis down to `table.column` — data that doesn't exist yet
is written as 「新数据,存哪由 spec 定」, without a table name — and its box in
the diagram carries the K number. K numbers are unique across the draft, and
a shared definition is written out once and referenced as 「见 Fx」 elsewhere.
The global definition table is gone: step ③ is now 口径分歧 and only asks
about definitions that differ from an existing report or already have two
meanings in the system, with real counts for both when the database can be
queried; a conflict found while writing is drafted with the default, marked
(待你定), and listed with that batch's decisions. The overview swimlane and
the feature relationship diagram are dropped; the feature list and each
diagram's entry and exit show how the points connect. The review pass checks
that every fetching, judging or computing box has its row.

Below the draft's `---` are the five items the spec uses: questions that
must be settled before the spec, locked technical constraints, details left
to the spec, impact and risk, and the facts found while exploring.
`/dev-spec` copies everything above `---` from the confirmed version; when
the open questions are not 「无」, it lists them first and continues once
they are settled in `/dev-clarify`. A draft in progress is now marked
「写稿中」 instead of 「审卡中」; a draft with the old marker is in the old
format and is brought up to date before writing continues. `/dev-start` no
longer opens a copy while this session's clarification is unfinished and
suggests `/dev-handoff`, whose handoff file carries the definitions already
settled but not yet written into the draft. `/unit-spec`, `/ui-case`,
`/doc-delivery` and the implementation skills read each feature point's
section, `/dev-migrate` writes slice plans in the same format, and
`/ui-case` and `/doc-workload` still accept the old feature table in
existing specs.

## 2.0.12 - 2026-10-31

### Fixed — background notifications are no longer recorded as your questions

Claude Code delivers background-task notifications (`<task-notification>`)
and sub-agent results (`<agent-message …>`) through the same hook as a typed
prompt, so the timeline recorded them as `user_prompt`. They are now recorded
as a new event type, `auto_message`, with `metadata.source` set to
`task_notification` or `agent_message`; the text is classified by how it
starts after leading whitespace, and a prompt starting with
`<system-reminder>` still counts as a question. An automatic message still
opens a new turn and still counts toward active and working time — the agent
works on it — but events of type `user_prompt` are now only what a person
typed. Records already in the local database are reclassified when this
version opens it, including ones an older global cgraphx keeps writing as
`user_prompt`: a new `timeline_meta` table remembers how far the scan got, and
the timeline schema version is unchanged, so older versions keep recording.
`cgraphx timeline query --type auto_message` works, the web view shows them as
自动消息 in grey with a filter chip and a count of their own, and
`/doc-report` leaves them out when counting questions. Platform reporting
still sends them as `user_prompt`, so the platform sees the same events as
before.

### Added — `/doc-monthly-report` fills the month-end daily report form

`/doc-monthly-report` signs in to the work-report workbench, pulls the
month's daily report records — your own by default, someone else's with
`--filler` — and condenses each day into one line of at most 100 characters
for the month-end form: main deliverables and key numbers kept, duplicates
merged, nothing invented. Records are grouped by their own `date`, not by
when they were submitted. It prints a Markdown table plus a 未列入 note:
weekends without records are 周末休息, workdays without records 未填报, and
an unfilled last day of the month 待填; public holidays are not recognized,
so a holiday without records shows up as 未填报. When fewer records come back
than the endpoint's `total`, the bundled `scripts/fetch-reports.mjs` exits
with code 2 instead of printing a partial table. The password never goes on
the command line, into a file or into the local timeline database: it is read
from `WORK_REPORT_PASS`, from `--password-stdin`, or typed at a hidden prompt,
and there is no `--password` option. The skill only produces the table;
submitting the form stays manual. `/doc-report` now points month-end daily
reports to it.

### Added — `/init-tech-stack` ships with cgraphx and opens a new project

`/init-tech-stack` now ships in the template, and `cgraphx install` deploys
it. It walks 12 layers, from product form and language ecosystem through
framework, database, ORM, cache, deployment and front end to project
structure, gives a recommendation with two to four alternatives and their
trade-offs for each, settles them group by group with you, writes
`docs/adr/<NNN>-技术栈选型.md` and stops — it does not go on into a spec, plan
or code. ADR numbers continue after existing ones, layers already decided are
not reopened, a single layer can be asked about on its own, and no spec is
needed. It runs only when you type it. A new project now starts with
`cgraphx install` → `/init-tech-stack` → `/init-guides` → `/init-ddl` and
`/init-knowledge` as needed → the requirement main line; a requirement that
brings in a new stack runs it before `/dev-spec` and feeds the ADR into the
spec. Projects that already have a stack are not asked to run it.
`/dev-migrate` stops at its target step and asks you to run it, and suggests
`cgraphx upgrade` when the skill is missing. `FLOW-MAP.md` has a new
「新项目启动流程(按需)」 section, and the guide pages, the README and the docs
tree list the skill and `docs/adr/`. If you kept a copy in
`~/.claude/skills/init-tech-stack`, it is left alone; delete it yourself once
the project copy is deployed.

## 2.0.11 - 2026-10-31

### Added — `/dev-migrate` rewrites a system on a new stack without losing behavior

`/dev-migrate` moves an existing system into a new project on a new stack —
MyBatis to JPA, for example — while restructuring modules, dropping dead code
and redesigning tables. The old system is the reference answer. Entry points
are enumerated by category with commands — HTTP endpoints, scheduled jobs,
message and event listeners, workflow callbacks, interceptors, database
triggers — and each one becomes a row of the behavior list with its rule
branches, tables, side effects and `file:line`; the count per category must
match the rows. A row is deleted only with hard evidence — not packaged into
anything deployed, no live call in any caller repository, an empty
implementation — and only after a person approves its batch. The tech stack
is settled with `/init-tech-stack`; the ADR, the module and table mappings and
the global decisions (API compatibility, IDs, data migration, cutover,
rollback) are confirmed by a person before slicing starts.

Each slice — one module's rows, tables and data migration — gets a functional
plan generated from its rows, runs through `/dev-spec` → `/dev-plan` →
`/dev-impl-subagent`, and is accepted by running the same bruno requests
against old and new (`scripts/compare-runs.mjs` diffs the two
`bru run --reporter-json` reports, skipping listed paths and sorting unordered
arrays) and by reconciliation SQL on the migrated data. Differences are fixed
in the new system unless a person accepts them. Before each slice and before
cutover, every new commit in the old repositories is mapped onto the list.
The skill ends with a cutover checklist: data migration and cutover are run
by people, and production databases are only read. Everything lives in the
new project — the ADR in `docs/adr/`, `docs/features/<date>-<system>迁移/`
with the overview, behavior list, table mapping and `sql/`, and one
requirement directory per slice. The first recipe covers MyBatis → JPA
(`references/配方-mybatis-to-jpa.md`); `FLOW-MAP.md` lists the skill as an
on-demand flow.

### Changed — clarification draws each feature point instead of describing it

`/dev-clarify` feature cards used to spell out behavior in text, which made
the checks inside an endpoint and the order of calls across endpoints hard to
follow. Each feature point now gets a diagram of the kind that fits what it
is about: logic inside an endpoint, orchestration across endpoints, a state
diagram, a decision table, data flow, a sequence diagram, or a swimlane for
the user's path through pages. Page layout still goes to `/dev-wireframe`,
and a one-line copy change stays a sentence. An endpoint diagram has a lane
for the trigger (a page, another system, a scheduled job, a message) and one
for the service, the checks in order, failure branches with the prompt text
and boundary numbers, changed steps in yellow and the normal path in green.
An orchestration diagram has one box per endpoint and shows whether later
calls still run after a failure and what gets undone. A point uses at most
two kinds; a diagram over 25 boxes is split, and timelines stay tables or
numbered steps. The rules and samples are in
`skills/dev-clarify/references/功能点配图.md`.

Diagrams go into the draft during card review and are corrected there. In
the conversation a card's first line says where its diagram is and the text
chain is gone; boundaries, evidence, relations and experience variants stay,
and when the diagram and the boundaries disagree, the boundaries win. A
structural change is drawn under the old diagram as a candidate before it
replaces it. Each drawn point has a 「Fx 怎么走」 section in the draft, which
the spec's first section copies and handoffs split by feature point.
Single-point requirements and bug fixes keep a draft too once a card has a
diagram; a bug draws only the fixed behavior. An existing draft continues
from its latest version: one marked 「审卡中」 in place, a converged one after
copying it to the next version. The review pass also checks that diagrams
match the card boundaries and that every point that needs a diagram has one.
`/unit-spec` turns each branch, state transition and decision-table row in
「Fx 怎么走」 into a scenario, and `/ui-case` writes its steps from the
diagram's steps and branches.

### Changed — flow diagrams move from mermaid to PlantUML

Diagrams in clarification drafts, in the spec's first section, and in the
design and requirement docs from `/doc-delivery` are now PlantUML, kept in
`plantuml` code blocks in the markdown, so a user's path is drawn as real
swimlanes. Open them in a markdown preview with PlantUML enabled — in
IntelliJ IDEA, Settings → Languages & Frameworks → Markdown, enable PlantUML;
each draft says so at the top. The repository gets no generated SVG or PNG
files, and no PlantUML server is needed; when a design or requirement doc goes
outside the team, the sender provides a rendered preview or a PDF. Diagrams a
spec draws on its own default to PlantUML, and timelines, which PlantUML has
no native form for, become tables or numbered steps. A multi-feature draft
with three or more feature points and non-trivial relations also gets a
relationship diagram of up to 8 nodes — what supports what, what stands
alone, what is out of scope — next to the feature table, which stays
authoritative. Plans still draw no diagrams; existing specs, drafts and docs
keep their mermaid; code maps, design maps and the `cgraphx web` system map
stay on mermaid.

### Removed — the separate `visual-explain` explainer skill is gone

`/visual-explain` turned whatever the conversation had just covered into a
one-page HTML explainer. The same need is served by the conversation itself,
the diagrams clarification now draws for each feature point, and
`/dev-wireframe` for UI work, so the skill is retired. The template no
longer ships `skills/visual-explain`, and `skills/visual-explain` is now on the
`deprecated-assets.json` list — `cgraphx install` / `uninstall` deletes a copy
deployed by an older release. References were dropped from `FLOW-MAP.md`, the
template and root `CLAUDE.md`, the `cgraphx-guide` pages, the closing prompts
of `/dev-clarify`, `/dev-spec` and `/dev-plan`, both READMEs, and the skill
roster in `docs/knowledge/skill-invocation轴.md`. Explainer pages already
written into a requirement directory or `.cgraphx/visual/` are left alone.

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
feature plan to a draft, `<prefix>-功能方案-v<N>.md`, with a PlantUML swimlane
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
`audit-login-security`, `cgraphx-guide`. (`visual-explain` also kept its
name at the rename, and is retired later in this release — see above.)

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
risk. Diagrams are PlantUML activity diagrams (grey boxes, white lanes),
drawn with the same rules as clarification drafts. The design doc is
markdown only; the HTML option is dropped. The first-screen heading that
`features check` requires for new design docs changes from 架构总览 to
30 秒看懂.

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
  verdict: 可以发, 有风险 or 不能直接合. The review starts where the version
  branch was cut, so merging `main` into the version branch to pick up a
  hotfix is listed on its own as 同步主干 rather than as a requirement. Say
  「发」 and it merges the version branch into `main` as 「发布 2.0.11:合入 …」
  and lists the copies that can be deleted. It does not tag, publish or push:
  publish the way you do today, then run `/release-start` again, which tags
  the release. Between the release and the next `/release-start`,
  `/dev-merge` on `main` asks before merging there; answer 「不再按版本走」 to
  leave the version flow.
- A commit-msg hook keeps the version branch clean: on `dev/x.y.z` it
  rejects direct commits and lets through only merge commits and commits
  starting with `chore(release):` (the first line that is neither blank nor a
  `#` comment, so commit templates work), whether they come from an agent or
  the terminal. `/release-start` installs it with `cgraphx release guard`
  each time it runs, restoring it if a hook manager overwrote it;
  `cgraphx install` does not install it, and `cgraphx uninstall` removes it.
  An agent's `git commit` is checked once more before it reaches git, by the
  `precommit-check` hook that `cgraphx install` sets up for Claude Code and
  CodeBuddy: on a project following the version flow, a commit on
  `dev/x.y.z` is denied unless it concludes a merge or its command carries
  `chore(release):`. This check does not go through git's hooks directory, so
  it holds where the commit-msg snippet cannot be installed, and
  `--no-verify` does not get past it. It reads the message from the command,
  so a `chore(release):` message has to be given with `-m`.
- Requirement copies. `/dev-start <requirement>` clones the project next to
  itself as `<project>@<prefix>` with copy-on-write (`cp -cR` on APFS,
  `cp -R --reflink=always` on Linux: about a second for a 4 GB repository,
  almost no extra disk), creates `feat/<prefix>` (`fix/` for bug fixes) from
  the main directory's current branch, and gives the line for starting a new
  session there; when the disk cannot clone (on macOS: another volume, or a
  disk that is not APFS), it asks before making a full copy. Ignored files
  such as dependencies and `.env` come along, so nothing needs reinstalling;
  untracked files stay behind, except the
  requirement's own drafts, which move into the copy; ignored files in that
  requirement's directory stay in the main directory too. In the copy,
  `/dev-merge` merges the main directory's current branch in, so conflicts
  are resolved there; in the main directory, `/dev-merge <requirement>`
  dry-runs the merge, then merges. A copy counts as merged once the commits
  made on its own branch are in the target branch; a copy without commits of
  its own is shown as 「还没有提交」 and never offered for deletion. Sync a copy
  only with `/dev-merge`: a fast-forward `git pull` makes the main branch's
  commits look like the copy's own. Without a
  version branch, a copy merges back into whatever branch the main directory
  is on and is offered for deletion right after. `/dev-handoff` opens one copy per handoff target when
  the main directory is on a version branch, and by default when copies are
  already in use. The program side is
  `cgraphx replica create | list | remove`; `create` refuses a copy name that
  is already registered to another requirement, and `remove` deletes a copy
  only when it matches its registration and has no uncommitted changes, and
  never follows links. In the copy, only the parts of agent config
  directories (such as `.claude/`) that were untracked at copy time are
  excluded from git, so new files next to team-shared ones still show up.
- Copies share the main directory's data. A copy's `.cgraphx/` holds a
  `shared` link to the main `.cgraphx/`, and every copy is registered in
  `.cgraphx/replicas/<name>.json`. Sessions, tool calls, commits and task
  bindings made in a copy are recorded in the main directory; a session
  started in a copy belongs to the copy's requirement unless it was bound
  with `cgraphx task use`. When the copy's sessions created a local task
  before the spec existed and the spec later declares `> 任务: T-n`, the
  next full refresh adds T-n locally if it is missing — also after the copy
  is removed — then removes that task, and `task show <requirement>` lands
  on T-n with the copy's sessions. A requirement file written in the main directory before
  `/dev-start` moved it into the copy (recorded as `movedFiles` in the
  registration) keeps counting as the copy's output after it is merged
  back. `task show`, `sync` and `/doc-report` show
  project-relative paths, the records outlive the copy, and `features list`
  also lists requirements being worked on in copies, marked 「在副本 <name>」
  (in JSON, a `replica` field on those entries only). The knowledge-base
  index and `my-features.md` stay per directory, so knowledge written in a
  copy is recalled elsewhere once it is merged. Looking up a requirement's
  directory prefers the copy that is working on it, as `features list` does.
  If the main directory is
  moved or renamed, hooks in the copy keep passing and cgraphx commands print
  「副本关联的主项目不在 <path> 了」. `timeline uninstall --purge` is refused in a
  copy. Copies run on macOS and Linux; the dry-run merges need git 2.38 or
  later.
- `CGRAPHX_DIR` now also covers the turn state files (`turns/`),
  `db-profiles.json` and `db-query.log`. They used to stay in `.cgraphx/`
  even when `CGRAPHX_DIR` named another directory; they now live next to the
  database in that directory. `my-features.md` still lives in `.cgraphx/`.
  If you set `CGRAPHX_DIR`, move an existing `.cgraphx/db-profiles.json`
  there.
- Merge commits are recorded. `git merge` does not run the post-commit hook,
  so the timeline never saw merges. A post-merge hook now records merge
  commits as `git_commit` events with an empty file list and the merge's
  file and line counts in `metadata.merge`. A conflicted merge finished with
  `git commit` is recorded the same way. Fast-forwards are skipped — told
  apart by the reflog, so pulling a merge someone else made is not recorded
  as yours — and no commit is recorded twice.
- Git hooks follow `core.hooksPath` and change only this machine. The
  timeline hooks and the release guard are written to the directory
  `git rev-parse --git-path hooks` reports, so commits are now recorded in
  projects that use husky. Snippets go right after the shebang, so a hook
  ending in `exec` still runs them. Only hook files git does not track are
  written. Nothing is written when the hooks directory is a shared one
  outside the repository, when the hook file is not a shell script, or when
  it is a symlink or tracked by git (such as husky 5–8's
  `.husky/commit-msg`); a notice says why and, for the last two, prints the
  lines to add right after the shebang (for a symlink, where it points and
  what adding them would affect). A tracked hook, or a symlink's target,
  that already carries the snippet in the work tree counts as installed —
  whether the team committed it or it was added here — and a tracked hook
  missing from the work tree is not recreated. On uninstall, lines the team
  committed are left alone (`cgraphx release guard --remove` says so) and
  lines only this machine added are removed. Hook files cgraphx
  creates inside the work tree go into `.git/info/exclude`. Installed
  snippets are registered under the git directory together with the files
  they went into: after the hooks directory changes (husky 8's `.husky` to
  husky 9's `.husky/_`), installing again removes the old snippets, and
  uninstalling removes all of them — never another repository's, such as
  the main directory's seen from a copy. The timeline's session-start hook
  puts back any that went missing — husky 9 rewrites `.husky/_/` on every
  install; one it cannot put back is reported once in the session-start
  context and dropped from the registration. Leftover snippets in `.git/hooks` are removed once the new ones
  are in place elsewhere, and uninstalling also removes 2.0.10 snippets that
  were written through a symlink into a file in the repository. These
  guarantees cover plain `.git/hooks`, husky 5–9, copies and upgrades from
  2.0.10; several git worktrees of one repository, hooks directories inside
  a submodule, symlinked or non-UTF-8 hooks are not covered.
  `cgraphx install` and `upgrade` add the missing timeline snippets.
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
