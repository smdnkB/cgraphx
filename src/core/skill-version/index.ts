/**
 * skill-version 门面:各 agent 配置目录里的版本记录(spec D1),以及会话开始时的落后提示(spec D5–D8)。
 *
 * 调用方:task / timeline 的会话开始 hook 读记录、出提示;cli 安装器写、删记录。
 * 只依赖 agents 门面,不依赖其它 core 子系统,也不依赖 cli / web(spec D9);
 * 项目根由调用方按各自的规则解析后传入。
 */

import * as fs from 'node:fs';
import * as path from 'node:path';

import { agentConfigDir, agentSettingsPath, type AgentProfile } from '../agents';
import {
  FIRST_RECORDED_VERSION,
  NOTICE_PREFIX,
  NOTICE_UPDATE_HINT,
  SILENT_SOURCES,
  SKILL_VERSION_FILE,
  TASK_SESSION_START_COMMAND,
} from './constants';
import { compareVersions, parseSemver } from './semver';

export { SKILL_VERSION_FILE } from './constants';
export { compareVersions, parseSemver, type Semver } from './semver';

let cachedCliVersion: string | null | undefined;

/**
 * 本机 cgraphx 的版本号:读包根 package.json(`src/core/skill-version/` 与 `dist/core/skill-version/`
 * 上溯三级都是包根,读法同 `sync/version.ts`)。读不到或不是合法版本号返回 null;进程内缓存。
 */
export function getCliVersion(): string | null {
  if (cachedCliVersion !== undefined) return cachedCliVersion;
  let version: string | null = null;
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '../../../package.json'), 'utf-8')) as {
      version?: unknown;
    };
    if (typeof pkg.version === 'string' && parseSemver(pkg.version) !== null) version = pkg.version;
  } catch {
    // 读不到按不可用处理:会话开始不提示,安装不写记录
  }
  cachedCliVersion = version;
  return version;
}

/** 版本记录的绝对路径:`<项目根>/<agent 配置目录>/cgraphx-version.json`。 */
export function skillVersionPath(projectRoot: string, profile: AgentProfile): string {
  return path.join(agentConfigDir(projectRoot, profile), SKILL_VERSION_FILE);
}

/** 读版本记录:文件不存在、不是合法 JSON、缺 version 字段或版本号不合法,一律返回 null(spec D4)。 */
export function readSkillVersion(projectRoot: string, profile: AgentProfile): string | null {
  try {
    const parsed: unknown = JSON.parse(fs.readFileSync(skillVersionPath(projectRoot, profile), 'utf-8'));
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
    const version = (parsed as { version?: unknown }).version;
    return typeof version === 'string' && parseSemver(version) !== null ? version : null;
  } catch {
    return null;
  }
}

/** 写版本记录,内容只有 version 一个字段;内容不变时不重写。写失败直接抛错,由安装器按该 agent 安装失败处理。 */
export function writeSkillVersion(projectRoot: string, profile: AgentProfile, version: string): void {
  const file = skillVersionPath(projectRoot, profile);
  const content = JSON.stringify({ version }, null, 2) + '\n';
  try {
    if (fs.readFileSync(file, 'utf-8') === content) return;
  } catch {
    // 不存在或读不出:直接写
  }
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content, 'utf-8');
}

/** 删除版本记录;返回是否真的删了(不存在返回 false)。 */
export function removeSkillVersion(projectRoot: string, profile: AgentProfile): boolean {
  const file = skillVersionPath(projectRoot, profile);
  if (!fs.existsSync(file)) return false;
  fs.rmSync(file, { force: true });
  return true;
}

/**
 * 会话开始时的落后提示(spec F1、D5–D8):返回提示行;不需要提示或检查中任何异常都返回 null。
 *
 * @param source 宿主给的会话开始类型(startup / resume / clear / compact);缺失按 startup。
 */
export function skillVersionNotice(projectRoot: string, profile: AgentProfile, source: string | undefined): string | null {
  try {
    if (source !== undefined && SILENT_SOURCES.has(source)) return null;
    const cli = getCliVersion();
    if (cli === null) return null;
    const recorded = readSkillVersion(projectRoot, profile);
    if (recorded === null) {
      return `${NOTICE_PREFIX}这个项目的 cgraphx skill 是 ${FIRST_RECORDED_VERSION} 之前装的,本机 cgraphx 已经是 ${cli}。${NOTICE_UPDATE_HINT}`;
    }
    if (compareVersions(recorded, cli) >= 0) return null;
    return `${NOTICE_PREFIX}这个项目的 cgraphx skill 还是 ${recorded},本机 cgraphx 已经是 ${cli}。${NOTICE_UPDATE_HINT}`;
  } catch {
    return null;
  }
}

/**
 * 该 agent 的 settings 里是否接了 task 的会话开始 hook(spec D6)。settings 读不出或不是 JSON 对象返回 null。
 * 按命令子串判断:命令末尾可能带 `--agent <id>` 与旧版二进制容错后缀。
 */
export function hasTaskSessionStartHook(projectRoot: string, profile: AgentProfile): boolean | null {
  let settings: unknown;
  try {
    settings = JSON.parse(fs.readFileSync(agentSettingsPath(projectRoot, profile), 'utf-8'));
  } catch {
    return null;
  }
  if (settings === null || typeof settings !== 'object' || Array.isArray(settings)) return null;
  const hooks = (settings as { hooks?: unknown }).hooks;
  if (hooks === null || typeof hooks !== 'object') return false;
  const groups = (hooks as { SessionStart?: unknown }).SessionStart;
  if (!Array.isArray(groups)) return false;
  return groups.some((group: unknown) => {
    const entries = group !== null && typeof group === 'object' ? (group as { hooks?: unknown }).hooks : undefined;
    return Array.isArray(entries) && entries.some((entry: unknown) => {
      const command = entry !== null && typeof entry === 'object' ? (entry as { command?: unknown }).command : undefined;
      return typeof command === 'string' && command.includes(TASK_SESSION_START_COMMAND);
    });
  });
}
