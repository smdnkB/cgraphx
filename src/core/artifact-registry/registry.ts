/**
 * 产物类型表、路径规则,以及依赖这两份口径的派生函数。
 *
 * 这是「文件 → 产物类型」的唯一定义处:路径规则按序匹配、先命中先用;
 * 其他子系统不得另写一份类型表或路径规则。
 */

import { extname } from 'node:path';
import {
  ARTIFACT_TYPE_KEY_PATTERN,
} from './constants';
import type {
  ArtifactIdentity,
  BuiltinArtifactType,
  ReportTier,
  StageMilestone,
} from './types';

/** 内置产物类型表(顺序即登记顺序)。 */
export const BUILTIN_ARTIFACT_TYPES: readonly BuiltinArtifactType[] = [
  {
    key: 'spec',
    name: '规格说明',
    defaultPhase: 'design',
    minTier: '1.0',
    requiresBasis: false,
    firstScreen: { heading: '一图看懂', planIndexOnly: false },
  },
  {
    key: 'wireframe',
    name: '线框',
    defaultPhase: 'design',
    minTier: '1.0',
    requiresBasis: false,
    firstScreen: null,
  },
  {
    key: 'prd',
    name: '需求文档',
    defaultPhase: 'design',
    minTier: '1.2',
    requiresBasis: true,
    firstScreen: null,
  },
  {
    key: 'design_doc',
    name: '设计文档',
    defaultPhase: 'design',
    minTier: '1.2',
    requiresBasis: true,
    firstScreen: null,
  },
  {
    key: 'plan',
    name: '实现计划',
    defaultPhase: 'plan',
    minTier: '1.0',
    requiresBasis: true,
    firstScreen: { heading: '设计预览', planIndexOnly: true },
  },
  {
    key: 'api_test_spec',
    name: '接口测试规格',
    defaultPhase: 'test',
    minTier: '1.0',
    requiresBasis: true,
    firstScreen: null,
  },
  {
    key: 'api_test_report',
    name: '接口测试报告',
    defaultPhase: 'test',
    minTier: '1.0',
    requiresBasis: true,
    firstScreen: null,
  },
  {
    key: 'unit_test_spec',
    name: '单元测试规格',
    defaultPhase: 'test',
    minTier: '1.0',
    requiresBasis: true,
    firstScreen: null,
  },
  {
    key: 'unit_test_report',
    name: '单元测试报告',
    defaultPhase: 'test',
    minTier: '1.0',
    requiresBasis: true,
    firstScreen: null,
  },
  {
    key: 'ui_test_spec',
    name: 'UI 测试用例规格',
    defaultPhase: 'test',
    minTier: '1.0',
    requiresBasis: true,
    firstScreen: null,
  },
  {
    key: 'ui_test_report',
    name: 'UI 测试报告',
    defaultPhase: 'test',
    minTier: '1.0',
    requiresBasis: true,
    firstScreen: null,
  },
  {
    key: 'release_record',
    name: '发布记录',
    defaultPhase: 'release',
    minTier: '1.3',
    requiresBasis: false,
    firstScreen: null,
  },
  {
    key: 'knowledge',
    name: '知识库',
    defaultPhase: 'knowledge',
    minTier: '1.0',
    requiresBasis: false,
    firstScreen: null,
  },
  {
    key: 'code_map',
    name: '代码地图',
    defaultPhase: 'knowledge',
    minTier: '1.0',
    requiresBasis: false,
    firstScreen: null,
  },
  {
    key: 'design_map',
    name: '设计地图',
    defaultPhase: 'knowledge',
    minTier: '1.0',
    requiresBasis: false,
    firstScreen: null,
  },
  {
    key: 'schema_knowledge',
    name: '表结构知识',
    defaultPhase: 'knowledge',
    minTier: '1.0',
    requiresBasis: false,
    firstScreen: null,
  },
  {
    key: 'delivery_brief',
    name: '交付讲解',
    defaultPhase: 'delivery',
    minTier: '1.2',
    requiresBasis: true,
    firstScreen: null,
  },
  {
    key: 'closure_record',
    name: '收口档案',
    defaultPhase: 'delivery',
    minTier: '1.2',
    requiresBasis: true,
    firstScreen: null,
  },
  {
    key: 'api_doc',
    name: '接口文档',
    defaultPhase: 'delivery',
    minTier: '1.2',
    requiresBasis: true,
    firstScreen: null,
  },
  {
    key: 'handoff',
    name: '交接文件',
    defaultPhase: null,
    minTier: null,
    requiresBasis: false,
    firstScreen: null,
  },
];

