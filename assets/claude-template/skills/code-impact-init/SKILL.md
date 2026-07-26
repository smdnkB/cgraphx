---
name: code-impact-init
description: Explore an unfamiliar project automatically. Discovers entry points, spawns sub-agents to explore each one in depth, saves knowledge documents, then merges and deep-dives into cross-cutting concepts. Requires code-impact-markdown skill. Use when the user asks to explore, understand, or map out a new project, or wants to build knowledge base for a project from scratch.
---

# Project Exploration

Automated project exploration skill. Discovers entry points, explores each in depth via sub-agents, saves knowledge to the local knowledge service, then merges cross-cutting concepts and deep-dives.

**Dependencies:**
- `code-impact-markdown` skill must be installed in the same project（沉淀业务理解到 `docs/knowledge/*.md`）
- cgraphx 已 `init` 的项目索引（提供代码结构事实：symbols / 调用链 / impact）。优先通过 `codegraph_explore` / `codegraph_impact` / `codegraph_node` 等 MCP 工具,不可用时走 Bash CLI(`cgraphx query` / `cgraphx callers` / `cgraphx callees` / `cgraphx affected`)。两者都不可用时降级为 grep 模式(精度损失,详见各 Phase 的 fallback 说明)

## Trigger

Use this skill when:
- The user wants to explore, understand, or map out an unfamiliar project
- The user wants to build a knowledge base for a project from scratch
- The user says things like "explore this project", "understand this codebase", "build knowledge for this repo"

Do NOT use for:
- Quick targeted questions about specific code (use `code-impact-api` instead)
- Creating a single knowledge document (use `code-impact-markdown` skill instead)
- 纯代码结构查询（直接用 `codegraph_explore` MCP 或 `cgraphx query` CLI 即可,无需走整套 exploration 流程）

## Service & Pre-flight Check

This skill assumes cgraphx CLI is available and the project is initialized.

```bash
CODEGRAPH="cgraphx"
command -v "$CODEGRAPH" >/dev/null 2>&1 || {
  echo "cgraphx 未在 PATH。先 npm install -g cgraphx,或在项目里跑 cgraphx init" >&2
  exit 1
}

# 验证项目已 init(.cgraphx/ 存在)
$CODEGRAPH status | grep -qiE 'up to date|indexed' || {
  echo "cgraphx 未 init 或索引 stale。跑:cgraphx init" >&2
  exit 1
}
```

If cgraphx is not available: do **not** silently degrade. Ask the user to run `npm install -g cgraphx && cgraphx init`.

## Configuration

```text
concurrent_agents: 2      # max sub-agents running in parallel（千万行级别建议 4-8）
max_explored: 5000         # max entry points to explore across both phases（千万行级可上调到 20000）
max_queue_size: 150        # max items in pending queue
wake_interval_seconds: 60  # seconds between loop iterations
max_fail_retries: 3        # 单个 entry point 最多重试次数，超过跳过并进 failed[]
use_cgraphx: true        # 优先用 cgraphx 查代码结构；false 时降级为 grep 模式（精度损失）
use_persistent_dedup: true # true: Layer 1 dedup 走 cgraphx docs seen-names(SQLite 持久化,跨中断恢复);false: 仅在内存中(不建议,中断会丢)
```

**项目规模预期**：

| 项目规模 | 推荐 max_explored | queue 文件预期大小 | 服务端 explored_entry_names 预期条数 |
|---------|-------------------|-------------------|--------------------------------------|
| 小（< 5 万行） | 100-500 | 恒定 ~5 KB | < 500 |
| 中（5-50 万行） | 1000-3000 | 恒定 ~5 KB | 1000-3000 |
| 大（50-500 万行） | 3000-8000 | 恒定 ~5 KB | 3000-8000 |
| 超大（> 500 万行 / 千万行级） | 8000-20000 | 恒定 ~5 KB | 8000-20000 |

queue 文件大小主要由 `pending`（≤150 项 × 约 200 字节）+ `failed[]`（通常 < 5% 探索数）+ `progress`（恒定 ~200 字节）决定。**dedup 状态完全在服务端 `explored_entry_names` 表**，queue 文件不再随 explored_count 增长，恒定 ~5KB 与 max_explored 无关。

**千万行级别现实建议**：

- 单次跑完可能数天到数周——务必利用 Resuming 中断恢复
- `concurrent_agents` 调到 4-8（前提是 API 配额够）
- `max_explored` 别超过 20000——超过这个数 Phase 3 cross-cutting 会指数级慢
- Phase 2 完成后的全量 analyze 单次可能跑数十分钟到几小时
- 切勿跳过 Step 0 语言选择 + Step 1 排除规则——跨语种裸 grep 在千万行项目跑不通

## 与 cgraphx 的协作（Tools Coordination）

code-impact-init 协调 cgraphx 的**两个互补子系统**：

| 子系统 | 命令前缀 | 索引对象 | 提供什么 | 重建时机 |
|------|---------|---------|---------|---------|
| **代码图谱** | `cgraphx query/impact/...` | 代码（`.java` / `.rs` / `.go` / ...） | symbols / 调用链 / execution flows / impact | 一次性，代码变了再 `cgraphx sync` |
| **markdown 知识库** | `cgraphx docs ...` | 业务知识（`docs/knowledge/*.md`） | concept / domain / 决策文档 / dedup 状态 | Phase 2 末尾 + Phase 3 末尾各一次 `cgraphx docs index` |

**分工**：代码图谱提供**代码事实**（callers / callees / impact 都是 tree-sitter 解析的真实结构），markdown 知识库沉淀**业务理解**（人为或 AI 提炼的概念、决策、约束）。两者**互不依赖**——index 时序独立，谁先谁后都行。

