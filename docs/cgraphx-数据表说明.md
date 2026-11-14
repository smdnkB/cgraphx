# cgraphx 数据表说明

> 依据:`dev/2.0.14` 分支 `23e2e88` 的代码(`src/core/markdown/schema.sql`、`src/core/timeline/schema.sql`、`src/core/session-index.ts`)
> 日期:2026-11-06

cgraphx 用 SQLite,共 3 个库、20 张表。

| 库 | 位置 | 一个什么一份 | 表 | 存什么 |
|---|---|---|---|---|
| 知识库 | `<项目目录>/.cgraphx/cgraphx.db` | 每个目录一份 | `markdown_*` 11 张 | `docs/knowledge/` 的索引,可随时重建 |
| 项目库 | `~/.cgraphx/projects/<项目名>/cgraphx.db` | 每个项目一份 | `timeline_*` 4 张 | 开发时间线 |
| 会话索引库 | `~/.cgraphx/sessions.db` | 每个用户一份 | 5 张 | 补录进度、归属缓存、提示记录,不存会话内容 |

时间的写法有两种:`ts`、`*_ts`、`*_at`(TEXT 类型)是 ISO 8601 UTC 毫秒,如 `2026-11-06T03:37:10.739Z`;INTEGER 类型的 `*_at` 是毫秒时间戳。

## 项目库:开发时间线

### timeline_events:事件

一行一个事件。除提交记录外,都从 agent 的会话文件解析而来。

| 字段 | 类型 | 必填 | 含义 |
|---|---|---|---|
| id | INTEGER 主键 | 是 | 自增编号 |
| ts | TEXT | 是 | 事件时间;工具事件取结果返回的时间 |
| session_id | TEXT | | 会话编号;人在终端手动提交时为空 |
| event_type | TEXT | 是 | 事件类型,见下表 |
| tool_name | TEXT | | 工具名,如 `Bash`、`Edit` |
| tool_args | TEXT | | 工具调用参数,JSON;整体上限 64KB,单个字符串 16KB |
| tool_result_summary | TEXT | | 工具结果摘要,JSON `{v, success, payload}`,`v` 当前是 2;整体上限 8KB,单个预览字段 2KB |
| prompt_text | TEXT | | 提问或自动消息的原文;上限 64KB |
| duration_ms | INTEGER | | 工具耗时:调用到结果返回的时间差 |
| commit_hash | TEXT | | 提交号 |
| commit_message | TEXT | | 提交说明;上限 16KB |
| commit_files | TEXT | | 改动的文件,JSON 数组,最多 1000 个,超出时变成 `{files, _truncated_count}`;合并提交为空 |
| cwd | TEXT | 是 | 工具事件取发起调用时的目录,提问、轮次结束、会话开始取会话的开始目录,提交取提交所在目录 |
| metadata | TEXT | | 附加信息,JSON,见下表;上限 8KB |
| turn_id | TEXT | | 轮次编号,取这一轮提问的 uuid;会话开始和提交为空 |
| commit_insertions | INTEGER | | 新增行数;合并提交为 0 |
| commit_deletions | INTEGER | | 删除行数;合并提交为 0 |
| agent | TEXT | | 来源:`claude-code`、`codebuddy`;人手动提交时为空 |
| source_key | TEXT | | 去重键,重读同一个会话文件不会多记;提交记录没有这个键 |

索引:`ts`、`event_type`、`tool_name`、`session_id`、`turn_id` 各一个普通索引;`source_key` 非空部分唯一。

各事件类型填哪些字段:

| event_type | 含义 | 专有字段 | metadata | source_key |
|---|---|---|---|---|
| session_start | 会话开始,一个会话一条 | 无 | 无 | `<agent>:start:<会话编号>` |
| user_prompt | 人发的消息 | prompt_text | 无 | `<agent>:prompt:<消息 uuid>` |
| auto_message | 自动消息,不是人发的 | prompt_text | `source`:`task_notification`、`agent_message` | `<agent>:prompt:<消息 uuid>` |
| post_tool_use | 一次工具调用 | tool_name、tool_args、tool_result_summary、duration_ms | `tool_use_id`、`duration_source`(`transcript`)、子 agent 的调用多一个 `subagent: {id, type}` | `<agent>:tool:<工具调用 id>` |
| stop | 一轮回复结束 | 无 | 无 | `<agent>:stop:<回复消息 id>` |
| git_commit | 一笔提交;一笔改到几个项目就各记一条 | commit_* | `branch`;合并提交多一个 `merge: {parents, files, insertions, deletions}`;agent 跳过门禁的多一个 `gate: "skipped"` | 无 |
| pre_tool_use、session_end | 不再产生新数据,只是旧数据还认 | — | — | — |

