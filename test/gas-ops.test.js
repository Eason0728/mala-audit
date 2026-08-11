// node test/gas-ops.test.js —— 營運稽核後端：submitOpsAudit／getAll 帶 ops 資料／驗證
// 零依賴、直跑、失敗時 process.exit(1)。載入方式見 test/gas-runner.js（vm 假環境，不部署）。
//
// 這支特別要守住的三件事：
//   ① 送出營運稽核**不可以**動到月初盤點的分頁（稽核紀錄／抽查明細）與五個顯示分頁
//   ② 判「未完成」沒填說明要被擋下（前端擋一次、後端再擋一次）
//   ③ 分頁不存在時會自己建（上線後才加的分頁，setup() 未必會再被跑一次）

'use strict';

var runner = require('./gas-runner.js');

var failures = 0;

function assertEqual(actual, expected, label) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
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

// ── 種子 ─────────────────────────────────────────────────────────────

var ACCOUNTANT = 'acc-code';
var VIEWER = 'view-code';

function seedTabs() {
  return {
    設定: [
      ['會計通行碼', ACCOUNTANT],
      ['主管通行碼', VIEWER],
      ['零找金標準', 10000],
      ['零用金標準', 10000],
      ['異常原因分類', '損耗未記／其他']
    ],
    品項庫: [['店代碼', '品項', '單位', '狀態']],
    稽核紀錄: [['record_key', '店代碼', '年月', '狀態', '稽核日期', '抽查數量', '正確數量', '正確率',
      '零找金', '零用金', '小費金額', '小費相符', '異常說明', '備註', '提交時間']],
    抽查明細: [['record_key', '店代碼', '年月', '品項', '單位', '盤點數', '複盤數', '判定', '異常原因', '備註']]
  };
}

function mkRecord(over) {
  var r = {
    record_key: 'sxl-gf_2026-08',
    store: 'sxl-gf',
    month: '2026-08',
    status: '已稽核',
    audit_date: '2026-08-11',
    auditor: '王會計',
    total_count: 19,
    pass_count: 17,
    fail_count: 1,
    pending_count: 1,
    track_count: 1,
    pass_rate: 89,
    summary: '1.消防安全－瓦斯桶是否固定（不傾斜）:後門那桶沒鏈條',
    note: '',
    submitted_at: '2026-08-11T14:30:00+08:00'
  };
  Object.keys(over || {}).forEach(function (k) { r[k] = over[k]; });
  return r;
}

function mkDetails(over) {
  var base = [
    { record_key: 'sxl-gf_2026-08', store: 'sxl-gf', month: '2026-08', item_id: 'c0g0i0',
      cat: '營運管理', group: '消防安全', text: '一家店至少兩支滅火器',
      verdict: '合格', track: false, note: '' },
    { record_key: 'sxl-gf_2026-08', store: 'sxl-gf', month: '2026-08', item_id: 'c0g0i4',
      cat: '營運管理', group: '消防安全', text: '瓦斯桶是否固定（不傾斜）',
      verdict: '未完成', track: true, note: '後門那桶沒鏈條' },
    { record_key: 'sxl-gf_2026-08', store: 'sxl-gf', month: '2026-08', item_id: 'c1g1i3',
      cat: '品牌形象', group: '食安', text: '濾心日期是否定期更換',
      verdict: '未檢查', track: false, note: '' }
  ];
  return over || base;
}

function submit(gas, db, payload) {
  return gas.handleSubmitOpsAudit(payload, db);
}

// ── (1) 送出成功：兩個分頁自己建好，內容正確 ─────────────────────────

(function () {
  var gas = runner.loadGas();
  var db = runner.makeMemoryDb(seedTabs());

  assertTrue(!db.hasTab('營運稽核紀錄'), '(1) 送出前沒有「營運稽核紀錄」分頁');

  var res = submit(gas, db, { code: ACCOUNTANT, record: mkRecord(), details: mkDetails() });
  assertEqual(res, { ok: true, record_key: 'sxl-gf_2026-08' }, '(1) 送出回 ok');

  assertTrue(db.hasTab('營運稽核紀錄'), '(1) 自動建立「營運稽核紀錄」分頁');
  assertTrue(db.hasTab('營運稽核明細'), '(1) 自動建立「營運稽核明細」分頁');

  var recRows = db.getRows('營運稽核紀錄');
  assertEqual(recRows[0][0], 'record_key', '(1) 紀錄分頁有表頭');
  assertEqual(recRows.length, 2, '(1) 紀錄分頁一列資料');
  assertEqual(recRows[1].slice(0, 6),
    ['sxl-gf_2026-08', 'sxl-gf', '2026-08', '已稽核', '2026-08-11', '王會計'],
    '(1) 紀錄 A–F 欄');
  assertEqual(recRows[1].slice(6, 12), [19, 17, 1, 1, 1, 89], '(1) 紀錄 G–L 統計欄');

  var detRows = db.getRows('營運稽核明細');
  assertEqual(detRows.length, 4, '(1) 明細三列＋表頭');
  assertEqual(detRows[2],
    ['sxl-gf_2026-08', 'sxl-gf', '2026-08', 'c0g0i4', '營運管理', '消防安全',
      '瓦斯桶是否固定（不傾斜）', '未完成', '是', '後門那桶沒鏈條'],
    '(1) 未完成那列 A–J（追蹤寫「是」）');
  assertEqual(detRows[1][8], '', '(1) 沒追蹤的列第 I 欄留空');
  assertEqual(detRows[1].length, 10, '(1) 明細是 10 欄（A–J，沒有照片欄）');

  // 年月／日期／提交時間欄要被鎖成文字，否則會被試算表轉成 Date
  assertEqual(db._textCols['營運稽核紀錄'], ['A', 'C', 'E', 'O'], '(1) 紀錄分頁鎖文字欄');
  assertEqual(db._textCols['營運稽核明細'], ['A', 'C'], '(1) 明細分頁鎖文字欄');
})();

