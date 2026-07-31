// test/gas-runner.js —— node 假環境：不部署也能整測 apps-script/Code.gs
// Code.gs 是 GAS 原生腳本（無 module.exports），用 vm 把原始碼跑在有 mock 全域物件的
// sandbox 裡，取出 function 宣告當成 export。SpreadsheetApp 不 mock（handler 不該碰它，
// 只有 makeDb_() 會用到，而測試一律傳自製的記憶體版 db，不呼叫 makeDb_()）。

'use strict';

var fs = require('fs');
var path = require('path');
var vm = require('vm');

var CODE_GS_PATH = path.join(__dirname, '..', 'apps-script', 'Code.gs');

// ---- ContentService / Logger mock（doPost 會用到）----
function makeContentServiceMock_() {
  return {
    MimeType: { JSON: 'JSON' },
    createTextOutput: function (text) {
      var out = {
        _text: text,
        _mimeType: null,
        setMimeType: function (mt) {
          out._mimeType = mt;
          return out;
        },
        getContent: function () {
          return out._text;
        },
        getMimeType: function () {
          return out._mimeType;
        }
      };
      return out;
    }
  };
}

function makeLoggerMock_() {
  return {
    log: function () {}
  };
}

// loadGas() → sandbox 全域物件本身（doPost/handleAuth/handleGetAll/makeDb_/ACTIONS/STORES
// 都是它的屬性，因為 Code.gs 內都是 function 宣告，vm context 裡會掛在全域物件上）。
// 每次呼叫都是全新 sandbox（測試互不汙染全域狀態）。
// 之所以回傳 sandbox 本身而不是複製一份新物件：doPost() 內部呼叫 makeDb_() 是用自由變數
// 查找（同一個全域作用域），事後改寫 sandbox.makeDb_ 才會被 doPost 看到——複製到新物件上
// 的屬性只是快照，改寫不會反映回 doPost 實際呼叫的那個 makeDb_。
function loadGas() {
  var code = fs.readFileSync(CODE_GS_PATH, 'utf8');
  var sandbox = {
    console: console,
    ContentService: makeContentServiceMock_(),
    Logger: makeLoggerMock_()
  };
  vm.createContext(sandbox);
  vm.runInContext(code, sandbox, { filename: CODE_GS_PATH });
  return sandbox;
}

// ---- 記憶體版 db（實作 Code.gs 頂部的 db 介面）----
// makeMemoryDb(seedTabs) — seedTabs: { tabName: Array<Array> }（含表頭列，照 db.getRows 約定）
function makeMemoryDb(seedTabs) {
  var data = {};
  var textCols = {};
  Object.keys(seedTabs || {}).forEach(function (tab) {
    data[tab] = (seedTabs[tab] || []).map(function (row) { return row.slice(); });
  });

  function ensureGrid_(tab, rowIdx, colIdx) {
    if (!data[tab]) data[tab] = [];
    while (data[tab].length <= rowIdx) data[tab].push([]);
    while (data[tab][rowIdx].length <= colIdx) data[tab][rowIdx].push('');
  }

  return {
    getRows: function (tabName) {
      if (!data[tabName]) return [];
      return data[tabName].map(function (row) { return row.slice(); });
    },
    setRows: function (tabName, rows) {
      data[tabName] = (rows || []).map(function (row) { return row.slice(); });
    },
    appendRow: function (tabName, row) {
      if (!data[tabName]) data[tabName] = [];
      data[tabName].push((row || []).slice());
    },
    setCell: function (tabName, a1, value) {
      var pos = parseA1_(a1);
      ensureGrid_(tabName, pos.row, pos.col);
      data[tabName][pos.row][pos.col] = value;
    },
    getCell: function (tabName, a1) {
      var pos = parseA1_(a1);
      if (!data[tabName] || !data[tabName][pos.row]) return undefined;
      return data[tabName][pos.row][pos.col];
    },
    // 記憶體版沒有「儲存格格式」概念，只記錄被鎖成文字的欄位供測試斷言
    // （真環境的 setNumberFormat('@') 是防年月被試算表轉成 Date 的關鍵，見 Code.gs）
    setColumnsText: function (tabName, cols) {
      if (!textCols[tabName]) textCols[tabName] = [];
      (cols || []).forEach(function (c) {
        if (textCols[tabName].indexOf(c) === -1) textCols[tabName].push(c);
      });
    },
    hasTab: function (tabName) {
      return Object.prototype.hasOwnProperty.call(data, tabName);
    },
    createTab: function (tabName) {
      if (!data[tabName]) data[tabName] = [];
    },
    // 測試專用：直接讀底層資料，不走 getRows 的複製
    _raw: data,
    _textCols: textCols
  };
}

// parseA1_('C5') → {row:4, col:2}（0-based）
function parseA1_(a1) {
  var m = /^([A-Z]+)(\d+)$/.exec(String(a1).toUpperCase());
  if (!m) throw new Error('無效的 A1 座標：' + a1);
  var letters = m[1];
  var col = 0;
  for (var i = 0; i < letters.length; i++) {
    col = col * 26 + (letters.charCodeAt(i) - 64);
  }
  return { row: parseInt(m[2], 10) - 1, col: col - 1 };
}

// makePostEvent(bodyObj|string) → 模擬 doPost(e) 的 e 參數
function makePostEvent(body) {
  var contents = typeof body === 'string' ? body : JSON.stringify(body);
  return { postData: { contents: contents, type: 'text/plain' } };
}

// parseResponse(output) → doPost() 回傳值解析回物件
function parseResponse(output) {
  return JSON.parse(output.getContent());
}

module.exports = {
  loadGas: loadGas,
  makeMemoryDb: makeMemoryDb,
  makePostEvent: makePostEvent,
  parseResponse: parseResponse,
  parseA1_: parseA1_
};
