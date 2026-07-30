---
name: code-impact-init
description: Explore an unfamiliar project automatically to build a business knowledge base. Discovers entry points via grep/Read, spawns sub-agents to explore each one in depth, saves knowledge documents to docs/knowledge/, then merges cross-cutting concepts and deep-dives. Requires knowledge-write skill. Use when the user asks to explore, understand, or map out a new project, or wants to build a knowledge base for a project from scratch.
---

# Project Exploration

Automated project exploration skill. Discovers entry points via grep/Read, explores each in depth through sub-agents, saves knowledge to the local markdown knowledge base (`docs/knowledge/*.md`), then merges cross-cutting concepts and deep-dives.

**Dependencies:**
- `knowledge-write` skill must be installed in the same project（沉淀业务理解到 `docs/knowledge/*.md`）
- 项目有代码可读（`grep` / `rg` / `Read` 可定位符号、跟踪调用、看实现）
- `docs/knowledge/` 可写（知识文档沉淀目录）
- cgraphx CLI 可用（提供 `cgraphx docs` 系列命令管理 markdown 知识库：concept 索引 / dedup / 校验）

## Trigger

Use this skill when:
- The user wants to explore, understand, or map out an unfamiliar project
- The user wants to build a knowledge base for a project from scratch
- The user says things like "explore this project", "understand this codebase", "build knowledge for this repo"

Do NOT use for:
- Quick targeted questions about specific code（直接用 `grep` / `Read` 即可）
- Creating a single knowledge document (use `knowledge-write` skill instead)
- 单点代码定位 / 单函数实现查询（直接 `grep` / `Read`,无需走整套 exploration 流程）

## Pre-flight Check

This skill assumes the project has readable code and a writable knowledge directory.

```bash
# 1. docs/knowledge/ 可写
mkdir -p docs/knowledge

# 2. cgraphx CLI 可用（提供 cgraphx docs 系列：concept 索引 / dedup / validate）
command -v cgraphx >/dev/null 2>&1 || {
  echo "cgraphx 未在 PATH。先 npm install -g cgraphx（提供 markdown 知识库管理命令）" >&2
  exit 1
}

# 3. 项目有代码文件可读（简单的存在性检查）
test -n "$(find . -type f \( -name '*.java' -o -name '*.kt' -o -name '*.go' -o -name '*.rs' \
                                      -o -name '*.py' -o -name '*.ts' -o -name '*.tsx' -o -name '*.js' \) \
                              -not -path '*/node_modules/*' -not -path '*/.git/*' \
                              -not -path '*/target/*' -not -path '*/build/*' \
                       | head -1)" || {
  echo "未发现可探索的代码文件" >&2
  exit 1
}

# 4. 优先用 ripgrep（尊重 .gitignore、并行、千万行级别必需）
command -v rg >/dev/null 2>&1 || echo "警告：未装 rg，将退化到 grep（千万行项目性能不可接受）"
```

If cgraphx is not available: do **not** silently degrade. Ask the user to run `npm install -g cgraphx`（提供 `cgraphx docs` 知识库管理命令）。

## Configuration

```text
concurrent_agents: 2      # max sub-agents running in parallel（千万行级别建议 4-8）
max_explored: 5000         # max entry points to explore across both phases（千万行级可上调到 20000）
max_queue_size: 150        # max items in pending queue
wake_interval_seconds: 60  # seconds between loop iterations
max_fail_retries: 3        # 单个 entry point 最多重试次数，超过跳过并进 failed[]
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

code-impact-init 协调两类工具：

| 工具 | 提供什么 | 用途 |
|------|---------|------|
| **grep / rg / Read** | 代码事实（符号位置、调用关系、实现细节） | Phase 1 找 entry points、Phase 2 子 agent 探索代码、Phase 3 评估 symbol 中心性 |
| **cgraphx docs**（markdown 知识库） | 业务理解（concept / domain / 决策文档 / dedup 状态） | Phase 2 末尾 + Phase 3 末尾各一次 `cgraphx docs index`;dedup 用 `cgraphx docs seen-names` / `cgraphx docs dedup` |

**分工**：代码事实靠 `grep` / `rg` / `Read`（定位符号、跟踪调用链、看具体实现），markdown 知识库沉淀**业务理解**（人为或 AI 提炼的概念、决策、约束）。两者**互不依赖**——grep/Read 随时可用，markdown 知识库的 index 时序独立。

**子 agent 调用方式**：
- **代码探索**：`grep` / `rg`（ripgrep，尊重 .gitignore 且并行）/ `Read`（按行号定位实现细节）——通用工具，无进程依赖
- **markdown 知识库**：CLI `cgraphx docs <cmd>`——管理 concept 索引、dedup、validate

**降级路径**：
- markdown 知识库不可用（项目未装 cgraphx）→ 整个 code-impact-init **不可启动**（dedup 和文档持久化都靠它）

**index 时序图**：

```
Phase 1-2:         子 agent 用 grep/Read 探索代码，写 .md 到 docs/knowledge/
Phase 2 末尾:      cgraphx docs index（同步子 agent 写的 .md 到知识图谱）
Phase 3 Step 1:    grep 统计 symbol 跨文件引用数，评估中心性
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

