// 稽核系統設定：MODE 切換 mock 本機資料／真 GAS 後端
// local：js/mock-data.js 種子資料＋js/api.js 的 mock 分支
// cloud：呼叫 GAS_URL（Apps Script Web App，部署後填入）
window.Config = {
  MODE: 'local', // 'local' | 'cloud'
  GAS_URL: ''
};
