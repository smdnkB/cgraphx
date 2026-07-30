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

## Hook 子命令契约(timeline-*-hook ×5)

- 隐藏顶层命令,由目标项目 Claude Code hooks 调起
- 短生命周期:打开 DB → INSERT → 退出(约 5ms);**必须 await,绝不 fire-and-forget**
- Fail-silent:任何异常吞掉不阻塞宿主;turn_id 状态文件(`.cgraphx/timeline-current-turn.json`)读取方容忍缺失 / 损坏,优雅降级