// ── (2) 不可污染月初盤點那套 ─────────────────────────────────────────

(function () {
  var gas = runner.loadGas();
  var seeds = seedTabs();
  // 顯示分頁也放進去，證明營運稽核完全不會碰它
  seeds['小辛辣光復店'] = [
    ['月份', '盤點抽查數量', '複盤正確數量', '正確率', '零找金是否正確',
      '零用金是否正確', '小費是否正確', '小費金額', '複盤異常說明'],
    ['一月', 20, 16, 0.8, '正確', '正確', '正確', 500, '']
  ];
  var db = runner.makeMemoryDb(seeds);
  var before = JSON.stringify({
    records: db.getRows('稽核紀錄'),
    details: db.getRows('抽查明細'),
    display: db.getRows('小辛辣光復店')
  });

  submit(gas, db, { code: ACCOUNTANT, record: mkRecord(), details: mkDetails() });

  var after = JSON.stringify({
    records: db.getRows('稽核紀錄'),
    details: db.getRows('抽查明細'),
    display: db.getRows('小辛辣光復店')
  });
  assertEqual(after, before, '(2) 送出營運稽核完全沒動到盤點的三個分頁');
})();

// ── (3) 覆蓋語意：同 record_key 重送＝整筆取代，不是累加 ──────────────

(function () {
  var gas = runner.loadGas();
  var db = runner.makeMemoryDb(seedTabs());

  submit(gas, db, { code: ACCOUNTANT, record: mkRecord(), details: mkDetails() });
  // 別家店同月也送一筆，證明取代時不會誤刪別人的列
  submit(gas, db, {
    code: ACCOUNTANT,
    record: mkRecord({ record_key: 'ck_2026-08', store: 'ck' }),
    details: mkDetails().map(function (d) {
      return { record_key: 'ck_2026-08', store: 'ck', month: '2026-08', item_id: d.item_id,
        cat: d.cat, group: d.group, text: d.text, verdict: d.verdict, track: d.track, note: d.note };
    })
  });
  // 第一家重送，明細只剩一列
  submit(gas, db, {
    code: ACCOUNTANT,
    record: mkRecord({ pass_count: 19, fail_count: 0, pending_count: 0, pass_rate: 100, summary: '' }),
    details: [mkDetails()[0]]
  });

  var recRows = db.getRows('營運稽核紀錄');
  assertEqual(recRows.length, 3, '(3) 重送不新增紀錄列（表頭＋兩家店）');
  var sxl = recRows.filter(function (r) { return r[0] === 'sxl-gf_2026-08'; })[0];
  assertEqual(sxl[11], 100, '(3) 重送後合格率被覆蓋成 100');

  var detRows = db.getRows('營運稽核明細');
  var sxlDet = detRows.filter(function (r) { return r[0] === 'sxl-gf_2026-08'; });
  var ckDet = detRows.filter(function (r) { return r[0] === 'ck_2026-08'; });
  assertEqual(sxlDet.length, 1, '(3) 重送後該店明細只剩 1 列（先刪後寫）');
  assertEqual(ckDet.length, 3, '(3) 別家店的明細沒被誤刪');
})();

// ── (4) 驗證與權限 ───────────────────────────────────────────────────

