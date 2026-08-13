# 规格说明: timeline项目根回溯修复

> feature-id: 2026-08-13-timeline项目根回溯修复
> 负责人: liulongfei
> 日期: 2026-08-13
> 业务 ID: 无(内部工具 bug 修复,无工单)

## 1. 背景与目标

### 1.1 背景(根因)

timeline 的 5 个 hook 子命令与查询/安装命令都把「当前工作目录」直接当项目根(`payload.cwd ?? process.cwd()`),没有向上回溯。Claude Code 会话工作目录随 agent `cd` 漂移之后:

- hook 在子目录 `mkdir .cgraphx/` 并写入 `timeline-current-turn.json`,散落垃圾目录;
- 子目录下无 `cgraphx.db`,`openTimelineDb` 抛 `TimelineSchemaError` 被吞成 stderr——该 cwd 期间事件**全部丢失**;
- 同一轮各 hook 的 cwd 可能不同 → turn 文件读写不一致 → `turn_id` / `duration_ms` 断裂;
- 查询命令(query/stats/show/recent)从子目录运行误报「未初始化」。

### 1.2 目标

修复项目根解析:从解析起点向上回溯到**最近的已初始化祖先**,使任意子目录 cwd 下 hook 照常记录、turn 链完整、查询侧可用;并一次性清理存量碎片目录。

### 1.3 范围(包含)

- `src/core/timeline` 内 5 个 hook 与查询/安装命令的项目根解析统一;
- 存量碎片目录的清理。

### 1.4 非目标(明确排除)

- 不改 hook 短进程架构、stdin payload 协议、turn 文件跨进程机制;
- 不做碎片事件数据合并(碎片目录无事件可合,见 3.4);
- docs / features 子系统的同类 cwd 默认值问题本次不动(已知相邻问题,后续另开);
- 不引入跨项目 / 全局共享根;
- web 读侧本次不动(plan 核实后仅记录,见 §5)。

## 2. 术语

- **解析起点**:hook 取 payload.cwd(缺失时 process.cwd());查询/安装命令取 process.cwd()。
- **已初始化**:某目录下 `.cgraphx/cgraphx.db` 文件存在(`cgraphx install` 的产物;裸 `.cgraphx/` 目录不算)。
- **碎片目录**:bug 时代散落的 `.cgraphx/`,内部仅有 `timeline-current-turn.json`,无 DB——判定签名见 3.4。
- **项目根**:解析结果目录;一个 `.cgraphx/cgraphx.db` 即一个项目根(「一个项目一个 DB」的产品模型)。

## 3. 已确认规格

### 3.1 根解析规则(核心)

1. 从解析起点所在目录开始,**逐级向上**;
2. 第一个满足「已初始化」的目录即项目根,**就近优先**(monorepo 子项目根不被仓库级根吞并);
3. 到文件系统根仍无命中 → **回退解析起点本身**,行为与现状一致(未初始化项目首跑零变化);
4. 以 DB 文件存在(而非裸 `.cgraphx/` 目录)为标记:碎片目录因无 DB 被跳过、继续向上找到真根——**存量碎片在清理跑之前即自愈**,不依赖清理先执行。

### 3.2 五个 hook 的行为

user-prompt / pre-tool-use / post-tool-use / stop / git-commit 五个 hook 的 **DB 写入路径与 turn 文件读写路径**都必须使用同一解析后的根。效果:

- 任意子目录 cwd 触发 hook → 事件写入根上的 `cgraphx.db`;
- `timeline-current-turn.json` 只在根的 `.cgraphx/` 创建/读取;
- 同轮跨 hook 的 turn 链与 `duration_ms` 恢复完整;
- turn 文件既有语义不变:整文件覆盖写、session_id 跨会话隔离、缺失/损坏容忍。

### 3.3 查询与安装命令

