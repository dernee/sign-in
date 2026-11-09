/* ============================================================================
   vendor.js — CDN 依赖加载器
   ----------------------------------------------------------------------------
   本项目按需求使用 CDN 引入第三方库，不在仓库内自带副本：
     · qrcode.js  （davidshimjs/qrcodejs，生成二维码，全局变量 QRCode）
     · SheetJS    （xlsx.full.min.js 解析 Excel，全局变量 XLSX）

   为了在网络受限时仍能启动，这里为每个库准备了多个 CDN 源，按顺序尝试：
   前一个失败（404 / 超时 / 被拦截）才尝试下一个，全部失败则标记为 fail，
   页面顶部会出现「依赖加载失败」状态，用户点击对应按钮时会收到提示。

   注意：动态注入的 <script> 属于经典脚本，不受 CORS 限制，
   因此在 file:// 直接打开页面时同样可以加载成功（依赖联网）。
   ========================================================================== */
(function () {
  'use strict';

  var SOURCES = {
    qrcode: [
      'https://cdn.bootcdn.net/ajax/libs/qrcodejs/1.0.0/qrcode.min.js',
      'https://cdnjs.cloudflare.com/ajax/libs/qrcodejs/1.0.0/qrcode.min.js',
      'https://cdn.staticfile.org/qrcodejs/1.0.0/qrcode.min.js',
      'https://cdn.jsdelivr.net/npm/qrcodejs@1.0.0/qrcode.min.js'
    ],
    xlsx: [
      'https://cdn.bootcdn.net/ajax/libs/xlsx/0.18.5/xlsx.full.min.js',
      'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js',
      'https://cdn.staticfile.org/xlsx/0.18.5/xlsx.full.min.js',
      'https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js'
    ]
  };

  // 单个脚本加载，带 12 秒超时（避免某个源长时间挂起拖住整页）
  function loadScript(url, timeout) {
    return new Promise(function (resolve, reject) {
      var s = document.createElement('script');
      var done = false;
      var timer = setTimeout(function () {
        if (done) return;
        done = true;
        s.onload = s.onerror = null;
        reject(new Error('timeout: ' + url));
      }, timeout || 12000);

      s.src = url;
      s.async = false;
      s.onload = function () {
        if (done) return;
        done = true;
        clearTimeout(timer);
        resolve(url);
      };
      s.onerror = function () {
        if (done) return;
        done = true;
        clearTimeout(timer);
        reject(new Error('error: ' + url));
      };
      document.head.appendChild(s);
    });
  }

  // 依次尝试多个源
  function loadAny(urls) {
    var i = 0;
    function next() {
      if (i >= urls.length) return Promise.reject(new Error('all sources failed'));
      var url = urls[i++];
      return loadScript(url).catch(next);
    }
    return next();
  }

  var qrcode = loadAny(SOURCES.qrcode);
  var xlsx = loadAny(SOURCES.xlsx);

  window.Vendor = {
    qrcode: qrcode,
    xlsx: xlsx,
    ready: Promise.allSettled([qrcode, xlsx]).then(function (results) {
      return {
        qrcode: results[0].status === 'fulfilled',
        xlsx: results[1].status === 'fulfilled'
      };
    })
  };
})();
