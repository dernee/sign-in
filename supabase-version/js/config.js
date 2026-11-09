/* ============================================================================
   config.js — Supabase 连接配置（★ 全项目唯一需要修改的文件 ★）
   ----------------------------------------------------------------------------
   怎么拿到这两行值？
     1. 登录 https://supabase.com 打开你的项目
     2. 项目地址 SUPABASE_URL：
        - 顶部「Connect」按钮弹窗里可复制 Project URL；或
        - 左下角 Project Settings → Data API / API Keys 页面查看
        形如：https://abcdefghijk.supabase.co
     3. 密钥 SUPABASE_ANON_KEY（二选一，均可用于本前端）：
        - 新式密钥：Settings → API Keys → Publishable key（sb_publishable_ 开头，推荐）
        - 旧式密钥：Settings → API Keys → Legacy API Keys 标签页 → anon key（eyJ 开头）
        注意：不要使用 secret / service_role 密钥！那属于服务端机密，
        浏览器使用会被 Supabase 拒绝（401），泄露还会危及整个数据库。

   为什么 anon/publishable 密钥公开也算安全？
     这类密钥本来就设计为可公开（相当于"项目标识"），真正的权限防线是
     数据库的 RLS 行级安全策略 —— 见 supabase-setup.sql 的说明。
   ========================================================================== */

/* ① 填写你的 Supabase 项目地址（形如 https://xxxx.supabase.co） */
var SUPABASE_URL = 'https://YOUR-PROJECT-REF.supabase.co';

/* ② 填写你的 anon（旧式）或 publishable（新式）密钥 */
var SUPABASE_ANON_KEY = 'YOUR-ANON-OR-PUBLISHABLE-KEY';

/* ============================================================================
   以下代码负责创建客户端并做启动自检，一般不需要修改。
   window.CONFIG_ERROR 有值时，页面会显示配置提示并停止提交功能。
   ========================================================================== */
window.CONFIG_ERROR = '';
window.db = null;

(function () {
  'use strict';

  // 情况 A：SDK 没加载成功（两个 CDN 都连不上）
  if (typeof supabase === 'undefined') {
    window.CONFIG_ERROR = 'Supabase SDK 加载失败：本页依赖 jsDelivr / unpkg CDN，请检查当前网络后刷新重试。';
    return;
  }

  // 情况 B：占位符还没替换成真实值
  if (SUPABASE_URL.indexOf('YOUR-') === 0 || SUPABASE_ANON_KEY.indexOf('YOUR-') === 0) {
    window.CONFIG_ERROR = '尚未完成配置：请打开 js/config.js，把 SUPABASE_URL 与 SUPABASE_ANON_KEY 替换为你自己的项目地址和密钥（文件内有获取步骤说明）。';
    return;
  }

  // 情况 C：正常初始化
  try {
    window.db = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  } catch (err) {
    window.CONFIG_ERROR = 'Supabase 客户端初始化失败：' + (err && err.message ? err.message : err);
  }
})();
