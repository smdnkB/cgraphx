# 规格说明: monthly-report 迁移到流程中

> 产物: spec
> feature-id: 2026-10-31-monthly-report迁移到流程中
> 负责人: liulongfei
> 日期: 2026-10-31

## 功能方案

> 原样收录 2026-10-31 澄清对话终确认的功能方案（无讨论稿，单功能点）；业务要变，回 clarify 改，再同步这一节。

**一句话**：把 zqassis 里个人用的 `/monthly-report`（登录工作台拉全月日报，按日浓缩成月底日报表单要填的一行）收进 cgraphx 模板，改叫 `/doc-monthly-report`，随 `cgraphx install` 装到任意项目；同时把密码从命令行挪走，不再落进本地 timeline 库。

**业务口径**

| 编号 | 口径 | 怎么判定 | 算 / 不算（例子） | 依据 |
|---|---|---|---|---|
| K1 | 月份范围 | 按记录自带的 `date` 字段落在当月 1 日到月末（含）；接口用 startDate/endDate 过滤，脚本按 date 分组，不看提交时间 | 算：date=10.31 的记录；不算：date=11.01（即使 10.31 才提交） | 源脚本 `monthRange` + `/reports` 查询；沿用源 skill |
| K2 | 取谁的记录 | 登录账号本人的记录；`--filler` 可查别人；所有 workType/project 都算 | 算：请假、配合取数、发版；不算：别人的记录（除非显式指定） | 源脚本 `userName=filler`，默认等于登录用户 |
| K3 | 每天一行 | 当天所有记录合并浓缩，≤100 字（含标点）；保留主线交付和关键数字；同类去重；不编造 | 3 条记录合并成 1 行；记录只有「请假」就写「请假」，不扩写 | 源 skill 第 3 步 |
| K4 | 未列入 | 周末无记录 → 列日期标「周末休息」；工作日无记录 → 标「未填报」；月末最后一天未填 → 标「待填」；周末有记录 → 照常列入 | 10.05–10.06 周末休息；10.08 未填报；10.31 待填 | 源 skill 第 4 步；「工作日缺报」为新定（源 skill 未提） |
| K5 | 日期格式 | `M.DD`，月不补零、日补两位 | 8.01、10.05；不写 08.01 | 源 skill 第 4 步 |
| K6 | 密码 | 不写入任何文件、不进命令行参数、不进本地 `.cgraphx/cgraphx.db`；交互输入 / 环境变量 / 钥匙串 | 命令里只有 `--base/--month/--user`；密码在 TTY 隐藏输入或 `WORK_REPORT_PASS` | 源 skill 凭证规则 + 本项目 `cgraphx sync connect` 的既有约定 + timeline 对 Bash 的 `tool_args` 原样入库 |
| K7 | 数据完整性 | 拉回条数 < 接口 `total` 时不得静默出表；翻页取全，或明确警告并停 | total=620、只拿到 500 → 不出表，提示翻页 | 源脚本 500 条警告；新定为硬边界 |
| K8 | 地址过期 | 登录阶段 DNS 失败 / 非 JSON / 连接失败 → 先怀疑隧道地址，要新地址，不反复重试；拉取阶段 `{"error":"未登录"}` → 先查 token/Authorization，再怀疑地址 | 报 `未登录` 时不连试三次 | 源 skill 已知坑 |
| K9 | 内容真实性 | 只依据拉到的 content；短条目如实保留；不得编造 | 记录只有「配合取数」→ 保留，不写成开发工作 | 源 skill 第 3 步 |

**功能点**

📦 F1 月底日报汇总（doc-monthly-report）［核心］

在任意装了 cgraphx 的项目里输入 `/doc-monthly-report`
→ 确认月份（默认当月）、工作台地址、登录账号（默认只查本人，可 `--filler` 查别人）
→ 脚本登录工作台，拉全月日报记录，按日期分组
→ 每天把当天所有记录合并浓缩成一行（≤100 字，保留主线交付和关键数字，同类去重，不编造）
→ 输出 Markdown 表 + 「未列入」说明
→ 直接粘进月底日报表单

