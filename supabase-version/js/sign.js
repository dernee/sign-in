/* ============================================================================
   sign.js — 学生签到页逻辑（sign.html 专用）
   ----------------------------------------------------------------------------
   提交流程（本地校验 → 提交前查重 → 数据库唯一索引兜底）：
     ① 本地校验：姓名、学号非空；学号做归一化（去空白、零宽字符、数字尾巴 .0）
     ② 提交前查重：先 SELECT 该学号是否已存在 → 存在则友好提示"请勿重复签到"
     ③ 数据库兜底：student_id 上有唯一索引（见 supabase-setup.sql），
        两台手机并发提交同一学号时，后到的那条 INSERT 会收到 23505 唯一冲突，
        同样按"重复签到"提示 —— 保证同一学号只入库一条记录。
   ========================================================================== */
(function () {
  'use strict';

  var $ = function (id) { return document.getElementById(id); };

  var els = {
    configErr: $('configError'),
    form: $('signForm'),
    name: $('nameInput'),
    sid: $('sidInput'),
    nameErr: $('nameErr'),
    sidErr: $('sidErr'),
    btn: $('btnSubmit'),
    successView: $('successView'),
    successDesc: $('successDesc'),
    errorView: $('errorView'),
    errorTitle: $('errorTitle'),
    errorDesc: $('errorDesc'),
    btnBack: $('btnBack')
  };

  /* ---------------- 工具函数 ---------------- */

  // 学号归一化：去首尾空白、内部空白与零宽字符；去掉Excel数值学号常见的 .0 尾巴
  function normalizeId(v) {
    return String(v == null ? '' : v)
      .replace(/[\u00a0\u200b\ufeff]/g, '')
      .replace(/\s+/g, '')
      .replace(/\.0+$/, '')
      .trim();
  }

  // 姓名归一化：去首尾空白、内部空白与零宽字符
  function normalizeName(v) {
    return String(v == null ? '' : v)
      .replace(/[\u00a0\u200b\ufeff]/g, '')
      .replace(/\s+/g, '')
      .trim();
  }

  function pad(n) { return String(n).padStart(2, '0'); }

  // 把 Supabase 返回的 UTC 时间转成浏览器本地时区的 YYYY-MM-DD HH:mm:ss
  function fmtTime(iso) {
    var d = new Date(iso);
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) +
      ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes()) + ':' + pad(d.getSeconds());
  }

  /* ---------------- 视图控制 ---------------- */

  function fieldError(input, errEl, msg) {
    input.classList.add('is-bad');
    errEl.textContent = msg;
    input.focus();
  }

  // 输入时清除该字段的错误提示
  function bindClearError(input, errEl) {
    input.addEventListener('input', function () {
      input.classList.remove('is-bad');
      errEl.textContent = '';
    });
  }

  function setSubmitting(busy) {
    els.btn.disabled = busy;
    els.btn.textContent = busy ? '提交中…' : '提交签到';
  }

  // 失败/提示态：隐藏表单，展示错误卡片
  function showError(title, desc) {
    els.form.hidden = true;
    els.successView.hidden = true;
    els.errorView.hidden = false;
    els.errorTitle.textContent = title;
    els.errorDesc.textContent = desc;
  }

  // 从错误卡片返回表单
  function backToForm() {
    els.errorView.hidden = true;
    els.form.hidden = false;
    els.sid.focus();
  }

  /* ---------------- Supabase 操作 ---------------- */

  // 查重 + 写入。返回 { duplicate: true } 或 { duplicate: false, row: 插入后的记录 }
  async function submitSignin(sid, name) {
    // ② 提交前查重（体验层：给同学一个明确的"已签过"提示）
    var dup = await db
      .from('signin_records')
      .select('student_id')
      .eq('student_id', sid)
      .maybeSingle();
    if (dup.error) throw dup.error;
    if (dup.data) return { duplicate: true };

    // ③ 写入数据库。链上 .select().single() 取回数据库生成的正式签到时间
    //   （比取手机本地时间更可靠，且能拿到 default now() 的真实值）
    var ins = await db
      .from('signin_records')
      .insert({ student_id: sid, name: name })
      .select('student_id, name, created_at')
      .single();
    if (ins.error) {
      // 并发兜底：唯一索引冲突（错误码 23505）= 该学号刚刚已被别人/别的设备签到
      if (ins.error.code === '23505') return { duplicate: true };
      throw ins.error;
    }
    return { duplicate: false, row: ins.data };
  }

  // 把 Supabase/网络错误翻译成「标题 + 建议动作」，返回 [标题, 描述]
  function describeError(err) {
    var msg = (err && err.message) ? err.message : String(err);
    if (err && err.code === '42501') {
      return ['权限被拒绝（RLS）', '数据表已开启行级安全但缺少放行策略或授权。请在 Supabase 控制台 SQL Editor 重新执行项目里的 supabase-setup.sql。'];
    }
    if (err && err.code === '42P01') {
      return ['数据表不存在', '请先在 Supabase 控制台 SQL Editor 执行项目里的 supabase-setup.sql 完成建表。'];
    }
    if (/fetch/i.test(msg)) {
      return ['网络连接失败', '无法连接 Supabase 服务器。请检查手机网络是否可用，或确认 js/config.js 中的项目地址填写正确（https:// 开头，以 .supabase.co 结尾）。'];
    }
    if (/invalid api key|JWT|apikey/i.test(msg)) {
      return ['API 密钥无效', '请检查 js/config.js 中的密钥是否复制完整。需要 anon（旧式）或 publishable（新式）密钥，不要使用 secret / service_role 密钥。'];
    }
    return ['提交失败', msg];
  }

  /* ---------------- 事件 ---------------- */

  async function onSubmit(ev) {
    ev.preventDefault();
    if (!window.db) return; // 配置未就绪时 config.js 已给出提示

    var sid = normalizeId(els.sid.value);
    var name = normalizeName(els.name.value);

    // ① 本地校验：学号不能为空（需求要求）；姓名同样必填，保证后台名单完整
    if (!sid) { fieldError(els.sid, els.sidErr, '学号不能为空'); return; }
    if (!name) { fieldError(els.name, els.nameErr, '姓名不能为空'); return; }

    setSubmitting(true);
    try {
      var res = await submitSignin(sid, name);
      if (res.duplicate) {
        showError('请勿重复签到', '学号 ' + sid + ' 已经完成过签到，无需再次提交。');
      } else {
        // 成功：隐藏表单，显示"签到完成"卡片并锁定
        els.form.hidden = true;
        els.errorView.hidden = true;
        els.successView.hidden = false;
        els.successDesc.textContent = name + '（学号 ' + sid + '）· 签到时间 ' + fmtTime(res.row.created_at);
      }
    } catch (err) {
      var pair = describeError(err);
      showError(pair[0], pair[1]);
    } finally {
      setSubmitting(false);
    }
  }

  /* ---------------- 启动 ---------------- */

  function boot() {
    // 配置自检失败：显示提示横幅，隐藏表单，不再进入签到流程
    if (window.CONFIG_ERROR) {
      els.configErr.hidden = false;
      els.configErr.textContent = window.CONFIG_ERROR;
      els.form.hidden = true;
      return;
    }

    els.form.addEventListener('submit', onSubmit);
    els.btnBack.addEventListener('click', backToForm);
    bindClearError(els.sid, els.sidErr);
    bindClearError(els.name, els.nameErr);
  }

  boot();
})();
