---
name: handdrawn-sketch-engine
version: 1.3.0
description: >
  用纯 HTML + rough.js 生成“白板手绘 / 涂鸦信息图 / 思维导图”风格的可视化，
  并自带逐笔绘制动画（白板手绘视频）、纸纹底、漂浮涂鸦、悬停微交互、可调抖动、
  可导出 SVG。中文手写字体 100% 正确、可编程、可批量、无订阅费。
  动手前先与用户确认布局结构，图标走“查库 → 复用 → 草稿 → 沉淀”治理闭环，
  保证系列图效果稳定。
  TRIGGERS / 触发词：手绘、手绘风、涂鸦、白板、白板动画、信息图、思维导图、
  流程图手绘、whiteboard、doodle、sketch infographic、hand-drawn、rough.js、
  Excalidraw 风、逐笔动画、SVG 描边动画、手绘视频、手绘海报、手绘 PPT 配图、
  手绘图标、马克笔风、手账风、可视化复刻、把这张图做成手绘。
when_to_use:
  - 需要“手绘 / 白板 / 涂鸦 / 思维导图”风格的信息图、海报、配图、流程说明。
  - 需要逐笔“画出来”的动画或白板手绘视频（含可批量 / 数据驱动 / 接配音对齐）。
  - 画面含中文且文字必须正确、可改、可国际化。
  - 需要系列图风格统一、或需要“实时调手绘强度 / 重放 / 导出矢量”等可编程能力。
  - 用户给了一张参考图，要求“用 HTML 复刻成手绘风”。
when_not_to_use:
  - 只要一张高质感、笔触晕染极丰富的静态封面，且文字很少或愿意后期修字 → 用图像模型直出更快更好（见“路线决策树”）。
  - 写实摄影 / 3D / 数据精确图表（柱状/折线数值图）→ 不属于本 skill 美学。
  - 需要像素级还原某张手绘原图的每一处笔触细节 → 走“混合路线”，图标用 AI 资产，结构仍用本引擎。
tags: [handdrawn, whiteboard, roughjs, svg, infographic, animation, chinese-font, doodle]
---

# 手绘白板信息图引擎 · SKILL

> 哲学：**引擎可复用，成品是实例。** 本 skill 交付的是一台“手绘渲染引擎 + 一套视觉规范”，
> 具体内容（画什么图标、写什么字、怎么连）通过一个 `buildScene(ctx)` 钩子注入。
> 换主题 = 只重写 `buildScene`，引擎、动画、交互、纸纹、字体策略一律不动。

## 0. skill 结构（文件各归其位，各司其职）

| 文件 | 角色 | 何时读 |
|---|---|---|
| `SKILL.md`（本文档） | 视觉规范 + 流程 + 治理规则 | 永远先读 |
| `references/reference-render.html` | **金样张**：冻结的成品基准，布局/密度/质量向它对齐 | 动手前 |
| `references/engine-template.html` | 最小可跑引擎模板（含示例 `buildScene`），新页面从它复制 | 写新图时 |
| `assets/icon-library.js` | **图标代码唯一来源**：`placeIcon` + `ICONS` + `META` | 选图标时 |

> ⚠️ 金样张说明：`reference-render.html` 是逐字节冻结的成品（其中图标为早期硬编码画法），
> 视觉即验收基准——**不要改它**。它覆盖的 9 个图标（coins/stopwatch/knife/computer/
> hand/tag/bubble/stick/cross）已全部入库，新活走图标库，视觉向样张对齐。

> 🎬 **与 deck skill 的分工**：多页系列 / 类 PPT 演示需求，由 `handdrawn-deck` skill 编排
> （澄清目标 → 拆页 → 故事线确认 → 逐页委托本 skill 执行 → 组装放映壳）；本 skill 只管单页。
> 引擎模板原生支持 deck 模式：URL 带 `?deck=1` 隐藏自带控制条、解除舞台宽度上限
> （壳不碰几何，页面自行撑满视口），收到 `handdrawn:show` 消息即重播逐笔绘制——
> 单页行为不受影响。

