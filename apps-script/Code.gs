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
//   (a) 純函式 handler：handleAuth / handleGetAll（T10 起再加 handleSubmitAudit /
//       handleMarkRest）——只碰 db 介面，禁止直接呼叫 SpreadsheetApp，node 假環境才能整測。
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

// ---- doPost 白名單（T9 只開放 auth/getAll；T10 加 submitAudit/markRest 時同步擴充）----
var ACTIONS = ['auth', 'getAll'];

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

// ── 內部工具：只碰 db 介面 ───────────────────────────────────────────

// resolveRole_(code, db) → 'accountant' | 'viewer' | null（不合法一律 null，不洩漏通行碼比對細節）
function resolveRole_(code, db) {
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
