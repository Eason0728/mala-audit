// 稽核系統 — 一次性匯入腳本（Import.gs，T11）
// setup()／importHistory() 由人在 Apps Script 編輯器手動各執行一次，不走 doPost，
// 不在 ACTIONS 白名單內（見 Code.gs）。同一 GAS 專案內多檔共享全域，本檔直接沿用
// Code.gs 已定義的 TAB_SETTINGS / TAB_ITEMS / TAB_RECORDS / TAB_DETAILS / STORES /
// makeDb_()，不重複宣告、不改 Code.gs。
//
// 架構延續 Code.gs 的兩層拆法：
//   (a) 純函式 setup_(db) / importHistory_(db) / parseAnomalyText(text)：只碰 db 介面
//       或純資料處理，node 假環境（test/gas-import-runner.js）可直接注入記憶體 db 整測。
//   (b) 薄 wrapper setup() / importHistory()：手動執行入口，內部呼叫 makeDb_() 取得
//       真正的 SpreadsheetApp adapter，再委派給對應的 _(db) 版本。
// ──────────────────────────────────────────────────────────────────────

// ---- 顯示分頁固定座標（spec.md §2.1／§5，5 分頁一致：header_row=1、月列 2–13）----
// DISPLAY_COLS 只在 Code.gs 宣告一次，本檔直接沿用同專案全域——不要在這裡再宣告一份，
// 那會變成兩份各自維護的欄位表，改一邊另一邊悄悄失步，而且測試抓不到（兩檔載入同一 context）。
var DISPLAY_HEADER_ROW = 1;
var DISPLAY_FIRST_MONTH_ROW = 2; // 1月 → 列2 … 12月 → 列13
var MIGRATED_HEADER_MARK = '零找金是否正確'; // E1 已是這個字串 → 該分頁已遷移過，跳過

// ---- 新增分頁欄位（spec.md §2.2，逐字元對齊既有測試種子）----
var RECORDS_HEADER = ['record_key', '店代碼', '年月', '狀態', '稽核日期', '抽查數量', '正確數量', '正確率',
  '零找金', '零用金', '小費金額', '小費相符', '異常說明', '備註', '提交時間'];
var DETAILS_HEADER = ['record_key', '店代碼', '年月', '品項', '單位', '盤點數', '複盤數', '判定', '異常原因', '備註'];
var ITEMS_HEADER = ['店代碼', '品項', '單位', '狀態'];
var SETTINGS_DEFAULTS = [
  ['會計通行碼', '請設定'],
  ['主管通行碼', '請設定'],
  ['零找金標準', 10000],
  ['零用金標準', 10000],
  ['異常原因分類', '盤點錯誤（門市盤錯）／損耗未記／單位混淆／進出貨未入帳／其他']
];

// 異常說明單行格式（spec.md §5）：{序號}.{品項}:盤點{盤點數}{單位}，覆盤{複盤數}{單位}
// 容忍變體：缺「盤點」二字、結尾多餘換行/空白。單位＝數字後的非數字尾串（含 kg/公斤等）。
var ANOMALY_LINE_RE = /^(\d+)\.([^:：]+)[:：](?:盤點)?([\d.]+)([^\d，,]+)，覆盤([\d.]+)([^\d，,]+)$/;

// ══════════════════════════════════════════════════════════════════════
// setup()：建四個新分頁＋補齊四個顯示分頁的金庫欄位遷移（可重跑冪等）
// ══════════════════════════════════════════════════════════════════════

// setup_(db) → {ok:true, migrated_tabs:[...]}（純函式，供測試直接注入記憶體 db）
function setup_(db) {
  ensureDataTabs_(db);
  var migratedTabs = [];
  STORES.forEach(function (s) {
    if (s.code === 'sxl-gf') return; // 小辛辣光復店本來就是 9 欄目標格式，不遷移
    if (migrateDisplayTab_(db, s.tab)) migratedTabs.push(s.tab);
  });
  return { ok: true, migrated_tabs: migratedTabs };
}

// setup() — 手動執行入口：Apps Script 編輯器直接選這個函式執行
function setup() {
  return setup_(makeDb_());
}

// ensureDataTabs_(db)：四個新分頁不存在才建＋寫預設內容；已存在的不動
function ensureDataTabs_(db) {
  if (!db.hasTab(TAB_RECORDS)) {
    db.createTab(TAB_RECORDS);
    db.setRows(TAB_RECORDS, [RECORDS_HEADER]);
  }
  if (!db.hasTab(TAB_DETAILS)) {
    db.createTab(TAB_DETAILS);
    db.setRows(TAB_DETAILS, [DETAILS_HEADER]);
  }
  if (!db.hasTab(TAB_ITEMS)) {
    db.createTab(TAB_ITEMS);
    db.setRows(TAB_ITEMS, [ITEMS_HEADER]);
  }
  if (!db.hasTab(TAB_SETTINGS)) {
    db.createTab(TAB_SETTINGS);
    db.setRows(TAB_SETTINGS, SETTINGS_DEFAULTS);
  }

  // 每次都執行（冪等）：把會被試算表誤判成日期的欄位鎖成純文字。
  // 年月 `2026-01`、稽核日期 `2026-08-05`、提交時間 ISO 字串都會被自動轉成 Date，
  // 存進去再讀出來就不是原字串，前端月份比對會全部落空（2026-08-01 實測踩到）。
  // 數值欄（抽查數量／正確數量／正確率／小費金額／盤點數／複盤數）不動，要保持數字。
  if (db.setColumnsText) {
    db.setColumnsText(TAB_RECORDS, ['A', 'C', 'E', 'O']); // record_key／年月／稽核日期／提交時間
    db.setColumnsText(TAB_DETAILS, ['A', 'C']);           // record_key／年月
  }
}

