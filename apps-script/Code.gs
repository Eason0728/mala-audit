// 稽核系統 — Apps Script 後端（Code.gs）
// 部署帳號：madesiaosinla@gmail.com（container-bound，綁「2026年月初盤點及金庫抽查明細表」）
//
// ── db 介面（T9 定案，T10/T11 沿用；不得變更簽章）──────────────────────────
//   db.getRows(tabName)              → Array<Array>（含表頭列；空分頁回 []）
//   db.setRows(tabName, rows)        （整分頁覆寫）
//   db.appendRow(tabName, row)
//   db.setCell(tabName, a1, value)   （value 若以 '=' 開頭寫入公式）
//   db.getCell(tabName, a1)          → value
//   db.hasTab(tabName)               → bool
//   db.createTab(tabName)
//
// 分兩層：
//   (a) 純函式 handler：handleAuth / handleGetAll / handleSubmitAudit / handleMarkRest
//       （T10 加入後兩者）——只碰 db 介面，禁止直接呼叫 SpreadsheetApp，node 假環境才能整測。
//   (b) 薄 adapter makeDb_()：唯一允許出現 SpreadsheetApp 呼叫的地方，把 Sheet 包成 db 介面。
// ──────────────────────────────────────────────────────────────────────

// ---- 新增分頁（資料正本）分頁名常數 ----
var TAB_SETTINGS = '設定';
var TAB_ITEMS = '品項庫';
var TAB_RECORDS = '稽核紀錄';
var TAB_DETAILS = '抽查明細';

// ---- 店代碼表（spec.md §5，逐字元對應既有分頁名，不看順序）----
var STORES = [
  { code: 'sxl-gf', name: '小辛辣光復', tab: '小辛辣光復店' },
  { code: 'ck', name: '央廚', tab: '央廚' },
  { code: 'mzt-gf', name: '墨竹亭光復', tab: '光復店' },
  { code: 'mzt-js', name: '墨竹亭金山', tab: '金山店' },
  { code: 'mzt-lzl', name: '墨竹亭六張犁', tab: '六張犁店' }
];

// ---- doPost 白名單（T9 開放 auth/getAll；T10 加入 submitAudit/markRest）----
var ACTIONS = ['auth', 'getAll', 'submitAudit', 'markRest'];

// ---- T10：顯示分頁目標欄位配置（五分頁一律 A–I，同小辛辣光復店現況；spec.md §2.1）----
var DISPLAY_COLS = {
  month: 'A', sample_count: 'B', correct_count: 'C', correct_rate: 'D',
  cash_change_correct: 'E', petty_cash_correct: 'F', tip_correct: 'G',
  tip_amount: 'H', anomaly_note: 'I'
};

// ---- 通行碼開關（見 resolveRole_；與 js/config.js 的 REQUIRE_PASSCODE 必須一致）----
// 2026-08-01 Eason 指示上鎖：通行碼存在試算表「設定」分頁，不進程式碼／repo。
var REQUIRE_PASSCODE = true;

// ---- 枚舉（spec.md §5，逐字元，禁止同義詞）----
var STATUS_VALUES = ['已稽核', '輪休'];
var CASH_VALUES = ['正確', '不正確'];
var TIP_MATCH_VALUES = ['相符', '不相符'];
var VERDICT_VALUES = ['正確', '異常'];

// ── 一次性初始化（放在 Code.gs 最上方，因為編輯器預設開這個檔、
//    函式下拉只列出目前檔案的函式；setup／importHistory 本體在 Import.gs）──
// 由 Eason 在 Apps Script 編輯器手動執行一次：完成帳號授權 ＋ 建資料分頁 ＋ 匯入 1–7 月歷史。
// 兩個步驟都可重複執行（冪等），跑第二次不會重複寫入。
function 初始化稽核系統() {
  var a = setup();
  var b = importHistory();
  var msg = '初始化完成｜遷移分頁 ' + (a.migrated_tabs || []).join('、') +
    '｜匯入紀錄 ' + b.records + ' 筆、明細 ' + b.details + ' 筆、補品項 ' + b.items_added +
    ' 筆、解析失敗 ' + (b.fallback || []).length + ' 行';
  Logger.log(msg);
  return msg;
}

