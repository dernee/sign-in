/* ============================================================================
   main.js — 角色路由
   ----------------------------------------------------------------------------
   页面只有一份 index.html，通过 URL 参数区分两种模式（需求第 1 条）：
     index.html                               → 班长管理模式
     index.html?role=monitor                  → 班长管理模式（显式）
     index.html?role=student&t=…&e=…          → 学生签到模式（由二维码带入）

   注意：同一份页面代码在两个模式下共用 Store 的"内存结构"，
   但两个标签页各自持有独立的 JS 内存，因此学生端的数据只能通过
   BroadcastChannel / postMessage 回传给班长端，这也正是单机演示的边界。
   ========================================================================== */
(function () {
  'use strict';

  var role = 'monitor';
  try {
    if (new URLSearchParams(location.search).get('role') === 'student') role = 'student';
  } catch (err) {
    role = 'monitor';
  }

  Store.role = role;

  var monitorView = document.getElementById('view-monitor');
  var studentView = document.getElementById('view-student');

  monitorView.hidden = role !== 'monitor';
  studentView.hidden = role !== 'student';
  document.body.setAttribute('data-role', role);

  if (role === 'monitor') {
    document.title = '班级二维码签到 · 班长端（单机演示）';
    Monitor.init();
  } else {
    document.title = '班级签到';
    Student.init();
  }
})();