## 1. 视觉 DNA（六个旋钮 · 查表即得气质）

“手绘感”≠ 画得乱，而是下面六个**独立旋钮**的组合。锁住这六个数，整套图气质就定了。

| 旋钮 | 本 skill 默认值 | rough.js / CSS 参数 | 说明 |
|---|---|---|---|
| 纸张底 | 米白 `#f3ede1` + 噪点 + 暗角 | `body` 背景 + `feTurbulence` + `radial-gradient` 暗角 | 比纯白底“手绘感”强一档 |
| 墨色 | 赭石棕 `#3a2a1c`（**禁纯黑**） | `stroke` | 纯黑会瞬间变“工程图” |
| 线条抖动 | `roughness 1.2` | `roughness` | 越大越“手抖”；0.3 偏工整，3.0 偏潦草 |
| 线条弯曲 | `bowing 1.3` | `bowing` | 让直线“活”起来 |
| 风格种子 | `seed 7`（**固定**） | `seed` | 固定 = 系列图统一 + 重渲染不跳变 |
| 填色 | 限定 3 色淡彩，**平滑圆块** | 用原生 `<circle>` 填，**不用** rough 填 | 原图色块边缘是平滑的，故意不抖 |

**调色板常量**（按需扩，但保持“限定色板”原则，别超过 4–5 色）：
```
INK=#3a2a1c  INK_SOFT=#5a4636
PEACH=#f4c89c  PEACH_DK=#cf7e3f
MINT =#bfe2d0
BLUE =#bfe2e6  BLUE_DK=#5d9aa2
HILITE=#f6cb9f   （马克笔高亮块用）
PAPER=#f3ede1
```

**字号阶梯**（强对比，禁“全图一个字号”）：主标题 44–48 / 栏标签 40–44 / 模块标题 28–32 / 正文 22–24 / 角标 13–15。

> ⚑ 工匠笔记：填色块用**平滑** circle，墨线用**抖动** rough——“平滑色 + 抖动线”的张力，正是这类图好看的秘密。两者都抖会脏，两者都平会假。
>
> ⚑ 默认抖动自 v1.3 起为 **1.2**（原 1.6）：信息密集型手绘（小字、列表、图标）在 1.2 下线条更清晰、抖感仍在。金样张冻结于 1.6 作历史基准，不随之改动。

## 2. “活”的质量基线（每件成品必须自带，不可省）

本 skill 产出的不是静态图，而是**会呼吸的页面**。以下五项是验收硬指标：

1. **分层纸底**：底色 + 噪点纹理 + 暗角，三层叠出纸张厚度。
2. **ambient 漂浮层**：背景 4–6 个极淡（opacity≈0.06）手绘涂鸦缓慢漂移，画面“有空气”。
3. **逐笔绘制动画**：所有墨线 `stroke-dashoffset` 编排，打开即“被画出来”（= 白板视频本体）。
4. **悬停微交互**：可交互容器加 `.ix` 基类 + 修饰类（`.ix-lift` 上浮 / `.ix-wobble` 晃动 / `.ix-pop` 缩放），带 `transition` 反馈。
5. **可调 + 可重放 + 可导出**：滑块实时改 `roughness`、按钮重放绘制、按钮下载 SVG。

> 多屏 / 长图场景：用 `IntersectionObserver` 给每屏加滚动揭示（进入视口才播放该屏绘制），单屏信息图无需。

## 3. 技术栈与依赖

- **rough.js** `4.6.6`（`rough.svg(board)` 模式，产出可动画的 SVG path）。
- **CDN 双源兜底**：`unpkg` 失败自动切 `jsdelivr`，再失败显示友好错误层（见引擎模板 `boot()`）。
- **字体**（Google Fonts，`document.fonts.ready` 后再首渲，避免手写体闪烁）：
    - 中文手写贯穿：`Ma Shan Zheng`（端正+温度，免费最佳折中）。
    - 拉丁符号 `$ ? %` 等：`Caveat`（中文字体里这些符号不稳，**单拎出来**）。
    - 兜底/角标强调：`ZCOOL KuaiLe`。