**子 agent 调用方式**：
- **CLI(推荐)**:`cgraphx <cmd>`——全局 npm 装在 PATH,或项目本地 `npx cgraphx`。稳定,无进程依赖
- **MCP(可选)**:`codegraph_explore` / `codegraph_node` / `codegraph_callers` / `codegraph_callees` / `codegraph_impact`——已在 `.claude/settings.local.json` allow;MCP server 跑着时省去 CLI 启动开销

**降级路径**：
- `use_cgraphx: false` 或 cgraphx 不可用 → 退化为纯 grep 模式（精度损失，见 Phase 1 Step 3 fallback）
- `cgraphx init` 失败 → 同上
- markdown 知识库不可用(项目未 init)→ 整个 code-impact-init **不可启动**（dedup 和文档持久化都靠它）

**index 时序图**：

```
Phase 1 Step 1.5:  cgraphx init（一次性，几分钟，建代码图谱）
Phase 1-2:         查询用 cgraphx query / callers / callees / affected CLI,或 codegraph_explore / codegraph_impact / codegraph_node MCP（毫秒级，子 agent 主用）
Phase 2 末尾:      cgraphx docs index（同步子 agent 写的 .md 到知识图谱）
Phase 3 Step 1:    【已 deprecated — 原 cgraphx impact CLI 已去除】用 codegraph_impact MCP 主观评估影响面,或等阶段 2 gitnexus impact 工具
Phase 3 Step 2:    cgraphx docs concepts --sort=doc-count 找高中心性 concepts
Phase 3 Step 3:    交叉验证 → cross-cutting pending
Phase 3 末尾:      cgraphx docs index（同步 Phase 3 文档）
```

## Queue File

All exploration state is persisted to:

```text
docs/knowledge/.exploration-queue.json
```

### Schema

```json
{
  "project_name": "project-name",
  "repo_id": "project-name",
  "repo_path": "/absolute/path/to/project",
  "started_at": "2026-05-01T10:00",
  "config": {
    "max_explored": 5000,
    "concurrent_agents": 2,
    "max_queue_size": 150,
    "max_fail_retries": 3,
    "languages": ["java", "kotlin"],
    "excludes": {
      "dirs": ["node_modules", "target", "build", "dist", "vendor", "third_party", ".git"],
      "files": ["*.min.js", "*.lock", "package-lock.json"]
    }
  },
  "phase": "exploration",
  "pending": [
    {
      "id": 2,
      "name": "Markdown Analysis Pipeline",
      "entry_files": ["src/analyzer/mod.rs"],
      "type": "module"
    }
  ],
  "next_id": 3,
  "explored_count": 1,
  "seen_normalized_names": [...],  // ⚠️ DEPRECATED(本版本起不再使用):dedup 状态完全在 cgraphx docs seen-names 持久化的 SQLite 表里。保留字段定义仅为向后兼容
  "failed": [
    {
      "id": 5,
      "name": "Some Broken Module",
      "entry_files": ["src/broken/mod.rs"],
      "type": "module",
      "fail_count": 3,
      "last_error": "BLOCKED: compile errors prevent exploration",
      "last_failed_at": "2026-05-01T10:45"
    }
  ],
  "progress": {
    "batch_no": 5,
    "last_batch_at": "2026-05-01T10:30",
    "eta_hours": 12.5,
    "pending_size": 47,
    "top_concepts": ["OrderService", "PaymentGateway", "CustomerExport"]
  }
}
```

**设计要点**：

- **不存 `explored` 全量** —— 已完成的探索产物从 `docs/knowledge/*.md` 反查（每个文档对应一次探索）。queue 文件恒定大小，不随已探索项增长。
- **`explored_count` 是独立 int 计数器** —— 每完成一项 +1，用于触发 `max_explored` 上限判断，不依赖任何数组长度。
- **`seen_normalized_names`** —— **⚠️ DEPRECATED(本版本起不再使用)**：dedup 状态完全在 `cgraphx docs seen-names` 持久化的 SQLite 表（`markdown_explored_entry_names`）。resuming 时直接信任 SQLite 数据，不读 queue 文件此字段。保留字段定义仅为向后兼容。
- **`failed[]` 持久化失败项** —— 每项记 `fail_count`，达 `max_fail_retries` 上限后永久跳过（不再重派）；千万行项目里少数 entry point 编译/解析失败不应阻塞整体进度。
- **`progress` 每批次更新** —— `batch_no` + `last_batch_at` + `eta_hours` + `pending_size` + `top_concepts`（最近 N 批次的高频 concept）。供 Resuming 与用户查询进度用。
- **`config.languages` / `config.excludes`** —— Phase 1 Step 0/1 的选择持久化到 queue 文件，Phase 2 子 agent prompt 读取它知道限定哪些后缀、排除哪些目录。
- **`next_id` 单调递增** —— 即使某项被剔除，id 不复用，便于日志对齐与调试。

`phase` values: `exploration` → `deep_dive` → `completed`

---

## Main Agent Workflow

### Phase 1: Seed Discovery

**Step 0 — 语言选择（必做，开始循环前）**

千万行项目跨语种 grep 等于全文搜索整个 monorepo，必须先用 `AskUserQuestion` 让用户选目标语言，把后续 grep/find 限定到对应后缀。

语言 → 后缀 + entry point 模式映射（用户可单选或多选 Mixed）：

