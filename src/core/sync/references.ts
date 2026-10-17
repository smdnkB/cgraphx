/**
 * 上报参考(spec §5.6):精确记录(主)+ 命令文本推断(辅),合并去重。
 *
 * 命令原文只在本模块内部用于推断,返回值只含沉淀目录文件路径与概念名,不出本机。
 * 口径与 `src/core/task/artifacts.ts` 的 collectReferences(本地 web)相互独立,不得互相引用。
 */

import fs from 'node:fs';
import path from 'node:path';

import { extractCommandPathCandidates, type TimelineEvent } from '../timeline';
import { SEDIMENT_DIRS } from './constants';
import { createPathResolver, isSafeRelPath, type PathResolver } from './paths';
import type { SyncContext } from './payload';
import type { IngestReference } from './types';

/** 项目相对路径是否位于沉淀目录(`SEDIMENT_DIRS` 唯一定义于 constants.ts)。 */
export function isSedimentPath(projectRel: string): boolean {
  return SEDIMENT_DIRS.some((d) => projectRel.startsWith(d));
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function argString(e: TimelineEvent, key: string): string | null {
  if (!isRecord(e.tool_args)) return null;
  const v = e.tool_args[key];
  return typeof v === 'string' && v !== '' ? v : null;
}

function isExistingFile(abs: string): boolean {
  try {
    return fs.statSync(abs).isFile();
  } catch {
    return false;
  }
}

/**
 * 从本会话命令记录推断读过的沉淀目录文件。只看 `post_tool_use`。
 *
 * @returns 项目相对路径 → 首见 ts。
 */
export function inferSedimentReads(ctx: SyncContext, events: TimelineEvent[]): Map<string, string> {
  return inferWithResolver(ctx, events, createPathResolver(ctx.projectRoot, ctx.repoRoot));
}

function inferWithResolver(ctx: SyncContext, events: TimelineEvent[], resolver: PathResolver): Map<string, string> {
  const reads = new Map<string, string>();
  /** 命中(或已记录)返回 true。 */
  const consider = (raw: string, base: string, ts: string): boolean => {
    const rel = resolver.fromAbs(raw, base);
    if (rel === null || !isSedimentPath(rel.projectRel)) return false;
    if (reads.has(rel.projectRel)) return true;
    if (!isExistingFile(path.join(ctx.projectRoot, rel.projectRel))) return false;
    reads.set(rel.projectRel, ts);
    return true;
  };

  for (const e of events) {
    if (e.event_type !== 'post_tool_use') continue;
    if (e.tool_name === 'Read') {
      const p = argString(e, 'file_path');
      if (p !== null) consider(p, e.cwd, e.ts);
    } else if (e.tool_name === 'Grep' || e.tool_name === 'Glob') {
      const p = argString(e, 'path');
      if (p !== null) consider(p, e.cwd, e.ts);
    } else if (e.tool_name === 'Bash') {
      const command = argString(e, 'command');
      if (command === null) continue;
      for (const { bases, token } of extractCommandPathCandidates(command, e.cwd)) {
        for (const base of bases) if (consider(token, base, e.ts)) break;
      }
    }
  }
  return reads;
}

function earlier(a: string, b: string): boolean {
  return Date.parse(a) < Date.parse(b);
}

/**
 * 本会话参考:精确记录 + 推断,排除本会话产出文件,按 (kind, value) 去重保留最早 ts。
 *
 * @param outputPaths 本会话产出候选的项目相对路径(映射前)。
 */
export function collectSessionReferences(
  ctx: SyncContext,
  sessionId: string,
  events: TimelineEvent[],
  outputPaths: Set<string>,
): IngestReference[] {
  const resolver = createPathResolver(ctx.projectRoot, ctx.repoRoot);
  const merged = new Map<string, IngestReference>();
  const add = (ref: IngestReference): void => {
    if (ref.kind === 'file' && !isSafeRelPath(ref.value)) return;
    const key = `${ref.kind}\0${ref.value}`;
    const prev = merged.get(key);
    if (prev === undefined || earlier(ref.ts, prev.ts)) merged.set(key, ref);
  };

  // 精确记录(主):取自上下文预载,不再开库
  for (const r of ctx.referenceRecords.get(sessionId) ?? []) {
    if (r.kind === 'concept') {
      add({ kind: 'concept', value: r.value, ts: r.ts });
      continue;
    }
    const rel = path.isAbsolute(r.value) ? resolver.fromAbs(r.value) : resolver.fromProjectRel(r.value);
    if (rel === null || !isSedimentPath(rel.projectRel) || outputPaths.has(rel.projectRel)) continue;
    add({ kind: 'file', value: rel.repoRel, ts: r.ts });
  }

  // 命令文本推断(辅)
  for (const [projectRel, ts] of inferWithResolver(ctx, events, resolver)) {
    if (outputPaths.has(projectRel)) continue;
    const rel = resolver.fromProjectRel(projectRel);
    if (rel === null) continue;
    add({ kind: 'file', value: rel.repoRel, ts });
  }

  return [...merged.values()];
}
