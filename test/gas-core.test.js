// node test/gas-core.test.js —— T9 驗收：Code.gs 核心（doPost 分流／auth／getAll）
// 零依賴、直跑、失敗時 process.exit(1)。載入方式見 test/gas-runner.js（vm 假環境，不部署）。

'use strict';

var runner = require('./gas-runner.js');

var failures = 0;

function assertEqual(actual, expected, label) {
  var ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) {
    failures++;
    console.error('FAIL: ' + label);
    console.error('  expected: ' + JSON.stringify(expected));
    console.error('  actual:   ' + JSON.stringify(actual));
  } else {
    console.log('PASS: ' + label);
  }
}

function assertTrue(cond, label) {
  if (!cond) {
    failures++;
    console.error('FAIL: ' + label);
  } else {
    console.log('PASS: ' + label);
  }
}

// ── 種子資料（欄位照 spec.md §2.2 逐字元；設定分頁照交辦內容）──────────
var REASONS_RAW = '盤點錯誤（門市盤錯）／損耗未記／單位混淆／進出貨未入帳／其他';

function seedTabs() {
  return {
    設定: [
      ['會計通行碼', '1234'],
      ['主管通行碼', '5678'],
      ['零找金標準', '10000'],
      ['零用金標準', '10000'],
      ['異常原因分類', REASONS_RAW]
    ],
    品項庫: [
      ['店代碼', '品項', '單位', '狀態'],
      ['sxl-gf', '牛肉片', '公斤', '啟用'],
      ['sxl-gf', '鴨血', '盒', '停用']
    ],
    稽核紀錄: [
      ['record_key', '店代碼', '年月', '狀態', '稽核日期', '抽查數量', '正確數量', '正確率',
        '零找金', '零用金', '小費金額', '小費相符', '異常說明', '備註', '提交時間'],
      ['sxl-gf_2026-08', 'sxl-gf', '2026-08', '已稽核', '2026-08-05', 20, 18, 90,
        '正確', '正確', 742, '相符', '1.鴨血:盤點27盒，覆盤32盒', '', '2026-08-05T10:32:00+08:00'],
      ['ck_2026-07', 'ck', '2026-07', '輪休', '', '', '', '', '', '', '', '', '', '', '']
    ],
    抽查明細: [
      ['record_key', '店代碼', '年月', '品項', '單位', '盤點數', '複盤數', '判定', '異常原因', '備註'],
      ['sxl-gf_2026-08', 'sxl-gf', '2026-08', '鴨血', '盒', 27, 32, '異常', '進出貨未入帳', ''],
      ['sxl-gf_2026-08', 'sxl-gf', '2026-08', '牛肉片', '公斤', 26.5, 26.5, '正確', '', '']
    ]
  };
}

function freshDb() {
  return runner.makeMemoryDb(seedTabs());
}

var gas = runner.loadGas();

// ============================================================
// auth 三情境
// ============================================================
(function () {
  var db = freshDb();
  assertEqual(gas.handleAuth({ code: '1234' }, db), { ok: true, role: 'accountant' }, 'auth 會計碼 → accountant');
  assertEqual(gas.handleAuth({ code: '5678' }, db), { ok: true, role: 'viewer' }, 'auth 主管碼 → viewer');
  assertEqual(gas.handleAuth({ code: '9999' }, db), { ok: false, error: '通行碼錯誤' }, 'auth 錯碼 → ok:false');
  assertEqual(gas.handleAuth({}, db), { ok: false, error: '通行碼錯誤' }, 'auth 缺 code → ok:false');
})();

