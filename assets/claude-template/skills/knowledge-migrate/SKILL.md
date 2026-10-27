---
name: knowledge-migrate
disable-model-invocation: true
description: 把 Claude Code 的自动记忆迁进项目:项目里的决策、规则、教训进知识库(docs/knowledge/),每轮都要守的项目约定进项目根目录 CLAUDE.md,只关于本人的偏好进 ~/.claude/CLAUDE.md;迁完关掉本人在这个项目(含副本)的 Claude Code 自动记忆。主目录、副本里都能跑。Use when 迁移记忆 / 记忆迁进知识库 / 关掉自动记忆 / knowledge-migrate.
---

# 记忆迁进知识库 (knowledge-migrate)

## 定位

- **一次性搬家**:Claude Code 的自动记忆存在项目外(`~/.claude/projects/<编码>/memory/`),只有本人、只有这个目录读得到。迁进项目自己的三处去向,再关掉自动记忆,以后要记的东西都落到这三处。
- **只迁 Claude Code 的**:当前 agent 不是 Claude Code → 回一句「/knowledge-migrate 只迁 Claude Code 的自动记忆」,停下。
- **工具都是现成的**:读写文件、git、`node -e`、`cgraphx docs`;去向、过期、同一件事、矛盾由你判断。
- **记忆文件只读**:不删、不改、不挪,`MEMORY.md` 也不动。

## 去向

| 记忆讲的是 | 去向 | 例子 |
|---|---|---|
| 项目里的决策、规则、教训 | 知识库 `docs/knowledge/`,按 /knowledge-write 的写法 | 「code-subsystem 分支不并入 main」→ 决策;「正式材料不写防御性措辞」→ 规则,写汇报、对外文档时召回 |
| 每轮都要守的项目约定 | 项目根目录 `CLAUDE.md`,随仓库共享 | 「提交前先跑 npm test」 |
| 只关于本人的偏好 | 本人的 `~/.claude/CLAUDE.md` | 「回复用中文」 |

知识库是开工时按需召回的,每轮都要守的规则放进去会时灵时不灵;`.claude/CLAUDE.md` 里的 cgraphx 托管块升级时整块重写,不往那里写。

## 流程

### 1. 列目录,算记忆目录

要读的目录 = 主目录 + 全部副本:

```bash
cgraphx replica list --all --json   # 每个副本的 path、state(present / missing / removed);报未知命令 = 还没有副本功能,只读主目录
```

在副本里跑(`.cgraphx/shared` 是链接)时,主目录 = `dirname "$(realpath .cgraphx/shared)"`。

每个目录这样算记忆目录,删了的副本直接用登记的 path:

```bash
d=/Users/smdnk/objects/ai/cgraphx@订单导出
root=$(git -C "$d" rev-parse --path-format=absolute --git-common-dir 2>/dev/null) && root=$(dirname "$root") || root=$d
enc=$(node -e 'console.log(process.argv[1].replace(/[^a-zA-Z0-9]/g, "-"))' "$root")   # → -Users-smdnk-objects-ai-cgraphx-----
ls "${CLAUDE_CONFIG_DIR:-$HOME/.claude}/projects/$enc/memory/"
```

- `$enc` 超过 200 个字符:Claude Code 截断后接了哈希,改用 `ls -d "${CLAUDE_CONFIG_DIR:-$HOME/.claude}/projects/${enc:0:200}"-*/memory`。
- 目录的 `.claude/settings.local.json` 或 `~/.claude/settings.json` 里配了 `autoMemoryDirectory`(本地优先)→ 读那个目录。
- 几个目录算出同一个记忆目录(中文和 `@` 都编成 `-`,同字数的副本名会撞)→ 只读一次,「在哪」写全。
- 不用 `projects/<主目录的编码>-*` 通配找副本:会捞进别的项目,如 `-Users-smdnk-objects-ai-cgraphx-server`。

### 2. 读记忆

逐个读记忆目录里的 `*.md`,跳过 `MEMORY.md`(索引,每条只有一行摘要)。每条记忆看 frontmatter 的 `name`、`description`、`metadata.type`,正文是一句结论加 **Why:**、**How to apply:**;`originSessionId`、`modified` 是元信息,不迁。

