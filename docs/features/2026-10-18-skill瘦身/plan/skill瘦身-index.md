# 实现计划: skill瘦身

> 产物: plan
> 依据: spec@4ef10cf
> feature-id: 2026-10-18-skill瘦身
> 负责人: liulongfei
> 日期: 2026-10-19

## 设计预览

原来大需求由 write-plan 分批,每批要人开一个会话、贴一句启动语;改动大时,clarify 结束会自动出一页澄清结果。这次补两件事:一是 subagent-implement 保留并改写,plan 改成 index 加一个任务一个文件,一句启动语在一个会话里跑完;二是新增 visual-explain,clarify 结尾不再自动出页面,只提醒一句。改动都在 skill 模板和文档里,不改代码;拆成 2 个任务,同时跑。前 8 批的计划已经执行完,放在文末「已执行的 8 批」存档。

**需要你重点看的**(改错了代价最大,其余可略读)

| # | 决策 | 为什么难回头 |
|---|---|---|
| 1 | 任务文件命名 `plan/<前缀>-<两位序号>-<任务名>.md`,序号和任务编号一致;index 文件名不变 | 以后每个需求的 plan 都按这个命名。注册表靠 `plan/` 目录和 `-index.md` 认文件,所以不用改代码;但命名一旦用开,再改名要动所有新 plan 和审查提示词 |
| 2 | subagent-implement 沿用原名,从 `deprecated-assets.json` 撤掉;它旧版的三个提示词文件和 clarify 原来的附属文件登记进去 | 这份清单每次 install 都会执行:登记错了会删掉用户正在用的 skill,漏登记会在已部署项目里留下没人引用的旧文件 |
| 3 | 图解页的位置:和需求有关的进需求目录 `<前缀>-<主题>-v<N>.html`,无关的进 `.cgraphx/visual/` | 用户会按这个位置找文件,文件也会越积越多;以后换位置,旧文件要么迁移,要么两处都得找 |

## 来源与范围

- 依据:`docs/features/2026-10-18-skill瘦身/skill瘦身-spec.md`(指纹 4ef10cf)。这次补充改动来自 spec §3.3、§3.4、§4.2、§6、§7.1、§7.2、§7.3、§7.6、§10 到 §14。
- 目标:subagent-implement 保留并改写;新增 visual-explain;clarify 结尾只提醒图解;write-plan 改成一个任务一个文件,implementation 按新结构读 plan;文档和知识库同步。
- 改动面:新建 subagent-implement 和 visual-explain(含范例页);改 clarify-requirements、write-plan(含审查提示词)、implementation 和另外 5 个 skill 各一行引用;改 `deprecated-assets.json`、FLOW-MAP、模板 CLAUDE.md、cgraphx-guide;改本仓库 `CLAUDE.md`、`README.md`、`README.en.md`、`CHANGELOG.md` 和 `docs/knowledge/` 下 4 个条目。共 27 个文件,不改代码。

## 明确不包含

- 前 8 批已经做完的内容不重做;01 到 08 号 plan 文件不改(spec §14)。
- 不改代码:plan 仍在 `plan/` 目录,index 文件名不变,注册表、`features check`、安装器都不用改。
- 不改本仓库根目录的 `.claude/`;要在本仓库用上新版 subagent-implement 和 visual-explain,全部合并后由负责人用新构建重跑 `cgraphx install`。
- 不迁移已有的 plan;`docs/features/` 下已有的产物不改,两版澄清结果页只读不改。
- 不排测试任务;只要求既有测试不变红。

## 共用约定

T-24、T-25 的执行者先读完本节。

1. 分支:在 `feat/skill瘦身` 上做。工作区里本任务以外的改动(`.gitignore`、`package.json`、`package-lock.json`、交接提示词、两版澄清结果页等)不碰,也不还原。
2. 改动入口:skill 相关只改 `assets/claude-template/` 下的文件;本仓库根目录的 `.claude/` 不动。
3. 写法(spec §4.3):新写或改写的句子不用箭头(→)、不用斜杠并列(甲/乙)、不用自造缩写;流程图、目录树、字符画里的箭头和连线照常用;一行里用箭头把各步串起来的流程链(比如本仓库 CLAUDE.md 的「需求主线」)也算流程图,照原样用。没被要求改的句子不为改写而重写。任务给出的原文照抄,可以改错别字和标点。
4. 说法统一:skill 名单、大需求的说法、图解的说法、提醒原文、启动语和命名,一律按「必须严格执行的契约」C-1 到 C-6,逐字用。
5. 只改文件:由 subagent-implement 派出时,不构建、不测试、不提交,做完按派任说明回报;单独开会话手动跑一个任务时,改完按任务的「提交点」提交。
6. 遇到任务要求和 spec 冲突、要改「涉及范围」以外的文件、点名要改的段落找不到,停下:派出的子 agent 回报「冲突」或「卡住」并写明原因;手动跑时写 `PLAN_CONFLICT: <原因>`。

## 任务清单

| 任务 | 类型 | 任务文件 | 内容 | spec 条款 | 提交点 |
|---|---|---|---|---|---|
| T-24 | skill 行为 | `skill瘦身-24-skill行为.md` | 新建 subagent-implement、visual-explain(含范例页);clarify 结尾改成提醒图解;write-plan 改成一个任务一个文件,implementation 按新结构读 plan;5 个 skill 补回引用;废弃清单同步。14 个文件 | §3.3、§3.4、§4.2、§4.3、§6、§7.1、§7.2、§7.3、§7.6、§8.5、§10、§12、§14 | 5 笔 |
| T-25 | 流程文档 | `skill瘦身-25-流程文档.md` | FLOW-MAP、模板 CLAUDE.md、cgraphx-guide 三个文件、本仓库 CLAUDE.md、README 两份、CHANGELOG、4 个知识库条目。13 个文件 | §1.2、§3、§10、§13 | 3 笔 |

