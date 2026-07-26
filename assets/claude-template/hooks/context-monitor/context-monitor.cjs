#!/usr/bin/env node
/**
 * Context Monitor Hook for Claude Code
 *
 * 实时监控上下文窗口使用百分比
 *
 * 配置方法: 在项目 .claude/settings.local.json 中配置 hooks
 */

const fs = require('fs');
const path = require('path');

// 模型上下文窗口大小配置 (tokens)
const MODEL_CONTEXT_WINDOWS = {
  // Claude 4 系列
  'claude-opus-4-6': 200000,
  'claude-sonnet-4-6': 200000,
  'claude-haiku-4-5': 200000,
  'claude-opus-4-5': 200000,
  'claude-sonnet-4-5': 200000,
  // Claude 3.5 系列
  'claude-3-5-sonnet': 200000,
  'claude-3-5-haiku': 200000,
  // Claude 3 系列
  'claude-3-opus': 200000,
  'claude-3-sonnet': 200000,
  'claude-3-haiku': 200000,
  // GLM 系列 (智谱)
  'glm-4': 128000,
  'glm-4.7': 128000,
  'glm-4-plus': 128000,
  // 默认
  'default': 200000
};

// 状态文件路径
const STATUS_FILE = path.join(process.env.TEMP || '/tmp', 'claude-context-status.json');

// ANSI 颜色代码
const COLORS = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  red: '\x1b[31m',
  cyan: '\x1b[36m',
  magenta: '\x1b[35m',
  bgGreen: '\x1b[42m',
  bgYellow: '\x1b[43m',
  bgRed: '\x1b[41m'
};

/**
 * 从 stdin 读取 JSON 输入
 */
function readInput() {
  try {
    const data = fs.readFileSync(0, 'utf-8');
    return JSON.parse(data);
  } catch (e) {
    return null;
  }
}

/**
 * 获取模型的上下文窗口大小
 */
function getContextWindowSize(modelName) {
  if (!modelName) return MODEL_CONTEXT_WINDOWS.default;

  // 尝试匹配模型名称
  for (const [key, value] of Object.entries(MODEL_CONTEXT_WINDOWS)) {
    if (modelName.toLowerCase().includes(key.toLowerCase())) {
      return value;
    }
  }
  return MODEL_CONTEXT_WINDOWS.default;
}

/**
 * 计算使用百分比并获取颜色
 */
function getUsageInfo(used, total) {
  const percent = (used / total) * 100;
  let color, status;

  if (percent < 50) {
    color = COLORS.green;
    status = '🟢';
  } else if (percent < 75) {
    color = COLORS.yellow;
    status = '🟡';
  } else if (percent < 90) {
    color = COLORS.red;
    status = '🟠';
  } else {
    color = COLORS.bright + COLORS.red;
    status = '🔴';
  }

  return { percent, color, status };
}

/**
 * 格式化数字
 */
function formatNumber(num) {
  if (num >= 1000000) {
    return (num / 1000000).toFixed(1) + 'M';
  } else if (num >= 1000) {
    return (num / 1000).toFixed(1) + 'K';
  }
  return num.toString();
}

/**
 * 创建进度条
 */
function createProgressBar(percent, width = 20) {
  const filled = Math.round((percent / 100) * width);
  const empty = width - filled;
  const bar = '█'.repeat(filled) + '░'.repeat(empty);
  return bar;
}

/**
 * 保存状态到文件
 */
function saveStatus(status) {
  try {
    fs.writeFileSync(STATUS_FILE, JSON.stringify(status, null, 2));
  } catch (e) {
    // 忽略写入错误
  }
}

/**
 * 读取之前的状态
 */
function readPreviousStatus() {
  try {
    if (fs.existsSync(STATUS_FILE)) {
      return JSON.parse(fs.readFileSync(STATUS_FILE, 'utf-8'));
    }
  } catch (e) {
    // 忽略读取错误
  }
  return null;
}

/**
 * 主函数
 */
function main() {
  const input = readInput();

  if (!input) {
    return;
  }

  // 提取 token 使用信息
  let inputTokens = 0;
  let outputTokens = 0;
  let modelName = 'unknown';

  // 从不同可能的字段中提取信息
  if (input.usage) {
    inputTokens = input.usage.input_tokens || input.usage.inputTokens || 0;
    outputTokens = input.usage.output_tokens || input.usage.outputTokens || 0;
  }

  if (input.model) {
    modelName = input.model;
  }

  // 如果没有直接的使用信息，尝试从其他字段获取
  if (input.result && input.result.usage) {
    inputTokens = input.result.usage.input_tokens || 0;
    outputTokens = input.result.usage.output_tokens || 0;
  }

  // 获取上下文窗口大小
  const contextWindow = getContextWindowSize(modelName);
  const totalTokens = inputTokens + outputTokens;
  const { percent, color, status } = getUsageInfo(inputTokens, contextWindow);

  // 只有在有实际 token 使用时才显示
  if (inputTokens > 0) {
    // 构建状态行
    const progressBar = createProgressBar(percent);
    const statusLine = [
      '',
      `${status} ${COLORS.cyan}上下文窗口${COLORS.reset}`,
      `${color}${progressBar}${COLORS.reset}`,
      `${color}${percent.toFixed(1)}%${COLORS.reset}`,
      `(${formatNumber(inputTokens)} / ${formatNumber(contextWindow)} tokens)`,
      ''
    ].join(' ');

    // 输出到 stderr 以避免干扰正常输出
    process.stderr.write('\n' + statusLine + '\n');

    // 保存状态
    saveStatus({
      timestamp: new Date().toISOString(),
      model: modelName,
      inputTokens,
      outputTokens,
      totalTokens,
      contextWindow,
      percent: percent.toFixed(2)
    });
  }
}

main();