(function () {
  var gas = runner.loadGas();
  var db = runner.makeMemoryDb(seedTabs());

  var r1 = submit(gas, db, { code: VIEWER, record: mkRecord(), details: mkDetails() });
  assertEqual(r1.ok, false, '(4) 主管碼不能送出');

  var r2 = submit(gas, db, { code: ACCOUNTANT, record: mkRecord({ store: 'nope', record_key: 'nope_2026-08' }), details: [] });
  assertEqual(r2.ok, false, '(4) 店代碼不存在被擋');

  var r3 = submit(gas, db, { code: ACCOUNTANT, record: mkRecord({ month: '2026/08', record_key: 'sxl-gf_2026/08' }), details: [] });
  assertEqual(r3.ok, false, '(4) 年月格式錯被擋');

  var r4 = submit(gas, db, { code: ACCOUNTANT, record: mkRecord({ record_key: '亂寫' }), details: [] });
  assertEqual(r4.ok, false, '(4) record_key 與店_年月 對不起來被擋');

  var r5 = submit(gas, db, { code: ACCOUNTANT, record: mkRecord({ auditor: '' }), details: [] });
  assertEqual(r5.ok, false, '(4) 沒填稽核人員被擋');

  var r6 = submit(gas, db, {
    code: ACCOUNTANT, record: mkRecord(),
    details: [{ record_key: 'sxl-gf_2026-08', item_id: 'c0g0i0', verdict: '不合格' }]
  });
  assertEqual(r6.ok, false, '(4) 判定不在「合格／未完成／未檢查」被擋');

  // 這條是這張表存在的理由：說不出哪裡不合格的缺失，下個月沒人追得動
  var r7 = submit(gas, db, {
    code: ACCOUNTANT, record: mkRecord(),
    details: [{ record_key: 'sxl-gf_2026-08', item_id: 'c0g0i4', verdict: '未完成', note: '   ' }]
  });
  assertEqual(r7.ok, false, '(4) 判未完成但沒填說明被擋（空白不算填）');

  var r8 = submit(gas, db, {
    code: ACCOUNTANT, record: mkRecord(),
    details: [{ record_key: '別筆_2026-08', item_id: 'c0g0i0', verdict: '合格' }]
  });
  assertEqual(r8.ok, false, '(4) 明細 record_key 與 record 不一致被擋');

  assertTrue(!db.hasTab('營運稽核紀錄'), '(4) 全部被擋下時一列都沒寫進去');
})();

// ── (5) getAll 帶回 ops 資料；分頁不存在時回空陣列不炸 ────────────────

(function () {
  var gas = runner.loadGas();
  var db = runner.makeMemoryDb(seedTabs());

  var empty = gas.handleGetAll({ code: ACCOUNTANT }, db);
  assertEqual(empty.ops_records, [], '(5) 還沒有營運稽核分頁時 ops_records 是空陣列');
  assertEqual(empty.ops_details, [], '(5) 同上 ops_details');

  submit(gas, db, { code: ACCOUNTANT, record: mkRecord(), details: mkDetails() });
  var res = gas.handleGetAll({ code: ACCOUNTANT }, db);
  assertEqual(res.ops_records.length, 1, '(5) getAll 帶回 1 筆營運稽核紀錄');
  assertEqual(res.ops_records[0].auditor, '王會計', '(5) 紀錄帶回稽核人員');
  assertEqual(res.ops_records[0].pass_rate, 89, '(5) 紀錄帶回合格率');
  assertEqual(res.ops_details.length, 3, '(5) getAll 帶回 3 筆明細');
  assertEqual(res.ops_details[1].track, true, '(5) 追蹤欄「是」讀回來是 true');
  assertEqual(res.ops_details[0].track, false, '(5) 追蹤欄空白讀回來是 false');
  assertEqual(res.ops_details[1].note, '後門那桶沒鏈條', '(5) 說明讀得回來');

  // 年月被試算表存成 Date 也要正規化回 'yyyy-MM'（盤點那套踩過兩次的坑）
  db.setCell('營運稽核紀錄', 'C2', new Date(2026, 7, 1));
  var res2 = gas.handleGetAll({ code: ACCOUNTANT }, db);
  assertEqual(res2.ops_records[0].month, '2026-08', '(5) 年月被存成 Date 也讀回 2026-08');
})();

// ── (6) doPost 白名單認得 submitOpsAudit ─────────────────────────────

(function () {
  var gas = runner.loadGas();
  assertTrue(gas.ACTIONS.indexOf('submitOpsAudit') !== -1, '(6) ACTIONS 含 submitOpsAudit');
  assertTrue(gas.ACTIONS.indexOf('uploadOpsPhoto') === -1,
    '(6) ACTIONS 不含 uploadOpsPhoto（2026-08-11 決定不做照片，Drive 權限一併不要）');

  // Apps Script 是靠靜態掃描程式碼決定 OAuth 範圍的：只要出現 DriveApp，
  // 就算一行都沒執行也會多要雲端硬碟權限、逼 Eason 重新授權一次。
  var src = require('fs').readFileSync(
    require('path').join(__dirname, '..', 'apps-script', 'Code.gs'), 'utf8');
  assertTrue(src.indexOf('DriveApp') === -1, '(6) Code.gs 完全沒有 DriveApp（不多要授權範圍）');

  var out = gas.doPost(runner.makePostEvent({ action: 'uploadOpsPhoto', code: ACCOUNTANT }));
  assertEqual(runner.parseResponse(out).ok, false, '(6) 打 uploadOpsPhoto 回不支援');
})();

// ── 收尾 ─────────────────────────────────────────────────────────────

if (failures) {
  console.error('\n' + failures + ' 項失敗');
  process.exit(1);
}
console.log('\n全部測試通過');