两个任务都不超过 15 个文件,按类型拆完不用再往下拆。

各任务的涉及范围,主会话核对子 agent 回报时用,回报里的文件必须在这里面:

- T-24(路径都在 `assets/claude-template/` 下):`skills/subagent-implement/SKILL.md`(新建)、`skills/visual-explain/SKILL.md`(新建)、`skills/visual-explain/references/范例-澄清结果.html`(新建)、`skills/clarify-requirements/SKILL.md`、`skills/clarify-requirements/references/澄清结果页.md`(删除)、`skills/write-plan/SKILL.md`、`skills/write-plan/plan-document-reviewer-prompt.md`、`deprecated-assets.json`、`skills/write-api/SKILL.md`、`skills/run-api-test/SKILL.md`、`skills/iboc-check/SKILL.md`、`skills/run-ui-test/SKILL.md`、`skills/knowledge-write/SKILL.md`、`skills/implementation/SKILL.md`。
- T-25:`assets/claude-template/FLOW-MAP.md`、`assets/claude-template/CLAUDE.md`、`assets/claude-template/skills/cgraphx-guide/SKILL.md`、`assets/claude-template/skills/cgraphx-guide/how-to-use.md`、`assets/claude-template/skills/cgraphx-guide/how-to-use.html`、`CLAUDE.md`、`README.md`、`README.en.md`、`CHANGELOG.md`、`docs/knowledge/skill-invocation轴.md`、`docs/knowledge/测试流程后置.md`、`docs/knowledge/plan手段决策三档.md`、`docs/knowledge/枚举换血排查教训.md`。

## 执行顺序

```text
第 1 步(同时跑)  T-24 skill 行为 · T-25 流程文档
```

- 能同时跑:两个任务改的文件不重叠,见各自的「涉及范围」;T-25 要写的事实都在 C-1 到 C-6 里定死,不读 T-24 的产出;改的都是 markdown、HTML 和 JSON,没有构建互相干扰。
- 两个任务都提交以后,主会话跑一次「统一验证」。

## 启动语

```text
/subagent-implement docs/features/2026-10-18-skill瘦身/plan/skill瘦身-index.md
```

本仓库 `.claude/` 里部署的还是旧版 subagent-implement,它也能按任务派子 agent、由主会话提交,可以直接用它跑这份 plan。用旧版跑时注意两点:把每个提交点当作「独立提交:是」;最后派质量审查子 agent 之前,先跑「统一验证」。T-24 写好的新版,合并后重跑 `cgraphx install` 再用。

## 必须严格执行的契约

两个任务按编号引用下面的契约,不另写一份。

### C-1 skill 名单(T-24 落进 skill;T-25 写进文档)

- 共 27 个 skill;命令 2 个:`/end`、`/my-query`。
- model-invoked 19 个:cgraphx-guide、clarify-requirements、db-query、handdrawn-sketch-engine、handoff-session、implementation、knowledge-recall、knowledge-write、run-api-test、run-ui-test、subagent-implement、visual-explain、write-api、write-plan、write-spec、write-ui-test、write-unit-test-code、write-unit-test-spec、write-wireframe。
- user-invoked 8 个:developer-timeline、export-table-ddl、handdrawn-deck、iboc-check、init-project-guides、knowledge-init、write-docs、write-workload。
- 用户会敲的 23 个:27 个减去 knowledge-recall、db-query、handdrawn-sketch-engine、cgraphx-guide。
- 废弃 8 个:knowledge-api、code-map-write、code-map-recall、write-prd、write-design-doc、write-api-doc、knowledge-migrate、write-delivery-guide。subagent-implement 不在其中。

### C-2 大需求的说法

- 执行:小需求一个会话跑 `/implementation`;大需求先 `/write-plan`,再 `/subagent-implement` 在一个会话里按任务派子 agent 跑完,全部做完统一验证,最后提示跑 `/code-review`。
- plan 结构:index 放背景和共用部分,一个任务一个文件;先按任务类型拆,一个任务预估改动超过 15 个文件,再按并行度往下拆。
- 大需求的判断不变:预估变更文件 ≥10,且跨 ≥3 个相互独立的模块。拿不准时,clarify 推荐下一步写「先 `/write-plan`」;write-plan 定执行方式时按小需求。

### C-3 图解的说法

- 没看懂就说「画个图讲讲」,visual-explain 把对话里说过的内容,或者指定的文件、话题,画成一页图解(单个 HTML)。
- 和需求有关的放需求目录 `docs/features/<feature-id>/<前缀>-<主题>-v<N>.html`,澄清结果叫 `<前缀>-澄清结果-v<N>.html`;和需求无关的放 `.cgraphx/visual/<主题>-v<N>.html`,不进 git。
- N 从 1 递增,改一次出一版,旧版保留;讨论稿,不写 `> 产物:` 头部,不登记,不上报。
- 用户没要求时不主动出页面。

### C-4 提醒原文

- clarify 结尾:`有没看懂的地方,可以说「画个图讲讲」,我出一页图解。`
- write-plan 请人确认设计预览时:`设计预览哪里没看懂,可以说「画个图讲讲」。`

### C-5 启动语和任务文件命名

- 启动语:`/subagent-implement docs/features/<feature-id>/plan/<前缀>-index.md`
- 任务文件:`plan/<前缀>-<两位序号>-<任务名>.md`,序号和任务编号一致,T-1 对应 01;index 文件名不变。

### C-6 两个新 skill 的 description

T-24 原样写进 frontmatter;T-25 写导航里的一句话介绍时照这个意思写。

