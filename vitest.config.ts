import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['__tests__/**/*.test.ts'],
    env: {
      /**
       * Pin the timezone so date/timezone-sensitive assertions (timeline
       * byDay grouping, windowStart/end formatting, resolveTimeBound local
       * interpretation, CLI rendering of instants) are reproducible across
       * contributor machines and CI.
       *
       * Cross-timezone behavior is exercised by spawning child processes
       * with an explicit TZ override (see store.timezone.test.ts).
       *
       * Migrated from codegraph/vitest.config.ts (TZ portion only; the
       * codegraph-specific CODEGRAPH_ALLOW_UNSAFE_NODE / CODEGRAPH_TELEMETRY
       * env vars do not apply to cgraphx 2.0).
       */
      TZ: 'UTC',
    },
  },
});