`timeline query / stats / show / recent / install / uninstall` 使用同一解析(起点 process.cwd())。从已初始化项目的子目录运行时读写根库,不再误报「未初始化」。

由此确定的行为边界:install/uninstall 解析到根后**作用于根**(install 幂等刷新根、uninstall 卸载根);已初始化祖先之下**无法再嵌套初始化新根**——如确需在子目录独立初始化,须在其祖先链上无任何已初始化目录的前提下运行(即 monorepo「要么根、要么子项目」的既有模型,不支持嵌套两层)。

### 3.4 存量碎片清理

- 碎片签名(必须全部满足):`.cgraphx/` 目录内**仅有** `timeline-current-turn.json` 一个条目,无 `cgraphx.db`、无任何其他文件或子目录;
- 命中签名 → 删除该 `.cgraphx/` 目录;含 DB 或含其他任何条目的 `.cgraphx/` 视为合法子项目根或用户数据,**不删、不合并**;
- 不做事件数据迁移/合并(代码现实中碎片目录在建库前即抛错,从未产生过事件数据)。

### 3.5 异常与降级

- 根解析过程中任何 IO/异常 → 回退解析起点,绝不让异常抛出到 hook 主流程(「绝不阻塞 Claude」契约不破);
- 清理失败只报 stderr,不中断其宿主命令;
- kill-switch(`NO_TIMELINE_ENV`)与 hook 退出码恒 0 的既有行为不变。

## 4. 关键约束

- 兼容性:stdin payload 协议、`.cgraphx/` 目录布局、DB schema、turn 文件格式(`{turn_id, session_id, ts}`)均不动;
- 回溯必须是纯目录存在性检查,不破坏 hook ~5ms 性能预算;
- 不引入新的外部依赖;
- 分层:改动全部落在 `src/core/timeline`,不得依赖 `src/cli` / `src/web`。

## 5. Plan 编写约束

- 根解析必须收敛为**单一共享函数**,五 hook 与查询侧复用,不得各自实现副本;
- 清理逻辑与解析逻辑分离;清理的挂载点(install 时扫描 / 独立入口)与触发时机由 plan 定,但必须幂等、失败可跳过;
- 测试落在 `__tests__/core/timeline/`,与现有测试风格一致;
- plan 探索时顺带核实 web 读侧是否存在同类根解析问题:若有,**仅记录**为已知问题,本次不改。

## 6. 验收标准与测试关注点

1. 已初始化项目 `a/`(含 `a/.cgraphx/cgraphx.db`),cwd = `a/b/c` 触发任一 hook → 事件写入 `a` 的库;`a/b`、`a/b/c` 下不新增任何 `.cgraphx/`;turn 文件只在 `a/.cgraphx/`;
2. cwd 祖先链上存在碎片目录(仅 turn 文件)→ 被跳过,仍解析到真根;
3. `a/b/.cgraphx/cgraphx.db` 与 `a/.cgraphx/cgraphx.db` 并存,cwd = `a/b/c` → 解析到 `a/b`(就近优先);
4. 无任何祖先初始化 → 回退 cwd,记录失败仅进 stderr,hook 退出码 0(与现状一致);
5. 查询命令从子目录运行 → 读到根库,不误报未初始化;
6. 清理:命中签名的目录被删;含 DB 或含其他条目的 `.cgraphx/` 完好保留;
7. `__tests__/core/timeline/` 既有测试全部保持通过(回归)。

## 7. 不可留到实现期的决策

业务决策已全部锁定(回溯标记 = DB 文件、就近优先、无命中回退起点、碎片签名、查询侧同修),无留待实现期拍板的业务口径。实现手段(解析函数形态与放置、清理挂载点、测试组织)归 plan。

## 8. 待确认项

无阻塞性待确认。一条告知性自查(不阻塞,清理签名已保证不误删):是否存在曾在子目录手动 `cgraphx install` 的目录——那种目录含 DB,会被就近优先规则继续当作合法子项目根。