- subagent-implement:`大需求按 plan 执行:在一个会话里按 index 的执行顺序给每个任务派一个子 agent,主会话按提交点提交,全部做完统一验证、修复,最后提示跑 /code-review。可以在设计会话里直接跑,也可以新开会话跑。Use when 跑 plan、执行 plan、按 plan 实现、派子 agent 实现、跑全部任务、subagent 实现。`
- visual-explain:`把对话里说过的内容,或者用户指定的文件、话题,画成一页图解(单个 HTML),降低人看懂 AI 输出的成本:先用一张图看清整体,再展开关键节点,每个结论配一个例子。用户说没看懂、要图解时使用,用户没要求时不主动出页面。Use when 没看懂、看不懂、画个图讲讲、图解一下、可视化讲一下、帮我理解、出一页图解。`

## 实现手段决策

纯工程手段,plan 自主定。

| 决策 | 选项 | 选了 | 理由 |
|---|---|---|---|
| 任务怎么分类型 | 按目录分;按讲的内容分 | 按讲的内容:改 skill 行为的归「skill 行为」,讲流程的归「流程文档」;cgraphx-guide 虽然在 `skills/` 下,归流程文档 | cgraphx-guide 和 FLOW-MAP、README 讲的是同一套流程,放在一起说法才一致 |
| 两个任务怎么跑 | 先 skill 后文档;同时跑 | 同时跑 | 文件不重叠;文档要写的事实都在 C-1 到 C-6 里定死 |
| subagent-implement 的范例放哪 | 写进 SKILL.md;拆成参考文件 | 写进 SKILL.md | 派任说明、回报格式、收尾汇报三段范例都短;主会话每次都要读,放一个文件少读一次 |
| visual-explain 怎么给范例 | 只写文字规则;附一个完整范例页 | 附 `references/范例-澄清结果.html`,原样复制澄清结果 v2 | 直接展示最好的案例;版式、配色、深浅色和窄屏表格照着写最稳,只在要出页面时读 |
| 废弃清单怎么登记 clarify 旧附属文件 | 登记文件路径;登记整个 `references` 目录 | 登记文件路径 | 清单只收录包曾经部署过的路径,不删整个目录,免得误删用户自己放的文件 |

## 适用规范

两个任务只改 markdown、HTML 和一个 JSON 清单,不涉及 `docs/guides/` 里的契约级规范,强制引用都是「无」。`git-standards.md` 已结晶进下面的「提交规范」。

## 提交规范

从 `docs/guides/git-standards.md` 结晶。主会话按任务的提交点逐笔提交;本仓库的提交门禁会先拦一次,自查后带 `CGRAPHX_PRECOMMIT_REVIEWED=1` 重试。

- 分支:`feat/skill瘦身`;合并回 `main` 和 push 都归负责人。
- 标题格式:`type(scope): 中文描述`。type 用 feat、refactor、fix、docs;scope 用 skills、knowledge,仓库级文档省略 scope。补充说明用「——」,并列用「+」。不写票据号。
- 正文:非琐碎提交写正文,第一行写背景,下面用「-」列要点。
- 每笔只 stage 这一笔列出的文件,不用 `git add -A`。
- 提交前检查点(对照 `git diff --cached` 逐项看,命中先报告):
  - 写死的绝对路径、密钥
  - 新增 TODO、FIXME
  - 本任务以外的文件混进暂存区

## 统一验证

两个任务都提交以后,主会话在仓库根目录逐条跑:

```bash
# 1. 构建和既有测试全部通过
npm run build && npm test

# 2. skill 个数和新旧文件:第一行输出 27,第二行输出 ok
ls assets/claude-template/skills | wc -l
test -f assets/claude-template/skills/subagent-implement/SKILL.md && test -f assets/claude-template/skills/visual-explain/SKILL.md && test ! -e assets/claude-template/skills/clarify-requirements/references && echo ok

# 3. 废弃清单:不含 subagent-implement 目录,含它旧版的三个提示词和 clarify 的旧附属文件,输出 ok
node -e "const p=require('./assets/claude-template/deprecated-assets.json').paths; const need=['skills/subagent-implement/implementer-prompt.md','skills/subagent-implement/spec-reviewer-prompt.md','skills/subagent-implement/quality-reviewer-prompt.md','skills/clarify-requirements/references/澄清结果页.md']; if (p.includes('skills/subagent-implement') || need.some(x => !p.includes(x))) { console.error('废弃清单不对'); process.exit(1) } console.log('ok')"

# 4. 范例页和 v2 一致:输出 ok
cmp docs/features/2026-10-18-skill瘦身/skill瘦身-澄清结果-v2.html assets/claude-template/skills/visual-explain/references/范例-澄清结果.html && echo ok

# 5. 旧说法没有残留
#    第一条只输出一行:docs/knowledge/skill-invocation轴.md 里「原 25 个 skill 全 model-invoked」(2026-08-01 的历史说明,保留)
#    第二条、第三条都没有输出
grep -rn --exclude=范例-澄清结果.html -e 每批开一个会话 -e 每批一个会话 -e 每批一句 -e 每批启动语 -e "分批,每批" -e 出澄清结果页 -e 改动大时出页面 -e "25 个 skill" -e "共 25 个" assets/claude-template CLAUDE.md README.md docs/knowledge
grep -n -i -e "per batch" -e "kickoff line" -e "visual summary" -e "33 to 25" -e "Removed 9" README.en.md CHANGELOG.md
grep -rn -e 01-schema -e 02-backend -e 03-frontend -e "「独立提交」" assets/claude-template/skills/implementation assets/claude-template/skills/write-plan assets/claude-template/FLOW-MAP.md

# 6. 新说法都在:第一条两个文件各至少 1;第二条输出 5;第三条输出 9
grep -c 画个图讲讲 assets/claude-template/skills/clarify-requirements/SKILL.md assets/claude-template/skills/write-plan/SKILL.md
grep -l subagent-implement assets/claude-template/skills/write-api/SKILL.md assets/claude-template/skills/run-api-test/SKILL.md assets/claude-template/skills/iboc-check/SKILL.md assets/claude-template/skills/run-ui-test/SKILL.md assets/claude-template/skills/knowledge-write/SKILL.md | wc -l
grep -l visual-explain assets/claude-template/FLOW-MAP.md assets/claude-template/CLAUDE.md assets/claude-template/skills/cgraphx-guide/SKILL.md assets/claude-template/skills/cgraphx-guide/how-to-use.md assets/claude-template/skills/cgraphx-guide/how-to-use.html CLAUDE.md README.md README.en.md CHANGELOG.md | wc -l

# 7. 知识库条目能过校验:没有「校验失败」字样
for f in skill-invocation轴 测试流程后置 plan手段决策三档 枚举换血排查教训; do node dist/cli/index.js docs validate "docs/knowledge/$f.md" || echo "校验失败:$f"; done

# 8. 在临时目录装一次:输出 27 和 ok
#    先放上旧版留下的文件,装完以后:新 skill 都在,旧版提示词和 clarify 的旧附属文件被清掉
R=$(pwd); D=$(mktemp -d); git -C "$D" init -q
mkdir -p "$D/.claude/skills/clarify-requirements/references" "$D/.claude/skills/subagent-implement"
echo old > "$D/.claude/skills/clarify-requirements/references/澄清结果页.md"
echo old > "$D/.claude/skills/subagent-implement/implementer-prompt.md"
(cd "$D" && node "$R/dist/cli/index.js" install -y -t claude-code >/dev/null 2>&1)
ls "$D/.claude/skills" | wc -l
test -f "$D/.claude/skills/subagent-implement/SKILL.md" && test -f "$D/.claude/skills/visual-explain/SKILL.md" && test ! -e "$D/.claude/skills/subagent-implement/implementer-prompt.md" && test ! -e "$D/.claude/skills/clarify-requirements/references/澄清结果页.md" && echo ok
rm -rf "$D"
```