用户选定后把后缀列表存入 queue 文件 `config.languages: ["java", "kotlin"]`，后续 Phase 1/2 命令读取它动态生成 `--include` / `--type`。

**Step 1 — 排除规则（必做）**

千万行项目大量第三方库、build artifacts、test fixtures 会污染 grep 结果。两条规则同时生效：

1. **显式排除目录/文件**：

```bash
EXCLUDE_DIRS=(node_modules target build dist out bin vendor third_party .venv vv env __pycache__ .git .idea .vscode .next .cache coverage)
EXCLUDE_FILES=('*.min.js' '*.min.css' '*.lock' 'package-lock.json' 'yarn.lock' 'go.sum' 'Cargo.lock' 'pom.xml.versionsBackup')
```

2. **尊重 .gitignore**：首选 `rg`（ripgrep，自动尊重 .gitignore 且并行）；无 `rg` 时 fallback 到 `grep` + 显式 EXCLUDE_DIRS。**禁止裸 `grep -rn`**（千万行级别会跑数小时）。

**Step 2 — Identify project root, repo_id, project name**

```bash
REPO_PATH=$(pwd)
REPO_ID=$(basename "$REPO_PATH")
PROJECT_NAME="$REPO_ID"
```

**Step 3 — Scan structure & entry points（grep / rg）**

千万行级别必须用 `rg`（ripgrep）。示例 Java + Kotlin：

```bash
# Project structure overview
rg --files -g '*.java' -g '*.kt' \
   -g '!node_modules/**' -g '!target/**' -g '!build/**' -g '!vendor/**' -g '!.git/**' \
   | head -100

# Entry points：HTTP / 消息驱动 / 定时任务 / 主入口
rg --type java --type kotlin -n \
   '@(GetMapping|PostMapping|PutMapping|DeleteMapping|RabbitListener|Scheduled|KafkaListener)|public static void main|fun main' \
   | head -50

# 数据模型
rg --type java -n '@(Entity|Table)' | head -30
rg --type sql -n '^CREATE TABLE' | head -30

# 按业务概念搜索（让用户给 3-5 个核心业务词）
rg -n '订单|order' --type java | head -30
rg -n 'payment' --type java | head -30
rg -n '导出|export' --type java | head -30
```

**对每个候选符号做初步验证**（看是否构成完整流程）：

```bash
# 拿到 entry 文件 + 行号后，Read 看实现
# 例：rg 给出 src/main/java/com/example/OrderService.java:42 @PostMapping("/orders")
# → Read src/main/java/com/example/OrderService.java offset=30 limit=40

# 跟踪调用链：在 entry 函数名上反向 grep 找调用方
rg -n 'createOrder' --type java            # 谁调用了 createOrder
rg -n 'PaymentGateway' --type java         # PaymentGateway 在哪些文件出现
```

**grep 模式局限**：字符串匹配会漏掉接口实现、动态分发、继承链覆盖、不规则命名的入口。建议：
- 结合 IDE 的"查找引用"语义（如可用），或多次 grep 同义词 / 别名
- 对每个候选 entry 至少 Read 一段实现，确认是业务逻辑而非样板（如 `@SpringBootApplication` 类不算业务 entry）
- 必要时缩小语言范围或降低 `max_explored` 上限

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
cgraphx docs seen-names --add="$DONE_NAME" --json >/dev/null

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
cgraphx docs index --json
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
- 千万行项目 docs/knowledge/ 可能有上千-上万 .md，单次 index 数十分钟到数小时
- 每批次跑 = 累计 N 批次 × 单次耗时，几天到几周
- 根本解是 markdown 知识库做增量 index endpoint（P0 #1，留作下一轮）

