/* ============================================================================
   student.js — 学生端逻辑（?role=student&t=token&e=过期时间戳）
   ----------------------------------------------------------------------------
   工作方式：
     1. 进入页面先读 URL 里的 token 与过期时间戳，本地就能判断"是否已过期"
        —— 这一步不需要网络，也不需要班长端在线（需求第 7 条）。
     2. 向班长端发 probe 询问 token 是否仍被认可。1.5 秒内没有应答，
        说明两端不在同一浏览器环境（例如用手机扫码），在单机演示的限制下
        数据无法回传，此时给出明确提示，而不是假装提交成功。
     3. 提交后等待班长端比对名单，按结果展示成功 / 学号不存在 / 姓名不匹配 等状态。
   ========================================================================== */
(function () {
  'use strict';

  var $ = function (id) { return document.getElementById(id); };

  var views = {};
  var view = 'loading';
  var token = '';
  var expiresAt = 0;
  var probeTimer = null;
  var clockTimer = null;
  var submitTimer = null;
  var pendingSubmit = false;

  /* ---------------- 初始化 ---------------- */
  function init() {
    var params = new URLSearchParams(location.search);
    token = params.get('t') || '';
    expiresAt = Number(params.get('e') || 0);

    cacheViews();
    bindEvents();
    Net.onMessage(onMessage);
    startClock();
    boot();
  }

  function cacheViews() {
    var nodes = document.querySelectorAll('.sview');
    Array.prototype.forEach.call(nodes, function (node) {
      views[node.getAttribute('data-view')] = node;
    });
  }

  function bindEvents() {
    $('signForm').addEventListener('submit', onSubmit);
    $('btnRetry').addEventListener('click', function () {
      show('loading');
      probe();
    });
    $('btnBack').addEventListener('click', function () {
      show('ready');
      updateChip();
      $('sidInput').focus();
    });
    // 输入时清除错误描边
    ['sidInput', 'nameInput'].forEach(function (id) {
      $(id).addEventListener('input', function () { this.classList.remove('is-bad'); });
    });
  }

  /* ---------------- 视图切换 ---------------- */
  function show(name, opts) {
    view = name;
    Object.keys(views).forEach(function (key) {
      views[key].hidden = key !== name;
    });
    if (name === 'expired') {
      $('expiredDesc').textContent = (opts && opts.desc) ||
        '本次签到二维码的有效期为 5 分钟，已超出有效时间，无法提交。';
    }
    if (name === 'invalid') {
      $('invalidDesc').textContent = (opts && opts.desc) ||
        '该签到标识已不再有效，可能因为班长端刷新、重新打开或重新生成了二维码。';
    }
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  /* ---------------- 启动判定 ---------------- */
  function boot() {
    if (!token) {
      show('invalid', { desc: '链接中缺少签到标识，请重新扫描班长提供的二维码。' });
      return;
    }
    if (!expiresAt || isNaN(expiresAt)) {
      show('invalid', { desc: '链接中缺少有效期信息，请重新扫描班长提供的二维码。' });
      return;
    }
    if (Date.now() >= expiresAt) {
      show('expired');
      return;
    }
    show('loading');
    probe();
  }

  function probe() {
    if (view === 'ready' || view === 'success') return;
    Net.post('probe', { token: token }, window.opener || null);

    clearTimeout(probeTimer);
    probeTimer = setTimeout(function () {
      if (view === 'ready' || view === 'success') return;
      if (Date.now() >= expiresAt) { show('expired'); return; }
      show('offline');
    }, 1500);
  }

  /* ---------------- 倒计时 ---------------- */
  function startClock() {
    clockTimer = setInterval(function () {
      if (!expiresAt) return;
      var left = expiresAt - Date.now();
      updateChip();
      if (left <= 0 && (view === 'ready' || view === 'loading' || view === 'offline')) {
        show('expired');
      }
    }, 500);
  }

  function updateChip() {
    var chip = $('stuChip');
    if (!chip || !expiresAt) return;
    var left = Math.max(0, expiresAt - Date.now());
    chip.textContent = UI.mmss(left);
    chip.setAttribute('data-low', left <= 60000 ? '1' : '0');
  }

  /* ---------------- 提交 ---------------- */
  function onSubmit(ev) {
    ev.preventDefault();
    var sidEl = $('sidInput');
    var nameEl = $('nameInput');
    var sid = Store.normalizeId(sidEl.value);
    var name = Store.normalizeName(nameEl.value);

    if (!sid) {
      sidEl.classList.add('is-bad');
      sidEl.focus();
      UI.toast('请输入学号', 'warn');
      return;
    }
    if (!name) {
      nameEl.classList.add('is-bad');
      nameEl.focus();
      UI.toast('请输入姓名', 'warn');
      return;
    }
    if (Date.now() >= expiresAt) {
      show('expired');
      return;
    }

    pendingSubmit = true;
    setSubmitting(true);
    Net.post('signin', { token: token, sid: sid, name: name }, window.opener || null);

    clearTimeout(submitTimer);
    submitTimer = setTimeout(function () {
      if (!pendingSubmit) return;
      pendingSubmit = false;
      setSubmitting(false);
      showError('提交超时', '未收到班长端响应。本系统无后端，学生端必须与班长端在同一台设备的同一浏览器中打开才能提交成功。');
    }, 5000);
  }

  function setSubmitting(busy) {
    var btn = $('btnSubmit');
    btn.disabled = busy;
    btn.textContent = busy ? '提交中…' : '提交签到';
  }

  /* ---------------- 处理班长端回执 ---------------- */
  function onMessage(msg) {
    if (Store.role !== 'student') return;
    var p = msg.payload || {};
    if (p.to && p.to !== Store.clientId) return; // 不是发给自己的

    if (msg.type === 'probe-reply') {
      clearTimeout(probeTimer);
      if (Date.now() >= expiresAt) { show('expired'); return; }

      if (p.ok) {
        if (view !== 'success') { show('ready'); updateChip(); }
        return;
      }
      if (p.reason === 'expired') { show('expired'); return; }
      if (p.reason === 'ended') {
        show('invalid', { desc: '本次签到已由班长结束，当前二维码不再接受提交。' });
        return;
      }
      if (p.reason === 'no-session') {
        show('invalid', { desc: '班长端还没有生成有效的签到二维码（或已刷新重置），请重新扫码。' });
        return;
      }
      show('invalid');
      return;
    }

    if (msg.type === 'signin-reply') {
      clearTimeout(submitTimer);
      pendingSubmit = false;
      setSubmitting(false);
      handleResult(p);
    }
  }

  function handleResult(p) {
    var code = p.code;

    if (code === 'ok') {
      $('successDesc').textContent = '班长端已确认你的签到记录';
      $('successKv').hidden = false;
      $('okSid').textContent = p.record ? p.record.sid : '—';
      $('okName').textContent = p.record ? p.record.name : '—';
      $('okTime').textContent = p.record ? UI.hhmmss(p.record.at) : '—';
      show('success');
      return;
    }

    if (code === 'duplicate') {
      $('successDesc').textContent = '该学号此前已完成签到，本次未重复记录';
      $('successKv').hidden = true;
      show('success');
      return;
    }

    if (code === 'expired') { show('expired'); return; }
    if (code === 'ended') {
      show('invalid', { desc: '本次签到已由班长结束，当前二维码不再接受提交。' });
      return;
    }
    if (code === 'invalid' || code === 'no-session') { show('invalid'); return; }

    var messages = {
      'not-in-roster': ['名单中未找到该学号', '你输入的学号不在班长导入的班级名单中，请核对后重新提交，或联系班长确认。'],
      'name-mismatch': ['学号与姓名不匹配', '该学号在班级名单中存在，但姓名不一致，请核对后重新提交。'],
      'no-roster': ['班长尚未导入名单', '班长端还没有导入学生名单，暂时无法比对，请联系班长。'],
      'empty-sid': ['学号不能为空', '请填写你的学号后重新提交。'],
      'empty-name': ['姓名不能为空', '请填写你的姓名后重新提交。']
    };
    var pair = messages[code] || ['提交未成功', '未知的校验结果，请重试或联系班长。'];
    showError(pair[0], pair[1]);
  }

  function showError(title, desc) {
    $('errorTitle').textContent = title;
    $('errorDesc').textContent = desc;
    show('error');
  }

  window.Student = { init: init };
})();