| 语言 | 后缀 | entry point 模式 |
|------|------|-----------------|
| Java | `.java` | `public static void main`、`@GetMapping`、`@PostMapping`、`@RabbitListener`、`@Scheduled`、`@KafkaListener` |
| Kotlin | `.kt` | `fun main`、Spring 注解同 Java |
| Go | `.go` | `func main`、`cobra.Command`、`flag.Parse` |
| Rust | `.rs` | `fn main`、`clap::Parser`、`#[tokio::main]` |
| Python | `.py` | `def main`、`argparse`、`click`、`@app.route`、`@celery.task` |
| TypeScript | `.ts` `.tsx` | `app.listen`、`router.get`、`router.post`、`@Controller` |
| JavaScript | `.js` `.jsx` `.mjs` `.cjs` | `app.listen`、`module.exports`、`require.main === module` |
| C/C++ | `.c` `.cpp` `.cc` `.h` `.hpp` | `int main`、`WINAPI WinMain` |
| C# | `.cs` | `static void Main`、`[HttpGet]`、`[HttpPost]` |
| Ruby | `.rb` | `Rails.application.routes`、`Rake::Task` |
| PHP | `.php` | Laravel routes、Symfony annotations |
| SQL | `.sql` | `CREATE TABLE`、`CREATE INDEX`、`CREATE PROCEDURE` |
| Mixed | 用户自选组合 | 多后缀 union |

用户选定后把后缀列表存入 queue 文件 `config.languages: ["java", "kotlin"]`，后续 Phase 1/2 命令读取它动态生成 `--include`。

**Step 1 — 排除规则（必做）**

千万行项目大量第三方库、build artifacts、test fixtures 会污染 grep 结果。两条规则同时生效：

1. **显式排除目录/文件**：

```bash
EXCLUDE_DIRS=(node_modules target build dist out bin vendor third_party .venv vv env __pycache__ .git .idea .vscode .next .cache coverage)
EXCLUDE_FILES=('*.min.js' '*.min.css' '*.lock' 'package-lock.json' 'yarn.lock' 'go.sum' 'Cargo.lock' 'pom.xml.versionsBackup')
```

2. **尊重 .gitignore**：首选 `rg`（ripgrep，自动尊重 .gitignore 且并行）；无 `rg` 时 fallback 到 `grep` + 显式 EXCLUDE_DIRS。**禁止裸 `grep -rn`**（千万行级别会跑数小时）。

**Step 1.5 — cgraphx 索引检查/构建（如 `use_cgraphx: true`）**

cgraphx 提供 tree-sitter 解析的代码结构图谱（symbols / 调用链 / execution flows / impact）。后续 Phase 1 找 entry points、Phase 2 子 agent 查调用链、Phase 3 cross-cutting 都依赖它。**千万行项目 `cgraphx init` 通常几分钟完成**——一次性投入，后续查询毫秒级。

```bash
CODEGRAPH="cgraphx"
command -v "$CODEGRAPH" >/dev/null 2>&1 || {
  echo "cgraphx 未在 PATH。先 npm install -g cgraphx,或在项目里跑 cgraphx init" >&2
  exit 1
}

# 1. 检查索引新鲜度
$CODEGRAPH status

# 2. 不存在或 stale 时跑 init 或 sync
if ! $CODEGRAPH status 2>&1 | grep -qiE 'up to date|indexed|fresh'; then
  echo "cgraphx index missing or stale, running sync..."
  $CODEGRAPH sync   # 增量;首次或大规模结构变更用 $CODEGRAPH index(全量)
fi

# 3. 验证可用(应返回符号数据)
$CODEGRAPH query "main" --limit 5
```

**失败降级**（任一失败时）：
- `cgraphx status` 报"未安装/不可用" → 警告用户，把 `use_cgraphx` 设为 `false` 写回 queue 文件，后续走 grep 模式
- `cgraphx init` 失败 → 同上
- `cgraphx query` 返回空 → 可能 analyze 未成功，重试一次或降级

**MCP 模式（可选优化）**：如果 `cgraphx mcp` 已启动（或 Claude Code 自动启 MCP server），子 agent 可直接调 `codegraph_explore` / `codegraph_node` / `codegraph_callers` / `codegraph_callees` / `codegraph_impact` 等工具，省去 CLI 启动开销。`.claude/settings.local.json` 已 allow 这些 MCP 工具。

**Step 2 — Identify project root, repo_id, project name**

```bash
REPO_PATH=$(pwd)
REPO_ID=$(basename "$REPO_PATH")
PROJECT_NAME="$REPO_ID"
```

**Step 3 — Scan structure & entry points**

**首选：cgraphx 语义查询（如 `use_cgraphx: true`）**

cgraphx 基于 tree-sitter 实际符号解析，能找到 grep 漏掉的（同名方法、interface 实现、跨语言调用、被注解但模式不规则的入口）：

```bash
# cgraphx 已在 PATH(全局装)或在已 init 的项目里直接可用

# 按业务概念搜索符号(让用户给 3-5 个核心业务词)
cgraphx query "订单" --limit 30
cgraphx query "导出" --limit 30
cgraphx query "payment" --limit 30

# 找 Spring/消息驱动入口(按符号类型过滤,比 grep 注解名更准)
cgraphx query "@PostMapping" --limit 30
cgraphx query "@RabbitListener" --limit 30

# 对每个候选符号用 codegraph_explore MCP 拿调用链做初步验证(看 callers/callees 是否构成完整流程)
# MCP 不可用时走 CLI:
cgraphx callers com.example.OrderService.createOrder
cgraphx callees com.example.OrderService.createOrder

# 找数据模型(@Entity / CREATE TABLE)
cgraphx query "@Entity" --limit 30
cgraphx query "CREATE TABLE" --limit 30
```

cgraphx 返回结构化 symbols + execution flows，**比 grep 字符串匹配更准**——尤其在千万行项目里，同名方法/继承链/接口实现这些 grep 必漏。

**Fallback：grep 模式（`use_cgraphx: false` 或 cgraphx 不可用）**

