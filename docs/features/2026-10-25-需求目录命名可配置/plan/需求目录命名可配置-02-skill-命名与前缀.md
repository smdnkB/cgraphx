# 实现计划: 需求目录命名可配置 · T-2 skill:命名与前缀

> 产物: plan
> 依据: spec@869e407

## T-2: skill:按规范命名 + 取前缀口径

- 目标:dev-spec 建需求目录前先读项目命名规范,没有才按默认格式;dev-impl 补上建目录的入口,dev-handoff 的括注补齐;12 处取文件前缀的说法统一成 C-3。
- 对应 spec 编号:F2(①②③④)、F4①、D2、D3、D6;spec「细节方案:F2」下「命名口径」五条
- 强制引用:无(只改 skill 文本)
- 依赖:无;与 T-1、T-3 同时跑。
- 涉及范围(全部在 `assets/claude-template/` 下,共 13 个文件):
  - `skills/dev-spec/SKILL.md`:工作流程第 0 步「命名先行」(第 24 行);「产物位置与命名」节(第 108–115 行)
  - `skills/dev-impl/SKILL.md`:工作流程第 2 步「读上下文」里「动 schema 必读 data-standards.md」那句(第 19 行)
  - `skills/dev-handoff/SKILL.md`:第 1 步「没有 → 按 dev-spec 第 0 步和『产物位置与命名』新建(业务 ID、标题语言由用户确认,不把中文转成英文 slug)」的括注(第 32 行);第 3 步的取前缀句(第 38 行)
  - 取前缀句换成 C-3(10 个文件):
    - `skills/dev-plan/SKILL.md`「产物位置与命名」(第 156 行)
    - `skills/dev-wireframe/SKILL.md`(第 48 行)
    - `skills/doc-delivery/SKILL.md`(第 18 行)
    - `skills/doc-workload/SKILL.md`(第 79 行)
    - `skills/api-case/SKILL.md`(第 27 行)
    - `skills/api-run/SKILL.md`(第 53 行)
    - `skills/ui-case/SKILL.md`(第 29 行)
    - `skills/ui-run/SKILL.md`(第 54 行)
    - `commands/dev-end.md`(第 7 行括号里的「前缀 = feature-id 去掉开头的日期」)
    - `skills/api-case/references/collection-layout.md`「取名规则」里 `<需求前缀>` 一条(第 33 行)
- 必须严格执行:
  - dev-spec「产物位置与命名」按 spec「命名口径」五条改写:
    1. 有 `docs/guides/feature-standards.md` 的「需求目录命名」一节 → feature-id 按其格式;格式里没有 `YYYY-MM-DD` → 用 C-6 的 F2① 提示原文告诉用户,改用默认格式
    2. 没有 → feature-id = `YYYY-MM-DD-[业务ID-]<标题>`,原有说明(业务 ID 字母数字 + 连字符、标题不转英文 slug、重名追加短后缀、同目录已有 PRD 复用)保留
    3. 文件前缀按 C-3,并注明默认格式下就是 `<业务ID>-<标题>` 或 `<标题>`
    4. 敏感字符(`/ \ : * ? " < > |`)拒绝、不转英文 slug、重名追加短后缀,对规范新增的段同样适用
    5. 已有目录一律复用,不按新规范改名(F2③)
  - 规范路径、节名、格式行写法按 C-2
  - dev-spec 第 0 步(D3):原有 ①–④(业务 ID / 标题语言 / 负责人 / 任务)原样保留,占位段确认加在其后——有规范时,确认格式里除日期外的每个占位段;有取值表的段(如模块)先按要改的代码目录给出建议值再确认;需求跨多个模块而规范没写怎么取 → 列出涉及的模块,问用户取哪个(F2②);改动不在模块表里而规范没写怎么取 → 列出改动的目录,问用户取哪个模块名,并提醒把它补进模块表(F2④);没有规范时,第 0 步的确认项和现在一样
  - dev-impl(D2):在「动 schema 必读 data-standards.md」之后补一句——要放需求 `sql/` 脚本但还没有需求目录 → 按 dev-spec 第 0 步和「产物位置与命名」建目录
  - dev-handoff 第 32 行括注改为「业务 ID、标题语言及规范里的其他段由用户确认,不把中文转成英文 slug」
  - 12 处取前缀句(dev-spec 定义 + dev-handoff 第 38 行 + 上面 10 个文件)都要含 C-3 原文;原句里多余的反引号片段「`YYYY-MM-DD-`」一并去掉
  - dev-plan 第 29 行、dev-wireframe 第 24 行、visual-explain 第 47 行「按 dev-spec 第 0 步和『产物位置与命名』」这类引用句不改(D2)
  - 不改各文件 frontmatter 的 `name`、`description`
  - 只改 `assets/claude-template/`,根目录 `.claude/` 是部署副本,不改
- 允许局部适配:
  - dev-spec 两处的措辞与排版——五条口径和 C-2、C-3、C-6 原文都在即可;可以加一个模块前缀的命名例子:`order-2026-10-25-REQ-1024-订单导出` → 文件前缀 `order-REQ-1024-订单导出`
  - `collection-layout.md` 那一条的措辞,要表达:`<需求前缀>` 就是文件前缀(按 C-3)
  - 各文件取前缀句前后的连接词
- 具体要求:
  - 写法照本仓库 skill 准则:直接给最好的例子,不加长篇说明(本仓库 CLAUDE.md「工作内容和准则」)
  - dev-spec「结构」范例头部的 `> feature-id: 2026-10-18-REQ-1024-订单导出` 不改——默认格式的例子仍然成立
- 完成条件:
  - `grep -rn "去掉开头的日期" assets/claude-template` 无输出
  - `grep -rln "去掉日期段" assets/claude-template --exclude-dir=cgraphx-guide | wc -l` 输出 `12`(涉及范围里除 dev-impl 外的 12 个文件)
  - `grep -n "命名规范缺少日期段 YYYY-MM-DD,本次按默认格式命名" assets/claude-template/skills/dev-spec/SKILL.md` 有命中(C-6)
  - `grep -n "feature-standards.md" assets/claude-template/skills/dev-spec/SKILL.md` 至少命中一行
- 提交点:
  1. `feat(skills): dev-spec 按项目命名规范建需求目录——dev-impl 补建目录入口 + dev-handoff 括注`:`skills/dev-spec/SKILL.md`、`skills/dev-impl/SKILL.md`、`skills/dev-handoff/SKILL.md`(dev-handoff 第 38 行的取前缀句也在这一笔)
  2. `refactor(skills): 文件前缀统一为去掉日期段——10 处取前缀说法`:上面「取前缀句换成 C-3」的 10 个文件
- 风险/注意事项:
  - 改的 dev-plan 是正在用的 skill 本身,只改源文件,不影响本次执行
  - dev-spec 是所有建目录流程的唯一命名来源,五条口径漏一条就会让 dev-handoff、dev-wireframe、visual-explain、dev-plan、dev-impl 一起漏