### Phase 3: Cross-cutting Deep-dive（grep symbol 中心性 + cgraphx docs concepts 交叉）

**核心思路**：cross-cutting concern = **代码层面被多个 entry 依赖的高中心性 symbol**（grep 统计跨文件引用数测量）+ **业务层面已被多文档提及但无专属文档的 concept**（`cgraphx docs concepts --sort=doc-count` 测量）。两者交叉验证，比单纯靠 markdown concept 频率更准——concept 在 markdown 里出现可能是子 agent 主观判断，grep 跨文件引用数是代码事实。

**Step 1 — 代码层面：找高中心性 symbols（grep 统计跨文件引用数）**

对每个 Phase 2 探索到的 entry symbol，用 `rg -l` 统计引用该 symbol 的文件数。被多个文件 / 模块引用的 symbol 即代码层面的 cross-cutting concern。

```bash
# 从 Phase 2 文档 frontmatter 收集候选 symbol / concept 名
SYMBOLS=$(awk '/^---$/{c++; next} c==1 && /^concepts:/{flag=1; next} flag && /^  - /{gsub(/^  - /,""); print}' docs/knowledge/*.md \
           | sort -u | head -100)

# 对每个 symbol 统计跨文件引用数
TMP=$(mktemp)
for sym in $SYMBOLS; do
  # 转义 regex 特殊字符
  esc=$(printf '%s' "$sym" | sed 's/[.[\*()+?{|\\^$]/\\&/g')
  count=$(rg -l "$esc" --type java --type kotlin 2>/dev/null | wc -l | tr -d ' ')
  printf '%d\t%s\n' "$count" "$sym" >> "$TMP"
done

# 按引用文件数降序，取 top 30
sort -t$'\t' -k1 -rn "$TMP" | head -30 > high-centrality-symbols.txt
rm -f "$TMP"
```

**指标说明**：
- `rg -l <symbol>` 返回包含该字符串的所有文件路径；`wc -l` 即"被多少文件引用"
- 这是 grep 层面的"影响半径"近似——比字符串频率更克制（每文件只算 1 次），适合识别被多个模块依赖的核心 symbol
- **局限**：同名方法 / 工具类名 / 通用词会虚高。建议人工筛一遍 top 30，剔除明显是 util / helper / 通用词的项

被多个文件引用的 symbol 就是代码层面的 cross-cutting concern（如业务项目的 OrderService、PaymentGateway、AuthMiddleware——它们的引用文件数远大于工具类）。

**Step 2 — 业务层面：找高中心性 concepts（cgraphx docs concepts）**

```bash
# 拿所有 concept + 关联文档数,按 doc_count 排序(cgraphx docs concepts 已实现 --sort=doc-count)
cgraphx docs concepts --sort=doc-count --limit=30 --json \
  > high-centrality-concepts.json

# cgraphx docs concepts 已经返回 documentCount 字段,直接用
jq '[.[] | {name, doc_count: .documentCount}] | sort_by(-.doc_count) | .[:30]' \
  high-centrality-concepts.json
```

**Step 3 — 交叉验证：找"代码中心性高 + 业务无文档"的 concerns**

```text
对每个高中心性 symbol（Step 1，跨文件引用数 >= 3）：
  - 该 symbol 对应的 concept 名是否已在 markdown 知识库？
  - 该 concept 是否已有 type: architecture/decision 的专属文档？
  - NO（代码中心性高 + 业务无专属文档）→ 加入 Phase 3 cross-cutting pending
  - 边缘 case：symbol 是工具类（util/helper）跳过——不算业务 cross-cutting
```

**Step 4 — 派 cross-cutting 子 agent**

对每个 cross-cutting concern 创建 pending item：
- `type: "cross_cutting_concept"`
- `entry_symbol`: 高中心性 symbol
- `entry_files`: grep 给出的引用该 symbol 的代表性文件路径（top 5-10）
- `related_documents`: markdown 知识库里连接到该 concept 的已有文档路径

跑 Phase 2 探索循环，但用下方的 **Cross-cutting Sub-Agent Template**（强调基于 grep 影响面 + 已有文档整合，不重读代码）。

**Step 5 — Finalize**

1. 触发最终 markdown 知识库全量 index（同步 Phase 2 + Phase 3 所有文档）：

```bash
cgraphx docs index --json
```

2. 设置 `phase` 为 `completed`。
3. 告知用户探索完成，列出：已生成文档数 / 覆盖的 entry symbol 数 / 识别的 cross-cutting concern 数 / 永久跳过的 failed 项数。

