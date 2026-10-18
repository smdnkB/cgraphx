/**
 * 平台告警的展示文案与分组(spec §11.4)。
 *
 * 只服务 CLI 展示:逐条给出中文文案,`sync status` / `sync now` 共用同一口径。
 * 字段缺失或类型不符时用 `-` 占位,不抛错。
 */

type WarningLike = { kind: string } & Record<string, unknown>;

/** 字符串字段;缺失、空串或类型不符用 `-` 占位。 */
function field(warning: WarningLike, key: string): string {
  const value = warning[key];
  return typeof value === 'string' && value !== '' ? value : '-';
}

/** 绑定段未生效的原因(spec §11.4);未知值原样显示。 */
const BINDING_REASONS: Readonly<Record<string, string>> = {
  task_not_found: '任务不存在或不可见',
  not_owner: '不能归属到本人',
  task_closed: '任务已关闭',
};

/** 任务声明不合法的原因;未知值原样显示。 */
const DECLARATION_REASONS: Readonly<Record<string, string>> = {
  invalid_key: '任务键不合法',
  invalid_name: '名称不合法',
};

function reasonText(table: Readonly<Record<string, string>>, raw: string): string {
  return table[raw] ?? raw;
}

/** 单条告警的展示文案。 */
export function describeWarning(warning: WarningLike): string {
  switch (warning.kind) {
    case 'binding_ineffective':
      return `绑定段未生效(${reasonText(BINDING_REASONS, field(warning, 'reason'))}):${field(warning, 'bindingId')}`;
    case 'path_dropped':
      return `路径不安全,平台已丢弃:${field(warning, 'path')}`;
    case 'binding_pending':
      return `任务键尚未声明,该段挂起:${field(warning, 'taskKey')}`;
    case 'task_key_declared_by_other':
      return `任务键已由他人声明,本人会话按协作计入:${field(warning, 'taskKey')}`;
    case 'task_declaration_invalid':
      return `任务声明不合法,已丢弃:${field(warning, 'taskKey')}(${reasonText(
        DECLARATION_REASONS,
        field(warning, 'reason'),
      )})`;
    case 'artifact_type_unknown':
      return `本项目未配置产物类型 ${field(warning, 'type')},这条产出已丢弃:${field(
        warning,
        'path',
      )};请联系项目管理员配置该产物类型`;
    default: {
      const { kind, ...rest } = warning;
      return `${kind}:${JSON.stringify(rest)}`;
    }
  }
}

/** 按 kind 首次出现的顺序分组,组内去重。 */
export function groupWarnings(items: ReadonlyArray<WarningLike>): Array<{ kind: string; lines: string[] }> {
  const groups = new Map<string, string[]>();
  for (const item of items) {
    const line = describeWarning(item);
    const lines = groups.get(item.kind);
    if (lines === undefined) groups.set(item.kind, [line]);
    else if (!lines.includes(line)) lines.push(line);
  }
  return [...groups.entries()].map(([kind, lines]) => ({ kind, lines }));
}