命令检查不了的:subagent-implement 的停下规则和收尾是否符合 spec §7.6、§12,visual-explain 的讲法和页面要求是否符合 spec §6,write-plan 的拆分规则和任务模板是否符合 spec §7.2。这些留给 `/code-review` 一起看。

## 允许局部适配

- skill 和文档里,任务没点名的段落一律不动;点名要删的段落,删后为了衔接可以改一两句过渡语。
- 新 skill 的小标题措辞、同一节里条目的顺序可以调,每节必须有的内容不能少。
- 任务给的原文可以改错别字和标点;场景、数字和结构不改。

## Plan 冲突上报

遇到下面情况停下,不自行换方案:

- 任务要求和 spec 原文冲突;
- 要改的文件不在本任务的「涉及范围」里;
- 点名要改的段落在文件里找不到,或者已经被改过;
- 统一验证失败的原因在两个任务的改动以外。

## 关键风险与防跑偏

| 风险 | 防法 |
|---|---|
| 两个新 skill 写成长篇说明,不靠范例 | T-24 逐节列出要写的内容,给出范例原文照抄;subagent-implement 保留步骤和自检,visual-explain 只留讲法、范例和硬规则 |
| 文档和 skill 说法对不上 | 两个任务都按 C-1 到 C-6 逐字写;统一验证第 6 条查新说法都在 |
| 废弃清单登记错了,删掉在用的 skill;或者漏登记,已部署项目留着旧版提示词 | 统一验证第 3 条查清单内容,第 8 条先放上旧文件,在临时目录实际装一次 |
| 子 agent 用 `git rm` 改了暂存区,同时跑的另一个任务提交时把删除带进去 | T-24 文件 5 只用 `rm`,删除由主会话在提交点 1 里 stage |
| clarify 删过头,把决策表也删了 | T-24 写明只删出页面的部分,对话版范例和决策表保留 |
| write-plan 改漏或改多 | T-24 按条列出要改的 12 处,没列的不动 |

## 待确认项

无。

## 已执行的 8 批(存档)

以下是 2026-10-19 执行完的 8 批计划,补充改动的执行者不用读。里面「分批、每批一句启动语」「任务自包含、契约各抄一份」是旧写法,以后不再沿用;当时的依据是 spec 指纹 cf4712c。

### 设计预览

原来 33 个 skill 里有大量跨 skill 重复的规则和写给较弱模型的解释,产物的头部和开头结论还没写进各 skill 的模板,AI 提交时也不查产物。这次分 8 批改完:第 1 批改代码(注册表登记开头结论、`features check` 只查 md 并新增 `--staged`、web 系统地图两处提示);第 2 到 7 批按 skill 逐个删短、补头部和开头结论,同时完成废弃与合并;第 8 批同步文档,最后把 `features check` 接进提交门禁。

**需要你重点看的**(改错了代价最大,其余可略读)

