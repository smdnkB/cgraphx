# 迁移与注记计划: 2.0-spec 兼容性注记(M-1)+ hx 61 篇迁移执行(M-2)

> 隶属:`知识库分类体系重设计-index.md`(全局契约见 index §7,本文件任务中重复关键契约原文,自包含可执行)
> feature-id: 2026-07-31-知识库分类体系重设计 · 负责人: liulongfei

---

### T-M-1: 2.0-spec 追加分类枚举换血兼容性注记

- **目标**: 在《cgraphx2.0重构-spec》显式记录 frontmatter 枚举换血对其「沿用现有接口」承诺的偏离(spec §6.1 要求)。
- **对应 spec 条款**: §6.1(2.0-spec 兼容承诺注记)。implementer 据此读 spec 原文。
- **强制引用**: 无。
- **依赖**: T-C-1(换血已发生,注记描述既成契约)。
- **涉及范围**: `docs/features/2026-07-25-cgraphx2.0重构/cgraphx2.0重构-spec.md`(仅追加注记段落,不改原文)。
- **必须严格执行**:
  - 读文件定位 §9「不可留到实现期的决策」中「三块 CLI 接口:沿用 codegraph 现有子命令语义,不可在实现期重设计核心语义」条目;
  - 在该条目处(或 §9 末尾)追加注记段落,内容要素(措辞可适配,要素固定):**2026-07-31 注:知识库分类体系重设计(《2026-07-31-知识库分类体系重设计-spec》)对 frontmatter 枚举内容做换血式变更——document_type 17→7 值、source_type 7→5 值、domains 语义转向业务域;CLI 子命令行为语义不变(本承诺保持),枚举内容变更是显式破坏性变更,无双轨期,配套 knowledge-migrate 迁移 skill 与 hx 存量迁移。**
  - 不改动 2.0-spec 任何原有文字。
- **允许局部适配**: 注记的安放位置(紧贴该条目或 §9 末尾)与行文。
- **完成条件**: 注记已追加;原文件其余内容逐字未变(diff 仅新增行)。
- **验证方式**: `git diff docs/features/2026-07-25-cgraphx2.0重构/cgraphx2.0重构-spec.md` 贴报告(仅 + 行)。
- **独立提交**: 是(docs 提交)。subject:`docs: 2.0-spec 追加分类枚举换血兼容性注记`;不附 Co-Authored-By。
- **风险/注意事项**: 只追加不改写——2.0-spec 是历史契约档案,原文不可修订式涂改。

---

### T-M-2: hx 61 篇迁移执行与验收

