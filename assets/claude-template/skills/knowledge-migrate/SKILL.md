---
name: knowledge-migrate
disable-model-invocation: true
description: 将存量知识库(docs/knowledge/)批量迁移到新分类体系,两阶段各自独立提交——阶段一 frontmatter 换血:逐篇读内容,按内容主题判定新 document_type / source_type / 业务域(不按旧值机械映射),服务模块移入 tags,仅改写 frontmatter 四个字段(保留正文与其余全部字段;owners 现为必填,缺失时补填默认负责人),dry-run 报告 → 用户确认 → 执行 → 逐篇 docs validate(失败回滚该条)→ 剔除归档 → 索引重建提议 → 抽检;阶段二 文件名迁移(仅当存在不合规文件名,典型为早期全英文 kebab-case):按现行命名规则拟新 slug,改名并同步改写全库引用,悬空校验不过整批回滚。Use when 迁移知识库/分类迁移/类型迁移/frontmatter 迁移/知识库换血/英文文件名迁移/文件改名/migrate knowledge/taxonomy migration.
---

# 知识库迁移 (Knowledge Migrate)

## 定位

- **存量一次性换血,无双轨期**:分类体系换成 document_type 7 值 / source_type 5 值、domains 语义转向业务域;本 skill 是存量迁移的唯一执行载体。
- **两阶段,各自独立提交**:阶段一改 frontmatter(报告 → 确认 → 执行 → 校验 → 剔除 → 索引 → 抽检),完成并提交后才进阶段二;阶段二改文件名(仅当存在不合规文件名,典型为早期全英文 kebab-case 知识库),改名必同步改写全库引用。阶段可单独触发:文件名已合规的库只做阶段一。
- **按内容主题判定,不按旧值机械映射**:值合法 ≠ 归属准确;同名保留值同样逐篇复核。
- **用户确认是唯一人工闸门**:每阶段先出 dry-run 报告,不改任何文件;未确认不得执行写入。

## 新分类枚举表(迁移目标)

### document_type(7 值)

| 值 | 含义 |
|---|---|
| business-entity | 业务实体 |
| business-flow | 业务流程 |
| mechanism | 技术机制(含架构) |
| decision | 决策 |
| rule | 规则 |
| lesson | 教训 |
| guide | 指南(含运维手册/教程/安装/FAQ/API 文档) |

### source_type(5 值)

| 值 | 含义 |
|---|---|
| work_context | 工作上下文 |
| batch_exploration | 批量探索 |
| review | 评审 |
| debugging | 调查排障 |
| manual | 手工 |

## 旧值 → 新值映射表(判定依据)

### document_type

| 旧值 | 新值 / 判定方式 |
|---|---|
| concept | → business-entity |
| exploration / finding / analysis | 按内容主题判定:讲业务流程 → business-flow;讲技术机制/架构 → mechanism;讲业务实体 → business-entity |
| architecture | → mechanism |
| warning | 约束类 → rule;复盘类 → lesson |
| tutorial / runbook / installation / api / faq | → guide |
| conversation / note | 按主题判定;确无主题 → 剔除入库(记入剔除清单) |

### source_type

| 旧值 | 新值 |
|---|---|
| ai_session | → work_context |
| architecture_review / code_review | → review |
| debugging | → debugging(同名保留,按新语义复核) |
| manual / human_note / external_summary | → manual |

### domains

- **服务模块值迁 tags**:domains 中的服务模块值移入 tags(在原 tags 基础上追加,不覆盖)。
- **按内容填业务域**:迁移后 domains ≥1 项(**不得留空**)。
- **非空边界**:服务模块值迁出 domains 后,若文档无明确业务域归属,必须按内容填入合适的业务域——不得迁出空 domains。

### owners(新必填,缺失补填)

- owners 现为必填字段:缺失或空列表 → `docs validate` 判 `missing_required_field`,该条迁移会被校验回滚。
- **已有 owners 一律原样保留**,不改写、不追加。
- **缺失或为空 → 补填默认负责人**:取 `git config user.name`(取不到则请用户给定),作为该文档 owners 的唯一值。
- 补填是批量默认、不逐篇追问:在 dry-run 报告表「owners 补填」列示出,随第 3 步用户确认一并通过;用户对某条负责人有意见,在该步逐条修订。

