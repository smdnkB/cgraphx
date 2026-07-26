/**
 * Extract the `## Summary` (or `## 摘要`) section from a markdown document.
 *
 * Spec §4 — strict, line-oriented scan. No markdown parser dependency.
 *
 * Rules:
 *   - Recognized headings: `## Summary` / `## 摘要` exactly (case-sensitive,
 *     exactly two `#`, exactly one space after `##`).
 *   - Section body extends from the line after the heading until the next
 *     `^#{1,2} ` heading (same or higher level) or end of file.
 *   - Body is trimmed; runs of blank lines collapse to one.
 *   - Multiple matching headings: only the first is read.
 *   - Returns empty string when no matching heading is found.
 */

import { SUMMARY_HEADINGS } from './constants';

const HEADING_LEVEL_1_OR_2 = /^#{1,2}\s+\S/;

/** Match `## Summary` / `## 摘要` exactly. */
function isSummaryHeading(line: string): boolean {
  // Must start with exactly two `#` followed by exactly one space
  if (!line.startsWith('## ')) return false;
  const rest = line.slice(3); // after `## `
  // Reject anything with extra trailing content on the same line
  // Acceptable: rest is exactly `Summary` or `摘要`
  return (SUMMARY_HEADINGS as readonly string[]).includes(rest);
}

/**
 * Extract the summary body from a markdown source.
 *
 * @param source full file source, with or without frontmatter
 * @returns trimmed summary body (empty string if absent)
 */
export function extractSummary(source: string): string {
  // Normalize CRLF → LF so line splitting is consistent cross-platform
  const normalized = source.replace(/\r\n/g, '\n');
  const lines = normalized.split('\n');

  // Find the first Summary heading
  let headingIdx = -1;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    if (isSummaryHeading(line)) {
      headingIdx = i;
      break;
    }
  }
  if (headingIdx === -1) return '';

  // Collect body until next level-1 or level-2 heading, or EOF
  const body: string[] = [];
  for (let j = headingIdx + 1; j < lines.length; j++) {
    const line = lines[j]!;
    if (HEADING_LEVEL_1_OR_2.test(line)) break;
    body.push(line);
  }

  // Trim + collapse runs of blank lines
  const collapsed = body
    .join('\n')
    .replace(/\n{3,}/g, '\n\n') // 3+ newlines → 2 (one blank line)
    .trim();
  return collapsed;
}
