// node test/gas-submit.test.js —— T10 驗收：Code.gs submitAudit／markRest／顯示分頁回寫
// 零依賴、直跑、失敗時 process.exit(1)。載入方式見 test/gas-runner.js（vm 假環境，不部署）。
// 顯示分頁種子：五分頁一律用目標欄位配置 A–I（同小辛辣光復店現況；spec.md §2.1 T8 定案），
// 不依賴 setup()、自行補表頭（其餘四分頁上線前才由 setup() 補欄，這裡測試先補齊）。

'use strict';

var runner = require('./gas-runner.js');
var Format = require('../js/format.js');

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

// ── 種子資料 ─────────────────────────────────────────────────────────

var REASONS_RAW = '盤點錯誤（門市盤錯）／損耗未記／單位混淆／進出貨未入帳／其他';
var DISPLAY_HEADER = [
  '月份', '盤點抽查數量', '複盤正確數量', '正確率',
  '零找金是否正確', '零用金是否正確', '小費是否正確', '小費金額', '複盤異常說明'
];
var MONTH_LABELS = ['一月', '二月', '三月', '四月', '五月', '六月', '七月', '八月', '九月', '十月', '十一月', '十二月'];

// 目標欄位配置 A–I 的一張顯示分頁：12 個月列，未稽核月份維持「已知未稽核」的初始狀態
// （B=20 預設抽查數、C/H/I 空白、D=0、E/F/G=正確，同 test/fixtures/display-tabs.json 未稽核月份樣式）
function buildDisplayTab() {
  var rows = [DISPLAY_HEADER];
  MONTH_LABELS.forEach(function (label) {
    rows.push([label, 20, '', 0, '正確', '正確', '正確', '', '']);
  });
  return rows;
}

function seedTabs() {
  return {
    設定: [
      ['會計通行碼', '1234'],
      ['主管通行碼', '5678'],
      ['零找金標準', '10000'],
      ['零用金標準', '10000'],
      ['異常原因分類', REASONS_RAW]
    ],
    稽核紀錄: [
      ['record_key', '店代碼', '年月', '狀態', '稽核日期', '抽查數量', '正確數量', '正確率',
        '零找金', '零用金', '小費金額', '小費相符', '異常說明', '備註', '提交時間']
    ],
    抽查明細: [
      ['record_key', '店代碼', '年月', '品項', '單位', '盤點數', '複盤數', '判定', '異常原因', '備註']
    ],
    小辛辣光復店: buildDisplayTab(),
    央廚: buildDisplayTab(),
    光復店: buildDisplayTab(),
    金山店: buildDisplayTab(),
    六張犁店: buildDisplayTab()
  };
}

function freshDb() {
  return runner.makeMemoryDb(seedTabs());
}

var gas = runner.loadGas();

// 20 筆抽查明細：18 正確 + 2 異常（鴨血/米血，同 spec §5 buildAnomalyText 範例）
function buildDetails20(recordKey, store, month) {
  var details = [];
  var anomalyPair = [
    { item: '鴨血', unit: '盒', book_qty: 27, recount_qty: 32, verdict: '異常', reason: '進出貨未入帳', note: '' },
    { item: '米血', unit: '包', book_qty: 9, recount_qty: 8, verdict: '異常', reason: '盤點錯誤（門市盤錯）', note: '' }
  ];
  for (var i = 0; i < 18; i++) {
    details.push({
      item: '品項' + i, unit: '包', book_qty: 10, recount_qty: 10, verdict: '正確', reason: '', note: ''
    });
  }
  details = details.concat(anomalyPair);
  return details.map(function (d) {
    return Object.assign({ record_key: recordKey, store: store, month: month }, d);
  });
}

var anomalyDetails = [
  { item: '鴨血', unit: '盒', book_qty: 27, recount_qty: 32, verdict: '異常' },
  { item: '米血', unit: '包', book_qty: 9, recount_qty: 8, verdict: '異常' }
];
var expectedAnomalyText = Format.buildAnomalyText(anomalyDetails);