- **目标**: 用 knowledge-migrate skill 流程完成 hx 知识库(`/Users/smdnk/objects/java/hx/docs/knowledge`,61 篇)的分类体系迁移,作为全链路验收试金石(validator + skill + web 联调)。
- **对应 spec 条款**: §6.2(hx 迁移范围/方式/时序)、§6.3(domains 非空边界)、§8(未迁移文档行为、同名保留值复核、主题不明剔除)、§9(验收标准 3/4/5)。implementer 据此读 spec 原文。
- **强制引用**: 无代码规范;执行依据是 `assets/claude-template/skills/knowledge-migrate/SKILL.md`(S-4 产物)——**开工前完整读一遍,严格按其流程执行**。
- **依赖**: T-C-1(新 validator 已构建)、T-C-2(web 7 枚举可浏览)、T-S-3(排查闸门通过)、T-S-4(迁移 skill 就绪)、T-M-1。全部就绪方开始(批次 4)。
- **涉及范围**: `/Users/smdnk/objects/java/hx/docs/knowledge/**.md`(frontmatter 改写);`/Users/smdnk/objects/java/hx/.cgraphx/`(重建索引写入,gitignored 运行时数据)。**不改 hx 仓库的 git 状态**(不 git add / commit / stash);cgraphx 仓库无文件改动。
- **必须严格执行(两阶段,硬检查点分隔)**:
  - **阶段 1 — dry-run 报告(不改任何文件)**:
    - 预检:`node dist/cli/index.js docs validate <hx 中任一文件>` 确认新 validator 生效(dist 须为 C-1 后构建,否则先 `npm run build`);记录当前 hx 索引状态(`docs concepts/domains <hx-path>` 快照,供迁移后对比);
    - 逐篇读 61 篇内容,按 knowledge-migrate 内嵌映射表(index §7.5)判定:新 document_type / 新 source_type / 业务域(服务模块值迁 tags)/ 同名保留值复核 / 主题不明者标剔除;
    - 产出**迁移报告表**(文件 / 旧→新类型 / 旧→新来源 / 旧 domains→新业务域 / 移入 tags 项 / 判定依据 / 剔除建议);
    - **阶段 1 结束时返回 controller:Status = DONE_WITH_CONCERNS,concern = 「迁移报告待用户确认,确认后继续阶段 2」**(此时不得返回 DONE;不得自行进入阶段 2)。controller 取得用户确认(含用户对单条的修改意见)后,通过 SendMessage 向你传达,你再执行阶段 2;
  - **阶段 2 — 执行与验收(用户已确认)**:
    - 按确认后的报告批量改写 frontmatter:仅改 document_type / source_type / domains / tags;**正文与其他字段不动**;
    - 逐篇 `node dist/cli/index.js docs validate <file>`:失败条目回滚该条(恢复原 frontmatter)并列入失败清单;
    - domains 非空检查(spec §6.3):每篇迁移后 domains ≥1 项,服务模块迁出后补填业务域;
    - 剔除执行:按确认后报告将主题不明文件移入 `/Users/smdnk/objects/java/hx/docs/knowledge-archive/`(索引扫描目录 `docs/knowledge/` 外);
    - 重建索引:**阶段 1 报告确认已涵盖索引重建授权,阶段 2 内不再设第二暂停**(knowledge-migrate skill 的「索引确认」检查点在本任务中折叠入报告确认;spec §6.2 要求迁移完成后全量重建索引作为验收,索引为事务性派生物):`node dist/cli/index.js docs index /Users/smdnk/objects/java/hx`——验收:索引报告显示 **0 skipped**;
    - web 联调验收:`node dist/cli/index.js web /Users/smdnk/objects/java/hx --port 24691` 启动,curl 验证:总览页统计条数字与迁移后索引一致、类型芯片为 7 新枚举且 business-flow 居首(hx 流程文档最大类)、随便点进一篇详情页 200;验证后关闭服务;
    - 抽检:随机抽 ≥6 篇(约 10%)输出迁移前后 frontmatter diff 供人工核对;
    - hx 仓库状态:**只报告 `git -C /Users/smdnk/objects/java/hx status --short` 与 `git -C ... diff --stat` 摘要,不执行任何 git 写操作**;
  - **正文未变验证**:抽检篇目用 `git -C /Users/smdnk/objects/java/hx diff -- <file>` 确认 diff 仅发生在 frontmatter 块(`---` 之间),正文零改动。
- **允许局部适配**: 报告表排版;剔除文件的归档目录名(默认 `docs/knowledge-archive/`,用户确认环节可改——但**必须移出索引目录**,保留原地与「0 skip」验收互斥,不是可选项);抽检篇目选择(随机但覆盖各旧类型)。
- **完成条件(验收口径,spec §9)**:
  - 迁移后全部入库文档通过新枚举 validate,重建索引 0 skipped;
  - 类型分布不再是 exploration 独大(报告给出迁移前后类型分布对比);domains 呈现业务域(迁移前后 domains 词汇对比);
  - web 7 枚举浏览验收通过;
  - 抽检 diff 仅 frontmatter 块;
  - 失败清单 / 剔除清单 / 抽检报告齐全;hx 仓库 git 状态仅报告未改动。
- **验证方式**: 各步骤命令输出贴报告(索引报告、web curl、分布对比、diff 摘要)。
- **独立提交**: 特殊——本任务在 cgraphx 仓库**无提交**(无文件改动);hx 仓库的提交**归用户决定**(implementer 不碰 hx git)。收尾报告明确告知用户:hx 有未提交的迁移改动,是否提交/如何提交由用户定。
- **风险/注意事项**:
  - **阶段分隔是硬纪律**:未经用户确认执行阶段 2 = 61 篇未审批量变更,严重违规;
  - dist 必须是 C-1 之后的构建,否则 validate 用旧枚举,迁移「通过」是假象——预检步骤就是防这个;
  - hx 索引重建会写 hx/.cgraphx/(运行时数据,gitignored,可接受);
  - 迁移判定遇两可(如某文档流程/机制难分)→ 报告中写明判定依据交用户裁决,不自行默选;
  - knowledge-migrate 红线(不改正文/validate 不过回滚/不自动索引)逐条遵守,M-2 是该 skill 的首次实战,执行偏差要记录为 skill 改进建议(报告 Concerns)。
