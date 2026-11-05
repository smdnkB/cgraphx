### T-4: replica 一个需求只开一个副本

> 产物: plan
> 依据: spec@1fedd36

- 目标: 同一个 feature-id 已有在用副本(present)时,`cgraphx replica create` 换个 `--prefix` 也开不出第二个,返回新错误码 `feature_has_replica` 并转告 F5③ 原文;副本已删(removed)或目录已不在(missing)的不拦。
- 对应 spec 编号: F5③、D13、边界 ③。(执行者据此读 spec 原文,不凭任务转述猜)
- 强制引用: `docs/guides/coding-standards.md`
- 涉及范围:
  - 修改:`src/core/replica/create.ts`、`src/core/replica/errors.ts`。
  - 与同一步同时跑的任务(T-1、T-5、T-6)不重叠。
- 必须严格执行:
  - 按 C-8——`REPLICA_ERROR_CODES` 数组加 `'feature_has_replica'`(注释「十个 code」的说法同步改);`create` 的校验链里(与 `assertNameFree`、`assertTargetFree` 同层)加一条:开之前 `listReplicas(mainRoot)` 查同 `featureId` 的登记,状态为 `present` → 抛 `ReplicaError('feature_has_replica', …)`,message 原文:「这个需求已经有副本 <副本目录名>;一个需求只开一个副本,要并行先把需求拆成几个需求目录」(<副本目录名> 取已登记副本的目录名,即登记条目的 name/basename);`missing`、`removed` 不拦;报错时什么都不建(校验放在任何写操作之前)。
  - 副本状态判定沿用 `src/core/replica/types.ts` 的 `ReplicaState`('present' | 'missing' | 'removed'),不发明新口径。
- 允许局部适配:
  - 校验函数的组织(独立函数或并入现有校验序列);
  - CLI 层展示(message 转告机制现状已把 ReplicaError 的 message 打出来,不用改)。
- 具体要求:
  - `--json` 失败输出沿用现有平铺结构(`ok/code/message`),新 code 自动带上,不加专属字段。
  - 拦截只看登记(feature-id + 状态),不看目标目录是否撞名(那是 `target_exists` 的职责,两条校验并存)。
- 完成条件:
  - `npm run build`、`npm test` 通过;
  - 手工冒烟(临时目录):造一个 feature-id 的 present 登记 → `cgraphx replica create <同 feature-id> --prefix 别的名字 --json` → `code: "feature_has_replica"`、无新目录;把登记改成 removed → 同命令不再被此条拦(走后续校验)。
- 提交点:
  1. `feat(replica): 一个需求只开一个副本——feature_has_replica`:上述两个文件。
- 风险/注意事项:
  - 不要动 `name_taken` / `target_exists` 的既有判定与文案(D13 只加一条,不改旧的);
  - dev-start 的「停下问用户」文字由 T-5 改,本任务只管程序侧。
