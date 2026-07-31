// 稽核系統設定：MODE 切換 mock 本機資料／真 GAS 後端
// local：js/mock-data.js 種子資料＋js/api.js 的 mock 分支
// cloud：呼叫 GAS_URL（Apps Script Web App，部署後填入）
window.Config = {
  MODE: 'local', // 'local' | 'cloud'
  GAS_URL: '',
  // 通行碼：Eason 2026-08-01 指定「不需要通行碼」——開網址即可使用（含填寫）。
  // 要恢復登入時：本旗標與 apps-script/Code.gs 的同名常數一起改 true，
  // 再到試算表「設定」分頁填「會計通行碼」「主管通行碼」。
  REQUIRE_PASSCODE: false
};