### timeline_roots:项目到过的目录

| 字段 | 类型 | 必填 | 含义 |
|---|---|---|---|
| root | TEXT 主键 | 是 | 装过的目录或工作区根的绝对路径,不含会话 cd 进去的子目录 |
| first_ts | TEXT | 是 | 这个目录最早一次活动的时间 |
| last_ts | TEXT | 是 | 这个目录最近一次活动的时间 |

### timeline_meta:内部状态

键值表,只有两个键。

| 字段 | 类型 | 必填 | 含义 |
|---|---|---|---|
| key | TEXT 主键 | 是 | 键名 |
| value | TEXT | 是 | 键值 |

| key | value 的含义 |
|---|---|
| rebuilt_at | 这个项目全量重建时间线的时间;有这个键就不再重建 |
| auto_message_scan_id | 自动消息改记扫描到的事件 id,旧数据里混进 `user_prompt` 的自动消息靠它改回来 |

### timeline_schema_versions:结构版本

| 字段 | 类型 | 必填 | 含义 |
|---|---|---|---|
| version | INTEGER 主键 | 是 | 版本号,当前是 2 |
| applied_at | INTEGER | 是 | 应用时间,毫秒时间戳 |
| description | TEXT | | 这个版本改了什么 |

## 会话索引库

### session_files:会话文件补录进度

一个会话文件一行,子 agent 的文件也单独一行。项目数据删除时,这里的进度不动。

| 字段 | 类型 | 必填 | 含义 |
|---|---|---|---|
| path | TEXT 主键 | 是 | 会话文件路径 |
| agent | TEXT | 是 | 哪个 agent 的文件(有索引) |
| session_id | TEXT | | 会话编号 |
| start_cwd | TEXT | | 会话的开始目录;子 agent 文件跟主会话一样 |
| project_dir | TEXT | | 归到的项目目录名;为空表示没归到任何项目 |
| byte_offset | INTEGER | 是 | 已解析到第几个字节,默认 0 |
| size | INTEGER | 是 | 上次看到的文件大小,默认 0 |
| mtime_ms | INTEGER | 是 | 上次看到的修改时间,毫秒时间戳,默认 0 |
| updated_at | TEXT | 是 | 这一行的更新时间 |

### start_dirs:开始目录归属缓存

开始目录还在时每次现认,目录不在了才用这里的记录。

| 字段 | 类型 | 必填 | 含义 |
|---|---|---|---|
| cwd | TEXT 主键 | 是 | 会话的开始目录 |
| root | TEXT | | 认到的项目根 |
| origin | TEXT | | 旧列,不再读写 |
| name | TEXT | | 认到的项目名 |
| project_dir | TEXT | | 认到的项目目录名 |
| classified_at | TEXT | 是 | 认的时间 |

### removed_projects:删除记录

记下删过的项目,它们的旧会话不再补回来。

| 字段 | 类型 | 必填 | 含义 |
|---|---|---|---|
| identity_key | TEXT 主键 | 是 | 项目名 |
| removed_at | TEXT | 是 | 删除时间 |

### dirs_checked:判断过重名的目录

走完重名判断才写一行,不过期。

| 字段 | 类型 | 必填 | 含义 |
|---|---|---|---|
| root | TEXT 主键 | 是 | 目录的真实路径 |
| checked_at | TEXT | 是 | 判断的时间 |

### notices_shown:提示记录

控制命令输出里的会话提示多久出现一次;超过 30 天的行在打开库时删掉。

| 字段 | 类型 | 必填 | 含义 |
|---|---|---|---|
| scope | TEXT 主键 | 是 | 频控范围:有会话时是 `session:<会话编号>`,没有时是 `day:<项目根>:<本地日期>` |
| shown_at | TEXT | 是 | 提示的时间 |

## 知识库

`docs/knowledge/` 的 markdown 文件是唯一来源,这些表可以用 `cgraphx docs index` 重建。

### markdown_documents:文档

| 字段 | 类型 | 必填 | 含义 |
|---|---|---|---|
| id | TEXT 主键 | 是 | 文档相对路径的 sha256 |
| path | TEXT 唯一 | 是 | 相对项目根的路径 |
| title | TEXT | 是 | 标题 |
| document_type | TEXT | 是 | 文档类型,取值见下表 |
| status | TEXT | 是 | 状态,取值见下表 |
| source_type | TEXT | 是 | 来源,取值见下表 |
| summary_text | TEXT | 是 | `## Summary` 或 `## 摘要` 那一节的正文,没有就是空字符串 |
| owners | TEXT | 是 | 负责人,JSON 数组 |
| aliases | TEXT | 是 | 别名,JSON 数组 |
| related_code | TEXT | 是 | 相关代码路径,JSON 数组 |
| created | TEXT | | frontmatter 里的创建日期 |
| updated | TEXT | | frontmatter 里的更新日期 |
| indexed_at | INTEGER | 是 | 索引时间,毫秒时间戳 |