同时看每个目录 `.claude/settings.local.json` 的 `autoMemoryEnabled`:已经是 false → 清单抬头提一句「主目录的自动记忆已经关过,可能迁过」。

一条记忆都没有 → 直接做第 5 步,回一句「没有要迁的记忆」。

### 3. 出迁移清单

每条记忆按「去向」定一处,再查四件事,写进「备注」:

- **已迁过**:`grep -rl "迁自 Claude Code 自动记忆 \`<name>\`" docs/knowledge/` 有结果 → 「已迁过,默认不迁」;两处 CLAUDE.md 里已有同义一条 → 「已有同义一条,不重复写」。
- **可能过期**:记忆里提到的分支、文件逐个核实(`git branch -a --list '*code-subsystem*'`、`ls <路径>`),不在了 → 「可能过期,默认不迁」。按意思认,别抠字面:「code-subsystem 分支」指的是 feat/code-subsystem。
- **同一件事**:按 /knowledge-write「合并检查」找候选(`cgraphx docs find --concept=<核心概念>`、`--q=<关键词>`,没建索引就 grep `docs/knowledge/`)→「怎么写」填「合进 `<已有条目>`」。
- **说法矛盾**:和已有条目说的相反 → 「说法矛盾,待你定」,清单下面摆出两段原文,问以哪个为准。

清单这样给:

> 读了 1 个目录的记忆:主目录 → `~/.claude/projects/-Users-smdnk-objects-ai-cgraphx/memory/`(3 条)。

| # | 记忆 | 在哪 | 去向 | 怎么写 | 备注 |
|---|---|---|---|---|---|
| 1 | code-subsystem 分支不并入 main | 主目录 | 知识库 · 决策 | 新建 `docs/knowledge/code-subsystem分支不并入main.md` | |
| 2 | 正式材料不写防御性措辞 | 主目录 | 知识库 · 规则 | 新建 `docs/knowledge/正式材料不写防御性措辞.md` | 写汇报、对外文档时召回 |
| 3 | 回复用中文 | 主目录 | 你个人的设置 | 追加到 `~/.claude/CLAUDE.md` 末尾(文件还没有,新建) | |

可以改去向(如「3 改成项目约定」),也可以划掉(如「划掉 2」);说「迁」就开始。

用户改了就按改后的重出清单;说「迁」才往下走,「迁」同时算作建索引的确认。

### 4. 写入

按这个顺序,任何一步失败就停下,不做第 5 步:

1. **知识库**:一条记忆一个条目,按 /knowledge-write 的 frontmatter、Summary、合并规则写;合进已有条目的,在它末尾加带日期的小节、更新 `updated`、合并 concepts。新条目照这个写:

   ```markdown
   ---
   title: code-subsystem 分支不并入 main
   document_type: decision
   domains:
     - 研发流程
   concepts:
     - code-subsystem 分支
   aliases:
     - feat/code-subsystem
   tags:
     - git
   status: active
   source_type: work_context
   owners:
     - liulongfei
   created: 2026-10-27
   updated: 2026-10-27
   ---

   # code-subsystem 分支不并入 main

   ## Summary

   feat/code-subsystem(代码图谱子系统,停在 plan T-4/9)保留分支、不并入 main;被要求「把分支都合进 main」时默认跳过并说明,用户点名要合才合。

   ## Context

   它带 tree-sitter、LadybugDB 原生可选依赖,和「无原生依赖」的定位冲突,功能也没接线;代码图谱现在走外部工具(gitnexus / codegraph)。

   ## Reuse Guidance

   合并分支、清理分支、发版前对齐分支时先读这一条。

   ## Evidence

   迁自 Claude Code 自动记忆 `code-subsystem-branch-kept-unmerged`(2026-10-27)。
   ```

   `document_type` 按内容取 decision / rule / lesson / mechanism;`source_type` 一律 `work_context`;`owners` 取 `git config user.name`。Summary 写结论和什么时候该召回,带上召回时的口语词(如「写汇报、对外文档」);Context 写 Why,Reuse Guidance 写 How to apply;Evidence 那一行照格式写,重跑时靠它认「已迁过」。
