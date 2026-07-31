// 稽核系統設定：MODE 切換 mock 本機資料／真 GAS 後端
// local：js/mock-data.js 種子資料＋js/api.js 的 mock 分支（通行碼用 mock 的 1234／5678）
// cloud：呼叫 GAS_URL（真試算表；通行碼讀試算表「設定」分頁）
//
// 網址可加 ?mode=local 暫時切成假資料模式（測試用，不會碰到真試算表）。
// 這也是自動化測試不需要知道正式密碼的原因——測試一律跑 ?mode=local。
(function () {
  'use strict';

  var config = {
    MODE: 'cloud', // 'local' | 'cloud'
    GAS_URL: 'https://script.google.com/macros/s/AKfycbz5l_aH_qypN6HK6UDT__5NLZDk4A2clyqeqvJzx5JrL9SBVeH5GyDYBCW3gv-CDy7fFQ/exec',
    // 2026-08-01 Eason 指示上鎖：需通行碼才能使用。
    // 通行碼本身只存在試算表「設定」分頁，**不寫進程式碼、不進 GitHub**。
    // 後端 apps-script/Code.gs 有同名常數，兩邊必須一致。
    REQUIRE_PASSCODE: true
  };

  // ?mode=local / ?mode=cloud 覆寫（只認這兩個值）
  try {
    var m = (location.search.match(/[?&]mode=(local|cloud)\b/) || [])[1];
    if (m) config.MODE = m;
  } catch (e) { /* file:// 直開時沒有 location.search，忽略 */ }

  window.Config = config;
})();
