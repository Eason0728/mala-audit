// test/gas-import-runner.js —— node 假環境：把 Code.gs＋Import.gs 載進同一個 sandbox
// （GAS 同專案多檔共享全域，Import.gs 直接用 Code.gs 的 STORES/TAB_*/makeDb_，
//  所以測試也必須兩檔同 context，順序＝Code.gs 先、Import.gs 後）。
// 記憶體 db 與 A1 解析沿用 gas-runner.js（不重複實作、也不修改它）。

'use strict';

var fs = require('fs');
var path = require('path');
var vm = require('vm');
var base = require('./gas-runner.js');

var APPS_DIR = path.join(__dirname, '..', 'apps-script');

function loadGasWithImport() {
  var sandbox = {
    console: console,
    ContentService: {
      MimeType: { JSON: 'JSON' },
      createTextOutput: function (text) {
        var out = {
          _text: text,
          setMimeType: function () { return out; },
          getContent: function () { return out._text; }
        };
        return out;
      }
    },
    Logger: { log: function () {} }
  };
  vm.createContext(sandbox);
  ['Code.gs', 'Import.gs'].forEach(function (name) {
    var file = path.join(APPS_DIR, name);
    vm.runInContext(fs.readFileSync(file, 'utf8'), sandbox, { filename: file });
  });
  return sandbox;
}

// 從 test/fixtures/display-tabs.json（真 sheet 五分頁完整複本）建記憶體 db。
// 注意：fixture 的正確率欄是公式的「快取值」（0.8 這種小數），匯入邏輯不讀它、只讀 B/C，
// 所以直接原樣載入即可反映真實情境。
function makeDbFromDisplayFixture() {
  var fixture = JSON.parse(
    fs.readFileSync(path.join(__dirname, 'fixtures', 'display-tabs.json'), 'utf8')
  );
  return base.makeMemoryDb(fixture);
}

module.exports = {
  loadGasWithImport: loadGasWithImport,
  makeDbFromDisplayFixture: makeDbFromDisplayFixture,
  makeMemoryDb: base.makeMemoryDb,
  parseA1_: base.parseA1_
};