千万行级别必须用 `rg`（ripgrep）。示例 Java + Kotlin：

```bash
# Project structure overview
rg --files -g '*.java' -g '*.kt' \
   -g '!node_modules/**' -g '!target/**' -g '!build/**' -g '!vendor/**' -g '!.git/**' \
   | head -100

# Entry points
rg --type java --type kotlin -n \
   '@(GetMapping|PostMapping|PutMapping|DeleteMapping|RabbitListener|Scheduled|KafkaListener)|public static void main|fun main' \
   | head -50

# Data models
rg --type java -n '@(Entity|Table)|CREATE TABLE' | head -30
rg --type sql -n '^CREATE TABLE' | head -30
```

**精度损失警告**：grep 模式会漏掉接口实现、跨语言调用、不规则命名的入口。建议在 cgraphx 不可用时降低 `max_explored` 上限或缩小语言范围。

**Step 4 — 构造 pending + 写 queue**

For each discovered entry point, create a pending item with `name`, `entry_files`, `type`。把 Step 0 选定语言 + Step 1 排除规则写入 `config.languages` 和 `config.excludes`——Phase 2 子 agent prompt 也会用到。

### Phase 2: Exploration Loop (Batch Mode)

**启动：**

1. 读取 `.exploration-queue.json`。
2. 如果 `pending` 为空，直接跳到 Phase 3。
3. 初始化计数器：`explored_count = 0`，`running_agents = 0`。

**批次循环：**

每轮循环执行以下步骤：

**Step 1 — 启动批次**

1. 计算本批次大小：`batch_size = min(concurrent_agents, pending.length)`。
2. 从 `pending` 头部取 `batch_size` 项。
3. 对每一项，用 `Agent` 工具启动后台 sub-agent（`run_in_background: true`），使用下方 Sub-Agent Template 作为 prompt。
4. 设置 `running_agents = batch_size`。

**Step 2 — 等待批次完成 + 失败分流 + 进度更新**

等待所有 `running_agents` 个 sub-agent 完成。收到每个完成通知时**按状态分流**：

**Case A — 成功**（返回正常 JSON，含 `document_path`）

1. 读取 sub-agent 返回的 JSON。
2. 更新队列文件（jq 原子改写）：
   - 把该项从 `pending` 移除
   - `.explored_count` +1
   - **不再写 `seen_normalized_names`**——completed entry name 通过 `cgraphx docs seen-names --add` 持久化到 SQLite 的 `markdown_explored_entry_names` 表（见下方写回脚本）
3. 对每个 `new_entry_point` 走 Dedup Rules（Layer 1 `cgraphx docs seen-names --check` + Layer 2 `cgraphx docs dedup`）：
   - 通过且 `pending.length < max_queue_size` 时，追加到 `pending`（`next_id++`）
   - 超过 `max_queue_size` 的新候选直接丢弃
   - entry point name 维度的 dedup 状态完全在 cgraphx 持久化的 SQLite 表（`markdown_explored_entry_names`）

**Case B — 失败**（子 agent 返回 `BLOCKED` / `NEEDS_CONTEXT` / error / 进程崩溃）

1. `fail_count++`（首次失败从 `pending` 移到 `failed[]`，记 `last_error`、`last_failed_at`）
2. **`fail_count < max_fail_retries`**：重新放回 `pending` 末尾，下批次重试（主 agent 可补上下文或换更强模型）
3. **`fail_count >= max_fail_retries`**：留在 `failed[]`，**永久跳过**——千万行项目里少数死项不应卡死整体流程

**Case C — 完成但产出可疑**（`DONE_WITH_CONCERNS` 或文档缺 Evidence）

按 Case A 处理，但把 `concerns` 记到 `progress.recent_concerns`（Phase 3 优先 review 这些项）。

**Step 2.5 — 批次结束更新 `progress`**

批次全部完成（`running_agents == 0`）后更新进度对象：

```bash
QUEUE="docs/knowledge/.exploration-queue.json"

# ETA: 已用小时 / explored_count × 剩余
ELAPSED_HOURS=$(jq -r 'now - (.started_at | fromdateiso8601) | floor / 3600' "$QUEUE" 2>/dev/null || echo 0)
REMAINING=$(jq -r '.config.max_explored - .explored_count' "$QUEUE")
ETA=$(awk "BEGIN { if ($ELAPSED_HOURS > 0 && $(jq .explored_count "$QUEUE") > 0) printf \"%.1f\", $ELAPSED_HOURS / $(jq .explored_count "$QUEUE") * $REMAINING; else print \"?\" }")

# top_concepts: 最近 5 篇 docs/knowledge/*.md 的 frontmatter concepts 取频率 top-5
TOP_CONCEPTS=$(ls -t docs/knowledge/*.md 2>/dev/null | head -5 | while read f; do
  awk '/^---$/{c++; next} c==1 && /^concepts:/{flag=1; next} flag && /^  - /{gsub(/^  - /,""); print}' "$f"
done | sort | uniq -c | sort -rn | head -5 | awk '{print $2}')

jq --argjson batch "$(jq '.progress.batch_no + 1' "$QUEUE")" \
    --arg last_at "$(date -u +%Y-%m-%dT%H:%M)" \
    --arg eta "$ETA" \
    --argjson pending "$(jq '.pending | length' "$QUEUE")" \
    --argjson top "$(printf '%s\n' "$TOP_CONCEPTS" | jq -R . | jq -s 'map(select(. != ""))')" '
  .progress.batch_no = $batch
  | .progress.last_batch_at = $last_at
  | .progress.eta_hours = $eta
  | .progress.pending_size = $pending
  | .progress.top_concepts = $top
' "$QUEUE" > "${QUEUE}.tmp" && mv "${QUEUE}.tmp" "$QUEUE"
```

