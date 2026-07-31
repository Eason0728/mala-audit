// 稽核填寫畫面（js/views/audit.js）—— 本檔目前實作 T4「抽樣區」；
// T5（填盤點/複盤數、正確/異常判定、金庫區塊、草稿防丟、送出）在本結構上加，不重寫本檔已完成部分。
//
// ---- 跨任務 view 契約（逐字照做，見 task.md「共用介面契約」）----
//   window.Views.audit = { render(el, app) }
//   el  = <section id="view-audit"> 本人（稽核 section 元素）
//   app = { state: {role, code, data, year, params}, navigate(tab, params), reload() }
//         render 時 app.state.data 一定已載入（= Api.getAll 回傳的 {config, items, records, details}）
//
// ---- 給 T5 的擴充點（逐字照做，見交辦 prompt）----
//   window.AuditState = { store, month, items: [{name, unit, lastDrawn}] }
//     —— 目前抽樣清單即時同步於此；使用者每次操作（抽樣/換一項/加入/刪除/切店/切月）都會重新賦值。
//     T5 靠這個物件拿目前清單，不用重新查 DOM。
//   #audit-items      清單容器 <ul>；每列 <li data-item="{品項名}" data-unit="{單位}">
//   #audit-store / #audit-month  選店／選月 <select>，value 分別是店代碼／'YYYY-MM'
//   #audit-count-warning         數量提醒 <p>（≠20 項時顯示，不阻擋送出）
//
// 本任務範圍：選店＋選月、「隨機抽 20 項」、每列「換一項」/「刪除」、手動「加入品項」（datalist）、
// 數量提醒。不含：盤點/複盤數輸入、金庫區塊、送出（T5 範圍）。

