// node test/gas-stores.test.js —— 門市管理（2026-09-28）：新增／停用門市、清單改讀「門市」分頁
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

var RECORDS_HEADER = ['record_key', '店代碼', '年月', '狀態', '稽核日期', '抽查數量', '正確數量', '正確率',
  '零找金', '零用金', '小費金額', '小費相符', '異常說明', '備註', '提交時間'];

function freshDb() {
  return runner.makeMemoryDb({
    設定: [['會計通行碼', '1234'], ['主管通行碼', '5678'], ['零找金標準', 10000], ['零用金標準', 10000],
      ['異常原因分類', '其他']],
    品項庫: [['店代碼', '品項', '單位', '狀態']],
    稽核紀錄: [RECORDS_HEADER],
    抽查明細: [['record_key', '店代碼', '年月', '品項', '單位', '盤點數', '複盤數', '判定', '異常原因', '備註']],
    小辛辣光復店: [['月份']], 央廚: [['月份']], 光復店: [['月份']], 金山店: [['月份']], 六張犁店: [['月份']]
  });
}

function codes(list) { return list.map(function (s) { return s.code; }); }

// (1) 沒有「門市」分頁 → 行為與改版前完全相同（五店、全部啟用）
(function () {
  var gas = runner.loadGas();
  var db = freshDb();
  var res = gas.handleGetAll({ code: '1234' }, db);
  assertEqual(codes(res.config.stores), ['sxl-gf', 'ck', 'mzt-gf', 'mzt-js', 'mzt-lzl'], '(1) 無門市分頁：stores＝原本五店');
  assertEqual(res.config.stores[0], { code: 'sxl-gf', name: '小辛辣光復', order: 1 }, '(1) stores 每筆形狀不變（code/name/order）');
  assertEqual(res.config.all_stores.length, 5, '(1) all_stores 五筆');
  assertTrue(!db.hasTab('門市'), '(1) 只讀不會建分頁');
})();

// (2) 新增門市：寫門市分頁（先抄入原五店）＋建顯示分頁；getAll 看得到
(function () {
  var gas = runner.loadGas();
  var db = freshDb();
  var res = gas.handleAddStore({ code: '1234', name: '一悟燒肉竹北' }, db);
  assertEqual(res, { ok: true, store: { code: 'st-01', name: '一悟燒肉竹北' } }, '(2) 新增成功，代碼 st-01');
  var rows = db.getRows('門市');
  assertEqual(rows[0], ['店代碼', '店名', '分頁名', '狀態'], '(2) 門市分頁表頭');
  assertEqual(rows.length, 7, '(2) 表頭＋原五店＋新店');
  assertEqual(rows[1], ['sxl-gf', '小辛辣光復', '小辛辣光復店', '啟用'], '(2) 原五店照分頁名抄入');
  assertEqual(rows[6], ['st-01', '一悟燒肉竹北', '一悟燒肉竹北', '啟用'], '(2) 新店列');
  var tab = db.getRows('一悟燒肉竹北');
  assertEqual(tab.length, 13, '(2) 顯示分頁：表頭＋12 個月');
  assertEqual(tab[0][8], '複盤異常說明', '(2) 顯示分頁 A–I 表頭');
  assertEqual(tab[12][0], '十二月', '(2) 顯示分頁月份標籤');
  var all = gas.handleGetAll({ code: '1234' }, db);
  assertEqual(all.config.stores[5], { code: 'st-01', name: '一悟燒肉竹北', order: 6 }, '(2) getAll 出現新店');

  var res2 = gas.handleAddStore({ code: '1234', name: '第二家' }, db);
  assertEqual(res2.store.code, 'st-02', '(2) 第二家流水號 st-02');
})();