**Step 2 成功项写回示例（cgraphx docs seen-names 持久化 + jq 改 pending/explored_count）：**

```bash
QUEUE="docs/knowledge/.exploration-queue.json"
TMP="${QUEUE}.tmp"
DONE_ID=2
DONE_NAME="客户导出 Batch"

# Layer 1 持久化：完成的 entry name 加入 cgraphx docs seen-names
# (CLI 内部会自动 normalize,主 agent 不需要预先 normalize)
$CODEGRAPH docs seen-names --add="$DONE_NAME" --json >/dev/null

# queue 本地只改 pending 和 explored_count(不再维护 seen_normalized_names)
jq --argjson id "$DONE_ID" '
  .pending |= map(select(.id != $id))
  | .explored_count += 1
' "$QUEUE" > "$TMP" && mv "$TMP" "$QUEUE"
```

**Step 2 失败项写回示例（达上限进 failed[]）：**

```bash
FAIL_ID=7
FAIL_ERROR="BLOCKED: compile errors"
FAIL_AT=$(date -u +%Y-%m-%dT%H:%M)

jq --argjson id "$FAIL_ID" --arg err "$FAIL_ERROR" --arg at "$FAIL_AT" '
  (.pending | map(select(.id == $id))[0]) as $item
  | .pending |= map(select(.id != $id))
  | .failed = ((.failed // []) + [$item + {fail_count: 3, last_error: $err, last_failed_at: $at}])
' "$QUEUE" > "$TMP" && mv "$TMP" "$QUEUE"
```

**Step 3 — 批次结束判断（不再每批次 index）**

当 `running_agents == 0`（本批次全部完成）时：

1. **不再触发 index**（千万行项目每批次 index 跑不通）。
   - Layer 2 dedup 仍可工作——它检查的是已 index 进图谱的 concept 名；新批次产出的 .md 在 Phase 2 末尾统一 index 时才进图谱。**代价**：Phase 2 内对全新 concept 的 Layer 2 dedup 会误判为"非重复"（因为图谱还没更新），但 Layer 1（cgraphx 持久化的 `markdown_explored_entry_names` 表）仍能挡住 entry point name 维度的重复，**这是可接受的精度损失**。
2. 如果 `.explored_count >= max_explored` 或 `pending` 为空，进入 **Step 4**（Phase 2 收尾 index）。
3. 否则回到 **Step 1** 继续下一批次。

**Step 4 — Phase 2 收尾全量 index（一次）**

Phase 2 全部完成后，触发**单次**全量 markdown 知识库 index：

```bash
$CODEGRAPH docs index --json
```

完成后进入 Phase 3。**千万行项目这步单次可能跑数十分钟到几小时**——耐心等，期间不读 queue 文件。

> `.explored_count` 是 queue 文件里的独立 int 计数器，每次 Step 2 Case A 完成一项时 +1（用 jq 原子操作）。

**Pipeline flow（每批次不 index，仅 Phase 2 末尾一次）：**

```
Time →
批次 1:  Agent 1 [===A===]  Agent 2 [====B====]
批次 2:  Agent 1 [===C===]  Agent 2 [==D==]
批次 3:  ...
批次 N:  [最终项] → Phase 2 结束
                       ↓ 一次性 docs index（阻塞，可能很久）
                   Phase 3（cross-cutting deep-dive）
                       ↓ 最终 docs index（一次）
                   completed
```

**为什么不能每批次 index？**

- `cgraphx docs index` 是**全量重建** markdown 知识库（清表后重扫所有 `docs/knowledge/*.md`）
- 千万行项目 docs/knowledge/ 可能有上千-上万 .md，单次 index 数十分钟到几小时
- 每批次跑 = 累计 N 批次 × 单次耗时，几天到几周
- 根本解是 markdown 知识库做增量 index endpoint（P0 #1，留作下一轮）

### Phase 3: Cross-cutting Deep-dive（基于 codegraph_impact MCP + cgraphx docs concepts 交叉）

> **【2026-07-05 deprecated notice】** 原Phase 3 依赖 `cgraphx impact <symbol> --json` CLI 返回 `{nodeCount, edgeCount, affected[]}` 用于脚本循环 + 数值排序。该 CLI 在阶段 1 已去除(实测无法替代 MCP)。当前替代:
> - **代码层面找高中心性 symbol** — 用 `codegraph_impact(symbol)` MCP 工具,从返回的格式化报告里**主观评估**影响面广度(返回文本包含 affected symbols 列表 + 树状结构,agent 看大小估计中心性)
> - **完整 nodeCount 排序机制** — 等阶段 2 gitnexus 内核迁入后,用 gitnexus 的 `impact` 工具(基于 KuzuDB + Cypher,支持结构化返回)
> - Phase 3 的"交叉验证"思路仍然有效,只是代码层面从"机器排序"降级为"agent 主观判断"

**核心思路**：cross-cutting concern = **代码层面被多个 entry 依赖的高中心性 symbol**（`codegraph_impact` MCP 评估)+ **业务层面已被多文档提及但无专属文档的 concept**（`cgraphx docs concepts --sort=doc-count` 测量）。两者交叉验证，比单纯靠 markdown concept 频率更准——concept 在 markdown 里出现可能是子 agent 主观判断，codegraph_impact 是代码事实。

**Step 1 — 代码层面：找高中心性 symbols（codegraph_impact MCP 主观评估）**

`codegraph_impact(symbol, depth)` MCP 返回该 symbol 的影响半径报告(affected symbols list + 树状结构 + 统计)。agent 看返回报告的**规模**(涉及的文件数 / 模块数 / 跨服务 hop 数)主观判断中心性。

