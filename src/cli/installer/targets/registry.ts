/**
 * Registry of agent targets cgraphx ships install support for.
 *
 * 2.0 ships ONLY Claude Code. The other 1.x targets (Cursor / Codex /
 * Gemini / Hermes / Kiro / opencode / Antigravity) were exclusively
 * writers for the now-removed server config, and were dropped with it.
 * The registry shape is preserved (single-element array) so the
 * orchestrator's `for (const target of targets)` loop and the
 * `--target` flag plumbing stay regular.
 */

import { AgentTarget, Location, TargetId } from './types';
import { claudeTarget } from './claude';

export const ALL_TARGETS: readonly AgentTarget[] = Object.freeze([
  claudeTarget,
]);

export function getTarget(id: string): AgentTarget | undefined {
  return ALL_TARGETS.find((t) => t.id === id);
}

export function listTargetIds(): TargetId[] {
  return ALL_TARGETS.map((t) => t.id);
}

/**
 * Run `detect()` for every target at the given location. Returns the
 * full registry zipped with detection results.
 */
export function detectAll(loc: Location): Array<{
  target: AgentTarget;
  detection: ReturnType<AgentTarget['detect']>;
}> {
  return ALL_TARGETS.map((target) => ({
    target,
    detection: target.detect(loc),
  }));
}

/**
 * Resolve a `--target=` flag value to a list of `AgentTarget` instances.
 * Accepts:
 *
 *   - `auto` / `all` — every target in the registry (just Claude in 2.0).
 *   - `none` — empty list (caller skips agent writes entirely).
 *   - csv list — `'claude'` etc. Unknown ids throw.
 */
export function resolveTargetFlag(value: string, loc: Location): AgentTarget[] {
  if (value === 'none') return [];
  if (value === 'all' || value === 'auto') {
    // `auto` previously ran detection; with only Claude shipped, the
    // result is identical to `all`. Detection is still surfaced via
    // detectAll() for the orchestrator's log lines.
    void loc;
    return [...ALL_TARGETS];
  }

  const ids = value.split(',').map((s) => s.trim()).filter(Boolean);
  const resolved: AgentTarget[] = [];
  const unknown: string[] = [];
  for (const id of ids) {
    const t = getTarget(id);
    if (t) resolved.push(t);
    else unknown.push(id);
  }
  if (unknown.length > 0) {
    const known = listTargetIds().join(', ');
    throw new Error(
      `Unknown --target id(s): ${unknown.join(', ')}. Known: ${known}, plus 'auto' / 'all' / 'none'.`,
    );
  }
  return resolved;
}