// migrateDisplayTab_(db, tabName) → bool（是否實際執行了遷移；已遷移過回 false）
// 現況 A–E（E=複盤異常說明）→ 把 E 欄 2–13 列內容搬到 I 欄→清 E 欄→寫表頭
// E1=零找金是否正確、F1=零用金是否正確、G1=小費是否正確、H1=小費金額、I1=複盤異常說明。
// 冪等判準：E1 已是「零找金是否正確」就跳過（此時 I 欄已是資料、E 欄已是遷移後欄位，
// 不可重跑，否則會把已清空的 E 欄再次「搬」到 I 欄，洗掉真正的異常說明）。
function migrateDisplayTab_(db, tabName) {
  var e1 = db.getCell(tabName, 'E1');
  if (e1 === MIGRATED_HEADER_MARK) return false;

  for (var row = DISPLAY_FIRST_MONTH_ROW; row <= DISPLAY_FIRST_MONTH_ROW + 11; row++) {
    var oldVal = db.getCell(tabName, 'E' + row);
    db.setCell(tabName, 'I' + row, oldVal == null ? '' : oldVal);
    db.setCell(tabName, 'E' + row, '');
  }
  db.setCell(tabName, 'E1', '零找金是否正確');
  db.setCell(tabName, 'F1', '零用金是否正確');
  db.setCell(tabName, 'G1', '小費是否正確');
  db.setCell(tabName, 'H1', '小費金額');
  db.setCell(tabName, 'I1', '複盤異常說明');
  return true;
}

// ══════════════════════════════════════════════════════════════════════
// importHistory()：把顯示分頁 2026 年 1–7 月既有紀錄匯入資料分頁（可重跑冪等）
// ══════════════════════════════════════════════════════════════════════

// importHistory_(db) → {records, details, fallback, items_added}（純函式）
function importHistory_(db) {
  setup_(db); // 確保 setup 已跑（冪等，不會重複遷移）

  var existingItemKeys = {};
  (db.getRows(TAB_ITEMS) || []).slice(1).forEach(function (r) {
    if (r && r[0] && r[1]) existingItemKeys[r[0] + '|' + r[1]] = true;
  });

  var recordsMap = {};   // record_key -> row(15 欄)
  var detailsByKey = {}; // record_key -> [row(10欄), ...]
  var fallback = [];
  var newItemsList = []; // [店代碼, 品項, 單位, '啟用']
  var addedItemKeys = {};

  STORES.forEach(function (s) {
    for (var month = 1; month <= 12; month++) {
      var row = month + 1; // header_row=1，月列 2–13
      var mm = month < 10 ? '0' + month : String(month);
      var yearMonth = '2026-' + mm;
      var recordKey = s.code + '_' + yearMonth;

      var correctCell = db.getCell(s.tab, DISPLAY_COLS.correct_count + row);

      if (correctCell === '輪休') {
        recordsMap[recordKey] = [
          recordKey, s.code, yearMonth, '輪休', '', '', '', '', '', '', '', '', '', '', ''
        ];
        continue;
      }
      if (typeof correctCell !== 'number') {
        continue; // 空白／游離內容（如金山店 D15）一律跳過，不產紀錄
      }

      var sampleCell = db.getCell(s.tab, DISPLAY_COLS.sample_count + row);
      var sample = typeof sampleCell === 'number' ? sampleCell : (Number(sampleCell) || 0);
      var correct = correctCell;
      var rate = correctRate_(correct, sample);

      var cashChange = db.getCell(s.tab, DISPLAY_COLS.cash_change_correct + row);
      var pettyCash = db.getCell(s.tab, DISPLAY_COLS.petty_cash_correct + row);
      var tipCorrect = db.getCell(s.tab, DISPLAY_COLS.tip_correct + row);
      var tipAmount = db.getCell(s.tab, DISPLAY_COLS.tip_amount + row);
      var anomalyNote = db.getCell(s.tab, DISPLAY_COLS.anomaly_note + row);

      // 金庫欄有值才帶；零找金/零用金照「正確」/「不正確」直接搬；
      // 小費相符映射反向：顯示「正確」→資料「相符」、顯示「不正確」→資料「不相符」。
      var changeFundVal = (cashChange === '正確' || cashChange === '不正確') ? cashChange : '';
      var pettyCashVal = (pettyCash === '正確' || pettyCash === '不正確') ? pettyCash : '';
      var tipAmountVal = (tipAmount !== '' && tipAmount != null) ? tipAmount : '';
      var tipMatchVal = tipCorrect === '正確' ? '相符' : (tipCorrect === '不正確' ? '不相符' : '');
      var anomalyText = anomalyNote == null ? '' : String(anomalyNote);

      recordsMap[recordKey] = [
        recordKey, s.code, yearMonth, '已稽核', '',
        sample, correct, rate,
        changeFundVal, pettyCashVal, tipAmountVal, tipMatchVal,
        anomalyText, '', ''
      ];

      if (anomalyText) {
        var parsed = parseAnomalyText(anomalyText);
        var detailRows = [];
        parsed.items.forEach(function (it) {
          detailRows.push([recordKey, s.code, yearMonth, it.item, it.unit, it.book_qty, it.recount_qty, '異常', '未分類', '']);
          var key = s.code + '|' + it.item;
          if (!existingItemKeys[key] && !addedItemKeys[key]) {
            addedItemKeys[key] = true;
            newItemsList.push([s.code, it.item, it.unit, '啟用']);
          }
        });
        parsed.fallback.forEach(function (line) {
          fallback.push({ store: s.code, month: yearMonth, line: line });
        });
        if (detailRows.length) detailsByKey[recordKey] = detailRows;
      }
    }
  });

  upsertRecords_(db, recordsMap);
  upsertDetails_(db, recordsMap, detailsByKey);
  newItemsList.forEach(function (row) { db.appendRow(TAB_ITEMS, row); });

  var totalDetails = 0;
  Object.keys(detailsByKey).forEach(function (k) { totalDetails += detailsByKey[k].length; });

  return {
    records: Object.keys(recordsMap).length,
    details: totalDetails,
    fallback: fallback,
    items_added: newItemsList.length
  };
}