### Dedup Rules (cgraphx docs seen-names Layer 1 + cgraphx docs dedup Layer 2)

Before adding new entry points to `pending`, run **two layers** of dedup. Layer 1 是 entry point name 维度（防功能重复入队），Layer 2 是 concept name 维度（防 markdown 知识库内重复 concept）—— 两者维度不同，都要做。

**Layer 1：Entry point name dedup（cgraphx docs seen-names --check，O(log N) SQLite 索引）**

主 agent 收集子 agent 返回的 new_entry_points names，一次性批量 check：

```bash
# 主 agent 收集子 agent 返回的 new_entry_points names,一次性批量 check
CANDIDATES=("客户导出 Batch" "export-customer-batch" "Knowledge Recall")

# 一次性 batch check(用逗号分隔 names)
CANDIDATES_CSV=$(IFS=,; echo "${CANDIDATES[*]}")
CHECK_RESP=$(cgraphx docs seen-names --check="$CANDIDATES_CSV" --json)

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
DEDUP_RESP=$(cgraphx docs dedup --names="$NEW_CSV" --json)

# is_duplicate=true 的项 SKIP(concept 已在图谱);false 的项才入队
NEW_AFTER_DEDUP=$(echo "$DEDUP_RESP" | jq -r '.results[] | select(.is_duplicate == false) | .name')
echo "通过 Layer 2 的候选: $NEW_AFTER_DEDUP"
```

cgraphx docs dedup 内置 normalize + alias 匹配。`is_duplicate: true` 的项 SKIP（concept 已在 markdown 知识库）；`false` 的项才入队，同时通过 Layer 1 的候选会在被探索完成时由 Phase 2 Step 2 写回脚本通过 `cgraphx docs seen-names --add` 持久化到 SQLite 表（`markdown_explored_entry_names`）。

**Fallback**（`use_persistent_dedup: false` 时）：仅内存模式，主 agent 在 queue 文件维护 `seen_normalized_names`，但**不推荐**——中断会丢，且 queue 文件随 explored 增长，千万行项目性能不可接受。新项目一律用 cgraphx 持久化模式。

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
起始符号：{entry_symbol}（如 com.example.OrderService.createOrder，grep 关键词）

【工具优先级：grep 定位 → Read 看实现（铁律）】

**强制**：先用 `grep` / `rg` 定位符号、跟踪调用链，**只在需要看具体实现细节**（算法、注释、边界条件、错误处理分支）时用 `Read`——且优先按 grep 给的行号定位再 Read，**不要 Read 整个文件**。千万行项目里 Read 整个文件是 context 黑洞。

```bash
LANG_TYPES="--type java --type kotlin"   # 按 config.languages 动态生成
EXCLUDES=(-g '!node_modules/**' -g '!target/**' -g '!build/**' -g '!vendor/**' -g '!.git/**')

# 1. 拿该入口符号的调用方（谁调用了它）
rg -n $LANG_TYPES "${EXCLUDES[@]}" "{entry_symbol}"

# 2. 拿该入口符号的下游调用（它调用了什么——Read 入口函数实现后从函数体提取）
#    先定位入口函数实现位置：
rg -n $LANG_TYPES "${EXCLUDES[@]}" "func {entry_symbol}|def {entry_symbol}|void {entry_symbol}|fun {entry_symbol}"
#    然后 Read 该位置（offset/limit），从函数体里识别被调用的下游函数名
#    再对每个下游函数名 rg 找定义位置 → 递归追踪

# 3. 找相关同模块入口（按业务名搜）
rg -n $LANG_TYPES "${EXCLUDES[@]}" "{name}" | head -20

# 4. 看改动影响面（哪些其他文件引用了这个符号）—— 识别跨模块依赖
rg -l $LANG_TYPES "${EXCLUDES[@]}" "{entry_symbol}"
#    -l 只列文件名，文件数即"被多少文件依赖"，作中心性指标
```

**Read 策略**：
- 仅当 grep 输出指向某段具体实现，且需要看代码细节（算法、注释、错误分支）时
- 优先用 `Read offset/limit` 按 grep 给的行号定位
- **单次任务最多 Read 30 个文件**，超过报 `DONE_WITH_CONCERNS` 并列出未覆盖部分

【已有业务知识 — 先查询再探索】

业务概念层面（不是代码层面）的已有知识用 cgraphx docs（markdown 知识库）：