示例：

```markdown
| 日期 | 工作内容 |
|------|---------|
| 10.03 | 完成订单导出后台任务与接口，联调站内通知，自测 4 个边界场景 |
| 10.04 | 请假 |
```

未列入：10.05–10.06 周末休息；10.08 未填报；10.31 待填

⚠️ 边界：
① 地址过期（登录 DNS 失败 / 非 JSON / 连接失败）→ 先要新地址，不反复重试
② 拉回条数 < 接口 total → 不静默出表
③ 当月无记录 → 提示，不生成空表
④ 周末无记录列日期标「周末休息」；工作日缺报标「未填报」；月末最后一天未填标「待填」；周末有记录照常列入
⑤ 密码不进命令行、不落盘、不进本地 timeline 库
⑥ 法定节假日不识别（只按周末）；节假日无记录会落在「未填报」，需手动改
⑦ 只生成表，不自动提交工作台的月报表单（未核实到写接口）

⚓ 落地依据：
- 源 skill + `fetch-reports.mjs`（工作台 `/auth/login` + `/reports`，Node 标准库，按 `date` 分组）
- cgraphx 模板 skill 可带 `scripts/`，随 install 递归部署（init-ddl 先例）
- timeline 对 Bash 的 `tool_args` 原样入库（代码已核实），所以密码不能走命令行

🔗 关联：与 `doc-report` 的「月报」区分——doc-report 从 timeline 出汇报，本 skill 从工作台日报出填报表；doc-report 里加一句指路。

**建议新增（默认✂️）**

| 编号 | 建议 | 为什么不做 |
|---|---|---|
| — | timeline 交叉核对缺报（某天有开发事件但没填日报） | 先按源 skill 行为迁移，不加新数据源；要做可后续加 |
| — | 结果同时归档到 `docs/reports/monthly/YYYY-MM.md` | 不做：用户 2026-10-31 明确只在会话内提供，不归档 |
| — | 导出 xlsx | 源 skill 经 `my-office`，cgraphx 没有这个 skill；表单直接粘 |
| — | 月末自动提醒 | 没有常驻定时机制；每月自己敲命令 |

**边界外**：自动填报/提交工作台的月报表单（未核实到写接口）· 节假日日历（只按周末）· 把密码或地址存进仓库 · 迁移 `my-office` 等其他个人 skill · 补填/修改工作台日报 · 定时提醒。

**体验决策**

- 入口与触发：独立 `doc-monthly-report`，user-invoked（`disable-model-invocation: true`）；不并入 `doc-report`。
- 密码：终端隐藏输入或 `WORK_REPORT_PASS` 环境变量；不接受 `--password` 命令行；不落盘、不进本地 timeline 库。
- 旧副本：装完并验证新 skill 后，手动删 zqassis 里的旧 `monthly-report`；不登记 `deprecated-assets.json`。
- 结果：只在会话内提供 Markdown 表 + 未列入说明，不写文件、不归档（用户 2026-10-31 明确）。

## 怎么实现

### 细节方案：F1 月底日报汇总

