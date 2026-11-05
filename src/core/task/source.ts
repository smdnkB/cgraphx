/**
 * 外部任务接口(spec §3.3 配置、§4 接口契约)。
 *
 * 配置文件 `task-source.json`:不存在 → 未配置接口;存在但非法 → TaskConfigError。
 * 配置文件在数据位置(data-location.ts):旧库模式在本地 `.cgraphx/`,其余在用户目录里这个项目的目录;
 * 读的一方拿不到数据位置按未配置接口,写的一方经 ensureDataDir。
 * 拉取:`GET <url>` 附带 headers,AbortController 超时;失败一律 TaskSourceUnavailableError。
 */

import fs from 'node:fs';
import path from 'node:path';

import { ensureDataDir, getDataDir, locateData, missingDataMessage } from '../data-location';
import { TASK_SOURCE_CONFIG_FILENAME, TASK_SOURCE_TIMEOUT_MS } from './constants';
import { TaskConfigError, TaskSourceUnavailableError } from './errors';
import type { RemoteTask, TaskSourceConfig } from './types';

/** 配置文件绝对路径;拿不到数据位置(没有根、认不出项目、项目在本机还没有数据)→ null。start 是起点。 */
export function getTaskSourceConfigPath(start: string): string | null {
  const dir = getDataDir(start);
  return dir === null ? null : path.join(dir, TASK_SOURCE_CONFIG_FILENAME);
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/**
 * 读取外部接口配置。拿不到数据位置、文件不存在返回 null。
 *
 * @throws TaskConfigError JSON 非法、`url` 不是非空字符串、`headers` 不是 string→string 对象。
 */
export function loadTaskSourceConfig(start: string): TaskSourceConfig | null {
  const file = getTaskSourceConfigPath(start);
  if (file === null) return null;
  let text: string;
  try {
    text = fs.readFileSync(file, 'utf-8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException)?.code === 'ENOENT') return null;
    throw new TaskConfigError(
      `无法读取任务接口配置 ${file}:${err instanceof Error ? err.message : String(err)}`,
      { cause: err },
    );
  }

  const fail = (problem: string): never => {
    throw new TaskConfigError(
      `任务接口配置 ${file} 非法:${problem}。按 {"url": "https://…", "headers": {"Authorization": "…"}} 修正,` +
        '或删除该文件改为未配置接口',
    );
  };

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (err) {
    return fail(`不是合法 JSON(${err instanceof Error ? err.message : String(err)})`);
  }
  if (!isPlainObject(parsed)) return fail('顶层必须是 JSON 对象');

  const url = parsed.url;
  if (typeof url !== 'string' || url.trim() === '') return fail('`url` 必须是非空字符串');

  const headers: Record<string, string> = {};
  if (parsed.headers !== undefined) {
    if (!isPlainObject(parsed.headers)) return fail('`headers` 必须是对象');
    for (const [k, v] of Object.entries(parsed.headers)) {
      if (typeof v !== 'string') return fail(`\`headers.${k}\` 必须是字符串`);
      headers[k] = v;
    }
  }

  return { url: url.trim(), headers };
}

/**
 * 写入任务源配置 `{"url":…,"headers":{…}}`(2 空格缩进 + 换行),文件权限 0o600。目录 = 写数据的入口
 * ensureDataDir(根装过的项目库模式下项目目录不在就建;没装过的目录只写进已有的项目目录)。
 *
 * @throws TaskConfigError 拿不到数据位置(没有根、认不出项目、没装过的目录项目在本机还没有数据)或写入失败。
 */
export function writeTaskSourceConfig(start: string, config: TaskSourceConfig): void {
  const dir = ensureDataDir(start);
  if (dir === null) {
    throw new TaskConfigError(missingDataMessage(locateData(start)));
  }
  const file = path.join(dir, TASK_SOURCE_CONFIG_FILENAME);
  const text = JSON.stringify({ url: config.url, headers: config.headers }, null, 2) + '\n';
  try {
    fs.writeFileSync(file, text, { encoding: 'utf-8', mode: 0o600 });
    // 文件已存在时 writeFileSync 不改权限,显式收紧
    fs.chmodSync(file, 0o600);
  } catch (err) {
    throw new TaskConfigError(
      `无法写入任务接口配置 ${file}:${err instanceof Error ? err.message : String(err)}`,
      { cause: err },
    );
  }
}

/** 删除任务源配置;拿不到数据位置、文件不存在返回 false。 */
export function removeTaskSourceConfig(start: string): boolean {
  const file = getTaskSourceConfigPath(start);
  if (file === null) return false;
  try {
    fs.unlinkSync(file);
    return true;
  } catch (err) {
    if ((err as NodeJS.ErrnoException)?.code === 'ENOENT') return false;
    throw new TaskConfigError(
      `无法删除任务接口配置 ${file}:${err instanceof Error ? err.message : String(err)}`,
      { cause: err },
    );
  }
}

function nonEmptyString(v: unknown): v is string {
  return typeof v === 'string' && v.trim() !== '';
}

function optionalString(v: unknown): string | null {
  return typeof v === 'string' && v !== '' ? v : null;
}

/**
 * 拉取「我名下」的任务。缺 `id` / `name`(非空字符串)的条目跳过并计入 skipped。
 *
 * @throws TaskSourceUnavailableError 非 2xx、超时、网络失败、body 不是 `{tasks: [...]}`。
 */
export async function fetchRemoteTasks(
  config: TaskSourceConfig,
): Promise<{ tasks: RemoteTask[]; skipped: number }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TASK_SOURCE_TIMEOUT_MS);
  let text: string;
  try {
    let resp: Response;
    try {
      resp = await fetch(config.url, {
        method: 'GET',
        headers: config.headers,
        signal: controller.signal,
      });
    } catch (err) {
      if ((err as Error)?.name === 'AbortError') {
        throw new TaskSourceUnavailableError(`请求超时(${TASK_SOURCE_TIMEOUT_MS / 1000} 秒)`, {
          cause: err,
        });
      }
      throw new TaskSourceUnavailableError(
        `请求失败(${err instanceof Error ? err.message : String(err)})`,
        { cause: err },
      );
    }
    if (!resp.ok) {
      throw new TaskSourceUnavailableError(`HTTP ${resp.status}${resp.statusText ? ` ${resp.statusText}` : ''}`);
    }
    try {
      text = await resp.text();
    } catch (err) {
      const reason = (err as Error)?.name === 'AbortError'
        ? `读取响应超时(${TASK_SOURCE_TIMEOUT_MS / 1000} 秒)`
        : `读取响应失败(${err instanceof Error ? err.message : String(err)})`;
      throw new TaskSourceUnavailableError(reason, { cause: err });
    }
  } finally {
    clearTimeout(timer);
  }

  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    throw new TaskSourceUnavailableError('响应不是合法 JSON');
  }
  if (!isPlainObject(body) || !Array.isArray(body.tasks)) {
    throw new TaskSourceUnavailableError('响应 body 不是 {"tasks": [...]}');
  }

  const tasks: RemoteTask[] = [];
  let skipped = 0;
  for (const item of body.tasks) {
    if (!isPlainObject(item) || !nonEmptyString(item.id) || !nonEmptyString(item.name)) {
      skipped += 1;
      continue;
    }
    tasks.push({
      id: item.id,
      name: item.name,
      url: optionalString(item.url),
      status: optionalString(item.status),
      raw: item,
    });
  }
  return { tasks, skipped };
}
