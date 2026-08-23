# 规格说明: 实现方式判断标准

> feature-id: 2026-08-21-实现方式判断标准
> 负责人: liulongfei
> 日期: 2026-08-21

## 目标与范围

**目标**:修改 `/implementation` 与 `/subagent-implement` 的判断标准——以**需求规模**取代「任务量」作为判断依据,解决两个问题:① 明显的小任务也被推荐走子 agent 实现;② 任务拆分过细导致派出的子 agent 过多,浪费时间。

**范围**(判断标准文案的 5 处落点,口径必须一致):

- `skills/clarify-requirements/SKILL.md`「下游实现 skill 选择」节
- `skills/write-plan/SKILL.md`(拆分规则 + index 结构)
- `skills/subagent-implement/SKILL.md`「定位·门槛」
- `FLOW-MAP.md` 开发流程节
- `skills/cgraphx-guide/how-to-use.md` 工作流描述

均位于 `assets/claude-template/` 下。

**明确非目标**:

- 不改 subagent-implement 的内部执行机制(四件套注入、status 协议、sanity check、reviewer 结构、独立提交规则)。
- 不改 write-plan 的 plan 文件组织(`-01-schema` / `-02-backend` / `-03-frontend` 等按需文件结构)。
- 不改 implementation skill 的定位与流程。
- 不改「subagent-implement 必须有 plan」这一前置关系。
- 不动 TS 源码——本需求为纯 skill 文案改动。

## 已确认规格

### S1 判断维度:删除「任务量 / 跨域数」

- 「任务量 ≥3」与「跨域数」不再作为实现方式的判断维度。**任务量是拆解的产物,不是需求的输入**——任何需求都拆得出 ≥3 个任务,以它做判据会形成「拆得越细 → 越达标 → 子 agent 越多」的自我强化循环。
- 唯一判断依据是**需求规模**:变更面宽度 × 单个 agent 上下文能否装下整个实现。
- **「跨域」不作为规模信号**:最小的全栈需求也天然跨 schema/backend/frontend 三域,跨域是全栈需求的必然特征,不是大需求的特征。

### S2 两级判断

**clarify 收尾 = 粗筛**(决策表由 5 维度表改为三档):

| 档位 | 条件 | 推荐 |
|---|---|---|
| 明显小 | 单点变更 / 1-3 文件 / 单模块 | `/implementation` |
| 明显大 | 预估变更文件 ≥10 **且** 跨 ≥3 个相互独立的模块 | 过 plan 后 `/subagent-implement` |
| 拿不准 | 其余情形 | 只推荐过 `/write-plan`,不硬判实现方式 |

- 默认倾向:**拿不准 → implementation 方向**(子 agent 有结构性开销,只在单上下文装不下、且任务相互独立时才值)。
- 保留 subagent-implement 需 plan 前置的说明,作为附带事实而非判断维度。

**write-plan 出 plan 时 = 终判**:

- plan index 增加「执行方式建议」字段,含建议结论 + 理由,随 plan 过审由用户一并审。
- 仅当以下条件**同时成立**才建议 `/subagent-implement`,否则建议 `/implementation`:
  1. 任务跨 ≥3 个相互独立的模块;
  2. 预估变更文件总数 ≥10;
  3. 任务间可独立派任(无需实时反馈)。

### S3 任务粒度锚点(write-plan 拆分规则补强)

- 任务 = **工作包**:连贯的功能块 / 层块,可独立验证。
- 「改 1 字段 / 加 1 参数 / 调 1 处样式」级微任务并入同层 / 同功能任务。
- 总任务数一般 **≤6**;超过先检查是否拆太细,优先合并。
- 既有规则继续有效:「默认合并;拆开仅限任务过大撑爆上下文、强耦合需实时反馈」「不把简单需求拆碎」。

### S4 反例(直接写进 skill)

- **小全栈需求**(加 1 字段 + 改 1 接口 + 1 页面展示,跨 schema/backend/frontend 三域但规模小)→ `/implementation`。
- 反例承载的示范意图:跨域 ≠ 大需求;「≥3 任务 / 跨 3 域」不构成走 subagent 的理由。

### S5 subagent-implement 门槛与防线

- 门槛表述改为规模口径,删除「≥3 任务 + 跨多文件域」;「主 agent 上下文装不下」作为定性兜底条款保留。
- 新增防线:执行时若发现 plan 任务明显过细(大量微任务),**先向用户提出合并建议再派任**。
- 保留:无 plan(或明确任务清单)不执行;任务强耦合(后任务依赖前任务实时反馈)→ 引导走 `/implementation`。

### S6 数值锚点的性质

- ≥10 文件 / ≥3 独立模块 / ≤6 任务为**初始锚点**,是判断参考而非程序化校验;skill 文案按判断参考表述,实际运行后可按本 spec 的变更流程调整。

## 关键约束

- **修改入口是 `assets/claude-template/`**(随包分发、`cgraphx install` 部署的源),不是本仓库根目录的 `.claude/`(被 gitignore 的部署运行环境)。
- 5 处文案口径一致;不得残留任何以「任务量 / 跨域数」为实现方式判断依据的表述。
- clarify 的收尾推荐动作本身保留(总结仍给下一步建议),只改判断依据与表述结构。
- frontmatter 若含旧判据表述则同步修正;不改调用方式属性(model-invoked / `disable-model-invocation` 等)。

## 不可留到实现期的决策

- 三档粗筛的定义;「明显大」的双条件(**且**关系,不得改为"或")。
- 终判建议 subagent 的三条件同时成立规则。
- 默认倾向:拿不准 → implementation。
- 粒度锚点:工作包定义、微任务并入、总任务数 ≤6。
- 反例的内容与结论(小全栈 → implementation)。
- 数值锚点本身(10 / 3 / 6):实现期不得自行调整。

## 验收与验证关注点

1. **口径一致**:5 个文件中实现方式判断均以需求规模表述;在 `assets/claude-template/` 内 grep,无以「任务量 / ≥3 任务 / 跨域数」作为实现方式判断依据的残留表述(描述任务拆解、批次执行等非判断语境提及任务数不算残留)。
2. **字段存在**:write-plan 的 index 结构定义含「执行方式建议」(带理由)。
3. **反例存在**:clarify 决策区与 subagent-implement 门槛节含小全栈反例(跨 3 域但走 implementation)。
4. **防线存在**:subagent-implement 含「发现任务过细先提合并建议」表述。
5. **自洽性**:新标准应用于本需求自身应落在 implementation 档(单域文案改动、≤6 任务)——作为措辞的逻辑自检。
6. **引用不破坏**:其余 skill / 文档对 implementation / subagent-implement 的引用不受影响。

## 待确认项

无。