| # | 决策 | 为什么难回头 |
|---|---|---|
| 1 | 给 `cgraphx features check` 加 `--staged`:只查暂存区里 `docs/features/` 下新增和修改的文件;门禁 hook 只调这一条参数固定的命令,不自己算文件清单 | 这是新的命令参数,各项目的 hook 部署后都依赖它,以后改名或去掉,门禁会按「跑不起来就放行」静默失效。它属于命令参数改动,负责人已确认,写进了 spec §8.4 |
| 2 | 重复规则的唯一位置:建需求目录的命名规则只留在 write-spec「产物位置与命名」和第 0 步;只在已有需求目录里干活的 skill 一律写「文件前缀 = feature-id 去掉开头的日期 `YYYY-MM-DD-`」 | 改完后十几个 skill 都指向这一处,以后挪位置要把全部引用再改一遍;「去掉日期」这个等式也成了长期约定,feature-id 格式一变就失效 |
| 3 | 发布记录一个需求一个文件,第一节「版本与上线时间」是一张表,每次发布追加一行;发布晚于收口时,再跑 `/end` 只补发布记录 | 目标项目会一直积累这种文件;以后换格式,旧文件要么迁移、要么两种格式并存 |

### 来源与范围

- 依据:`docs/features/2026-10-18-skill瘦身/skill瘦身-spec.md`(指纹 cf4712c)。规则以主任务 `2026-10-18-产物注册表与头部规范` 的 spec 为准(头部 §4、首屏结论 §7、`features check` §9、发布记录 §12)。
- 目标:skill 从 33 个减到 25 个并删短;各 skill 写出的新产物带头部和开头结论;`features check` 接进提交门禁;clarify 结束时给出可视化的澄清结果;写给人看的地方给大白话范例。
- 改动面:`assets/claude-template/` 下全部 skill、2 个命令、1 个 hook、FLOW-MAP、模板 CLAUDE.md、`deprecated-assets.json`;`src/core/artifact-registry/registry.ts`、`src/core/features/{check,cli,errors}.ts`、`src/web/` 三个文件;本仓库 `CLAUDE.md`、`README.md`、`README.en.md`、`CHANGELOG.md`;`docs/knowledge/` 下 5 个条目。

### 明确不包含

- 业务地图、删除 web「系统地图」页、删除或改动 `docs/code-map/` 下的文件(spec §1.3、§9)。
- 新旧 skill 对比测试、冷读测试;改完由负责人人工审查(spec §1.3、§13)。
- 给旧产物补 `> 产物:` 头部;改动 `docs/features/` 下任何已有产物(spec §1.3、§11、§14)。
- 新增产物类型、改路径规则、改上报行为;澄清结果页不登记(spec §1.3、§14)。
- `agents/` 下两个子 agent 定义(knowledge-recall、task-history)不改;`developer-timeline/demo-single-page-report.html` 里的示例数据不改。
- 本仓库根目录的 `.claude/`(被 gitignore 的已部署环境)不改;要在本仓库体验新门禁,全部合并后由负责人用新构建重跑 `cgraphx install`。
- 测试任务:单元测试、接口测试走独立流程,plan 只要求既有测试不变红。

### 计划文件

| 文件 | 批次 | 任务 |
|---|---|---|
| `skill瘦身-01-代码与web.md` | 1 | T-1 注册表与 `features check`;T-2 web 系统地图提示 |
| `skill瘦身-02-合并与废弃.md` | 2 | T-3 knowledge-recall 合并;T-4 新建 write-docs;T-5 删除 9 个废弃 skill |
| `skill瘦身-03-设计主线.md` | 3 | T-6 clarify-requirements;T-7 write-spec;T-8 write-plan;T-9 handoff-session 与 write-wireframe |
| `skill瘦身-04-实现与接口测试.md` | 4 | T-10 implementation;T-11 write-api;T-12 run-api-test |
| `skill瘦身-05-单元与UI测试及命令.md` | 5 | T-13 两个单元测试 skill;T-14 两个 UI 测试 skill;T-15 `/end` 与 `/my-query` |
| `skill瘦身-06-知识库与规范.md` | 6 | T-16 knowledge-init;T-17 iboc-check;T-18 init-project-guides |
| `skill瘦身-07-其余删短.md` | 7 | T-19 knowledge-write、db-query、export-table-ddl;T-20 developer-timeline、write-workload、两个手绘 skill |
| `skill瘦身-08-文档同步与门禁.md` | 8 | T-21 FLOW-MAP、模板 CLAUDE.md、cgraphx-guide;T-22 本仓库文档与知识库条目;T-23 提交门禁 |

没有 schema、前端改动,不建 `-01-schema`、`-03-frontend` 这类文件;按批次分文件,方便每个执行会话只读自己那一份。

### 总任务清单

任务按 skill 切分,因为 spec §14 要求按 skill 分批提交、方便人工审查;一个任务含两个以上 skill 的,每个 skill 单独一笔提交。

