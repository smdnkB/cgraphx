# 规格说明: handdrawn-deck 页面脚手架与对齐校验脚本

> feature-id: 2026-08-02-handdrawn-deck页面脚手架与对齐校验
> 负责人: liulongfei
> 日期: 2026-08-02
> 业务 ID: 无(skill 内部工具开发,无工单)

## 背景与目标

handdrawn-deck 的「逐页委托引擎」与「deck 级对齐验收」目前是两个纯手工活,在 no-redo-demo
deck(8 页)的实测中各暴露了真实问题:

- **写页**:每页 300 行,其中约 275 行是引擎样板(H 工具库 / 动画引擎 / playStage / 控件 /
  boot / CDN 兜底)逐字相同,外加图标库子集;真正的内容 `buildScene` 约 100 行。手工复制
  样板 + 局部替换时,实测踩中「替换只覆盖前半,上一页残留代码使整页脚本死在半路」与
  「空行差异导致编辑匹配失败返工」两次事故。
- **验收**:deck §4 最关键的验收项——呼吸段数 = stages 行数、单元 id 与页面
  `unit('id')` 逐字一致、单元归属唯一、sec 累加、PAGES ↔ notes.js 页号匹配——全靠肉眼,
  实测需要临时写 ad-hoc 脚本才能核对。

**目标**:在 `handdrawn-deck/references/` 下新增两个零依赖 node 脚本,把上述两件事变成
「只写一个片段」与「一条命令」;并在 SKILL.md 的流程与验收条款里接上它们。

**范围**:

- `gen-page.cjs`:页面脚手架生成器(引擎体 + 图标子集构建期内联,产出单文件页 HTML)。
- `check-deck.cjs`:deck 静态对齐校验器(数据层对齐全静态可查,运行时行为继续交给
  「打开文件肉眼看一次」——不引入 headless)。
- SKILL.md 条款挂接:⑤ 逐页执行引用 gen-page、⑦ 通读自检与 §4 验收引用 check-deck。

**非目标**:

- 不改引擎渲染行为、不改放映壳、不改 notes.js 契约(deck §5)、不改图标库治理流程(引擎 §5)。
- 不引入任何构建工具 / 第三方依赖(与既有 `gen-script-md.cjs` / `seg.cjs` 同构:纯 node、
  CommonJS、拷进目录或直接跑)。
- 不做可视化 / 不做页面内容生成(生成的是脚手架,`buildScene` 内容仍是 agent 的专业活)。

## 已确认规格

### gen-page.cjs · 页面脚手架生成器

**职责**:把「`buildScene` 片段 + 图标清单 + 页序元信息」组装成与手写页**结构等价**的
单文件 HTML。引擎体与图标子集在**构建期**内联——成品保持 deck §5 的独立成品地位
(单独打开即整幅逐笔播放;`?deck=1` 隐藏控制条;`handdrawn:ready/show/stage/rough`
消息协议完整)。

**运行方式**:从 skill 目录直接跑(模板与图标库相对脚本自身目录 `__dirname` 解析),
`--out` 指向 deck 目录。**不拷进 deck 目录**(它与 seg/gen-script-md 不同:输入在 skill
目录而非 deck 目录)。

**输入(CLI)**:

| 参数 | 必需 | 说明 |
|---|---|---|
| `--scene <file>` | 是 | buildScene 片段文件:一个完整的 `function buildScene({rc,b,board,H,animate}){…}` |
| `--icons <a,b,c>` | 否 | 图标名清单(逗号分隔,对应 icon-library.js 的 ICONS 键);缺省 = 不内联图标库 |
| `--no <n>` | 是 | 页序(badge 右段、download 默认名) |
| `--series <文本>` | 是 | 系列名(badge 左段,如「改了,不用重做」) |
| `--title <文本>` | 是 | 页 `<title>` |
| `--badge <文本>` | 否 | 覆盖默认 badge(默认 = `<series> · <no 补零两位>`) |
| `--out <file>` | 是 | 输出 HTML 路径 |

**行为规则**:

1. 引擎体**提取自** `handdrawn-sketch-engine/references/engine-template.html`(唯一源,
   禁止在脚本里维护第二份副本):<style>、ambient、badge、stage、panel、err、以及引擎
   脚本的常量 / H / unit / measureAndPlay / renderAll / playStage / 控件 / message 协议 /
   boot——**剔除模板自带的示例 buildScene**。
2. 图标子集**提取自** `handdrawn-sketch-engine/assets/icon-library.js`:`stampGroup` +
   `placeIcon` + 清单列出的图标函数,`ICONS` 注册表**只含清单子集**;META 不内联(运行时无用)。
3. 注入页序元信息:`<title>`、badge 文本、SVG 下载文件名(默认 `p<no>-<out 的文件名主干>.svg`)。
4. 内联顺序固定:常量 → H → unit → 图标库(若有)→ 动画引擎 → buildScene → playStage →
   控件与消息 → boot。该顺序是契约(图标库依赖 H,buildScene 依赖图标库与 unit)。
5. **写出前对组装结果做 JS 语法校验**(提取 `<script>` 体过 node 语法检查):失败 →
   stderr 输出错误 + 退出码 1,**不落盘**;通过 → 落盘 + 输出一行摘要(字节数 / 图标数)。

**异常**:

- 图标名不在 icon-library.js 的 ICONS 中 → 退出码 1,stderr 列出全部可用图标名。
- scene 文件不含 `function buildScene(` 签名 → 退出码 1,说明片段格式。
- 模板 / 图标库文件缺失 → 退出码 1,输出期望路径。
- scene 片段自身语法错(组装前可预检)→ 退出码 1,透传语法错误定位。

### check-deck.cjs · deck 静态对齐校验器