// ============================================================
// getAll 形狀齊全＋樣本列映射＋不洩漏通行碼
// ============================================================
(function () {
  var db = freshDb();
  var res = gas.handleGetAll({ code: '1234' }, db);

  assertTrue(res.ok === true, 'getAll 會計碼 ok:true');
  assertTrue(!!res.config, 'getAll 有 config');
  assertTrue(Array.isArray(res.items), 'getAll items 是陣列');
  assertTrue(Array.isArray(res.records), 'getAll records 是陣列');
  assertTrue(Array.isArray(res.details), 'getAll details 是陣列');

  // config
  assertEqual(res.config.reasons.length, 5, 'config.reasons.length === 5');
  assertEqual(res.config.reasons, ['盤點錯誤（門市盤錯）', '損耗未記', '單位混淆', '進出貨未入帳', '其他'], 'config.reasons 拆字內容');
  assertEqual(res.config.change_fund_std, 10000, 'config.change_fund_std');
  assertEqual(res.config.petty_cash_std, 10000, 'config.petty_cash_std');
  assertEqual(res.config.stores.length, 5, 'config.stores 五店');
  assertEqual(res.config.stores[0], { code: 'sxl-gf', name: '小辛辣光復', order: 1 }, 'config.stores[0] 內容');
  assertEqual(res.config.accountant_ok, true, 'config.accountant_ok（會計碼登入為 true）');

  // items 映射（含 active 布林轉換）
  assertEqual(res.items.length, 2, 'items 筆數（略過表頭）');
  assertEqual(res.items[0], { store: 'sxl-gf', name: '牛肉片', unit: '公斤', active: true }, 'items[0] 啟用 → active:true');
  assertEqual(res.items[1], { store: 'sxl-gf', name: '鴨血', unit: '盒', active: false }, 'items[1] 停用 → active:false');

  // records 映射
  assertEqual(res.records.length, 2, 'records 筆數（略過表頭）');
  assertEqual(res.records[0], {
    record_key: 'sxl-gf_2026-08', store: 'sxl-gf', month: '2026-08', status: '已稽核',
    audit_date: '2026-08-05', sample_count: 20, correct_count: 18, correct_rate: 90,
    change_fund: '正確', petty_cash: '正確', tip_amount: 742, tip_match: '相符',
    anomaly_text: '1.鴨血:盤點27盒，覆盤32盒', note: '', submitted_at: '2026-08-05T10:32:00+08:00'
  }, 'records[0] 樣本列正確映射');
  assertEqual(res.records[1].status, '輪休', 'records[1] 輪休列 status');

  // details 映射
  assertEqual(res.details.length, 2, 'details 筆數（略過表頭）');
  assertEqual(res.details[0], {
    record_key: 'sxl-gf_2026-08', store: 'sxl-gf', month: '2026-08', item: '鴨血', unit: '盒',
    book_qty: 27, recount_qty: 32, verdict: '異常', reason: '進出貨未入帳', note: ''
  }, 'details[0] 樣本列正確映射（異常項）');
  assertEqual(res.details[1].verdict, '正確', 'details[1] 正確項 verdict');

  // 回傳不含任何通行碼字串
  var serialized = JSON.stringify(res);
  assertTrue(serialized.indexOf('1234') === -1, 'getAll 回傳不含會計通行碼字串');
  assertTrue(serialized.indexOf('5678') === -1, 'getAll 回傳不含主管通行碼字串');
})();

// getAll：主管碼 → accountant_ok:false；錯碼／缺碼 → ok:false
(function () {
  var db = freshDb();
  var viewerRes = gas.handleGetAll({ code: '5678' }, db);
  assertTrue(viewerRes.ok === true, 'getAll 主管碼 ok:true');
  assertEqual(viewerRes.config.accountant_ok, false, 'getAll 主管碼 accountant_ok:false');

  assertEqual(gas.handleGetAll({ code: 'bad' }, db), { ok: false, error: '通行碼錯誤' }, 'getAll 錯碼 → ok:false');
  assertEqual(gas.handleGetAll({}, db), { ok: false, error: '通行碼錯誤' }, 'getAll 缺 code → ok:false');
})();

// ============================================================
// doPost：action 白名單／壞 JSON 不 crash
// ============================================================
(function () {
  var db = freshDb();
  // 全新載入一份 gas（不共用上面用過的 sandbox），並把 makeDb_ 換成回傳記憶體 db，
  // 這樣 doPost 內部呼叫 makeDb_() 就不會碰真的 SpreadsheetApp（node 沒有那個全域）。
  var gasForDoPost = runner.loadGas();
  gasForDoPost.makeDb_ = function () { return db; };

  // 未知 action 拒收
  var unknownRes = runner.parseResponse(gasForDoPost.doPost(runner.makePostEvent({ action: 'deleteAll', code: '1234' })));
  assertTrue(unknownRes.ok === false, 'doPost 未知 action → ok:false');
  assertTrue(!!unknownRes.error, 'doPost 未知 action 附錯誤訊息');

  // 壞 JSON 不 crash
  var badJsonRes;
  var threw = false;
  try {
    badJsonRes = runner.parseResponse(gasForDoPost.doPost(runner.makePostEvent('{this is not json')));
  } catch (e) {
    threw = true;
  }
  assertTrue(threw === false, 'doPost 壞 JSON 不拋例外');
  assertTrue(badJsonRes && badJsonRes.ok === false, 'doPost 壞 JSON 回 {ok:false}');

  // 正常路徑（透過 doPost 整合，確認 handler 有被呼叫且沒 crash）
  var authRes = runner.parseResponse(gasForDoPost.doPost(runner.makePostEvent({ action: 'auth', code: '1234' })));
  assertEqual(authRes, { ok: true, role: 'accountant' }, 'doPost auth 正常路徑');

  var getAllRes = runner.parseResponse(gasForDoPost.doPost(runner.makePostEvent({ action: 'getAll', code: '1234' })));
  assertTrue(getAllRes.ok === true && Array.isArray(getAllRes.items), 'doPost getAll 正常路徑');
})();

if (failures > 0) {
  console.error('\n' + failures + ' 項測試失敗');
  process.exit(1);
} else {
  console.log('\n全部測試通過');
}
