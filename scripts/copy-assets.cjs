#!/usr/bin/env node
/**
 * copy-assets.cjs — postbuild asset copier for cgraphx 2.0.
 *
 * `tsc` only emits compiled JS/d.ts; runtime assets that live alongside the
 * TS sources (SQL schemas, the Claude skill template) must be copied into
 * `dist/` separately. This script is the single source of truth for that.
 *
 * What it copies (intentionally narrow — cgraphx 2.0 dropped the code graph,
 * so there is no graph schema and no tree-sitter wasm to ship):
 *
 *   src/core/markdown/schema.sql  → dist/core/markdown/schema.sql
 *   src/core/timeline/schema.sql  → dist/core/timeline/schema.sql
 *   assets/claude-template/**     → dist/.claude-template/**
 *
 * What it does NOT copy:
 *   - src/core/db/schema.sql  (does not exist in 2.0 — db layer has no static schema)
 *   - src/extraction/wasm/**  (graph extraction was removed)
 *
 * Run from the repo root via `npm run build` (after `tsc`).
 */
'use strict';

const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const dist = path.join(root, 'dist');

function copyFile(from, to) {
  fs.mkdirSync(path.dirname(to), { recursive: true });
  fs.copyFileSync(from, to);
}

// 1) SQL schemas — markdown + timeline subsystems. The dist/ path mirrors the
//    src/ layout including the `core/` nesting, because runtime resolvers look
//    them up relative to the compiled module file (schema-bootstrap.ts).
copyFile(
  path.join(root, 'src/core/markdown/schema.sql'),
  path.join(dist, 'core/markdown/schema.sql')
);
copyFile(
  path.join(root, 'src/core/timeline/schema.sql'),
  path.join(dist, 'core/timeline/schema.sql')
);

// 2) Claude skill/agent/hooks template — walked recursively. We skip the usual
//    noise so a dirty source tree doesn't leak into the published package.
const tmplSrc = path.join(root, 'assets/claude-template');
const tmplDest = path.join(dist, '.claude-template');

if (fs.existsSync(tmplSrc)) {
  fs.rmSync(tmplDest, { recursive: true, force: true });
  fs.mkdirSync(tmplDest, { recursive: true });

  const SKIP_NAMES = new Set(['node_modules', '.DS_Store']);
  (function walk(from, to) {
    for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
      if (SKIP_NAMES.has(entry.name)) continue;
      const fp = path.join(from, entry.name);
      const tp = path.join(to, entry.name);
      if (entry.isDirectory()) {
        fs.mkdirSync(tp, { recursive: true });
        walk(fp, tp);
      } else if (entry.isFile()) {
        fs.copyFileSync(fp, tp);
      }
    }
  })(tmplSrc, tmplDest);
}

console.log('copy-assets: schemas + .claude-template copied into dist/');
