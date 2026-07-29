/**
 * Agent target abstraction for the installer.
 *
 * Each agent (currently Claude Code only in 2.0) implements this interface so
 * the installer orchestrator can write the right hooks / statusLine / assets
 * for that agent without baking client-specific paths into core code.
 *
 * 2.0 note: the multi-target scaffolding is retained (it cleanly separates
 * the orchestrator from per-agent file writes, and `upgrade` reaches into
 * `targets/claude.ts` directly), but only Claude Code is shipped. The other
 * 1.x agent targets (Cursor / Codex / Gemini / etc.) wrote only the
 * now-removed server config and were dropped together with it.
 */

/**
 * Where a target's config lives. 2.0 is project-local only — the flow
 * deliberately does not support a global (`~/.claude`) install, so the union
 * has collapsed to `'local'`. The `loc` parameter is retained on the
 * `AgentTarget` methods for now (a later cleanup can drop it entirely); keeping
 * the type single-valued lets the compiler flag any stray `'global'` usage.
 */
export type Location = 'local';

/**
 * Stable string id used in the `--target` CLI flag and the registry
 * lookup. 2.0 ships only `claude`; the union is kept as a non-empty
 * list so the orchestrator's typing stays meaningful.
 */
export type TargetId = 'claude';

/**
 * Result of `target.detect(location)`.
 *
 * `installed` is a best-effort heuristic that the agent's CLI / app /
 * config dir is present on this system. False positives are acceptable
 * (we still write); false negatives just mean the user has to opt in
 * manually.
 *
 * `alreadyConfigured` reports whether cgraphx has already been wired
 * into this target at this location — drives the "Updated"-vs-"Added"
 * log line. In 2.0 (no server config), "configured" means our hooks or
 * statusLine are present in the agent's settings.
 */
export interface DetectionResult {
  installed: boolean;
  alreadyConfigured: boolean;
  /** Path inspected; surfaced in diagnostic / dry-run output. */
  configPath?: string;
}

/**
 * What `target.install(location)` actually changed on disk. The
 * orchestrator renders one log line per file using `action`.
 *
 * `unchanged` means we touched the file but its contents were already
 * what we'd write — used for byte-identical idempotent re-runs.
 */
export interface WriteResult {
  files: Array<{
    path: string;
    action: 'created' | 'updated' | 'unchanged' | 'removed' | 'not-found' | 'kept' | 'overwritten';
  }>;
  /**
   * Optional one-line notes the orchestrator surfaces verbatim — e.g.
   * "Restart Claude Code to apply." Keep these short; multi-line goes
   * in the README.
   */
  notes?: string[];
}

export interface InstallOptions {
  /**
   * Front-load prompt hook (Claude `UserPromptSubmit`) that runs
   * `cgraphx prompt-hook`. `true` installs it, `false` removes any prior
   * install (so opt-out round-trips), `undefined` leaves it untouched.
   */
  promptHook?: boolean;
}

export interface AgentTarget {
  /** Stable id; matches the `TargetId` union. */
  readonly id: TargetId;
  /** Human-readable name shown in clack prompts and log lines. */
  readonly displayName: string;
  /** Optional URL for "where do I learn more about this agent." */
  readonly docsUrl?: string;
  /**
   * Whether this target supports the given install location.
   */
  supportsLocation(loc: Location): boolean;
  detect(loc: Location): DetectionResult;
  install(loc: Location, opts: InstallOptions): WriteResult;
  /**
   * Inverse of install. Removes only what install would have written;
   * preserves sibling hooks, sibling settings, and unrelated markdown
   * sections. Must be safe to call when nothing was ever installed
   * (returns `not-found` actions).
   */
  uninstall(loc: Location): WriteResult;
  /** Filesystem paths this target would write to at this location. */
  describePaths(loc: Location): string[];
}
