/**
 * `cgraphx features check [目标...]`:校验新产物的头部与首屏。
 *
 * 每次实时计算,不写任何文件。校验口径由产物注册表驱动:
 * 新增类型只要登记,不需要改本模块的校验逻辑。
 */

import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';

import {
  FEATURES_DIR_POSIX,
  TASK_VALUE_PATTERN,
  basisMatches,
  classifyArtifactByPath,
  featureIdOf,
  firstScreenHeadingOf,
  getBuiltinArtifactType,
  identifyArtifact,
  isValidArtifactTypeKey,
  parseBasis,
  readArtifactHeader,
  readFirstH2Heading,
  specFingerprint,
} from '../artifact-registry';
import { CheckTargetNotFoundError } from './errors';
import { FEATURES_DIR, findMainSpecRel, isPlainFeatureId } from './scanner';
import { gitUserName } from './sync';
import type { CheckFinding, CheckReport } from './types';

/** checkFeatures 的可选项。 */
export interface CheckOptions {
  /** 本项目类型表(平台缓存);null / 未提供时只按内置类型判未知类型。 */
  projectTypes?: readonly string[] | null;
}

interface FeatureMeta {
  mainSpec: string | null;
  fingerprint: string | null;
}

/** 项目相对 POSIX 路径 → 绝对路径。 */
function absolutePath(projectRoot: string, projectRelPath: string): string {
  return path.join(projectRoot, ...projectRelPath.split('/'));
}

/** 绝对路径 → 项目相对 POSIX 路径。 */
function toProjectRel(projectRoot: string, absPath: string): string {
  return path.relative(projectRoot, absPath).split(path.sep).join('/');
}

/** 路径是否位于产出目录(含目录本身)。 */
function isInsideFeaturesTree(projectRelPath: string): boolean {
  return (
    projectRelPath === FEATURES_DIR_POSIX ||
    projectRelPath.startsWith(`${FEATURES_DIR_POSIX}/`)
  );
}

function isDirectory(absPath: string): boolean {
  try {
    return fs.statSync(absPath).isDirectory();
  } catch {
    return false;
  }
}

/** 递归列出目录下的普通文件(不跟随符号链接)。 */
function walkFiles(absDir: string): string[] {
  const files: string[] = [];
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(absDir, { withFileTypes: true });
  } catch {
    return files;
  }
  for (const entry of entries) {
    const absPath = path.join(absDir, entry.name);
    if (entry.isDirectory()) {
      files.push(...walkFiles(absPath));
    } else if (entry.isFile()) {
      files.push(absPath);
    }
  }
  return files;
}

/** 采集一个目录下属于产出目录的文件(项目相对 POSIX 路径)。 */
function collectFeatureTreeFiles(
  projectRoot: string,
  absDir: string,
): string[] {
  return walkFiles(absDir)
    .map((absPath) => toProjectRel(projectRoot, absPath))
    .filter((projectRelPath) => featureIdOf(projectRelPath) !== null);
}

/** 解析单个目标为文件集合;目标不存在抛 CheckTargetNotFoundError。 */
function collectTargetFiles(projectRoot: string, target: string): string[] {
  // 先按 feature-id 解释:docs/features/<目标> 是目录 → 该目录全部文件。
  if (isPlainFeatureId(target)) {
    const featureDir = path.join(projectRoot, FEATURES_DIR, target);
    if (isDirectory(featureDir)) {
      return collectFeatureTreeFiles(projectRoot, featureDir);
    }
  }

  // 否则按路径解释:相对路径基于当前工作目录。
  const absPath = path.resolve(process.cwd(), target);
  let stat: fs.Stats;
  try {
    stat = fs.statSync(absPath);
  } catch {
    throw new CheckTargetNotFoundError(target);
  }

  if (stat.isDirectory()) {
    const projectRelPath = toProjectRel(projectRoot, absPath);
    if (!isInsideFeaturesTree(projectRelPath)) return [];
    return collectFeatureTreeFiles(projectRoot, absPath);
  }

  if (!stat.isFile()) return [];
  const projectRelPath = toProjectRel(projectRoot, absPath);
  return featureIdOf(projectRelPath) === null
    ? []
    : [projectRelPath];
}

/** 目标列表 → 待校验文件集(去重、升序)。targets 为空 → 全部产出目录。 */
function collectFiles(projectRoot: string, targets: string[]): string[] {
  if (targets.length === 0) {
    let dirNames: string[] = [];
    try {
      dirNames = fs
        .readdirSync(path.join(projectRoot, FEATURES_DIR), {
          withFileTypes: true,
        })
        .filter((entry) => entry.isDirectory())
        .map((entry) => entry.name);
    } catch {
      return [];
    }
    const files = new Set<string>();
    for (const name of dirNames) {
      for (const rel of collectFeatureTreeFiles(
        projectRoot,
        path.join(projectRoot, FEATURES_DIR, name),
      )) {
        files.add(rel);
      }
    }
    return Array.from(files).sort();
  }

  const files = new Set<string>();
  for (const target of targets) {
    for (const rel of collectTargetFiles(projectRoot, target)) {
      files.add(rel);
    }
  }
  return Array.from(files).sort();
}

