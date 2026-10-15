/**
 * Agent target abstraction for the installer.
 *
 * Each agent implements this interface so
 * the installer orchestrator can write the right hooks / statusLine / assets
 * for that agent without baking client-specific paths into core code.
 *
 * 每个 target 由 agent 描述(`src/core/agents`)生成,见 `agent-target.ts`。
 */

import type { AgentId, AgentProfile } from '../../../core/agents';

/**
 * Where a target's config lives. 2.0 is project-local only — the flow
 * deliberately does not support a global (`~/.claude`) install, so the union
 * has collapsed to `'local'`. The `loc` parameter is retained on the
 * `AgentTarget` methods for now (a later cleanup can drop it entirely); keeping
 * the type single-valued lets the compiler flag any stray `'global'` usage.
 */
export type Location = 'local';

/** `--target` 参数与注册表使用的稳定 id,即 agent id。 */
export type TargetId = AgentId;

/**
 * `target.detect(location)` 的结果。
 * - `detected`:项目内存在该 agent 的配置目录,或其 CLI 在 PATH 上(交互安装默认勾选依据)。
 * - `installed`:该 agent 已装过 cgraphx(`-y` / upgrade 的安装对象依据)。
 */
export interface DetectionResult {
  detected: boolean;
  installed: boolean;
  /** 检查的 settings 路径,用于诊断输出。 */
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

/**
 * Options for `target.install(location, opts)`. Currently empty — the
 * 1.x/early-2.0 `promptHook` option was removed together with the dead
 * `cgraphx prompt-hook` subcommand (see the 2.0 cleanup in targets/claude.ts).
 * The interface (and the parameter) is retained for abstraction stability.
 */
// eslint-disable-next-line @typescript-eslint/no-empty-interface
export interface InstallOptions {}

export interface AgentTarget {
  /** 稳定 id,与 `TargetId` 一致。 */
  readonly id: TargetId;
  /** 生成该 target 的 agent 描述。 */
  readonly profile: AgentProfile;
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
