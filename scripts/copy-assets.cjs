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
 *   src/core/board/page.html      → dist/core/board/page.html
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

// 递归拷贝时跳过的常见噪音,避免脏源树泄漏进发布包。
const SKIP_NAMES = new Set(['node_modules', '.DS_Store']);

// 递归拷贝整棵目录树(沿用 walk 模式;dist 镜像 src 布局)。
function walk(from, to) {
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

// 看板页面(board 子系统):服务启动时经 __dirname 相对路径读取(server.ts),与上面的 schema
// 同理要 dist 镜像 src 布局;tsc 不产出 HTML,漏登记 = 装到用户机器上启动报「看板页面缺失」。
copyFile(
  path.join(root, 'src/core/board/page.html'),
  path.join(dist, 'core/board/page.html')
);

// 2) Claude skill/agent/hooks template — walked recursively.
const tmplSrc = path.join(root, 'assets/claude-template');
const tmplDest = path.join(dist, '.claude-template');

if (fs.existsSync(tmplSrc)) {
  fs.rmSync(tmplDest, { recursive: true, force: true });
  fs.mkdirSync(tmplDest, { recursive: true });
  walk(tmplSrc, tmplDest);
}

console.log('copy-assets: schemas + board page + .claude-template copied into dist/');