const BUILTIN_BY_KEY = new Map(
  BUILTIN_ARTIFACT_TYPES.map((type) => [type.key, type] as const),
);

/** 按类型标识查内置类型;不是内置类型返回 undefined。 */
export function getBuiltinArtifactType(
  key: string,
): BuiltinArtifactType | undefined {
  return BUILTIN_BY_KEY.get(key);
}

/** 类型标识是否合法(不要求是内置类型)。 */
export function isValidArtifactTypeKey(key: string): boolean {
  return ARTIFACT_TYPE_KEY_PATTERN.test(key);
}

/** 路径规则:类型标识 + 匹配正则(顺序即优先级)。 */
interface PathRule {
  type: string;
  pattern: RegExp;
}

const PATH_RULES: readonly PathRule[] = [
  {
    type: 'ui_test_spec',
    pattern: /^docs\/features\/[^/]+\/ui功能测试\/[^/]*-ui功能测试-spec\.md$/,
  },
  {
    type: 'ui_test_report',
    pattern: /^docs\/features\/[^/]+\/ui功能测试\/[^/]*-ui功能测试报告\.xlsx$/,
  },
  {
    type: 'ui_test_report',
    pattern: /^docs\/features\/[^/]+\/ui功能测试\/[^/]*-ui功能测试报告\.md$/,
  },
  {
    type: 'ui_test_report',
    pattern: /^docs\/features\/[^/]+\/ui功能测试\/[^/]*-ui功能测试结果\.json$/,
  },
  {
    type: 'api_test_spec',
    pattern: /^docs\/features\/[^/]+\/[^/]*-接口测试-spec\.md$/,
  },
  {
    type: 'api_test_spec',
    pattern: /^docs\/features\/[^/]+\/[^/]*-api-spec\.md$/,
  },
  {
    type: 'api_test_report',
    pattern: /^docs\/features\/[^/]+\/[^/]*-接口测试报告\.md$/,
  },
  {
    type: 'api_test_report',
    pattern: /^docs\/features\/[^/]+\/[^/]*-测试报告\.md$/,
  },
  {
    type: 'api_test_report',
    pattern: /^docs\/features\/[^/]+\/[^/]*-接口测试验证\.jsonl$/,
  },
  {
    type: 'unit_test_spec',
    pattern: /^docs\/features\/[^/]+\/[^/]*-单元测试-spec\.md$/,
  },
  {
    type: 'unit_test_report',
    pattern: /^docs\/features\/[^/]+\/[^/]*-单元测试报告\.md$/,
  },
  {
    type: 'spec',
    pattern: /^docs\/features\/[^/]+\/[^/]*-spec\.md$/,
  },
  {
    type: 'spec',
    pattern: /^docs\/features\/[^/]+\/spec\.md$/,
  },
  {
    type: 'plan',
    pattern: /^docs\/features\/[^/]+\/plan\/.+$/,
  },
  {
    type: 'wireframe',
    pattern: /^docs\/features\/[^/]+\/[^/]*-线框-v\d+\.html$/,
  },
  {
    type: 'prd',
    pattern: /^docs\/features\/[^/]+\/[^/]*-需求文档\.md$/,
  },
  {
    type: 'design_doc',
    pattern: /^docs\/features\/[^/]+\/[^/]*-设计文档\.md$/,
  },
  {
    type: 'design_doc',
    pattern: /^docs\/features\/[^/]+\/[^/]*-设计文档\.html$/,
  },
  {
    type: 'api_doc',
    pattern: /^docs\/features\/[^/]+\/[^/]*-接口文档\.html$/,
  },
  {
    type: 'delivery_brief',
    pattern: /^docs\/features\/[^/]+\/[^/]*-交付讲解\.md$/,
  },
  {
    type: 'closure_record',
    pattern: /^docs\/features\/[^/]+\/[^/]*-收口档案\.md$/,
  },
  {
    type: 'release_record',
    pattern: /^docs\/features\/[^/]+\/[^/]*-发布记录\.md$/,
  },
  {
    type: 'handoff',
    pattern: /^docs\/features\/[^/]+\/[^/]*-交接提示词\.md$/,
  },
  {
    type: 'knowledge',
    pattern: /^docs\/knowledge\/.+$/,
  },
  {
    type: 'code_map',
    pattern: /^docs\/code-map\/.+$/,
  },
  {
    type: 'design_map',
    pattern: /^docs\/design-map\/.+$/,
  },
  {
    type: 'schema_knowledge',
    pattern: /^docs\/schema-knowledge\/.+$/,
  },
];