| 任务 | 内容 | spec 条款 | 独立提交 |
|---|---|---|---|
| T-1 | 注册表登记开头结论、撤掉 spec 的一图看懂、开头结论只查 md、`features check --staged` | §8.2、§8.4、§12、§14 | 是 |
| T-2 | web 系统地图两处提示与相关注释 | §9 | 是 |
| T-3 | knowledge-recall 并入 knowledge-api | §3.2、§5.1 | 是 |
| T-4 | 新建 write-docs | §3.2、§5.2、§8.1、§8.2 | 是 |
| T-5 | 删除 9 个废弃 skill,登记 `deprecated-assets.json` | §3.1、§4.2、§11 | 是 |
| T-6 | clarify-requirements:澄清结果、附属讲法文件、删短 | §6、§7.1、§4 | 是 |
| T-7 | write-spec:头部、去掉一图看懂、命名规则的唯一位置、删短 | §7.1、§8.1、§4 | 是 |
| T-8 | write-plan:分批与启动语、设计预览只留重点决策表、头部、删短 | §7.2、§8.1、§9、§4 | 是 |
| T-9 | handoff-session、write-wireframe:头部、命名规则改引用 | §8.1、§8.2、§4 | 是(两笔) |
| T-10 | implementation:收尾两个提示、汇报范例(执行侧) | §7.3、§8.5、§9、§4 | 是 |
| T-11 | write-api:接口测试规格头部与覆盖范围、删短 | §8.1、§8.2、§4 | 是 |
| T-12 | run-api-test:报告头部与结论(执行侧) | §8.1、§8.2、§4、§10 | 是 |
| T-13 | write-unit-test-spec、write-unit-test-code:规格与报告的头部和开头结论 | §8.1、§8.2、§4 | 是(两笔) |
| T-14 | write-ui-test、run-ui-test:用例规格头部与覆盖范围;run-ui-test 只删重复 | §8.1、§8.2、§4、§10 | 是(两笔) |
| T-15 | `/end` 发布记录与收口档案头部;`/my-query` 改引用 | §8.1、§8.2、§8.3、§10 | 是 |
| T-16 | knowledge-init:照 knowledge-write 模板、改成中文、删短 | §7.5、§4 | 是 |
| T-17 | iboc-check:缺什么看 `features show`、补头部不加产物、指向 write-docs | §7.4、§4 | 是 |
| T-18 | init-project-guides:提交规范模板的大白话 commit 标题范例 | §4.3 | 是 |
| T-19 | knowledge-write、db-query、export-table-ddl 删短 | §4、§10 | 是(三笔) |
| T-20 | developer-timeline、write-workload、handdrawn-deck、handdrawn-sketch-engine 删短 | §4、§10 | 是(四笔) |
| T-21 | FLOW-MAP、模板 CLAUDE.md、cgraphx-guide | §9、§10 | 是(两笔) |
| T-22 | 本仓库 CLAUDE.md、README、CHANGELOG、5 个知识库条目 | §10 | 是(两笔) |
| T-23 | precommit-check 接入 `features check` | §8.4、§14 | 是 |

### 依赖与顺序

```text
批次 1  T-1 → T-2                          (代码,与 skill 无关)
批次 2  T-3 → T-4 → T-5                    (T-5 删目录,必须在 T-3、T-4 读完旧 skill 之后)
批次 3  T-6 → T-7 → T-8 → T-9
批次 4  T-10 → T-11 → T-12
批次 5  T-13 → T-14 → T-15
批次 6  T-16 → T-17 → T-18
批次 7  T-19 → T-20
批次 8  T-21 → T-22 → T-23                 (必须等批次 1 到 7 全部完成)
```

- 批次 1 到 7 之间没有共用文件,内容上也互不依赖(彼此只按名字引用,比如 iboc-check 写「走 /write-docs」不需要 write-docs 已经存在)。
- 批次 8 必须最后做:FLOW-MAP、cgraphx-guide、README 写的是全部改完以后的样子;T-23 的门禁会拦下没有头部的新产物,按 spec §14 必须在各 skill 都会写头部之后上线(T-1 的 `--staged` 也要先完成)。
- 默认在同一个检出里按批次顺序串行跑。想并行时,批次 1 到 7 各开一个独立的 git worktree 和分支,全部合进 `feat/skill瘦身` 后再跑批次 8;同一个检出里不要同时跑两个会话(暂存区是共用的)。

### 执行方式

大需求:预估变更约 80 个文件,跨代码、hook、skill 模板、文档四类相互独立的模块。分 8 批,每批开一个新会话跑 `/implementation`;全部完成后回 Claude 跑 `/code-review`。

每批的启动语(一批一句,原样贴进新会话):

```text
/implementation 执行 docs/features/2026-10-18-skill瘦身/plan/skill瘦身-01-代码与web.md 的 T-1 和 T-2,先读文件开头的「共用约定」,只做这两个任务。
/implementation 执行 docs/features/2026-10-18-skill瘦身/plan/skill瘦身-02-合并与废弃.md 的 T-3 到 T-5,先读文件开头的「共用约定」,按顺序做,只做这三个任务。
/implementation 执行 docs/features/2026-10-18-skill瘦身/plan/skill瘦身-03-设计主线.md 的 T-6 到 T-9,先读文件开头的「共用约定」,按顺序做,只做这四个任务。
/implementation 执行 docs/features/2026-10-18-skill瘦身/plan/skill瘦身-04-实现与接口测试.md 的 T-10 到 T-12,先读文件开头的「共用约定」,按顺序做,只做这三个任务。
/implementation 执行 docs/features/2026-10-18-skill瘦身/plan/skill瘦身-05-单元与UI测试及命令.md 的 T-13 到 T-15,先读文件开头的「共用约定」,按顺序做,只做这三个任务。
/implementation 执行 docs/features/2026-10-18-skill瘦身/plan/skill瘦身-06-知识库与规范.md 的 T-16 到 T-18,先读文件开头的「共用约定」,按顺序做,只做这三个任务。
/implementation 执行 docs/features/2026-10-18-skill瘦身/plan/skill瘦身-07-其余删短.md 的 T-19 和 T-20,先读文件开头的「共用约定」,按顺序做,只做这两个任务。
/implementation 执行 docs/features/2026-10-18-skill瘦身/plan/skill瘦身-08-文档同步与门禁.md 的 T-21 到 T-23,先读文件开头的「共用约定」,按顺序做,只做这三个任务。
```

全部批次完成后,回 Claude 跑 `/code-review`,审 `feat/skill瘦身` 相对 `main` 的全部改动,并按下面「验收对照」逐条核对。

### 必须严格执行的契约

以下契约在相关任务里各写了一份原文,这里汇总,以便审查:

