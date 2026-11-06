# T-1: 描述层——extraConfigFiles 与 worktree 列表

> 产物: plan
> 依据: spec@e839c10

- 目标:agent 描述层能声明「除配置目录、指引文件外还要带走的配置文件」,基础层导出 `worktree list` 的结果给副本用。
- 对应 spec 编号:D2(带 agent 配置)、K4
- 强制引用:`docs/guides/coding-standards.md`「边界与结构」「选型」
- 涉及范围:`src/core/agents/types.ts`、`src/core/agents/profiles.ts`、`src/core/repo-projects.ts`(三个文件,与其它任务不重叠)

## 必须严格执行

- C-1:`AgentProfile` 加必填字段 `readonly extraConfigFiles: readonly string[]`;Claude Code 填 `['.mcp.json']`,CodeBuddy 填 `[]`。
- C-2:`listWorktreeRoots` 从 `src/core/repo-projects.ts` 导出,签名与行为不变。
- 不改 `AgentProfile` 的其它字段、不改 `AGENT_PROFILES` 的登记顺序、不改 `assetReplacements`;不改 `repo-projects.ts` 里三个已有导出函数的行为。

## 允许局部适配

- 字段注释的措辞;导入顺序;`profiles.ts` 里字段的摆放位置(放在 `instructionsFileName` 之后即可)。

## 具体要求

1. `src/core/agents/types.ts`:在 `instructionsFileName` 之后加

   ```ts
   /** 项目根下除配置目录、指引文件外还要带走的额外配置文件(相对项目根,如 .mcp.json)。 */
   readonly extraConfigFiles: readonly string[];
   ```

2. `src/core/agents/profiles.ts`:
   - `CLAUDE_CODE` 加 `extraConfigFiles: ['.mcp.json'],`
   - `CODEBUDDY` 加 `extraConfigFiles: [],`
   - 其余字面量一字不动。

3. `src/core/repo-projects.ts`:把 `function listWorktreeRoots(cwd: string): string[] | null` 改成 `export function ...`,文档注释保持原意(空行、`worktree ` 前缀、`path.resolve`、git 出错返回 `null`)。

## 完成条件

```bash
npm run build
grep -n "extraConfigFiles" src/core/agents/types.ts src/core/agents/profiles.ts   # 三处:类型 + 两个描述
grep -n "export function listWorktreeRoots" src/core/repo-projects.ts
```

`npm run build` 通过;`node dist/cli/index.js timeline --help` 能正常输出(证明 agents 描述被广泛使用后没崩)。

## 提交点

1. `feat(agents): 描述层加 extraConfigFiles——副本按它带 .mcp.json`: `src/core/agents/types.ts`、`src/core/agents/profiles.ts`
2. `refactor(project): 导出 listWorktreeRoots——副本据此跳过嵌套 worktree`: `src/core/repo-projects.ts`

## 风险/注意事项

- 新字段是必填,漏给任何一个 profile 都会编译失败——两个都填,CodeBuddy 用空数组。
- 不要在 `profiles.ts` 里写 `.claude` 之外的绝对路径,字段语义是「相对项目根」。
