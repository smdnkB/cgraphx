# T-3: 合入判断改读主目录本地分支

> 产物: plan
> 依据: spec@e839c10

- 目标:副本和主目录在同一个仓库里,合入判断直接读主目录的 `refs/heads/<需求分支>`,删掉跨仓库的 `fetch`;口径不变。
- 对应 spec 编号:F2(K9)、D10;K9
- 强制引用:`docs/guides/coding-standards.md`「边界与结构」「选型」
- 涉及范围:`src/core/replica/status.ts`(只改这一个文件,与 T-2 可同时跑)

## 必须严格执行

- C-6:导出 `mergeStateOf(mainRoot, entry)`,签名与返回值固定;`listReplicaStatus` 内部改用它。
- `merged`、`ahead` 的含义、`ownCommitsState` 的两条 `rev-list --count --first-parent --no-merges` 不改变。
- `ReplicaStatus`、`replica list` 的显示不变。

## 具体要求

1. `replicaBranchTip(mainRoot, entry)` 改成:
   - `runGit(mainRoot, ['rev-parse', '-q', '--verify', 'refs/heads/' + entry.branch])`;
   - 非零退出或 stdout 为空 → `''`(不再区分 `null`);
   - 不再跑 `ls-remote`,不再读 `entry.path`。
2. `mergeState` 改名为 `mergeStateOf` 并导出;删掉里面整段 `cat-file -e` + `fetch --no-tags ...` 的兜底(同一仓库,对象本来就在)。
3. 文件头与函数注释按新取法重写:不再说「主目录里还没有最新提交就先 fetch 对象」;保留「自己做的提交 = baseCommit 起第一父链非合并提交」「同步进来的别人的提交不算」这两段口径说明。
4. `statusOf` 里调用改名后的 `mergeStateOf`;文件里不出现 `fetch` 这个词(说明也用「取远程对象」)。`state` 为 `missing`/`removed` 时仍返回 `merged: null, ahead: null`(`statusOf` 的分支不改)——旧版写时复制副本的分支不在主目录,`present` 时也会因为 `tip === ''` 得到 `null`。

## 允许局部适配

- 私有辅助函数的名字、注释措辞;`replicaBranchTip` 是否内联进 `mergeStateOf`(只要 C-6 的导出还在)。
- 不新增任何字段、状态或命令。

## 完成条件

```bash
npm run build
grep -n "fetch\|ls-remote\|cat-file" src/core/replica/status.ts || echo "OK: 不再跨仓库取对象"
grep -n "export function mergeStateOf" src/core/replica/status.ts
```

构造一个临时仓库手工核对(可留到 index 的统一验证):分支存在且只同步过 → `merged` 为 true;ahead 计数与改动前一致;把副本登记指向一个不存在的分支 → `merged: null`。

## 提交点

1. `refactor(replica): 合入判断改读主目录本地分支——不再 fetch`: `src/core/replica/status.ts`

## 风险/注意事项

- `git rev-parse -q --verify` 失败与「分支不存在」都按 `''` 处理,不要保留 `null` 分支;`null` 会让旧副本的 `merged` 从 `null` 变成别的值。
- 不要顺手改 `ownCommitsState` 的排除逻辑(`^HEAD`、`--first-parent`、`--no-merges`):K9 的口径由它定。
- 删除 fetch 后,`entry.path` 不再参与合入判断;别把 `path` 相关的变量留成未使用(TS 会报)。