| # | 决策 | 选择 | 没选的（为什么） | 理由（依据） | 影响面 |
|---|---|---|---|---|---|
| D1 🔒 | 入口与命名 | 新增独立 skill `doc-monthly-report`，目录 `assets/claude-template/skills/doc-monthly-report/`；frontmatter `disable-model-invocation: true`；命令 `/doc-monthly-report` | 沿用 `monthly-report`：不符合 2026-10-25 的 doc- 前缀约定，且旧副本不在 deprecated 清单可清理的范围内，只能手动删；并入 `doc-report` 的月报模式：doc-report 要背外部工作台依赖，两类报告口径不同，且会让 doc-report 变重 | CLAUDE.md「skill 名按使用阶段加前缀」；doc-report / doc-workload / doc-delivery / doc-backfill 均为 user-invoked（`docs/knowledge/skill-invocation轴.md`）；月报每月只跑一次，user-invoked 零常驻上下文 | 命令名、目录、指南/文档新增一行；旧副本清理绑在这个名字上 |
| D2 🔒 | 密码与参数输入 | 脚本不接受 `--password`；密码来源优先级：`WORK_REPORT_PASS` 环境变量 → `--password-stdin`（读 stdin 第一行）→ TTY 隐藏输入；都没有时报错并给出用法。账号 `--user` 或 `WORK_REPORT_USER`；`--filler` 默认等于账号；地址 `--base` 每次提供、不落盘 | 保留 `--password`（源 skill 的做法）：密码会进本地 timeline 的 `timeline_events.tool_args`；macOS 钥匙串：多一步初始化、仅 macOS，本次不做；把密码存 `.cgraphx/` 配置：源 skill 明确禁止 | `src/core/sync/cli.ts`：密码不进命令行，交互输入或 `--password-stdin`；`src/core/timeline/tool-args.ts` 只净化 Write/Edit，Bash 的 `tool_args` 原样入库；`src/core/sync/payload.ts` 的 `toIngestEvent` 只上报事件元数据，不上传命令内容 | 用户运行方式：设环境变量后由 agent 跑，或用 `!` 在终端跑脚本并隐藏输入；旧 `--password` 用法失效 |
| D3 | 脚本翻页与完整性 | 保留 Node 标准库 `.mjs`；按 `total` 翻页，`pageSize` 500，最多 100 页；取全后输出；任何一页失败或仍不完整 → 非 0 退出并打印 `拉取不完整:total=X,已取 Y`；不静默出表 | 维持只取第一页 + stderr 警告：用户得改脚本 pageSize，容易漏；一次取很大 pageSize：服务端可能限制 | 工作台 `/reports` 返回 `{list,total}`（源脚本已核实）；K7；源 skill 的翻页警告 | 月记录超过 500 也能取全；输出头部仍报 total |
| D4 | 脚本错误与地址判断 | 登录/拉取分别捕获：连接错误（ECONNREFUSED/ENOTFOUND/超时）、非 JSON、HTTP 非 2xx、`{"error":...}`；登录阶段优先提示「地址可能已更换，请提供新的工作台地址」；拉取阶段 401/`未登录` 提示「登录凭证失效，检查账号或脚本」；错误信息带 HTTP 状态和响应前 300 字符（不含密码/token） | 统一抛原始异常：用户看不出是地址还是密码；自动重试：源 skill 明确不要反复重试 | 源 skill「地址过期判断」；K8 | 脚本错误文案；skill 的边界处理 |
| D5 | Skill 正文与行为 | SKILL.md 照源 skill 的流程重写为 cgraphx 体式：定位 → 参数 → 拉取 → 语义浓缩 → 输出 → 收尾；保留 K1–K9；去掉「填写人默认 刘龙飞」「my-office 导出」；增加「工作日缺报」「周末有记录」处理；脚本路径写 `node <skill-dir>/scripts/fetch-reports.mjs`；示例给一张填好的表；说明密码在终端/环境变量，不在命令行 | 原样复制源 SKILL.md：个人默认值和失效引用会带进来，不符合 cgraphx skill 写法；大改行为：迁移以源行为为基准 | 源 SKILL.md / 脚本实读；本仓库 CLAUDE.md「写 skill 直接展示最好案例，避免啰嗦介绍」；init-ddl 的 `<skill-dir>` 先例 | SKILL.md 的提示词行为 |
| D6 | 旧副本清理 | 不登记 `deprecated-assets.json`；在新 skill 安装并验证后，手动删除 `/Users/smdnk/objects/java/hy/zqassis-service/.claude/skills/monthly-report/`（该目录未被 git 跟踪）；交付说明里写明这一步 | 登记 `skills/monthly-report` 自动删：会删任何项目里同名的个人 skill，违反 CLAUDE.md「清单只收录包曾经部署过的路径」；保留旧副本：两套 skill 同时触发 | `src/cli/installer/claude-assets.ts` 的 `cleanDeprecatedAssets`；CLAUDE.md 的清单约定；源目录 `git ls-files`、`git log` 均为空（未跟踪） | zqassis 本机一次手动操作；cgraphx 仓库不改清单；发布说明需提醒 |
| D7 | 文档与流程接入 | `FLOW-MAP.md`「其他能力」加 `/doc-monthly-report 月底日报汇总`；`cgraphx-guide/SKILL.md` 技能表加一行、「工作回顾按需」行加；`skills.html` 回顾与工具组加 `<details id="doc-monthly-report">`；`how-to-use.md` / `.html` 的「工作回顾」加一条；`CLAUDE.md` 的 skill 计数 31→32；`docs/knowledge/skill-invocation轴.md` 新增 2026-10-31 更新段（新增 doc-monthly-report、user-invoked；顺手校正旧段计数）；`doc-report/SKILL.md` 加一句指路。README 不改（只列主流程技能） | 只加 skill 不更新 router：用户找不到，违背 cgraphx-guide / FLOW-MAP 作为 router 的设计；改历史文档：不改 | 2026-10-25 改名提交与 2026-10-31 图表升级的同步范围；skill-invocation 轴；FLOW-MAP「其他能力」 | 文档；无程序代码 |
| D8 | 不加 CLI 命令 | 不加 `cgraphx work-report` 之类的命令；取数逻辑只在 skill 自带脚本里 | 新增 CLI 子系统：一次性外部 HTTP 取数，skill 脚本足够，且要长期维护命令兼容 | CLAUDE.md 的分工：skill 是主体，程序只补 skill 不可替代的能力；init-ddl / dev-migrate 的 scripts 先例 | 无程序改动、无测试目录 |

