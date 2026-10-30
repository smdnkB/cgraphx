#!/usr/bin/env node
/**
 * PreToolUse hook for Bash: precommit-check
 *
 * 守门员:三道闸门,顺序固定 ——
 *   1. 版本分支:项目按版本走(/release-start 记下的本地 git 配置)且当前在
 *      dev/x.y.z 上时,只放行合并收尾和 chore(release): 开头的提交;这项不能
 *      跳过(带 ENV_BYPASS、--no-verify 也拦)。规则同 commit-msg 钩子里那段,
 *      不经 git 的钩子目录,钩子片段装不上的项目也拦得住。
 *   2. 产物检查:跑 `cgraphx features check --staged --json`,暂存区产物有
 *      fail 项就 deny,改对才能提交;这项不能跳过(带 ENV_BYPASS 也拦)。
 *      跑不起来(旧版 CLI / 超时 / 输出不可解析)则当没查,放行到第三道。
 *   3. 提交说明自查:指向项目的 `docs/guides/git-standards.md` ——
 *      该文件由 /init-guides 生成,定义两件事:
 *      - 提交消息规范(标题格式 / 票据关联 / 语言 / 正文)
 *      - 提交前检查点(项目自定义:该项目的历史事故点与团队红线)
 *
 * agent 的处理:三道都通过后再提交。第三道按 guide 自查 staged 变更
 * (自己跑 `git diff --cached` 逐项判断,命中报告用户)→ 按消息规范写
 * message → 带 CGRAPHX_PRECOMMIT_REVIEWED=1 前缀重试。
 * guide 缺失 → 提示先跑 /init-guides 生成,或用户明确表示不需要。
 *
 * 本脚本只做事实判定(是否 git commit / 是否在版本分支 / 是否已暂存 / 产物是否合格 / guide 是否存在);
 * 检查点的判断本身由 agent 按 guide 执行 —— 什么该查是项目自己的事。
 *
 * 输出协议(PreToolUse):命中拦截时输出
 *   { hookSpecificOutput: { hookEventName: "PreToolUse",
 *                           permissionDecision: "deny",
 *                           permissionDecisionReason: <提示> } }
 * 不命中时静默 exit 0(放行)。任何异常都吞掉 exit 0,永不阻断正常流程。
 */

const { execSync, spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const ENV_BYPASS = 'CGRAPHX_PRECOMMIT_REVIEWED=1';
const GUIDE_RELPATH = path.join('docs', 'guides', 'git-standards.md');
const FEATURES_CHECK_ARGS = ['features', 'check', '--staged', '--json'];
const FEATURES_CHECK_TIMEOUT_MS = 15000;
const RELEASE_FLOW_CONFIG_KEY = 'cgraphx.releaseFlow';
const VERSION_BRANCH_PATTERN = /^dev\/[0-9]+\.[0-9]+\.[0-9]+$/;
const RELEASE_COMMIT_PREFIX = 'chore(release):';

function readInput() {
  try {
    const data = fs.readFileSync(0, 'utf-8');
    return data ? JSON.parse(data) : {};
  } catch (e) {
    return {};
  }
}

function deny(reason) {
  process.stdout.write(JSON.stringify({
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: 'deny',
      permissionDecisionReason: reason,
    },
  }));
}

function runFeaturesCheck() {
  let result;
  try {
    result = spawnSync('cgraphx', FEATURES_CHECK_ARGS, {
      cwd: process.cwd(),
      encoding: 'utf-8',
      timeout: FEATURES_CHECK_TIMEOUT_MS,
      stdio: ['ignore', 'pipe', 'ignore'],
      shell: process.platform === 'win32',
    });
  } catch (e) {
    return null;
  }
  if (!result || result.error) return null;

  const stdout = typeof result.stdout === 'string' ? result.stdout : '';
  if (!stdout.trim()) return null; // 旧版 cgraphx 不认 --staged,stdout 为空

  let report;
  try {
    report = JSON.parse(stdout);
  } catch (e) {
    return null;
  }
  if (
    !report ||
    typeof report.failures !== 'number' ||
    !Array.isArray(report.findings)
  ) {
    return null;
  }
  return report;
}

function formatArtifactCheckReason(report) {
  const lines = report.findings
    .filter((item) => item && item.level === 'fail')
    .map((item) => `- ${item.path}:${item.message};改法:${item.fix || '按提示修正'}`);
  return `【产物检查】本次暂存的产物有 ${report.failures} 处不合格,改对后才能提交(带 ${ENV_BYPASS} 也跳不过):\n` +
    `${lines.join('\n')}\n` +
    `改完重新 git add,再提交。`;
}

