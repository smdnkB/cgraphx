/**
 * 产物识别:产出目录内的 md / html 头部优先,其余按路径规则。
 */

import { extname, join } from 'node:path';
import { readArtifactHeader } from './header';
import {
  classifyArtifactByPath,
  featureIdOf,
  getBuiltinArtifactType,
  isValidArtifactTypeKey,
} from './registry';
import type { ArtifactHeader, ArtifactIdentity } from './types';

/** 路径转绝对路径(项目相对 POSIX 路径 → 本地分隔符)。 */
function toAbsolutePath(projectRoot: string, projectRelPath: string): string {
  return join(projectRoot, ...projectRelPath.split('/'));
}

/** 识别一个文件的产物类型;不是产物返回 null。 */
export function identifyArtifact(
  projectRoot: string,
  projectRelPath: string,
): ArtifactIdentity | null {
  const featureId = featureIdOf(projectRelPath);
  let header: ArtifactHeader | null = null;
  const ext = extname(projectRelPath).toLowerCase();

  // 只有产出目录内(任意深度)的 md / html 才读头部。
  if (featureId !== null && (ext === '.md' || ext === '.html')) {
    header = readArtifactHeader(toAbsolutePath(projectRoot, projectRelPath));
    if (
      header !== null &&
      header.typeRaw !== null &&
      isValidArtifactTypeKey(header.typeRaw)
    ) {
      const builtinType = getBuiltinArtifactType(header.typeRaw);
      return {
        type: header.typeRaw,
        via: 'header',
        builtin: builtinType !== undefined,
        localOnly: builtinType !== undefined && builtinType.minTier === null,
        featureId,
        header,
      };
    }
  }

  const type = classifyArtifactByPath(projectRelPath);
  if (type === null) {
    return null;
  }
  const builtinType = getBuiltinArtifactType(type);
  return {
    type,
    via: 'path',
    builtin: builtinType !== undefined,
    localOnly: builtinType !== undefined && builtinType.minTier === null,
    featureId,
    header,
  };
}
