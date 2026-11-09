/* ============================================================================
   admin.js — 教师后台页逻辑（admin.html 专用）
   ----------------------------------------------------------------------------
   功能：
     1. 从 Supabase 拉取全部签到记录，按签到时间倒序（最新在最上）
     2. 顶部展示总签到人数（一名学生一条记录，记录数即人数）
     3. 每 10 秒自动刷新（可关）；也可手动刷新
     4. 一键导出 CSV：带 UTF-8 BOM + CRLF 换行，Excel 双击打开中文不乱码
   ========================================================================== */
(function () {
  'use strict';

  var $ = function (id) { return document.getElementById(id); };

  var els = {
    configErr: $('configError') || null, // admin 页无该节点，取不到时为 null
    statusBar: $('statusBar'),
    totalCount: $('totalCount'),
    autoRefresh: $('autoRefresh'),
    btnRefresh: $('btnRefresh'),
    btnExport: $('btnExport'),
    tbody: $('tbody'),
    emptyTip: $('emptyTip'),
    lastUpdated: $('lastUpdated')
  };

  var records = [];   // 当前内存中的签到记录（已倒序）
  var timer = null;   // 自动刷新定时器

  /* ---------------- 工具函数 ---------------- */

  function pad(n) { return String(n).padStart(2, '0'); }

  // Supabase 返回 UTC 时间（ISO 字符串），转浏览器本地时区 YYYY-MM-DD HH:mm:ss
  function fmtTime(iso) {
    var d = new Date(iso);
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) +
      ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes()) + ':' + pad(d.getSeconds());
  }

  // HTML 转义：姓名是用户自由输入，插入 innerHTML 前必须转义，防 XSS
  function escHtml(v) {
    return String(v == null ? '' : v)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function setStatus(msg, kind) {
    if (!msg) { els.statusBar.hidden = true; els.statusBar.textContent = ''; return; }
    els.statusBar.hidden = false;
    els.statusBar.className = 'banner ' + (kind === 'error' ? 'banner-error' : 'banner-warn');
    els.statusBar.textContent = msg;
  }

  // 把 Supabase/网络错误翻译成「标题 + 建议动作」，返回 [标题, 描述]
  function describeError(err) {
    var msg = (err && err.message) ? err.message : String(err);
    if (err && err.code === '42501') {
      return ['权限被拒绝（RLS）', '数据表已开启行级安全但缺少读取策略或授权。请在 Supabase SQL Editor 重新执行 supabase-setup.sql。'];
    }
    if (err && err.code === '42P01') {
      return ['数据表不存在', '请先在 Supabase SQL Editor 执行项目里的 supabase-setup.sql 完成建表。'];
    }
    if (/fetch/i.test(msg)) {
      return ['网络连接失败', '无法连接 Supabase。请检查本机网络，或确认 js/config.js 中的项目地址与密钥填写正确。'];
    }
    if (/invalid api key|JWT|apikey/i.test(msg)) {
      return ['API 密钥无效', '请检查 js/config.js 中的密钥是否复制完整（anon 或 publishable 密钥）。'];
    }
    return ['加载失败', msg];
  }

  /* ---------------- 数据加载与渲染 ---------------- */

  async function loadRecords(silent) {
    if (!window.db) return;
    if (!silent) setStatus('加载中…');
    try {
      // 按签到时间倒序：最新签到的排在最上面
      var res = await db
        .from('signin_records')
        .select('*')
        .order('created_at', { ascending: false });
      if (res.error) throw res.error;

      records = res.data || [];
      render();
      setStatus('');
      els.lastUpdated.textContent = '最后刷新：' + fmtTime(new Date().toISOString()) + ' · 共 ' + records.length + ' 条';
    } catch (err) {
      var pair = describeError(err);
      // 出错时保留已有表格内容，只提示错误；首次加载失败才清空
      if (!records.length) {
        els.tbody.innerHTML = '';
        els.emptyTip.hidden = false;
        els.totalCount.textContent = '0';
        els.lastUpdated.textContent = '尚未加载';
      }
      setStatus(pair[0] + '：' + pair[1], 'error');
    }
  }

  function render() {
    els.totalCount.textContent = String(records.length);

    if (!records.length) {
      els.tbody.innerHTML = '';
      els.emptyTip.hidden = false;
      return;
    }
    els.emptyTip.hidden = true;

    // 序号即展示顺序号（1 = 最新一条）；空姓名显示为 —
    var html = records.map(function (r, i) {
      var name = (r.name == null || r.name === '') ? '—' : escHtml(r.name);
      return '<tr>' +
        '<td>' + (i + 1) + '</td>' +
        '<td>' + name + '</td>' +
        '<td>' + escHtml(r.student_id) + '</td>' +
        '<td>' + fmtTime(r.created_at) + '</td>' +
        '</tr>';
    }).join('');
    els.tbody.innerHTML = html;
  }

  /* ---------------- 导出 CSV ---------------- */

  // CSV 单元格转义：含逗号/引号/换行时加引号包裹；防公式注入（= + - @ 开头补单引号）
  function csvCell(v) {
    v = String(v == null ? '' : v);
    if (/^[=+\-@]/.test(v)) v = "'" + v;
    if (/[",\r\n]/.test(v)) v = '"' + v.replace(/"/g, '""') + '"';
    return v;
  }

  function exportCSV() {
    if (!records.length) {
      setStatus('当前没有可导出的签到记录', 'warn');
      return;
    }

    // 表头与页面展示一致；行顺序也与页面一致（最新签到在最上）
    var lines = [['序号', '姓名', '学号', '签到时间'].map(csvCell).join(',')];
    records.forEach(function (r, i) {
      lines.push([
        i + 1,
        r.name == null ? '' : r.name,
        r.student_id,
        fmtTime(r.created_at)
      ].map(csvCell).join(','));
    });

    // '\uFEFF' 是 UTF-8 BOM：Excel 识别中文 CSV 的关键；'\r\n' 是 Windows 换行
    var blob = new Blob(['\uFEFF' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8;' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    var now = new Date();
    a.href = url;
    a.download = '签到记录_' + now.getFullYear() + pad(now.getMonth() + 1) + pad(now.getDate()) +
      '_' + pad(now.getHours()) + pad(now.getMinutes()) + '.csv';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  /* ---------------- 自动刷新 ---------------- */

  function setupAutoRefresh() {
    if (timer) { clearInterval(timer); timer = null; }
    if (els.autoRefresh.checked) {
      timer = setInterval(function () { loadRecords(true); }, 10000);
    }
  }

  /* ---------------- 启动 ---------------- */

  function boot() {
    if (window.CONFIG_ERROR) {
      setStatus(window.CONFIG_ERROR, 'error');
      els.lastUpdated.textContent = '尚未配置';
      return;
    }

    els.btnRefresh.addEventListener('click', function () { loadRecords(false); });
    els.btnExport.addEventListener('click', exportCSV);
    els.autoRefresh.addEventListener('change', setupAutoRefresh);

    loadRecords(false);
    setupAutoRefresh();
  }

  boot();
})();
