/**
 * 产物注册表的类型定义。
 *
 * 「文件 → 产物类型」的全部口径集中在本模块的注册表中,
 * 本文件只描述口径涉及的数据形状,不含任何识别逻辑。
 */

/** 默认平台环节(只供 features show 展示,不上报)。 */
export type ArtifactPhase =
  | 'design'
  | 'plan'
  | 'test'
  | 'release'
  | 'knowledge'
  | 'delivery';

/** 服务端协议档位(按「主.次」数值比较)。 */
export type ReportTier = '1.0' | '1.2' | '1.3';

/** 本地阶段里程碑:报告 / plan index / 顶层规格类文件。 */
export type StageMilestone = 'spec_like' | 'plan_index' | 'report';

/** 内置产物类型的一条登记。 */
export interface BuiltinArtifactType {
  /** 类型标识(小写字母、数字、下划线)。 */
  key: string;
  /** 显示名。 */
  name: string;
  /** 默认平台环节;handoff 为 null。 */
  defaultPhase: ArtifactPhase | null;
  /** 起始上报档位;handoff 为 null 表示本地专用、不上报。 */
  minTier: ReportTier | null;
  /** 是否必须带 `> 依据: spec@<指纹>`。 */
  requiresBasis: boolean;
  /** 开头结论(第一个二级标题)要求;null 表示不要求。只对 md 生效。 */
  firstScreen: { heading: string; planIndexOnly: boolean } | null;
}

/** 从文件头部解析出的字段原值。 */
export interface ArtifactHeader {
  /** `> 产物:` 去首尾空白后的原值;没有该行为 null;空值为 ''。 */
  typeRaw: string | null;
  /** 负责人;空值记 null。 */
  owner: string | null;
  /** 任务编号;空值记 null。 */
  task: string | null;
  /** 依据(如 spec@3f9a1c2);空值记 null。 */
  basis: string | null;
}

/** 单个文件的产物识别结果。 */
export interface ArtifactIdentity {
  /** 类型标识(可能是项目自定义类型)。 */
  type: string;
  /** 识别来源:头部优先,否则路径规则。 */
  via: 'header' | 'path';
  /** 是否为内置类型。 */
  builtin: boolean;
  /** 是否本地专用(内置且 minTier 为 null,如 handoff)。 */
  localOnly: boolean;
  /** 所属需求目录名;不在 docs/features/<feature-id>/ 下为 null。 */
  featureId: string | null;
  /** 读到的头部;未读取或读取失败为 null。 */
  header: ArtifactHeader | null;
}
