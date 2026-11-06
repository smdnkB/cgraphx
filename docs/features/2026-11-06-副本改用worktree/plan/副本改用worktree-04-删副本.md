# T-4: 删副本改删 worktree,按合入情况处理分支

> 产物: plan
> 依据: spec@e839c10

- 目标:`cgraphx replica remove` 删的是 git worktree,删之前先按 K9 判断需求分支删还是留;目录已不在时 `git worktree prune` 后同样处理分支;结果带上分支与 warns。
- 对应 spec 编号:F3;D12、D13、D14;K13、K14、K10、K9
- 强制引用:`docs/guides/coding-standards.md`「边界与结构」「错误与日志」;`docs/guides/interface-standards.md`「输出」「退出码」
- 涉及范围:`src/core/replica/remove.ts`(重写)、`src/core/replica/types.ts`(只改 remove 结果)、`src/core/replica/cli.ts`(只改 remove 输出与描述)

## 必须严格执行

- C-7:`RemoveReplicaResult` 加 `branch: { name; state: 'deleted' | 'kept'; tip: string }` 与 `warnings: string[]`。
- C-6:用 T-3 导出的 `mergeStateOf(mainRoot, entry)` 算 K9;不要自己重算提交数。
- C-2:`listWorktreeRoots` 从 `src/core/repo-projects` 导入,用来核对「这个目录确实是本仓库的 worktree」。
- 五条核对的第一至四条(登记路径、不是主目录/上级、目录名前缀、`shared` 链接指回本主目录)与 K10 的 `uncommittedFiles` 判定不改。
- 删目录只用 `git worktree remove --force`;不要再用 `fs.rmSync`;文件头注释按新实现重写(不再说「删除只用 fs.rmSync」)。

## 具体要求

### 1. `verifyTarget` 加第五条核对(D13)

第四条(`shared` 链接)之后:

```ts
const worktrees = listWorktreeRoots(mainRoot);
if (worktrees === null || !worktrees.some((wt) => realpathOr(wt) === realDir)) {
  throw unsafeTarget(mainRoot, entry, '这个目录不是本仓库的 worktree');
}
```

`realDir` 用现有 `realpathOr` 算;`listWorktreeRoots` 报错也按这条不通过处理。

### 2. 分支结果(C-7 / D12 / K13)

抽一个私有函数(名字自定),在**删 worktree 之前**算好 K9、在删除之后执行分支操作:

```ts
const tip = gitValue(mainRoot, ['rev-parse', '-q', '--verify', `refs/heads/${entry.branch}`]) ?? '';
const removable = merged === true || (merged === false && ahead === 0);
```

- `tip === ''`(引用不在)→ `{ name: entry.branch, state: 'kept', tip: '' }`,不报错、不 warning。
- 不 removable → `{ name: entry.branch, state: 'kept', tip }`(log 里仍留着)。
- removable → `git -C <mainRoot> branch -D <entry.branch>`:
  - 成功 → `{ name: entry.branch, state: 'deleted', tip }`;
  - 失败 → warnings 加 `分支 ${entry.branch} 没删掉(${firstLine(stderr)});手动删:git branch -D ${entry.branch}`,结果 `state: 'kept'`,仍带 `tip`。

### 3. 目录在(`state: present`)的流程

1. `findActive`(按副本目录名、再按 feature-id)与 `not_main_dir` 判断不变。
2. `verifyTarget`(五条核对)→ 得到 `dir`。
3. `uncommittedFiles(dir)`:null → `unsafe_target`(现有文案);非空 → `dirty`(现有文案与 `files` 详情)。
4. `mergeStateOf(mainRoot, entry)` 得到 `{ merged, ahead }`(**此时 worktree 还在,分支也还在**)。
5. `git -C <mainRoot> worktree remove --force <dir>`;非零 → 抛
   `Error('删不掉 worktree(${firstLine(stderr)});${entry.name} 没删,在 ${mainRoot} 手动处理')`,不标已删。
6. 按第 2 节处理分支。
7. `markRemoved(mainRoot, entry.name, new Date().toISOString())`。
8. 返回 `{ name: entry.name, state: 'removed', branch, warnings }`。

### 4. 目录已不在(`state: missing`,D14)的流程

1. `git -C <mainRoot> worktree prune`(失败不拦,继续)。
2. `mergeStateOf(mainRoot, entry)`。
3. 按第 2 节处理分支。
4. `markRemoved`。
5. 返回 `{ name: entry.name, state: 'missing', branch, warnings }`。

### 5. `types.ts` 与 `cli.ts`

- `RemoveReplicaResult` 按 C-7;`ReplicaState`、`ReplicaStatus` 不动。
- `printRemove`:
  - `state === 'removed'`:`已删副本 ${name};登记留在主目录,副本里记下的会话和提交在项目的数据里`
  - `state === 'missing'`:`副本 ${name} 的目录已经不在了,已在登记里记为删除`
  - 然后按分支结果补一行:
    - `state === 'deleted'` → `分支 ${branch.name} 已删除`
    - `state === 'kept'` 且 `tip !== ''` → `分支 ${branch.name} 留着,提交还在`
    - `state === 'kept'` 且 `tip === ''` → `分支 ${branch.name} 不在主目录里,没有可处理的分支`
  - `warnings` 逐条走 `writeErr`(stderr,前缀 `[replica]`)。
- `remove` 子命令的 description 改成「删 worktree;按合入情况删/留需求分支」;`replica` 组的 description 不再说「写时复制」。
- `--json` 成功仍 `{ ok: true, ...结果 }`;失败形态与退出码不变。

## 允许局部适配

- 私有函数名、警告措辞(分支那句)、`printRemove` 的行顺序。
- 分支结果类型是内联写还是单独命名(必须与 C-7 的形状一致)。

## 完成条件

```bash
npm run build
grep -n "worktree remove\|worktree prune\|branch.*-D" src/core/replica/remove.ts
grep -n "fs.rmSync" src/core/replica/remove.ts || echo "OK: 不再直接 rm"
node dist/cli/index.js replica remove --help
```

再按 index「统一验证」冒烟跑 F3、K15 两段:`branch.state` 先 `deleted`、后 `kept`;`tip` 非空;`remove` 后 `git worktree list` 里没有该副本;旧版写时复制副本(同名、同路径、带 `shared` 链接,但不在 `git worktree list` 里)跑 `remove` → 停在 `unsafe_target`。

## 提交点

1. `feat(replica): 删副本改删 worktree——需求分支按合入情况删或留`: `src/core/replica/remove.ts`、`src/core/replica/types.ts`、`src/core/replica/cli.ts`

## 风险/注意事项

- K9 必须在删 worktree 之前算(分支还在;删完也能算,但先算更直观,且 K10 检查也在删之前)。
- `git branch -D` 必须放在 `git worktree remove` 之后:分支被 worktree 占用时删不掉。
- 目录已不在时先 `worktree prune`,否则残留记录会让 `git branch -D` 拒绝。
- `tip` 必须在删除之前取;删除后 `rev-parse` 取不到了。
- 分支删不掉的 warning 不得升级为错误:目录已经删了,登记还要标已删。
- 旧版写时复制副本不是 worktree,必须停在 `unsafe_target`,这是 spec「迁移与兼容」的要求;不要为了兼容放开第五条。
