# cgraphx

Local markdown knowledge base, database query, and developer timeline toolkit for AI coding agents.

cgraphx is a single CLI that gives AI coding agents three independent, project-local tools:

- **docs** — index and query a markdown knowledge base (`docs/knowledge/*.md`).
- **db** — read-only database introspection for MySQL and PostgreSQL.
- **timeline** — record and replay Claude Code development events.

Each subsystem lives behind its own `.cgraphx/` SQLite database in a project, so every project is self-contained and offline.

## Install

```bash
npm install -g cgraphx
```

Or run once without installing:

```bash
npx cgraphx <command>
```

## Quick start

```bash
# In a project:
cgraphx init                 # creates .cgraphx/cgraphx.db (markdown + timeline schemas)

# Markdown knowledge base
cgraphx docs index           # index docs/knowledge/*.md
cgraphx docs concepts        # list indexed concepts

# Database introspection (configure .cgraphx/db-profiles.json first)
cgraphx db profiles

# Developer timeline
cgraphx timeline install     # wire the Claude Code hook
cgraphx timeline recent      # recent development events

# Project status across all three subsystems
cgraphx status

# Self-update
cgraphx upgrade
```

Run `cgraphx --help` or `cgraphx <command> --help` for the full surface.

## What's new in 2.0

cgraphx 2.0 is a rebuild that drops the code-graph layer (the `explore` / `query` / `callers` / `index` / `sync` commands, the MCP server, and telemetry) and keeps only the markdown, db, and timeline subsystems. See `CHANGELOG.md` for the full breaking-change list.

## License

MIT