- **中文硬笔升级口**：要像素级“硬笔马克笔”，把 CSS 变量 `--hand` 换成商用硬笔体（方正/汉仪手写系列），**结构零改动**。

## 4. 调用约定（给未来的我 / 给 agent 框架 · 强制流程，顺序不可乱）

当用户说“用手绘 skill / handdrawn-sketch-engine 画一张 \<主题\>”或“把这张图复刻成手绘 HTML”时：

**0. 对齐基线**：读 `references/reference-render.html`（布局密度 / 气质 / 质量基准）
与 `assets/icon-library.js`（当前可用图标，按 `META.use` 语义匹配）。

**1. 布局确认（硬步骤：未确认不得写码）**：先把需求拆成
`{标题, 节点[], 连接关系, 列表项[]}`——先想“信息结构”再想“画什么”——
然后**主动**向用户输出结构化「布局确认单」：

- **维度由 agent 按任务自定**（不是固定问卷）。推荐底线集：
  标题文案（逐字）/ 分区布局（方位 + 角色）/ 节点明细（色块颜色 + 图标 + 标签）/
  连接关系（箭头方向、曲直、指向）/ 逐字文案与色彩分配。
- 确认单只锁**信息结构、文案、色彩**；坐标与动画节奏是 agent 的事，不列入确认。
- **必附 ASCII 布局速写**：画布比例框 + 分区占位 + 元素符号（○色块 / →连线 / ⊘否定 /
  ▭高亮块，图例自注）+ 关键文案。不求像素精确，只求空间关系一眼可验：
  上下还是左右、几段、连线走向、留白在哪。文字清单说“有什么”，速写说“摆在哪”。
- 有参考图 → 表述为“我理解的结构是…，请确认”；新主题 → “我建议的结构是…”。
- 确认单格式范本（文字清单 + 配套速写，同一张确认单里）：

```
- 标题「核心方案：自动化白板手绘视频制作」
- 三栏：桃色圆 + 硬币堆（低成本）· 薄荷圆 + 秒表（高效率）· 蓝色圆 + 瑞士军刀（高灵活）
- 中部汇聚：三条连线收束 → 显示器（屏内播放键 + 进度条）+ 握笔的手 +「自制技能」吊牌
  → 马克笔高亮块托底「自动化白板手绘视频」
- 左下：思考气泡 + 愁脸火柴人 +「用户提问：有无自动化工作流？」下划线，
  两条否定列表（太贵 / 不灵活，分别用桃、蓝叉），外加一条回指弯箭头
```

```
┌──────────── viewBox 1280 × 720 ────────────┐
│        [标题 + ▭高亮块]                     │
│              ↓                              │
│   ○  ══▶  ○  ══▶  ○     ← 三色块+图标横排   │
│   标签    标签    标签                       │
│ ⊘ 痛点 ×2        ▭金句托底   ← 底部信息带   │
└─────────────────────────────────────────────┘
```

用户确认或修正后，结构**锁定**，进入执行。

**2. 执行**：复制 `references/engine-template.html` → 只重写 `buildScene`
（需要图标时把 `assets/icon-library.js` 追加进引擎 `<script>`；图标按 §5 治理流程取用）。

**3. 自检 + 交付**：按 §9 验收清单过一遍，交付单文件 HTML，
简述 fidelity 取舍、**图标来源（复用 / 草稿）**、是否建议混合路线。

**4. 沉淀**：草稿图标待用户确认效果稳定后，按 §5 移入 `assets/icon-library.js`。

## 5. 图标治理（查 → 复用 → 草稿 → 沉淀 · 四步闭环）

1. **查**：画任何图标前，先读 `assets/icon-library.js` 的 `META`，按 `use` 字段语义匹配。
2. **复用**：命中 → `placeIcon(rc,parent,ICONS.x,b,{cx,cy,s,rot,t,b:...})` 一行调用。
   API 与各字段默认值见 `assets/icon-library.js` 头部注释。
