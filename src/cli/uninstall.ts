#!/usr/bin/env node
/**
 * cgraphx preuninstall cleanup script.
 *
 * Runs automatically when `npm uninstall -g cgraphx` is called (wired via the
 * `preuninstall` script in package.json).
 *
 * 2.0 note: this is now a NO-OP. cgraphx 2.0 has no global (~/.claude) config —
 * everything is project-local, and a project's `.claude/` + `.cgraphx/` are
 * cleaned by running `cgraphx uninstall` INSIDE that project, not by
 * uninstalling the global CLI. There is nothing for this hook to sweep at
 * npm-uninstall time. The file is kept (package.json references it) so
 * `npm uninstall -g cgraphx` doesn't error on a missing script.
 *
 * This script must never throw — a failed cleanup must not block uninstall.
 */

// Intentionally empty — see the header. A valid, side-effect-free module so the
// npm `preuninstall` hook resolves and exits 0.
export {};