**职责**:在组装前后对 deck 目录做一次静态体检,覆盖 deck §4 验收清单中**所有静态可查项**;
输出逐项 ✓/✗ 与总结,退出码供 CI / 流程串联。

**运行方式**:`node check-deck.cjs [deck目录]`(缺省 = 当前目录)。脚本可拷进 deck 目录,
也可从任意位置带参跑。`segmentScript` **提取自同目录 `deck.html`**(与 seg.cjs 同源同法:
壳是运行时真相;提取后过与 seg.cjs 相同的自检断言,失配即退出码 1 不继续)。

**检查项(每项独立 ✓/✗ / 警告)**:

| # | 检查 | 失败定义 |
|---|---|---|
| 1 | 页文件存在 | PAGES 各项 file 在目录中不存在——**`built:false` 的项豁免** |
| 2 | 页号匹配 | PAGES 的 no(缺省下标+1,与壳逻辑一致)与 notes.js pages[].no 双向集合不一致(多页 / 缺页) |
| 3 | 呼吸段对齐 | 有 stages 的页:segmentScript 切分段数 ≠ stages 行数 |
| 4 | 单元双向一致 | 有 stages 的页:页内 `unit('id')` 集合 与 stages.draw 并集互有差集(分别报「页内缺」/「stages 多余」) |
| 5 | 单元归属唯一 | 同一 unit id 出现在 ≥2 行 stages 的 draw 中(deck §4:每个单元属于且仅属于一行) |
| 6 | 脚本语法 | deck.html 与每页的最后一个 `<script>` 体未过 node 语法检查 |
| 7 | 时长合计 | **警告级**:输出各页 sec 累加值;传 `--target <秒>` 时,累加 ≠ 目标 → 警告(不影响退出码——时长是估算口径,不是硬契约) |
| 8 | 缓存版本 | **警告级**:`V` 非空但 `<script src="notes.js?v=…">` 的 v 与 V 不同步 → ✗;`V` 为空 → 警告「未设缓存版本,改页后有旧缓存风险」 |

**输出与退出码**:逐项 `P<n> <文件名> · <检查名> ✓/✗` + 一行总结;任一 ✗ → 退出码 1,
全 ✓(含仅警告)→ 0。stderr / stdout 分流:结果走 stdout,错误(无法检查)走 stderr。

**兼容性边界(不得误报)**:

- **无 stages 的页**(纯放映 deck / 改造前老页):跳过检查 3/4/5,标注「无 stages,整幅播放」,
  不算失败——壳对此类页的行为本就是降级整幅重播。
- **有 stages 但页内无 `data-unit`**:检查 4 判 ✗(这是真错位:壳会发 stage 消息而页不认)。
- **notes.js 缺失**:壳退回纯放映是合法的——check-deck 此时只跑检查 1/6(文件与语法),
  其余标注「无 notes.js,跳过」,不算失败。
- **PAGES 为空**:✗(空 deck 没有可校验内容,直接报错)。

## 关键约束(不允许 implementation 自行调整)

1. **成品页必须仍是单文件**:gen-page 的内联是构建期行为,产出的 HTML 不得 `<script src>`
   外部引擎 / 图标文件——deck §5「页面原样搬入、独立成品」是硬契约。
2. **引擎体与 segmentScript 不维护第二份实现**:提取自模板 / 壳 + 自检断言;提取逻辑失败
   必须响亮报错,禁止静默回退到内置副本。
3. **零依赖、CommonJS、可直接 `node 跑`**:与 gen-script-md.cjs / seg.cjs 同风格,
   不进 package.json、不经过任何打包步骤。
4. **check-deck 只读**:只读 deck 目录,不写任何文件、不修改 notes.js / deck.html。

## 验收与验证关注点

- **等价性回归(核心)**:用 gen-page.cjs 从 no-redo-demo 现有 8 页反向拆出的 buildScene
  片段 + 图标清单重新生成 8 页,与现有页在**结构与行为上等价**(渲染结果同 seed 同笔触;
  允许生成顺序之外的无意义字节差异,如空白)——装回 deck 放映,逐页渐进绘制不退化。
- check-deck 对 no-redo-demo 全 ✓ 退出码 0;对**人造错位样本**(改坏一处:删一个 unit /
  加一行 stages / 改一个页号)逐项准确报 ✗,退出码 1,且报错指向具体页与单元 id。
- 兼容性边界各造一个样本验证不误报(无 stages 页 / built:false 项 / 无 notes.js 目录)。
- SKILL.md 条款挂接后,照 ⑤⑥⑦ 新文案走一遍小 deck(2–3 页)能跑通:gen-page 出页 →
  组装 → check-deck 验收。

## Plan 编写约束

- 提取引擎体 / 图标函数 / segmentScript 的具体解析手法(正则 / 括号配对 / AST)由 plan 定,
  但必须带「提取结果自检」,且自检失败路径按 spec 的异常条款走。
- 两个脚本的 CLI 参数名与退出码语义是契约,plan 不得改名或改语义。
- SKILL.md 条款挂接是同一 plan 的一部分(脚本不挂进流程就等于没做);引擎 SKILL.md 不动。
- 既有 seg.cjs 与 check-deck 的切分逻辑重复是**有意**(两脚本独立可用,不互相 require);
  plan 可以让二者共享同一段提取代码的**写法**,但不做运行时依赖。

## 待确认项

无阻塞项。两个低优先口径已按如下默认处理,审阅时可推翻:

- 时长合计与缓存版本检查定为**警告级**(不影响退出码)——时长是估算、V 可选;
  若希望它们硬失败,改为 ✗ 级即可。
- gen-page 一次只生成一页(不做 --icons-file 批量清单)——页间图标依赖本就要求
  产出页先画(§7 串行条款),批量无收益。