**MCP 调用路径**(取代原 shell 循环):
```
对每个 Phase 2 探索到的 entry symbol:
  → 调用 codegraph_impact(symbol, depth=2) MCP
  → 看返回报告里 affected symbols 的数量 + 跨文件 / 跨模块分布
  → 主观标记"高中心性 / 中中心性 / 低中心性"
  → 取高中心性 top 30 作为 Phase 3 deep-dive 候选
```

**原 shell 脚本路径(已废弃,留作历史参考)**:
```bash
# 原 cgraphx impact CLI 已去除,以下脚本不工作,仅作历史参考
# CODEGRAPH="cgraphx"
# while IFS= read -r sym; do
#   $CODEGRAPH impact "$sym" --json 2>/dev/null \
#     | jq -r --arg sym "$sym" '[.nodeCount // 0, $sym] | @tsv' >> "$TMP"
# done <<< "$SYMBOLS"
# sort -t$'\t' -k1 -rn "$TMP" | head -30 > high-centrality-symbols.txt
```

**注释说明**：
- ~~`cgraphx impact <symbol> --json` 输出 `{symbol, depth, nodeCount, edgeCount, affected[]}`~~（CLI 已去除)
- **替代**:`codegraph_impact(symbol)` MCP 返回格式化影响半径报告,agent 主观评估规模
- 如果 `related_code` 字段是文件路径而不是 symbol，需要先 `cgraphx query --kind=function --kind=method` 在该文件下找 symbol，再调 codegraph_impact MCP

**MCP 调用优势**：
> 把 Phase 2 探索到的 entry symbols 喂给 `codegraph_impact` MCP 工具，agent 直接看结构化结果做判断,比 shell 循环 + 文件拼接更直接。

**为什么这么设计**：用 `codegraph_impact` MCP 评估中心性，不需要 cypher 接口;等阶段 2 gitnexus 内核迁入后可升级到结构化 nodeCount 排序。

被多个 entry 依赖的 symbol 就是代码层面的 cross-cutting concern（如业务项目的 OrderService、PaymentGateway、AuthMiddleware——它们的影响半径远大于工具类）。

**Step 2 — 业务层面：找高中心性 concepts（cgraphx docs concepts）**

```bash
# 拿所有 concept + 关联文档数,按 doc_count 排序(cgraphx docs concepts 已实现 --sort=doc-count)
$CODEGRAPH docs concepts --sort=doc-count --limit=30 --json \
  > high-centrality-concepts.json

# cgraphx docs concepts 已经返回 documentCount 字段,直接用
jq '[.[] | {name, doc_count: .documentCount}] | sort_by(-.doc_count) | .[:30]' \
  high-centrality-concepts.json
```

**Step 3 — 交叉验证：找"代码中心性高 + 业务无文档"的 concerns**

```text
对每个高中心性 symbol（Step 1，nodeCount >= 3）：
  - 该 symbol 对应的 concept 名是否已在 markdown 知识库？
  - 该 concept 是否已有 type: architecture/decision 的专属文档？
  - NO（代码中心性高 + 业务无专属文档）→ 加入 Phase 3 cross-cutting pending
  - 边缘 case：symbol 是工具类（util/helper）跳过——不算业务 cross-cutting
```

**Step 4 — 派 cross-cutting 子 agent**

对每个 cross-cutting concern 创建 pending item：
- `type: "cross_cutting_concept"`
- `entry_symbol`: 高中心性 symbol
- `entry_files`: `codegraph_impact(<symbol>)` MCP 报告里 affected symbols 的 `filePath`
- `related_documents`: markdown 知识库里连接到该 concept 的已有文档路径

跑 Phase 2 探索循环，但用下方的 **Cross-cutting Sub-Agent Template**（强调基于 `codegraph_impact` MCP + 已有文档整合，不重读代码）。

**Step 5 — Finalize**

1. 触发最终 markdown 知识库全量 index（同步 Phase 2 + Phase 3 所有文档）：

```bash
$CODEGRAPH docs index --json
```

2. （兜底）如果 Phase 3 期间代码有变化（不该有，但防御性检查），跑 cgraphx 同步代码索引：

```bash
$CODEGRAPH status | grep -qi 'up to date\|indexed' || $CODEGRAPH sync
```

3. 设置 `phase` 为 `completed`。
4. 告知用户探索完成，列出：已生成文档数 / 覆盖的 entry symbol 数 / 识别的 cross-cutting concern 数 / 永久跳过的 failed 项数。

### Dedup Rules (cgraphx docs seen-names Layer 1 + cgraphx docs dedup Layer 2)

Before adding new entry points to `pending`, run **two layers** of dedup. Layer 1 是 entry point name 维度（防功能重复入队），Layer 2 是 concept name 维度（防 markdown 知识库内重复 concept）—— 两者维度不同，都要做。

**Layer 1：Entry point name dedup（cgraphx docs seen-names --check，O(log N) SQLite 索引）**

主 agent 收集子 agent 返回的 new_entry_points names，一次性批量 check：

```bash
CODEGRAPH="cgraphx"

# 主 agent 收集子 agent 返回的 new_entry_points names,一次性批量 check
CANDIDATES=("客户导出 Batch" "export-customer-batch" "Knowledge Recall")

# 一次性 batch check(用逗号分隔 names)
CANDIDATES_CSV=$(IFS=,; echo "${CANDIDATES[*]}")
CHECK_RESP=$($CODEGRAPH docs seen-names --check="$CANDIDATES_CSV" --json)

# 提取通过 Layer 1 的候选(is_seen=false)
NEW=$(echo "$CHECK_RESP" | jq -r '.results[] | select(.is_seen == false) | .name')
echo "通过 Layer 1 的候选: $NEW"
```

