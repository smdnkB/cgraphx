#!/usr/bin/env node
/**
 * 月底日报汇总:登录工作台 → 按 total 翻页拉取某月全部日报记录 → 按日期聚合输出。
 *
 * 凭证不内置:密码优先读环境变量 WORK_REPORT_PASS,其次 --password-stdin(读 stdin 第一行),
 * 再次终端隐藏输入;不接受 --password(会进本地 timeline 的命令记录)。
 * 账号优先 --user,其次 WORK_REPORT_USER;--filler 默认等于账号。
 *
 * 仅用 Node 标准库(https/readline/stream),无第三方依赖。
 *
 * 输出:按日期升序的纯文本分组(每条 [workType/project/code] content 全文),
 * 供 agent 做语义浓缩(每行 ≤100 字)填月底日报。不写文件。
 *
 * 退出码:0 成功;1 参数/凭证/网络/接口错误;2 拉取不完整(total 与实际条数不符,不出表)。
 *
 * 用法:
 *   node fetch-reports.mjs --base https://xxx.trycloudflare.com/api --month 2026-08 \
 *        --user <登录账号>
 *   # 密码:WORK_REPORT_PASS=xxx node fetch-reports.mjs ... 或 --password-stdin
 */
import https from 'node:https';
import readline from 'node:readline';
import { Writable } from 'node:stream';
import { URL } from 'node:url';

const PAGE_SIZE = 500;
const MAX_PAGES = 100;

// ---------- 错误 ----------
/** 地址可能已更换:连接失败 / 非 JSON 等,提示要新地址。 */
class AddressError extends Error {}
/** 拉取不完整:退出码 2,调用方不得出表。 */
class IncompleteError extends Error {}

// ---------- 参数解析 ----------
function parseArgs(argv) {
  const args = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next === undefined || next.startsWith('--')) args[key] = true;
      else { args[key] = next; i++; }
    } else args._.push(a);
  }
  return args;
}

// ---------- HTTP ----------
function request(urlStr, { method = 'GET', headers = {}, body = null } = {}) {
  return new Promise((resolve, reject) => {
    const url = new URL(urlStr);
    const req = https.request(
      { hostname: url.hostname, port: url.port || 443, path: url.pathname + url.search, method, headers },
      (res) => {
        let data = '';
        res.setEncoding('utf8');
        res.on('data', (c) => (data += c));
        res.on('end', () => {
          let json = null;
          try { json = JSON.parse(data); } catch { /* 非 JSON 原样返回 */ }
          resolve({ status: res.statusCode, json, raw: data });
        });
      }
    );
    req.on('error', reject);
    req.setTimeout(30000, () => req.destroy(new Error('请求超时')));
    if (body) req.write(body);
    req.end();
  });
}

async function login(base, user, password) {
  let res;
  try {
    res = await request(base.replace(/\/+$/, '') + '/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: user, password }),
    });
  } catch (err) {
    throw new AddressError(`工作台地址可能已更换(连接失败/非 JSON),请向用户要新地址后重试(${err.message})`);
  }
  if (!res.json || !res.json.token) {
    if (res.json === null) {
      throw new AddressError('工作台地址可能已更换(连接失败/非 JSON),请向用户要新地址后重试');
    }
    throw new Error(`登录失败(HTTP ${res.status}): ${res.raw.slice(0, 300)}`);
  }
  return res.json.token;
}

async function fetchAll(base, token, startDate, endDate, userName) {
  const all = [];
  let total = null;
  for (let page = 1; page <= MAX_PAGES; page++) {
    const u = new URL(base.replace(/\/+$/, '') + '/reports');
    u.searchParams.set('page', String(page));
    u.searchParams.set('pageSize', String(PAGE_SIZE));
    u.searchParams.set('startDate', startDate);
    u.searchParams.set('endDate', endDate);
    u.searchParams.set('userName', userName);

    let res;
    try {
      res = await request(u.toString(), { headers: { Authorization: `Bearer ${token}` } });
    } catch (err) {
      throw new IncompleteError(`拉取不完整:第 ${page} 页连接失败(${err.message}),已取 ${all.length},不出表`);
    }
    if (!res.json || !Array.isArray(res.json.list)) {
      if (res.json && typeof res.json.error === 'string' && /未登录|unauthorized/i.test(res.json.error)) {
        throw new Error('接口返回未登录:检查 Authorization/token,再怀疑地址');
      }
      throw new IncompleteError(`拉取不完整:第 ${page} 页失败(HTTP ${res.status}): ${res.raw.slice(0, 300)},已取 ${all.length},不出表`);
    }
    const list = res.json.list;
    all.push(...list);
    if (typeof res.json.total === 'number') total = res.json.total;
    if (list.length === 0) break;
    if (total !== null && all.length >= total) break;
    if (total === null && list.length < PAGE_SIZE) break;
  }
  if (total !== null && all.length < total) {
    throw new IncompleteError(`拉取不完整:total=${total},已取 ${all.length},不出表`);
  }
  return { items: all, total: total ?? all.length };
}

