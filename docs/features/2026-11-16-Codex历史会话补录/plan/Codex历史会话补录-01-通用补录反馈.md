# T-1：通用补录反馈

> 产物: plan
> 依据: spec@7e9527f

- **目标**：复用通用补录，向查询及补账清楚传递完整、部分和受阻状态，保持既有多来源与删除行为。
- **对应 spec 编号**：F1、K1–K4、D1–D4。
- **强制引用**：`docs/guides/coding-standards.md`、`docs/guides/interface-standards.md`。
- **涉及范围**：`src/core/timeline/ingest/ingest.ts`、`src/core/timeline/ingest/rebuild.ts`、`src/core/timeline/ingest/facts.ts`（新）、`src/core/timeline/ingest/coverage.ts`（新）、`src/core/timeline/index.ts`、`src/core/timeline/cli.ts`、`src/core/board/compute.ts`、`src/core/board/cli.ts`。
- **必须严格执行**：C-1、C-5；不修改来源注册、项目删除时间和标记、Codex 归档范围、数据库 schema；已有源键、锁、提交后推进偏移及文件故障隔离维持。
- **允许局部适配**：在范围内调整非公开 helper 拆分、局部类型和错误文案；如两个新文件不足以将现有 `ingest.ts` 拆至 600 行以内，按 PLAN_CONFLICT 上报。
- **具体要求**：
  1. 检查所有注册来源枚举、完整重建和增量路径，沿用各来源适配器与项目归属；未删除过项目时保证新项目已有文件不受旧进度误判而漏入库。不得通过重置其他项目进度或整体删除事件实现。
  2. 在现有状态基础上汇总 spec D4 的 coverage：来源为空、未归属、读取失败、锁、关闭、legacy、项目数据不可用，区分完整/部分/受阻；来源不存在与全部不存在按 C-1 处理；按现有门面导出可选 coverage。保留现有源码中其他调用方期望的状态值。
  3. 在时间线 query 前的 stderr 输出 C-1 状态和原因；保留已有查询输出、退出码、git hook 的静默和 board JSON；检查 installer、board 和 hook 的状态消费，不把内部 outcome 原样透传。
  4. 拆分 `ingest.ts` 时保留原有导出或兼容再导出，既有 `rebuild.ts` 调用不改语义；保持每个修改/新增源码文件不超过 600 行。
- **完成条件**：T-1 的文件变更仅限上述范围；运行 `npm run build` 成功；保持项目删除前后既有规则与旧查询 stdout。既有测试不得因改动变红，新测试由独立流程安排。
- **提交点**：1 笔 `feat(timeline): 完善通用会话补录状态`，仅包含上述 T-1 文件。
- **风险/注意事项**：共享项目锁与 `sessions.db` 非同一事务；先项目库提交再写偏移，不得删除其他来源数据或更改删除标记；不能为了反馈打破 hook fail-silent。
