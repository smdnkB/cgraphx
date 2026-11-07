/**
 * board 命令启动链测试(2026-11-06-agent看板 单元测试规格 F1–F3;spec F1 行为链、F1③、D4、验收 9)。
 *
 * 注入打开浏览器的函数跑真实 runBoard:临时 HOME 一个假项目,起真服务;SIGINT 经 process.emit 触发收尾。
 */

import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as http from 'node:http';
import * as os from 'node:os';
import * as path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { ensureDataDirAtRoot } from '../../../src/core/data-location';
import { DatabaseConnection, DATABASE_FILENAME } from '../../../src/core/db';
import { runBoard } from '../../../src/core/board/cli';

function get(port: number, pathWithToken: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, method: 'GET', path: pathWithToken }, (res) => {
      res.resume();
      res.on('end', () => resolve(res.statusCode ?? 0));
    });
    req.on('error', reject);
    req.end();
  });
}

describe.skipIf(process.platform === 'win32')('runBoard startup chain (spec F1, D4; acceptance #9)', () => {
  let root: string;
  const originalCwd = process.cwd();

  beforeEach(() => {
    fs.rmSync(path.join(os.homedir(), '.cgraphx'), { recursive: true, force: true });
    root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'cgx-board-cli-')));
    execFileSync('git', ['init', '-q'], { cwd: root });
    fs.mkdirSync(path.join(root, '.cgraphx'));
    DatabaseConnection.open(path.join(root, '.cgraphx', DATABASE_FILENAME)).close();
    expect(ensureDataDirAtRoot(root)).not.toBeNull();
  });
  afterEach(() => {
    process.chdir(originalCwd);
    fs.rmSync(root, { recursive: true, force: true });
  });

  /** 跑 runBoard,等打开回调拿到地址并探活服务,再发 SIGINT 收尾;返回打开的地址。 */
  async function runUntilOpen(open: (url: string) => void): Promise<string> {
    let opened: string | null = null;
    const board = runBoard({ openBrowser: (url) => { opened = url; open(url); } });
    const deadline = Date.now() + 10_000;
    while (opened === null && Date.now() < deadline) await new Promise((r) => setTimeout(r, 25));
    expect(opened).not.toBeNull();
    const url = new URL(opened ?? 'http://127.0.0.1/');
    const port = Number(url.port);
    // 服务真的在听
    let ok = false;
    for (let i = 0; i < 40 && !ok; i++) {
      ok = await get(port, `/?t=${url.searchParams.get('t')}`).then((s) => s === 200).catch(() => false);
      if (!ok) await new Promise((r) => setTimeout(r, 50));
    }
    expect(ok).toBe(true);
    process.emit('SIGINT');
    await board; // 干净退出(不抛)
    return opened ?? '';
  }

  it('F1/F3: full chain from a non-project cwd — sync, serve, open browser with tokened URL, exit 0 on SIGINT', async () => {
    process.chdir(os.tmpdir()); // 任意目录可跑,与启动目录无关(K12)
    const opened = await runUntilOpen(() => {});
    expect(opened).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/\?t=[0-9a-f]+$/); // 带令牌的地址(D4)
  });

  it('F2: a throwing open function degrades to the manual-access notice, service keeps running (spec F1③, acceptance #9)', async () => {
    // 打开函数同步抛错:runBoard 不崩、服务照常、SIGINT 照常退出
    const opened = await runUntilOpen(() => { throw new Error('no browser here'); });
    expect(opened).toMatch(/^http:\/\/127\.0\.0\.1/);
  });
});