(function (root) {
  'use strict';

  function pad2(n) {
    return (n < 10 ? '0' : '') + n;
  }

  function escapeHtml(s) {
    return String(s === null || s === undefined ? '' : s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function getStoreItems(app, storeCode) {
    var items = (app.state.data && app.state.data.items) || [];
    return items.filter(function (it) {
      return it.store === storeCode && it.active !== false;
    });
  }

  function getStoreDetails(app, storeCode) {
    var details = (app.state.data && app.state.data.details) || [];
    return details.filter(function (d) {
      return d.store === storeCode;
    });
  }

  function buildMonthList(year) {
    var months = [];
    for (var mm = 1; mm <= 12; mm++) {
      months.push(year + '-' + pad2(mm));
    }
    return months;
  }

  function render(el, app) {
    var Sampling = root.Sampling;
    var Format = root.Format;

    var data = app.state.data || {};
    var config = data.config || {};
    var stores = (config.stores || []).slice().sort(function (a, b) {
      return (a.order || 0) - (b.order || 0);
    });

    var params = (app.state && app.state.params) || {};
    var now = new Date();
    var realYear = now.getFullYear();
    var realMonthStr = realYear + '-' + pad2(now.getMonth() + 1);

    var year = (app.state && app.state.year) || realYear;
    if (params.month) {
      var parsedYear = Number(String(params.month).split('-')[0]);
      if (parsedYear) year = parsedYear;
    }

    var months = buildMonthList(year);

    var defaultStore = (params.store && stores.some(function (s) { return s.code === params.store; }))
      ? params.store
      : ((stores[0] && stores[0].code) || '');

    var defaultMonth = params.month
      ? params.month
      : (year === realYear ? realMonthStr : months[0]);

    // ---- 畫面狀態（closure，每次 render 重置）----
    var currentStore = defaultStore;
    var currentMonth = defaultMonth;
    var items = []; // [{name, unit, lastDrawn}]

    function syncAuditState() {
      root.AuditState = {
        store: currentStore,
        month: currentMonth,
        items: items.slice()
      };
    }

    // ---- 模板 ----
    el.innerHTML =
      '<h2>稽核填寫</h2>' +
      '<div class="card">' +
        '<label for="audit-store">店</label>' +
        '<select id="audit-store">' +
        stores.map(function (s) {
          return '<option value="' + escapeHtml(s.code) + '">' + escapeHtml(s.name) + '</option>';
        }).join('') +
        '</select>' +
        '<label for="audit-month">月份</label>' +
        '<select id="audit-month">' +
        months.map(function (m) {
          var label = Format ? Format.monthLabel(m) : '';
          return '<option value="' + m + '">' + m + (label ? '（' + label + '）' : '') + '</option>';
        }).join('') +
        '</select>' +
      '</div>' +
      '<div class="card">' +
        '<button type="button" id="audit-draw" class="btn">隨機抽 20 項</button>' +
        '<div id="audit-add-row" style="display:flex;gap:8px;margin-top:var(--gap);align-items:flex-start;">' +
          '<input type="text" id="audit-add-input" list="audit-item-datalist" placeholder="輸入品項名稱加入" style="flex:1;">' +
          '<datalist id="audit-item-datalist"></datalist>' +
          '<button type="button" id="audit-add-btn" class="btn btn-secondary" style="width:auto;white-space:nowrap;">加入品項</button>' +
        '</div>' +
        '<p id="audit-count-warning" hidden ' +
          'style="color:#8a6d00;background:#fff6db;border:1px solid #f0dfa0;border-radius:8px;padding:8px 12px;margin:var(--gap) 0 0;"></p>' +
        '<ul id="audit-items" style="list-style:none;padding:0;margin:var(--gap) 0 0;"></ul>' +
      '</div>';

    var storeSelect = el.querySelector('#audit-store');
    var monthSelect = el.querySelector('#audit-month');
    var drawBtn = el.querySelector('#audit-draw');
    var addInput = el.querySelector('#audit-add-input');
    var addBtn = el.querySelector('#audit-add-btn');
    var datalist = el.querySelector('#audit-item-datalist');
    var itemsEl = el.querySelector('#audit-items');
    var warningEl = el.querySelector('#audit-count-warning');

    if (defaultStore) storeSelect.value = defaultStore;
    monthSelect.value = defaultMonth;

    function currentStoreItems() {
      return getStoreItems(app, currentStore);
    }
    function currentStoreDetails() {
      return getStoreDetails(app, currentStore);
    }

    function renderDatalist() {
      var storeItems = currentStoreItems();
      datalist.innerHTML = storeItems.map(function (it) {
        return '<option value="' + escapeHtml(it.name) + '">';
      }).join('');
    }

    function renderWarning() {
      if (items.length === 20) {
        warningEl.hidden = true;
        warningEl.textContent = '';
      } else {
        warningEl.hidden = false;
        warningEl.textContent = '目前 ' + items.length + ' 項（標準 20 項）';
      }
    }

    function renderItems() {
      itemsEl.innerHTML = items.map(function (it) {
        var flag = it.lastDrawn
          ? '<span class="audit-item-flag" style="color:#a3352a;margin-left:8px;">⚠ ' +
            escapeHtml(it.lastDrawn) + ' 抽過</span>'
          : '';
        return (
          '<li class="audit-item-row" data-item="' + escapeHtml(it.name) + '" data-unit="' + escapeHtml(it.unit) + '" ' +
          'style="display:flex;align-items:center;justify-content:space-between;gap:8px;padding:10px 0;border-bottom:1px solid var(--color-border);">' +
            '<span>' +
              '<span class="audit-item-name">' + escapeHtml(it.name) + '</span>' +
              '<span class="audit-item-unit" style="color:var(--color-text-muted);margin-left:4px;">(' + escapeHtml(it.unit) + ')</span>' +
              flag +
            '</span>' +
            '<span style="white-space:nowrap;">' +
              '<button type="button" class="audit-item-redraw" data-name="' + escapeHtml(it.name) + '">換一項</button>' +
              '<button type="button" class="audit-item-remove" data-name="' + escapeHtml(it.name) + '" style="margin-left:6px;">刪除</button>' +
            '</span>' +
          '</li>'
        );
      }).join('');
      renderWarning();
      syncAuditState();
    }

    function setItems(newItems) {
      items = newItems;
      renderItems();
    }

    function addItemByName(name) {
      if (!name) return;
      var storeItems = currentStoreItems();
      var target = storeItems.filter(function (it) { return it.name === name; })[0];
      if (!target) return; // 不在該店品項庫，忽略
      var currentNames = items.map(function (it) { return it.name; });
      if (currentNames.indexOf(name) !== -1) return; // 已在清單中
      // 重用 redrawOne：候選池只放這一個目標品項，即可拿到含 lastDrawn 的結果，不必另開純函式
      var picked = Sampling.redrawOne(currentNames, [target], currentStoreDetails());
      if (picked) {
        items = items.concat([picked]);
        renderItems();
        addInput.value = '';
      }
    }

    // ---- 事件 ----
    storeSelect.addEventListener('change', function () {
      currentStore = storeSelect.value;
      renderDatalist();
      setItems([]);
    });

    monthSelect.addEventListener('change', function () {
      currentMonth = monthSelect.value;
      syncAuditState();
    });

    drawBtn.addEventListener('click', function () {
      var storeItems = currentStoreItems();
      var storeDetails = currentStoreDetails();
      setItems(Sampling.drawSample(storeItems, storeDetails, 20));
    });

    addBtn.addEventListener('click', function () {
      addItemByName(addInput.value.trim());
    });

    addInput.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') {
        e.preventDefault();
        addItemByName(addInput.value.trim());
      }
    });

    itemsEl.addEventListener('click', function (e) {
      var target = e.target;
      var redrawBtn = target.closest ? target.closest('.audit-item-redraw') : null;
      var removeBtn = target.closest ? target.closest('.audit-item-remove') : null;

      if (redrawBtn) {
        var name = redrawBtn.getAttribute('data-name');
        var idx = -1;
        items.forEach(function (it, i) { if (it.name === name) idx = i; });
        if (idx === -1) return;
        var currentNames = items.map(function (it) { return it.name; });
        var replacement = Sampling.redrawOne(currentNames, currentStoreItems(), currentStoreDetails());
        if (replacement) {
          items = items.slice();
          items[idx] = replacement;
          renderItems();
        } else {
          warningEl.hidden = false;
          warningEl.textContent = '已無其他品項可替換';
          setTimeout(renderWarning, 2000);
        }
      } else if (removeBtn) {
        var rmName = removeBtn.getAttribute('data-name');
        items = items.filter(function (it) { return it.name !== rmName; });
        renderItems();
      }
    });

    renderDatalist();
    renderItems();
    syncAuditState();
  }

  root.Views = root.Views || {};
  root.Views.audit = { render: render };
})(typeof window !== 'undefined' ? window : this);
