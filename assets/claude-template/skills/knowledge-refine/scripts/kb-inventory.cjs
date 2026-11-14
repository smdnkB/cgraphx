#!/usr/bin/env node
// 知识库盘点(只读):扫 docs/knowledge/**/*.md 的 frontmatter 与正文,产出整理体检用的确定性事实。
// 用法:node kb-inventory.cjs [项目根目录] [--json]
// 输出:概念用量、缺主条目的概念、命名风格、疑似近义概念、腐烂(路径不存在/链接断)、可能过期(相关代码在条目更新后又改过)。
'use strict';
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const args = process.argv.slice(2);
const asJson = args.includes('--json');
const root = path.resolve(args.find(a => !a.startsWith('--')) || process.cwd());
const kdir = path.join(root, 'docs', 'knowledge');
if (!fs.existsSync(kdir)) { console.error(`没有 ${kdir}`); process.exit(2); }

// ---------- 读文档 ----------
function walk(d, out = []) {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    if (e.name.startsWith('.')) continue;                 // .refine/、.exploration-queue.json 等不算知识文档
    const p = path.join(d, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (e.isFile() && e.name.endsWith('.md')) out.push(p);
  }
  return out;
}
function fmList(fm, key) {
  const m = fm.match(new RegExp(`^${key}:\\s*\\n((?:[ \\t]+-[ \\t]+.*\\n?)+)`, 'm'));
  if (m) return m[1].split('\n').map(l => l.replace(/^\s+-\s+/, '').replace(/\s+#.*$/, '').trim().replace(/^['"]|['"]$/g, '')).filter(Boolean);
  const inline = fm.match(new RegExp(`^${key}:\\s*\\[(.*)\\]\\s*$`, 'm'));
  return inline ? inline[1].split(',').map(s => s.trim().replace(/^['"]|['"]$/g, '')).filter(Boolean) : [];
}
function fmScalar(fm, key) {
  const m = fm.match(new RegExp(`^${key}:\\s*(.+)$`, 'm'));
  return m ? m[1].trim().replace(/^['"]|['"]$/g, '') : '';
}
const docs = walk(kdir).sort().map(f => {
  const text = fs.readFileSync(f, 'utf8');
  const m = text.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  const fm = m ? m[1] : '';
  const body = m ? text.slice(m[0].length) : text;
  return {
    path: path.relative(root, f),
    title: fmScalar(fm, 'title'),
    type: fmScalar(fm, 'document_type'),
    status: fmScalar(fm, 'status'),
    updated: fmScalar(fm, 'updated'),
    concepts: fmList(fm, 'concepts'),
    aliases: fmList(fm, 'aliases'),
    tags: fmList(fm, 'tags'),
    relatedCode: fmList(fm, 'related_code'),
    relatedDocs: fmList(fm, 'related_documents'),
    hasFrontmatter: !!m,
    hasSummary: /^## (Summary|摘要)\s*$/m.test(body),
    openQuestions: /^## Open Questions\s*$/m.test(body),
    body,
  };
});

// ---------- 概念 ----------
const concepts = new Map();   // name -> { docs: [], entryDocs: [] }
for (const d of docs) for (const c of d.concepts) {
  if (!concepts.has(c)) concepts.set(c, { docs: [], entryDocs: [] });
  const v = concepts.get(c); v.docs.push(d.path);
  if (d.type === 'business-entity') v.entryDocs.push(d.path);
}
const isCodeLike = s => /^[\x00-\x7f]+$/.test(s) && (/[a-z][A-Z]/.test(s) || /_/.test(s) || /^[A-Z][a-z]+[A-Z]/.test(s) || /^[A-Z][a-zA-Z]+$/.test(s));
const conceptRows = [...concepts.entries()].map(([name, v]) => ({
  name, docCount: v.docs.length, hasEntry: v.entryDocs.length > 0, codeLike: isCodeLike(name), docs: v.docs, entryDocs: v.entryDocs,
})).sort((a, b) => b.docCount - a.docCount);

// 缺主条目:被 ≥2 篇引用、没有 business-entity 条目
const entryless = conceptRows.filter(c => c.docCount >= 2 && !c.hasEntry && !c.codeLike);
// 类名式 concept:提示是否该有中文规范名(看与它同处一篇文档的中文实体/术语)
const codeLikeRows = conceptRows.filter(c => c.codeLike).map(c => {
  const co = new Map();
  for (const p of c.docs) for (const d of docs.filter(x => x.path === p)) for (const o of d.concepts) if (o !== c.name && !isCodeLike(o)) co.set(o, (co.get(o) || 0) + 1);
  return { ...c, coConcepts: [...co.entries()].sort((a, b) => b[1] - a[1]).slice(0, 4).map(([n, k]) => `${n}×${k}`) };
});
// 疑似近义:一个概念名包含另一个(回单质检 ⊂ 回单质检要求),或某概念出现在别的条目 aliases 里
const names = conceptRows.map(c => c.name);
const nearPairs = [];
for (const a of names) for (const b of names) if (a !== b && a.length >= 2 && b.includes(a)) nearPairs.push({ shorter: a, longer: b });
const aliasClash = [];
for (const d of docs) for (const al of d.aliases) if (concepts.has(al) && !d.concepts.includes(al)) aliasClash.push({ alias: al, inDoc: d.path, alsoConceptIn: concepts.get(al).docs });

// ---------- 腐烂 ----------
const parent = path.dirname(root);
const exists = p => fs.existsSync(path.join(root, p)) || fs.existsSync(path.join(parent, p));   // related_code 可能写兄弟仓库(如 xxx-web/src/...)
const missingCode = [], missingDocs = [], brokenLinks = [];
for (const d of docs) {
  for (const c of d.relatedCode) {
    if (/^[\w.$]+$/.test(c) && c.includes('.') && !c.includes('/')) continue;      // 全限定类名,不按路径查
    if (c.includes('...')) continue;                                               // 省略写法
    if (!exists(c)) missingCode.push({ doc: d.path, ref: c });
  }
  for (const r of d.relatedDocs) if (!exists(r)) missingDocs.push({ doc: d.path, ref: r });
  for (const m of d.body.matchAll(/\]\(([^)\s#]+\.md)(?:#[^)]*)?\)/g)) {
    const target = m[1];
    if (/^https?:/.test(target)) continue;
    const abs = path.resolve(path.join(root, path.dirname(d.path)), decodeURIComponent(target));
    if (!fs.existsSync(abs)) brokenLinks.push({ doc: d.path, link: target });
  }
}

// ---------- 可能过期:related_code 在条目 updated 之后又有提交 ----------
function lastCommitDate(rel) {
  for (const base of [root, parent]) {
    const abs = path.join(base, rel);
    if (!fs.existsSync(abs)) continue;
    try {
      return execFileSync('git', ['-C', path.dirname(abs), 'log', '-1', '--format=%cs', '--', abs], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    } catch { return ''; }
  }
  return '';
}
const stale = [];
for (const d of docs) {
  if (!d.updated) continue;
  const newer = [];
  for (const c of d.relatedCode) {
    if (c.includes('...') || !c.includes('/')) continue;
    const t = lastCommitDate(c);
    if (t && t > d.updated) newer.push(`${c}(${t})`);
  }
  if (newer.length) stale.push({ doc: d.path, updated: d.updated, changedAfter: newer });
}

const drafts = docs.filter(d => d.status === 'draft').map(d => ({ doc: d.path, updated: d.updated, openQuestions: d.openQuestions }));
const invalidShape = docs.filter(d => !d.hasFrontmatter || !d.hasSummary).map(d => ({ doc: d.path, frontmatter: d.hasFrontmatter, summary: d.hasSummary }));
const typeCount = docs.reduce((m, d) => (m[d.type || '(无)'] = (m[d.type || '(无)'] || 0) + 1, m), {});
const terms = docs.filter(d => d.tags.includes('术语')).map(d => d.title);

const result = {
  root, docCount: docs.length, typeCount, termEntries: terms, conceptCount: conceptRows.length,
  concepts: conceptRows.map(({ docs: _d, ...r }) => r), entryless: entryless.map(({ entryDocs: _e, ...r }) => r),
  codeLike: codeLikeRows.map(({ docs: _d, entryDocs: _e, ...r }) => r), nearPairs, aliasClash,
  missingCode, missingDocs, brokenLinks, stale, drafts, invalidShape,
};
if (asJson) { process.stdout.write(JSON.stringify(result, null, 1)); process.exit(0); }

// ---------- 人读摘要 ----------
const L = [];
L.push(`# 知识库盘点 ${root}`, '');
L.push(`- 文档 ${docs.length} 篇:${Object.entries(typeCount).map(([k, v]) => `${k} ${v}`).join(' · ')}`);
L.push(`- 概念 ${conceptRows.length} 个;术语条目 ${terms.length} 个${terms.length ? `(${terms.join('、')})` : ''}`, '');
L.push('## 缺主条目的概念(≥2 篇引用、没有 business-entity 条目)');
L.push(...(entryless.length ? entryless.map(c => `- ${c.name}(${c.docCount} 篇):${c.docs.join(';')}`) : ['- 无']), '');
L.push('## 类名式概念(考虑改中文规范名、类名进 aliases)');
L.push(...(codeLikeRows.length ? codeLikeRows.map(c => `- ${c.name}(${c.docCount} 篇${c.hasEntry ? ',有条目' : ''});常同现:${c.coConcepts.join('、') || '—'}`) : ['- 无']), '');
L.push('## 疑似近义 / 包含关系的概念');
L.push(...(nearPairs.length ? nearPairs.map(p => `- 「${p.shorter}」⊂「${p.longer}」`) : ['- 无']));
L.push(...aliasClash.map(a => `- 「${a.alias}」是 ${a.inDoc} 的别名,同时又是概念(${a.alsoConceptIn.join(';')})`), '');
L.push('## 腐烂');
L.push(...(missingCode.length ? missingCode.map(x => `- related_code 不存在:${x.doc} → ${x.ref}`) : ['- related_code:全部存在']));
L.push(...(missingDocs.length ? missingDocs.map(x => `- related_documents 不存在:${x.doc} → ${x.ref}`) : ['- related_documents:全部存在']));
L.push(...(brokenLinks.length ? brokenLinks.map(x => `- 正文链接断:${x.doc} → ${x.link}`) : ['- 正文链接:全部可达']), '');
L.push('## 可能过期(相关代码在条目 updated 之后又提交过)');
L.push(...(stale.length ? stale.map(s => `- ${s.doc}(updated ${s.updated}):${s.changedAfter.join('、')}`) : ['- 无']), '');
L.push('## draft 条目');
L.push(...(drafts.length ? drafts.map(d => `- ${d.doc}(updated ${d.updated}${d.openQuestions ? ',有 Open Questions' : ''})`) : ['- 无']), '');
if (invalidShape.length) { L.push('## 结构不全(缺 frontmatter 或 Summary)', ...invalidShape.map(x => `- ${x.doc}`), ''); }
L.push('## 概念用量(前 30)');
L.push(...conceptRows.slice(0, 30).map(c => `- ${c.name} ×${c.docCount}${c.hasEntry ? '(有条目)' : ''}`));
process.stdout.write(L.join('\n') + '\n');