/**
 * HEAD 里 docs/features/ 下的文件集。
 * 不在 git 仓库 → null;仓库里还没有任何提交 → 空集。
 */
function readHeadFiles(projectRoot: string): Set<string> | null {
  try {
    const inside = execFileSync('git', ['rev-parse', '--is-inside-work-tree'], {
      cwd: projectRoot,
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: 5000,
    }).trim();
    if (inside !== 'true') return null;
  } catch {
    return null;
  }

  try {
    // -z 防止中文路径被转义;输出即项目相对路径。
    const output = execFileSync(
      'git',
      ['ls-tree', '-r', '-z', '--name-only', 'HEAD', '--', FEATURES_DIR_POSIX],
      {
        cwd: projectRoot,
        encoding: 'utf-8',
        stdio: ['ignore', 'pipe', 'ignore'],
        timeout: 10000,
        maxBuffer: 16 * 1024 * 1024,
      },
    );
    return new Set(output.split('\0').filter((rel) => rel !== ''));
  } catch {
    // 还没有任何提交(HEAD 不存在)等:按空集处理。
    return new Set();
  }
}

/** 需求目录的主 spec 与当前指纹(按目录缓存)。 */
function featureMeta(
  projectRoot: string,
  featureId: string,
  cache: Map<string, FeatureMeta>,
): FeatureMeta {
  const hit = cache.get(featureId);
  if (hit !== undefined) return hit;
  const mainSpec = findMainSpecRel(projectRoot, featureId);
  const fingerprint =
    mainSpec === null ? null : specFingerprint(projectRoot, mainSpec);
  const meta: FeatureMeta = { mainSpec, fingerprint };
  cache.set(featureId, meta);
  return meta;
}

/**
 * 校验新产物的头部与首屏(spec §9)。
 *
 * 目标为空时校验全部产出目录;目标可以是 feature-id 或路径。
 * 结果按路径升序,同一路径失败在警告之前。
 */