3. **草稿**：未命中 → 在 `buildScene` 里写草稿，但**从出生就按库约定写**（born-local），
   这样沉淀只是“搬函数 + 注册”，不用做坐标改造：
   - 只围绕局部 `(0,0)` 画墨线，**禁绝对坐标**；
   - 不含色块 / 外部连线 / 文字标签之外的布局元素（那些归布局层）；
   - `rc.circle/ellipse` 第 3/4 参是**直径**，半径 R 传 `2R`；
   - 经 `placeIcon` 放置（动画 / 缩放 / seed 自动统一）；
   - 交付说明里明确标注“该图标为草稿，尚未入库”。
4. **沉淀**：**仅当用户确认效果稳定后**，把草稿函数移入 `assets/icon-library.js`，
   登记 `ICONS`，补 `META`（`zh / use / box / disp / rot`），同时删掉 buildScene 里的草稿。
   **没验证过的代码永远不进库。**

## 6. 绘制 SOP（buildScene 内部细节）

布局确认后，`buildScene` 按下列步骤写：

1. **定画布**：默认 `viewBox 0 0 1280 720`（16:9）。竖图改 `720 1280` 并同步 `.board` 的 `aspect-ratio`。
2. **建时间表 `T`**：在 `buildScene` 顶部用一个对象排好每个元素的 `delay`（秒）。原则：标题 0 → 色块 0.3 起错峰 0.15 → 图标 0.6 起 → 标签比图标晚 0.3 → 连线在两端之后 → 列表/底部收尾。整体控制在 3–5 秒。
3. **写节点**：每个“可交互模块”建一个 `<g class="ix ix-lift">`；色块用 `H.smoothCircle` 并 `H.S.fill`；墨线画进一个临时 `w=H.mk('g')` 再 `H.S.paths(w, t)`；文字 `H.txt` 后 `H.S.text`；图标一律 `placeIcon`。
4. **挂顺序 = z 顺序**：`board.appendChild` 的先后即图层先后，后挂的在上。
5. **加微交互/ambient**：模块加 `.ix-*`；ambient 层已内置，必要时在 HTML 里加漂浮涂鸦。
6. **自检 + 导出**：跑一遍重放看节奏；调 `seed/roughness` 锁气质；满意后“下载 SVG”。

## 7. 动画编排规范

- **三种 `data-anim`**：`stroke`（墨线，靠 dash 画出）、`fill`（色块/平滑圆，靠 pop 弹出）、`text`（文字，靠 rise 上浮淡入）。
- **打戳而非内联动画**：内容里只调 `H.S.*` / `stampGroup` 登记 delay，**测量与播放统一交给引擎** `measureAndPlay`——这样滑块重渲染时动画逻辑不丢。
- **`getTotalLength` 必须 try/catch**：个别 path 测量会抛错，兜底 `--len:600`。
- **stroke 元素别和 fill 混在同一个被 `H.S.paths` 扫的 wrap 里却想分别控制**：`H.S.paths` 会按“有无 fill”自动判类型；要精确控制就拆 wrap。

## 8. 反模式 / 踩坑清单（血泪，照做避坑）

**流程类（本 skill 稳定性的根源）**：

- ❌ 跳过布局确认直接写码 → 整图白画。**确认单是硬步骤**（§4 步骤 1）。
- ❌ 不查图标库另起炉灶、写完也不回流 → 库永远长不大。永远 查 → 复用 → 草稿 → 沉淀。
- ❌ 草稿图标用绝对坐标 → 无法沉淀。草稿 born-local（局部坐标 + placeIcon）。
- ❌ 把未验证的草稿沉淀进库 → 库的可靠性塌方。用户确认稳定后才入库。
- ❌ 改金样张 `reference-render.html` → 基准漂移。它只读，图标迭代在库里做。

**渲染类**：

