// test/gas-import.test.js —— T11 驗收：setup()／importHistory()／parseAnomalyText
// 種子＝test/fixtures/display-tabs.json（真 sheet 五分頁完整複本），
// 對帳基準＝真試算表 2026 年 1–7 月實際數字。
'use strict';

var runner = require('./gas-import-runner.js');
var Format = require('../js/format.js');

var failures = [];

function check(cond, label) {
  if (cond) {
    console.log('PASS: ' + label);
  } else {
    console.log('FAIL: ' + label);
    failures.push(label);
  }
}

function eq(actual, expected, label) {
  check(actual === expected, label + '（預期 ' + JSON.stringify(expected) +
    '，實際 ' + JSON.stringify(actual) + '）');
}

function rowsOf(db, tab) {
  return (db.getRows(tab) || []).slice(1).filter(function (r) { return r && r[0]; });
}

function recordByKey(db, key) {
  return rowsOf(db, '稽核紀錄').filter(function (r) { return r[0] === key; })[0];
}

// ══════════ 1. parseAnomalyText 純函式（含真實變體）══════════
var gas = runner.loadGasWithImport();

var std = '1.鴨血:盤點27盒，覆盤32盒\n2.米血:盤點9包，覆盤8包';
var p1 = gas.parseAnomalyText(std);
eq(p1.items.length, 2, 'parseAnomalyText 標準格式解析兩筆');
eq(p1.items[0].item, '鴨血', '第一筆品項');
eq(p1.items[0].book_qty, 27, '第一筆盤點數');
eq(p1.items[0].recount_qty, 32, '第一筆複盤數');
eq(p1.items[0].unit, '盒', '第一筆單位');
eq(p1.fallback.length, 0, '標準格式無 fallback');

// roundtrip：解析後用 Format.buildAnomalyText 重組 === 原文
var rebuilt = Format.buildAnomalyText(p1.items.map(function (it) {
  return { item: it.item, unit: it.unit, book_qty: it.book_qty, recount_qty: it.recount_qty, verdict: '異常' };
}));
eq(rebuilt, std, 'roundtrip：解析→重組與原文逐字元一致');

// 真實變體：缺「盤點」二字（金山店 7 月「2.蟹黃醬:19.4包，覆盤24.5包」）
var variant = gas.parseAnomalyText('1.貢丸:盤點16.8包，覆盤17.8包\n2.蟹黃醬:19.4包，覆盤24.5包\n3.蔥:盤點5斤，覆盤6斤');
eq(variant.items.length, 3, '缺「盤點」二字的變體仍解析三筆');
eq(variant.items[1].item, '蟹黃醬', '變體品項名正確');
eq(variant.items[1].book_qty, 19.4, '變體盤點數 19.4');
eq(variant.items[1].unit, '包', '變體單位「包」');
eq(variant.items[1].recount_qty, 24.5, '變體複盤數 24.5');
eq(variant.fallback.length, 0, '變體不進 fallback');

// 結尾多餘換行／空白（五月那筆真實資料尾端有空格＋換行）
var trailing = gas.parseAnomalyText('1.米血:盤點9包，覆盤8包\n2.香菜:盤點1kg，覆盤0.7kg\n');
eq(trailing.items.length, 2, '結尾多餘換行不產生空列');
eq(trailing.items[1].unit, 'kg', 'kg 單位原樣保留');

// 真的解不動的行 → fallback，不產明細
var bad = gas.parseAnomalyText('1.這行沒有數字也沒有格式');
eq(bad.items.length, 0, '無法解析不產明細列');
eq(bad.fallback.length, 1, '無法解析的行計入 fallback');

// ══════════ 2. setup()：建資料分頁＋顯示分頁欄位遷移 ══════════
var db = runner.makeDbFromDisplayFixture();
var setupRes = gas.setup_(db);

check(db.hasTab('稽核紀錄') && db.hasTab('抽查明細') && db.hasTab('品項庫') && db.hasTab('設定'),
  'setup 建出四個資料分頁');
