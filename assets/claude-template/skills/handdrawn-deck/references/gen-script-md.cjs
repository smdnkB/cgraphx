/* 从同目录 notes.js 渲染「逐页讲稿 .md」—— 口播/提示用模板插值逐字取自 notes.js，物理零漂移。
   用法：把本文件拷进你的 deck 目录（与 notes.js 同目录），`node gen-script-md.cjs`。
   改口播：先改 notes.js，再重跑本脚本；不要手改生成的 .md（会被覆盖）。
   输出：./<notes.js 所在目录名>-讲稿.md（含节奏总表 + 逐页口播/提示；Q&A、开讲清单等专属附录请自行追加或在本脚本末尾补字面量）。 */
const fs = require('fs');
const path = require('path');
const dir = __dirname;
const notesPath = path.join(dir, 'notes.js');
if (!fs.existsSync(notesPath)) { console.error('✗ 未在同目录找到 notes.js：', notesPath); process.exit(1); }
global.window = {};
require(notesPath);
const DN = window.DECK_NOTES;
if (!DN || !Array.isArray(DN.pages)) { console.error('✗ notes.js 未定义 window.DECK_NOTES.pages'); process.exit(1); }
const pages = DN.pages;

const mmss = s => { s = Math.max(0, Math.round(s)); return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); };
const cum = []; let acc = 0; pages.forEach(p => { cum.push(acc); acc += (p.sec || 0); });

const out = [];
out.push(`# 逐页讲稿（由 gen-script-md.cjs 从 notes.js 生成 · 勿手改口播）`);
out.push('');
out.push(`> ${pages.length} 页 · 合计 ${mmss(acc)}。口播/提示逐字取自 \`notes.js\`；要改请改 notes.js 后重跑本脚本。`);
out.push('> 放映：同目录 `deck.html` 自动读取 notes.js 开演讲者视图（右侧备注 + 跑表 + 进度条；`N`/`T` 切换）。');
out.push('');
out.push('## 节奏总表');
out.push('');
out.push('| 页 | 标题 | 本页 | 累计 |');
out.push('|---|---|---|---|');
pages.forEach((p, i) => out.push(`| ${p.no || (i + 1)} | ${p.title || ''} | ${mmss(p.sec || 0)} | ${mmss(cum[i] + (p.sec || 0))} |`));
out.push('');
out.push('---');
out.push('');
pages.forEach((p, i) => {
  out.push(`## 第 ${p.no || (i + 1)} 页 · ${p.title || ''} \`[${mmss(p.sec || 0)} · 累计 ${mmss(cum[i] + (p.sec || 0))}]\``);
  out.push('');
  out.push(p.口播 || '（本页暂无备注）');
  out.push('');
  if (p.cue) { out.push(`> ✎ ${p.cue}`); out.push(''); }
});

const base = path.basename(dir);
const target = path.join(dir, `${base}-讲稿.md`);
fs.writeFileSync(target, out.join('\n'));
console.log('✓ 已生成', path.basename(target), '·', pages.length, '页 · 口播逐字取自 notes.js');
