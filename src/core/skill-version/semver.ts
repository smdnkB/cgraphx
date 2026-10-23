/**
 * 三段式版本号的解析与比较(由 cli/upgrade 迁入,upgrade 与会话开始检查共用一套规则)。
 */

export interface Semver {
  major: number;
  minor: number;
  patch: number;
  pre: string | null;
}

/** 解析 `1.2.3` / `v1.2.3` / `1.2.3-rc.1`;不是这个形状返回 null。 */
export function parseSemver(version: string): Semver | null {
  const m = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?/.exec(version.trim());
  if (!m) return null;
  return {
    major: parseInt(m[1]!, 10),
    minor: parseInt(m[2]!, 10),
    patch: parseInt(m[3]!, 10),
    pre: m[4] ?? null,
  };
}

/** a > b 返回正数,a < b 返回负数,相等返回 0;任一方解析不了时抛错。 */
export function compareVersions(a: string, b: string): number {
  const sa = parseSemver(a);
  const sb = parseSemver(b);
  if (!sa || !sb) throw new Error(`cannot compare versions: "${a}" vs "${b}"`);
  if (sa.major !== sb.major) return sa.major - sb.major;
  if (sa.minor !== sb.minor) return sa.minor - sb.minor;
  if (sa.patch !== sb.patch) return sa.patch - sb.patch;
  // 预发布版低于同号正式版(1.0.0-rc < 1.0.0)
  if (sa.pre && !sb.pre) return -1;
  if (!sa.pre && sb.pre) return 1;
  if (sa.pre && sb.pre) return sa.pre < sb.pre ? -1 : sa.pre > sb.pre ? 1 : 0;
  return 0;
}
