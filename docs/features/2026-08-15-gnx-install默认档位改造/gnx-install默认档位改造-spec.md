# 规格说明: gnx install 默认档位改造

> feature-id: 2026-08-15-gnx-install默认档位改造
> 负责人: liulongfei
> 日期: 2026-08-15
> 实施仓库: GitNexus(/Users/smdnk/objects/ai/GitNexus,gitnexus/ 子包)— 本 spec 归档于 cgraphx 需求体系,代码改动全部落在 GitNexus 仓库

## 1. 目标与范围

### 目标

调整 gnx(GitNexus)`install` 命令的默认档位,使 gnx 作为 cgraphx 体系的**平级可选扩展**接入:用户安装 gnx 并执行 `gnx install` 后,自动获得环境层增强(MCP 工具自发现 + hooks 上下文注入),而**不向 `.claude/skills/` 部署任何 skill**——cgraphx 主线与 skill 命名空间零接触。

### 背景决策链(为何是这个形态)

- gnx 的 hooks(PreToolUse 对 Grep/Glob/Bash 的图谱上下文注入、PostToolUse 索引过期提醒)与 MCP(17 个分析工具 + 导航资源)不依赖 skill 即可完整工作,覆盖 gnx 价值的主干。
- skill 缺位的损失(场景分析工艺、手动 `/gnx-*` 入口、按功能区的模块 skill)对 cgraphx 集成场景是可接受的,其中管线 skill(gnx-plan/gnx-work/gnx-lfg)与 cgraphx 主线(write-plan → subagent-implement)职能重叠,不部署反而是收益。
- skill 安装能力对非 Claude Code hook 生态的用户仍有独立价值,故保留为显式开关而非彻底移除。

### 范围

- `gnx install` 的部署档位与 CLI 选项契约
- `gnx uninstall` 对新旧两种安装形态的清理完整性
- 与新档位对齐的安装清单(manifest)、CLI 提示文案(i18n)、README/CHANGELOG 文档

### 非目标

- 不改 gnx 的 `analyze`、hooks 运行时行为、MCP 工具面
- 不做 cgraphx 主线 skill 的任何软指针/门控接入(Tier 1,留待真实痛点单独立项)
- 不向 cgraphx 模板搬运/改写任何 gnx skill 内容
- 不改 cgraphx 仓库的任何代码(cgraphx 侧零改动是本需求的验收口径之一;cgraphx-guide 文档指路另行立项)

## 2. 已确认规格

### 2.1 `gnx install` 默认档(新契约)

| 项 | 行为 |
|---|---|
| 部署 MCP | 写入项目 `.mcp.json` 的 `gnx` server 条目(stdio,绝对 CLI 路径) |
| 部署 hooks | 复制 hook 脚本到 `.claude/hooks/gnx/`,并在 `.claude/settings.json` 注册 PreToolUse(Grep/Glob/Bash matcher)与 PostToolUse 两条 hook |
| 部署 skill | **不部署**。`.claude/skills/` 不出现任何 gnx 目录 |
| 幂等 | 沿用现状:重复执行不产生重复条目;已存在的 MCP 条目/hook 条目识别后跳过;JSONC 合并保留注释与兄弟条目 |

### 2.2 `--skills` 开关

- `gnx install --skills` = 默认档(MCP + hooks)**之上追加**安装全部 5 个 skill(gnx、gnx-plan、gnx-work、gnx-review、gnx-lfg)
- skill 保持 `disable-model-invocation: true`(manual-only)属性不变
- 不提供只装 skill 不装 MCP/hooks 的档位组合

### 2.3 `--full` 移除

- `--full` 选项**彻底移除**,不设兼容别名;传入 `--full` 按未知选项处理(命令行报错退出)
- 文档(README 等)中所有 `--full` 表述同步移除或改写为新契约
- 属破坏性变更,CHANGELOG 必须标注

### 2.4 `gnx uninstall` 兼容清理

- 清理范围维持四类资产全量:gnx skill 目录(含**旧版默认档/`--full` 安装的存量 skill**)、MCP 条目、hooks(脚本目录 + settings.json 条目)、安装清单
- 无论本项目当前是哪种安装形态,uninstall 都按"可能存在全部四类资产"清理——旧版装上的 skill 不得成为残渣
- 不触碰 `.gnx/` 索引数据(沿用现状)

### 2.5 CLI 路径解析失败 = 硬错误(已确认)