function baseRecord(overrides) {
  var r = {
    record_key: 'sxl-gf_2026-08', store: 'sxl-gf', month: '2026-08', status: '已稽核',
    audit_date: '2026-08-05', sample_count: 20, correct_count: 19, correct_rate: 95,
    change_fund: '正確', petty_cash: '正確', tip_amount: 800, tip_match: '相符',
    anomaly_text: expectedAnomalyText, note: '', submitted_at: '2026-08-05T10:32:00+08:00'
  };
  for (var k in overrides) r[k] = overrides[k];
  return r;
}

// ============================================================
// 1. submitAudit 正常路徑：sxl-gf_2026-08，19/20，小費 800 相符，2 筆異常
// ============================================================
(function () {
  var db = freshDb();
  var record = baseRecord({});
  var details = buildDetails20('sxl-gf_2026-08', 'sxl-gf', '2026-08');

  var res = gas.handleSubmitAudit({ code: '1234', record: record, details: details }, db);
  assertEqual(res, { ok: true, record_key: 'sxl-gf_2026-08' }, 'submitAudit 正常路徑 ok:true');

  var records = gas.readRecords_(db);
  var rec = records.filter(function (r) { return r.record_key === 'sxl-gf_2026-08'; })[0];
  assertTrue(!!rec, '稽核紀錄有該筆');
  assertEqual(rec.correct_count, 19, '稽核紀錄 correct_count=19');

  var storedDetails = gas.readDetails_(db).filter(function (d) { return d.record_key === 'sxl-gf_2026-08'; });
  assertEqual(storedDetails.length, 20, '抽查明細 20 列');

  var tabRows = db.getRows('小辛辣光復店');
  var row9 = tabRows[8]; // 0-based：第 9 列（月列=2–13，8 月=第 9 列）
  assertEqual(row9[2], 19, '顯示分頁列9 C=19');
  assertEqual(row9[3], '=C9/B9', "顯示分頁列9 D==='=C9/B9'");
  assertEqual(row9[6], '正確', '顯示分頁列9 G=正確（小費相符→正確）');
  assertEqual(row9[7], 800, '顯示分頁列9 H=800');
  assertEqual(row9[8], expectedAnomalyText, '顯示分頁列9 I 與 buildAnomalyText 結果一致');

  // ── 2. 同 key 重送（改 18/20）→ 紀錄不增列、C=18、明細舊列消失 ──
  var recordCountBefore = gas.readRecords_(db).length;
  var record2 = baseRecord({ correct_count: 18, correct_rate: 90 });
  var details2 = [{
    record_key: 'sxl-gf_2026-08', store: 'sxl-gf', month: '2026-08',
    item: '測試品項', unit: '包', book_qty: 5, recount_qty: 4, verdict: '異常',
    reason: '未分類', note: ''
  }];
  var res2 = gas.handleSubmitAudit({ code: '1234', record: record2, details: details2 }, db);
  assertEqual(res2.ok, true, '同 key 重送 ok:true');

  var recordCountAfter = gas.readRecords_(db).length;
  assertEqual(recordCountAfter, recordCountBefore, '同 key 重送：紀錄不增列');

  var recAfter = gas.readRecords_(db).filter(function (r) { return r.record_key === 'sxl-gf_2026-08'; })[0];
  assertEqual(recAfter.correct_count, 18, '同 key 重送：紀錄 C=18');

  var tabRowsAfter = db.getRows('小辛辣光復店');
  assertEqual(tabRowsAfter[8][2], 18, '同 key 重送：顯示分頁列9 C=18');

  var oldDetails = gas.readDetails_(db).filter(function (d) {
    return d.record_key === 'sxl-gf_2026-08' && d.item === '品項0';
  });
  assertEqual(oldDetails.length, 0, '同 key 重送：明細舊列消失');
  var newDetails = gas.readDetails_(db).filter(function (d) {
    return d.record_key === 'sxl-gf_2026-08' && d.item === '測試品項';
  });
  assertEqual(newDetails.length, 1, '同 key 重送：明細新列存在');
})();

