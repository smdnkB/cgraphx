#!/usr/bin/env node
/**
 * PreToolUse hook for Bash: precommit-check
 *
 * 守门员:拦截 git commit(当暂存含修改/删除/重命名文件时),要求 agent
 * 先调用 /precommit-review skill 审查 staged diff,再带
 * CGRAPHX_PRECOMMIT_REVIEWED=1 前缀重试。纯新增文件直接放行,不制造摩擦。
 *
 * 本脚本不做差异判断 —— 只做"是不是 git commit + 有没有非纯新增文件"的
 * 事实判定。真正的可疑模式识别由 /precommit-review skill 让 agent 自己
 * 跑 git diff --cached 比对完成。
 *
 * 输出协议(PreToolUse):命中拦截时输出
 *   { hookSpecificOutput: { hookEventName: "PreToolUse",
 *                           permissionDecision: "deny",
 *                           permissionDecisionReason: <指名 /precommit-review> } }
 * 不命中时静默 exit 0(放行)。任何异常都吞掉 exit 0,永不阻断正常流程。
 */

const { execSync } = require('child_process');
const fs = require('fs');

const ENV_BYPASS = 'CGRAPHX_PRECOMMIT_REVIEWED=1';

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

  // 已审查过的重试 —— agent 在 skill 审查后会带 ENV_BYPASS 前缀重提交
  if (cmd.includes(ENV_BYPASS)) return;

  // 拿暂存文件状态
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
  if (!staged.trim()) return; // 没暂存任何东西,交给 git 报错

  // 纯新增(A)直接放行;M/D/R/C/T/U 等都视为"非纯新增"
  const nonNew = staged
    .split('\n')
    .filter(Boolean)
    .filter((line) => line.split('\t')[0] !== 'A');

  if (nonNew.length === 0) return; // 纯新增,放行

  const reason =
    `本次 git commit 暂存了 ${nonNew.length} 个修改/删除/重命名文件,提交前请先调用 ` +
    `\`/precommit-review\` skill 审查 staged diff —— 检查被注释的开关(如 // @Component / @JmsListener / @Scheduled)、` +
    `被注释的业务调用、未闭合的逻辑、写死的魔法字符串、TODO/临时标记等可疑修改。\n\n` +
    `审查通过(或确认无需修改)后,用以下形式重试提交以跳过本检查:\n` +
    `  ${ENV_BYPASS} git commit ...\n\n` +
    `(本 hook 不做差异判断,只做守门;真正的可疑识别由 /precommit-review skill 让 agent 自己比对 staged diff 完成。)`;

  deny(reason);
}

try {
  main();
} catch (e) {
  // hook 永不阻断正常流程 —— 任何意外都放行
}
