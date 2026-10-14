/**
 * 外部任务接口(spec §3.3 配置、§4 接口契约)。
 *
 * 配置文件 `.cgraphx/task-source.json`:不存在 → 未配置接口;存在但非法 → TaskConfigError。
 * 拉取:`GET <url>` 附带 headers,AbortController 超时;失败一律 TaskSourceUnavailableError。
 */

import fs from 'node:fs';
import path from 'node:path';

import { getCodeGraphDir } from '../directory';
import { TASK_SOURCE_CONFIG_FILENAME, TASK_SOURCE_TIMEOUT_MS } from './constants';
import { TaskConfigError, TaskSourceUnavailableError } from './errors';
import type { RemoteTask, TaskSourceConfig } from './types';

/** 配置文件绝对路径。 */
export function getTaskSourceConfigPath(projectRoot: string): string {
  return path.join(getCodeGraphDir(path.resolve(projectRoot)), TASK_SOURCE_CONFIG_FILENAME);
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/**
 * 读取外部接口配置。文件不存在返回 null。
 *
 * @throws TaskConfigError JSON 非法、`url` 不是非空字符串、`headers` 不是 string→string 对象。
 */
export function loadTaskSourceConfig(projectRoot: string): TaskSourceConfig | null {
  const file = getTaskSourceConfigPath(projectRoot);
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