// ============================================================
// 3. markRest ck 2026-08 → 央廚 列9 C=輪休 D=''，B 保留原值
// ============================================================
(function () {
  var db = freshDb();
  var res = gas.handleMarkRest({ code: '1234', store: 'ck', month: '2026-08' }, db);
  assertEqual(res, { ok: true }, 'markRest ok:true');

  var tabRows = db.getRows('央廚');
  var row9 = tabRows[8];
  assertEqual(row9[2], '輪休', '央廚 列9 C=輪休');
  assertEqual(row9[3], '', "央廚 列9 D=''");
  assertEqual(row9[1], 20, '央廚 列9 B 保留原值');
  assertEqual(row9[6], '', '央廚 列9 G 清空');
  assertEqual(row9[7], '', '央廚 列9 H 清空');
  assertEqual(row9[8], '', '央廚 列9 I 清空');

  var rec = gas.readRecords_(db).filter(function (r) { return r.record_key === 'ck_2026-08'; })[0];
  assertTrue(!!rec, '稽核紀錄有 ck_2026-08 該筆');
  assertEqual(rec.status, '輪休', '稽核紀錄 status=輪休');
})();

// ============================================================
// 3b. 送出路徑必須鎖住年月等欄位的文字格式
//     （doPost 不經過 setup()，漏掉的話新紀錄的年月會被試算表存成 Date——2026-08-01 實測踩過）
// ============================================================
(function () {
  var db = freshDb();
  var record = baseRecord({});
  var details = buildDetails20('sxl-gf_2026-08', 'sxl-gf', '2026-08');
  gas.handleSubmitAudit({ record: record, details: details }, db);
  var rec = db._textCols['稽核紀錄'] || [];
  var det = db._textCols['抽查明細'] || [];
  ['A', 'C', 'E', 'O'].forEach(function (c) {
    assertEqual(rec.indexOf(c) !== -1, true, 'submitAudit 鎖稽核紀錄 ' + c + ' 欄為文字');
  });
  ['A', 'C'].forEach(function (c) {
    assertEqual(det.indexOf(c) !== -1, true, 'submitAudit 鎖抽查明細 ' + c + ' 欄為文字');
  });

  var db2 = freshDb();
  gas.handleMarkRest({ store: 'ck', month: '2026-08' }, db2);
  assertEqual((db2._textCols['稽核紀錄'] || []).indexOf('C') !== -1, true,
    'markRest 也鎖稽核紀錄 C 欄為文字');
})();

// ============================================================
// 4. 權限：現行設定不需通行碼 → 任何人都能送出；開關切回 true 時主管碼仍被擋
// ============================================================
(function () {
  var db = freshDb();
  var record = baseRecord({});
  var details = buildDetails20('sxl-gf_2026-08', 'sxl-gf', '2026-08');
  var res = gas.handleSubmitAudit({ record: record, details: details }, db);
  assertEqual(res.ok, true, '不帶碼 submitAudit 成功（不需通行碼設定）');

  var res2 = gas.handleMarkRest({ store: 'ck', month: '2026-08' }, db);
  assertEqual(res2.ok, true, '不帶碼 markRest 成功');
})();

(function () {
  var g = runner.loadGas();  // 全新 sandbox
  g.REQUIRE_PASSCODE = true;
  var db = freshDb();
  var record = baseRecord({});
  var details = buildDetails20('sxl-gf_2026-08', 'sxl-gf', '2026-08');
  assertEqual(g.handleSubmitAudit({ code: '5678', record: record, details: details }, db).ok, false,
    '開關開啟：主管碼 submitAudit 拒收');
  assertEqual(g.handleMarkRest({ code: '5678', store: 'ck', month: '2026-08' }, db).ok, false,
    '開關開啟：主管碼 markRest 拒收');
  assertEqual(g.handleSubmitAudit({ code: '1234', record: record, details: details }, db).ok, true,
    '開關開啟：會計碼 submitAudit 成功');
})();