```bash
# 已有 concept（避免在自己写文档时创建重复 concept 名）
cgraphx docs concepts --json

# 已有相关文档
cgraphx docs find --q="{name}" --limit=5 --json
```

**职责分工**：entry point name 维度的去重由**主 agent** 在入队前完成，你不需要做。发现新入口点时**全部报告**给主 agent（不预先过滤）。

【项目信息】
项目路径：{repo_path}
项目名称：{project_name}

【任务】
1. 从起始符号开始，用 grep 跟踪完整调用链：
   - 跟踪函数调用链（至少 4-5 层深度，反向 grep 找调用方 + Read 实现提取下游调用）
   - 识别数据模型、状态转换、错误处理路径（grep 定位 → Read 看实现）
   - 关注跨模块/跨文件的依赖关系（用 `rg -l "{entry_symbol}"` 看影响面 + 跨文件分布）
   - 记录外部服务调用（数据库、消息队列、HTTP 调用——通常在函数体里，Read 时识别）

2. 识别业务概念和非显而易见的约束：
   - 核心业务实体和它们的关系
   - 隐含的业务规则（代码里没写注释但行为有约束的）
   - 潜在的陷阱和边缘情况

3. 发现新的独立入口点：
   - 当前入口点触发但未被探索的独立功能/流程
   - **全部报告**给主 agent，不预先过滤

【保存知识文档】
使用 knowledge-write skill 的完整流程保存文档：
1. 先调用 Skill 工具加载 knowledge-write skill，按其规范执行保存流程
2. 查询已有概念：cgraphx docs concepts --json
3. 复用已有概念名，新名称放 aliases
4. 文件名 kebab-case，基于入口点命名，保存到 docs/knowledge/
5. document_type 根据探索内容判断：流程探索→exploration，约束/陷阱→finding，架构模式→architecture，设计决策→decision
6. domains 填 [{project_name}]
7. source_type 填 ai_session
8. related_code 填实际探索过的文件路径（grep 输出已有，直接复制）
9. 文档正文必须包含：Summary, Context, Findings, Evidence, Impact For Future Changes
10. **Write 后必须 `cgraphx docs validate <file>` 校验通过**（knowledge-write skill 的强制步骤）；非法则修 frontmatter 再 Write 再校验，直到合法

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
你是一个代码探索 agent，负责对跨多个模块的核心概念做**整合分析**——基于已有事实综合，必要时按需 Read。

【目标概念】
名称：{name}
中心性 symbol：{entry_symbol}（被 N 个文件引用的高中心性代码符号）
关联已有文档（Read 这些）：{document_paths}

【工具优先级：grep 看影响面 > Read 已有文档 > Read 代码】

1. **先看代码影响面**（grep 跨文件引用）—— 知道这个 symbol 在多少模块/文件里出现：

```bash
LANG_TYPES="--type java --type kotlin"   # 按 config.languages 动态生成
EXCLUDES=(-g '!node_modules/**' -g '!target/**' -g '!build/**' -g '!vendor/**' -g '!.git/**')

# 列出所有引用该 symbol 的文件（含路径，看跨模块分布）
rg -ln $LANG_TYPES "${EXCLUDES[@]}" "{entry_symbol}"

# 看具体引用上下文（每个文件取一行，看是定义还是调用）
rg -n $LANG_TYPES "${EXCLUDES[@]}" "{entry_symbol}" | head -50
```

从文件路径分布看影响面：跨多少模块 / 包 / 服务，文件数即"被多少处依赖"。

2. **Read 关联已有文档**（{document_paths}）—— 知道业务层面已经记录了什么。

3. **按需 Read 代码**（仅当前两步明确指向某个具体实现且需要细节时）—— Phase 2 已经探索过这些代码，避免重复 Read 浪费 token。

【项目信息】
项目路径：{repo_path}
项目名称：{project_name}

【任务】
1. 用 grep 跨文件引用结果构建"代码影响面"：哪些模块/包依赖这个 symbol（看 `rg -l` 输出的文件路径分布），跨多少文件，规模多大
2. 用已有文档（{document_paths}）构建"业务已知"：业务侧如何描述这个 concept
3. 找 gap：
   - 代码影响面 ≠ 业务已知 → 缺失视角（例：代码层面 OrderService 被 5 个模块引用，但业务文档只覆盖了 2 个）
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
- related_code 填 grep 跨文件引用结果里涉及的高中心性文件
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