cgraphx 内部 SQLite 的 `UNIQUE(project_path, normalized_name)` 索引提供 O(log N) 查询，比 bash grep O(N) 更快且 queue 文件不再增长。通过 Layer 1 的候选才进入 Layer 2（concept name dedup）。

**Layer 2：Concept name dedup（cgraphx docs dedup，单次批量）**

通过 Layer 1 的候选用逗号 join 后发给 `cgraphx docs dedup`：

```bash
# 把通过 Layer 1 的候选用逗号 join 后发给 cgraphx docs dedup
NEW_CSV=$(echo "$NEW" | paste -sd, -)
DEDUP_RESP=$($CODEGRAPH docs dedup --names="$NEW_CSV" --json)

# is_duplicate=true 的项 SKIP(concept 已在图谱);false 的项才入队
NEW_AFTER_DEDUP=$(echo "$DEDUP_RESP" | jq -r '.results[] | select(.is_duplicate == false) | .name')
echo "通过 Layer 2 的候选: $NEW_AFTER_DEDUP"
```

cgraphx docs dedup 内置 normalize + alias 匹配。`is_duplicate: true` 的项 SKIP（concept 已在 markdown 知识库）；`false` 的项才入队，同时通过 Layer 1 的候选会在被探索完成时由 Phase 2 Step 2 写回脚本通过 `cgraphx docs seen-names --add` 持久化到 SQLite 表（`markdown_explored_entry_names`）。

**Fallback**（`use_cgraphx: false` 时）：仅内存模式，主 agent 在 queue 文件维护 `seen_normalized_names`，但**不推荐**——中断会丢，且 queue 文件随 explored 增长，千万行项目性能不可接受。新项目一律用 cgraphx 持久化模式。

**File-level coverage is NOT a dedup signal** —— 一个文件可能含多个独立功能，已探索其中一个函数不代表整文件覆盖。

**框架 boilerplate 不进 dedup 流程**（根本不视为 entry point）：Spring 的 `@SpringBootApplication`、Express 的 `app.listen`、Axum 的 `Router::new` 等。

### Resuming After Interruption

If the queue file exists with `phase` not `completed`:

1. Read the queue file.
2. **dedup 状态完全在 cgraphx docs seen-names 持久化的 SQLite 表（`markdown_explored_entry_names`），resuming 时直接信任 SQLite 数据**——天然持久，**无需重建**。
3. **`failed[]`**：**保留**——已永久跳过的项不应被重新发现（千万行项目里反复卡同一项是致命浪费）。重新启动后这些 id 不再进 `pending`。
4. **`progress`**：保留 `batch_no`、`last_batch_at`，**重置 `eta_hours` 为 null**（中断期间没探索，旧 ETA 失真，下批次 Step 2.5 会重算）。
5. **`pending`** 校验：剔除 `entry_files` 已不存在的项；剔除与 `failed[]` 同 id 的项（兜底）。
6. 如果 `phase == exploration`：从 Phase 2 Step 1 重启批次（已 `explored_count +1` 的不重跑）。
7. 如果 `phase == deep_dive`：从 Phase 3 Step 1 继续（concept 聚合）。

Do NOT restart from Phase 1.

旧版本 queue 文件如果含 `seen_normalized_names` 字段，直接忽略 —— 新版 dedup 状态完全在 SQLite，不依赖 queue 文件。不需要扫 `docs/knowledge/*.md` 反向重建，cgraphx 持久化的 SQLite 表是单一数据源。

---

## Sub-Agent Template

Each sub-agent receives this prompt structure. Fill in the `{placeholders}` before launching.

```text
你是一个代码探索 agent。请深入探索以下入口点，尽可能详细。

【入口点】
名称：{name}
类型：{type}
起始文件：{entry_files}
起始符号：{entry_symbol}（如 com.example.OrderService.createOrder，cgraphx 索引定位用）

【工具优先级：cgraphx > Read（铁律）】

**强制**：所有代码结构查询先走 cgraphx。**Read 仅在需要看具体实现细节**（算法、注释、边界条件、错误处理分支）时使用——且优先按 cgraphx 给的位置信息定位行号再 Read，**不要 Read 整个文件**。千万行项目里 Read 整个文件是 context 黑洞。

```bash
CODEGRAPH="cgraphx"

# 1. 拿该入口符号的完整调用链(callers + callees)
$CODEGRAPH callers {entry_symbol}
$CODEGRAPH callees {entry_symbol}

# 2. 找相关 execution flows(同 process 下的其他入口)
$CODEGRAPH query "{name}" --limit 10

# 3. 看改动影响面(哪些其他模块依赖这个符号)—— 识别跨模块依赖
#    (返回 {symbol, depth, nodeCount, edgeCount, affected[]};用 nodeCount 作中心性指标)
$CODEGRAPH impact {entry_symbol} --json

# 4. callers/callees 返回的符号列表给出关联符号
#    对每个 callee 再 callers/callees 一次,递归追踪调用链
```

**Read 策略**：
- 仅当 cgraphx query/impact 输出指向某段具体实现，且需要看代码细节（算法、注释、错误分支）时
- 优先用 `Read offset/limit` 按 cgraphx 给的行号定位
- **单次任务最多 Read 30 个文件**，超过报 `DONE_WITH_CONCERNS` 并列出未覆盖部分

【已有业务知识 — 先查询再探索】

业务概念层面（不是代码层面）的已有知识用 cgraphx docs（markdown 知识库）：

```bash
# 已有 concept（避免在自己写文档时创建重复 concept 名）
$CODEGRAPH docs concepts --json