// ============================================================
// 5. 驗證：record_key 亂格式／未知店代碼／非法枚舉 三種拒收
// ============================================================
(function () {
  var db = freshDb();

  // record_key 亂格式（用連字號取代底線，與 store_month 不一致）
  var badKey = baseRecord({ record_key: 'sxl-gf-2026-08' });
  var resBadKey = gas.handleSubmitAudit({ code: '1234', record: badKey, details: [] }, db);
  assertEqual(resBadKey.ok, false, 'record_key 亂格式拒收');
  assertTrue(!!resBadKey.error, 'record_key 亂格式附錯誤訊息');

  // 未知店代碼
  var badStore = baseRecord({ store: 'xx-yy', record_key: 'xx-yy_2026-08' });
  var resBadStore = gas.handleSubmitAudit({ code: '1234', record: badStore, details: [] }, db);
  assertEqual(resBadStore.ok, false, '未知店代碼拒收');
  assertTrue(!!resBadStore.error, '未知店代碼附錯誤訊息');

  // 非法枚舉（狀態值不合法）
  var badEnum = baseRecord({ status: '已審核' });
  var resBadEnum = gas.handleSubmitAudit({ code: '1234', record: badEnum, details: [] }, db);
  assertEqual(resBadEnum.ok, false, '非法枚舉（狀態）拒收');
  assertTrue(!!resBadEnum.error, '非法枚舉附錯誤訊息');

  // 非法枚舉（金庫值不合法）
  var badCash = baseRecord({ change_fund: '不知道' });
  var resBadCash = gas.handleSubmitAudit({ code: '1234', record: badCash, details: [] }, db);
  assertEqual(resBadCash.ok, false, '非法枚舉（零找金）拒收');

  // 不合法送出後，資料未被寫入（拒收整筆）
  var recordsAfter = gas.readRecords_(db);
  assertEqual(recordsAfter.length, 0, '拒收整筆：稽核紀錄未增列');
})();

// ============================================================
// 6. details 中 record_key 不一致拒收
// ============================================================
(function () {
  var db = freshDb();
  var record = baseRecord({});
  var details = buildDetails20('sxl-gf_2026-08', 'sxl-gf', '2026-08');
  details[5].record_key = 'sxl-gf_2026-07'; // 混入不一致的一列
  var res = gas.handleSubmitAudit({ code: '1234', record: record, details: details }, db);
  assertEqual(res.ok, false, 'details record_key 不一致拒收');
  assertTrue(!!res.error, 'details record_key 不一致附錯誤訊息');

  var recordsAfter = gas.readRecords_(db);
  assertEqual(recordsAfter.length, 0, 'details 不一致拒收：稽核紀錄未增列');
})();

// ============================================================
// 7. 小費不相符 → 顯示分頁 G 映射為「不正確」
// ============================================================
(function () {
  var db = freshDb();
  var record = baseRecord({
    record_key: 'ck_2026-09', store: 'ck', month: '2026-09',
    tip_match: '不相符', anomaly_text: ''
  });
  var res = gas.handleSubmitAudit({ code: '1234', record: record, details: [] }, db);
  assertEqual(res.ok, true, '小費不相符送出 ok:true');

  var tabRows = db.getRows('央廚');
  var row10 = tabRows[9]; // 9 月＝第 10 列
  assertEqual(row10[6], '不正確', '顯示分頁 G：小費不相符→不正確');
})();

// ============================================================
// 8. doPost 整合：白名單擴充後仍可走通，既有行為不受影響
// ============================================================
(function () {
  var db = freshDb();
  var gasForDoPost = runner.loadGas();
  gasForDoPost.makeDb_ = function () { return db; };

  var record = baseRecord({});
  var details = buildDetails20('sxl-gf_2026-08', 'sxl-gf', '2026-08');
  var submitRes = runner.parseResponse(gasForDoPost.doPost(
    runner.makePostEvent({ action: 'submitAudit', code: '1234', record: record, details: details })
  ));
  assertEqual(submitRes.ok, true, 'doPost submitAudit 正常路徑');

  var restRes = runner.parseResponse(gasForDoPost.doPost(
    runner.makePostEvent({ action: 'markRest', code: '1234', store: 'ck', month: '2026-08' })
  ));
  assertEqual(restRes.ok, true, 'doPost markRest 正常路徑');

  var unknownRes = runner.parseResponse(gasForDoPost.doPost(
    runner.makePostEvent({ action: 'deleteAll', code: '1234' })
  ));
  assertTrue(unknownRes.ok === false, 'doPost 未知 action 仍拒收（白名單擴充未破壞既有行為）');
})();

if (failures > 0) {
  console.error('\n' + failures + ' 項測試失敗');
  process.exit(1);
} else {
  console.log('\n全部測試通過');
}
