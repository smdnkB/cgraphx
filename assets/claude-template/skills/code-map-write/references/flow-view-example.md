---
title: 开发时间线记录 · 代码地图
view_type: flow
concepts:
  - 开发时间线
knowledge: []
entry: src/core/timeline/hooks.ts#userPromptHook
related_code:
  - src/core/timeline/cli.ts
  - src/core/timeline/hooks.ts
  - src/core/timeline/hook-runner.ts
  - src/core/timeline/recorder.ts
  - src/core/timeline/store.ts
  - src/core/timeline/schema.sql
  - src/web/pages-timeline.ts
source_commit: 3c3d567
provider: ai
generated: 2026-10-14
---

# 开发时间线记录 · 代码地图

> 派生视图:从代码生成,不手工修改。相关文件在 `source_commit` 之后有改动即视为过期,用 `/code-map-write` 重新生成。

## 一句话

Claude Code 每个事件触发一个短命 hook 进程,把事件写进 `timeline_events` 表;同一轮对话的多个 hook 进程靠一个状态文件共享 `turn_id`。日报/周报和 web 时间线页只读这张表。

## 代码链路:一轮对话中的 user_prompt 事件

看什么:turn_id 在哪里生成、经状态文件传给同轮的其他 hook;任何失败都不阻塞 Claude Code。

```mermaid
sequenceDiagram
  participant CC as Claude Code
  participant CLI as cli.ts<br/>隐藏 hook 子命令
  participant H as hooks.ts
  participant RH as hook-runner.ts
  participant RC as recorder.ts
  participant ST as store.ts<br/>TimelineStore
  participant TF as timeline-current-turn.json
  participant DB as cgraphx.db

  CC->>CLI: timeline-user-prompt-hook(stdin 传 payload)
  CLI->>H: userPromptHook()
  H->>RH: runHook(buildEvent)
  Note over RH: kill-switch 环境变量开启 → 直接退出,不读 stdin、不碰库
  RH->>H: buildEvent(payload)
  H->>TF: writeCurrentTurn(turn_id, session_id)
  H-->>RH: user_prompt 事件
  RH->>RC: recordEvent(projectRoot, event)
  RC->>ST: insert(event)
  ST->>DB: INSERT timeline_events
  RH-->>CC: 退出(写库失败只写 stderr,不阻塞)
  Note over CC,TF: 同轮 pre/post/stop hook 走同一条链路,<br/>改由 readCurrentTurnId 从 TF 读回 turn_id(文件缺失/损坏 → 降级,不阻塞)
```

## 数据流转

看什么:只有 hook 写表,读方都只读;状态文件只在同一轮的 hook 之间传值。

```mermaid
flowchart LR
  up[user_prompt hook] -- 写 turn_id --> tf[(timeline-current-turn.json)]
  tf -- 读 turn_id --> rest[pre / post / stop hook]
  up -- INSERT --> ev[(timeline_events)]
  rest -- INSERT --> ev
  git[git_commit hook] -- INSERT --> ev
  ev -- 查询 --> cli[cgraphx timeline 命令<br/>developer-timeline skill 使用]
  ev -- queryEvents / getEventStats --> web[web 时间线页]
```

## 节点索引

| 节点 | 代码指针 | 来源 |
|---|---|---|
| 隐藏 hook 子命令 | `src/core/timeline/cli.ts`:`timeline-user-prompt-hook` 等 5 个 | AI 读代码 |
| userPromptHook / readCurrentTurnId | `src/core/timeline/hooks.ts` | AI 读代码 |
| runHook | `src/core/timeline/hook-runner.ts`:`runHook` | AI 读代码 |
| recordEvent | `src/core/timeline/recorder.ts`:`recordEvent` | AI 读代码 |
| TimelineStore.insert | `src/core/timeline/store.ts`:`TimelineStore.insert` | AI 读代码 |
| timeline_events | `src/core/timeline/schema.sql` | AI 读代码 |
| web 时间线页 | `src/web/pages-timeline.ts`(调 core/timeline 门面 `queryEvents` / `getEventStats`) | AI 读代码 |

## 已知盲区

- pre_tool_use 只记录写类工具(白名单过滤),图中未展开过滤分支。
- git_commit hook 由 `cgraphx timeline install` 接入 git 侧,接入路径未画。
