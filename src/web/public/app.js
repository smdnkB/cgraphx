/*
 * cgraphx web — 渐进增强脚本(刻意极简,无框架)。
 *
 * 仅两件事:
 *   1. 按 `/` 聚焦搜索框(已处于输入框内时不触发,spec §3.3);
 *   2. [data-local-time] 元素按浏览器时区重格式化(服务端已输出进程本地
 *      时间作为合规底线,此处仅为跨时区访问时的增强,失败静默降级)。
 */
(function () {
  'use strict';

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
})();
