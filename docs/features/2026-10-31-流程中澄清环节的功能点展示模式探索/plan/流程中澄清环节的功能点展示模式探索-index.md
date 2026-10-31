# 实现计划: 流程中澄清环节的功能点展示模式探索

> 产物: plan
> 依据: spec@b83cff2

## 设计预览

原来澄清时,功能点是对话里的文字卡,只在收拢时给少数核心点画一张「用户 / 系统」泳道。这次在 dev-clarify 下新增一份 `功能点配图.md`,放选图表和七种图的画法、样式头、样例;dev-clarify 的 SKILL.md、讨论稿范例、审核 prompt 改成审卡时就按场景配图、写进讨论稿,卡片换成短卡;dev-spec、dev-handoff 按功能点收这些图;CLAUDE.md、FLOW-MAP 和 cgraphx-guide 四个说明文件同步说法。全部是 `assets/claude-template/` 下的 markdown,不改程序;设计文档那份画法不动。

**难回头的决策落在哪**(决策已在 spec 确认,这里核对落点,其余可略读)

| spec 决策 | 落在 | 怎么守住 |
|---|---|---|
| D1 🔒 新画法单独放 `功能点配图.md`,`泳道图画法.md` 只加一行指针 | T-1 新建 `dev-clarify/references/功能点配图.md`,给 `泳道图画法.md` 加一行;T-2、T-3 只引用这个路径 | 路径和章节名定死在 C-1;统一验证第 3 条查 `doc-delivery/` 零改动、`泳道图画法.md` 只多那一句 |

## 来源 spec 摘要

- spec:`docs/features/2026-10-31-流程中澄清环节的功能点展示模式探索/流程中澄清环节的功能点展示模式探索-spec.md`(指纹 b83cff2)
- 一句话:澄清时每个功能点按讲的东西配一种图(接口内逻辑、编排、状态、决策表、数据流、时序、泳道),审卡时就写进讨论稿看图改图,图随讨论稿进 spec。
- 细节方案 D1–D20,🔒 只有 D1(已确认);D20 和 D13 末尾那句是 plan 审核后回 spec 补的,都不是难回头的决策;待确认项:无。

## 范围

覆盖 spec 第一节全部功能点:F1 接口内逻辑图、F2 接口编排图、F3 审卡时就看图、F4 讨论稿 / spec / 交接都带图、F5 审核查图、F6 按场景选图。

## 明确不包含

- spec 第一节「不做」四条:渲染成图片放进对话;改既有接口时画「原来 / 现在」两张图;doc-delivery 设计文档的环节图;plan 画图、历史讨论稿和 spec 重画、cgraphx 程序与 web。
- 根目录 `.claude/`(部署产物)不改不提交。
- 不写测试(测试是代码完成后的独立流程;本次只改 markdown 资产)。

## 任务清单

路径都相对 `assets/claude-template/`。

| 任务 | 文件 | 对应 spec | 涉及范围 |
|---|---|---|---|
| T-1 新画法参考 | `plan/流程中澄清环节的功能点展示模式探索-01-功能点配图.md` | F1、F2、F6;D1–D6、D16–D19 | `skills/dev-clarify/references/功能点配图.md`(新建)、`skills/dev-clarify/references/泳道图画法.md` |
| T-2 dev-clarify 主流程 | `plan/流程中澄清环节的功能点展示模式探索-02-dev-clarify主流程.md` | F1(⓪)、F3、F4、F5;D7–D12、D14、D15、D20;措辞同步里 dev-clarify description 那一行 | `skills/dev-clarify/SKILL.md`、`skills/dev-clarify/references/功能方案-讨论稿范例.md`、`skills/dev-clarify/function-plan-reviewer-prompt.md` |
| T-3 下游与说明文档 | `plan/流程中澄清环节的功能点展示模式探索-03-下游与说明文档.md` | F4;D13(含 dev-spec 结构范例)、措辞同步(description 那一行除外) | `skills/dev-spec/SKILL.md`、`skills/dev-handoff/SKILL.md`、`CLAUDE.md`、`FLOW-MAP.md`、`skills/cgraphx-guide/SKILL.md`、`skills/cgraphx-guide/how-to-use.md`、`skills/cgraphx-guide/how-to-use.html`、`skills/cgraphx-guide/skills.html` |