// ── doPost 入口 ──────────────────────────────────────────────────────
function doPost(e) {
  var payload;
  try {
    var raw = e && e.postData && e.postData.contents;
    payload = JSON.parse(raw);
  } catch (err) {
    return respond_({ ok: false, error: '請求格式錯誤' });
  }
  if (!payload || typeof payload !== 'object') {
    return respond_({ ok: false, error: '請求格式錯誤' });
  }

  var action = payload.action;
  if (ACTIONS.indexOf(action) === -1) {
    return respond_({ ok: false, error: '不支援的操作：' + action });
  }

  var db = makeDb_();
  var result;
  if (action === 'auth') {
    result = handleAuth(payload, db);
  } else if (action === 'getAll') {
    result = handleGetAll(payload, db);
  } else if (action === 'submitAudit') {
    result = handleSubmitAudit(payload, db);
  } else if (action === 'markRest') {
    result = handleMarkRest(payload, db);
  }
  return respond_(result);
}

function respond_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

// ── handler：純函式，只碰 db 介面 ────────────────────────────────────

// handleAuth({code}, db) → {ok:true, role} | {ok:false, error}
function handleAuth(payload, db) {
  var code = payload && payload.code;
  var role = resolveRole_(code, db);
  if (!role) {
    return { ok: false, error: '通行碼錯誤' };
  }
  return { ok: true, role: role };
}

// handleGetAll({code}, db) → {ok:true, config, items, records, details} | {ok:false, error}
function handleGetAll(payload, db) {
  var code = payload && payload.code;
  var role = resolveRole_(code, db);
  if (!role) {
    return { ok: false, error: '通行碼錯誤' };
  }

  var settings = readSettings_(db);
  var config = {
    reasons: settings.reasonsRaw ? settings.reasonsRaw.split('／') : [],
    change_fund_std: settings.changeFundStd,
    petty_cash_std: settings.pettyCashStd,
    stores: STORES.map(function (s, i) {
      return { code: s.code, name: s.name, order: i + 1 };
    }),
    accountant_ok: role === 'accountant'
  };

  return {
    ok: true,
    config: config,
    items: readItems_(db),
    records: readRecords_(db),
    details: readDetails_(db)
  };
}

// handleSubmitAudit({code, record, details}, db) → {ok:true, record_key} | {ok:false, error}
// 覆蓋語意：稽核紀錄同 record_key 整列取代（無則 append）；抽查明細先刪該 key 全部列再寫入；
// 再回寫顯示分頁（spec.md §2.1/§2.2/§4）。三步同一次執行完成，不合法整筆拒收。
function handleSubmitAudit(payload, db) {
  var code = payload && payload.code;
  var role = resolveRole_(code, db);
  if (role !== 'accountant') {
    return { ok: false, error: '無權限（僅會計可送出稽核）' };
  }

  var record = payload.record;
  var details = payload.details || [];

  var recordErr = validateRecord_(record);
  if (recordErr) {
    return { ok: false, error: recordErr };
  }
  var detailsErr = validateDetails_(details, record.record_key);
  if (detailsErr) {
    return { ok: false, error: detailsErr };
  }

  ensureTextColumns_(db);
  upsertRecord_(db, record);
  replaceDetails_(db, record.record_key, details);
  writeDisplayTabAudited_(db, record);

  return { ok: true, record_key: record.record_key };
}

// handleMarkRest({code, store, month}, db) → {ok:true} | {ok:false, error}
// 稽核紀錄寫/覆蓋一筆 status=輪休（數字欄空字串）；回寫顯示分頁 C=輪休、D–I 清空、B 保留原值。
function handleMarkRest(payload, db) {
  var code = payload && payload.code;
  var role = resolveRole_(code, db);
  if (role !== 'accountant') {
    return { ok: false, error: '無權限（僅會計可標記輪休）' };
  }

  var store = payload && payload.store;
  var month = payload && payload.month;
  if (!storeByCode_(store)) {
    return { ok: false, error: '店代碼不存在：' + store };
  }
  if (!/^\d{4}-\d{2}$/.test(String(month))) {
    return { ok: false, error: '年月格式錯誤：' + month };
  }

  ensureTextColumns_(db);
  var key = store + '_' + month;
  var now = nowISO_();
  var record = {
    record_key: key, store: store, month: month, status: '輪休',
    audit_date: now.slice(0, 10), sample_count: '', correct_count: '', correct_rate: '',
    change_fund: '', petty_cash: '', tip_amount: '', tip_match: '',
    anomaly_text: '', note: '', submitted_at: now
  };
  upsertRecord_(db, record);
  writeDisplayTabRest_(db, store, month);

  return { ok: true };
}