- 默认档与 `--skills` 档均含 MCP 部署,故该检查在两种档位下都执行:解析不到可用的 CLI 绝对路径 → 报错退出(非零)、**不写任何文件**
- 不提供"跳过 MCP、只装 hooks"的降级路径

### 2.6 安装清单与文案

- 安装清单(manifest)如实记录本次部署结果,表达新的档位语义
- CLI 完成提示与 i18n 文案(zh-CN / en)与新档位一致:默认档报告 MCP + hooks 已配置、skill 未安装及如何追加(`--skills`);不得再出现"`--full`"指引

## 3. 兼容性、迁移与存量

| 场景 | 预期 |
|---|---|
| 存量项目已用旧版装了 skill + MCP + hooks | 新版重跑 `gnx install`:MCP/hooks 幂等跳过;**已存在的 skill 不因默认档而删除**(skill 的移除只由 uninstall 或用户手动执行) |
| 存量用户习惯 `--full` | 升级后报"未知选项";CHANGELOG 给出迁移指引(默认档即原 `--full` 减 skill;需要 skill 用 `--skills`) |
| `.claude/settings.json` / `.mcp.json` 损坏 | 沿用现状:跳过写入保护既有内容并报告错误,不静默覆盖 |
| 同项目并存 cgraphx 部署物 | cgraphx 的 hooks/skills 条目不受影响(gnx 侧合并逻辑本就保留兄弟条目,本需求不改该逻辑) |

## 4. 异常与边界场景

- **CLI 路径解析失败**(无法将 gnx CLI 解析为绝对路径写入 `.mcp.json`,现实场景基本仅"从源码跑未构建的开发版"):**硬错误**——报错退出(非零退出码)、不写 `.mcp.json` 及任何文件,沿用现有报错文案语义。理由:MCP 条目与 hook 脚本均内嵌该绝对路径,写入错误路径会造成"安装看似成功、MCP 实际坏掉"的静默失败,比当场报错更难排查;不做降级部署
- hook 脚本复制部分失败:沿用现状(报告错误,提示 hook 可能运行时崩溃)
- 项目根不可写 / 非 git 仓库:沿用现有报错行为,本需求不扩展

## 5. 验收标准与测试关注点

1. **默认档**:干净项目执行 `gnx install` → `.mcp.json` 含 gnx 条目、`.claude/settings.json` 含两条 hook、`.claude/hooks/gnx/` 就位、`.claude/skills/` 无任何 gnx 目录
2. **`--skills` 档**:执行后默认档资产 + 5 个 skill 目录全部就位,且 skill frontmatter 保持 `disable-model-invocation: true`
3. **`--full` 拒绝**:执行 `gnx install --full` → 非零退出 + 未知选项报错
3a. **解析失败硬错误**:模拟 CLI 路径解析失败(如 `GNX_TEST_CLI_PATH` 指向不存在文件)→ 非零退出、`.mcp.json` / hooks / skills 均未被写入
4. **幂等**:同一档位连续执行两次,文件内容不变(无重复条目、无注释丢失)
5. **存量清理**:用旧版(或模拟旧版资产)安装 skill + MCP + hooks 后,执行新版 `gnx uninstall` → 四类资产全部移除,`.gnx/` 保留
6. **旧 skill 不误删**:存量项目(已有旧版 skill)执行新版默认 `gnx install` → skill 目录原样保留
7. **cgraphx 零改动**:cgraphx 仓库无任何代码/模板变更(文档指路属另行立项)
8. 测试关注点:install/uninstall 的既有测试需迁移到新契约;JSONC 合并、needle 识别、损坏文件保护等既有断言不回退

## 6. Plan 编写约束

- MCP/hooks 的部署与合并逻辑(JSONC 保留式合并、needle 识别、兄弟条目保护)**必须复用现有实现**,不重写
- uninstall 的清理范围只能扩不能缩(必须覆盖旧版存量 skill)
- manifest 具体结构(复用三布尔还是版本化)属纯工程手段,plan 自主
- CLI 选项命名以本 spec §2 为准(`--skills`),不得另起名
- README / i18n / CHANGELOG 更新与代码改动同批交付

## 7. 待确认项

(无。原 §7.1「CLI 路径解析失败策略」已于 2026-08-15 拍板为硬错误,升格为 §2.5。)

## 8. 关联需求记录

- cgraphx 侧文档指路(cgraphx-guide 可选扩展节 + FLOW-MAP 虚线支线):已确认与本需求分离、另行立项;此处仅记录关联,不构成本需求义务。
