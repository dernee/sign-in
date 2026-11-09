/* ============================================================================
   ui.js — 提示弹窗（toast）、确认框、说明弹窗与 DOM 小工具
   ----------------------------------------------------------------------------
   纯展示层，不保存任何业务数据。
   所有动态插入的用户数据（姓名、学号等）一律使用 textContent 写入，
   不使用 innerHTML 拼接，避免 Excel 内容里的尖括号被当作 HTML 解析。
   ========================================================================== */
(function () {
  'use strict';

  /* ---------------- DOM 小工具 ---------------- */
  function el(tag, cls, text) {
    var node = document.createElement(tag);
    if (cls) node.className = cls;
    if (text != null) node.textContent = String(text);
    return node;
  }

  function $(id) { return document.getElementById(id); }

  function pad2(n) { return n < 10 ? '0' + n : '' + n; }

  function mmss(ms) {
    var total = Math.max(0, Math.ceil(ms / 1000));
    return pad2(Math.floor(total / 60)) + ':' + pad2(total % 60);
  }

  function hhmm(ts) {
    var d = new Date(ts);
    return pad2(d.getHours()) + ':' + pad2(d.getMinutes());
  }

  function hhmmss(ts) {
    var d = new Date(ts);
    return pad2(d.getHours()) + ':' + pad2(d.getMinutes()) + ':' + pad2(d.getSeconds());
  }

  /* ---------------- Toast 提示弹窗 ---------------- */
  var stack = $('toastStack');

  function toast(message, type, duration) {
    if (!stack) return;
    var node = el('div', 'toast toast--' + (type || 'info'));
    node.appendChild(el('span', 'toast__text', message));
    stack.appendChild(node);

    var timer = setTimeout(close, duration || 3200);
    function close() {
      clearTimeout(timer);
      if (!node.parentNode) return;
      node.classList.add('is-out');
      setTimeout(function () {
        if (node.parentNode) node.parentNode.removeChild(node);
      }, 280);
    }
    node.addEventListener('click', close);
    // 同时最多保留 4 条，避免刷屏
    while (stack.children.length > 4) stack.removeChild(stack.firstChild);
  }

  /* ---------------- 确认框 ---------------- */
  var confirmModal = $('modalConfirm');
  var confirmTitle = $('confirmTitle');
  var confirmText = $('confirmText');
  var confirmOk = $('confirmOk');
  var confirmCancel = $('confirmCancel');
  var pending = null;

  function settle(ok) {
    if (!pending) return;
    var resolve = pending;
    pending = null;
    confirmModal.hidden = true;
    resolve(ok);
  }

  function confirm(opts) {
    if (!confirmModal) return Promise.resolve(window.confirm(opts.text || '确定执行该操作？'));
    opts = opts || {};
    confirmTitle.textContent = opts.title || '确认操作';
    confirmText.textContent = opts.text || '';
    confirmOk.textContent = opts.okText || '确定';
    confirmModal.hidden = false;
    return new Promise(function (resolve) { pending = resolve; });
  }

  if (confirmModal) {
    confirmOk.addEventListener('click', function () { settle(true); });
    confirmCancel.addEventListener('click', function () { settle(false); });
    confirmModal.addEventListener('click', function (ev) {
      if (ev.target && ev.target.getAttribute('data-close')) settle(false);
    });
  }

  /* ---------------- 说明弹窗 ---------------- */
  var helpModal = $('modalHelp');
  var btnHelp = $('btnHelp');
  var helpClose = $('helpClose');

  function openHelp() { if (helpModal) helpModal.hidden = false; }
  function closeHelp() { if (helpModal) helpModal.hidden = true; }

  if (btnHelp) btnHelp.addEventListener('click', openHelp);
  if (helpClose) helpClose.addEventListener('click', closeHelp);
  if (helpModal) {
    helpModal.addEventListener('click', function (ev) {
      if (ev.target && ev.target.getAttribute('data-close')) closeHelp();
    });
  }

  document.addEventListener('keydown', function (ev) {
    if (ev.key !== 'Escape') return;
    if (helpModal && !helpModal.hidden) { closeHelp(); return; }
    if (confirmModal && !confirmModal.hidden) settle(false);
  });

  window.UI = {
    el: el,
    $: $,
    mmss: mmss,
    hhmm: hhmm,
    hhmmss: hhmmss,
    toast: toast,
    confirm: confirm,
    openHelp: openHelp,
    closeHelp: closeHelp
  };
})();