// importHistory() — 手動執行入口：Apps Script 編輯器直接選這個函式執行
function importHistory() {
  return importHistory_(makeDb_());
}

// correctRate_(correct, sample) → 整數（%值，四捨五入），sample=0 回 0
function correctRate_(correct, sample) {
  if (!sample) return 0;
  return Math.round((correct / sample) * 100);
}

// upsertRecords_(db, recordsMap)：同 record_key 整列取代，其餘既有列保留（重跑冪等）
function upsertRecords_(db, recordsMap) {
  var rows = db.getRows(TAB_RECORDS) || [];
  var header = rows.length ? rows[0] : RECORDS_HEADER;
  var body = rows.slice(1);
  var index = {};
  body.forEach(function (r, i) { if (r && r[0]) index[r[0]] = i; });
  Object.keys(recordsMap).forEach(function (key) {
    if (Object.prototype.hasOwnProperty.call(index, key)) {
      body[index[key]] = recordsMap[key];
    } else {
      index[key] = body.length;
      body.push(recordsMap[key]);
    }
  });
  db.setRows(TAB_RECORDS, [header].concat(body));
}

// upsertDetails_(db, recordsMap, detailsByKey)：本次處理到的 record_key 先刪舊列，
// 有新明細的再寫回（重跑冪等；沒有異常項的 key 就只清空、不補新列）。
function upsertDetails_(db, recordsMap, detailsByKey) {
  var rows = db.getRows(TAB_DETAILS) || [];
  var header = rows.length ? rows[0] : DETAILS_HEADER;
  var body = rows.slice(1);
  var touchedKeys = Object.keys(recordsMap);
  var touchedSet = {};
  touchedKeys.forEach(function (k) { touchedSet[k] = true; });

  body = body.filter(function (r) {
    return !(r && Object.prototype.hasOwnProperty.call(touchedSet, r[0]));
  });
  touchedKeys.forEach(function (key) {
    var newRows = detailsByKey[key];
    if (newRows && newRows.length) body = body.concat(newRows);
  });
  db.setRows(TAB_DETAILS, [header].concat(body));
}

// ══════════════════════════════════════════════════════════════════════
// parseAnomalyText(text)：純函式，spec.md §5 異常說明字串 → 明細項陣列
// ══════════════════════════════════════════════════════════════════════

// parseAnomalyText(text) → {items:[{seq,item,unit,book_qty,recount_qty}], fallback:[原始行字串,...]}
// 逐行解析，容忍缺「盤點」二字、結尾多餘換行/空白；解析失敗的行不中斷其餘行，收進 fallback。
function parseAnomalyText(text) {
  var items = [];
  var fallback = [];
  var raw = text == null ? '' : String(text);
  var lines = raw.split('\n');

  lines.forEach(function (rawLine) {
    var line = rawLine.replace(/^\s+|\s+$/g, '');
    if (!line) return; // 空行（含結尾多餘換行造成的空字串）不算失敗，直接略過

    var m = ANOMALY_LINE_RE.exec(line);
    if (!m) {
      fallback.push(rawLine);
      return;
    }
    items.push({
      seq: Number(m[1]),
      item: m[2],
      book_qty: Number(m[3]),
      unit: m[4],
      recount_qty: Number(m[5])
      // m[6]（覆盤單位）理論上與 m[4] 相同；抽查明細單一單位欄，取盤點單位為準。
    });
  });

  return { items: items, fallback: fallback };
}