# 已有相关文档
$CODEGRAPH docs find --q="{name}" --limit=5 --json
```

**职责分工**：entry point name 维度的去重由**主 agent** 在入队前完成，你不需要做。发现新入口点时**全部报告**给主 agent（不预先过滤）。

【项目信息】
项目路径：{repo_path}
项目名称：{project_name}

【任务】
1. 从起始符号开始，用 cgraphx 拿完整调用链：
   - 跟踪函数调用链（至少 4-5 层深度，用 `cgraphx callers` / `cgraphx callees`）
   - 识别数据模型、状态转换、错误处理路径（cgraphx 给位置，Read 看实现）
   - 关注跨模块/跨文件的依赖关系（用 `codegraph_impact({entry_symbol})` MCP 看影响半径 + affected symbols)
   - 记录外部服务调用（数据库、消息队列、HTTP 调用——通常在 callees 里）

2. 识别业务概念和非显而易见的约束：
   - 核心业务实体和它们的关系
   - 隐含的业务规则（代码里没写注释但行为有约束的）
   - 潜在的陷阱和边缘情况

3. 发现新的独立入口点：
   - 当前入口点触发但未被探索的独立功能/流程
   - **全部报告**给主 agent，不预先过滤

【保存知识文档】
使用 code-impact-markdown skill 的完整流程保存文档：
1. 先调用 Skill 工具加载 code-impact-markdown skill，按其规范执行保存流程
2. 查询已有概念：$CODEGRAPH docs concepts --json
3. 复用已有概念名，新名称放 aliases
4. 文件名 kebab-case，基于入口点命名，保存到 docs/knowledge/
5. document_type 根据探索内容判断：流程探索→exploration，约束/陷阱→finding，架构模式→architecture，设计决策→decision
6. domains 填 [{project_name}]
7. source_type 填 ai_session
8. related_code 填实际探索过的文件路径（cgraphx query / impact 输出已有，直接复制）
9. 文档正文必须包含：Summary, Context, Findings, Evidence, Impact For Future Changes
10. **Write 后必须 `cgraphx docs validate <file>` 校验通过**（code-impact-markdown skill 的强制步骤）；非法则修 frontmatter 再 Write 再校验，直到合法

完成后只返回以下 JSON（不要返回文档内容）：
{
  "document_path": "docs/knowledge/xxx.md",
  "document_type": "exploration",
  "files_explored": ["src/xxx.rs", ...],
  "symbols_explored": ["com.example.X.foo", ...],
  "concepts_found": ["ConceptA", "ConceptB"],
  "new_entry_points": [
    {"name": "Feature X", "entry_files": ["src/feature_x.rs"], "entry_symbol": "com.example.FeatureX.run", "type": "api_route"}
  ]
}
```

---

## Cross-cutting Sub-Agent Template

For Phase 3 deep-dive items with `type: "cross_cutting_concept"`：

```text
你是一个代码探索 agent，负责对跨多个模块的核心概念做**整合分析**——不再重读代码，基于已有事实综合。

【目标概念】
名称：{name}
中心性 symbol：{entry_symbol}（被 N 个 entry 依赖的高中心性代码符号）
关联已有文档（Read 这些）：{document_paths}

【工具优先级：codegraph_impact MCP > Read 已有文档 > Read 代码】

1. **先看代码影响面**（codegraph_impact MCP）—— 知道这个 symbol 在多少模块/调用链里出现：

```
# MCP 调用(取代原 cgraphx impact CLI)
# 返回格式化影响半径报告:affected symbols + 树状结构 + 跨文件 / 跨模块分布
# 用报告规模作中心性,涉及的文件/模块分布看影响面
调用 codegraph_impact({entry_symbol}, depth=2) MCP
```

2. **Read 关联已有文档**（{document_paths}）—— 知道业务层面已经记录了什么。

3. **不要 Read 代码**（除非前两步明确指向某个具体实现且需要细节）—— Phase 2 已经探索过这些代码，重复 Read 是浪费 token。

【项目信息】
项目路径：{repo_path}
项目名称：{project_name}

【任务】
1. 用 codegraph_impact MCP 返回构建"代码影响面"：哪些模块/调用链依赖这个 symbol（看报告中 affected symbols 的 `filePath` 分布），跨多少文件/包，规模多大
2. 用已有文档（{document_paths}）构建"业务已知"：业务侧如何描述这个 concept
3. 找 gap：
   - 代码影响面 ≠ 业务已知 → 缺失视角（例：代码层面 OrderService 被 5 个模块调用，但业务文档只覆盖了 2 个）
   - 各文档之间矛盾（同一 concept 在不同文档描述不一致）
   - 整合视角（concept 在不同模块的完整生命周期、数据流、控制流）

【输出】
在 docs/knowledge/ 目录下创建整合文档。

document_type 建议：
- 揭示整体架构 → architecture
- 设计决策总结 → decision
- 流程整合 → exploration

frontmatter：
- related_documents 填引用的已有文档
- related_code 填 codegraph_impact MCP 报告里 affected symbols 涉及的高中心性文件
- concepts 填此核心 concept + 关联 concept

**Write 后必须 `cgraphx docs validate <file>` 校验通过**（同知识文档流程步骤 10）。

完成后返回 JSON：
{
  "document_path": "docs/knowledge/xxx.md",
  "document_type": "architecture",
  "files_explored": [...],
  "symbols_analyzed": [...],
  "concepts_found": [...],
  "new_entry_points": [...]
}
```

---

## Quality Rules

- Sub-agents must include `Evidence` section with actual file paths and code references.
- Documents without `Evidence` or `Impact For Future Changes` are flagged as low quality.
- Each sub-agent must explore at least 3 files (not just the entry file).
- New entry points must be genuinely independent — a helper function called by an already-explored entry is NOT a new entry point.
- When the project uses a framework (Spring, Express, Axum, Django), framework boilerplate is NOT an entry point. Only business logic matters.
