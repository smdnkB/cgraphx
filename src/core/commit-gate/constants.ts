/**
 * commit-gate 子系统常量。
 *
 * 规则常量(版本分支模式、「按版本走」的 git 配置键)不在这里复制,统一用 release 门面导出的
 * 那份(spec D12);这里只有门禁自己的:钩子名、隐藏命令名、片段 marker、打回提示模板、产物检查
 * 子进程的参数与超时、过门禁记号(D13)的目录与文件名。
 */

/** 门禁片段所在的钩子。 */
export const COMMIT_GATE_HOOK = 'commit-msg';

/** 门禁的隐藏顶层命令名(commit-msg 片段经 PATH 调起它)。 */
export const COMMIT_GATE_HOOK_COMMAND = 'commit-gate-hook';

/** commit-msg 片段每行都带的标记:重装时按它先删旧行,卸载时按它删行;post-commit 链路按它判片段在不在。 */
export const COMMIT_GATE_MARKER = '# cgraphx-commit-gate';

/** K26 版本分支放行的提交说明前缀:与 release 拦截片段 grep 的前缀一致。 */
export const RELEASE_COMMIT_PREFIX = 'chore(release):';

/** K15 提交说明自查的跳过环境变量:agent 按 guide 自查后带着它重试。 */
export const PRECOMMIT_REVIEWED_ENV = 'CGRAPHX_PRECOMMIT_REVIEWED';

/** 提示里给 agent 看的跳过写法(带值,可直接拼进命令)。 */
export const PRECOMMIT_REVIEWED_BYPASS = `${PRECOMMIT_REVIEWED_ENV}=1`;

/** K15 指向的提交规范文件(相对工作区根;提示里也照这个 POSIX 写法显示)。 */
export const GIT_GUIDE_RELPATH = 'docs/guides/git-standards.md';

/** K14 产物检查:经子进程跑 `cgraphx features check`(不在进程内 import features 门面,spec D12)。 */
export const FEATURES_CHECK_ARGS = ['features', 'check', '--staged', '--json'] as const;

/** K14 产物检查子进程的超时;超时当没查,往下走。 */
export const FEATURES_CHECK_TIMEOUT_MS = 15000;

/** D13 过门禁记号:写在 `<git 目录>/<这个目录>/<这个文件名>`,内容是 `git write-tree` 的输出。 */
export const PASS_MARK_DIRNAME = 'cgraphx';
export const PASS_MARK_FILENAME = 'commit-gate-pass';

// ---------- 打回提示模板(K26 / K14 原文照 spec F2 图;K15 原文搬自 precommit-check.cjs) ----------

/** K26:打回原文同 release 拦截片段那一句(release/constants.ts 的 RELEASE_GUARD_LINES)。 */
export function versionBranchRejectText(branch: string): string {
  return `[cgraphx] ${branch} 是版本分支:需求改动到副本里做(/dev-start <需求>);整个版本的改动以 ${RELEASE_COMMIT_PREFIX} 开头提交`;
}

/** K14 解析出的 `features check --staged --json` 输出(只保留用到的字段;结构校验在 gate.ts)。 */
export interface ArtifactCheckReport {
  failures: number;
  findings: ReadonlyArray<{ level: string; path: string; message: string; fix: string | null }>;
}

/** K14:逐条 fail 的 path:message 与改法,写法照 precommit-check.cjs 的 formatArtifactCheckReason。 */
export function artifactCheckRejectText(report: ArtifactCheckReport): string {
  const lines = report.findings
    .filter((item) => item.level === 'fail')
    .map((item) => `- ${item.path}:${item.message};改法:${item.fix ?? '按提示修正'}`);
  return (
    `【产物检查】本次暂存的产物有 ${report.failures} 处不合格,改对后才能提交(带 ${PRECOMMIT_REVIEWED_BYPASS} 也跳不过):\n` +
    `${lines.join('\n')}\n` +
    `改完重新 git add,再提交。`
  );
}

/** K15:项目有 guide 时的自查提示。 */
export function selfCheckRejectText(): string {
  return (
    `【提交门禁】项目有 \`${GIT_GUIDE_RELPATH}\`(提交消息规范 + 提交前检查点),提交前:\n` +
    `1. 先 Read 这个文件;\n` +
    `2. 按其中「提交前检查点」自查本次暂存变更(自己跑 \`git diff --cached\`,只看新增改动,逐项判断;命中项报告用户,由用户决定);\n` +
    `3. 按其中「提交消息规范」写 commit message(规范要求票据/需求号而未知 → 问用户,不得编造或省略)。\n\n` +
    `处理完后,用以下形式重试以跳过本检查:\n  ${PRECOMMIT_REVIEWED_BYPASS} git commit ...`
  );
}

/** K15:项目没有 guide 时的提示。 */
export function noGuideRejectText(): string {
  return (
    `【提交门禁】项目没有 \`${GIT_GUIDE_RELPATH}\`(提交消息规范 + 提交前检查点):\n` +
    `建议先跑 \`/init-guides\` 生成(挖掘项目 git 历史的消息风格 + 按技术栈定制检查点);用户明确表示不需要规范时可继续。\n\n` +
    `确认后,用以下形式重试以跳过本检查:\n  ${PRECOMMIT_REVIEWED_BYPASS} git commit ...`
  );
}