### 同名保留值复核

decision / rule / lesson / guide(document_type)与 debugging / manual(source_type)是同名保留值——**值合法 ≠ 归属准确**,必须按新语义逐篇复核,不得以「值没变」为由跳过。

### 判定纪律

**按内容主题判定,不按旧值机械映射**:逐篇读文档内容(至少读 Summary 与标题/正文要点)再判定;判定依据浓缩为一句话记入报告表,供抽检可审。

## 阶段一:frontmatter 迁移

1. **定范围**:目标项目知识库(`docs/knowledge/` 全量)或用户指定文件集;域外文件不碰。
2. **dry-run**(不改任何文件):逐篇读内容,按上面的「旧值 → 新值映射表」判定,生成**迁移报告表**(格式见下节)——每行含判定依据(一句话);主题不明者标剔除建议。
3. **用户确认(硬检查点)**:报告交用户确认——**未确认不得执行写入**;用户对单条的修改意见直接采纳,修订报告后以确认版为执行依据。
4. **执行**:按确认版报告批量改写 frontmatter——**仅改 document_type / source_type / domains / tags 四个字段**,并对 owners 缺失/为空的条目按确认版报告补填默认负责人(见「owners(新必填,缺失补填)」);保留正文与其他全部 frontmatter 字段(未知字段原样保留,见「字段改写纪律」)。
5. **逐篇校验**:`cgraphx docs validate <file>`(或 `node dist/cli/index.js docs validate <file>`);不过的条目**回滚该条**(恢复迁移前 frontmatter)并列入失败清单。
6. **剔除执行**:主题不明的剔除项**移出索引目录**(默认 `docs/knowledge/` → `docs/knowledge-archive/`,归档目录可在第 3 步用户确认环节改)——留在 `docs/knowledge/` 带旧值会导致重索引 skip,违反「重建索引无 skip」验收;剔除动作同样在用户确认后执行。
7. **提议重建索引**:`cgraphx docs index`(**用户确认后**执行,全量覆盖式、事务性:失败回滚,不坏旧索引);不得自动执行。
8. **输出**:① 抽检建议——随机抽 N 篇供人工核对(含判定依据;默认 10% 且 ≥3 篇);② 剔除清单(含归档去向);③ 失败清单(validate 不过被回滚的条目)。
9. **独立提交**:阶段一改动单独提交,提交后再进阶段二。

## 阶段二:文件名迁移

仅当库内存在不合规文件名时执行(典型:早期知识库文件名全英文 kebab-case,如 `architecture-overview.md`);文件名已合规则跳过本阶段。改的是阶段一 survivors(仍在 `docs/knowledge/` 的文件)。

1. **dry-run(不改文件)**:逐篇按「文件命名规则」拟新 slug;扫全库 `related_documents` 与正文中的 `.md` 路径引用,列出每个改名的受影响引用方;生成**文件名迁移报告表**(格式见下节)。
2. **用户确认(硬检查点)**:未确认不得改名;确认一并涵盖本阶段重建索引授权(不再设第二暂停)。
3. **执行(原子批)**:由确认版报告建立 old→new 全量映射,然后 `git mv` 改名(保历史)+ 同步改写全库引用——`related_documents` 与正文中按路径引用处,保留原前缀形态(`./x.md` / `docs/knowledge/x.md`)仅换基名。正文语义一字不动(路径替换除外)。
4. **悬空校验**:扫所有 `related_documents` 目标与正文 `.md` 引用,须全部落地到现存文件;出悬空 → **整批回滚**(`git mv` 可逆 + old→new 反向映射还原引用)并列失败清单,不做半回滚。
5. **重建索引**:`cgraphx docs index`(路径已变,必须重建;授权已折叠入第 2 步确认);验收同阶段一,索引报告 0 skipped。
6. **独立提交**:与阶段一分开提交。
7. **输出**:① 抽检——随机抽改名篇目输出改名 + 引用改写 diff;② 失败清单(悬空回滚的批次)。

## 迁移报告表格式

列定义(dry-run 产出,提交用户确认):

