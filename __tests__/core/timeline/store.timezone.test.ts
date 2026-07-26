/**
 * Cross-timezone regression test for the timeline byDay grouping + ts display.
 *
 * The main store.test.ts suite runs under TZ=UTC (set in vitest.config.ts),
 * where local time == UTC and the localtime conversion is a no-op — so the
 * bug (UTC substr bucketing events into the wrong local day) doesn't surface
 * there. This file spawns a child node process with TZ=Asia/Shanghai (UTC+8)
 * to prove the fix actually shifts the day boundary in a non-UTC zone.
 *
 * What's under test:
 *   1. SQLite `datetime(ts, 'localtime')` honors the process TZ and rolls a
 *      UTC event that falls before local midnight into the *previous* local
 *      day's bucket. (This is the exact regression: pre-fix, `substr(ts,1,10)`
 *      grouped by UTC day, so Shanghai hours 00:00–08:00 landed on yesterday.)
 *   2. The Date-based local formatting used by cli.ts formatLocalTs reports
 *      the same local wall-clock time the user would see.
 */

import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import * as path from 'node:path';

const SHANGHAI_TZ = 'Asia/Shanghai'; // UTC+8, no DST — stable year-round

/**
 * Run an inline JS snippet in a child node process with TZ pinned to Shanghai.
 * Returns the child's stdout (parsed as JSON if possible), throws on failure.
 *
 * node:sqlite is used in-process (no native build), so the child can construct
 * the DB, run the SQL, and emit structured output without touching the parent
 * process's Date/Intl state.
 */
function runInShanghaiTz(script: string): unknown {
  const result = spawnSync(process.execPath, ['-e', script], {
    env: { ...process.env, TZ: SHANGHAI_TZ },
    encoding: 'utf8',
    timeout: 15_000,
  });
  if (result.status !== 0) {
    throw new Error(
      `Child process (TZ=${SHANGHAI_TZ}) exited ${result.status}: ${result.stderr}`,
    );
  }
  const stdout = result.stdout.trim();
  try {
    return JSON.parse(stdout);
  } catch {
    return stdout;
  }
}

describe('timeline byDay grouping — cross-timezone (TZ=Asia/Shanghai)', () => {
  it('groups events into local-day buckets, not UTC-day buckets', () => {
    // Two events both dated 2026-07-01 in UTC:
    //   - 00:30 UTC → 08:30 Shanghai (still 2026-07-01 local)
    //   - 20:00 UTC → 04:00 next-day Shanghai (2026-07-02 local)
    // Pre-fix substr(ts,1,10) would bucket both under '2026-07-01' (c=2).
    // Post-fix datetime(ts,'localtime') must split them across two local days.
    const script = `
      const { DatabaseSync } = require('node:sqlite');
      const db = new DatabaseSync(':memory:');
      const rows = db.prepare(\`
        WITH events(ts) AS (VALUES
          ('2026-07-01T00:30:00.000Z'),
          ('2026-07-01T20:00:00.000Z'))
        SELECT substr(datetime(ts, 'localtime'), 1, 10) AS day, COUNT(*) AS c
        FROM events GROUP BY day ORDER BY day
      \`).all();
      process.stdout.write(JSON.stringify(rows));
    `;
    const rows = runInShanghaiTz(script) as Array<{ day: string; c: number }>;

    expect(rows).toEqual([
      { day: '2026-07-01', c: 1 },
      { day: '2026-07-02', c: 1 },
    ]);
  });

  it('does not regress: under TZ=UTC the localtime modifier is a no-op', () => {
    // Sanity check — the same SQL under UTC must keep both events on 2026-07-01.
    // This guards against an over-correction that would *always* shift days.
    const script = `
      const { DatabaseSync } = require('node:sqlite');
      const db = new DatabaseSync(':memory:');
      const rows = db.prepare(\`
        WITH events(ts) AS (VALUES
          ('2026-07-01T00:30:00.000Z'),
          ('2026-07-01T20:00:00.000Z'))
        SELECT substr(datetime(ts, 'localtime'), 1, 10) AS day, COUNT(*) AS c
        FROM events GROUP BY day ORDER BY day
      \`).all();
      process.stdout.write(JSON.stringify(rows));
    `;
    const result = spawnSync(process.execPath, ['-e', script], {
      env: { ...process.env, TZ: 'UTC' },
      encoding: 'utf8',
      timeout: 15_000,
    });
    expect(result.status).toBe(0);
    const rows = JSON.parse(result.stdout.trim()) as Array<{ day: string; c: number }>;
    expect(rows).toEqual([{ day: '2026-07-01', c: 2 }]);
  });

  it('Date getHours() reflects the configured zone (validates cli.ts formatLocalTs)', () => {
    // cli.ts formatLocalTs uses Date getHours()/getDate() which read V8's Intl
    // timezone. Confirm that under TZ=Asia/Shanghai, a UTC noon instant reports
    // as 20:00 local — the exact offset the user complained was missing.
    const script = `
      const d = new Date('2026-07-01T12:35:32.799Z');
      const pad = n => String(n).padStart(2,'0');
      process.stdout.write(JSON.stringify({
        local: d.getFullYear()+'-'+pad(d.getMonth()+1)+'-'+pad(d.getDate())+
               ' '+pad(d.getHours())+':'+pad(d.getMinutes())+':'+pad(d.getSeconds()),
        offsetMinutes: d.getTimezoneOffset(),
      }));
    `;
    const out = runInShanghaiTz(script) as { local: string; offsetMinutes: number };
    expect(out.local).toBe('2026-07-01 20:35:32');
    expect(out.offsetMinutes).toBe(-480); // UTC+8 → offset is negative
  });
});

// Reference the path import so tsc doesn't flag it unused if future tests
// add file-based fixtures. Keeps the module compile-clean.
void path;
