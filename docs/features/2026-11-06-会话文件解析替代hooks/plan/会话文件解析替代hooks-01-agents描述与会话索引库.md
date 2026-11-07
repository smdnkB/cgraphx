# T-1: agents 描述扩展 + sessions.db 索引库

> 产物: plan
> 依据: spec@eac0b58

### 目标

agents 描述带上「会话文件在哪、用哪个读取器」;新建用户级 `~/.cgraphx/sessions.db`(四表)作为补录进度、开始目录归属、项目删除记录、提示记录的唯一存放;`project remove` / `project name` 挂上对它的新义务。

### 对应 spec 编号

D1(描述侧)、D2 🔒、D3(索引写入侧)、K3(删除记录)

### 强制引用

`docs/guides/coding-standards.md`(契约部分)、`docs/guides/data-standards.md`(例外:见 index 关键风险第 2 条,sessions.db 不走全量/增量双层——spec 全局约束)

### 涉及范围

- `src/core/agents/types.ts`、`src/core/agents/profiles.ts`、`src/core/agents/index.ts`
- 新增 `src/core/session-index.ts`
- `src/core/project/remove.ts`、`src/core/project/name.ts`

### 必须严格执行

- agents 描述新增字段与门面函数按 C-7(字段名、两家取值、`agentSessionsRoot` 的 env 优先规则、读取器标识)。
- sessions.db 的路径、权限、四表列名、`identity_key` 编码按 C-3;建表 SQL 写在 `session-index.ts` 内(幂等),不新增 `.sql` 资产文件、不改 `scripts/copy-assets.cjs`。
- `project remove`:`executeRemoval` 删完整项目数据后,用被删目录 `identity.json` 的标识写 `removed_projects`;只删备份(`backupsOnly`)不写。
- `project name`(改名):`renameProject` 与 `applyInstallName` 里对 `rewriteSessionRegistrations` 的调用替换为「清掉 `start_dirs` 中受影响根(siblings)的行」;**偏移不动**(已经记下的不挪)。`session-registry.ts` 本文件这一步不删(T-8 删),只是不再被 name.ts 调用。
- `session-index.ts` 不 import 任何子系统(基础层定位,同 `session-registry.ts` 现状);`notices_shown` 的 30 天清理在打开库时顺手做。

### 允许局部适配

- helper 函数命名与拆分(读/写 session_files、start_dirs、removed_projects、notices_shown 各自的函数形状)。
- sessions.db 连接的打开方式(复用 `DatabaseConnection.open` 后 chmod 0600,或直接 `createDatabase`;WAL 照基础层默认)。

### 具体要求

1. `AgentProfile` 加 `sessionsDir` / `sessionsDirEnv`(C-7 取值);`agents/index.ts` 导出 `agentSessionsRoot(profile): string | null`(`sessionsDir` 为 null 返回 null)与 `sessionReader` 字段的消费不做(读取器在 T-2)。
2. `session-index.ts` 至少导出:sessions.db 打开 + 幂等建表;`session_files` 的批量读(按 agent)、单行读写(path 主键);`start_dirs` 的按 cwd 读、写、按根集合删;`removed_projects` 的写与按 identity_key 查(含 removed_at);`notices_shown` 的查、写、30 天清理。并发写入安全靠 SQLite 自身(busy_timeout 沿用基础层 5 秒)。
3. `project/remove.ts`:`executeRemoval` 在 `fs.rmSync(dir)` 之后写 `removed_projects`(identity 读不出时不写,不报错)。
4. `project/name.ts`:两处 `rewriteSessionRegistrations(...)` 调用替换为 `session-index` 的清理函数;`import` 相应调整。

### 完成条件

- `npm run build` 通过;`npm test` 既有测试不红(name.ts 改动如弄红相关用例,同步修正断言)。
- 手工冒烟:临时 HOME 下建 sessions.db,四表存在、文件权限 0600;`project remove` 后 `removed_projects` 有行;`project name` 改名后 `start_dirs` 对应行被清、`session_files` 行不动。

### 提交点

1. `feat(agents): 描述新增会话文件根目录与读取器标识——agentSessionsRoot 按 CLAUDE_CONFIG_DIR 优先`:agents 三文件
2. `feat(timeline): 新增用户级 sessions.db 索引库——进度/开始目录/删除记录/提示记录四表`:session-index.ts、project/remove.ts、project/name.ts

### 风险/注意事项

- sessions.db 与项目库是两个库,别在项目库事务里碰它(跨库无法同事务)。
- `~/.cgraphx/` 根下已有 `sessions/`(旧会话登记,F6 重建后由 T-4 删);sessions.db 是文件,不与它冲突。
- 测试一律经 `__tests__/setup-home.ts` 临时 HOME,不碰真实 `~/.cgraphx`。
