/**
 * 读取器分发与会话文件列举(ingest 内部组织,D1)。
 *
 * 分发按 agents 描述的 sessionReader 标识(C-7);会话文件根目录本身由调用方
 * (T-3 补录管线)经 agents 门面的 agentSessionsRoot 取,本模块不感知。
 * 列举规则(D3,布局实测见两个读取器头注释):sessionsRoot 下每个项目目录里的
 * `*.jsonl` 主会话文件,加各会话目录 subagents/ 下(含 workflows/ 嵌套)的全部
 * `*.jsonl` 子 agent 文件;项目目录名是路径有损编码(D3 没选只扫编码目录的原因),
 * 归属判定不看目录名,只看文件行内 cwd,因此这里不做任何目录名反解。
 * 返回按路径升序——同一会话的主文件排在它 subagents/ 下的文件前面。
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import type { SessionReaderId } from '../../agents';
import { readClaudeSessionFacts } from './claude-transcript';
import { readCodebuddySessionFacts } from './codebuddy-transcript';
import type { SessionFactsReader } from './types';

/** 读取器标识 → 读取器实现;接新 agent = agents 描述加一个标识 + 这里登记一个读取器。 */
const READERS: Readonly<Record<SessionReaderId, SessionFactsReader>> = {
  'claude-transcript': readClaudeSessionFacts,
  'codebuddy-transcript': readCodebuddySessionFacts,
};

/** 按 agents 描述的 sessionReader 标识取读取器;未登记的标识抛错。 */
export function sessionFactsReader(readerId: SessionReaderId): SessionFactsReader {
  const reader = READERS[readerId];
  if (reader === undefined) throw new Error(`未知会话文件读取器: ${readerId}`);
  return reader;
}

/** 递归列出目录下全部 .jsonl(subagents/ 里还有 workflows/ 一层嵌套布局)。 */
function listJsonlRecursive(dir: string, out: string[]): void {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return; // 目录不在 / 不可读:跳过
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) listJsonlRecursive(full, out);
    else if (entry.isFile() && entry.name.endsWith('.jsonl')) out.push(full);
  }
}

/**
 * 列出某个 sessionsRoot 下全部会话文件(绝对路径,升序)。
 * 根目录不存在(agent 没装 / 没开过会话)返回空数组,不抛错。
 */
export function listSessionFiles(sessionsRoot: string): string[] {
  const out: string[] = [];
  let projects: fs.Dirent[];
  try {
    projects = fs.readdirSync(sessionsRoot, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const project of projects) {
    if (!project.isDirectory()) continue; // .DS_Store 等杂项不进
    const projectDir = path.join(sessionsRoot, project.name);
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(projectDir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (entry.isFile() && entry.name.endsWith('.jsonl')) {
        out.push(path.join(projectDir, entry.name)); // 主会话文件
      } else if (entry.isDirectory()) {
        const subagentsDir = path.join(projectDir, entry.name, 'subagents');
        if (fs.existsSync(subagentsDir)) listJsonlRecursive(subagentsDir, out);
      }
    }
  }
  out.sort();
  return out;
}