// ── 內部工具：只碰 db 介面 ───────────────────────────────────────────

// resolveRole_(code, db) → 'accountant' | 'viewer' | null（不合法一律 null，不洩漏通行碼比對細節）
// 每次寫入前把「會被試算表誤判成日期」的欄位鎖成純文字。
// 不能只在 Import.gs 的 setup() 做：doPost 的送出路徑不會經過 setup，
// 漏掉的話新送出的紀錄年月又會變成 Date，前端月份比對就落空（2026-08-01 實測踩到兩次）。
function ensureTextColumns_(db) {
  if (!db.setColumnsText) return;
  db.setColumnsText(TAB_RECORDS, ['A', 'C', 'E', 'O']); // record_key／年月／稽核日期／提交時間
  db.setColumnsText(TAB_DETAILS, ['A', 'C']);           // record_key／年月
}

function resolveRole_(code, db) {
  // REQUIRE_PASSCODE=false 時任何人皆為會計（免登入）；目前為 true＝需通行碼。
  // 通行碼讀自「設定」分頁；主管通行碼留空＝停用該角色（單一密碼、全權限）。
  if (!REQUIRE_PASSCODE) return 'accountant';
  if (!code) return null;
  var settings = readSettings_(db);
  if (settings.accountantCode && code === settings.accountantCode) return 'accountant';
  if (settings.viewerCode && code === settings.viewerCode) return 'viewer';
  return null;
}

// readSettings_(db) → 讀「設定」分頁（key-value 兩欄，無表頭）
function readSettings_(db) {
  var rows = db.getRows(TAB_SETTINGS) || [];
  var map = {};
  rows.forEach(function (row) {
    var key = row && row[0];
    if (key) map[key] = row[1];
  });
  return {
    accountantCode: map['會計通行碼'] != null ? String(map['會計通行碼']) : '',
    viewerCode: map['主管通行碼'] != null ? String(map['主管通行碼']) : '',
    changeFundStd: Number(map['零找金標準']) || 0,
    pettyCashStd: Number(map['零用金標準']) || 0,
    reasonsRaw: map['異常原因分類'] || ''
  };
}

// readItems_(db) → 「品項庫」分頁（含表頭，A-D：店代碼/品項/單位/狀態）→ item[]
function readItems_(db) {
  var rows = db.getRows(TAB_ITEMS) || [];
  return rows.slice(1).filter(function (r) { return r && r[0]; }).map(function (r) {
    return {
      store: r[0],
      name: r[1],
      unit: r[2],
      active: r[3] === '啟用'
    };
  });
}

// readRecords_(db) → 「稽核紀錄」分頁（含表頭，A-O）→ record[]
function readRecords_(db) {
  var rows = db.getRows(TAB_RECORDS) || [];
  return rows.slice(1).filter(function (r) { return r && r[0]; }).map(function (r) {
    return {
      record_key: r[0],
      store: r[1],
      month: r[2],
      status: r[3],
      audit_date: r[4],
      sample_count: r[5],
      correct_count: r[6],
      correct_rate: r[7],
      change_fund: r[8],
      petty_cash: r[9],
      tip_amount: r[10],
      tip_match: r[11],
      anomaly_text: r[12],
      note: r[13],
      submitted_at: r[14]
    };
  });
}

// readDetails_(db) → 「抽查明細」分頁（含表頭，A-J）→ detail[]
function readDetails_(db) {
  var rows = db.getRows(TAB_DETAILS) || [];
  return rows.slice(1).filter(function (r) { return r && r[0]; }).map(function (r) {
    return {
      record_key: r[0],
      store: r[1],
      month: r[2],
      item: r[3],
      unit: r[4],
      book_qty: r[5],
      recount_qty: r[6],
      verdict: r[7],
      reason: r[8],
      note: r[9]
    };
  });
}

// storeByCode_(code) → STORES 該筆物件 | null
function storeByCode_(code) {
  for (var i = 0; i < STORES.length; i++) {
    if (STORES[i].code === code) return STORES[i];
  }
  return null;
}