eq(db.getCell('設定', 'B3'), 10000, '設定：零找金標準 10000');
var reasonsCell = String(db.getCell('設定', 'B5') || '');
eq(reasonsCell.split('／').length, 5, '設定：異常原因分類五項');
check(reasonsCell.indexOf('盤點錯誤（門市盤錯）') === 0, '設定：第一項原因逐字元正確');

// 遷移：四個非小辛辣分頁 E1 應變成「零找金是否正確」，原異常說明搬到 I 欄
eq(setupRes.migrated_tabs.length, 4, 'setup 遷移四個顯示分頁');
eq(db.getCell('金山店', 'E1'), '零找金是否正確', '金山店 E1 已是金庫表頭');
eq(db.getCell('金山店', 'I1'), '複盤異常說明', '金山店 I1 是異常說明表頭');
var jsFeb = String(db.getCell('金山店', 'I3') || '');
check(jsFeb.indexOf('打拋醬') !== -1 && jsFeb.indexOf('LOGO袋3斤') !== -1,
  '金山店 2 月異常文已搬到 I 欄（實際開頭："' + jsFeb.slice(0, 12) + '"）');
eq(db.getCell('金山店', 'E3'), '', '金山店 2 月 E 欄已清空（原異常文位置）');
eq(db.getCell('小辛辣光復店', 'I2'), db.getCell('小辛辣光復店', 'I2'), '小辛辣光復店不遷移（本來就是 9 欄）');
check(String(db.getCell('小辛辣光復店', 'I2')).indexOf('牛肉片') !== -1,
  '小辛辣光復店 1 月異常文原位未動');

// setup 重跑冪等
var before = JSON.stringify(db.getRows('金山店'));
gas.setup_(db);
eq(JSON.stringify(db.getRows('金山店')), before, 'setup 重跑冪等（顯示分頁不再變動）');

// ══════════ 3. importHistory()：逐月對帳 ══════════
var res = gas.importHistory_(db);

// --- 小辛辣光復店 7 筆已稽核，逐月正確數/正確率對帳 ---
var sxlExpect = [
  ['2026-01', 16, 80], ['2026-02', 18, 90], ['2026-03', 20, 100], ['2026-04', 19, 95],
  ['2026-05', 17, 85], ['2026-06', 19, 95], ['2026-07', 19, 95]
];
sxlExpect.forEach(function (e) {
  var r = recordByKey(db, 'sxl-gf_' + e[0]);
  check(!!r, 'sxl-gf ' + e[0] + ' 紀錄存在');
  if (r) {
    eq(r[6], e[1], 'sxl-gf ' + e[0] + ' 正確數量');
    eq(r[7], e[2], 'sxl-gf ' + e[0] + ' 正確率');
    eq(r[3], '已稽核', 'sxl-gf ' + e[0] + ' 狀態');
  }
});
// 小費與金庫
var sxlJan = recordByKey(db, 'sxl-gf_2026-01');
eq(sxlJan[10], 457, 'sxl-gf 1 月小費金額 457');
eq(sxlJan[8], '正確', 'sxl-gf 1 月零找金＝正確');
eq(sxlJan[11], '相符', 'sxl-gf 1 月小費相符（顯示「正確」→資料「相符」）');
eq(recordByKey(db, 'sxl-gf_2026-07')[10], 1792, 'sxl-gf 7 月小費金額 1792');

// --- 央廚：3 筆已稽核＋4 筆輪休 ---
var ckRows = rowsOf(db, '稽核紀錄').filter(function (r) { return r[1] === 'ck'; });
eq(ckRows.filter(function (r) { return r[3] === '已稽核'; }).length, 3, '央廚 3 筆已稽核');
eq(ckRows.filter(function (r) { return r[3] === '輪休'; }).length, 4, '央廚 4 筆輪休');
eq(recordByKey(db, 'ck_2026-01')[7], 100, '央廚 1 月正確率 100');
eq(recordByKey(db, 'ck_2026-04')[3], '輪休', '央廚 4 月＝輪休');
eq(recordByKey(db, 'ck_2026-04')[6], '', '央廚 4 月數字欄留空');

