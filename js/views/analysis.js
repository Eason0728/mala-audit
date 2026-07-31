// 異常分析畫面 —— T7 實作
// window.Views.analysis = { render(el, app) }
// 三張表：(a) 累犯品項排行（品項 × 異常次數 × 出現店別/月份）
//         (b) 異常原因分類統計 (c) 各店異常數。
// 契約：只能用 app.state（{role, code, data, year, params}）、app.navigate、app.reload。
// 設計：純表格＋CSS 長條（乾淨大方向，不灑裝飾小圖）。

(function (root) {
  'use strict';

  var Format = root.Format;

  var state = { from: null, to: null }; // 'YYYY-MM' 區間（含端點）；null＝不限

  function esc(v) {
    return String(v === null || v === undefined ? '' : v)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  function storeList(app) {
    var cfg = (app.state.data && app.state.data.config) || {};
    return (cfg.stores || []).slice().sort(function (a, b) { return a.order - b.order; });
  }

  function storeName(app, code) {
    var f = storeList(app).filter(function (s) { return s.code === code; })[0];
    return f ? f.name : (code || '');
  }

  // 所有出現過的年月（由明細＋紀錄取聯集，升冪）
  function monthOptions(app) {
    var data = app.state.data || {};
    var set = {};
    (data.records || []).forEach(function (r) { if (r.month) set[r.month] = true; });
    (data.details || []).forEach(function (d) { if (d.month) set[d.month] = true; });
    return Object.keys(set).sort();
  }

  function inRange(month) {
    if (state.from && month < state.from) return false;
    if (state.to && month > state.to) return false;
    return true;
  }

  // 只取判定＝異常的明細（逐字元照 spec §5 枚舉）
  function anomalyDetails(app) {
    return ((app.state.data && app.state.data.details) || []).filter(function (d) {
      return d.verdict === '異常' && inRange(d.month);
    });
  }

  // ---- (a) 累犯品項排行 ----
  function repeatOffenders(app) {
    var map = {};
    anomalyDetails(app).forEach(function (d) {
      var key = d.item;
      if (!map[key]) map[key] = { item: d.item, count: 0, stores: {}, months: [] };
      map[key].count += 1;
      map[key].stores[d.store] = true;
      map[key].months.push(d.month);
    });
    return Object.keys(map).map(function (k) {
      var row = map[k];
      row.storeCodes = Object.keys(row.stores);
      row.months.sort();
      return row;
    }).sort(function (a, b) {
      if (b.count !== a.count) return b.count - a.count;
      return a.item < b.item ? -1 : 1;
    });
  }

  // ---- (b) 原因分類統計 ----
  function reasonStats(app) {
    var map = {};
    anomalyDetails(app).forEach(function (d) {
      var r = d.reason || '（未填）';
      map[r] = (map[r] || 0) + 1;
    });
    return Object.keys(map).map(function (k) {
      return { reason: k, count: map[k] };
    }).sort(function (a, b) { return b.count - a.count; });
  }

  // ---- (c) 各店異常數（含稽核次數與異常率，看得出比例）----
  function storeStats(app) {
    var details = anomalyDetails(app);
    var records = ((app.state.data && app.state.data.records) || []).filter(function (r) {
      return r.status === '已稽核' && inRange(r.month);
    });
    return storeList(app).map(function (s) {
      var mine = records.filter(function (r) { return r.store === s.code; });
      var anomalies = details.filter(function (d) { return d.store === s.code; }).length;
      var sampled = mine.reduce(function (sum, r) { return sum + (Number(r.sample_count) || 0); }, 0);
      return {
        code: s.code,
        name: s.name,
        anomalies: anomalies,
        audits: mine.length,
        rate: sampled ? Math.round((anomalies / sampled) * 100) : 0
      };
    }).sort(function (a, b) { return b.anomalies - a.anomalies; });
  }

  function bar(count, max) {
    var pct = max ? Math.round((count / max) * 100) : 0;
    return '<span class="an-bar" style="width:' + pct + '%;"></span>';
  }

  var STYLE =
    '<style>' +
    '.an-table{width:100%;border-collapse:collapse;font-size:0.9rem;}' +
    '.an-table th,.an-table td{padding:8px 6px;border-bottom:1px solid var(--color-border);text-align:left;vertical-align:top;}' +
    '.an-table th{color:var(--color-text-muted);font-weight:600;font-size:0.8rem;}' +
    '.an-table td.num{text-align:right;white-space:nowrap;font-variant-numeric:tabular-nums;}' +
    '.an-barcell{padding-top:14px;width:30%;}' +
    '.an-bar{display:block;height:8px;border-radius:4px;background:var(--color-primary);}' +
    '.an-muted{color:var(--color-text-muted);font-size:0.8rem;}' +
    '.an-range{display:flex;gap:8px;align-items:flex-end;flex-wrap:wrap;}' +
    '.an-range label{flex:1;min-width:120px;}' +
    '.an-empty{color:var(--color-text-muted);padding:16px 0;}' +
    '</style>';

  function rangeControls(app) {
    var months = monthOptions(app);
    var opts = function (sel) {
      return '<option value="">不限</option>' + months.map(function (m) {
        return '<option value="' + m + '"' + (sel === m ? ' selected' : '') + '>' +
          m + '（' + esc(Format.monthLabel(m)) + '）</option>';
      }).join('');
    };
    return '<div class="card an-range">' +
      '<label>起<select id="an-from">' + opts(state.from) + '</select></label>' +
      '<label>迄<select id="an-to">' + opts(state.to) + '</select></label>' +
      '</div>';
  }

  function renderRepeat(app) {
    var rows = repeatOffenders(app);
    if (!rows.length) return '<p class="an-empty">此區間沒有異常紀錄。</p>';
    var max = rows[0].count;
    return '<table class="an-table"><thead><tr>' +
      '<th>品項</th><th class="num">異常次數</th><th>出現店別／月份</th><th></th>' +
      '</tr></thead><tbody>' +
      rows.map(function (r) {
        var storesTxt = r.storeCodes.map(function (c) { return storeName(app, c); }).join('、');
        return '<tr>' +
          '<td>' + esc(r.item) + '</td>' +
          '<td class="num">' + r.count + '</td>' +
          '<td><span>' + esc(storesTxt) + '</span><br><span class="an-muted">' +
            esc(r.months.join('、')) + '</span></td>' +
          '<td class="an-barcell">' + bar(r.count, max) + '</td>' +
          '</tr>';
      }).join('') + '</tbody></table>';
  }

  function renderReasons(app) {
    var rows = reasonStats(app);
    if (!rows.length) return '<p class="an-empty">此區間沒有異常紀錄。</p>';
    var max = rows[0].count;
    return '<table class="an-table"><thead><tr>' +
      '<th>異常原因</th><th class="num">次數</th><th></th></tr></thead><tbody>' +
      rows.map(function (r) {
        return '<tr><td>' + esc(r.reason) + '</td><td class="num">' + r.count + '</td>' +
          '<td class="an-barcell">' + bar(r.count, max) + '</td></tr>';
      }).join('') + '</tbody></table>';
  }

  function renderStores(app) {
    var rows = storeStats(app);
    var max = rows.length ? Math.max.apply(null, rows.map(function (r) { return r.anomalies; })) : 0;
    return '<table class="an-table"><thead><tr>' +
      '<th>門市</th><th class="num">異常項數</th><th class="num">稽核次數</th><th class="num">異常率</th><th></th>' +
      '</tr></thead><tbody>' +
      rows.map(function (r) {
        return '<tr><td>' + esc(r.name) + '</td>' +
          '<td class="num">' + r.anomalies + '</td>' +
          '<td class="num">' + r.audits + '</td>' +
          '<td class="num">' + r.rate + '%</td>' +
          '<td class="an-barcell">' + bar(r.anomalies, max) + '</td></tr>';
      }).join('') + '</tbody></table>';
  }

  function render(el, app) {
    var months = monthOptions(app);
    if (state.from && months.indexOf(state.from) === -1) state.from = null;
    if (state.to && months.indexOf(state.to) === -1) state.to = null;

    el.innerHTML = STYLE +
      '<h2>異常分析</h2>' +
      rangeControls(app) +
      '<div class="card"><h3>累犯品項排行</h3><div id="an-repeat">' + renderRepeat(app) + '</div></div>' +
      '<div class="card"><h3>異常原因分類</h3><div id="an-reasons">' + renderReasons(app) + '</div></div>' +
      '<div class="card"><h3>各店異常數</h3><div id="an-stores">' + renderStores(app) + '</div></div>';

    var fromEl = el.querySelector('#an-from');
    var toEl = el.querySelector('#an-to');
    // 起訖顛倒時，剛動的那一欄說了算、另一欄讓位跟上（同一般日期區間選擇器）。
    // 不用「兩欄對調」是因為那會把使用者剛選的值悄悄改成別的月份。
    fromEl.addEventListener('change', function () {
      state.from = fromEl.value || null;
      if (state.from && state.to && state.from > state.to) state.to = state.from;
      render(el, app);
    });
    toEl.addEventListener('change', function () {
      state.to = toEl.value || null;
      if (state.from && state.to && state.from > state.to) state.from = state.to;
      render(el, app);
    });
  }

  root.Views = root.Views || {};
  root.Views.analysis = { render: render };
})(typeof window !== 'undefined' ? window : this);