拆法:全部是模板 / 文档类,合计 13 个文件,没到 15 个的上限;按模块切成三块是为了能同时跑:三块改的文件不重叠,只靠下面的 C-1–C-10 衔接。T-1 要画并渲染四张新样例,T-2 改 dev-clarify 的流程和范例,T-3 是下游 skill 和说明文档的同步。

## 执行顺序

- 第 0 步(主会话):先把需求目录 `docs/features/2026-10-31-流程中澄清环节的功能点展示模式探索/`(讨论稿 v1、v2,spec,plan)提交一笔,说明见「提交规范」。
- 第 1 步:T-1、T-2、T-3 **同时跑**(改的文件不重叠;共用的路径、名称、格式、样式头和范例新加的两节都在 C-1–C-10 定死,互相不读对方的产出)。
- 第 2 步:主会话跑「统一验证」。

## 必须严格执行的契约

### C-1 新文件和章节

- 路径:`assets/claude-template/skills/dev-clarify/references/功能点配图.md`
- 一级标题 `# 功能点配图`;二级标题依次为 `## 选图`、`## 框数`、`## 接口内逻辑图`、`## 编排图`、`## 状态图`、`## 时序图`、`## 数据流图`、`## 决策表`
- 引用写法:dev-clarify 的 SKILL.md 里写 `references/功能点配图.md`;dev-clarify 的 references 目录下写 `功能点配图.md`;别的 skill 写「dev-clarify 的 `references/功能点配图.md`」

### C-2 图种名称

单点图只用这七个名字:接口内逻辑图、编排图、状态图、时序图、数据流图、决策表、泳道图。不画图的两种去向,在选图表里写成「线框(/dev-wireframe):不画图,提示要不要出线框」「一句话:不画图,卡片写一句话」,别处提到就叫「线框」「一句话」。不再用「行为链图」指代单点图;「全景泳道图」照旧指「用户会这样用」那张。

### C-3 「Fx 怎么走」一节

- 节标题是加粗行 `**F<n> <功能点名>怎么走**`(例:`**F1 订单导出怎么走**`),不用 `#` 标题
- 位置:讨论稿功能点短表之后、「不做」之前,按 F 编号排;一节先一句说明,再接图
- 一节有两张以上图时,每个代码块前一行 `**图 <N> <名称>**`;编排图里有自己逻辑图的接口框加一行「判断见图 <N>」
- 和全景图「用户会这样用」画的是同一件事时不出这一节,功能点短表那一行写「见用户会这样用」

### C-4 短卡范例

dev-clarify ④ 的卡片范例原样用这张(代码块语言标记沿用原范例的无标记代码块):

```
📦 F1 订单导出  [核心]
   图:REQ-1024-订单导出-功能方案-v1.md「F1 订单导出怎么走」(编排图,3 条泳道,标黄 8 处)
   一句话:运营在订单列表点「导出」,后台取近 90 天(K2)的订单(K1),生成「订单导出_20261021.xlsx」
          (订单号 / 客户 / 金额(K3) / 退款 / 支付时间),做完站内通知去下载
   ⚠️ 边界:① 近 90 天没有订单 → 通知「近 90 天无数据」,不生成文件
           ② 没有导出权限的角色看不到按钮
   ⚓ 落地依据:orders 表有 paid_time 字段(本地 DDL 已核实);
      项目已有类似实现 report_export
   🔗 关联:与「导出记录查看」共用任务表
   🎭 体验变体:后台任务+完成通知(图里画的这种,立刻返回,做完提醒)
              vs 等待框(用户盯着转圈,最长 30 秒)
```

### C-5 措辞替换

