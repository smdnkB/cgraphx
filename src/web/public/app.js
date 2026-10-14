/*
 * cgraphx web — 渐进增强脚本(刻意极简,无框架)。
 *
 * 仅三件事:
 *   1. 按 `/` 聚焦搜索框(已处于输入框内时不触发,spec §3.3);
 *   2. [data-local-time] 元素按浏览器时区重格式化(服务端已输出进程本地
 *      时间作为合规底线,此处仅为跨时区访问时的增强,失败静默降级);
 *   3. 系统地图视图页([data-codemap])按需从 CDN 加载 mermaid 绘图;加载不到
 *      保留原文并提示「未联网」,单图写法错保留原文并提示(2026-10-14-cgraphx-web系统地图)。
 */
(function () {
  'use strict';

  // 画图组件地址:版本固定,不随远端更新变化(spec §5)。
  var MERMAID_SRC = 'https://cdn.jsdelivr.net/npm/mermaid@11.4.1/dist/mermaid.min.js';

  // 1) `/` 快捷键聚焦搜索框。
  document.addEventListener('keydown', function (e) {
    if (e.key !== '/' || e.ctrlKey || e.metaKey || e.altKey) return;
    var t = e.target;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
    var box = document.getElementById('search-input');
    if (box) {
      e.preventDefault();
      box.focus();
    }
  });

  // 2) 时间本地化:重格式化带 datetime 的 [data-local-time] 元素。
  function pad(n) {
    return String(n).padStart(2, '0');
  }
  try {
    var els = document.querySelectorAll('[data-local-time][datetime]');
    for (var i = 0; i < els.length; i++) {
      var el = els[i];
      var d = new Date(el.getAttribute('datetime'));
      if (isNaN(d.getTime())) continue;
      el.textContent =
        d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) +
        ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes());
    }
  } catch (err) {
    // 降级:保留服务端输出的本地时间,不阻塞页面。
  }

  // 3) 系统地图:只在 [data-codemap] 页面绘制 mermaid,其余页面不加载脚本。
  function noteBefore(pre, text) {
    var p = document.createElement('p');
    p.className = 'codemap__diagram-note';
    p.textContent = text;
    pre.parentNode.insertBefore(p, pre);
  }
  try {
    var codes = document.querySelectorAll('[data-codemap] code.language-mermaid');
    if (codes.length > 0) {
      var script = document.createElement('script');
      script.src = MERMAID_SRC;
      script.async = true;
      script.onerror = function () {
        for (var j = 0; j < codes.length; j++) {
          noteBefore(codes[j].parentNode, '未联网,图无法绘制,显示原文');
        }
      };
      script.onload = function () {
        var mm = window.mermaid;
        try {
          mm.initialize({ startOnLoad: false, securityLevel: 'strict', suppressErrorRendering: true });
        } catch (e) {
          return;
        }
        Array.prototype.forEach.call(codes, function (code, k) {
          var pre = code.parentNode;
          var fail = function () { noteBefore(pre, '图的写法有误,无法绘制,显示原文'); };
          try {
            mm.render('codemap-diagram-' + k, code.textContent).then(function (out) {
              var box = document.createElement('div');
              box.className = 'codemap__diagram';
              box.innerHTML = out.svg;
              pre.parentNode.insertBefore(box, pre);
              pre.style.display = 'none';
            }, fail);
          } catch (e) {
            fail();
          }
        });
      };
      document.head.appendChild(script);
    }
  } catch (err) {
    // 降级:保留原文,不阻塞页面。
  }
})();
