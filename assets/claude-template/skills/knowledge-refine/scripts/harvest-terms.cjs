#!/usr/bin/env node
// 从本项目的 Claude Code 会话里挖术语线索(只读、只在本机处理,不联网)。
// 用法:node harvest-terms.cjs [项目根目录] [--top=80] [--baseline-exclude=词1,词2] [--json]
//
// 只取用户本人打的字(排除工具结果、命令输出、skill 注入、粘贴块、代码/日志行、子 agent 会话),
// 做无分词依赖的新词发现(n-gram 频次 + 凝固度 + 左右邻字熵 + 碎片过滤),再和「其他项目的会话」对比挑项目特有词。
// 产出三类线索,供 knowledge-refine 体检:
//   1. 新候选词:知识库(docs/knowledge 的标题/概念/别名)里还没有的高频项目词
//   2. 口语变体:和已有术语只差一个字的说法(派单模版 ↔ 派单模板、代办人 ↔ 待办人)→ 候选 aliases
//   3. 术语热度:已有术语条目(tags 含「术语」)在提问里被提到的次数和会话数
// --baseline-exclude:对照语料里排除哪些项目(目录名包含这些词的不算「通用语料」,用于兄弟项目共享业务词时)。
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');

const argv = process.argv.slice(2);
const opt = k => { const a = argv.find(x => x.startsWith(`--${k}=`)); return a ? a.slice(k.length + 3) : undefined; };
const asJson = argv.includes('--json');
const TOP = Number(opt('top') || 80);
const root = path.resolve(argv.find(a => !a.startsWith('--')) || process.cwd());
const baseExclude = (opt('baseline-exclude') || '').split(',').map(s => s.trim()).filter(Boolean);
const projectsDir = path.join(process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude'), 'projects');
if (!fs.existsSync(projectsDir)) { console.error(`没有会话目录 ${projectsDir}`); process.exit(2); }

// ---------- 找本项目的会话目录(主目录 + 其下 worktree + 登记过的需求副本)----------
const enc = p => p.replace(/[^A-Za-z0-9]/g, '-');
const mine = new Set([enc(root)]);
const repDir = path.join(root, '.cgraphx', 'replicas');
if (fs.existsSync(repDir)) for (const f of fs.readdirSync(repDir)) {
  try { const r = JSON.parse(fs.readFileSync(path.join(repDir, f), 'utf8')); if (r.path) mine.add(enc(r.path)); } catch { /* 忽略坏登记 */ }
}
const allDirs = fs.readdirSync(projectsDir).filter(d => fs.statSync(path.join(projectsDir, d)).isDirectory());
const isMine = d => [...mine].some(m => d === m || d.startsWith(m + '-'));
const targetDirs = allDirs.filter(isMine);
const baseDirs = allDirs.filter(d => !isMine(d) && !baseExclude.some(x => d.includes(x)));
if (!targetDirs.length) { console.error(`没找到本项目的会话目录(${enc(root)})`); process.exit(2); }

// ---------- 抽用户本人文字 ----------
const SKIP = ['Base directory for', '<local-command', '<task-notification', 'This session is being', 'Another Claude ses', '[Request interrupt', 'Caveat:'];
const CJK = /[一-鿿]/g;
const CODE_LINE = /^\s*(at |SELECT|select |insert |INSERT|update |UPDATE|from |FROM|where |WHERE|and |AND |\{|\}|<\/?\w|import |package |public |private |protected |@\w|com\.|org\.|java\.|Caused by|\[\w+\]|\d{4}-\d\d-\d\d[ T]\d|\/\/|#|\$ |>|\|)/;
function clean(t) {
  t = t.replace(/<system-reminder>[\s\S]*?<\/system-reminder>/g, '').replace(/<pasted_content[^>]*>[\s\S]*?<\/pasted_content[^>]*>/g, '').replace(/```[\s\S]*?```/g, '');
  if (t.includes('<command-name>')) { const m = t.match(/<command-args>([\s\S]*?)<\/command-args>/); t = m ? m[1] : ''; }
  return t.split('\n').map(s => s.trim()).filter(s => {
    if (!s) return false;
    const c = (s.match(CJK) || []).length;
    if (CODE_LINE.test(s) && c / s.length < 0.5) return false;
    return !(s.length > 15 && c / s.length < 0.15);
  }).join('\n');
}
function readMessages(dirs) {
  const out = []; const seen = new Set(); let raw = 0;
  for (const d of dirs) {
    const full = path.join(projectsDir, d);
    for (const f of fs.readdirSync(full)) {
      if (!f.endsWith('.jsonl')) continue;                 // 子 agent 会话在子目录里,天然排除
      const sid = f.slice(0, -6);
      let text; try { text = fs.readFileSync(path.join(full, f), 'utf8'); } catch { continue; }
      for (const line of text.split('\n')) {
        if (!line.includes('"type":"user"')) continue;
        let o; try { o = JSON.parse(line); } catch { continue; }
        if (o.type !== 'user' || o.isMeta || o.isCompactSummary || o.isSidechain) continue;
        if (o.origin && o.origin.kind !== 'human') continue;
        let c = o.message && o.message.content;
        if (Array.isArray(c)) {
          if (c.some(x => x && x.type === 'tool_result')) continue;
          c = c.filter(x => x && x.type === 'text').map(x => x.text || '').join('\n');
        }
        if (typeof c !== 'string') continue;
        raw++;
        if (SKIP.some(p => c.trimStart().startsWith(p))) continue;
        const t = clean(c);
        if (!t || seen.has(t)) continue;
        seen.add(t); out.push({ sid, text: t });
      }
    }
  }
  return { msgs: out, raw };
}
const T = readMessages(targetDirs);
const B = readMessages(baseDirs);

// ---------- n-gram 统计 ----------
const RUN = /[一-鿿]+/g;
function count(msgs, withCtx) {
  const tf = new Map(); const df = new Map(); const sf = new Map(); const L = new Map(); const R = new Map();
  const inc = (m, k, v = 1) => m.set(k, (m.get(k) || 0) + v);
  msgs.forEach((m, i) => {
    for (const r of m.text.match(RUN) || []) {
      const r2 = '^' + r + '$';
      for (let n = 1; n <= 6; n++) for (let k = 0; k + n <= r.length; k++) {
        const g = r.slice(k, k + n); inc(tf, g);
        if (!withCtx || n < 2) continue;
        if (!df.has(g)) { df.set(g, new Set()); sf.set(g, new Set()); L.set(g, new Map()); R.set(g, new Map()); }
        df.get(g).add(i); sf.get(g).add(m.sid); inc(L.get(g), r2[k]); inc(R.get(g), r2[k + n + 1]);
      }
    }
  });
  return { tf, df, sf, L, R };
}
const t = count(T.msgs, true); const b = count(B.msgs, false);
const sum1 = tf => { let s = 0; for (const [k, v] of tf) if (k.length === 1) s += v; return s || 1; };
const N1 = sum1(t.tf); const bN = sum1(b.tf);
const ent = m => { let s = 0, h = 0; for (const v of m.values()) s += v; for (const v of m.values()) h -= v / s * Math.log(v / s); return s ? h : 0; };
const dom = m => { let s = 0, mx = 0; for (const [k, v] of m) { s += v; if (k !== '^' && k !== '$' && v > mx) mx = v; } return s ? mx / s : 0; };
const p = g => (t.tf.get(g) || 0) / N1;
const coh = g => { let mn = Infinity; for (let k = 1; k < g.length; k++) mn = Math.min(mn, Math.log(p(g) / (p(g.slice(0, k)) * p(g.slice(k))))); return mn; };
const STOP_EDGE = new Set('的了是在和与或我你他她它这那吗呢吧啊也都就还要会能把被给对从到为以并而但如因所个于么什怎哪些可需现有没不再又已将让使用中上后前时里来去说看做得着过等其该每及很更最先然请帮'.split(''));
const GENERAL = new Set('需要 可以 现在 什么 怎么 问题 一下 这个 那个 我们 你们 如果 因为 所以 是否 已经 应该 还是 就是 进行 处理 方案 数据 接口 测试 代码 提交 修改 功能 文档 页面 环境 本地 生产 方式 逻辑 内容 情况 时候 相关 信息 查询 执行 记录 实现 调整 优化 验证 确认 分析 原因 结果 继续 没有 不是 一个 这些 哪些 为什么 还有 之前 之后 但是 然后 直接 重新 使用 支持 新增 删除 更新 保存 检查 配置 规范 字段 服务 项目 系统 用户 场景 报错 错误 修复'.split(' '));
const BAD_START = ['关于', '根据', '通过', '查看', '对于', '基于', '防止', '一下', '一个', '一直', '一些', '一样', '一次', '一条'];

// ---------- 已有知识库词汇 ----------
const docsRoot = opt('docs-root') ? path.resolve(opt('docs-root')) : root;   // 测试用:知识库/需求文档换个根目录读
const kdir = path.join(docsRoot, 'docs', 'knowledge');
const kbTerms = new Map();     // 术语条目 title -> [title, ...aliases]
const kbVocab = new Set();     // 所有 title / concepts / aliases
let kbText = '';
if (fs.existsSync(kdir)) (function walk(d) {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    if (e.name.startsWith('.')) continue;
    const f = path.join(d, e.name);
    if (e.isDirectory()) { walk(f); continue; }
    if (!e.name.endsWith('.md')) continue;
    const text = fs.readFileSync(f, 'utf8'); kbText += text;
    const m = text.match(/^---\r?\n([\s\S]*?)\r?\n---/); if (!m) continue;
    const list = k => { const x = m[1].match(new RegExp(`^${k}:\\s*\\n((?:[ \\t]+-[ \\t]+.*\\n?)+)`, 'm')); return x ? x[1].split('\n').map(l => l.replace(/^\s+-\s+/, '').replace(/\s+#.*$/, '').trim()).filter(Boolean) : []; };
    const title = ((m[1].match(/^title:\s*(.+)$/m) || [])[1] || '').trim();
    [title, ...list('concepts'), ...list('aliases')].forEach(v => v && kbVocab.add(v));
    if (list('tags').includes('术语')) kbTerms.set(title, [title, ...list('aliases')]);
  }
})(kdir);
let featText = '';
const fdir = path.join(docsRoot, 'docs', 'features');
if (fs.existsSync(fdir)) (function walk(d) {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const f = path.join(d, e.name);
    if (e.isDirectory()) walk(f); else if (e.name.endsWith('.md')) featText += fs.readFileSync(f, 'utf8');
  }
})(fdir);
const occurs = (s, x) => { let n = 0, i = 0; while ((i = s.indexOf(x, i)) !== -1) { n++; i += x.length; } return n; };

// ---------- 1. 新候选词 ----------
let rows = [];
const wordLike = new Set();   // 过了凝固度/邻字熵/碎片检查的词(不看富集),口语变体只在这里面找
for (const [g, f] of t.tf) {
  if (g.length < 2 || !t.df.has(g) || t.df.get(g).size < 3 || t.sf.get(g).size < 2) continue;
  if (BAD_START.some(x => g.startsWith(x)) || g.endsWith('是否') || g.endsWith('一')) continue;
  if (STOP_EDGE.has(g[0]) || STOP_EDGE.has(g[g.length - 1]) || GENERAL.has(g)) continue;
  const c = coh(g); const le = ent(t.L.get(g)); const re = ent(t.R.get(g));
  if (c < 1.5 || Math.min(le, re) < 0.6 || Math.max(dom(t.L.get(g)), dom(t.R.get(g))) > 0.55) continue;
  wordLike.add(g);
  const bf = b.tf.get(g) || 0;
  const enrich = ((f / N1) + 1e-7) / ((bf / bN) + 1e-7);
  rows.push({ term: g, freq: f, msgs: t.df.get(g).size, sessions: t.sf.get(g).size, coh: c, enrich });
}
const byTerm = new Map(rows.map(r => [r.term, r]));
rows = rows.filter(r => ![...byTerm.keys()].some(o => o.length > r.term.length && o.includes(r.term) && byTerm.get(o).freq >= 0.8 * r.freq));
for (const r of rows) {
  r.inKbDocs = occurs(kbText, r.term); r.inFeatures = occurs(featText, r.term);
  r.score = Math.log1p(r.sessions) * Math.log1p(r.freq) * Math.log(1 + Math.min(r.enrich, 200)) * Math.min(r.coh, 6) / 6 * ((r.inKbDocs || r.inFeatures) ? 1.3 : 1);
}
rows = rows.filter(r => r.enrich >= 3 || (r.inKbDocs + r.inFeatures >= 5 && r.enrich >= 1)).sort((a, b) => b.score - a.score);
const newCandidates = rows.filter(r => ![...kbVocab].some(v => v === r.term || v.includes(r.term) && v.length <= r.term.length + 2)).slice(0, TOP)
  .map(r => ({ term: r.term, freq: r.freq, sessions: r.sessions, enrich: Math.round(r.enrich * 10) / 10, inKbDocs: r.inKbDocs, inFeatures: r.inFeatures }));

// ---------- 2. 口语变体:与已有术语/别名同长、只差一个字 ----------
const variants = [];
const known = new Set([...kbTerms.values()].flat());
for (const [title, names] of kbTerms) for (const name of names) {
  // 口语变体/错别字的特征:和规范写法同长只差一个字、本身像个词、写下来的文档里几乎不用(文档用规范写法)
  if (!/[一-鿿]/.test(name) || name.length < 3) continue;   // 两字词改一个字基本是另一个词(本地/本网)
  for (const g of wordLike) {
    if (g.length !== name.length || g === name || known.has(g)) continue;
    let diff = 0; for (let i = 0; i < g.length && diff < 2; i++) if (g[i] !== name[i]) diff++;
    if (diff !== 1) continue;
    const inDocs = occurs(kbText, g) + occurs(featText, g);
    if (inDocs > 2) continue;
    variants.push({ term: title, of: name, variant: g, freq: t.tf.get(g), sessions: t.sf.get(g).size, inKbDocs: inDocs });
  }
}
variants.sort((a, b) => b.freq - a.freq);

// ---------- 3. 术语热度 ----------
const hot = [];
for (const [title, names] of kbTerms) {
  let n = 0; const s = new Set();
  for (const m of T.msgs) if (names.some(x => x && m.text.includes(x))) { n++; s.add(m.sid); }
  hot.push({ term: title, prompts: n, sessions: s.size, rate: T.msgs.length ? n / T.msgs.length : 0 });
}
hot.sort((a, b) => b.prompts - a.prompts);

const cjkCount = msgs => msgs.reduce((s, m) => s + (m.text.match(CJK) || []).length, 0);
const result = {
  root, sessionDirs: targetDirs, corpus: { rawUserMessages: T.raw, keptMessages: T.msgs.length, sessions: new Set(T.msgs.map(m => m.sid)).size, cjkChars: cjkCount(T.msgs) },
  baseline: { dirs: baseDirs.length, keptMessages: B.msgs.length, cjkChars: cjkCount(B.msgs), excluded: baseExclude },
  newCandidates, variants, hot,
};
if (asJson) { process.stdout.write(JSON.stringify(result, null, 1)); process.exit(0); }

const pct = x => (x * 100).toFixed(1) + '%';
const out = [];
out.push(`# 会话术语线索 ${root}`, '');
out.push(`- 语料:用户本人提问 ${result.corpus.keptMessages} 条(原始 ${T.raw})、${result.corpus.sessions} 个会话、汉字 ${result.corpus.cjkChars};会话目录 ${targetDirs.join('、')}`);
out.push(`- 对照:其他 ${baseDirs.length} 个项目的提问 ${B.msgs.length} 条、汉字 ${result.baseline.cjkChars}${baseExclude.length ? `(排除含 ${baseExclude.join('/')} 的项目)` : ''}`);
if (result.baseline.cjkChars < 20000) out.push('- ⚠ 对照语料偏少,「富集倍数」参考价值低,主要看会话数和是否出现在文档里');
out.push('', `## 1. 知识库还没有的高频项目词(前 ${newCandidates.length};人工挑业务词,通用词/碎片忽略)`, '', '| 词 | 次数 | 会话数 | 富集 | 知识库正文 | 需求文档 |', '|---|---|---|---|---|---|');
for (const r of newCandidates) out.push(`| ${r.term} | ${r.freq} | ${r.sessions} | ${r.enrich} | ${r.inKbDocs} | ${r.inFeatures} |`);
out.push('', '## 2. 已有术语的疑似口语变体/错别字(同长只差一个字、文档里几乎不用;确认是同一个词再加进 aliases)', '');
out.push(...(variants.length ? variants.slice(0, 40).map(v => `- ${v.variant} ≈ ${v.of}(术语「${v.term}」):${v.freq} 次 / ${v.sessions} 会话${v.inKbDocs ? `,文档里出现 ${v.inKbDocs} 次` : ''}`) : ['- 无']));
out.push('', '## 3. 术语热度(提问里提到术语名或别名的比例)', '');
out.push(...(hot.length ? hot.map(h => `- ${h.term}:${h.prompts} 条提问(${pct(h.rate)})/ ${h.sessions} 会话`) : ['- 还没有术语条目(tags 含「术语」)']));
process.stdout.write(out.join('\n') + '\n');
