// 稽核系統設定：MODE 切換 mock 本機資料／真 GAS 後端
// local：js/mock-data.js 種子資料＋js/api.js 的 mock 分支
// cloud：呼叫 GAS_URL（Apps Script Web App，部署後填入）
window.Config = {
  // 2026-08-01 上線：GAS 部署 @2、已授權、匿名 getAll 實測通過。
  // 要回本機假資料測試（不碰真試算表）就把 MODE 改回 'local'。
  MODE: 'cloud', // 'local' | 'cloud'
  GAS_URL: 'https://script.google.com/macros/s/AKfycbz5l_aH_qypN6HK6UDT__5NLZDk4A2clyqeqvJzx5JrL9SBVeH5GyDYBCW3gv-CDy7fFQ/exec',
  // 通行碼：Eason 2026-08-01 指定「不需要通行碼」——開網址即可使用（含填寫）。
  // 要恢復登入時：本旗標與 apps-script/Code.gs 的同名常數一起改 true，
  // 再到試算表「設定」分頁填「會計通行碼」「主管通行碼」。
  REQUIRE_PASSCODE: false
};
