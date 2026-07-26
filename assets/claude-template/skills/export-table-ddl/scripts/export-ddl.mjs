#!/usr/bin/env node
/**
 * export-ddl.mjs — 批量导出项目表的 DDL 到可检索目录。
 *
 * 流程:
 *   1. `cgraphx db schema --mode=tables --profile=P` 拿全表 + 表注释(1 次调用)
 *   2. 过滤到请求的表清单(--tables all 时跳过过滤)
 *   3. 对每张表 `cgraphx db schema --mode=ddl --table=X --profile=P` 拿 DDL 文本(N 次调用)
 *   4. 写 <out>/<project>/INDEX.md(表名 + 注释 + DDL 链接)+ <out>/<project>/ddl/<table>.sql
 *
 * 用法:
 *   node export-ddl.mjs \
 *     --profile zqassis \
 *     --tables ./tables.txt \      # 或 --tables all(全库导出)
 *     --out ./schema-dump \
 *     --project customer-svc
 *
 * tables 文件格式:每行一个表名,# 开头注释行忽略;或 JSON 数组 ["t1","t2"]。
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { resolve, join } from 'node:path';

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

function readTableList(spec) {
  if (spec === 'all') return null; // null = 不过滤
  const raw = readFileSync(spec, 'utf8');
  const trimmed = raw.trim();
  if (trimmed.startsWith('[')) {
    return JSON.parse(trimmed);
  }
  return trimmed
    .split('\n')
    .map(l => l.trim())
    .filter(l => l && !l.startsWith('#'));
}

function runCgraphx(cmdArgs, { expectJson = false } = {}) {
  const env = { ...process.env, CGRAPHX_WASM_RELAUNCHED: '1' };
  const bin = process.env.CGRAPHX_BIN || 'cgraphx';
  const out = execFileSync(bin, ['db', ...cmdArgs], {
    encoding: 'utf8',
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
    maxBuffer: 64 * 1024 * 1024,
  });
  if (expectJson) return JSON.parse(out);
  return out;
}

/**
 * 提取 db-query 探索补充的 DISCOVERED 块(含起止标记行),供重 dump 时保留。
 * 块格式见 db-query/SKILL.md。无块返回 null。
 */
function extractDiscoveredBlock(content) {
  const start = content.indexOf('-- === DISCOVERED');
  if (start === -1) return null;
  const endMarker = '-- === END DISCOVERED ===';
  const end = content.indexOf(endMarker, start);
  if (end === -1) return content.slice(start).replace(/\n*$/, '\n');
  return content.slice(start, end + endMarker.length).replace(/\n*$/, '\n');
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const profile = args.profile;
  const tablesSpec = args.tables;
  const outDir = args.out;
  const project = args.project;
  if (!profile || !tablesSpec || !outDir || !project) {
    process.stderr.write(
      'Usage: export-ddl.mjs --profile <name> --tables <file|all> --out <dir> --project <name>\n',
    );
    process.exit(5);
  }

  // 1. 拿全表 + 注释
  process.stderr.write(`[export-ddl] 拉取 ${profile} 的表清单...\n`);
  const tablesResult = runCgraphx(
    ['schema', '--mode=tables', `--profile=${profile}`, '--format=json'],
    { expectJson: true },
  );
  const allTables = new Map(tablesResult.tables.map(t => [t.name, t.comment ?? '']));

  // 2. 过滤
  const requested = readTableList(tablesSpec);
  const targets = requested === null
    ? [...allTables.keys()]
    : requested.filter(Boolean);
  process.stderr.write(`[export-ddl] 共 ${targets.length} 张表待导出。\n`);

  // 3. 逐表拉 DDL
  const projectDir = resolve(outDir, project);
  const ddlDir = join(projectDir, 'ddl');
  mkdirSync(ddlDir, { recursive: true });

  const indexRows = [];
  let ok = 0, missing = 0, failed = 0, preserved = 0;
  for (const table of targets) {
    const comment = allTables.get(table);
    if (comment === undefined) {
      indexRows.push({ table, comment: '(表中不存在)', status: 'missing' });
      missing++;
      continue;
    }
    try {
      const ddl = runCgraphx(
        ['schema', '--mode=ddl', `--table=${table}`, `--profile=${profile}`],
      );
      const filePath = join(ddlDir, `${table}.sql`);
      // 重 dump 时保留 db-query 探索补充的 -- === DISCOVERED === 块
      let out = ddl;
      if (existsSync(filePath)) {
        const old = readFileSync(filePath, 'utf8');
        const discovered = extractDiscoveredBlock(old);
        if (discovered) {
          out = ddl.replace(/\n*$/, '\n') + '\n' + discovered;
          preserved++;
        }
      }
      writeFileSync(filePath, out);
      indexRows.push({ table, comment, status: 'ok' });
      ok++;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      process.stderr.write(`[export-ddl] ${table} 失败: ${msg}\n`);
      indexRows.push({ table, comment, status: `failed: ${msg.split('\n')[0]}` });
      failed++;
    }
  }

  // 4. 写 INDEX.md
  const lines = [
    `# ${project} 表清单`,
    '',
    `共 ${targets.length} 张表(成功 ${ok} / 缺失 ${missing} / 失败 ${failed}),DDL 见 \`ddl/\` 目录。${preserved > 0 ? ` 保留 ${preserved} 张表的 DISCOVERED 补充。` : ''}`,
    '',
    '| 表名 | 注释 | 状态 |',
    '|---|---|---|',
  ];
  for (const r of indexRows) {
    const status = r.status === 'ok' ? '✓' : r.status;
    lines.push(`| \`${r.table}\` | ${r.comment || ''} | ${status} |`);
  }
  writeFileSync(join(projectDir, 'INDEX.md'), lines.join('\n') + '\n');

  process.stderr.write(
    `[export-ddl] 完成 → ${projectDir}/  (成功 ${ok} / 缺失 ${missing} / 失败 ${failed})\n`,
  );
}

main();