const FEATURE_ID_PATTERN = /^docs\/features\/([^/]+)\/.+$/;
const TOP_LEVEL_FEATURE_FILE_PATTERN = /^docs\/features\/[^/]+\/[^/]+$/;
const PLAN_INDEX_PATTERN =
  /^docs\/features\/[^/]+\/plan\/(?:[^/]*-index|index)\.md$/;

/** 取所属需求目录名;不在 docs/features/<feature-id>/ 下返回 null。 */
export function featureIdOf(projectRelPath: string): string | null {
  const match = FEATURE_ID_PATTERN.exec(projectRelPath);
  if (match === null) {
    return null;
  }
  return match[1] ?? null;
}

/** 是否为需求目录顶层文件(不在子目录中)。 */
export function isTopLevelFeatureFile(projectRelPath: string): boolean {
  return TOP_LEVEL_FEATURE_FILE_PATTERN.test(projectRelPath);
}

/** 是否为 plan 目录的 index 文件(`*-index.md` 或 `index.md`)。 */
export function isPlanIndexPath(projectRelPath: string): boolean {
  return PLAN_INDEX_PATTERN.test(projectRelPath);
}

/** 按路径规则识别产物类型;都不命中返回 null。 */
export function classifyArtifactByPath(
  projectRelPath: string,
): string | null {
  for (const rule of PATH_RULES) {
    if (rule.pattern.test(projectRelPath)) {
      return rule.type;
    }
  }
  return null;
}

const REPORT_TYPES: ReadonlySet<string> = new Set([
  'api_test_report',
  'unit_test_report',
  'ui_test_report',
]);

const SPEC_LIKE_TYPES: ReadonlySet<string> = new Set([
  'spec',
  'api_test_spec',
  'unit_test_spec',
]);

/** 计入本地阶段里程碑的类型;不计入返回 null。 */
export function stageMilestoneOf(
  identity: ArtifactIdentity,
  projectRelPath: string,
): StageMilestone | null {
  const ext = extname(projectRelPath).toLowerCase();
  if (REPORT_TYPES.has(identity.type) && (ext === '.md' || ext === '.xlsx')) {
    return 'report';
  }
  if (identity.type === 'plan' && isPlanIndexPath(projectRelPath)) {
    return 'plan_index';
  }
  if (
    SPEC_LIKE_TYPES.has(identity.type) &&
    isTopLevelFeatureFile(projectRelPath)
  ) {
    return 'spec_like';
  }
  return null;
}

/** 首屏结论标题;该类型不要求首屏、或 plan 非 index 文件返回 null。 */
export function firstScreenHeadingOf(
  identity: ArtifactIdentity,
  projectRelPath: string,
): string | null {
  const firstScreen = getBuiltinArtifactType(identity.type)?.firstScreen ?? null;
  if (firstScreen === null) {
    return null;
  }
  if (firstScreen.planIndexOnly && !isPlanIndexPath(projectRelPath)) {
    return null;
  }
  return firstScreen.heading;
}

const TIER_RANK: Record<ReportTier, number> = {
  '1.0': 0,
  '1.2': 1,
  '1.3': 2,
};

/** 指定档位可上报的类型标识集合(本地专用类型不在其中)。 */
export function reportableTypeKeys(tier: ReportTier): ReadonlySet<string> {
  const rank = TIER_RANK[tier];
  const keys = new Set<string>();
  for (const type of BUILTIN_ARTIFACT_TYPES) {
    if (type.minTier !== null && TIER_RANK[type.minTier] <= rank) {
      keys.add(type.key);
    }
  }
  return keys;
}