| 列 | 填法 |
|---|---|
| 文件 | 相对项目根的路径 |
| 旧 document_type → 新 | 旧值 → 新值;同名保留值标「已复核」 |
| 旧 source_type → 新 | 同上 |
| 旧 domains → 新业务域 | 迁出服务模块后保留/补填的业务域值 |
| 移入 tags 的服务模块 | 从 domains 移入 tags 的具体值;无则 — |
| owners 补填 | 缺失/为空 → 填默认负责人(git user);已有 owners → — |
| 判定依据 | 一句话(为什么判为该新值),抽检可审 |
| 剔除建议 | 主题不明者填「剔除」+ 理由;其余 — |

## 文件命名规则(阶段二)

slug 跟项目实际叫法(沿用 knowledge-write「命名与语言」):中文概念用项目语言,代码标识符/协议/产品名保留真实形式(markdown / redis / CodeGraph 不翻);取 title/主题的词,不二次翻译;逐篇判定,依据入报告表。例:

| 旧文件名 | 新文件名 | 依据 |
|---|---|---|
| architecture-overview.md | 架构总览.md | title「CodeGraph 架构总览」,产品名 CodeGraph 不入 slug |
| markdown-knowledge-base.md | markdown知识库.md | markdown 为标识符保留英文,「知识库」用项目语言 |

## 文件名迁移报告表格式

列定义(dry-run 产出,提交用户确认):

| 列 | 填法 |
|---|---|
| 旧文件名 → 新文件名 | 相对 `docs/knowledge/` 的基名变更 |
| 命名依据 | 一句话(新 slug 怎么来的),抽检可审 |
| 受影响引用方 | 全库内经 `related_documents` 或正文路径引用该文件、需同步改写的文件清单;无则 — |

## 字段改写纪律

仅改四个字段(owners 缺失/为空时另按「owners(新必填,缺失补填)」补填默认负责人),其余一律保留。改写结果形态(值取自确认版报告):

```yaml
document_type: <新 document_type>   # 枚举表 7 值之一
source_type: <新 source_type>       # 枚举表 5 值之一
domains:                            # 业务域,≥1 项,不得为空
  - <按内容判定的业务域>
tags:                               # 原 tags 保留 + 追加从 domains 移入的服务模块
  - <原 tags…>
  - <移入的服务模块>
# 其余 frontmatter 字段(title / concepts / aliases / status /
# related_code / related_documents / created / updated 及任何未知字段):原样保留
# owners:已有则原样保留;缺失/为空则补填默认负责人(见「owners(新必填,缺失补填)」)
# 正文:一字不动
```

## 红线

- **阶段一不改正文**:只改写 frontmatter 的 document_type / source_type / domains / tags 四个字段(owners 缺失/为空时按规则补填默认负责人,不改写已有 owners)。
- **未知字段保留**:除四个目标字段(及 owners 缺失补填)外的全部 frontmatter 字段原样保留,不删不改。
- **owners 只补不改**:已有 owners 一律保留;仅缺失/为空时补填默认负责人,不覆盖、不追加。
- **validate 不过即回滚该条**:`docs validate` 失败的条目恢复迁移前 frontmatter,列入失败清单,不带病入库。
- **不自动跑 docs index**:索引重建仅在用户确认后执行。
- **剔除必先经用户确认且给出归档去向**:剔除项必须移出索引目录(默认 `docs/knowledge-archive/`),禁止留在 `docs/knowledge/` 带旧值(重索引会 skip)。
- **域外文件不碰**:只动 `docs/knowledge/` 或用户指定文件集。
- **迁移后 domains ≥1 项**:服务模块迁出后必须按内容补填业务域,不得迁出空 domains。
- **阶段二改名必同步改引用**:`git mv` 改名必须同步改写全库 `related_documents` 与正文中对该文件的路径引用(保留 `./x.md` / `docs/knowledge/x.md` 前缀形态,仅换基名);禁止只改名不改引用,留悬空引用。
- **阶段二不改正文语义**:仅替换路径引用,正文其余内容一字不动。
- **阶段二悬空即整批回滚**:悬空校验不过 → 整批回滚(`git mv` 可逆 + old→new 反向还原引用),列失败清单,不做半回滚。
- **两阶段独立提交**:阶段一(frontmatter)与阶段二(文件名)分开提交;阶段一提交后才进阶段二。
- **文件名已合规不强改**:阶段二仅处理不合规文件名(典型早期全英文 kebab-case);已合规则跳过,不为统一而统一。
