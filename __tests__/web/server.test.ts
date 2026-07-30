import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import * as net from 'node:net';

import {
  startWebServer,
  WebStartupError,
  exitCodeForWebError,
  type WebServer,
} from '../../src/web';
import { createDirectory } from '../../src/core/directory';
import { DatabaseConnection, getDatabasePath } from '../../src/core/db';
import { ensureMarkdownSchema } from '../../src/core/markdown/schema-bootstrap';
import { ensureTimelineSchema } from '../../src/core/timeline/schema-bootstrap';

let tmp: string;
const servers: WebServer[] = [];
const blockers: net.Server[] = [];

/**
 * Build an initialized project fixture: createDirectory + open + apply
 * markdown (and optionally timeline) schemas, then close. Calling the
 * ensure*Schema helpers here is fixture construction, NOT web behavior — the
 * web server itself never applies schemas (read-only contract).
 */
function initProject(projectRoot: string, opts: { timeline?: boolean } = {}): void {
  createDirectory(projectRoot);
  const conn = DatabaseConnection.open(getDatabasePath(projectRoot));
  try {
    ensureMarkdownSchema(conn.getDb());
    if (opts.timeline !== false) ensureTimelineSchema(conn.getDb());
  } finally {
    conn.close();
  }
}

/** Row count for a table via a short-lived connection (WAL allows concurrent readers). */
function countRows(projectRoot: string, table: string): number {
  const conn = DatabaseConnection.open(getDatabasePath(projectRoot));
  try {
    const row = conn
      .getDb()
      .prepare(`SELECT count(*) AS n FROM ${table}`)
      .get() as { n: number };
    return row.n;
  } finally {
    conn.close();
  }
}

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'web-server-test-'));
});

afterEach(async () => {
  for (const srv of servers) {
    await srv.close().catch(() => {});
  }
  servers.length = 0;
  for (const blocker of blockers) {
    await new Promise<void>((resolve) => blocker.close(() => resolve()));
  }
  blockers.length = 0;
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe('startWebServer', () => {
  it('serves the knowledge overview + timeline placeholder for an initialized project (spec §3.1, §3.2, §3.3)', async () => {
    initProject(tmp);
    const srv = await startWebServer({ projectRoot: tmp, port: 0 });
    servers.push(srv);

    // B-3 起 `GET /` 为知识库总览页(取代 B-2 占位);空库 fixture → 空态①。
    const home = await fetch(srv.url);
    expect(home.status).toBe(200);
    const homeBody = await home.text();
    expect(homeBody).toContain('知识库为空');
    expect(homeBody).toContain('只读');

    const timeline = await fetch(`${srv.url}/timeline`);
    expect(timeline.status).toBe(200);
    const timelineBody = await timeline.text();
    expect(timelineBody).toContain('平行需求');
    expect(timelineBody).toContain('2026-07-30-cgraphx-web时间线浏览');

    const nope = await fetch(`${srv.url}/nope`);
    expect(nope.status).toBe(404);
  });

  it('binds only to the loopback address (spec §5.1)', async () => {
    initProject(tmp);
    const srv = await startWebServer({ projectRoot: tmp, port: 0 });
    servers.push(srv);

    expect(srv.url.startsWith('http://127.0.0.1:')).toBe(true);
    // Fetching over the loopback URL succeeds → the binding is live.
    const res = await fetch(srv.url);
    expect(res.status).toBe(200);
  });

  it('fails fast on an uninitialized project (spec §3.1, §11 #9)', async () => {
    // tmp is an empty directory — no .cgraphx/cgraphx.db.
    let caught: unknown;
    try {
      await startWebServer({ projectRoot: tmp, port: 0 });
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(WebStartupError);
    const err = caught as WebStartupError;
    expect(err.kind).toBe('uninitialized');
    expect(err.message).toContain('cgraphx install');
    expect(exitCodeForWebError(err)).toBe(2);
  });

  it('fails when the timeline schema is missing (spec §3.1)', async () => {
    initProject(tmp, { timeline: false });

    let caught: unknown;
    try {
      await startWebServer({ projectRoot: tmp, port: 0 });
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(WebStartupError);
    const err = caught as WebStartupError;
    expect(err.kind).toBe('schema-missing');
    expect(err.detail?.missing).toContain('timeline');
    expect(err.message).toContain('cgraphx install');
    expect(exitCodeForWebError(err)).toBe(2);
  });

  it('fails when the port is already in use (spec §3.1, §11 #8)', async () => {
    initProject(tmp);

    // Occupy a port first: listen on 0, keep the ephemeral port held.
    const blocker = net.createServer();
    blockers.push(blocker);
    const occupiedPort = await new Promise<number>((resolve) => {
      blocker.listen(0, '127.0.0.1', () => {
        resolve((blocker.address() as net.AddressInfo).port);
      });
    });

    let caught: unknown;
    try {
      await startWebServer({ projectRoot: tmp, port: occupiedPort });
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(WebStartupError);
    const err = caught as WebStartupError;
    expect(err.kind).toBe('port-in-use');
    expect(err.message).toContain('--port');
    expect(exitCodeForWebError(err)).toBe(1);
  });

  it('does not write to the database while serving (spec §4.1, §11 #3)', async () => {
    initProject(tmp);
    const srv = await startWebServer({ projectRoot: tmp, port: 0 });
    servers.push(srv);

    const beforeDocs = countRows(tmp, 'markdown_documents');
    const beforeEvents = countRows(tmp, 'timeline_events');

    // A burst of requests across every route (incl. a real asset + 404s).
    await fetch(srv.url);
    await fetch(`${srv.url}/timeline`);
    await fetch(`${srv.url}/assets/app.css`);
    const missingAsset = await fetch(`${srv.url}/assets/x.css`);
    expect(missingAsset.status).toBe(404);
    await fetch(`${srv.url}/nope`);

    expect(countRows(tmp, 'markdown_documents')).toBe(beforeDocs);
    expect(countRows(tmp, 'timeline_events')).toBe(beforeEvents);
  });

  it('rejects path traversal on static assets (spec §5.1)', async () => {
    initProject(tmp);
    const srv = await startWebServer({ projectRoot: tmp, port: 0 });
    servers.push(srv);

    // %2f-encoded traversal must be caught by the post-resolve root check.
    const traversal = await fetch(`${srv.url}/assets/..%2f..%2fpackage.json`);
    expect(traversal.status).toBe(404);
  });

  it('stops accepting requests after close() (lifecycle)', async () => {
    initProject(tmp);
    const srv = await startWebServer({ projectRoot: tmp, port: 0 });
    const url = srv.url;
    await srv.close();

    await expect(fetch(url)).rejects.toBeDefined();
  });
});