接口契约（脚本 CLI）：

| 项 | 内容 |
|---|---|
| 用法 | `node <skill-dir>/scripts/fetch-reports.mjs --base <url> --month YYYY-MM [--user <登录账号>] [--filler <填写人>] [--password-stdin]` |
| 凭证 | `WORK_REPORT_USER` / `WORK_REPORT_PASS`；无环境变量且无 `--password-stdin` 时，TTY 隐藏输入；不再接受 `--password` |
| 退出码 | 0 成功；1 参数/凭证/网络/接口错误；2 拉取不完整（`total` 与实际条数不符） |
| 输出 | stdout：`# <month> 日报汇总 (共 N 条，覆盖 M 个工作日)` + 范围/填写人 + 按日期升序的 `=== date ===` 分组，每条 `[workType/project/code] content`；不写文件 |

工作台接口（既有，不改）：

| 方法 | 路径 | 入参 | 出参 |
|---|---|---|---|
| POST | `{base}/auth/login` | `{username, password}` | `{token}` |
| GET | `{base}/reports` | `page`、`pageSize=500`、`startDate=YYYY-MM-01`、`endDate=YYYY-MM-<last>`、`userName=<filler>`；头 `Authorization: Bearer <token>` | `{list: [{date, workType, project, code, content}], total}` |

错误文案（技术包装）：

| 场景 | 文案 |
|---|---|
| 缺地址/月份 | `用法: node fetch-reports.mjs --base <url> --month YYYY-MM [--user <name>] [--filler <name>] [--password-stdin]` |
| 缺账号/密码 | `缺少凭证:设置 WORK_REPORT_USER/WORK_REPORT_PASS，或在终端交互输入密码` |
| 地址可能过期 | `工作台地址可能已更换（连接失败/非 JSON），请向用户要新地址后重试` |
| 登录失败 | `登录失败(HTTP <status>): <响应前 300 字符>` |
| 拉取未登录 | `接口返回未登录:检查 Authorization/token，再怀疑地址` |
| 拉取不完整 | `拉取不完整:total=<X>，已取 <Y>，不出表` |