- ❌ 把 `data-anim` 或 `.ix` 加在**容器 `<g>`** 上 → 和子元素入场动画打架。**只加在叶子/独立模块 g 上**。
- ❌ 用纯黑 `#000` 墨线 → 立刻变工程图。用 `#3a2a1c`。
- ❌ 色块也用 rough 抖 → 画面脏。色块**平滑**，墨线**抖**。
- ❌ 不固定 `seed` → 每次渲染线条跳变，系列图不统一、滑块拖动时乱跳。
- ❌ 不等 `document.fonts.ready` 就首渲 → 手写体回退成宋体闪一下。
- ❌ 单 CDN → 墙/抽风就白屏。必须**双源兜底 + 错误层**。
- ❌ 导出 SVG 时留着 `.anim` → 导出的图是“动画中途态/隐藏态”。导出前**删 `.anim`**。
- ❌ 中文 `$ ? %` 指望中文字体 → 缺字/丑。拉丁符号**单拎**用 `Caveat`。
- ❌ 全图一个字号 → 平。按“字号阶梯”做对比。
- ❌ 居中三连卡 + 渐变标题 + 玻璃拟态 → 这是 AI 默认审美，**与本 skill 的纸+墨+贴纸美学冲突**，禁用。

## 9. 验收清单

**流程验收**：

- [ ] 布局确认单已在动手前获得用户确认（结构、文案、色彩）。
- [ ] 图标来源已在交付说明中标注：哪些复用自库、哪些是草稿。
- [ ] 草稿图标 born-local（局部坐标 + placeIcon 放置），改 `cx,cy,s` 能正确平移/缩放。

**视觉与工程验收**：

- [ ] 六旋钮取值合理，墨色非纯黑，色块平滑、墨线抖。
- [ ] 字号阶梯有对比；中文 100% 正确，拉丁符号用 Caveat。
- [ ] 打开即逐笔绘制；重放按钮可用；滑块实时改抖动不跳变。
- [ ] 有 ambient 漂浮层 + 至少一处悬停微交互 + 纸纹/暗角分层。
- [ ] 下载 SVG 为干净静态矢量。
- [ ] 无 AI 默认审美（无居中三连卡/渐变标题/玻璃拟态/aurora blob）。
- [ ] `seed` 固定，同一 seed 重渲染笔触不跳变；改 seed 笔触整体变化但造型稳定。
- [ ] （用库时）`cross` 能通过 `opt.b` 换色；`tag` 能传自定义 label 且默认旋转生效；
      图标内文字（`$`/`?`/label）随 `s` 正确缩放，拉丁/中文用对字体族。

## 10. 路线决策树 & 提示词附录

**决策树**：

- 字要对 / 要能改 / 要做视频 / 要批量 / 要调参 → **本引擎（HTML）**。
- 只要一张高质感静态封面、字少或愿后期修字 → **图像模型直出**（prompt 见下）。
- 想又快又像 → **混合**：AI 生成透明底手绘**图标/纸纹**当资产，布局/文字/动画/连线仍用本引擎。
  > 何时该把图标换 AI 资产：当某个图标“纯代码画太费坐标且不够像”（如逼真的小手、复杂插画）时，单拎它走 AI，其余留代码。

**整图直出（英文更稳；中文文字后期叠手写体）**
```
A hand-drawn whiteboard-style infographic on cream off-white textured paper.
Wobbly imperfect marker-pen outlines in dark sepia brown ink (NOT pure black).
Limited flat pastel palette (peach, mint, light blue) as soft circular blobs
behind icons, color slightly bleeding outside edges. Mind-map layout with
hand-drawn arrows, lots of whitespace, doodle aesthetic, flat 2D, no 3D,
no gradient, no photorealism. --ar 16:9 --style raw
```
**单图标资产（配合本引擎，避开文字雷区）**
```
Single hand-drawn doodle icon, dark sepia wobbly marker outline, transparent
background, one flat pastel fill, whiteboard sketch style, centered, no text,
no shadow. Subject: [ ... ]
```
**负面**：`photorealistic, 3d, glossy, gradient, pure black lines, perfect geometric lines, computer font, watermark`