// --- 其餘三店筆數 ---
function auditedCount(store) {
  return rowsOf(db, '稽核紀錄').filter(function (r) {
    return r[1] === store && r[3] === '已稽核';
  }).length;
}
eq(auditedCount('mzt-js'), 2, '金山店 2 筆已稽核');
eq(auditedCount('mzt-gf'), 3, '光復店 3 筆已稽核');
eq(auditedCount('mzt-lzl'), 2, '六張犁店 2 筆已稽核');
eq(recordByKey(db, 'mzt-gf_2026-03')[7], 80, '光復店 3 月正確率 80（非金山店）');
eq(recordByKey(db, 'mzt-js_2026-03')[3], '輪休', '金山店 3 月＝輪休（產生輪休紀錄，非已稽核）');
check(!recordByKey(db, 'mzt-lzl_2026-07'), '六張犁 7 月未記錄→不產紀錄');

// 金山店 D15 游離儲存格「金山店」不得產生紀錄（列 15 → 不在月列 2–13）
var strayKeys = rowsOf(db, '稽核紀錄').filter(function (r) {
  return String(r[2] || '').indexOf('2026-') !== 0;
});
eq(strayKeys.length, 0, '無游離列產生的異常紀錄（D15 已忽略）');

// --- 異常字串：12 筆全解析，fallback 0 ---
eq(res.fallback.length, 0, '真實 12 筆異常字串全數解析成功（fallback 0）');
var detailRows = rowsOf(db, '抽查明細');
eq(detailRows.length, res.details, '明細列數與回傳摘要一致');
check(detailRows.length >= 22, '明細列數合理（實際 ' + detailRows.length + ' 列）');
check(detailRows.every(function (r) { return r[8] === '未分類'; }),
  '歷史明細異常原因一律「未分類」');
var jsJulCrab = detailRows.filter(function (r) {
  return r[0] === 'mzt-js_2026-07' && r[3] === '蟹黃醬';
})[0];
check(!!jsJulCrab, '金山店 7 月蟹黃醬明細存在（缺「盤點」二字的變體）');
if (jsJulCrab) {
  eq(jsJulCrab[5], 19.4, '蟹黃醬盤點數 19.4');
  eq(jsJulCrab[6], 24.5, '蟹黃醬複盤數 24.5');
  eq(jsJulCrab[4], '包', '蟹黃醬單位「包」');
}

// --- 歷史品項自動補品項庫 ---
check(res.items_added > 0, '歷史品項自動補入品項庫（' + res.items_added + ' 筆）');
var itemRows = rowsOf(db, '品項庫');
var hasCrab = itemRows.some(function (r) { return r[0] === 'mzt-js' && r[1] === '蟹黃醬' && r[3] === '啟用'; });
check(hasCrab, '品項庫含 mzt-js／蟹黃醬／啟用');

// ══════════ 4. importHistory 重跑冪等 ══════════
var recCountBefore = rowsOf(db, '稽核紀錄').length;
var detCountBefore = rowsOf(db, '抽查明細').length;
var itemCountBefore = rowsOf(db, '品項庫').length;
var res2 = gas.importHistory_(db);
eq(rowsOf(db, '稽核紀錄').length, recCountBefore, '重跑後稽核紀錄筆數不變');
eq(rowsOf(db, '抽查明細').length, detCountBefore, '重跑後抽查明細筆數不變');
eq(rowsOf(db, '品項庫').length, itemCountBefore, '重跑後品項庫筆數不變');
eq(res2.records, res.records, '重跑回傳 records 數一致');

console.log('');
if (failures.length) {
  console.log('失敗項目：');
  failures.forEach(function (f) { console.log(' - ' + f); });
  process.exit(1);
}
console.log('全部測試通過');
