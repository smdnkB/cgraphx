[中文](README.md)

# cgraphx

> A **local development-assistance system for Claude Code**: 20+ skills define the workflow, backed by four project-local capabilities (knowledge base / database / timeline / requirements index).

One npm package, one `cgraphx install`, and a full "requirements → spec → implementation → testing → knowledge" workflow lands in your project. Claude Code reads the skills and follows the process — entirely **project-local, offline, and your data never leaves the repo**.

---

## Not just another CLI tool

cgraphx = **skill workflow (the core) + program capabilities (the support)**:

- **Skills are the core** — 20+ markdown process guides capturing "how requirements should be done": clarify first, write a spec, break big ones into plans, add tests after implementing, distill valuable findings into knowledge.
- **The CLI is the support** — four project-local capabilities a skill alone can't provide:

| Subsystem | Command | Capability |
|---|---|---|
| **docs** knowledge base | `cgraphx docs` | Index and search `docs/knowledge/*.md` (LIKE queries, CJK-friendly) |
| **db** database | `cgraphx db` | Read-only introspection for MySQL / PostgreSQL; a built-in safety layer structurally rejects writes |
| **timeline** | `cgraphx timeline` | Records Claude Code development events via hooks; powers daily / weekly / monthly reports |
| **features** requirements index | `cgraphx features` | Live index of `docs/features/`; locate your own requirements by owner / keyword (filesystem-derived, no DB) |

Claude Code reads skills → follows the process → calls CLI capabilities. **Your development methodology, finally reusable by Claude Code — reliably.**

Each project gets its own `.cgraphx/cgraphx.db`: self-contained, no server, no telemetry.

## The skill workflow

```
knowledge-recall → /clarify-requirements → /write-spec ─┬→ /write-plan → /implementation
  chat (auto)       clarify                spec         │    plan          implement
                                                        └→ /write-unit-test-spec → /write-unit-test-code
                                                             test spec          write tests
```

| Track | Skills |
|---|---|
| Requirements main line | `/clarify-requirements` → `/write-spec` →(optional `/write-prd` `/write-plan`)→ `/implementation` / `/subagent-implement` |
| API testing | `/write-api` → `/run-api-test`(write APIs are verified against the DB) |
| Unit testing | `/write-unit-test-spec` → `/write-unit-test-code` |
| Knowledge capture | `/code-impact-markdown`, auto-recalled by `knowledge-recall` |
| DB schema | `/export-table-ddl` + `db-query` exploration write-back |

Everyday default: **clarify + implement**; add spec / plan / tests as the need grows. Full skill list in `cgraphx-guide`.

## Install & the three commands

```bash
npm install -g cgraphx
```

| Command | What it does |
|---|---|
| `cgraphx install` | One command per project: deploys skills to `.claude/`, wires hooks / statusLine, writes the working method into `.claude/CLAUDE.md`, initializes `.cgraphx/` |
| `cgraphx upgrade` | Self-update via npm (pure package swap, touches no project); re-run `cgraphx install` in each project to refresh afterwards |
| `cgraphx uninstall` | Removes skills / config by the package manifest and deletes `.cgraphx/` (add `--keep-data` to keep it) |

## Quick start

```bash
cd your-project
cgraphx install          # set up: .cgraphx/, skills, working method
```

Restart Claude Code and you're set. For how to actually get value from it, see **Best getting-started practice** below.

## Best getting-started practice

Installing is only step one. To make Claude Code truly work by *your* project's rules, follow this onboarding order — **set standards first, then talk business, only then do requirements**:

**1. Set standards · `/init-project-guides`**
Generates `docs/guides/` quick-reference standards (coding / interface / data / testing / git — five files). A standard = a project's **deliberate deviation** from the default (e.g. "no `ORDER BY` in SQL", "money is always `decimal(12,2)`", "commits use format A") — the things most easily deviated from, with no tooling to enforce them. New projects get starting defaults (marked "to evolve"); existing projects mine settled conventions from code / git history. These guides are mandatory reads for later tasks and get crystallized into contracts by `/write-plan`.

**2. Talk business · `knowledge-recall` (auto-triggered by Claude Code)**
Before any requirement, chat about the business with Claude Code: it recalls settled concepts from the project knowledge base, aligns on jargon, and points to relevant decision docs — so you don't misuse terms or re-ask recorded questions. Distill business entities with `/code-impact-markdown` as you go; the knowledge base grows richer with use.

**3. Do requirements · start with `/clarify-requirements`**
Enter the main workflow: clarify → spec (`/write-spec`) → implement (`/implementation`) → test. With the first two steps done, clarification happens in a shared context, not from scratch.

> Why this order: standards first (Claude Code knows the project's "rules"), then business alignment (Claude Code knows the project's "jargon") — only then does clarifying a concrete requirement pay off.

## Requirements

- **Claude Code** (skill deployment, hooks, and timeline all depend on its mechanisms — see below)
- Node.js `>=22.5 <27` (uses built-in `node:sqlite`; no native deps, no wasm)
- Project-local, offline

## Why Claude Code only

cgraphx's skill deployment (`.claude/`), hook wiring, and **timeline** event recording all depend on Claude Code's mechanisms — and hooks / skill mechanisms differ across agents, so one size cannot fit all. cgraphx therefore supports Claude Code only.

> The `docs` and `db` CLI capabilities themselves are agent-agnostic and can be invoked standalone anywhere a shell runs; but as a development system (skills + hooks + timeline), cgraphx targets Claude Code.

## About the name

cgraphx is named after the 1.x code graph. 2.0 is a breaking rebuild: **the graph layer is gone entirely** (no `explore` / `query` / `callers`, no MCP server, no telemetry), refocused on the four subsystems Claude Code actually reuses. 1.x → 2.0 is not compatible; see `CHANGELOG.md`.

## License

[MIT](LICENSE) © liulongfei