### 全局约束

- 不新增 cgraphx CLI 命令、子系统或测试目录；程序改动只有 skill 自带的 `fetch-reports.mjs`。
- 密码不写入任何文件、不进命令行、不进本地 timeline 库；按 `cgraphx sync connect` 的既有约定。
- 脚本只用 Node 标准库；skill 内用 `node <skill-dir>/scripts/...`，随模板递归部署。
- 源 skill 的行为为基准；改动仅限：去个人默认值、去 `my-office`、密码输入、工作日缺报、翻页与错误文案。
- 不产生文件：结果只在会话内提供 Markdown 表 + 未列入说明（用户 2026-10-31 明确）。
- 不改工作台；不自动提交月报表单。
- `deprecated-assets.json` 不收录非包自带路径；旧副本清理是一次性手动操作。
- `doc-report` 保持 timeline 月报口径，只加指路，不改其行为。
- 新 skill 保持 user-invoked，与 doc- 系列一致。

## 设计验收

| # | 对应 | 验收点 | 怎么验 |
|---|---|---|---|
| 1 | D1 | 新 skill 随 `cgraphx install` 部署到临时项目：`.claude/skills/doc-monthly-report/SKILL.md` 与 `scripts/fetch-reports.mjs` 存在 | `npm run build` 后在临时目录跑 `node dist/cli/index.js install`；检查文件 |
| 2 | D3 | `total=1200` 时脚本翻 3 页取全，stdout 条数 = total；头部「共 1200 条」正确 | HTTPS stub（自签证书 + 测试时 `NODE_TLS_REJECT_UNAUTHORIZED=0`）或真实工作台 |
| 3 | K7 | 第二页失败/条数不足时退出码 2，打印「拉取不完整」，不输出任何表格 | stub 让第二页返回 500；检查 stdout/stderr/exit |
| 4 | K8 | 登录阶段连接失败/非 JSON → 提示地址可能更换；拉取阶段 `{"error":"未登录"}` → 提示检查 token | stub 返回对应响应 |
| 5 | D2/K6 | 带 `--password` 运行 → 明确报错；`WORK_REPORT_PASS` 或 TTY 输入可跑通；`cgraphx timeline query` 里看不到密码 | 命令行测试 + 查本地 DB |
| 6 | K3/K4/K5 | 固定样例（3 天记录 + 周末 + 工作日缺报 + 月末）生成表：每天一行 ≤100 字、日期 `M.DD`、未列入含周末/未填报/待填 | 用 stub 输出或真实数据跑一遍 skill，人工对照 |
| 7 | D7 | FLOW-MAP、cgraphx-guide 两页、CLAUDE.md、skill-invocation 知识条目均能搜到 `doc-monthly-report`；skill 计数 32；doc-report 有指路 | grep 检查 |
| 8 | 全局约束 | 运行后不产生 `docs/reports/monthly/` 或其他文件 | 运行前后 `git status` / `find` |
| 9 | D6 | 新 skill 安装验证后，zqassis 旧 `.claude/skills/monthly-report/` 删除；删除前确认新 skill 可用 | 人工一次；`ls` 检查 |

## 待确认项

- 【待确认】工作台 `/reports` 的 `date` 语义：源脚本按 `date` 过滤/分组。若它实际是提交日期而非工作日期，K1 要回 clarify 改；联调时用一天跨月提交的记录核实。不挡本 spec 的设计（脚本仍按 `date`）。
- 【待确认】旧副本删除是一次性本机操作（D6）：需你确认删除时机与授权；删除不可逆（旧目录未进 git）。
