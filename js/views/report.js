// 報告畫面 —— T6 實作
// window.Views.report = { render(el, app) }
// 單月報告／年度總表切換；列印走 window.print()，樣式在 css/print.css（media=print）。
// 契約：只能用 app.state（{role, code, data, year, params}）、app.navigate、app.reload。
// params 可能是 {store, month}（從總覽點格子進來）或空（從 nav 進來）。

(function (root) {
  'use strict';

  var Format = root.Format;

  // ---- 畫面內部狀態（跨 render 保留使用者的選擇；params 進來時覆蓋）----
  var state = {
    mode: 'month',       // 'month' | 'annual'
    store: null,
    month: null,          // 'YYYY-MM'
    annualStore: null
  };
  var lastParamsKey = null;

  function pad2(n) {
    return n < 10 ? '0' + n : '' + n;
  }

  function esc(v) {
    return String(v === null || v === undefined ? '' : v)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  function getYear(app) {
    var s = app.state || {};
    if (s.year) return String(s.year);
    var p = s.params;
    if (p && p.month) return String(p.month).slice(0, 4);
    var records = (s.data && s.data.records) || [];
    if (records.length) {
      var years = records.map(function (r) { return String(r.month).slice(0, 4); }).sort();
      return years[years.length - 1];
    }
    return String(new Date().getFullYear());
  }

  function storeList(app) {
    var cfg = app.state.data && app.state.data.config;
    var stores = (cfg && cfg.stores) || [];
    return stores.slice().sort(function (a, b) { return a.order - b.order; });
  }

  function storeName(app, code) {
    var found = storeList(app).filter(function (s) { return s.code === code; })[0];
    return found ? found.name : (code || '');
  }

  function findRecord(app, store, month) {
    var records = (app.state.data && app.state.data.records) || [];
    var matches = records.filter(function (r) { return r.store === store && r.month === month; });
    return matches.length ? matches[0] : null;
  }

  function findDetails(app, recordKey) {
    var details = (app.state.data && app.state.data.details) || [];
    return details.filter(function (d) { return d.record_key === recordKey; });
  }

  // 依 app.state.params 初始化選擇；params 帶 store+month 視為「從總覽點格子進來」，強制切到單月模式
  function initFromParams(app) {
    var params = (app.state && app.state.params) || {};
    var key = JSON.stringify(params);
    if (params.store && params.month && key !== lastParamsKey) {
      state.mode = 'month';
      state.store = params.store;
      state.month = params.month;
      state.annualStore = params.store;
    }
    lastParamsKey = key;

    var stores = storeList(app);
    if (!state.store && stores.length) state.store = stores[0].code;
    if (!state.annualStore) state.annualStore = state.store;
    if (!state.month) {
      state.month = getYear(app) + '-01';
    }
  }

  // ---- 換行轉「列」：保留原本的自動編號文字，逐行各自一個區塊 ----
  function anomalyLines(text) {
    if (!text) return '<p class="report-empty-note">無異常</p>';
    var lines = String(text).split('\n').filter(function (l) { return l.length > 0; });
    return '<div class="anomaly-lines">' + lines.map(function (line) {
      return '<div class="anomaly-line">' + esc(line) + '</div>';
    }).join('') + '</div>';
  }

  // ---- 單月報告 ----

  function renderMonthControls(app) {
    var stores = storeList(app);
    var storeOpts = stores.map(function (s) {
      return '<option value="' + esc(s.code) + '"' + (s.code === state.store ? ' selected' : '') + '>' +
        esc(s.name) + '</option>';
    }).join('');

    var year = getYear(app);
    var monthOpts = '';
    for (var m = 1; m <= 12; m++) {
      var full = year + '-' + pad2(m);
      monthOpts += '<option value="' + full + '"' + (full === state.month ? ' selected' : '') + '>' +
        esc(Format.monthLabel(full)) + '</option>';
    }

    return '<div class="report-controls no-print">' +
      '<label>店別<select id="report-store-select">' + storeOpts + '</select></label>' +
      '<label>月份<select id="report-month-select">' + monthOpts + '</select></label>' +
      '</div>';
  }

  function renderMonthReport(app) {
    var store = state.store;
    var month = state.month;
    var name = storeName(app, store);
    var monthLbl = Format.monthLabel(month);
    var record = findRecord(app, store, month);

    var head = '<div class="report-header">' +
      '<h3>' + esc(name) + ' ' + esc(monthLbl) + ' 稽核報告</h3>';

    if (!record) {
      head += '<p class="report-empty">無稽核紀錄</p></div>';
      return '<div class="report-print-area report-month">' + head + '</div>';
    }

    if (record.status === '輪休') {
      head += '<p class="report-meta">登記日期：' + esc(record.audit_date || '') + '</p>' +
        '<p class="report-rest">本月輪休</p></div>';
      return '<div class="report-print-area report-month">' + head + '</div>';
    }

    head += '<p class="report-meta">稽核日期：' + esc(record.audit_date || '') + '</p>' +
      '<div class="report-rate">正確率 ' + esc(record.correct_rate) + '%</div>' +
      '</div>';

    var details = findDetails(app, record.record_key);
    var detailRows = details.length
      ? details.map(function (d) {
          return '<tr>' +
            '<td>' + esc(d.item) + '</td>' +
            '<td>' + esc(d.unit) + '</td>' +
            '<td>' + esc(d.book_qty) + '</td>' +
            '<td>' + esc(d.recount_qty) + '</td>' +
            '<td>' + esc(d.verdict) + '</td>' +
            '<td>' + esc(d.reason || '') + '</td>' +
            '</tr>';
        }).join('')
      : '<tr><td colspan="6">無抽查明細</td></tr>';

    var detailTable = '<h4>抽查明細</h4>' +
      '<table class="report-table report-detail-table"><thead><tr>' +
      '<th>品項</th><th>單位</th><th>盤點數</th><th>複盤數</th><th>判定</th><th>異常原因</th>' +
      '</tr></thead><tbody>' + detailRows + '</tbody></table>';

    var vault = '<div class="report-vault">' +
      '<h4>金庫抽查</h4>' +
      '<table class="report-table report-vault-table"><tbody>' +
      '<tr><th>零找金</th><td>' + esc(record.change_fund) + '</td>' +
      '<th>零用金</th><td>' + esc(record.petty_cash) + '</td></tr>' +
      '<tr><th>小費金額</th><td>' + esc(record.tip_amount) + '</td>' +
      '<th>小費相符</th><td>' + esc(record.tip_match) + '</td></tr>' +
      '</tbody></table></div>';

    var anomaly = '<div class="report-anomaly"><h4>複盤異常說明</h4>' + anomalyLines(record.anomaly_text) + '</div>';

    var note = '<div class="report-note"><h4>備註</h4><p>' +
      (record.note ? esc(record.note) : '（無）') + '</p></div>';

    return '<div class="report-print-area report-month">' +
      head + detailTable + vault + anomaly + note + '</div>';
  }

  // ---- 年度總表（重現既有 sheet 分頁樣式）----

  function renderAnnualControls(app) {
    var stores = storeList(app);
    var opts = stores.map(function (s) {
      return '<option value="' + esc(s.code) + '"' + (s.code === state.annualStore ? ' selected' : '') + '>' +
        esc(s.name) + '</option>';
    }).join('');
    return '<div class="report-controls no-print">' +
      '<label>店別<select id="report-annual-store-select">' + opts + '</select></label>' +
      '</div>';
  }

  function annualRow(app, store, year, m) {
    var month = year + '-' + pad2(m);
    var label = Format.monthLabel(month);
    var record = findRecord(app, store, month);

    if (!record) {
      return '<tr><td>' + esc(label) + '</td><td></td><td></td><td></td><td></td><td></td><td></td><td></td><td></td></tr>';
    }
    if (record.status === '輪休') {
      return '<tr><td>' + esc(label) + '</td><td></td><td>輪休</td><td></td><td></td><td></td><td></td><td></td><td></td></tr>';
    }
    return '<tr>' +
      '<td>' + esc(label) + '</td>' +
      '<td>' + esc(record.sample_count) + '</td>' +
      '<td>' + esc(record.correct_count) + '</td>' +
      '<td>' + esc(record.correct_rate) + '%</td>' +
      '<td>' + esc(record.change_fund) + '</td>' +
      '<td>' + esc(record.petty_cash) + '</td>' +
      '<td>' + esc(record.tip_match) + '</td>' +
      '<td>' + esc(record.tip_amount) + '</td>' +
      '<td class="report-anomaly-cell">' + (record.anomaly_text ? anomalyLines(record.anomaly_text) : '') + '</td>' +
      '</tr>';
  }

  function renderAnnualReport(app) {
    var store = state.annualStore;
    var year = getYear(app);
    var name = storeName(app, store);

    var rows = '';
    for (var m = 1; m <= 12; m++) {
      rows += annualRow(app, store, year, m);
    }

    var table = '<table class="report-table report-annual-table"><thead><tr>' +
      '<th>月份</th><th>盤點抽查數量</th><th>複盤正確數量</th><th>正確率</th>' +
      '<th>零找金</th><th>零用金</th><th>小費是否正確</th><th>小費金額</th><th>複盤異常說明</th>' +
      '</tr></thead><tbody>' + rows + '</tbody></table>';

    return '<div class="report-print-area report-annual">' +
      '<h3>' + esc(name) + ' ' + esc(year) + ' 年度總表</h3>' +
      table + '</div>';
  }

  // ---- 畫面內嵌樣式（僅套用螢幕顯示；列印樣式一律在 css/print.css）----
  var SCREEN_STYLE =
    '<style>' +
    '.report-controls{display:flex;gap:12px;flex-wrap:wrap;margin-bottom:var(--gap);}' +
    '.report-controls label{flex:1;min-width:140px;}' +
    '.mode-toggle{display:flex;gap:8px;margin-bottom:var(--gap);}' +
    '.mode-toggle .mode-btn{flex:1;padding:10px;border-radius:var(--radius);border:1px solid var(--color-primary);' +
    'background:var(--color-surface);color:var(--color-primary);font-weight:600;}' +
    '.mode-toggle .mode-btn.active{background:var(--color-primary);color:#fff;}' +
    '.report-print-area{background:var(--color-surface);border:1px solid var(--color-border);' +
    'border-radius:var(--radius);padding:var(--gap);margin-bottom:var(--gap);}' +
    '.report-header h3{margin:0 0 8px;}' +
    '.report-meta{color:var(--color-text-muted);margin:0 0 8px;}' +
    '.report-rate{font-size:2rem;font-weight:700;color:var(--color-primary);margin:4px 0 8px;}' +
    '.report-rest{font-size:1.3rem;font-weight:700;color:var(--color-danger);}' +
    '.report-empty{color:var(--color-text-muted);}' +
    '.report-table{width:100%;border-collapse:collapse;margin:8px 0 16px;font-size:0.9rem;}' +
    '.report-table th,.report-table td{border:1px solid var(--color-border);padding:6px 8px;text-align:center;}' +
    '.report-table thead th{background:var(--color-primary-light);}' +
    '.report-vault-table th{background:var(--color-primary-light);width:22%;}' +
    '.report-annual-table td.report-anomaly-cell{text-align:left;white-space:normal;}' +
    '.anomaly-lines{text-align:left;}' +
    '.anomaly-line{padding:2px 0;}' +
    '.report-empty-note{color:var(--color-text-muted);margin:0;}' +
    '.report-note h4,.report-anomaly h4,.report-vault h4{margin:0 0 4px;font-size:1rem;}' +
    '</style>';

  function render(el, app) {
    if (!app.state || !app.state.data) {
      el.innerHTML = SCREEN_STYLE + '<p>資料載入中…</p>';
      return;
    }

    initFromParams(app);

    var html = SCREEN_STYLE;
    html += '<h2>報告</h2>';
    html += '<div class="mode-toggle no-print">' +
      '<button type="button" class="mode-btn' + (state.mode === 'month' ? ' active' : '') + '" data-mode="month">單月報告</button>' +
      '<button type="button" class="mode-btn' + (state.mode === 'annual' ? ' active' : '') + '" data-mode="annual">年度總表</button>' +
      '</div>';

    if (state.mode === 'annual') {
      html += renderAnnualControls(app);
      html += renderAnnualReport(app);
    } else {
      html += renderMonthControls(app);
      html += renderMonthReport(app);
    }

    html += '<button type="button" id="report-print-btn" class="btn no-print" style="margin-top:8px;">列印／存 PDF</button>';

    el.innerHTML = html;

    var modeBtns = el.querySelectorAll('.mode-btn');
    for (var i = 0; i < modeBtns.length; i++) {
      modeBtns[i].addEventListener('click', function (e) {
        state.mode = e.currentTarget.getAttribute('data-mode');
        render(el, app);
      });
    }

    var storeSel = el.querySelector('#report-store-select');
    if (storeSel) {
      storeSel.addEventListener('change', function () {
        state.store = storeSel.value;
        render(el, app);
      });
    }
    var monthSel = el.querySelector('#report-month-select');
    if (monthSel) {
      monthSel.addEventListener('change', function () {
        state.month = monthSel.value;
        render(el, app);
      });
    }
    var annualSel = el.querySelector('#report-annual-store-select');
    if (annualSel) {
      annualSel.addEventListener('change', function () {
        state.annualStore = annualSel.value;
        render(el, app);
      });
    }
    var printBtn = el.querySelector('#report-print-btn');
    if (printBtn) {
      printBtn.addEventListener('click', function () {
        window.print();
      });
    }
  }

  root.Views = root.Views || {};
  root.Views.report = { render: render };
})(typeof window !== 'undefined' ? window : this);
