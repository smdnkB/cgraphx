/**
 * 平台协议版本判断:按「主.次」数值比较(平台客户端接入协议 §3「版本识别」)。
 *
 * 回归:曾用 `=== '1.1'` 判断是否支持任务键,服务端返回 1.2 起就不再声明目录任务、
 * 绑定段也不带任务键(任务自动关联 spec §5)。端到端用例起一个本地假平台,走真实的
 * connect → runSync → getSyncStatus。
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as http from 'node:http';
import type { AddressInfo } from 'node:net';
import * as os from 'node:os';
import * as path from 'node:path';

import { DatabaseConnection } from '../../../src/core/db';
import { connectPlatform, getSyncStatus, runSync, type IngestRequest } from '../../../src/core/sync';
import { protocolAtLeast } from '../../../src/core/sync/version';
import { ensureTimelineSchema } from '../../../src/core/timeline/schema-bootstrap';
import { TimelineStore } from '../../../src/core/timeline/store';

describe('protocolAtLeast', () => {
  it('compares major.minor numerically, not as strings', () => {
    expect(protocolAtLeast('1.1', '1.1')).toBe(true);
    expect(protocolAtLeast('1.2', '1.1')).toBe(true);
    expect(protocolAtLeast('1.3', '1.1')).toBe(true);
    expect(protocolAtLeast('1.10', '1.2')).toBe(true);
    expect(protocolAtLeast('2.0', '1.1')).toBe(true);
    expect(protocolAtLeast('1.0', '1.1')).toBe(false);
    expect(protocolAtLeast('0.9', '1.1')).toBe(false);
  });

  it('ignores segments after major.minor', () => {
    expect(protocolAtLeast('1.3.0', '1.1')).toBe(true);
    expect(protocolAtLeast('1.0.9', '1.1')).toBe(false);
  });

  it('treats a missing or malformed version as unsupported', () => {
    expect(protocolAtLeast(null, '1.1')).toBe(false);
    expect(protocolAtLeast('', '1.1')).toBe(false);
    expect(protocolAtLeast('1', '1.1')).toBe(false);
    expect(protocolAtLeast('abc', '1.1')).toBe(false);
  });
});

// ─── 端到端:1.2 平台 ────────────────────────────────────────────────────────

const FEATURE_ID = '2026-10-18-demo';
const OWNER = 'cgx-tester';

interface FakePlatform {
  url: string;
  ingests: IngestRequest[];
  close: () => Promise<void>;
}

/** 本地假平台:connect 签发凭据;ingest 记下请求体,并为本批声明的任务键回执 T-7。 */
async function startFakePlatform(protocolVersion: string): Promise<FakePlatform> {
  const ingests: IngestRequest[] = [];
  const server = http.createServer((req, res) => {
    let raw = '';
    req.setEncoding('utf-8');
    req.on('data', (chunk: string) => {
      raw += chunk;
    });
    req.on('end', () => {
      const send = (status: number, body: unknown): void => {
        res.writeHead(status, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(body));
      };
      if (req.method === 'POST' && req.url === '/api/client/v1/connect') {
        send(200, {
          token: 'test-token',
          project: { id: 1, name: 'demo' },
          repo: { id: 1, defaultBranch: 'main' },
          protocolVersion,
        });
        return;
      }
      if (req.method === 'POST' && req.url === '/api/client/v1/ingest') {
        const body = JSON.parse(raw) as IngestRequest;
        ingests.push(body);
        send(200, {
          accepted: { events: 0, bindings: 0, commits: 0, artifacts: 0, references: 0 },
          warnings: [],
          taskKeys: (body.taskDeclarations ?? []).map((d) => ({ taskKey: d.taskKey, taskId: 'T-7' })),
          protocolVersion,
        });
        return;
      }
      send(404, { error: 'not_found', message: `unexpected ${req.method} ${req.url}`, retryable: false });
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}`,
    ingests,
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  };
}

/**
 * 临时项目:git 仓库 + origin、带负责人头部的产出目录、一个写过该目录的会话。
 * 写的是非产物文件:会话自动关联到目录任务,又不产生待推送的产出。
 */
function makeProject(): string {
  // realpath:macOS 的 tmpdir 是符号链接,与 git rev-parse 给出的仓库根对齐
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'cg-sync-proto-')));
  execFileSync('git', ['init', '-q'], { cwd: root });
  execFileSync('git', ['remote', 'add', 'origin', 'https://git.example.com/demo.git'], { cwd: root });

  const featureDir = path.join(root, 'docs', 'features', FEATURE_ID);
  fs.mkdirSync(featureDir, { recursive: true });
  fs.writeFileSync(path.join(featureDir, 'demo-spec.md'), `# 规格说明: demo\n\n> 负责人: ${OWNER}\n`);
  fs.writeFileSync(path.join(featureDir, 'notes.md'), 'notes\n');

  fs.mkdirSync(path.join(root, '.cgraphx'));
  const conn = DatabaseConnection.open(path.join(root, '.cgraphx', 'cgraphx.db'));
  try {
    ensureTimelineSchema(conn.getDb());
    new TimelineStore(conn.getDb()).insert({
      event_type: 'post_tool_use',
      session_id: 's1',
      ts: '2026-10-18T01:00:00.000Z',
      cwd: root,
      tool_name: 'Write',
      tool_args: { file_path: path.join(featureDir, 'notes.md') },
    });
  } finally {
    conn.close();
  }
  return root;
}

/** 本机 git user.name 固定为 OWNER(GIT_CONFIG_* 环境变量覆盖任何配置文件),使目录任务归本机声明。 */
const GIT_ENV_KEYS = ['GIT_CONFIG_COUNT', 'GIT_CONFIG_KEY_0', 'GIT_CONFIG_VALUE_0'] as const;

describe('runSync / getSyncStatus against a 1.2 platform', () => {
  let root: string;
  let platform: FakePlatform;
  let savedGitEnv: Array<[string, string | undefined]>;

  beforeEach(async () => {
    savedGitEnv = GIT_ENV_KEYS.map((key) => [key, process.env[key]]);
    process.env.GIT_CONFIG_COUNT = '1';
    process.env.GIT_CONFIG_KEY_0 = 'user.name';
    process.env.GIT_CONFIG_VALUE_0 = OWNER;
    root = makeProject();
    platform = await startFakePlatform('1.2');
    await connectPlatform(root, {
      serverUrl: platform.url,
      username: 'tester',
      force: false,
      readPassword: async () => 'secret',
    });
  });

  afterEach(async () => {
    await platform.close();
    fs.rmSync(root, { recursive: true, force: true });
    for (const [key, value] of savedGitEnv) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  it('declares directory tasks and sends binding task keys (spec §5)', async () => {
    const result = await runSync(root, 'foreground');

    expect(result.ok).toBe(true);
    expect(platform.ingests).toHaveLength(1);
    const request = platform.ingests[0]!;
    expect(request.taskDeclarations).toEqual([expect.objectContaining({ taskKey: FEATURE_ID })]);
    expect(request.sessions[0]!.bindings).toEqual([expect.objectContaining({ taskId: null, taskKey: FEATURE_ID })]);
  });

  it('re-sends bindings with the mapped task id, after which status shows nothing pending', async () => {
    await runSync(root, 'foreground');
    await runSync(root, 'foreground');

    expect(platform.ingests).toHaveLength(2);
    expect(platform.ingests[1]!.sessions[0]!.bindings).toEqual([
      expect.objectContaining({ taskId: 'T-7', taskKey: FEATURE_ID }),
    ]);
    const report = await getSyncStatus(root);
    expect(report.state.serverProtocolVersion).toBe('1.2');
    expect(report.pendingSessions).toBe(0);
  });
});
