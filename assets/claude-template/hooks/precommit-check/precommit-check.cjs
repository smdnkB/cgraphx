#!/usr/bin/env node
/**
 * PreToolUse hook for Bash: precommit-check
 *
 * 守门员:拦截 git commit,指向项目的 `docs/guides/git-standards.md`——
 * 该文件由 /init-project-guides 生成,定义两件事:
 *   1. 提交消息规范(标题格式 / 票据关联 / 语言 / 正文)
 *   2. 提交前检查点(项目自定义:该项目的历史事故点与团队红线)
 *
 * agent 的处理:Read guide → 对照检查点自查 staged 变更(自己跑
 * `git diff --cached` 逐项判断,命中报告用户)→ 按消息规范写 message
 * → 带 CGRAPHX_PRECOMMIT_REVIEWED=1 前缀重试。
 * guide 缺失 → 提示先跑 /init-project-guides 生成,或用户明确表示不需要。
 *
 * 本脚本只做事实判定(是否 git commit / 是否已暂存 / guide 是否存在);
 * 检查点的判断本身由 agent 按 guide 执行 —— 什么该查是项目自己的事。
 *
 * 输出协议(PreToolUse):命中拦截时输出
 *   { hookSpecificOutput: { hookEventName: "PreToolUse",
 *                           permissionDecision: "deny",
 *                           permissionDecisionReason: <提示> } }
 * 不命中时静默 exit 0(放行)。任何异常都吞掉 exit 0,永不阻断正常流程。
 */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const ENV_BYPASS = 'CGRAPHX_PRECOMMIT_REVIEWED=1';
const GUIDE_RELPATH = path.join('docs', 'guides', 'git-standards.md');

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

function main() {
  const input = readInput();
  const cmd = String((input && input.tool_input && input.tool_input.command) || '');

  // 只拦 git commit(覆盖 -m / --amend / --fixup 等所有子形式)
  if (!/\bgit\s+commit\b/.test(cmd)) return;

  // 已按 guide 处理过的重试 —— agent 会带 ENV_BYPASS 前缀重提交
  if (cmd.includes(ENV_BYPASS)) return;

  // 有暂存内容才拦;没暂存任何东西,交给 git 自己报错
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

  const hasGuide = fs.existsSync(path.join(process.cwd(), GUIDE_RELPATH));

  const reason = hasGuide
    ? `【提交门禁】项目有 \`${GUIDE_RELPATH}\`(提交消息规范 + 提交前检查点),提交前:\n` +
      `1. 先 Read 这个文件;\n` +
      `2. 按其中「提交前检查点」自查本次暂存变更(自己跑 \`git diff --cached\`,只看新增改动,逐项判断;命中项报告用户,由用户决定);\n` +
      `3. 按其中「提交消息规范」写 commit message(规范要求票据/需求号而未知 → 问用户,不得编造或省略)。\n\n` +
      `处理完后,用以下形式重试以跳过本检查:\n  ${ENV_BYPASS} git commit ...`
    : `【提交门禁】项目没有 \`${GUIDE_RELPATH}\`(提交消息规范 + 提交前检查点):\n` +
      `建议先跑 \`/init-project-guides\` 生成(挖掘项目 git 历史的消息风格 + 按技术栈定制检查点);用户明确表示不需要规范时可继续。\n\n` +
      `确认后,用以下形式重试以跳过本检查:\n  ${ENV_BYPASS} git commit ...`;

  deny(reason);
}

try {
  main();
} catch (e) {
  // hook 永不阻断正常流程 —— 任何意外都放行
}
