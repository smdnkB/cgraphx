/**
 * `cgraphx features show <feature-id>`:一个产出目录的全貌。
 *
 * 每次实时计算,不写任何文件。产物识别与依据判定全部经产物注册表,
 * 本模块只做聚合与展示所需的派生。
 */

import * as fs from 'node:fs';
import * as path from 'node:path';

import {
  FEATURES_DIR_POSIX,
  basisMatches,
  getBuiltinArtifactType,
  identifyArtifact,
  parseBasis,
  specFingerprint,
} from '../artifact-registry';
import type { ArtifactHeader } from '../artifact-registry';
import { FeatureAmbiguousError, FeatureNotFoundError } from './errors';
import {
  FEATURES_DIR,
  deriveFeatureStage,
  findMainSpecRel,
  listFeatureFiles,
  readFeatureOwner,
  readFeatureTask,
} from './scanner';
import type {
  BasisState,
  FeatureArtifactRow,
  FeatureDetail,
  FeaturePhase,
  FeaturePhaseRow,
} from './types';

/** 平台环节行(顺序即展示顺序);knowledge 只进产物列表、不进环节。 */
const PHASE_DEFS: ReadonlyArray<{
  phase: FeaturePhase;
  name: string;
  required: boolean;
}> = [
  { phase: 'design', name: '设计', required: true },
  { phase: 'plan', name: '规划', required: false },
  { phase: 'test', name: '测试', required: true },
  { phase: 'release', name: '发布', required: false },
  { phase: 'delivery', name: '交付文档', required: false },
];

const PHASE_SET: ReadonlySet<string> = new Set(
  PHASE_DEFS.map((def) => def.phase),
);

function isFeaturePhase(phase: string): phase is FeaturePhase {
  return PHASE_SET.has(phase);
}

/**
 * 解析用户传入的 feature-id:先精确匹配目录名,再按子串匹配。
 * 无命中抛 FeatureNotFoundError,多命中抛 FeatureAmbiguousError(候选升序)。
 */
export function resolveFeatureId(projectRoot: string, query: string): string {
  let dirNames: string[] = [];
  try {
    dirNames = fs
      .readdirSync(path.join(projectRoot, FEATURES_DIR), { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name);
  } catch {
    dirNames = [];
  }

  if (dirNames.includes(query)) {
    return query;
  }

  const matches = dirNames.filter((name) => name.includes(query)).sort();
  if (matches.length === 0) {
    throw new FeatureNotFoundError(query);
  }
  if (matches.length > 1) {
    throw new FeatureAmbiguousError(query, matches);
  }
  const only = matches[0];
  if (only === undefined) {
    throw new FeatureNotFoundError(query);
  }
  return only;
}

/** 单条产物的依据状态(spec §6.2);旧产物(没有 `> 产物:`)不参与判定。 */
function basisStateOf(
  header: ArtifactHeader | null,
  fingerprint: string | null,
): BasisState {
  if (header === null || header.typeRaw === null || header.basis === null) {
    return { kind: 'none' };
  }
  const recorded = parseBasis(header.basis);
  if (recorded === null) {
    return { kind: 'invalid' };
  }
  if (fingerprint === null) {
    return { kind: 'no_main_spec' };
  }
  if (basisMatches(recorded, fingerprint)) {
    return { kind: 'fresh' };
  }
  return {
    kind: 'stale',
    recorded: recorded.slice(0, 7),
    current: fingerprint.slice(0, 7),
  };
}

/** 一个产出目录的全貌(文本输出与 --json 同源)。 */
export function showFeature(projectRoot: string, query: string): FeatureDetail {
  const featureId = resolveFeatureId(projectRoot, query);
  const files = listFeatureFiles(projectRoot, featureId);
  const mainSpecRel = findMainSpecRel(projectRoot, featureId);
  const fingerprint =
    mainSpecRel === null ? null : specFingerprint(projectRoot, mainSpecRel);

  const featureDirPosix = `${FEATURES_DIR_POSIX}/${featureId}`;
  const innerPathOf = (projectRelPath: string): string =>
    path.posix.relative(featureDirPosix, projectRelPath);

  const artifacts: FeatureArtifactRow[] = [];
  const otherFiles: string[] = [];
  const phasePaths = new Map<FeaturePhase, string[]>();
  const customTypes = new Map<string, string[]>();

  for (const projectRelPath of files) {
    const innerPath = innerPathOf(projectRelPath);
    const identity = identifyArtifact(projectRoot, projectRelPath);
    if (identity === null) {
      otherFiles.push(innerPath);
      continue;
    }

    const builtin = getBuiltinArtifactType(identity.type);
    artifacts.push({
      path: innerPath,
      type: identity.type,
      typeName: builtin?.name ?? null,
      via: identity.via,
      basis: basisStateOf(identity.header, fingerprint),
    });

    if (builtin === undefined) {
      const paths = customTypes.get(identity.type);
      if (paths === undefined) {
        customTypes.set(identity.type, [innerPath]);
      } else {
        paths.push(innerPath);
      }
      continue;
    }

    // 本地专用类型(handoff)与 knowledge 类不进五个平台环节。
    if (
      builtin.minTier !== null &&
      builtin.defaultPhase !== null &&
      isFeaturePhase(builtin.defaultPhase)
    ) {
      const paths = phasePaths.get(builtin.defaultPhase);
      if (paths === undefined) {
        phasePaths.set(builtin.defaultPhase, [innerPath]);
      } else {
        paths.push(innerPath);
      }
    }
  }

  const phases: FeaturePhaseRow[] = PHASE_DEFS.map((def) => ({
    phase: def.phase,
    name: def.name,
    paths: phasePaths.get(def.phase) ?? [],
    required: def.required,
  }));

  return {
    featureId,
    path: featureDirPosix,
    owner: readFeatureOwner(projectRoot, featureId),
    task: readFeatureTask(projectRoot, featureId),
    stage: deriveFeatureStage(projectRoot, featureId),
    mainSpec: mainSpecRel === null ? null : innerPathOf(mainSpecRel),
    specFingerprint: fingerprint === null ? null : fingerprint.slice(0, 7),
    artifacts,
    phases,
    customTypes: Array.from(customTypes, ([type, paths]) => ({ type, paths })),
    otherFiles,
  };
}
