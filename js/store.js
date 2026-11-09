/* ============================================================================
   store.js — 内存状态 + 同浏览器内通信层
   ----------------------------------------------------------------------------
   【最重要的一段代码，对应需求第 4 条与第 9 条】

   1. 所有业务数据（名单、签到记录、当前签到会话）都只挂在这个闭包内的变量上，
      没有 localStorage / sessionStorage / IndexedDB / document.cookie 的任何写入。
      刷新页面时浏览器会销毁执行环境，这些变量随之消失 —— 这就是"刷新即清空"
      的实现方式，而不是靠额外的清理代码。
   2. 没有后端，也就没有跨设备通道。学生端与班长端之间只使用两种"同浏览器内"
      的通道：BroadcastChannel（同源标签页/窗口）与 window.postMessage
      （仅当学生端由班长端 window.open 打开时）。手机扫码无法加入这两个通道。
   3. 二维码 URL 中携带 token 与过期时间戳，学生端可离线判断"过期"；
      但"是否被班长端认可"必须由班长端应答，否则一律按失效处理。

   消息类型：
     probe        学生端 → 询问 "这个 token 还有效吗"
     probe-reply  班长端 → 回执（ok / expired / invalid / ended / no-session）
     signin       学生端 → 提交换行信息
     signin-reply 班长端 → 比对结果（ok / not-in-roster / name-mismatch / duplicate ...）
   ========================================================================== */
