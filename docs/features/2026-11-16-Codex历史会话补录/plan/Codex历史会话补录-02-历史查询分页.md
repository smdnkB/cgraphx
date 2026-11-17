# T-2：历史查询分页

> 产物: plan
> 依据: spec@7e9527f

- **目标**：在现有 timeline query 中提供稳定的完整历史分页，既有调用保持兼容。
- **对应 spec 编号**：F2、K5–K8、D9。
- **强制引用**：`docs/guides/coding-standards.md`、`docs/guides/interface-standards.md`。
- **涉及范围**：`src/core/timeline/types.ts`、`src/core/timeline/store.ts`、`src/core/timeline/indexer.ts`、`src/core/timeline/index.ts`、`src/core/timeline/cli.ts`、`src/core/timeline/page-cursor.ts`（新）。
- **必须严格执行**：C-2、C-5；T-1 的 C-1 状态不变。读取仅使用数据库适配器，分页模式保留首次快照筛选语义；原 query 函数和 stdout 保持兼容。
- **允许局部适配**：内部分页 helper、游标类型和 store/indexer 的局部函数名可按规范选择，不变更 C-2 的参数、字段、编码与错误映射。
- **具体要求**：
  1. CLI 添加 `--paged` 和 `--cursor <token>`；参数、过滤冲突和错误按 spec D9 分页接口契约执行；首轮只读连接取得 snapshot 最大 id，后续按游标恢复首次规范化过滤及页大小。
  2. store/indexer 支持 `id <= snapshot_max_id`、`(ts,id)` 严格升序及游标，返回完整事件列表和下一个游标；同 timestamp 不漏不重，新增的较早时间事件因 id 上界排除，空结果和最后一页输出 null。
  3. base64url UTF-8 JSON 游标保存要求字段并校验内容及数据库设备号/inode，数据库被删或更换、错误或不兼容参数走现有 ArgError；旧模式保持倒序数组/table、不被分页形态污染。
  4. 如分页读取必须走既有 CLI 的查询前补录，不得改变 C-2 快照上界的语义；旧调用方的 `queryEvents` 默认返回值保持数组。
- **完成条件**：变更仅限上述范围；`npm run build` 成功，既有无分页调用保持原契约且既有测试不变红；新增测试由独立流程安排。
- **提交点**：1 笔 `feat(timeline): 支持历史事件稳定分页`，仅包含上述 T-2 文件。
- **风险/注意事项**：不能按时间单键翻页；不能仅用时间窗切片绕过 1 万上限；分页续页须保留快照与过滤，诊断不上 stdout。