// nowISO_() → ISO 8601 台北時區時間字串；node 假環境沒有 Utilities，退回 toISOString（測試不比對精確值）
function nowISO_() {
  var d = new Date();
  if (typeof Utilities !== 'undefined' && Utilities.formatDate) {
    return Utilities.formatDate(d, 'Asia/Taipei', "yyyy-MM-dd'T'HH:mm:ssXXX");
  }
  return d.toISOString();
}

// validateRecord_(record) → null（合法）| 錯誤字串（spec.md §5：record_key 格式、店代碼、枚舉逐字元）
function validateRecord_(record) {
  if (!record || typeof record !== 'object') return '缺少 record';
  var store = record.store;
  var month = record.month;
  if (!storeByCode_(store)) return '店代碼不存在：' + store;
  if (!/^\d{4}-\d{2}$/.test(String(month))) return '年月格式錯誤：' + month;
  var expectedKey = store + '_' + month;
  if (record.record_key !== expectedKey) return 'record_key 格式錯誤：' + record.record_key;
  if (STATUS_VALUES.indexOf(record.status) === -1) return '狀態不合法：' + record.status;
  if (CASH_VALUES.indexOf(record.change_fund) === -1) return '零找金欄位不合法：' + record.change_fund;
  if (CASH_VALUES.indexOf(record.petty_cash) === -1) return '零用金欄位不合法：' + record.petty_cash;
  if (TIP_MATCH_VALUES.indexOf(record.tip_match) === -1) return '小費相符欄位不合法：' + record.tip_match;
  return null;
}

// validateDetails_(details, recordKey) → null（合法）| 錯誤字串（判定枚舉、record_key 一致）
function validateDetails_(details, recordKey) {
  if (!Array.isArray(details)) return '明細格式錯誤';
  for (var i = 0; i < details.length; i++) {
    var d = details[i];
    if (!d || d.record_key !== recordKey) {
      return '明細第' + (i + 1) + '筆 record_key 與 record 不一致';
    }
    if (VERDICT_VALUES.indexOf(d.verdict) === -1) {
      return '明細第' + (i + 1) + '筆判定不合法：' + (d && d.verdict);
    }
  }
  return null;
}

// recordToRow_(record) → 稽核紀錄分頁一列（A–O，spec.md §2.2）
function recordToRow_(record) {
  return [
    record.record_key, record.store, record.month, record.status, record.audit_date,
    record.sample_count, record.correct_count, record.correct_rate,
    record.change_fund, record.petty_cash, record.tip_amount, record.tip_match,
    record.anomaly_text, record.note, record.submitted_at
  ];
}

// detailToRow_(d) → 抽查明細分頁一列（A–J，spec.md §2.2）
function detailToRow_(d) {
  return [d.record_key, d.store, d.month, d.item, d.unit, d.book_qty, d.recount_qty, d.verdict, d.reason, d.note];
}

// upsertRecord_(db, record) → 稽核紀錄同 record_key 整列取代，無則 append
function upsertRecord_(db, record) {
  var rows = db.getRows(TAB_RECORDS);
  var row = recordToRow_(record);
  var idx = -1;
  for (var i = 1; i < rows.length; i++) {
    if (rows[i] && rows[i][0] === record.record_key) {
      idx = i;
      break;
    }
  }
  if (idx === -1) {
    db.appendRow(TAB_RECORDS, row);
  } else {
    rows[idx] = row;
    db.setRows(TAB_RECORDS, rows);
  }
}

// replaceDetails_(db, key, details) → 抽查明細先刪該 key 全部列再寫入新列
function replaceDetails_(db, key, details) {
  var rows = db.getRows(TAB_DETAILS);
  var header = rows.length ? rows[0] :
    ['record_key', '店代碼', '年月', '品項', '單位', '盤點數', '複盤數', '判定', '異常原因', '備註'];
  var kept = rows.slice(1).filter(function (r) { return r && r[0] !== key; });
  var newRows = (details || []).map(detailToRow_);
  db.setRows(TAB_DETAILS, [header].concat(kept, newRows));
}

// monthRow_(month) → 'YYYY-MM' 對應的顯示分頁列號（月列=2–13，row = 月份數字 + 1）
function monthRow_(month) {
  var mm = Number(String(month).split('-')[1]);
  return mm + 1;
}

// tipMatchDisplay_(value) → 顯示分頁沿用既有「正確」用語（資料分頁保持 相符/不相符，spec.md §2.1）
function tipMatchDisplay_(value) {
  if (value === '相符') return '正確';
  if (value === '不相符') return '不正確';
  return value;
}

