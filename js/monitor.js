/* ============================================================================
   monitor.js — 班长端逻辑
   ----------------------------------------------------------------------------
   职责：
     1. 导入 Excel/CSV 名单（SheetJS 解析），展示全部学生
     2. 生成 / 重新生成 / 结束签到二维码（携带唯一 token，固定 5 分钟有效期）
     3. 5 分钟倒计时环，到期后二维码遮罩失效
     4. 应答学生端的 probe / signin 消息，实时刷新已签到与未签到清单
     5. 打开学生端预览窗口（同浏览器），这是本演示唯一能真正跑通数据链路的入口

   需要特别说明的实现事实：
     · 二维码里写的是"当前页面地址 + ?role=student&t=token&e=过期时间戳"。
       以 file:// 打开时，二维码内容是本机文件路径，手机无法识别，仅供同机演示。
     · 页面没有任何持久化写入，所以刷新/重开后 Store 里的数据自然归零。
   ========================================================================== */
(function () {
  'use strict';

  var $ = function (id) { return document.getElementById(id); };
  var els = {};
  var qrDrawnToken = null;      // 已绘制的 token，避免重复重绘二维码
  var expiredNotified = false;  // 过期提示只弹一次
  var tickTimer = null;
  var lastTopSid = null;        // 用于给最新一条签到加进入动画

  var RING_LEN = 2 * Math.PI * 27; // 倒计时环周长，与 CSS 的 r=27 对应

  /* ---------------- 初始化 ---------------- */
  function init() {
    cacheEls();
    bindEvents();
    bindingStore();
    Net.onMessage(onMessage);
    checkVendor();
    renderAll();
    tickTimer = setInterval(onTick, 500);
  }

  function cacheEls() {
    [
      'qrStatus', 'qrEmpty', 'qrCanvas', 'qrVeil', 'qrVeilText', 'timerBox', 'timerBar',
      'timerText', 'tokenLine', 'tokenText', 'btnGenerate', 'btnPreview', 'btnCopyLink',
      'btnEnd', 'qrTip', 'dropzone', 'fileInput', 'rosterMeta', 'rosterCount', 'rosterFile',
      'btnClearRoster', 'allCard', 'allHint', 'allBody', 'sessionStatus', 'statTotal',
      'statSigned', 'statUnsigned', 'statRate', 'progressBar', 'signedCount', 'unsignedCount',
      'signedList', 'unsignedList', 'signedEmpty', 'unsignedEmpty', 'libStatus', 'libStatusText'
    ].forEach(function (id) { els[id] = $(id); });
  }

  function bindingStore() {
    Store.on('roster', renderAll);
    Store.on('records', renderAll);
    Store.on('session', renderAll);
  }

  /* ---------------- 依赖状态 ---------------- */
  function checkVendor() {
    if (!window.Vendor) return;
    window.Vendor.ready.then(function (res) {
      var text, stateName;
      if (res.qrcode && res.xlsx) { text = '组件就绪'; stateName = 'ok'; }
      else if (res.qrcode) { text = '表格库加载失败'; stateName = 'fail'; }
      else if (res.xlsx) { text = '二维码库加载失败'; stateName = 'fail'; }
      else { text = '依赖加载失败'; stateName = 'fail'; }
      els.libStatus.setAttribute('data-state', stateName);
      els.libStatusText.textContent = text;
      if (stateName === 'fail') {
        UI.toast('部分 CDN 组件加载失败，请检查网络后刷新页面', 'error', 5000);
      }
    });
  }

  /* ---------------- 事件绑定 ---------------- */
  function bindEvents() {
    els.btnGenerate.addEventListener('click', onGenerate);
    els.btnPreview.addEventListener('click', onPreview);
    els.btnCopyLink.addEventListener('click', onCopyLink);
    els.btnEnd.addEventListener('click', onEnd);
    els.btnClearRoster.addEventListener('click', onClearRoster);

    els.fileInput.addEventListener('change', function () {
      importFile(this.files && this.files[0]);
      this.value = ''; // 允许重复选择同一个文件
    });

    // 拖拽导入
    ['dragenter', 'dragover'].forEach(function (type) {
      els.dropzone.addEventListener(type, function (ev) {
        ev.preventDefault();
        els.dropzone.classList.add('is-over');
      });
    });
    ['dragleave', 'dragend'].forEach(function (type) {
      els.dropzone.addEventListener(type, function () {
        els.dropzone.classList.remove('is-over');
      });
    });
    els.dropzone.addEventListener('drop', function (ev) {
      ev.preventDefault();
      els.dropzone.classList.remove('is-over');
      var files = ev.dataTransfer && ev.dataTransfer.files;
      if (files && files[0]) importFile(files[0]);
    });
  }

  /* ---------------- 生成 / 结束二维码 ---------------- */
  function onGenerate() {
    if (!Store.roster.length) {
      UI.toast('请先导入学生名单（需含「学号」「姓名」两列）', 'warn', 4000);
      return;
    }
    if (!window.QRCode) {
      UI.toast('二维码组件尚未加载完成，请稍候重试', 'warn');
      return;
    }
    if (Store.session) {
      UI.confirm({
        title: '重新生成二维码',
        text: '将开启新一轮签到：原二维码立即失效，已签到记录清空，名单保留。是否继续？',
        okText: '重新生成'
      }).then(function (ok) { if (ok) doGenerate(); });
      return;
    }
    doGenerate();
  }

  function doGenerate() {
    var s = Store.startSession();
    qrDrawnToken = null;
    expiredNotified = false;
    lastTopSid = null;
    renderAll();
    UI.toast('签到已开始，有效期 5 分钟 · ' + s.token, 'success', 3600);
  }

  function onEnd() {
    UI.confirm({
      title: '结束本次签到',
      text: '结束后当前二维码立即失效，学生端将无法再提交。已签到记录会保留在页面上。',
      okText: '结束签到'
    }).then(function (ok) {
      if (!ok) return;
      Store.endSession();
      renderAll();
      UI.toast('本次签到已结束，二维码已失效', 'info');
    });
  }

  function onPreview() {
    var s = Store.session;
    if (!s || Store.sessionState() !== 'live') {
      UI.toast('当前没有有效二维码，请先生成', 'warn');
      return;
    }
    var url = Store.studentUrl(s.token, s.expiresAt);
    var win = window.open(url, 'checkin-student-preview',
      'width=470,height=880,menubar=no,toolbar=no,location=no,status=no');
    if (!win) {
      UI.toast('浏览器拦截了新窗口，请允许弹出窗口后重试', 'error', 4200);
      return;
    }
    UI.toast('学生端已在新窗口打开：填写学号与姓名即可体验完整流程', 'info', 4200);
  }

  function onCopyLink() {
    var s = Store.session;
    if (!s) return;
    var url = Store.studentUrl(s.token, s.expiresAt);
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(url).then(function () {
        UI.toast('学生端链接已复制', 'success');
      }).catch(function () {
        UI.toast('复制失败，请手动复制地址栏链接', 'warn');
      });
    } else {
      UI.toast('当前浏览器不支持自动复制，请手动复制：' + url, 'info', 6000);
    }
  }

  function onClearRoster() {
    if (Store.sessionState() === 'live') {
      UI.toast('签到进行中，请先结束本次签到', 'warn');
      return;
    }
    UI.confirm({
      title: '清空名单',
      text: '将移除已导入的全部学生，签到记录同时清空。是否继续？',
      okText: '清空'
    }).then(function (ok) {
      if (!ok) return;
      Store.clearRoster();
      Store.records.length = 0;
      els.rosterFile.textContent = '—';
      renderAll();
      UI.toast('名单已清空', 'info');
    });
  }

  /* ---------------- Excel 导入 ---------------- */
  function importFile(file) {
    if (!file) return;
    if (!window.XLSX) {
      UI.toast('Excel 解析组件未加载，请检查网络后刷新页面', 'error', 4200);
      return;
    }
    if (Store.sessionState() === 'live') {
      UI.toast('签到进行中，请先结束本次签到再更换名单', 'warn', 4000);
      return;
    }

    var reader = new FileReader();
    reader.onload = function (ev) {
      var parsed;
      try {
        var wb = XLSX.read(new Uint8Array(ev.target.result), { type: 'array' });
        parsed = parseWorkbook(wb);
      } catch (err) {
        UI.toast('文件解析失败：' + (err && err.message ? err.message : '未知错误'), 'error', 4200);
        return;
      }
      if (!parsed.students.length) {
        UI.toast('未读取到有效数据，请确认表格中包含「学号」「姓名」两列', 'warn', 4600);
        return;
      }
      Store.setRoster(parsed.students);
      els.rosterFile.textContent = file.name;
      var extra = [];
      if (parsed.dup) extra.push('忽略重复学号 ' + parsed.dup + ' 条');
      if (parsed.skipped) extra.push('跳过缺项 ' + parsed.skipped + ' 行');
      UI.toast('已导入 ' + parsed.students.length + ' 名学生' +
        (extra.length ? '（' + extra.join('，') + '）' : ''), 'success', 4000);
    };
    reader.onerror = function () { UI.toast('文件读取失败', 'error'); };
    reader.readAsArrayBuffer(file);
  }

  /*
    解析首个工作表：
      · 在前 6 行内寻找同时含「学号类型」与「姓名类型」表头的行，命中则该行为表头
      · 找不到表头时，退化为"前两列依次为学号、姓名"
      · raw:false 让 SheetJS 返回格式化后的文本，避免学号被当成数字丢精度
  */
  function parseWorkbook(wb) {
    var ws = wb.Sheets[wb.SheetNames[0]];
    if (!ws) throw new Error('表格中没有工作表');

    var rows = XLSX.utils.sheet_to_json(ws, {
      header: 1, defval: '', raw: false, blankrows: false
    });

    var idIdx = 0, nameIdx = 1, startRow = 0;
    for (var i = 0; i < Math.min(rows.length, 6); i++) {
      var cells = (rows[i] || []).map(function (c) {
        return String(c == null ? '' : c).trim();
      });
      var hitId = -1, hitName = -1;
      for (var j = 0; j < cells.length; j++) {
        if (hitId < 0 && /学号|学籍号|工号|编号|^id$|student\s*id/i.test(cells[j])) hitId = j;
        if (hitName < 0 && /姓名|名字|^name$|student\s*name/i.test(cells[j])) hitName = j;
      }
      if (hitId > -1 && hitName > -1) {
        idIdx = hitId; nameIdx = hitName; startRow = i + 1;
        break;
      }
    }

    var students = [];
    var seen = Object.create(null);
    var dup = 0, skipped = 0;

    for (var k = startRow; k < rows.length; k++) {
      var row = rows[k] || [];
      var sid = Store.normalizeId(row[idIdx]);
      var name = Store.normalizeName(row[nameIdx]);
      if (!sid && !name) continue;
      if (!sid || !name) { skipped++; continue; }
      if (seen[sid]) { dup++; continue; }
      seen[sid] = 1;
      students.push({ sid: sid, name: name });
    }

    return { students: students, dup: dup, skipped: skipped };
  }

  /* ---------------- 定时器 ---------------- */
  function onTick() {
    var st = Store.sessionState();
    if (st === 'live') {
      renderTimer();
      return;
    }
    if (st === 'expired' && !expiredNotified) {
      expiredNotified = true;
      renderAll(); // 让二维码遮上"已过期"、按钮状态同步
      UI.toast('二维码已过期（有效期 5 分钟），本次签到无法再提交', 'warn', 4600);
    }
  }

  /* ---------------- 渲染 ---------------- */
  function renderAll() {
    renderQr();
    renderStatus();
    renderRosterMeta();
    renderAllTable();
    renderStats();
    renderLists();
    renderButtons();
  }

  function renderQr() {
    var s = Store.session;
    var st = Store.sessionState();

    if (!s) {
      els.qrEmpty.hidden = false;
      els.qrCanvas.hidden = true;
      els.qrVeil.hidden = true;
      els.tokenLine.hidden = true;
      els.timerBox.hidden = true;
      return;
    }

    els.qrEmpty.hidden = true;
    if (qrDrawnToken !== s.token) {
      drawQr(Store.studentUrl(s.token, s.expiresAt));
      qrDrawnToken = s.token;
    }
    els.qrCanvas.hidden = false;

    var alive = st === 'live';
    els.qrVeil.hidden = alive;
    els.qrVeilText.textContent = st === 'ended' ? '已结束' : '已过期';

    els.tokenLine.hidden = false;
    els.tokenText.textContent = s.token;
    els.timerBox.hidden = false;
    renderTimer();

    if (location.protocol === 'file:') {
      els.qrTip.textContent = '当前以 file:// 打开：二维码内容为本机文件路径，手机无法识别，请用「打开学生端预览」演示。';
    } else {
      els.qrTip.textContent = '二维码有效期固定 5 分钟；页面一旦刷新，当前二维码立即失效。';
    }
  }

  function drawQr(url) {
    var box = els.qrCanvas;
    box.textContent = '';
    if (!window.QRCode) {
      var fallback = document.createElement('div');
      fallback.className = 'qr-fallback';
      fallback.textContent = '二维码组件未加载，请检查网络后刷新';
      box.appendChild(fallback);
      return;
    }
    try {
      new QRCode(box, { // eslint-disable-line no-new
        text: url,
        width: 416,   // 实际绘制尺寸放大，配合 CSS 缩放，保证高分屏清晰
        height: 416,
        colorDark: '#06131f',
        colorLight: '#ffffff',
        correctLevel: QRCode.CorrectLevel ? QRCode.CorrectLevel.M : 1
      });
    } catch (err) {
      var tip = document.createElement('div');
      tip.className = 'qr-fallback';
      tip.textContent = '二维码生成失败：' + (err && err.message ? err.message : '未知错误');
      box.appendChild(tip);
    }
  }

  function renderTimer() {
    var s = Store.session;
    if (!s) return;
    var left = Math.max(0, s.expiresAt - Date.now());
    els.timerText.textContent = UI.mmss(left);
    var ratio = Math.min(1, Math.max(0, left / Store.TTL));
    els.timerBar.style.strokeDashoffset = (RING_LEN * (1 - ratio)).toFixed(2);
    els.timerBar.setAttribute('data-low', left <= 60000 ? '1' : '0');
  }

  function renderStatus() {
    var st = Store.sessionState();
    var map = {
      idle: ['未生成', '未开始'],
      live: ['进行中', '进行中'],
      expired: ['已过期', '已过期'],
      ended: ['已结束', '已结束']
    };
    var pair = map[st] || map.idle;
    els.qrStatus.textContent = pair[0];
    els.qrStatus.setAttribute('data-state', st);
    els.sessionStatus.textContent = pair[1];
    els.sessionStatus.setAttribute('data-state', st);
  }

  function renderButtons() {
    var s = Store.session;
    var st = Store.sessionState();
    var live = st === 'live';

    els.btnGenerate.textContent = s ? '重新生成二维码' : '生成签到二维码';
    els.btnPreview.disabled = !live;
    els.btnCopyLink.hidden = !s;
    els.btnEnd.hidden = !live;
  }

  function renderRosterMeta() {
    var n = Store.roster.length;
    if (!n) {
      els.rosterMeta.hidden = true;
      els.allCard.hidden = true;
      return;
    }
    els.rosterMeta.hidden = false;
    els.rosterCount.textContent = n;
    els.allCard.hidden = false;
    els.allHint.textContent = '共 ' + n + ' 人';
  }

  function signedMap() {
    var map = Object.create(null);
    Store.records.forEach(function (r) { map[Store.normalizeId(r.sid)] = r; });
    return map;
  }

  function renderAllTable() {
    var body = els.allBody;
    body.textContent = '';
    if (!Store.roster.length) return;

    var map = signedMap();
    var frag = document.createDocumentFragment();
    Store.roster.forEach(function (s) {
      var rec = map[Store.normalizeId(s.sid)];
      var tr = document.createElement('tr');

      var tdId = UI.el('td', 'id-cell', s.sid);
      var tdName = UI.el('td', null, s.name);
      var tdSt = UI.el('td', 'w-st');
      var badge = UI.el('span', 'mini-status' + (rec ? ' mini-status--ok' : ''), rec ? '已签到' : '未签到');
      tdSt.appendChild(badge);

      tr.appendChild(tdId);
      tr.appendChild(tdName);
      tr.appendChild(tdSt);
      frag.appendChild(tr);
    });
    body.appendChild(frag);
  }

  function renderStats() {
    var s = Store.stats();
    els.statTotal.textContent = s.total;
    els.statSigned.textContent = s.signed;
    els.statUnsigned.textContent = s.unsigned;
    els.statRate.textContent = s.rate + '%';
    els.progressBar.style.width = s.rate + '%';
  }

  function renderLists() {
    var records = Store.records.slice().reverse(); // 最新签到在前
    var map = signedMap();
    var unsigned = Store.roster.filter(function (s) {
      return !map[Store.normalizeId(s.sid)];
    });

    // 已签到
    els.signedList.textContent = '';
    var frag1 = document.createDocumentFragment();
    var topSid = records.length ? Store.normalizeId(records[0].sid) : null;
    records.forEach(function (r, idx) {
      var isNew = idx === 0 && topSid !== lastTopSid;
      frag1.appendChild(personNode(r.sid, r.name, r.at, true, isNew));
    });
    els.signedList.appendChild(frag1);
    lastTopSid = topSid;

    // 未签到
    els.unsignedList.textContent = '';
    var frag2 = document.createDocumentFragment();
    unsigned.forEach(function (s) {
      frag2.appendChild(personNode(s.sid, s.name, null, false, false));
    });
    els.unsignedList.appendChild(frag2);

    els.signedCount.textContent = records.length;
    els.unsignedCount.textContent = unsigned.length;
    els.signedEmpty.hidden = records.length > 0;
    els.signedList.hidden = records.length === 0;
    els.unsignedEmpty.hidden = unsigned.length > 0 || Store.roster.length === 0;
    els.unsignedList.hidden = unsigned.length === 0;
    if (!Store.roster.length) {
      els.unsignedEmpty.hidden = false;
      els.unsignedEmpty.textContent = '尚未导入名单';
    } else {
      els.unsignedEmpty.textContent = '全部学生均已签到';
    }
  }

  function personNode(sid, name, at, signed, isNew) {
    var li = UI.el('li', 'person' + (signed ? ' person--signed' : '') + (isNew ? ' person--new' : ''));
    li.appendChild(UI.el('span', 'person__dot'));
    li.appendChild(UI.el('span', 'person__id', sid));
    li.appendChild(UI.el('span', 'person__name', name));
    li.appendChild(UI.el('span', 'person__time', at ? UI.hhmm(at) : ''));
    return li;
  }

  /* ---------------- 接收学生端消息 ---------------- */
  function onMessage(msg, source) {
    if (Store.role !== 'monitor') return;
    var p = msg.payload || {};

    if (msg.type === 'probe') {
      var check = Store.evalToken(p.token);
      var stats = Store.stats();
      Net.post('probe-reply', {
        to: msg.from,
        ok: check.ok,
        reason: check.reason || '',
        total: stats.total,
        signed: stats.signed
      }, source, msg.uid + ':r');
      return;
    }

    if (msg.type === 'signin') {
      var result = Store.submitSignin(p.token, p.sid, p.name);
      var s2 = Store.stats();
      Net.post('signin-reply', {
        to: msg.from,
        code: result.code,
        record: result.record || null,
        total: s2.total,
        signed: s2.signed
      }, source, msg.uid + ':r');

      if (result.code === 'ok') {
        UI.toast('新签到：' + result.record.name + ' · ' + result.record.sid, 'success');
      }
      return;
    }
  }

  window.Monitor = { init: init };
})();