export function checkFeatures(
  projectRoot: string,
  targets: string[],
  opts: CheckOptions = {},
): CheckReport {
  const files = collectFiles(projectRoot, targets);
  const headSet = readHeadFiles(projectRoot);
  const projectTypes = opts.projectTypes ?? null;
  const metaCache = new Map<string, FeatureMeta>();

  let gitUser: string | null | undefined;
  const ownerNameForFix = (): string => {
    if (gitUser === undefined) {
      gitUser = gitUserName();
    }
    return gitUser ?? '<你的 git user.name>';
  };

  const findings: CheckFinding[] = [];
  let checkedFiles = 0;

  for (const projectRelPath of files) {
    const ext = path.posix.extname(projectRelPath).toLowerCase();
    if (ext !== '.md' && ext !== '.html') continue;

    const absPath = absolutePath(projectRoot, projectRelPath);
    const identity = identifyArtifact(projectRoot, projectRelPath);
    const header = identity?.header ?? readArtifactHeader(absPath);
    const typeRaw = header?.typeRaw ?? null;
    const isNew = headSet !== null && !headSet.has(projectRelPath);

    // 不是产物,或 HEAD 里已有的旧产物(不查)整体跳过。
    if (identity === null && typeRaw === null) continue;
    if (!isNew && typeRaw === null) continue;

    checkedFiles += 1;

    const featureId = featureIdOf(projectRelPath);
    const meta =
      featureId === null
        ? { mainSpec: null, fingerprint: null }
        : featureMeta(projectRoot, featureId, metaCache);
    const isMain = meta.mainSpec === projectRelPath;
    const fp7 = meta.fingerprint === null ? null : meta.fingerprint.slice(0, 7);
    const pathType = classifyArtifactByPath(projectRelPath);

    const fail = (
      code: CheckFinding['code'],
      message: string,
      fix: string,
    ): void => {
      findings.push({
        level: 'fail',
        path: projectRelPath,
        code,
        message,
        fix,
      });
    };
    const warn = (
      code: CheckFinding['code'],
      message: string,
      fix: string,
    ): void => {
      findings.push({
        level: 'warn',
        path: projectRelPath,
        code,
        message,
        fix,
      });
    };

    const invalidTypeFix =
      pathType === null
        ? '改为由小写字母、数字、下划线组成的类型标识'
        : `改为 \`> 产物: ${pathType}\``;

    if (isNew) {
      // ─── 新产物:头部字段与首屏(spec §9) ─────────────────────────────────
      if (typeRaw === null) {
        if (identity !== null) {
          fail(
            'missing_type',
            '缺少 `> 产物:`',
            `补 \`> 产物: ${identity.type}\``,
          );
        }
      } else if (!isValidArtifactTypeKey(typeRaw)) {
        fail(
          'invalid_type',
          `\`> 产物:\` 的值不合法:${typeRaw}`,
          invalidTypeFix,
        );
      }

      if (
        (isMain || identity?.type === 'handoff') &&
        (header?.owner ?? null) === null
      ) {
        fail(
          'missing_owner',
          '缺少 `> 负责人:`',
          `补 \`> 负责人: ${ownerNameForFix()}\``,
        );
      }

      const builtin =
        identity === null ? undefined : getBuiltinArtifactType(identity.type);
      if (
        builtin !== undefined &&
        builtin.requiresBasis &&
        meta.mainSpec !== null
      ) {
        const basisFix = `依据改为 \`spec@${fp7 ?? '<主 spec 指纹>'}\``;
        if (header?.basis == null) {
          fail(
            'missing_basis',
            '缺少 `> 依据:`',
            `补 \`> 依据: spec@${fp7 ?? '<主 spec 指纹>'}\``,
          );
        } else if (parseBasis(header.basis) === null) {
          fail(
            'invalid_basis',
            `\`> 依据:\` 格式不对:${header.basis}`,
            basisFix,
          );
        }
      }

      if (
        isMain &&
        header?.task != null &&
        !TASK_VALUE_PATTERN.test(header.task)
      ) {
        fail(
          'invalid_task',
          `\`> 任务:\` 不是平台任务编号:${header.task}`,
          '改为平台任务编号 `T-<n>`;不关联平台任务就删掉这一行',
        );
      }

      if (identity !== null) {
        const heading = firstScreenHeadingOf(identity, projectRelPath);
        if (heading !== null && readFirstH2Heading(absPath) !== heading) {
          fail(
            'first_screen',
            `首个二级标题不是「${heading}」`,
            `首个二级标题改为「${heading}」`,
          );
        }
      }
    } else if (typeRaw !== null) {
      // ─── HEAD 里已有、带 `> 产物:` 的文件:只查已写字段格式 ─────────────
      if (!isValidArtifactTypeKey(typeRaw)) {
        fail(
          'invalid_type',
          `\`> 产物:\` 的值不合法:${typeRaw}`,
          invalidTypeFix,
        );
      }
      if (header?.basis != null && parseBasis(header.basis) === null) {
        fail(
          'invalid_basis',
          `\`> 依据:\` 格式不对:${header.basis}`,
          `依据改为 \`spec@${fp7 ?? '<主 spec 指纹>'}\``,
        );
      }
      if (
        isMain &&
        header?.task != null &&
        !TASK_VALUE_PATTERN.test(header.task)
      ) {
        fail(
          'invalid_task',
          `\`> 任务:\` 不是平台任务编号:${header.task}`,
          '改为平台任务编号 `T-<n>`;不关联平台任务就删掉这一行',
        );
      }
    }

    // ─── 警告:过期 / 未知类型 / 头部与路径不一致 ──────────────────────────
    // 不在 git 仓库时无法区分新旧,只查字段格式,不出警告。
    if (headSet !== null && typeRaw !== null) {
      if (
        header !== null &&
        header.basis !== null &&
        meta.mainSpec !== null &&
        meta.fingerprint !== null
      ) {
        const recorded = parseBasis(header.basis);
        if (recorded !== null && !basisMatches(recorded, meta.fingerprint)) {
          warn(
            'stale',
            `过期:spec 已变(${recorded.slice(0, 7)} → ${fp7 ?? '?'})`,
            `复核后依据改为 \`spec@${fp7 ?? '<主 spec 指纹>'}\``,
          );
        }
      }

      if (identity !== null && identity.via === 'header' && !identity.builtin) {
        const inProjectTypes =
          projectTypes !== null && projectTypes.includes(identity.type);
        if (!inProjectTypes) {
          warn(
            'unknown_type',
            `未知类型 ${identity.type}:不是内置类型` +
              (projectTypes !== null ? ',也不在本项目类型表' : ''),
            `改用内置类型标识;确需自定义类型,请项目管理员在平台配置 \`${identity.type}\``,
          );
        }
      }

      if (
        identity !== null &&
        identity.via === 'header' &&
        pathType !== null &&
        pathType !== identity.type
      ) {
        warn(
          'type_path_mismatch',
          `头部类型 ${identity.type} 与文件名规则(${pathType})不一致`,
          `确认类型;应为 \`${pathType}\` 时改为 \`> 产物: ${pathType}\``,
        );
      }
    }
  }

  findings.sort((a, b) => {
    if (a.path !== b.path) return a.path < b.path ? -1 : 1;
    if (a.level === b.level) return 0;
    return a.level === 'fail' ? -1 : 1;
  });

  const failures = findings.filter((item) => item.level === 'fail').length;
  const warnings = findings.filter((item) => item.level === 'warn').length;
  return {
    ok: failures === 0,
    checkedFiles,
    failures,
    warnings,
    findings,
  };
}