/** 跑一条 git 命令取输出(去掉首尾空白);非 git 仓库、ref 不存在、git 不可用 → null。 */
function gitOutput(args) {
  const result = spawnSync('git', args, {
    cwd: process.cwd(),
    encoding: 'utf-8',
    stdio: ['ignore', 'pipe', 'ignore'],
  });
  if (!result || result.error || result.status !== 0) return null;
  return String(result.stdout || '').trim();
}

/**
 * 版本分支(版本流程与需求副本 spec D12 的 agent 这一道):项目按版本走(cgraphx.releaseFlow 为 true)、
 * 当前分支是 dev/<数字>.<数字>.<数字>、不在收尾合并(没有 MERGE_HEAD)、命令里没有 chore(release):
 * → 返回拦截提示,否则 null。提交说明只能从命令里认,写在 -F 文件或编辑器里的认不出。
 */
function versionBranchReason(cmd) {
  if (gitOutput(['config', '--bool', '--get', RELEASE_FLOW_CONFIG_KEY]) !== 'true') return null;
  const branch = gitOutput(['symbolic-ref', '--short', '-q', 'HEAD']);
  if (!branch || !VERSION_BRANCH_PATTERN.test(branch)) return null;
  if (gitOutput(['rev-parse', '-q', '--verify', 'MERGE_HEAD']) !== null) return null;
  if (cmd.includes(RELEASE_COMMIT_PREFIX)) return null;
  return `【版本分支】${branch} 是版本分支:需求改动到副本里做(/dev-start <需求>);` +
    `整个版本的改动以 ${RELEASE_COMMIT_PREFIX} 开头提交,说明用 -m 写在命令里。\n` +
    `这项不能跳过(带 ${ENV_BYPASS}、--no-verify 也跳不过)。`;
}

function main() {
  const input = readInput();
  const cmd = String((input && input.tool_input && input.tool_input.command) || '');

  // ① 只拦 git commit(覆盖 -m / --amend / --fixup 等所有子形式)
  if (!/\bgit\s+commit\b/.test(cmd)) return;

  // ② 版本分支只收合并收尾和整版改动;不能跳过,不看有没有暂存(git commit -a 照样拦)
  const versionReason = versionBranchReason(cmd);
  if (versionReason) {
    deny(versionReason);
    return;
  }

  // ③ 有暂存内容才拦;没暂存任何东西,交给 git 自己报错
  let staged;
  try {
    staged = execSync('git diff --cached --name-status', {
      encoding: 'utf-8',
      cwd: process.cwd(),
      stdio: ['ignore', 'pipe', 'ignore'],
    }) || '';
  } catch (e) {
    return; // 非 git 仓库 / git 不可用 —— 不阻断
  }
  if (!staged.trim()) return;

  // ④ 产物检查:有 fail 项就拦,且不能跳过
  const report = runFeaturesCheck();
  if (report && report.failures > 0) {
    deny(formatArtifactCheckReason(report));
    return;
  }

  // ⑤ 已按 guide 处理过的重试 —— agent 会带 ENV_BYPASS 前缀重提交
  if (cmd.includes(ENV_BYPASS)) return;

  // ⑥ 提交说明自查提示
  const hasGuide = fs.existsSync(path.join(process.cwd(), GUIDE_RELPATH));

  const reason = hasGuide
    ? `【提交门禁】项目有 \`${GUIDE_RELPATH}\`(提交消息规范 + 提交前检查点),提交前:\n` +
      `1. 先 Read 这个文件;\n` +
      `2. 按其中「提交前检查点」自查本次暂存变更(自己跑 \`git diff --cached\`,只看新增改动,逐项判断;命中项报告用户,由用户决定);\n` +
      `3. 按其中「提交消息规范」写 commit message(规范要求票据/需求号而未知 → 问用户,不得编造或省略)。\n\n` +
      `处理完后,用以下形式重试以跳过本检查:\n  ${ENV_BYPASS} git commit ...`
    : `【提交门禁】项目没有 \`${GUIDE_RELPATH}\`(提交消息规范 + 提交前检查点):\n` +
      `建议先跑 \`/init-guides\` 生成(挖掘项目 git 历史的消息风格 + 按技术栈定制检查点);用户明确表示不需要规范时可继续。\n\n` +
      `确认后,用以下形式重试以跳过本检查:\n  ${ENV_BYPASS} git commit ...`;

  deny(reason);
}

try {
  main();
} catch (e) {
  // hook 永不阻断正常流程 —— 任何意外都放行
}