// (3) 新增的擋法
(function () {
  var gas = runner.loadGas();
  var db = freshDb();
  assertEqual(gas.handleAddStore({ code: '5678', name: 'X' }, db).ok, false, '(3) 主管碼不得新增');
  assertEqual(gas.handleAddStore({ code: '9999', name: 'X' }, db).ok, false, '(3) 錯碼不得新增');
  assertEqual(gas.handleAddStore({ code: '1234', name: '  ' }, db).error, '請填門市名稱', '(3) 空名稱擋');
  assertTrue(/已經有/.test(gas.handleAddStore({ code: '1234', name: '央廚' }, db).error), '(3) 同名門市擋');
  assertTrue(/已經有/.test(gas.handleAddStore({ code: '1234', name: '光復店' }, db).error), '(3) 與既有顯示分頁名同名擋');
  assertTrue(/分頁/.test(gas.handleAddStore({ code: '1234', name: '設定' }, db).error), '(3) 與資料分頁撞名擋');
  assertTrue(/符號/.test(gas.handleAddStore({ code: '1234', name: 'a/b' }, db).error), '(3) 分頁名不合法符號擋');
  assertTrue(!db.hasTab('門市'), '(3) 被擋下時不建門市分頁');
})();

// (4) 停用／啟用：只改狀態，stores 不出現、all_stores 仍在；停用門市的紀錄照樣能送
(function () {
  var gas = runner.loadGas();
  var db = freshDb();
  assertEqual(gas.handleSetStoreStatus({ code: '1234', store: 'ck', status: '停用' }, db), { ok: true }, '(4) 停用央廚');
  var all = gas.handleGetAll({ code: '1234' }, db);
  assertEqual(codes(all.config.stores), ['sxl-gf', 'mzt-gf', 'mzt-js', 'mzt-lzl'], '(4) stores 不含停用');
  assertEqual(all.config.stores[1].order, 2, '(4) order 重新連號');
  var ck = all.config.all_stores.filter(function (s) { return s.code === 'ck'; })[0];
  assertEqual(ck.active, false, '(4) all_stores 仍有央廚、active=false');
  assertTrue(gas.storeByCode_('ck', db) !== null, '(4) 停用門市仍查得到（歷史資料與顯示分頁還在）');
  assertEqual(gas.handleMarkRest({ code: '1234', store: 'ck', month: '2026-09' }, db).ok, true, '(4) 停用門市仍可標輪休（不擋既有流程）');

  assertEqual(gas.handleSetStoreStatus({ code: '1234', store: 'ck', status: '啟用' }, db), { ok: true }, '(4) 重新啟用');
  assertEqual(gas.handleGetAll({ code: '1234' }, db).config.stores.length, 5, '(4) 重新啟用後回到五店');

  assertEqual(gas.handleSetStoreStatus({ code: '5678', store: 'ck', status: '停用' }, db).ok, false, '(4) 主管碼不得停用');
  assertEqual(gas.handleSetStoreStatus({ code: '1234', store: 'nope', status: '停用' }, db).ok, false, '(4) 不存在的店代碼擋');
  assertEqual(gas.handleSetStoreStatus({ code: '1234', store: 'ck', status: '關閉' }, db).ok, false, '(4) 狀態枚舉逐字元');
})();

// (5) 至少留一家啟用
(function () {
  var gas = runner.loadGas();
  var db = freshDb();
  ['sxl-gf', 'ck', 'mzt-gf', 'mzt-js'].forEach(function (c) {
    gas.handleSetStoreStatus({ code: '1234', store: c, status: '停用' }, db);
  });
  var last = gas.handleSetStoreStatus({ code: '1234', store: 'mzt-lzl', status: '停用' }, db);
  assertEqual(last.ok, false, '(5) 最後一家不得停用');
})();

// (6) 新門市走完盤點送出：回寫到新建的顯示分頁
(function () {
  var gas = runner.loadGas();
  var db = freshDb();
  gas.handleAddStore({ code: '1234', name: '新店' }, db);
  var res = gas.handleSubmitAudit({
    code: '1234',
    record: {
      record_key: 'st-01_2026-09', store: 'st-01', month: '2026-09', status: '已稽核', audit_date: '2026-09-28',
      sample_count: 20, correct_count: 20, correct_rate: 100, change_fund: '正確', petty_cash: '正確',
      tip_amount: 0, tip_match: '相符', anomaly_text: '', note: '', submitted_at: '2026-09-28T10:00:00+08:00'
    },
    details: []
  }, db);
  assertEqual(res.ok, true, '(6) 新門市可送出盤點');
  assertEqual(db.getCell('新店', 'B10'), 20, '(6) 回寫到新店顯示分頁九月列');
  assertEqual(db.getCell('新店', 'D10'), '=C10/B10', '(6) D 欄照樣是公式');
})();