2. 每个文件跑 `cgraphx docs validate <文件>`,不合法就改到合法。
3. `cgraphx docs index`。
4. **项目约定**:写进当前目录的项目根目录 `CLAUDE.md`——有「## 项目约定」节就加在节末,没有就在文件末尾新建这一节,文件没有就新建。一条一行:`- 提交前先跑 npm test——CI 只跑构建,测试挂了合进去才发现`。
5. **个人设置**:追加到 `${CLAUDE_CONFIG_DIR:-~/.claude}/CLAUDE.md` 末尾,文件没有就新建。一条一行:`- 回复用中文,长任务中途也不漂成英文——连续工具调用后回复漂成过英文`。

### 5. 关自动记忆

对主目录和 `state` 为 `present` 的副本逐个做:

```bash
d=/Users/smdnk/objects/ai/cgraphx
if git -C "$d" ls-files --error-unmatch .claude/settings.local.json >/dev/null 2>&1; then
  echo "tracked"   # 被仓库跟踪:不写
else
  node -e '
    const fs = require("fs"), f = process.argv[1];
    const s = fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, "utf8")) : {};
    if (s.autoMemoryEnabled === false) process.exit(0);
    s.autoMemoryEnabled = false;
    fs.mkdirSync(require("path").dirname(f), { recursive: true });
    fs.writeFileSync(f, JSON.stringify(s, null, 2) + "\n");
  ' "$d/.claude/settings.local.json" &&
  { git -C "$d" check-ignore -q .claude/settings.local.json ||
    echo '/.claude/settings.local.json' >> "$(git -C "$d" rev-parse --path-format=absolute --git-path info/exclude)"; }
fi
```

- 打印 `tracked` 的不写:写进去一提交,队友的记忆也关了。回报里写「`.claude/settings.local.json` 被仓库跟踪,先 `git rm --cached .claude/settings.local.json` 再跑一次」。
- JSON 坏了 `node` 报错退出、不写,回报里写明是哪个文件。
- 不在 git 仓库里的目录只写设置,跳过忽略那一步。
- 之后开的副本会把这个被忽略的文件一起复制过去,不用再关。

### 6. 提交(只在版本分支上)

在主目录(不是副本)、当前分支形如 `dev/2.0.11`(`git branch --show-current` 匹配 `^dev/[0-9]+\.[0-9]+\.[0-9]+$`)时才提交,只提交本次写的知识库文件和项目根目录 `CLAUDE.md`:

```bash
git add docs/knowledge/code-subsystem分支不并入main.md docs/knowledge/正式材料不写防御性措辞.md
git commit -m "chore(release): Claude Code 记忆迁进知识库" -- docs/knowledge/code-subsystem分支不并入main.md docs/knowledge/正式材料不写防御性措辞.md
```

其余情况不提交,回报里列出改了哪些文件。

### 7. 回报

> 迁了 3 条:知识库 2 条,你的 CLAUDE.md 1 条;自动记忆已关(主目录),原来的记忆文件留在原处,新开的会话起不再加载。改了 `docs/knowledge/code-subsystem分支不并入main.md`、`docs/knowledge/正式材料不写防御性措辞.md`,没提交。

中途停下时:

> 写到建索引停下了:`cgraphx docs index` 报 database is locked。两个知识库条目已写好、校验通过;自动记忆还开着,处理好后再跑一次 /knowledge-migrate,已写的会标「已迁过」。

## 红线(绝对不能做)

1. ❌ **不删、不改、不挪记忆文件**,`MEMORY.md` 也不动。
2. ❌ **关记忆只写本人的 `.claude/settings.local.json` 和 `.git/info/exclude`**:不写签入的 `.claude/settings.json`、`~/.claude/settings.json`、项目 `.gitignore`。
3. ❌ **没说「迁」不写文件、不关记忆**;一条记忆都没有时例外,直接关。
4. ❌ **写入有失败就不关记忆**。
5. ❌ **写知识库不绕开 /knowledge-write 的规则**:`cgraphx docs validate` 不过不算写完;不往 `.claude/CLAUDE.md` 的 cgraphx 托管块里写。
6. ❌ **版本分支以外不提交**,不 push。
