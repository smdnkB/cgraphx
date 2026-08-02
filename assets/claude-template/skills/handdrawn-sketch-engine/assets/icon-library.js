/* =====================================================================
   handdrawn-sketch-engine · 图标库（唯一来源）
   ---------------------------------------------------------------------
   接入方式：追加到引擎 <script>，放在引擎常量与 H 工具库之后
   （依赖引擎的 SVGNS / INK / F_HAND / F_SYM 常量与 H.mk / H.txt / H.arrow）。

   关注点分离（本库的灵魂）：
   - 图标函数只画“墨线”，且只画在局部坐标 (0,0) 周围——不含色块、
     不含连到外部的线、不含绝对坐标。
   - 色块 / 连线 / 文字标签 / 布局位置，是“布局层”的事，不在图标里。
   - 放置、缩放、旋转、动画打戳、笔触 seed，统一交给 placeIcon——
     图标函数对此一无所知。
   结果：换主题时放图标从“抄一坨坐标”变成“一行调用”，
   且天然可缩放、可重排、可统一动画。

   —— API：placeIcon(rc, parent, fn, b, opt) → 返回承载图标的 <g> ——
   | opt 字段 | 默认   | 作用                                        |
   |---------|--------|---------------------------------------------|
   | cx, cy  | 0, 0   | 图标中心放置到父坐标系的哪里                 |
   | s       | 1      | 缩放（局部坐标 → 父坐标）                    |
   | rot     | 0      | 绕自身中心旋转（度），吊牌常用 -10           |
   | t       | 0      | 该图标逐笔动画的起始秒                       |
   | step    | 0.035  | 图标内部各笔画的错峰秒                       |
   | cls     | ''     | 给承载 g 加的类（如 'ico' 供 CSS 悬停）       |
   | b       | null   | 覆盖基础笔触 b（给单个图标换色，如红叉）     |

   stampGroup(g, t, step)：把 g 内所有 path 登记为 stroke/fill 动画、
   所有 text 登记为 text 动画，delay 自 t 起按文档顺序递增。
   placeIcon 内部已调用，通常无需手动调。

   —— 图标索引（META 里有语义/用途/包围盒，布局留位与生成图鉴用）——
   coins 硬币/成本 · stopwatch 秒表/效率 · knife 瑞士军刀/灵活 ·
   computer 显示器/播放 · hand 握笔的手/绘制 · tag 吊牌/标签 ·
   bubble 思考气泡/疑问 · stick 火柴人/用户 · cross 圆圈叉/否定 ·
   globe 地球+定位针/地点 · db 数据库圆柱/存储 · search 放大镜/探索 ·
   doc 折角文档/规格 · checklist 清单/计划 · check 圆圈勾/验证 · shield 盾牌/门禁

   —— 治理流程（详见 SKILL.md §图标治理）——
   查（按 META.use 语义匹配）→ 命中复用 placeIcon →
   未命中在 buildScene 写草稿（born-local：围绕 (0,0)、经 placeIcon 放置）→
   用户确认稳定后，才把函数搬进本文件并注册 ICONS + META。

   —— 扩展新图标（三步）——
   function rocket(rc,g,b){            // 1. 围绕 (0,0) 画墨线，circle 用直径
     g.appendChild(rc.path("M0,-42 C14,-30 14,8 0,24 C-14,8 -14,-30 0,-42 z",b));
     g.appendChild(rc.circle(0,-12,16,16,b));
     g.appendChild(rc.linearPath([[-12,18],[-20,34],[0,26],[20,34],[12,18]],b));
   }
   ICONS.rocket=rocket;                // 2. 登记
   META.rocket={zh:'火箭 / 增长',use:'启动、增长、发布',box:42,disp:1.3}; // 3. 元数据

   —— 反模式 ——
   ❌ 图标函数里写绝对坐标 → 无法复用/缩放，位置交给 placeIcon 的 cx,cy。
   ❌ 图标里画色块或连到外部的线（如吊牌挂线）→ 归布局层。
   ❌ rc.circle(cx,cy,r,r) 把半径当直径传 → 圆缩水一半。3/4 参是直径，传 2R。
   ❌ 图标函数里硬塞 seed/颜色 → seed 在基础 b，颜色用 opt.b 覆盖。
   ❌ 中文标签用 F_SYM → 缺字。tag 的 label 用 F_HAND；$ ? 等拉丁才用 F_SYM。
   ❌ 给承载 g 同时加 .ix 悬停和让子元素做入场动画 → 打架。悬停交互放在
      卡/模块层，图标 g 只挂动画钩子或纯展示类（如 'ico'）。
   ===================================================================== */

