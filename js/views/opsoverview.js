// 營運稽核總覽（2026-08-11）——5 店 × 12 月合格率格
// window.Views.opsoverview = { render(el, app) }
// 格子三態：已稽核(合格率%)／輪休／未記錄(—)。點已稽核格 → navigate('opsreport', {store, month})。
// 版面刻意跟月初盤點的總覽（js/views/overview.js）長一樣，會計在兩個區塊間切換不必重新學。

(function (root) {
  'use strict';

  var YEARS = ['2026'];

  var CELL_BASE_STYLE =
    'border:1px solid var(--color-border);padding:8px 4px;text-align:center;' +
    'font-size:0.82rem;white-space:nowrap;';

  function cellStyle(state) {
    if (state === 'audited') {
      return CELL_BASE_STYLE + 'background:var(--color-primary-light);color:var(--color-primary);' +
        'font-weight:600;cursor:pointer;';
    }
    if (state === 'rest') {
      return CELL_BASE_STYLE + 'background:#eef0ef;color:var(--color-text-muted);';
    }
    return CELL_BASE_STYLE + 'color:var(--color-text-muted);';
  }

  function pad2(n) {
    return (n < 10 ? '0' : '') + n;
  }

  function monthCols() {
    var cols = [];
    for (var m = 1; m <= 12; m++) cols.push(pad2(m));
    return cols;
  }

  function render(el, app) {
    var data = app.state.data || {};
    var config = data.config || { stores: [] };
    var records = data.ops_records || [];
    var role = app.state.role;
    if (!app.state.year) app.state.year = YEARS[0];
    var year = app.state.year;

    var stores = (config.stores || []).slice().sort(function (a, b) {
      return a.order - b.order;
    });

    var recordMap = {};
    records.forEach(function (r) { recordMap[r.record_key] = r; });

    var cols = monthCols();

    var headHtml = '<tr>' +
      '<th style="' + CELL_BASE_STYLE + 'text-align:left;background:var(--color-primary-light);">店別</th>' +
      cols.map(function (mm) {
        return '<th style="' + CELL_BASE_STYLE + 'background:var(--color-primary-light);">' + Number(mm) + '月</th>';
      }).join('') +
      '</tr>';

    var bodyHtml = stores.map(function (store) {
      var cells = cols.map(function (mm) {
        var month = year + '-' + mm;
        var key = store.code + '_' + month;
        var rec = recordMap[key];
        var state, label, clickable;
        if (rec && rec.status === '已稽核') {
          state = 'audited';
          label = rec.pass_rate + '%';
          clickable = true;
        } else if (rec && rec.status === '輪休') {
          state = 'rest';
          label = '輪休';
          clickable = false;
        } else {
          state = 'none';
          label = '—';
          clickable = false;
        }
        return '<td class="grid-cell" style="' + cellStyle(state) + '"' +
          ' data-store="' + store.code + '" data-month="' + month + '"' +
          (clickable ? ' data-clickable="1"' : '') + '>' + label + '</td>';
      }).join('');
      return '<tr><th style="' + CELL_BASE_STYLE + 'text-align:left;">' + store.name + '</th>' + cells + '</tr>';
    }).join('');

    var yearOptions = YEARS.map(function (y) {
      return '<option value="' + y + '">' + y + '</option>';
    }).join('');

    var actionsHtml = '';
    if (role === 'accountant') {
      actionsHtml =
        '<div class="overview-actions" style="display:flex;gap:8px;margin-bottom:var(--gap);">' +
          '<button type="button" id="btn-start-ops" class="btn">開始稽核</button>' +
        '</div>';
    }

    el.innerHTML =
      '<h2>營運稽核總覽</h2>' +
      '<div class="overview-toolbar" style="margin-bottom:var(--gap);">' +
        '<label for="ops-overview-year">年份</label>' +
        '<select id="ops-overview-year">' + yearOptions + '</select>' +
      '</div>' +
      actionsHtml +
      '<div class="overview-grid-wrap" style="overflow-x:auto;-webkit-overflow-scrolling:touch;">' +
        '<table class="overview-grid" style="border-collapse:collapse;width:100%;min-width:640px;">' +
          '<thead>' + headHtml + '</thead>' +
          '<tbody>' + bodyHtml + '</tbody>' +
        '</table>' +
      '</div>' +
      '<p style="color:var(--color-text-muted);font-size:0.85rem;">' +
        '格子數字＝合格率（合格數 ÷ ' + (root.OpsChecklist ? root.OpsChecklist.total : 19) + ' 項）。點已稽核的格子看該月報告。' +
      '</p>';

    var yearSel = el.querySelector('#ops-overview-year');
    yearSel.value = year;
    yearSel.addEventListener('change', function () {
      app.state.year = yearSel.value;
      render(el, app);
    });

    var clickableCells = el.querySelectorAll('.grid-cell[data-clickable="1"]');
    for (var i = 0; i < clickableCells.length; i++) {
      clickableCells[i].addEventListener('click', function (e) {
        var cell = e.currentTarget;
        app.navigate('opsreport', {
          store: cell.getAttribute('data-store'),
          month: cell.getAttribute('data-month')
        });
      });
    }

    if (role !== 'accountant') return;
    var startBtn = el.querySelector('#btn-start-ops');
    if (startBtn) {
      startBtn.addEventListener('click', function () {
        app.navigate('ops');
      });
    }
  }

  root.Views = root.Views || {};
  root.Views.opsoverview = { render: render };
})(typeof window !== 'undefined' ? window : this);
