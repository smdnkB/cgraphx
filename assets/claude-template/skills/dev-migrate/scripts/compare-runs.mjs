#!/usr/bin/env node
/**
 * compare-runs.mjs — 新旧系统接口对拍:比较同一套 .bru 在两个环境下的 `bru run --reporter-json` 结果。
 *
 * 流程:
 *   1. 读两份报告,按用例路径(results[].path)+ 迭代序号配对
 *   2. 按规则归一化响应体:删掉 ignore 路径,unordered 数组排序
 *   3. 比 HTTP 状态和归一化后的响应体,逐叶子列出差异
 *   4. 写 markdown 明细(--out),有差异或有缺失配对时退出码 1
 *
 * 用法:
 *   node compare-runs.mjs \
 *     --old old.json \             # bru run <目录> --env old --reporter-json old.json
 *     --new new.json \
 *     --rules 对拍规则.json \       # 可选
 *     --out 对拍明细.md            # 可选,缺省打印到 stdout
 *
 * 规则文件(路径用点号,数组元素写 [*]):
 *   {
 *     "ignore": ["traceId", "data.rows[*].updateTime"],
 *     "unordered": { "data.rows": "id", "data.tags": null }   // 值是排序键;null 按整个元素排序
 *   }
 */
import { readFileSync, writeFileSync } from 'node:fs';

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i];
    if (k.startsWith('--')) {
      const v = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : 'true';
      args[k.slice(2)] = v;
    }
  }
  return args;
}

/** 报告 → Map<"用例路径#迭代", {status, data}> */
function loadRun(file) {
  const iterations = JSON.parse(readFileSync(file, 'utf8'));
  const runs = new Map();
  for (const it of Array.isArray(iterations) ? iterations : [iterations]) {
    for (const r of it.results ?? []) {
      runs.set(`${r.path}#${r.iterationIndex ?? 0}`, {
        status: r.response?.status ?? null,
        data: r.response?.data ?? null,
        error: r.error ?? null,
      });
    }
  }
  return runs;
}

/** 键排序后的 JSON,用于比较和无序数组排序 */
function stable(v) {
  if (Array.isArray(v)) return `[${v.map(stable).join(',')}]`;
  if (v !== null && typeof v === 'object') {
    return `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${stable(v[k])}`).join(',')}}`;
  }
  return JSON.stringify(v);
}

function normalize(value, pattern, rules) {
  if (Array.isArray(value)) {
    let items = value.map((v) => normalize(v, `${pattern}[*]`, rules));
    if (Object.hasOwn(rules.unordered, pattern)) {
      const key = rules.unordered[pattern];
      const sortVal = (v) => (key == null ? stable(v) : String(v?.[key]));
      items = [...items].sort((a, b) => (sortVal(a) < sortVal(b) ? -1 : sortVal(a) > sortVal(b) ? 1 : 0));
    }
    return items;
  }
  if (value !== null && typeof value === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(value)) {
      const p = pattern ? `${pattern}.${k}` : k;
      if (rules.ignore.has(p)) continue;
      out[k] = normalize(v, p, rules);
    }
    return out;
  }
  return value;
}

/** 逐叶子比较,返回 [{path, old, new}] */
function diff(a, b, path = '', acc = []) {
  const isObj = (v) => v !== null && typeof v === 'object';
  if (isObj(a) && isObj(b) && Array.isArray(a) === Array.isArray(b)) {
    const keys = Array.isArray(a)
      ? [...Array(Math.max(a.length, b.length)).keys()]
      : [...new Set([...Object.keys(a), ...Object.keys(b)])];
    for (const k of keys) {
      const p = Array.isArray(a) ? `${path}[${k}]` : path ? `${path}.${k}` : k;
      const inA = Array.isArray(a) ? k < a.length : Object.hasOwn(a, k);
      const inB = Array.isArray(b) ? k < b.length : Object.hasOwn(b, k);
      if (!inA || !inB) acc.push({ path: p, old: inA ? a[k] : '(无)', new: inB ? b[k] : '(无)' });
      else diff(a[k], b[k], p, acc);
    }
  } else if (stable(a) !== stable(b)) {
    acc.push({ path: path || '(整体)', old: a, new: b });
  }
  return acc;
}

const cell = (v) => '`' + (typeof v === 'string' ? v : JSON.stringify(v)).replaceAll('|', '\\|').slice(0, 120) + '`';

const args = parseArgs(process.argv.slice(2));
if (!args.old || !args.new) {
  console.error('用法: node compare-runs.mjs --old old.json --new new.json [--rules 对拍规则.json] [--out 对拍明细.md]');
  process.exit(2);
}
const rawRules = args.rules ? JSON.parse(readFileSync(args.rules, 'utf8')) : {};
const rules = { ignore: new Set(rawRules.ignore ?? []), unordered: rawRules.unordered ?? {} };

const oldRun = loadRun(args.old);
const newRun = loadRun(args.new);
const ids = [...new Set([...oldRun.keys(), ...newRun.keys()])].sort();

const rows = [];
let same = 0;
for (const id of ids) {
  const o = oldRun.get(id);
  const n = newRun.get(id);
  if (!o || !n) {
    rows.push(`| ${id} | ❌ 缺配对 | 只在${o ? '旧' : '新'}系统报告里 |`);
    continue;
  }
  const found = [];
  if (o.status !== n.status) found.push({ path: 'HTTP 状态', old: o.status, new: n.status });
  if (o.error || n.error) found.push({ path: '请求错误', old: o.error ?? '', new: n.error ?? '' });
  diff(normalize(o.data, '', rules), normalize(n.data, '', rules), '', found);
  if (found.length === 0) {
    same++;
    continue;
  }
  const detail = found.slice(0, 20).map((d) => `${d.path}: ${cell(d.old)} → ${cell(d.new)}`).join('<br>');
  rows.push(`| ${id} | ❌ ${found.length} 处 | ${detail}${found.length > 20 ? '<br>…' : ''} |`);
}

const report = [
  `对拍:${ids.length} 个用例,一致 ${same},不一致 ${ids.length - same}`,
  '',
  ...(rows.length ? ['| 用例 | 结果 | 差异(旧 → 新) |', '|---|---|---|', ...rows] : []),
  '',
].join('\n');

if (args.out) writeFileSync(args.out, report);
else process.stdout.write(report);
process.exit(rows.length ? 1 : 0);