/* —— 动画打戳：扫 path + text（比引擎 H.S.paths 更完整，覆盖含文字的图标） —— */
function stampGroup(g,t,step=0.035){
  g.querySelectorAll('path,text').forEach((el,i)=>{
    if(el.tagName==='text'){ el.setAttribute('data-anim','text'); }
    else{ const f=el.getAttribute('fill'),s=el.getAttribute('stroke');
      el.setAttribute('data-anim',(f&&f!=='none'&&(!s||s==='none'))?'fill':'stroke'); }
    el.setAttribute('data-delay',(t+i*step).toFixed(2));
  });
}
/* —— 统一放置：缩放/旋转/动画/seed 全在这里，图标函数保持纯净 —— */
function placeIcon(rc,parent,fn,b,opt={}){
  const {cx=0,cy=0,s=1,rot=0,t=0,step=0.035,cls='',b:ob=null}=opt;
  const g=H.mk('g',cls||undefined);
  const tr=`translate(${cx} ${cy})`+(rot?` rotate(${rot})`:'')+(s!==1?` scale(${s})`:'');
  if(tr.trim()) g.setAttribute('transform',tr);
  fn(rc,g,ob||b);
  stampGroup(g,t,step);
  parent.appendChild(g);
  return g;
}

/* ===================== 图标函数：全部围绕 (0,0) 的局部坐标 ===================== */
/* 注意 rough.js 的 circle/ellipse 第 3、4 参是“直径”，故半径 R 要传 2R。        */
function coins(rc,g,b){
  const ys=[-34,-12,10];
  ys.forEach(y=> g.appendChild(rc.ellipse(14,y,68,22,b)));
  g.appendChild(rc.linearPath([[14-34,ys[0]],[14-34,ys[2]]],b));
  g.appendChild(rc.linearPath([[14+34,ys[0]],[14+34,ys[2]]],b));
  g.appendChild(rc.circle(-24,28,84,84,b));
  const d=H.txt(-24,40,' $ ',30,F_SYM); d.setAttribute('class','t-sym'); g.appendChild(d);
  H.arrow(rc,g,-66,-30,-66,42,b,3.2);
  g.appendChild(rc.linearPath([[40,-44],[68,-16]],b));
  g.appendChild(rc.linearPath([[68,-44],[40,-16]],b));
}
function stopwatch(rc,g,b){
  g.appendChild(rc.circle(0,0,160,160,b));
  g.appendChild(rc.rectangle(-8,-94,16,12,b));
  g.appendChild(rc.linearPath([[0,-94],[0,-82]],b));
  g.appendChild(rc.linearPath([[24,-86],[32,-92]],b));
  [[0,-72,0,-64],[72,0,64,0],[0,72,0,64],[-72,0,-64,0]].forEach(k=>g.appendChild(rc.linearPath([[k[0],k[1]],[k[2],k[3]]],b)));
  g.appendChild(rc.linearPath([[0,0],[24,-22]],b));
  [[-82,-18,-56,-18],[-88,0,-56,0],[-82,18,-56,18]].forEach(s=>g.appendChild(rc.linearPath([[s[0],s[1]],[s[2],s[3]]],b)));
  H.arrow(rc,g,52,0,100,0,b,2.6);
}
function knife(rc,g,b){
  g.appendChild(rc.path("M-35,17 h70 a13,13 0 0 1 0,26 h-70 a13,13 0 0 1 0,-26 z",b));
  g.appendChild(rc.circle(-27,30,12,12,b)); g.appendChild(rc.circle(29,30,12,12,b));
  g.appendChild(rc.circle(-34,-26,44,44,b));
  for(let k=0;k<8;k++){const a=k*Math.PI/4;g.appendChild(rc.linearPath([[-34+Math.cos(a)*22,-26+Math.sin(a)*22],[-34+Math.cos(a)*29,-26+Math.sin(a)*29]],b));}
  g.appendChild(rc.linearPath([[2,-20],[2,-56]],b));
  g.appendChild(rc.path("M2,-56 q-7,-12 0,-22 q7,10 0,22 z",b));
  g.appendChild(rc.circle(38,-26,40,40,b));
  g.appendChild(rc.polygon([[31,-36],[31,-16],[48,-26]],b));
  H.arrow(rc,g,-44,8,-78,-18,b,2.4); H.arrow(rc,g,44,8,78,-18,b,2.4);
}
function computer(rc,g,b){
  g.appendChild(rc.rectangle(-80,-50,160,100,b));
  g.appendChild(rc.linearPath([[-16,50],[-28,64]],b));
  g.appendChild(rc.linearPath([[16,50],[28,64]],b));
  g.appendChild(rc.linearPath([[-42,64],[42,64]],b));
  g.appendChild(rc.circle(-4,-8,56,56,b));
  g.appendChild(rc.polygon([[-12,-20],[-12,4],[10,-8]],b));
  g.appendChild(rc.linearPath([[-60,32],[60,32]],b));
  g.appendChild(rc.circle(-18,32,14,14,b));
}
function hand(rc,g,b){
  g.appendChild(rc.linearPath([[38,18],[0,-6]],b));
  g.appendChild(rc.linearPath([[0,-6],[-7,-12]],b));
  g.appendChild(rc.path("M40,22 q-4,-15 -17,-13 q-9,2 -8,12 q1,9 12,9 q11,0 13,-8 z",b));
  g.appendChild(rc.path("M26,10 q6,-3 10,2",b));
}
function tag(rc,g,b,label){
  g.appendChild(rc.path("M-36,-16 h78 a6,6 0 0 1 6,6 v22 a6,6 0 0 1 -6,6 h-78 l-12,-17 z",b));
  g.appendChild(rc.circle(-30,0,10,10,b));
  const t=H.txt(12,7,label==null?'标签':label,18,F_HAND); t.setAttribute('class','t-hand'); g.appendChild(t);
}
function bubble(rc,g,b){
  g.appendChild(rc.circle(0,-8,64,64,b)); g.appendChild(rc.circle(24,-16,52,52,b));
  g.appendChild(rc.circle(-22,-4,40,40,b)); g.appendChild(rc.circle(0,22,16,16,b)); g.appendChild(rc.circle(8,36,10,10,b));
  const q=H.txt(0,2,'?',30,F_SYM); q.setAttribute('class','t-sym'); g.appendChild(q);
}
function stick(rc,g,b){
  g.appendChild(rc.circle(0,-44,36,36,b));
  g.appendChild(rc.path("M-7,-42 q7,5 14,0",b));
  g.appendChild(rc.linearPath([[0,-26],[0,16]],b));
  g.appendChild(rc.linearPath([[0,-14],[-18,4]],b)); g.appendChild(rc.linearPath([[0,-14],[18,2]],b));
  g.appendChild(rc.linearPath([[0,16],[-14,40]],b)); g.appendChild(rc.linearPath([[0,16],[14,40]],b));
}
function cross(rc,g,b){   /* 颜色由调用方通过 opt.b 注入，函数本身不特例 */
  g.appendChild(rc.circle(0,0,32,32,b));
  g.appendChild(rc.linearPath([[-5,-5],[5,5]],b));
  g.appendChild(rc.linearPath([[5,-5],[-5,5]],b));
}
/* globe：地球 + 定位针 · 地点/地理/不受城市限制/远程可达范围 */
function globe(rc,g,b){
  g.appendChild(rc.circle(0,0,140,140,b));             // 地球本体（直径 140）
  g.appendChild(rc.ellipse(0,0,48,140,b));             // 经线（竖椭圆）
  g.appendChild(rc.ellipse(0,2,140,44,b));             // 赤道（横扁椭圆）
  g.appendChild(rc.linearPath([[-70,2],[70,2]],b));    // 赤道直线
  // 定位针：水滴形，尖朝下，落在地球右上
  g.appendChild(rc.path("M46,-12 C30,-44 0,-40 6,-14 C12,6 32,16 46,2 C60,-12 62,-36 46,-12 z",b));
  g.appendChild(rc.circle(36,-16,12,12,b));            // 针孔
}
/* db：数据库圆柱 · 数据库/表结构/DDL/存储/数据资产（自 knowledge-loop 页沉淀） */
function db(rc,g,b){
  g.appendChild(rc.ellipse(0,-24,64,20,b));              // 顶盖
  g.appendChild(rc.linearPath([[-32,-24],[-32,24]],b));  // 左壁
  g.appendChild(rc.linearPath([[32,-24],[32,24]],b));    // 右壁
  g.appendChild(rc.path("M-32,24 a32,10 0 0 0 64,0",b)); // 底弧
  g.appendChild(rc.path("M-32,0 a32,10 0 0 0 64,0",b));  // 中层弧
}
/* search：放大镜 · 查询/探索/定位问题/搜索（自 knowledge-loop 页沉淀） */
function search(rc,g,b){
  g.appendChild(rc.circle(-8,-8,52,52,b));               // 镜片
  g.appendChild(rc.linearPath([[11,11],[34,34]],b));     // 手柄
  g.appendChild(rc.path("M-24,-16 q5,-9 14,-11",b));     // 高光
}
/* doc：折角文档 · 规格/契约/文档/PRD/spec（自 AI 研发工作流 deck 沉淀） */
function doc(rc,g,b){
  g.appendChild(rc.path("M-22,-30 h28 l16,16 v44 h-44 z",b));   // 纸 + 折角
  g.appendChild(rc.path("M6,-30 v16 h16",b));                   // 折角内线
  g.appendChild(rc.linearPath([[-12,-4],[12,-4]],b));           // 文本行 ×3
  g.appendChild(rc.linearPath([[-12,8],[12,8]],b));
  g.appendChild(rc.linearPath([[-12,20],[4,20]],b));
}
/* checklist：清单 · 计划/任务清单/验收项/强制引用标注（自 AI 研发工作流 deck 沉淀） */
function checklist(rc,g,b){
  g.appendChild(rc.rectangle(-24,-30,48,60,b));                 // 板
  g.appendChild(rc.linearPath([[-13,-12],[0,-12]],b));          // 行 ×3
  g.appendChild(rc.linearPath([[-13,2],[0,2]],b));
  g.appendChild(rc.linearPath([[-13,16],[0,16]],b));
  g.appendChild(rc.path("M5,-16 l4,5 8,-9",b));                 // 勾 ×2
  g.appendChild(rc.path("M5,12 l4,5 8,-9",b));
}
/* check：圆圈勾 · 验证/通过/验收/测试通过（自 AI 研发工作流 deck 沉淀） */
function check(rc,g,b){
  g.appendChild(rc.circle(0,0,56,56,b));                        // 圈（直径 56）
  g.appendChild(rc.path("M-13,2 l9,10 18,-21",b));              // 勾
}
/* shield：盾牌+勾 · 门禁/把关/提交拦截/质量闸（自 AI 研发工作流 deck 沉淀） */
function shield(rc,g,b){
  g.appendChild(rc.path("M0,-30 l24,8 v22 q0,20 -24,30 q-24,-10 -24,-30 v-22 z",b)); // 盾身
  g.appendChild(rc.path("M-9,0 l7,8 13,-16",b));                // 内勾
}
const ICONS={coins,stopwatch,knife,computer,hand,tag,bubble,stick,cross,globe,db,search,doc,checklist,check,shield};
const META={
  coins:{zh:'硬币 / 成本',use:'价格、预算、降本、付费',box:70,disp:1},
  stopwatch:{zh:'秒表 / 效率',use:'速度、时间、提效、性能',box:100,disp:1},
  knife:{zh:'瑞士军刀 / 灵活',use:'多功能、工具集、可扩展',box:80,disp:1},
  computer:{zh:'显示器 / 播放',use:'视频、演示、屏幕、产出',box:80,disp:1},
  hand:{zh:'握笔的手 / 绘制',use:'手绘、创作、编辑、书写',box:45,disp:1.4},
  tag:{zh:'吊牌 / 标签',use:'标注、技能、分类、徽章',box:50,disp:1.2,rot:-10},
  bubble:{zh:'思考气泡 / 疑问',use:'提问、困惑、想法、FAQ',box:40,disp:1.3},
  stick:{zh:'火柴人 / 用户',use:'用户、人物、角色、情绪',box:45,disp:1.2},
  cross:{zh:'圆圈叉 / 否定',use:'痛点、否定、错误、排除',box:16,disp:2.4},
  globe:{zh:'地球+定位针 / 地点',use:'地点、地理、远程、自由、不受城市限制、可达范围',box:80,disp:1},
  db:{zh:'数据库圆柱 / 存储',use:'数据库、表结构、DDL、存储、数据资产、知识库本体',box:34,disp:1.2},
  search:{zh:'放大镜 / 探索',use:'查询、探索、定位问题、搜索、读知识库、排查',box:34,disp:1.3},
  doc:{zh:'折角文档 / 规格',use:'规格、契约、文档、PRD、spec、书面产物',box:32,disp:1.2},
  checklist:{zh:'清单 / 计划',use:'计划、任务清单、验收项、待办、强制引用标注',box:30,disp:1.2},
  check:{zh:'圆圈勾 / 验证',use:'验证、通过、验收、完成、测试通过',box:28,disp:1.2},
  shield:{zh:'盾牌 / 门禁',use:'门禁、把关、提交拦截、质量闸、安全',box:30,disp:1.2}
};

/* —— 调用示例（对比“上一版硬编码”，放置只需一行） ——
   // 色块：布局层负责，平滑填充
   const c1=H.smoothCircle(300,235,92,PEACH); col1.appendChild(c1); H.S.fill(c1,0.25);
   // 图标：一行放置，自动 translate 到 (300,235)、自动逐笔动画
   placeIcon(rc,col1,ICONS.coins,b,{cx:300,cy:235,t:0.8});
   // 红叉列表项：颜色靠 opt.b 注入，缩放靠 s
   placeIcon(rc,leftG,ICONS.cross,b,{cx:186,cy:602,s:0.5,t:4.0,
           b:Object.assign({},b,{stroke:PEACH_DK,strokeWidth:2.2})});
   // 地球+定位针：放在蓝色色块圆里，表达“不受城市限制”
   placeIcon(rc,col3,ICONS.globe,b,{cx:980,cy:205,s:0.95,t:1.1});
   // 吊牌：默认旋转已写进 META，也可显式 rot
   placeIcon(rc,mid,ICONS.tag,b,{cx:762,cy:616,rot:-10,t:3.2});
*/
