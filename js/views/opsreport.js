// 營運稽核報告（2026-08-11）——單月報告，可列印／存 PDF
// window.Views.opsreport = { render(el, app) }
// 沿用月初盤點報告頁的 class 名（report-print-area／report-table／report-controls／no-print），
// 列印樣式因此直接吃 css/print.css 現成那套，不必再寫一份。

(function (root) {
  'use strict';

  var Format = root.Format;

  var state = { store: null, month: null };

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function pad2(n) { return (n < 10 ? '0' : '') + n; }

  function storeList(app) {
    var data = app.state.data || {};
    return ((data.config && data.config.stores) || []).slice().sort(function (a, b) {
      return a.order - b.order;
    });
  }

  function storeName(app, code) {
    var hit = storeList(app).filter(function (s) { return s.code === code; })[0];
    return hit ? hit.name : code;
  }

  function findRecord(app, store, month) {
    var key = store + '_' + month;
    return ((app.state.data || {}).ops_records || []).filter(function (r) {
      return r.record_key === key;
    })[0] || null;
  }

  function findDetails(app, key) {
    return ((app.state.data || {}).ops_details || []).filter(function (d) {
      return d.record_key === key;
    });
  }

  function controlsHtml(app) {
    var stores = storeList(app);
    var storeOpts = stores.map(function (s) {
      return '<option value="' + esc(s.code) + '"' + (s.code === state.store ? ' selected' : '') + '>' +
        esc(s.name) + '</option>';
    }).join('');
    var year = String(state.month).split('-')[0];
    var monthOpts = '';
    for (var m = 1; m <= 12; m++) {
      var full = year + '-' + pad2(m);
      monthOpts += '<option value="' + full + '"' + (full === state.month ? ' selected' : '') + '>' +
        esc(Format.monthLabel(full)) + '</option>';
    }
    return '<div class="report-controls no-print">' +
      '<label>店別<select id="opsreport-store">' + storeOpts + '</select></label>' +
      '<label>月份<select id="opsreport-month">' + monthOpts + '</select></label>' +
      '</div>';
  }

  function reportHtml(app) {
    var record = findRecord(app, state.store, state.month);
    var head = '<div class="report-header">' +
      '<h3>' + esc(storeName(app, state.store)) + ' ' + esc(Format.monthLabel(state.month)) +
      ' 營運稽核報告</h3>';

    if (!record) {
      return '<div class="report-print-area report-month">' + head +
        '<p class="report-empty">無稽核紀錄</p></div></div>';
    }
    if (record.status === '輪休') {
      return '<div class="report-print-area report-month">' + head +
        '<p class="report-rest">本月輪休</p></div></div>';
    }

    head += '<p class="report-meta">稽核日期：' + esc(record.audit_date || '') +
      '　稽核人員：' + esc(record.auditor || '') + '</p>' +
      '<div class="report-rate">合格率 ' + esc(record.pass_rate) + '%</div>' +
      '</div>';

    // 統計用橫排 chip 不用表格：手機 390px 塞十格表格會把「細項總數」擠成一行一個字
    var summary = '<div class="ops-stats">' +
      '<span>細項 <b>' + esc(record.total_count) + '</b></span>' +
      '<span class="ok">合格 <b>' + esc(record.pass_count) + '</b></span>' +
      '<span class="bad">未完成 <b>' + esc(record.fail_count) + '</b></span>' +
      '<span>未檢查 <b>' + esc(record.pending_count) + '</b></span>' +
      '<span>追蹤 <b>' + esc(record.track_count) + '</b></span>' +
      '</div>';

    var details = findDetails(app, record.record_key);

    // 未完成清單擺最前面：主管翻報告要看的是「哪裡沒過、要改什麼」
    var fails = details.filter(function (d) { return d.verdict === '未完成'; });
    var failHtml = '<h4>未完成項目（' + fails.length + '）</h4>';
    if (!fails.length) {
      failHtml += '<p class="report-empty-note">全部合格</p>';
    } else {
      failHtml += '<table class="report-table report-ops-fail"><thead><tr>' +
        '<th>分類</th><th>檢查項目</th><th>說明</th><th>追蹤</th>' +
        '</tr></thead><tbody>' +
        fails.map(function (d) {
          return '<tr>' +
            '<td class="report-group-cell">' + esc(d.group) + '</td>' +
            '<td>' + esc(d.text) + '</td>' +
            '<td>' + esc(d.note || '') + '</td>' +
            '<td>' + (d.track ? '★' : '') + '</td>' +
            '</tr>';
        }).join('') + '</tbody></table>';
    }

    // 全部項目：用「群組小標列」分段，不要每列都重複一個窄窄的分類欄——
    // 390px 手機上那一欄會被擠成一行一個字（2026-08-11 拍手冊時實際看到）。
    var allHtml = '<h4>全部檢查項目</h4>';
    if (!details.length) {
      allHtml += '<p class="report-empty-note">無明細</p>';
    } else {
      var lastGroup = null;
      var rows = '';
      details.forEach(function (d) {
        if (d.group !== lastGroup) {
          rows += '<tr class="report-group-row"><th colspan="3">' +
            esc(d.cat) + '｜' + esc(d.group) + '</th></tr>';
          lastGroup = d.group;
        }
        rows += '<tr>' +
          '<td>' + esc(d.text) + '</td>' +
          '<td class="report-verdict-cell">' + esc(d.verdict) + (d.track ? ' ★' : '') + '</td>' +
          '<td>' + esc(d.note || '') + '</td>' +
          '</tr>';
      });
      allHtml += '<table class="report-table report-ops-all"><thead><tr>' +
        '<th>檢查項目</th><th>判定</th><th>說明</th>' +
        '</tr></thead><tbody>' + rows + '</tbody></table>';
    }

    return '<div class="report-print-area report-month">' +
      head + summary + failHtml + allHtml + '</div>';
  }

  function render(el, app) {
    var stores = storeList(app);
    if (!stores.length) {
      el.innerHTML = '<h2>營運稽核報告</h2><p class="status-danger">讀不到店別清單，請重新登入。</p>';
      return;
    }

    var params = app.state.params || {};
    state.store = params.store || state.store || stores[0].code;
    state.month = params.month || state.month ||
      (app.state.year || '2026') + '-' + pad2(new Date().getMonth() + 1);
    app.state.params = {};

    el.innerHTML =
      '<h2 class="no-print">營運稽核報告</h2>' +
      controlsHtml(app) +
      reportHtml(app) +
      '<button type="button" id="opsreport-print" class="btn no-print" style="margin-top:8px;">列印／存 PDF</button>';

    el.querySelector('#opsreport-store').addEventListener('change', function (e) {
      state.store = e.target.value;
      render(el, app);
    });
    el.querySelector('#opsreport-month').addEventListener('change', function (e) {
      state.month = e.target.value;
      render(el, app);
    });
    el.querySelector('#opsreport-print').addEventListener('click', function () {
      window.print();
    });
  }

  root.Views = root.Views || {};
  root.Views.opsreport = { render: render };
})(typeof window !== 'undefined' ? window : this);