索引:`path`;`(status, document_type)`。

| 字段 | 取值 |
|---|---|
| document_type | `business-entity` 业务实体、`business-flow` 业务流程、`mechanism` 技术机制、`decision` 决策、`rule` 规则、`lesson` 教训、`guide` 指南 |
| status | `draft` 草稿、`active` 有效、`superseded` 已被取代、`deprecated` 已废弃 |
| source_type | `work_context` 需求或任务中沉淀、`batch_exploration` 批量探索、`review` 评审发现、`debugging` 排障发现、`manual` 人工整理 |

### markdown_concepts、markdown_domains、markdown_tags:概念、领域、标签

三张表结构相同。

| 字段 | 类型 | 必填 | 含义 |
|---|---|---|---|
| id | TEXT 主键 | 是 | 名称的 sha256,区分大小写 |
| name | TEXT 唯一 | 是 | 名称 |
| created_at | INTEGER | 是 | 创建时间,毫秒时间戳 |

### markdown_document_concepts、markdown_document_domains、markdown_document_tags:文档与概念、领域、标签的关联

三张表都是多对多关联,复合主键,文档或被关联的那一行删除时一起删除。

| 表 | 字段 | 含义 |
|---|---|---|
| markdown_document_concepts | document_id、concept_id | 文档 id、概念 id(`concept_id` 有索引) |
| markdown_document_domains | document_id、domain_id | 文档 id、领域 id(`domain_id` 有索引) |
| markdown_document_tags | document_id、tag_id | 文档 id、标签 id(`tag_id` 有索引) |

### markdown_document_references:文档之间的引用

来自 frontmatter 的 `related_documents`。

| 字段 | 类型 | 必填 | 含义 |
|---|---|---|---|
| source_document_id | TEXT 主键之一 | 是 | 发起引用的文档 id |
| target_document_id | TEXT 主键之一 | 是 | 被引用的文档 id(有索引) |
| ref_path | TEXT | 是 | frontmatter 里写的路径原文 |

### markdown_skip_log:索引时的问题记录

| 字段 | 类型 | 必填 | 含义 |
|---|---|---|---|
| id | INTEGER 主键 | 是 | 自增编号 |
| run_id | TEXT | 是 | 哪一次索引(有索引) |
| path | TEXT | 是 | 出问题的文件 |
| reason | TEXT | 是 | 原因,取值见下 |
| detail | TEXT | | 详细说明 |

`reason` 的取值:`no_frontmatter`、`frontmatter_unclosed`、`frontmatter_parse_error`、`field_type_error`、`missing_required_field`、`invalid_enum_value`、`read_error`、`dangling_reference`。前七种是文件被跳过;`dangling_reference` 是引用的文档找不到,文档本身照常索引。

### markdown_explored_entry_names:探索过的入口名

`cgraphx docs seen-names` 读写,`/init-knowledge` 探索项目时用来去重。

| 字段 | 类型 | 必填 | 含义 |
|---|---|---|---|
| id | INTEGER 主键 | 是 | 自增编号 |
| normalized_name | TEXT 唯一 | 是 | 规整后的名字:转小写、去掉标点,用来比较 |
| original_name | TEXT | 是 | 原始名字 |
| added_at | INTEGER | 是 | 添加时间,毫秒时间戳 |

### markdown_schema_versions:结构版本

| 字段 | 类型 | 必填 | 含义 |
|---|---|---|---|
| version | INTEGER 主键 | 是 | 版本号,当前是 2 |
| applied_at | INTEGER | 是 | 应用时间,毫秒时间戳 |
| description | TEXT | | 这个版本改了什么 |

## 本机现状和上面不一样的地方

本机装的 `cgraphx` 还是 2.0.13,新版没装过,所以实际的库和上面的结构有差别(2026-11-06 查):

- **`.cgraphx/cgraphx.db` 还有旧表:** `sync_*` 5 张、`task_*` 8 张,以及本地的 `timeline_events`、`timeline_meta`、`timeline_schema_versions`。代码里已经没有这些功能的读写,新版 `cgraphx install` 会并走提交记录、删掉 `sync_*`、`task_*`。
- **提交记录还在旧库:** 本地库有 419 条 `git_commit`,项目库一条都没有,要等新版 install 并过去。
- **`sessions.db` 还没有 `dirs_checked`:** 新版第一次打开时建。
- **项目目录还是旧名字:** `~/.cgraphx/projects/github.com-smdnkB-cgraphx`,`start_dirs.origin` 也还有旧值。
