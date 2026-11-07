# 接口设计规范

> 本仓库无 HTTP API,"接口" = CLI 命令面。

## 命令注册

- 子系统命令在各自 `src/core/<subsystem>/cli.ts` 导出 `export function register<子系统>Commands(program: Command): void` 自注册,由 `src/cli/index.ts` 统一接入
- 顶层命令(init / status / install / upgrade / uninstall)在 `index.ts` 内联注册

## 输出

- stderr 消息带 `[子系统]` 前缀:`[timeline]` / `[db-query]` / `[markdown]`(features 目前中文 console.error 无前缀,遇改收敛)
- 机器可读输出:新命令统一提供 `--json` 布尔开关(dbquery 的 `--format json/table/csv` 是历史形态,不推广)

## 退出码

语义**按命令局部有效**,不跨命令解读(脚本集成只把 `0` = 成功当通用契约):

- `0` 成功 · `1` 一般 / 运行时错误(各系统通用)
- `2` 命令特化:`docs index` 部分成功(有文件跳过)/ `docs validate` 不合法 / `status` 未初始化 / timeline schema 版本不匹配
- timeline 错误类型映射表(`exitCodeForError`):ArgError=3 · TimelineSchemaError=2 · StoreQueryError=4 · 其他=1
- dbquery 参数错误(--mode 非法 / --table 缺失 / 标识符非法)= 5
- **新命令**:用 `exitCodeForError(err)` 映射错误类到固定编号,不在 action 里散落 `process.exitCode = n` 字面量
- 例外:`commit-gate-hook` 的退出码是**领域信号**(0 放行 / 3 打回),不走 `exitCodeForError`——3 在 timeline 里是 ArgError,语义按命令局部有效,不跨命令解读

## git 钩子调起的隐藏子命令契约

- 在用的只有两个,都由 git 钩子片段(经 PATH)调起,不供人直接使用:
  - `timeline-git-commit-hook`:post-commit / post-merge 片段**后台**调起(`&`),记提交记录 + 判跳过门禁 + 补钩子片段 + 补录;不读 stdin,从 git CLI 取提交信息;易变状态(HEAD、分支、门禁记号)由片段在提交当下固定,经环境变量传入
  - `commit-gate-hook <说明文件>`:commit-msg 门禁片段**前台**调起;退出码 0 放行 / 3 打回(打回原文写 stderr;检查跑不起来、超时、自身异常一律放行,门禁挂了不能让人提交不了);片段先看会话变量,一个都没有(人手动提交)就不起 node
- 通用约束:
  - 隐藏顶层命令(`{ hidden: true }`),命令名与门面/常量钉死,不散落字面量
  - **fail-silent:任何异常吞掉或放行,绝不阻塞宿主**(git 钩子片段不得让提交失败;人读提示只写 stderr)
  - 给隐藏子命令加输入优先用环境变量;位置参数旧版二进制会报 `too many arguments` 直接失败
  - 耗时预算:前台调起(commit-msg)只做判定(产物检查子进程 15 秒超时);后台调起(post-commit)可以宽松,但也只做记录与补录,不接交互

## 已下掉 hook 的兼容空命令

- 7 条 timeline hook(`timeline-session-start-hook`、`timeline-session-end-hook`、`timeline-user-prompt-hook`、`timeline-pre-tool-use-hook`、`timeline-post-tool-use-hook`、`timeline-stop-hook`、`timeline-post-tool-use-failure-hook`)已随「会话文件解析替代 hooks」下掉;与更早下掉的 5 条 sync/task hook 一起,共 12 条,留成 `src/cli/legacy-hook-commands.ts` 里的隐藏空命令兜底:升级了新版、还没重装的项目,agent 配置里挂着的旧条目读到 stdin 到 EOF、不输出、退出码 0,不报 unknown command;install/uninstall 的死 hook 清理把配置里的条目删掉后,它们不再被调起