只换下表「原文」那一段,前后文不动;HTML 只改文本节点,标签和属性不动。

| 文件(相对 `assets/claude-template/`) | 原文 | 改成 |
|---|---|---|
| `CLAUDE.md` | 人审稿式改稿,结束时给《需求功能方案》,多功能点需求另写一份带 PlantUML 流程图的讨论稿 | 人审稿式改稿(每个功能点按场景配图,审卡时就写进 PlantUML 讨论稿),结束时给《需求功能方案》 |
| `FLOW-MAP.md`(第 14 行) | 多功能点需求另写 PlantUML 讨论稿 | 画了图的需求另有 PlantUML 讨论稿,审卡时就写 |
| `FLOW-MAP.md`(第 54 行) | 多功能点需求的流程图在讨论稿里 | 各功能点的图和全景图在讨论稿里 |
| `FLOW-MAP.md`(第 55 行) | clarify 出,多功能点需求才有,不登记 | clarify 出,画了图的需求才有,不登记 |
| `skills/cgraphx-guide/SKILL.md`、`skills/cgraphx-guide/how-to-use.md`、`skills/cgraphx-guide/how-to-use.html`、`skills/cgraphx-guide/skills.html`(各一处) | 多功能点需求另写一份带 PlantUML 流程图的讨论稿 | 每个功能点按场景配图,写进 PlantUML 讨论稿 |
| `skills/dev-clarify/SKILL.md`(frontmatter 的 description) | 全部功能点锁定后收拢《需求功能方案》(多功能点需求写一份带 PlantUML 流程图的讨论稿) | 审卡时每个功能点按场景配图(接口逻辑、编排、状态、时序、数据流、决策表、泳道)写进讨论稿,全部功能点锁定后收拢《需求功能方案》 |

### C-6 框数规则原文

> 单点图不超过 25 个框:活动、判断、开始 / 结束算;连接点、note、合并菱形不算。全景图「用户会这样用」仍是 15 个。超了:新接口按段拆成两张(如「参数和开关」「业务规则」);改既有接口只画改动那段,前后各留一个判断,其余合成一个框「其余 N 个判断不变」;编排图按页面或阶段拆,一段一张。

### C-7 改法候选标题行

`**改法候选(待确认,影响边界 ③ ④)**`,括号里按实际受影响的边界编号写;紧贴原图下面,再接候选图。一个功能点同时只放一张候选,候选不算新版本;采纳就用候选替换原图、删掉这一行,不采纳就把候选和这一行一起删掉。

### C-8 审卡中标记行

`> 审卡中,收拢时补齐其余各节。`,放在讨论稿两行头注(不是契约;查看提示)之后。

### C-9 样式头

每个 PlantUML 代码块自带一份,同一图种逐字一致;决策表是 Markdown 表,没有样式头。

- C-9a 泳道类(泳道图、接口内逻辑图、编排图):照 `泳道图画法.md` 里那段样式头,不改。
- C-9b 状态图:

```text
@startuml
skinparam backgroundColor #FFFFFF
skinparam state {
  BackgroundColor #F1F1F1
  BorderColor #181818
  FontColor #000000
  ArrowColor #181818
}
hide empty description
```

- C-9c 时序图:

```text
@startuml
skinparam backgroundColor #FFFFFF
skinparam ArrowColor #181818
skinparam sequence {
  LifeLineBorderColor #181818
  ParticipantBackgroundColor #F1F1F1
  ParticipantBorderColor #181818
  ActorBackgroundColor #F1F1F1
  ActorBorderColor #181818
  GroupBorderColor #181818
}
```

- C-9d 数据流图:

```text
@startuml
skinparam backgroundColor #FFFFFF
skinparam rectangle {
  BackgroundColor #F1F1F1
  BorderColor #181818
  FontColor #000000
}
skinparam package {
  BackgroundColor #FFFFFF
  BorderColor #181818
  FontColor #000000
}
skinparam ArrowColor #181818
left to right direction
```

### C-10 范例新加的两节