// (8) 改名：系統新增的店 → 分頁跟著改；歷史紀錄照樣回寫到新分頁
(function () {
  var gas = runner.loadGas();
  var db = freshDb();
  gas.handleAddStore({ code: '1234', name: '新店' }, db);
  var res = gas.handleRenameStore({ code: '1234', store: 'st-01', name: '新店竹北' }, db);
  assertEqual(res, { ok: true, tab_renamed: true }, '(8) 改名成功、分頁跟著改');
  assertTrue(db.hasTab('新店竹北') && !db.hasTab('新店'), '(8) 顯示分頁已改名');
  assertEqual(db.getRows('門市')[6], ['st-01', '新店竹北', '新店竹北', '啟用'], '(8) 門市分頁店名與分頁名都更新');
  var all = gas.handleGetAll({ code: '1234' }, db);
  assertEqual(all.config.stores[5], { code: 'st-01', name: '新店竹北', order: 6 }, '(8) getAll 回新名、代碼不變');
  gas.handleMarkRest({ code: '1234', store: 'st-01', month: '2026-10' }, db);
  assertEqual(db.getCell('新店竹北', 'C11'), '輪休', '(8) 改名後回寫到新分頁');
})();

// (9) 改名：分頁名本來就跟店名不同 → 只改店名、分頁不動
(function () {
  var gas = runner.loadGas();
  var db = freshDb();
  var res = gas.handleRenameStore({ code: '1234', store: 'mzt-gf', name: '墨竹亭光復本店' }, db);
  assertEqual(res, { ok: true, tab_renamed: false }, '(9) 改名成功、分頁不動');
  assertTrue(db.hasTab('光復店'), '(9) 光復店分頁還在');
  assertEqual(db.getRows('門市')[3], ['mzt-gf', '墨竹亭光復本店', '光復店', '啟用'], '(9) 只改店名欄');
})();

// (10) 改名的擋法
(function () {
  var gas = runner.loadGas();
  var db = freshDb();
  assertEqual(gas.handleRenameStore({ code: '5678', store: 'ck', name: 'X' }, db).ok, false, '(10) 主管碼不得改名');
  assertTrue(/已經有/.test(gas.handleRenameStore({ code: '1234', store: 'ck', name: '小辛辣光復' }, db).error), '(10) 撞別家店名擋');
  assertTrue(/已經有/.test(gas.handleRenameStore({ code: '1234', store: 'ck', name: '金山店' }, db).error), '(10) 撞別家分頁名擋');
  assertEqual(gas.handleRenameStore({ code: '1234', store: 'ck', name: '央廚' }, db).error, '名稱沒有變', '(10) 同名不改');
  assertEqual(gas.handleRenameStore({ code: '1234', store: 'ck', name: '' }, db).error, '請填門市名稱', '(10) 空名稱擋');
  assertEqual(gas.handleRenameStore({ code: '1234', store: 'nope', name: 'Y' }, db).ok, false, '(10) 不存在的店代碼擋');
  db.createTab('雜項');
  assertTrue(/分頁/.test(gas.handleRenameStore({ code: '1234', store: 'ck', name: '雜項' }, db).error), '(10) 分頁要跟著改時撞到既有分頁擋');
  assertTrue(!db.hasTab('門市'), '(10) 被擋下時不建門市分頁');
})();

// (7) doPost 白名單有開
(function () {
  var gas = runner.loadGas();
  assertTrue(gas.ACTIONS.indexOf('addStore') !== -1 && gas.ACTIONS.indexOf('setStoreStatus') !== -1 &&
    gas.ACTIONS.indexOf('renameStore') !== -1, '(7) ACTIONS 含三個門市管理動作');
})();

if (failures > 0) {
  console.error('\n' + failures + ' 項測試失敗');
  process.exit(1);
} else {
  console.log('\n全部測試通過');
}