1. **废弃清单**(spec §3.1、§4.2):`skills/subagent-implement`、`skills/knowledge-api`、`skills/code-map-write`、`skills/code-map-recall`、`skills/write-prd`、`skills/write-design-doc`、`skills/write-api-doc`、`skills/knowledge-migrate`、`skills/write-delivery-guide`。改完 `assets/claude-template/skills/` 下正好 25 个目录。
2. **产物类型标识与开头结论**(spec §8.1、§8.2,注册表 `firstScreen`):

   | 产物 | 类型标识 | 第一个二级标题(只对 md) |
   |---|---|---|
   | 主 spec | `spec` | 不要求 |
   | 交接文件 | `handoff` | `本任务范围` |
   | 实现计划 index | `plan` | `设计预览`(已有,不变) |
   | 接口、单元、UI 测试规格 | `api_test_spec`、`unit_test_spec`、`ui_test_spec` | `覆盖范围` |
   | 接口、单元测试报告 | `api_test_report`、`unit_test_report` | `结论` |
   | 收口档案 | `closure_record` | `历时` |
   | 发布记录 | `release_record` | `版本与上线时间` |
   | 需求文档 | `prd` | `需求概览` |
   | 设计文档 | `design_doc` | `架构总览`(html 版不查) |
   | 接口文档、线框、UI 测试报告 | `api_doc`、`wireframe`、`ui_test_report` | 不查 |

   标题逐字比对,不能带编号;已有编号的模板把这一节插在最前面,不重排原有编号(接口测试报告例外,见 T-12)。
3. **头部格式**:md 写在一级标题下的第一组引用行;HTML 写在前 30 行内的一个注释里,每行 `> 字段: 值`。`> 依据:` 写成 `spec@` 加主 spec 指纹前 7 位(`cgraphx features show <feature-id>` 的「spec 指纹」),需求目录没有主 spec 时不写。
4. **文件前缀**:`docs/features/<feature-id>/` 里的文件前缀 = feature-id 去掉开头的日期 `YYYY-MM-DD-`。建新需求目录的规则只写在 write-spec。
5. **`features check --staged`**(spec §8.4):只检查 `git diff --cached --name-only -z --diff-filter=ACMR --relative -- docs/features/` 列出的文件;不能和目标参数同时用;读不到暂存区按「没有文件」处理;JSON 输出形状不变。
6. **门禁顺序**(spec §8.4):先跑 `cgraphx features check --staged --json`,有失败项就拦,带 `CGRAPHX_PRECOMMIT_REVIEWED=1` 也跳不过;只有警告放行;跑不起来放行;然后才是原有的提交说明自查。
7. **澄清结果页**:`docs/features/<feature-id>/<前缀>-澄清结果-v<N>.html`,不写 `> 产物:` 头部,讲法只写在 clarify 的 `references/澄清结果页.md`。

### 实现手段决策

纯工程手段,plan 自主定;第 1 条涉及命令参数,第 6 条涉及对 spec 的解读,两条都已经负责人确认(2026-10-19)。

| 决策 | 选项 | 选了 | 理由 |
|---|---|---|---|
| 门禁怎么只查暂存文件 | ① `features check` 加 `--staged`,hook 调固定命令;② hook 自己列暂存文件,作为参数传给 `features check` | ①(已确认,写进 spec §8.4) | ② 在 Windows 上要经 shell 才能调 `cgraphx`,把仓库里的文件名拼进命令行有注入风险,只能放弃 Windows 上的门禁;中文文件名在 git 输出里默认会被转义,要额外处理;暂存文件多时还会撞命令行长度上限。① 的命令参数固定,三种问题都没有,逻辑也在 core 里 |
| 开头结论只查 md 放在哪 | 改 `firstScreenHeadingOf`(注册表)或改 `check.ts` | 注册表 | 注册表是「文件 → 口径」的唯一定义处,`check.ts` 只照表执行 |
| 重复规则留在哪 | 见右栏 | 命名规则:write-spec。负责人必须和 git user.name 一字不差:write-spec 第 0 步。DISCOVERED 块格式、枢纽表原则、schema-knowledge 闭环:db-query。知识库命令用法:knowledge-recall。规范读取映射:write-plan「适用规范」,implementation 保留无 plan 时的一句识别步骤。三处「探索结果收口」:全部删除 | 放在最先用到它、最常被读的那个 skill |
| 有编号的模板怎么放开头结论 | 插在最前面,或改名第一节并重排编号 | 插在最前面,原编号不动 | 下游 skill 按「§5 接口映射」这类编号引用,重排会牵连别的文件;接口测试报告的「1. 汇总」本来就是结论,直接改名并去掉其余编号(T-12 一并改引用) |
| 发布晚于收口时怎么补发布记录 | 再跑 `/end`;单开一个命令 | 再跑 `/end`,收口档案已在时只补发布记录 | 不新增命令;spec 只要求「之后单独补写」 |
| iboc-check「补设计文档 改由 write-docs 生成」 | 把设计文档加成第四种可补产物;或只把指引改成 write-docs | 只改指引 | 现在的 iboc-check 不补设计文档(提交 b234f57 专门下掉过);spec 没说要加回来。按「设计文档的生成入口改为 write-docs」落地(已确认) |
| 范例用什么场景 | 统一一个场景;各模板沿用自己原有的场景 | 沿用原有场景;原来没有范例的,贴合所在模板 | 改动最小,和模板里其他示例一致 |
| cgraphx-guide 里明显过时的事实 | 不动;顺手改对 | 改对 Node 版本(与 `package.json` 的 engines 一致),skill 清单列全 25 个 | 这一节本来就要重写;留着错的版本号会误导安装 |

### 适用规范

- `docs/guides/coding-standards.md`:「边界与结构」「选型」「错误与日志」——T-1、T-2、T-23 强制引用。
- `docs/guides/interface-standards.md`:「输出」「退出码」——T-1 强制引用(新增命令参数和错误类)。
- `docs/guides/git-standards.md`:已结晶进下方「提交规范」。
- 其余任务只改 markdown 模板,不涉及规范文件,强制引用为「无」。

