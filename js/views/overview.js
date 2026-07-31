// 總覽畫面 —— T3 實作
// window.Views.overview = { render(el, app) }
// 年份切換（先只有 2026）；5 店 × 12 月格狀；格子三態：已稽核(正確率)/輪休/未記錄(—)。
// 點「已稽核」格 → app.navigate('report', {store, month})。
// 會計限定：「開始稽核」→ navigate('audit')；「標記輪休」→ 選店＋選月 → Api.markRest → app.reload()。
// 未在 css/base.css 新增規則（僅允許改 app.js/views/login/views/overview），版面用 inline style。

(function (root) {
  'use strict';

  var YEARS = ['2026']; // 預留多年：之後只要加這個陣列

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
    var records = data.records || [];
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
          label = rec.correct_rate + '%';
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
    var restDialogHtml = '';
    if (role === 'accountant') {
      actionsHtml =
        '<div class="overview-actions" style="display:flex;gap:8px;margin-bottom:var(--gap);">' +
          '<button type="button" id="btn-start-audit" class="btn">開始稽核</button>' +
          '<button type="button" id="btn-mark-rest" class="btn btn-secondary">標記輪休</button>' +
        '</div>';

      var storeOptions = stores.map(function (s) {
        return '<option value="' + s.code + '">' + s.name + '</option>';
      }).join('');
      var monthOptions = cols.map(function (mm) {
        var label = root.Format ? root.Format.monthLabel(year + '-' + mm) : mm;
        return '<option value="' + mm + '">' + label + '</option>';
      }).join('');

      restDialogHtml =
        '<div id="rest-dialog" class="card" hidden>' +
          '<h3 style="margin-top:0;">標記輪休</h3>' +
          '<label for="rest-store">店別</label>' +
          '<select id="rest-store">' + storeOptions + '</select>' +
          '<label for="rest-month" style="margin-top:8px;">月份</label>' +
          '<select id="rest-month">' + monthOptions + '</select>' +
          '<p id="rest-error" class="status-danger" hidden></p>' +
          '<div style="display:flex;gap:8px;margin-top:var(--gap);">' +
            '<button type="button" id="rest-confirm" class="btn">確認</button>' +
            '<button type="button" id="rest-cancel" class="btn btn-secondary">取消</button>' +
          '</div>' +
        '</div>';
    }

    el.innerHTML =
      '<h2>總覽</h2>' +
      '<div class="overview-toolbar" style="margin-bottom:var(--gap);">' +
        '<label for="overview-year">年份</label>' +
        '<select id="overview-year">' + yearOptions + '</select>' +
      '</div>' +
      actionsHtml +
      '<div class="overview-grid-wrap" style="overflow-x:auto;-webkit-overflow-scrolling:touch;">' +
        '<table class="overview-grid" style="border-collapse:collapse;width:100%;min-width:640px;">' +
          '<thead>' + headHtml + '</thead>' +
          '<tbody>' + bodyHtml + '</tbody>' +
        '</table>' +
      '</div>' +
      restDialogHtml;

    // ---- 年份切換 ----
    var yearSel = el.querySelector('#overview-year');
    yearSel.value = year;
    yearSel.addEventListener('change', function () {
      app.state.year = yearSel.value;
      render(el, app);
    });

    // ---- 點已稽核格 → navigate('report', {store, month}) ----
    var clickableCells = el.querySelectorAll('.grid-cell[data-clickable="1"]');
    for (var i = 0; i < clickableCells.length; i++) {
      clickableCells[i].addEventListener('click', function (e) {
        var cell = e.currentTarget;
        app.navigate('report', {
          store: cell.getAttribute('data-store'),
          month: cell.getAttribute('data-month')
        });
      });
    }

    if (role !== 'accountant') return;

    // ---- 開始稽核 ----
    var startBtn = el.querySelector('#btn-start-audit');
    if (startBtn) {
      startBtn.addEventListener('click', function () {
        app.navigate('audit');
      });
    }

    // ---- 標記輪休：選店＋選月 → Api.markRest → app.reload() ----
    var restBtn = el.querySelector('#btn-mark-rest');
    var dialog = el.querySelector('#rest-dialog');
    if (restBtn && dialog) {
      var restErrorEl = dialog.querySelector('#rest-error');
      restBtn.addEventListener('click', function () {
        if (restErrorEl) { restErrorEl.hidden = true; }
        dialog.hidden = false;
      });
      var cancelBtn = dialog.querySelector('#rest-cancel');
      cancelBtn.addEventListener('click', function () {
        dialog.hidden = true;
      });
      var confirmBtn = dialog.querySelector('#rest-confirm');
      confirmBtn.addEventListener('click', function () {
        var storeCode = dialog.querySelector('#rest-store').value;
        var mm = dialog.querySelector('#rest-month').value;
        var month = year + '-' + mm;
        confirmBtn.disabled = true;
        root.Api.markRest(app.state.code, storeCode, month).then(function (res) {
          confirmBtn.disabled = false;
          if (res && res.ok) {
            dialog.hidden = true;
            app.reload();
          } else if (restErrorEl) {
            restErrorEl.textContent = '標記輪休失敗，請重試';
            restErrorEl.hidden = false;
          }
        });
      });
    }
  }

  root.Views = root.Views || {};
  root.Views.overview = { render: render };
})(typeof window !== 'undefined' ? window : this);