// writeDisplayTabAudited_(db, record) → 已稽核回寫：B–I 全寫，D 一律公式 =C{row}/B{row}
function writeDisplayTabAudited_(db, record) {
  var store = storeByCode_(record.store);
  if (!store) return;
  var tab = store.tab;
  var row = monthRow_(record.month);
  db.setCell(tab, DISPLAY_COLS.sample_count + row, record.sample_count);
  db.setCell(tab, DISPLAY_COLS.correct_count + row, record.correct_count);
  db.setCell(tab, DISPLAY_COLS.correct_rate + row, '=C' + row + '/B' + row);
  db.setCell(tab, DISPLAY_COLS.cash_change_correct + row, record.change_fund);
  db.setCell(tab, DISPLAY_COLS.petty_cash_correct + row, record.petty_cash);
  db.setCell(tab, DISPLAY_COLS.tip_correct + row, tipMatchDisplay_(record.tip_match));
  db.setCell(tab, DISPLAY_COLS.tip_amount + row, record.tip_amount);
  db.setCell(tab, DISPLAY_COLS.anomaly_note + row, record.anomaly_text);
}

// writeDisplayTabRest_(db, store, month) → 輪休回寫：C=輪休，D–I 清空，B 保留原值
function writeDisplayTabRest_(db, storeCode, month) {
  var store = storeByCode_(storeCode);
  if (!store) return;
  var tab = store.tab;
  var row = monthRow_(month);
  db.setCell(tab, DISPLAY_COLS.correct_count + row, '輪休');
  db.setCell(tab, DISPLAY_COLS.correct_rate + row, '');
  db.setCell(tab, DISPLAY_COLS.cash_change_correct + row, '');
  db.setCell(tab, DISPLAY_COLS.petty_cash_correct + row, '');
  db.setCell(tab, DISPLAY_COLS.tip_correct + row, '');
  db.setCell(tab, DISPLAY_COLS.tip_amount + row, '');
  db.setCell(tab, DISPLAY_COLS.anomaly_note + row, '');
}

// ── db adapter：唯一允許呼叫 SpreadsheetApp 的地方 ──────────────────
function makeDb_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();

  function sheet_(tabName) {
    return ss.getSheetByName(tabName);
  }

  return {
    getRows: function (tabName) {
      var sh = sheet_(tabName);
      if (!sh) return [];
      var lastRow = sh.getLastRow();
      var lastCol = sh.getLastColumn();
      if (lastRow === 0 || lastCol === 0) return [];
      return sh.getRange(1, 1, lastRow, lastCol).getValues();
    },
    setRows: function (tabName, rows) {
      var sh = sheet_(tabName);
      if (!sh) return;
      sh.clearContents();
      if (!rows || rows.length === 0) return;
      sh.getRange(1, 1, rows.length, rows[0].length).setValues(rows);
    },
    appendRow: function (tabName, row) {
      var sh = sheet_(tabName);
      if (!sh) return;
      sh.appendRow(row);
    },
    setCell: function (tabName, a1, value) {
      var sh = sheet_(tabName);
      if (!sh) return;
      var range = sh.getRange(a1);
      if (typeof value === 'string' && value.charAt(0) === '=') {
        range.setFormula(value);
      } else {
        range.setValue(value);
      }
    },
    // 把整欄設成純文字格式（'@'）。用途：`2026-01`、`2026-08-05` 這類字串寫進試算表時
    // 會被自動判讀成日期存成 Date（2026-08-01 實測踩到：年月欄變成 2025-12-31T16:00Z），
    // 導致前端月份比對全部對不上。寫入前先把這些欄鎖成文字。
    setColumnsText: function (tabName, cols) {
      var sh = sheet_(tabName);
      if (!sh) return;
      (cols || []).forEach(function (c) {
        sh.getRange(c + '1:' + c).setNumberFormat('@');
      });
    },
    getCell: function (tabName, a1) {
      var sh = sheet_(tabName);
      if (!sh) return undefined;
      return sh.getRange(a1).getValue();
    },
    hasTab: function (tabName) {
      return !!sheet_(tabName);
    },
    createTab: function (tabName) {
      if (!sheet_(tabName)) {
        ss.insertSheet(tabName);
      }
    }
  };
}
