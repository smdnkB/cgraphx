/**
 * 看板服务安全与路由测试(2026-11-06-agent看板 单元测试规格 E1–E4;spec D2 🔒、D3、验收 1)。
 *
 * 真实起服务(127.0.0.1 随机端口),用 node:http 的请求客户端逐项校验。
 */

import * as http from 'node:http';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createBoardServer } from '../../../src/core/board/server';
import type { BoardData } from '../../../src/core/board/types';

function request(
  port: number,
  method: string,
  path: string,
  headers: Record<string, string> = {},
): Promise<{ status: number; body: string; contentType: string }> {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, method, path, headers }, (res) => {
      let body = '';
      res.on('data', (chunk: Buffer) => { body += chunk.toString('utf8'); });
      res.on('end', () => {
        resolve({ status: res.statusCode ?? 0, body, contentType: String(res.headers['content-type'] ?? '') });
      });
    });
    req.on('error', reject);
    req.end();
  });
}

describe('createBoardServer (spec D2, D3; acceptance #1)', () => {
  let server: ReturnType<typeof createBoardServer>;
  let port: number;
  let token: string;
  let refreshed: BoardData;

  beforeEach(async () => {
    refreshed = { projects: [{ name: 'after-refresh', dirs: [], notice: null, tasks: [], older: [], unsorted: [] }] };
    server = createBoardServer({
      data: { projects: [] },
      refresh: async () => refreshed,
    });
    await server.listen();
    const address = server.address;
    expect(address).not.toBeNull();
    const url = new URL(address ?? 'http://127.0.0.1/');
    port = Number(url.port);
    token = url.searchParams.get('t') ?? '';
  });
  afterEach(async () => {
    await server.close();
  });

  it('E4: address is loopback with random port and token in the URL (spec D2)', () => {
    expect(server.address).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/\?t=[0-9a-f]+$/);
    expect(token.length).toBeGreaterThanOrEqual(32);
  });

  it('E1: page, board data and refresh routes serve their payloads (spec D3 contract)', async () => {
    const page = await request(port, 'GET', `/?t=${token}`);
    expect(page.status).toBe(200);
    expect(page.contentType).toContain('text/html');
    expect(page.body).toContain('agent看板');

    const board = await request(port, 'GET', `/api/board?t=${token}`);
    expect(board.status).toBe(200);
    expect(JSON.parse(board.body)).toEqual({ projects: [] });

    const refresh = await request(port, 'POST', `/api/refresh?t=${token}`, { Origin: `http://127.0.0.1:${port}` });
    expect(refresh.status).toBe(200);
    expect(JSON.parse(refresh.body).projects[0]?.name).toBe('after-refresh');
    // 刷新成功后 GET 拿到新数据
    const after = await request(port, 'GET', `/api/board?t=${token}`);
    expect(JSON.parse(after.body).projects[0]?.name).toBe('after-refresh');
  });

  it('E2: wrong token → 403; wrong Host → 403; wrong Origin on refresh → 403 (spec acceptance #1)', async () => {
    expect((await request(port, 'GET', '/api/board?t=wrong')).status).toBe(403);
    expect((await request(port, 'GET', `/api/board?t=${token}`, { Host: 'evil.example.com' })).status).toBe(403);
    expect((await request(port, 'GET', `/api/board?t=${token}`, { Host: `127.0.0.1:${port + 1}` })).status).toBe(403); // 端口不对
    expect((await request(port, 'GET', `/api/board?t=${token}`, { Host: 'localhost' })).status).toBe(200); // localhost 放行
    expect(
      (await request(port, 'POST', `/api/refresh?t=${token}`, { Origin: 'http://evil.example.com' })).status,
    ).toBe(403);
    expect(
      (await request(port, 'POST', `/api/refresh?t=${token}`, { Origin: `http://127.0.0.1:${port}` })).status,
    ).toBe(200); // 同源 Origin 放行
    expect((await request(port, 'GET', `/unknown?t=${token}`)).status).toBe(404); // 其余 404,无路径参数
  });

  it('E2b: refresh without an Origin header → 403; the localhost origin of the same port → 200 (spec D2)', async () => {
    expect((await request(port, 'POST', `/api/refresh?t=${token}`)).status).toBe(403);
    expect(
      (await request(port, 'POST', `/api/refresh?t=${token}`, { Origin: `http://localhost:${port + 1}` })).status,
    ).toBe(403); // 端口不对
    expect(
      (await request(port, 'POST', `/api/refresh?t=${token}`, { Origin: `http://localhost:${port}` })).status,
    ).toBe(200);
  });

  it('E3: concurrent refresh → 409 while the first one is running; GET keeps serving old data (spec D3)', async () => {
    let release: (() => void) | null = null;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const slow = createBoardServer({
      data: { projects: [] },
      refresh: async () => { await gate; return { projects: [] }; },
    });
    await slow.listen();
    const url = new URL(slow.address ?? 'http://127.0.0.1/');
    const slowPort = Number(url.port);
    const slowToken = url.searchParams.get('t') ?? '';
    try {
      const origin = { Origin: `http://127.0.0.1:${slowPort}` };
      const first = request(slowPort, 'POST', `/api/refresh?t=${slowToken}`, origin);
      await new Promise((r) => setTimeout(r, 50)); // 让第一个请求先进刷新中
      const second = await request(slowPort, 'POST', `/api/refresh?t=${slowToken}`, origin);
      expect(second.status).toBe(409);
      const board = await request(slowPort, 'GET', `/api/board?t=${slowToken}`);
      expect(board.status).toBe(200); // 刷新期间 GET 照常
      expect(JSON.parse(board.body)).toEqual({ projects: [] }); // 旧数据
      release?.();
      expect((await first).status).toBe(200);
    } finally {
      await slow.close();
    }
  });
});
