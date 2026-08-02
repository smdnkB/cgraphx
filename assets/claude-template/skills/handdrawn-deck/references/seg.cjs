/* 从同目录放映壳 deck.html 提取 segmentScript（呼吸段切分 · 唯一实现源 = 壳），切 notes.js 每页口播。
   用法：拷进 deck 目录（与 deck.html / notes.js 同目录），`node seg.cjs`。
   不复制实现、只提取：壳内 segmentScript 是运行时真相，stages 必须与它逐字一致——
   提取后先过自检断言，防提取逻辑与壳失配（输出 ✗ 即停，别带着错切分往下写 stages）。 */
const fs = require('fs');
const path = require('path');
const dir = __dirname;

/* 稳健提取：定位函数签名 + 花括号配对（对函数体内部排版不敏感；
   仅不适用于函数体字符串字面量里含花括号的情形——segmentScript 只含正则字面量，安全） */
function extractFunction(src, name){
  const start = src.indexOf('function ' + name + '(');
  if (start < 0) return null;
  const open = src.indexOf('{', start);
  let depth = 0, j = open;
  for (; j < src.length; j++){
    if (src[j] === '{') depth++;
    else if (src[j] === '}'){ depth--; if (!depth) break; }
  }
  return src.slice(start, j + 1);
}

const shellPath = path.join(dir, 'deck.html');
if (!fs.existsSync(shellPath)) { console.error('✗ 同目录未找到 deck.html：', shellPath); process.exit(1); }
const fnSrc = extractFunction(fs.readFileSync(shellPath, 'utf8'), 'segmentScript');
if (!fnSrc) { console.error('✗ deck.html 中未找到 segmentScript 函数'); process.exit(1); }
eval(fnSrc);

/* 自检：基础句读合并 + >120 字无句末点退按顿号切（与壳行为锚定）
   行为边界（壳实现如此）：。！？；恒切；>120 字无句末点的长段落才退按 半角逗号/顿号 切——
   全角逗号「，」不是退避分隔符，故口播要用 。！？ 断句，别指望长段落里的全角逗号。 */
const c1 = segmentScript('第一句话。第二句话！第三句话？');
const c2 = segmentScript(Array(10).fill('一二三四五六七八九十一二三四、').join(''));   /* 150 字无句末点 → 顿号切 → 2 段(75+75) */
if (c1.length !== 1) { console.error('✗ 自检失败：基础用例应 1 段，实得', c1.length); process.exit(1); }
if (c2.length !== 2) { console.error('✗ 自检失败：逗号回退用例应 2 段，实得', c2.length); process.exit(1); }

const notesPath = path.join(dir, 'notes.js');
if (!fs.existsSync(notesPath)) { console.error('✗ 同目录未找到 notes.js'); process.exit(1); }
global.window = {};
require(notesPath);
const DN = window.DECK_NOTES;
if (!DN || !Array.isArray(DN.pages)) { console.error('✗ notes.js 未定义 window.DECK_NOTES.pages'); process.exit(1); }

let bad = 0;
for (const p of DN.pages) {
  const segs = segmentScript(p['口播'] || '');
  const rows = Array.isArray(p.stages) ? p.stages.length : 0;
  const mark = rows ? (rows === segs.length ? '✓' : '✗ 不匹配') : '（无 stages）';
  if (rows && rows !== segs.length) bad++;
  console.log(`\nP${p.no || '?'} ${p.title || ''} · 呼吸段 ${segs.length} / stages ${rows} 行 ${mark}`);
  segs.forEach((s, i) => console.log(`  [${i + 1}] (${s.length}字) ${s}`));
}
console.log(bad ? '\n✗ 存在 stages 行数 ≠ 呼吸段数 的页' : '\n✓ 切分完成，stages 行数全部对齐');
process.exit(bad ? 1 : 0);