### 提交规范

从 `docs/guides/git-standards.md` 结晶,实施期照此提交;本仓库的提交门禁会先拦一次,自查后带 `CGRAPHX_PRECOMMIT_REVIEWED=1` 重试。

- 分支:在 `feat/skill瘦身` 上提交(没有就从 `main` 建);合并回 `main`、push 都归负责人。
- 标题格式:`type(scope): 中文描述`。type 用 feat、refactor、fix、docs;scope 用 skills、features、web、hooks、commands、knowledge,仓库级文档省略 scope。补充说明用「——」,并列用「+」。不写票据号。
- 正文:非琐碎提交写正文,第一行写背景,下面用「-」列要点。
- 每个任务的「独立提交」给了建议的标题,照用或微调。
- 提交前检查点(对照 `git diff --cached` 逐项看,命中先报告):
  - 与 TS 同放的运行时资产没登记 `scripts/copy-assets.cjs`
  - `src/core` 出现对 `src/cli`、`src/web` 的 import
  - `schema.sql` 丢了 `IF NOT EXISTS`
  - timeline hook 链路出现没 await 的 DB 写入,或抛错不吞
  - `vitest.config.ts` 的 `TZ: 'UTC'` 被改
  - 被注释掉的命令注册或 hook 接入项
  - 写死的魔法值:绝对路径、密钥、阈值、版本号
  - 新增 TODO、FIXME

### 允许局部适配

- skill 文件里,任务没点名的段落一律不动;点名删除的段落,删后为了衔接可以改一两句过渡语。
- 代码任务可以调整内部函数拆分、局部命名、注释措辞;对外的命令参数、JSON 形状、错误文案按任务原文。
- 任务给的范例原文可以改错别字和标点;范例里的场景、数字和结构不改。

### Plan 冲突上报

执行中遇到下面情况,停下来在会话里写 `PLAN_CONFLICT: <原因>`,不自行换方案:

- 任务要求和 spec 原文冲突;
- 要改的文件不在本任务的「涉及范围」里;
- 既有测试因本任务以外的原因失败;
- 任务点名要删的段落在文件里找不到,或者已经被别的任务改过。

### 关键风险与防跑偏

| 风险 | 防法 |
|---|---|
| 设计侧删过头,把硬规则和范例一起删了 | 每个任务列了要删的节;HARD-GATE、红线、范例除非点名,一律不动 |
| 执行侧 4 个 skill 被按设计侧标准删 | 执行侧任务只删重复规则和程序会检查的规则,步骤说明和自检保留,任务里逐条写明 |
| 模板里的开头结论标题和注册表对不上 | 标题以「必须严格执行的契约」第 2 条为准,逐字;T-1 之后用 `features check` 实测 |
| T-5 先删了旧 skill,T-3、T-4 读不到 | 同一批内顺序固定:T-3、T-4 做完再做 T-5 |
| 门禁拦下按旧模板写的产物 | T-23 放在最后一批;`features check` 跑不起来时放行 |
| 本仓库自己的提交被新门禁拦 | 本仓库的 `.claude/` 是旧 hook,实施期不受影响;新门禁只在重跑 `cgraphx install` 后生效 |

### 验收对照(spec §13)

| spec §13 | 对应任务 | 怎么核对 |
|---|---|---|
| 1. 25 个 skill,9 个废弃目录已删并登记 | T-5 | `ls assets/claude-template/skills \| wc -l` 为 25;`deprecated-assets.json` 有 9 条新路径 |
| 2. knowledge-recall、write-docs 按 §5 工作 | T-3、T-4 | 读两个 SKILL.md 对照 spec §5 |
| 3. 澄清结果按 §6 输出 | T-6 | 读 clarify SKILL.md 与 `references/澄清结果页.md` |
| 4. spec 有 `> 产物: spec`,没有一图看懂,check 不查 spec 开头 | T-1、T-7 | `grep -rn 一图看懂 assets/ src/` 无结果;本需求的 spec 跑 `features check` 无失败 |
| 5. 设计预览只有重点决策表;大需求 index 有分批和启动语 | T-8 | 读 write-plan SKILL.md 的范例 |
| 6. 新产物都有头部和开头结论,check 通过 | T-4、T-7 到 T-15 | 各模板的范例与「必须严格执行的契约」第 2、3 条逐条对照 |
| 7. 门禁行为 | T-1、T-23 | 按 T-23「验证方式」走一遍 |
| 8. `/end` 写发布记录 | T-15 | 读 `commands/end.md` |
| 9. web 两处提示 | T-2 | `grep -n 代码地图已停止维护 src/web/codemap-templates.ts` 两处 |
| 10. 文档里不再有已废弃 skill 的现行用法;CHANGELOG 有条目 | T-21、T-22 及各 skill 任务 | 下方 grep 只命中允许的地方 |
| 11. 既有测试全部通过 | 全部 | `npm run build && npm test` |

收尾时的 grep(允许命中:`deprecated-assets.json`、`CHANGELOG.md`、知识库条目里带日期的历史说明):

```bash
grep -rn -e subagent-implement -e knowledge-api -e code-map-write -e code-map-recall -e write-prd -e write-design-doc -e write-api-doc -e knowledge-migrate -e write-delivery-guide assets/claude-template README.md README.en.md CLAUDE.md docs/knowledge
```

### 待确认项

无。2026-10-19 负责人确认:

1. 同意给 `features check` 加 `--staged`,已写进 spec §8.4;本 plan 各文件的依据随之更新为 `spec@cf4712c`。
2. iboc-check 的「补设计文档 改由 write-docs 生成」按「只把指引改成 `/write-docs`,不新增第四种可补产物」落地(T-17)。