讨论稿范例(T-2)和 dev-spec 结构范例的第一节(T-3)插入完全相同的内容:插在 `不做:自定义导出列(用户原话只要固定几列)。` 那一行之前,和上下文各空一行。两个 `plantuml` 代码块从 spec「细节方案:F4」下「讨论稿范例新增的两张图」原样复制;两节标题和两句说明照下面原样:

````markdown
**F1 订单导出怎么走**

订单服务收下导出请求就返回,后台导出任务异步取数、生成文件,做完站内通知;运营再从「我的导出」下载。

```plantuml
(spec「讨论稿范例新增的两张图」里 F1 那张,原样)
```

**F2 导出记录查看怎么走**

导出记录有四种状态,「我的导出」按状态显示,超过 7 天的文件过期。

```plantuml
(spec「讨论稿范例新增的两张图」里 F2 那张,原样)
```
````

## 细节方案核对

| spec 决策 | 落在 |
|---|---|
| D1 🔒 新画法放 `功能点配图.md`,`泳道图画法.md` 加一行 | T-1(新建、加一行);T-2、T-3 引用路径(C-1) |
| D2 连接点放服务泳道 | T-1「接口内逻辑图」规则 |
| D3 接口名、开关名写法 | T-1「接口内逻辑图」规则 |
| D4 没人等结果的入口 | T-1「接口内逻辑图」规则和第二张样例 |
| D5 一节多张图怎么对上 | T-1「编排图」规则;C-3 |
| D6 异步画法 | T-1「编排图」规则;T-2 讨论稿范例 F1 的图 |
| D7 审卡中的 v1 | T-2 SKILL.md ⑤「放哪」;C-8 |
| D8 改法候选 | T-2 SKILL.md ④ 改稿两档表;C-7 |
| D9 ④ 卡片范例换短卡 | T-2 SKILL.md ④;C-4 |
| D10 「Fx 怎么走」放哪 | T-2 SKILL.md ⑤、讨论稿范例;C-3 |
| D11 和全景图重复只留全景图 | T-1「选图」表后规则;T-2 SKILL.md ⑤;C-3 |
| D12 讨论稿范例加两节 | T-2 讨论稿范例;C-10 |
| D13 spec、交接收单点图 | T-3 dev-spec(第 1 步、画法指针、结构范例第一节)、dev-handoff;C-10 |
| D14 对话版和情形表 | T-2 SKILL.md 情形表、对话版 |
| D15 审核 prompt | T-2 function-plan-reviewer-prompt.md |
| D16 选图表 | T-1「选图」 |
| D17 新图种样式头 | T-1 各节;C-9 |
| D18 标黄标绿 | T-1 各节规则 |
| D19 每种图的样例 | T-1 各节样例 |
| D20 没有 ⑤ 的需求给澄清结果前写全讨论稿 | T-2 SKILL.md 情形表两行、情形表下第二条、⑤「放哪」 |
| F4 落地「措辞同步」 | T-3(C-5 前五行);T-2(C-5 最后一行) |

## 适用规范

- `docs/guides/git-standards.md`「提交消息规范」「提交前检查点」:结晶进下面「提交规范」。
- `docs/guides/coding-standards.md`「边界与结构」:只有「与 TS 源码同放的运行时资产必须登记 `scripts/copy-assets.cjs`」一条沾边;本次新文件在 `assets/claude-template/` 下,`copy-assets.cjs` 递归拷贝整个模板目录,不用登记。
- data / interface / testing 规范不涉及。三个任务都不动代码,强制引用都是「无」。

## 提交规范

从 `git-standards.md` 结晶,主会话按各任务的提交点照这里写:

- 标题格式 `type(scope): 中文描述`;本次 type 用 `feat` 或 `docs`,scope 用 `skills`;第 0 步那笔是仓库级文档,省 scope
- 第 0 步那笔:`docs: 流程中澄清环节的功能点展示模式探索——讨论稿、spec、plan`,包含 `docs/features/2026-10-31-流程中澄清环节的功能点展示模式探索/` 下全部文件;body 第一行「澄清、spec、plan 三个阶段的产物,实现前先入库」
- 补充说明用「——」,并列用「+」;不写票据号(需求追踪走 `docs/features/`)
- 非琐碎提交写 body:第一行写背景(问题或动机),再用「-」逐条列要点
- 提交前检查点(本次相关的):不新增 TODO / FIXME;不写死绝对路径和密钥(样例里的接口名、开关名是范例内容,不算);其余检查点针对 TS 代码和 hook 链路,本次不涉及
- precommit 门禁拦下时,对照上面检查点自查,确认无误后按门禁提示重试

## 统一验证

全部任务做完后,在仓库根目录跑。基准提交 `1bf1c86` 是本副本最近一次同步 dev/2.0.11 的合并提交;之后如果再同步,换成最近那次同步的提交。

1. 改过的资产里每张 PlantUML 图都能渲染——下面没有 `FAIL` 行,最后的数字是 10(`功能点配图.md` 6 张 + 讨论稿范例 4 张):

```bash
D=$(mktemp -d)
for f in assets/claude-template/skills/dev-clarify/references/功能点配图.md assets/claude-template/skills/dev-clarify/references/功能方案-讨论稿范例.md; do
  python3 -I -c 'import re,sys,pathlib; p=pathlib.Path(sys.argv[1]); [pathlib.Path(sys.argv[2],f"{p.stem}-{i:02d}.puml").write_text(b,encoding="utf-8") for i,b in enumerate(re.findall(r"```plantuml\n(.*?)```",p.read_text(encoding="utf-8"),re.S),1)]' "$f" "$D"
done
for p in "$D"/*.puml; do plantuml -tpng -charset UTF-8 -failfast2 "$p" >/dev/null 2>&1 || echo "FAIL $p"; done
ls "$D"/*.puml | wc -l
```

2. 同一图种的样式头逐字一致;泳道类和 `泳道图画法.md` 一致;`功能点配图.md` 里给人照抄的三段样式头(`text` 代码块)和各自的样例一致——输出前五行都是「一致」,接着三行都是「样式头和样例一致」,最后一行是 `True`:

```bash
python3 -I - <<'EOF'
import re, pathlib, textwrap
R = pathlib.Path("assets/claude-template/skills/dev-clarify/references")
def head(b):
    out = []
    for line in b.splitlines():
        if out and not re.match(r"(skinparam|\s|\}|hide |left to right)", line):
            break
        out.append(line)
    return "\n".join(out).strip()
def kind(h):
    return "state" if "skinparam state" in h else "sequence" if "skinparam sequence" in h else "dataflow" if "left to right" in h else "relation" if "skinparam rectangle" in h else "activity"
swim = head(textwrap.dedent(re.search(r"```text\n(.*?)```", (R / "泳道图画法.md").read_text(encoding="utf-8"), re.S).group(1)))
groups = {}
for name in ["功能点配图.md", "功能方案-讨论稿范例.md"]:
    for b in re.findall(r"```plantuml\n(.*?)```", (R / name).read_text(encoding="utf-8"), re.S):
        h = head(b)
        groups.setdefault(kind(h), set()).add(h)
for k, hs in sorted(groups.items()):
    print(k, "一致" if len(hs) == 1 else f"不一致:{len(hs)} 种")
for b in re.findall(r"```text\n(.*?)```", (R / "功能点配图.md").read_text(encoding="utf-8"), re.S):
    h = head(textwrap.dedent(b))
    if h.startswith("@startuml"):
        print(kind(h), "样式头和样例一致" if groups.get(kind(h)) == {h} else "样式头和样例不一致")
print(groups.get("activity") == {swim})
EOF
```

3. 设计文档零改动,`泳道图画法.md` 只多 D1 那一句——第一条命令没有输出;第二条只输出一行 `+澄清讨论稿里各功能点的图(接口内逻辑图、编排图等)另守同目录 `功能点配图.md`;设计文档不适用。`:

```bash
git diff --stat 1bf1c86 -- assets/claude-template/skills/doc-delivery/
git diff -U0 1bf1c86 -- assets/claude-template/skills/dev-clarify/references/泳道图画法.md | grep -E '^[+-][^+-]'
```

4. 规则文字到位——前两条和最后一条没有输出,其余几条都有输出:

```bash
grep -n '单独给它画一张行为链图' assets/claude-template/skills/dev-clarify/SKILL.md
grep -n 'K[0-9]' assets/claude-template/skills/dev-clarify/references/功能点配图.md
grep -n 'references/功能点配图.md' assets/claude-template/skills/dev-clarify/SKILL.md
grep -n '见讨论稿' assets/claude-template/skills/dev-clarify/SKILL.md
grep -n '改法候选' assets/claude-template/skills/dev-clarify/SKILL.md
grep -n '功能点配图.md' assets/claude-template/skills/dev-clarify/function-plan-reviewer-prompt.md assets/claude-template/skills/dev-spec/SKILL.md
grep -n '怎么走' assets/claude-template/skills/dev-handoff/SKILL.md
grep -rn -e '多功能点需求另写' -e '多功能点需求写一份' assets/claude-template
```

5. 部署出的 dev-clarify 和资产源一致——最后输出「部署一致」:

```bash
npm run build && R=$PWD && T=$(mktemp -d) && (cd "$T" && git init -q && node "$R/dist/cli/index.js" install -t claude-code -y >/dev/null) && diff -r assets/claude-template/skills/dev-clarify "$T/.claude/skills/dev-clarify" && echo 部署一致
```

6. 既有测试不被弄红:`npm test`,全部通过。

7. dev-spec 结构范例的第一节和讨论稿范例的上半部分逐字相同(spec 设计验收 11)——输出 `True`:

```bash
python3 -I - <<'EOF'
import pathlib
A = pathlib.Path("assets/claude-template/skills")
s = (A / "dev-spec/SKILL.md").read_text(encoding="utf-8")
f = (A / "dev-clarify/references/功能方案-讨论稿范例.md").read_text(encoding="utf-8")
print(s[s.index("**一句话**"):s.index("\n## 怎么实现")].strip() == f[f.index("**一句话**"):f.index("\n---\n\n以下供 spec 使用")].strip())
EOF
```

## 允许局部适配的范围

- 新写的说明句(不是契约原文、不是 spec 搬来的图)的措辞和断行
- `功能点配图.md` 各节里规则条目的先后
- T-1 四张新样例的布局细节(框内换行位置、分支左右),元素、颜色、编号照任务文件写

其余一律固定:C-1–C-10 的原文、从 spec 原样复制的图、各任务「原文 → 改成」的改成部分、涉及范围。

## Plan 冲突上报规则

遇到下面任何一种,停下,回报 `PLAN_CONFLICT: <任务> <文件:行> <冲突点>`,不自行变通:

- 任务里写的「原文」在文件里找不到,或找到不止一处
- 照任务改会和 spec(含第一节)或 C-1–C-10 冲突
- 需要改涉及范围之外的文件
- 样例渲染失败,照 spec 的规则改不好

## 关键风险与防跑偏约束

- 设计文档被带改:`泳道图画法.md` 只加一句,`skills/doc-delivery/` 一个字不动(统一验证 3)
- 样式头漂移:新图种只从 C-9 复制,不手敲(统一验证 2)
- 三个任务同时跑:各自只改涉及范围里的文件,只靠 C-1–C-10 衔接,不读对方的产出
- 「渲染成图片放进对话」不写进任何 skill;skill 里的图都是 Markdown 内嵌的 PlantUML 源码
- 不改根目录 `.claude/`,不改 `docs/features/` 下别的需求的产物

## 待确认项

- 无

## 启动语

```text
/dev-impl-subagent docs/features/2026-10-31-流程中澄清环节的功能点展示模式探索/plan/流程中澄清环节的功能点展示模式探索-index.md
```