// ---------- 密码读取 ----------
/** 从 stdin 读第一行(去掉行尾 \r\n)。 */
function readFirstLineFromStdin() {
  return new Promise((resolve, reject) => {
    let buf = '';
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      process.stdin.removeListener('data', onData);
      process.stdin.removeListener('end', onEnd);
      process.stdin.removeListener('error', onError);
      process.stdin.pause();
      const nl = buf.indexOf('\n');
      resolve((nl === -1 ? buf : buf.slice(0, nl)).replace(/\r$/, ''));
    };
    const onData = (chunk) => {
      buf += chunk.toString();
      if (buf.includes('\n')) finish();
    };
    const onEnd = () => finish();
    const onError = (err) => {
      if (done) return;
      done = true;
      reject(new Error(`读取 stdin 失败:${err.message}`));
    };
    process.stdin.on('data', onData);
    process.stdin.on('end', onEnd);
    process.stdin.on('error', onError);
    process.stdin.resume();
  });
}

/** 终端交互读一行,不回显输入(提示写 stderr,不污染 stdout)。 */
function readHiddenLineFromTty(prompt) {
  return new Promise((resolve) => {
    let muted = false;
    const output = new Writable({
      write(chunk, _encoding, callback) {
        if (!muted) process.stderr.write(chunk);
        callback();
      },
    });
    const rl = readline.createInterface({ input: process.stdin, output, terminal: true });
    process.stderr.write(prompt);
    muted = true;
    rl.question('', (answer) => {
      rl.close();
      process.stderr.write('\n');
      resolve(answer);
    });
  });
}

async function getPassword(passwordStdin) {
  const fromEnv = process.env.WORK_REPORT_PASS;
  if (typeof fromEnv === 'string' && fromEnv !== '') return fromEnv;
  if (passwordStdin) return readFirstLineFromStdin();
  if (process.stdin.isTTY) return readHiddenLineFromTty('工作台密码: ');
  throw new Error('缺少密码:设置 WORK_REPORT_PASS,或用 --password-stdin,或在终端交互输入');
}

// ---------- 工具 ----------
function monthRange(yearMonth) {
  const [y, m] = yearMonth.split('-').map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate(); // 当月最后一天
  const mm = String(m).padStart(2, '0');
  return { start: `${y}-${mm}-01`, end: `${y}-${mm}-${String(last).padStart(2, '0')}` };
}

// ---------- 主流程 ----------
async function main() {
  const args = parseArgs(process.argv.slice(2));
  const base = args.base;
  const month = args.month;
  const user = args.user || process.env.WORK_REPORT_USER;
  const filler = args.filler || user;
  const passwordStdin = args['password-stdin'] === true;

  if (args.password !== undefined) {
    throw new Error('不再接受 --password:请用 WORK_REPORT_PASS 环境变量、--password-stdin,或在终端交互输入');
  }
  if (!base || !month) {
    throw new Error('用法: node fetch-reports.mjs --base <url> --month YYYY-MM [--user <name>] [--filler <name>] [--password-stdin]');
  }
  if (!/^https:\/\//.test(String(base))) {
    throw new Error(`--base 只支持 https 地址,收到: ${base}`);
  }
  if (!/^\d{4}-\d{2}$/.test(String(month))) {
    throw new Error(`--month 格式应为 YYYY-MM,收到: ${month}`);
  }
  if (!user) {
    throw new Error('缺少账号:用 --user 或环境变量 WORK_REPORT_USER 提供');
  }

  const password = await getPassword(passwordStdin);
  if (!password) throw new Error('密码为空:请重新输入');
  const { start, end } = monthRange(month);

  const token = await login(base, user, password);
  const { items, total } = await fetchAll(base, token, start, end, filler);

  // 按日期聚合
  const groups = new Map();
  for (const it of items) {
    if (!groups.has(it.date)) groups.set(it.date, []);
    groups.get(it.date).push(it);
  }

  let out = '';
  out += `# ${month} 日报汇总  (共 ${total} 条,覆盖 ${groups.size} 个工作日)\n`;
  out += `# 范围 ${start} ~ ${end}  填写人: ${filler}\n\n`;
  if (groups.size === 0) out += '# 当月没有日报记录\n\n';
  for (const date of [...groups.keys()].sort()) {
    out += `=== ${date} ===\n`;
    for (const it of groups.get(date)) {
      const content = (it.content || '').replace(/\n/g, ' ').trim();
      out += `[${it.workType || ''}/${it.project || ''}/${it.code || ''}] ${content}\n`;
    }
    out += '\n';
  }
  out += `# END  共 ${total} 条\n`;
  process.stdout.write(out);
}

main().catch((err) => {
  console.error(err.message);
  process.exit(err instanceof IncompleteError ? 2 : 1);
});