(function () {
  'use strict';

  var APP_ID = 'class-checkin-demo-v1';
  var TOKEN_TTL = 5 * 60 * 1000; // 二维码有效期固定 5 分钟

  /* ---------------- 工具 ---------------- */
  function uid(prefix) {
    return (prefix || '') + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  }

  // 学号、姓名比对前的归一化：去首尾空白、去掉所有空白字符与不可见字符
  function normalizeId(v) {
    return String(v == null ? '' : v)
      .replace(/[\u00a0\u200b\ufeff]/g, '')
      .replace(/\s+/g, '')
      .replace(/\.0+$/, '') // 防止数值型学号被读成 20230101.0
      .trim();
  }
  function normalizeName(v) {
    return String(v == null ? '' : v)
      .replace(/[\u00a0\u200b\ufeff]/g, '')
      .replace(/\s+/g, '')
      .trim();
  }

  /* ---------------- 内存状态 ---------------- */
  var state = {
    role: 'monitor',   // monitor | student
    roster: [],        // [{ sid, name }]
    records: [],       // [{ sid, name, at }]
    session: null      // { token, createdAt, expiresAt, ended, endedAt }
  };

  var listeners = {};

  function on(evt, fn) {
    (listeners[evt] || (listeners[evt] = [])).push(fn);
  }
  function emit(evt, data) {
    (listeners[evt] || []).forEach(function (fn) {
      try { fn(data); } catch (err) { console.error('[store] listener error', err); }
    });
  }

  var Store = {
    TTL: TOKEN_TTL,
    clientId: uid('c-'),

    /* ---- 只读快照 ---- */
    get role() { return state.role; },
    set role(v) { state.role = v; },
    get roster() { return state.roster; },
    get records() { return state.records; },
    get session() { return state.session; },

    on: on,
    emit: emit,
    normalizeId: normalizeId,
    normalizeName: normalizeName,

    /* ---- 名单 ---- */
    setRoster: function (list) {
      state.roster = list.slice();
      // 名单变了，已签到记录里可能已不存在的人不影响展示，这里不做交叉清理。
      emit('roster', state.roster);
    },
    clearRoster: function () {
      state.roster = [];
      emit('roster', state.roster);
    },

    /* ---- 签到会话（二维码） ---- */
    startSession: function () {
      var now = Date.now();
      state.session = {
        token: 'S-' + now.toString(36).toUpperCase() + '-' + Math.random().toString(36).slice(2, 6).toUpperCase(),
        createdAt: now,
        expiresAt: now + TOKEN_TTL, // 固定 5 分钟，结束后不可延长
        ended: false,
        endedAt: null
      };
      state.records = [];  // 每次重新生成二维码，都开启一轮新的签到
      emit('session', state.session);
      emit('records', state.records);
      return state.session;
    },

    endSession: function () {
      if (!state.session) return;
      state.session.ended = true;
      state.session.endedAt = Date.now();
      emit('session', state.session);
    },

    // 纯计算：不写入任何存储，刷新后自然归零
    sessionState: function () {
      var s = state.session;
      if (!s) return 'idle';
      if (s.ended) return 'ended';
      if (Date.now() >= s.expiresAt) return 'expired';
      return 'live';
    },

    // 班长端权威校验：token 是否属于当前会话、是否仍在有效期内
    evalToken: function (token) {
      var s = state.session;
      if (!s) return { ok: false, reason: 'no-session' };
      if (!token || token !== s.token) return { ok: false, reason: 'invalid' };
      if (s.ended) return { ok: false, reason: 'ended' };
      if (Date.now() >= s.expiresAt) return { ok: false, reason: 'expired' };
      return { ok: true };
    },

    findStudent: function (sid) {
      var key = normalizeId(sid);
      for (var i = 0; i < state.roster.length; i++) {
        if (normalizeId(state.roster[i].sid) === key) return state.roster[i];
      }
      return null;
    },

    hasSigned: function (sid) {
      var key = normalizeId(sid);
      for (var i = 0; i < state.records.length; i++) {
        if (normalizeId(state.records[i].sid) === key) return true;
      }
      return false;
    },

    /* 提交签到：先校验凭证与有效期，再与导入名单比对 */
    submitSignin: function (token, sid, name) {
      var check = Store.evalToken(token);
      if (!check.ok) return { code: check.reason };

      if (!state.roster.length) return { code: 'no-roster' };

      var key = normalizeId(sid);
      var nm = normalizeName(name);
      if (!key) return { code: 'empty-sid' };
      if (!nm) return { code: 'empty-name' };

      var student = Store.findStudent(key);
      if (!student) return { code: 'not-in-roster' };

      if (normalizeName(student.name) !== nm) return { code: 'name-mismatch' };

      if (Store.hasSigned(student.sid)) return { code: 'duplicate' };

      var record = { sid: student.sid, name: student.name, at: Date.now() };
      state.records.push(record);
      emit('records', state.records);
      return { code: 'ok', record: record };
    },

    stats: function () {
      var total = state.roster.length;
      var signed = 0;
      var seen = {};
      state.records.forEach(function (r) {
        var k = normalizeId(r.sid);
        if (seen[k]) return;
        seen[k] = 1;
        if (Store.findStudent(k)) signed++;
      });
      return {
        total: total,
        signed: signed,
        unsigned: Math.max(0, total - signed),
        rate: total ? Math.round((signed / total) * 100) : 0
      };
    },

    /* 学生端链接：token + 过期时间戳（供学生端离线判断是否过期） */
    studentUrl: function (token, expiresAt) {
      var base = location.href.split('#')[0].split('?')[0];
      return base + '?role=student&t=' + encodeURIComponent(token) + '&e=' + expiresAt;
    }
  };

  /* ---------------- 通信层 ---------------- */
  var bus = null;
  try {
    if (typeof BroadcastChannel === 'function') {
      bus = new BroadcastChannel(APP_ID); // 同源窗口/标签页共享；file:// 下可能不可用
    }
  } catch (err) {
    bus = null;
  }

  var seenUid = Object.create(null);

  function makeEnvelope(type, payload, uidStr) {
    return {
      app: APP_ID,
      uid: uidStr || uid('m-'),
      type: type,
      from: Store.clientId,
      ts: Date.now(),
      payload: payload || {}
    };
  }

  var Net = {
    supported: !!bus,
    /*
      发送消息。
      targetWin 不为空时，额外用 postMessage 直发该窗口，
      以覆盖 file:// / 无 BroadcastChannel 的场景。
      uidStr 显式传入时，两个通道发送的是"同一条消息"，接收端按 uid 去重。
    */
    post: function (type, payload, targetWin, uidStr) {
      var msg = makeEnvelope(type, payload, uidStr);
      if (bus) { try { bus.postMessage(msg); } catch (err) { /* 忽略 */ } }
      if (targetWin) { try { targetWin.postMessage(msg, '*'); } catch (err) { /* 跨源或已关闭 */ } }
      return msg;
    },

    onMessage: function (handler) {
      function dispatch(msg, source) {
        if (!msg || msg.app !== APP_ID) return;
        if (msg.from === Store.clientId) return;        // 忽略自己发出的
        if (msg.uid) {
          if (seenUid[msg.uid]) return;                  // 双通道去重
          seenUid[msg.uid] = 1;
        }
        handler(msg, source || null);
      }
      if (bus) {
        bus.onmessage = function (ev) { dispatch(ev && ev.data, null); };
      }
      window.addEventListener('message', function (ev) {
        dispatch(ev && ev.data, ev.source);
      });
    }
  };

  window.Store = Store;
  window.Net = Net;
})();
