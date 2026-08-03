[中文](README.md)

# cgraphx

> A local development-assistance system for Claude Code — 20+ skills define the workflow, backed by four project-local capabilities.

One `cgraphx install` drops a full "clarify → spec → implement → test → knowledge capture" workflow into your project. Entirely **project-local, offline, and your data never leaves the repo**.

---

## Problems it solves

Most AI-assisted development tools (including open-source ones) stop at code generation. cgraphx solves what happens **before** and **after**:

| # | Pain point | How cgraphx addresses it |
|---|---|---|
| 1 | **Document drift → rework** — PRD/Spec/Plan: change one rule, regression-test all three; eventually none can be trusted | Spec is the sole contract; change one place. PRD, design doc, API doc are generated **post-release on demand**, not on the critical path |
| 2 | **Business knowledge dies with the session** — understanding built during a conversation vanishes when the window closes | `knowledge-write` captures → `knowledge-recall` retrieves; a closed loop that grows richer with use |
| 3 | **Data model re-learned from scratch every time** — field meanings, implicit relationships, pitfalls stepped on last time | `export-table-ddl` builds a local DDL baseline; `db-query` writes discoveries back to DISCOVERED blocks; re-dumps preserve accumulated knowledge |
| 4 | **Requirement misinterpretation** — start coding from a one-liner, finish, discover you built the wrong thing | `/clarify-requirements` locks business boundaries and technical constraints before any code is written |
| 5 | **Standards rely on memory** — coding/interface/data/commit standards written but never read | Standards are auto-delivered at execution time: plan marks "mandatory references" + a commit gate intercepts `git commit` |
| 6 | **The workflow stops at "code written"** — testing is manual: record endpoints by hand, run by hand, verify by hand | `/write-api` auto-generates test cases from spec → `/run-api-test` executes + forces DB verification for write APIs (HTTP 200 ≠ pass) |
| 7 | **Work is untraceable** — "what did you do this month?" answered by scavenging git log | timeline auto-records dev events (~5ms each); `/developer-timeline` generates daily/weekly/monthly reports on demand |
| 8 | **Upgrades leave residue** — renamed skills leave stale directories; agents can still trigger outdated logic | `deprecated-assets.json` manifest + automatic cleanup on `install` |

## How it works

cgraphx = **skill workflow (the core) + CLI capabilities (the support)**.

- **Skills are the core** — 20+ markdown process guides defining "how requirements should be done." The agent reads skills and follows the process.
- **The CLI is the support** — four project-local capabilities a skill alone can't provide:

| Subsystem | Command | Capability |
|---|---|---|
| **docs** knowledge base | `cgraphx docs` | Index and search `docs/knowledge/*.md` (LIKE queries, CJK-friendly) |
| **db** database | `cgraphx db` | Read-only introspection for MySQL / PostgreSQL; safety layer structurally rejects writes |
| **timeline** | `cgraphx timeline` | Auto-records development events via hooks; powers reports |
| **features** requirements index | `cgraphx features` | Locate requirements by owner / keyword (filesystem-derived, no DB) |

Each project gets its own `.cgraphx/cgraphx.db`: self-contained, no server, no telemetry.

## Workflow overview

```
knowledge-recall (auto)
        │
        ▼
/clarify-requirements ──→ /write-spec ──→ /write-plan (optional)
     clarify               sole contract      execution plan
        │                                        │
        │            ┌───────────────────────────┘
        ▼            ▼
  /implementation (simple) or /subagent-implement (complex)
        │
   ┌────┴─────────────────────────────┐
   ▼              ▼                   ▼
/write-api    /write-unit-test-spec  delivery:
→ /run-api-test → /write-unit-test-code  /knowledge-write capture
  API testing     unit testing         commit gate

── post-release · on demand (off the critical path) ──────
/write-prd (stakeholder review)  /write-design-doc  /write-api-doc
```

Everyday default: **clarify + implement**. Add spec / plan / tests as complexity grows.

## Install

```bash
npm install -g cgraphx    # Node.js >=22.5 <27 (built-in node:sqlite, no native deps)
```

```bash
cd your-project
cgraphx install           # deploys skills → .claude/ + wires hooks + initializes .cgraphx/
```

Restart Claude Code and you're set.

| Command | What it does |
|---|---|
| `cgraphx install` | One command per project: full setup |
| `cgraphx upgrade` | Run inside a project: self-update via npm + auto-refresh that project (skills/hooks/`.cgraphx/`); repeat per project |
| `cgraphx uninstall` | Removes skills/config by manifest + deletes `.cgraphx/` (`--keep-data` to preserve) |

## Best getting-started practice

Installing is only step one. Recommended order — **set standards, talk business, then do requirements**:

**1. Set standards · `/init-project-guides`**

Generates five quick-reference standards in `docs/guides/` (coding / interface / data / testing / git). A standard = a project's **deliberate deviation** from the default — "no `ORDER BY` in SQL", "money is always `decimal(12,2)`" — the things most easily deviated from with no tooling to enforce them. These guides become mandatory reads for later tasks.

**2. Talk business · chat with Claude Code about your project**

Before any requirement, talk about the business. The agent auto-recalls settled concepts from the knowledge base and aligns on jargon. Capture business entities with `/knowledge-write` as you go — the knowledge base grows richer with use.

**3. Do requirements · start with `/clarify-requirements`**

Enter the main workflow: clarify → spec (`/write-spec`) → implement → test. With the first two steps done, clarification happens in a shared context, not from scratch.

> Standards first (the agent knows the "rules"), then business alignment (the agent knows the "jargon") — only then does clarifying a concrete requirement pay off.

## Knowledge flywheels

cgraphx has two knowledge accumulation loops that compound over time:

**Business knowledge**: `/knowledge-write` captures to `docs/knowledge/` → `knowledge-recall` auto-retrieves before the next task → new concepts get captured → the thicker the base, the better the agent understands your project.

**Data model**: `/export-table-ddl` builds a DDL baseline → `db-query` reads local files first (cheap) → discoveries written back to DISCOVERED blocks → re-dumps preserve accumulation → the agent never re-steps on the same mine.

## Requirements

- **Claude Code** (skill deployment, hooks, and timeline depend on its mechanisms)
- **Node.js** `>=22.5 <27` (built-in `node:sqlite`; no native deps, no wasm)
- Project-local, offline

> The `docs` and `db` CLI capabilities are agent-agnostic and can be invoked standalone; but as a development system (skills + hooks + timeline), cgraphx targets Claude Code.

## About the name

cgraphx is named after the 1.x code graph. 2.0 is a breaking rebuild: the graph layer is gone entirely, refocused on the skill workflow + four local capabilities. 1.x → 2.0 is not compatible; see `CHANGELOG.md`.

## License

[MIT](LICENSE) © liulongfei
