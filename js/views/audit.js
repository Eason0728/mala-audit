// 稽核填寫畫面（js/views/audit.js）—— T4「抽樣區」＋T5「填寫／金庫／草稿／送出」皆已實作。
//
// ---- 跨任務 view 契約（逐字照做，見 task.md「共用介面契約」）----
//   window.Views.audit = { render(el, app) }
//   el  = <section id="view-audit"> 本人（稽核 section 元素）
//   app = { state: {role, code, data, year, params}, navigate(tab, params), reload() }
//         render 時 app.state.data 一定已載入（= Api.getAll 回傳的 {config, items, records, details}）
//
// ---- window.AuditState（抽樣清單即時同步，跨畫面唯讀用）----
//   window.AuditState = { store, month, items: [{name, unit, lastDrawn, book_qty, recount_qty, verdict, reason, note}] }
//   #audit-items      清單容器 <ul>；每列 <li data-item="{品項名}" data-unit="{單位}">
//   #audit-store / #audit-month  選店／選月 <select>，value 分別是店代碼／'YYYY-MM'
//   #audit-count-warning         數量提醒 <p>（≠20 項時顯示，不阻擋送出）
//
// ---- T5 新增（本檔）----
//   每列：門市盤點數／會計複盤數（number，可小數）＋正確/異常核定；異常展開原因下拉＋備註。
//   金庫區塊：零找金／零用金 正確/不正確（顯示標準）、小費金額＋相符/不相符、整單備註。
//   草稿：localStorage key=`draft_{record_key}`，每次輸入即存；選同店同月自動還原；送出成功才清。
//   送出：前端驗證 → 覆蓋確認（若同 record_key 已有紀錄）→ Api.submitAudit → 成功清草稿＋
//         app.reload()＋navigate('report',{store,month})；失敗草稿保留＋顯示「送出失敗」＋「重試送出」。
//
// ---- 填寫方式兩種模式（2026-08-07 新增）----
//   'full'（完整 N 項，原行為）：抽滿 SAMPLE_SIZE 項逐項核定正確／異常，
//                              分母＝實際清單項數。
//   'anomaly'（只填異常項）    ：只輸入異常的品項，其餘視同正確，
//                              分母固定＝Config.SAMPLE_SIZE（預設 20）。
//                              例：只填 1 項異常 → 19/20 → 正確率 95%。
//   模式記在 localStorage['audit_fill_mode']（跨店月、跨 session 記住上次選的）。
//   兩模式的草稿分開存（anomaly 模式 key 多後綴 `_anomaly`）：切模式不會弄丟另一邊已填的內容，
//   切回去原樣還在。送出成功時兩把 key 都清掉，避免舊草稿之後又冒出來。

(function (root) {
  'use strict';

  var MODE_KEY = 'audit_fill_mode';   // localStorage：記住上次選的填寫方式
  var LAST_STORE_KEY = 'audit_last_store'; // localStorage：記住上次稽核的是哪家店（報告頁沿用）
  var MODE_FULL = 'full';
  var MODE_ANOMALY = 'anomaly';

  function pad2(n) {
    return (n < 10 ? '0' : '') + n;
  }

  // 標準抽查項數：唯一來源是 Config.SAMPLE_SIZE；讀不到時保守回 20
  function sampleSize(root_) {
    var n = root_.Config && Number(root_.Config.SAMPLE_SIZE);
    return n > 0 ? n : 20;
  }

  function loadMode() {
    try {
      var m = localStorage.getItem(MODE_KEY);
      return m === MODE_ANOMALY ? MODE_ANOMALY : MODE_FULL;
    } catch (e) {
      return MODE_FULL;
    }
  }

  function persistMode(mode) {
    try { localStorage.setItem(MODE_KEY, mode); } catch (e) { /* 儲存空間不可用時忽略 */ }
  }

  // 找某家店最近一份「有內容的未送出草稿」→ {month, mode}；沒有回 null。
  // 用途：重開稽核填寫時，除了回到上次那家店，還要**落在那份草稿的月份**上，
  // 否則只回到店、月份卻是當月，畫面照樣空的，看起來還是像內容不見了
  // （2026-08-07 線上冒煙測到：回到墨竹亭光復但停在八月，草稿其實在十月）。
  function latestDraftForStore(store) {
    var best = null;
    if (!store) return null;
    try {
      for (var i = 0; i < localStorage.length; i++) {
        var k = localStorage.key(i);
        if (!k || k.indexOf('draft_') !== 0) continue;
        var payload = null;
        try { payload = JSON.parse(localStorage.getItem(k)); } catch (e) { continue; }
        if (!payload || payload.store !== store || !payload.month) continue;
        var hasItems = (payload.items || []).length > 0;
        var v = payload.vault || {};
        var hasVault = !!(v.change_fund || v.petty_cash || v.tip_amount || v.tip_match || v.note);
        if (!hasItems && !hasVault) continue;
        if (!best || payload.month > best.month) {
          best = { month: payload.month, mode: /_anomaly$/.test(k) ? MODE_ANOMALY : MODE_FULL };
        }
      }
    } catch (e) { /* 儲存空間不可用時當作沒草稿 */ }
    return best;
  }

  function escapeHtml(s) {
    return String(s === null || s === undefined ? '' : s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function qtyAttr(v) {
    return escapeHtml(v === undefined || v === null ? '' : v);
  }

  // 標準金額顯示：10000 → '1 萬'；整萬數一律顯示「N 萬」；其他原數字顯示
  function stdLabel(std) {
    if (typeof std !== 'number' || !std) return String(std || '');
    if (std % 10000 === 0) return (std / 10000) + ' 萬';
    return String(std);
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

  // ---- 畫面內嵌樣式（僅本檔可改；同 report.js 慣例，用 JS 內嵌 <style>）----
  var STYLE =
    '<style>' +
    '.audit-item-fill{margin-top:10px;padding-top:10px;border-top:1px dashed var(--color-border);}' +
    '.audit-item-qty-row{display:flex;gap:8px;}' +
    '.audit-item-qty-row label{flex:1;font-size:0.85rem;}' +
    '.audit-choice-group{display:flex;gap:8px;margin-top:8px;}' +
    '.audit-verdict-btn,.audit-vault-btn,.audit-mode-btn{flex:1;padding:10px;border-radius:var(--radius);' +
    'border:1px solid var(--color-primary);background:var(--color-surface);color:var(--color-primary);font-weight:600;}' +
    '.audit-verdict-btn.active,.audit-vault-btn.active,.audit-mode-btn.active{background:var(--color-primary);color:#fff;}' +
    '#audit-mode-hint{margin:8px 0 0;font-size:0.85rem;color:var(--color-text-muted);}' +
    '#audit-add-hint{margin:6px 0 0;font-size:0.8rem;color:var(--color-text-muted);}' +
    '.audit-draft-row{display:flex;gap:8px;align-items:center;padding:8px 0;' +
    'border-bottom:1px solid var(--color-border);}' +
    '.audit-draft-row:last-child{border-bottom:none;}' +
    '.audit-draft-resume{flex:1;text-align:left;padding:8px 10px;border-radius:var(--radius);' +
    'border:1px solid var(--color-primary);background:var(--color-surface);color:var(--color-primary);font-weight:600;}' +
    '.audit-draft-meta{display:block;font-weight:400;font-size:0.8rem;color:var(--color-text-muted);margin-top:2px;}' +
    '.audit-draft-drop{flex:none;padding:8px 10px;border-radius:var(--radius);' +
    'border:1px solid var(--color-border);background:var(--color-surface);color:var(--color-text-muted);}' +
    '.audit-unit-fix{flex:none;width:88px;}' +
    '#audit-count-warning{border-radius:8px;padding:8px 12px;margin:var(--gap) 0 0;}' +
    '#audit-count-warning.warn{color:#8a6d00;background:#fff6db;border:1px solid #f0dfa0;}' +
    '#audit-count-warning.info{color:var(--color-text);background:var(--color-primary-light);border:1px solid transparent;}' +
    '#audit-count-warning.bad{color:#a3352a;background:#fdecea;border:1px solid #f3bfb8;}' +
    '.audit-anomaly-detail{margin-top:8px;padding:10px;background:var(--color-primary-light);border-radius:var(--radius);}' +
    '.audit-anomaly-detail label{margin-top:6px;}' +
    '.audit-anomaly-detail label:first-child{margin-top:0;}' +
    '.audit-vault-row{margin-bottom:12px;}' +
    '.audit-vault-row:last-child{margin-bottom:0;}' +
    '#audit-submit-error{white-space:pre-line;}' +
    '#audit-overwrite-dialog{border-color:var(--color-danger);}' +
    '</style>';

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

    // 預設店：從總覽點格子進來 → 那一格的店；否則沿用上次填的那家（草稿才回得去，
    // 2026-08-07 Eason 回報「填一半跳出去就被重置」的真正原因是這裡固定跳回第一家）。
    function pickDefaultStore() {
      var codes = stores.map(function (s) { return s.code; });
      if (params.store && codes.indexOf(params.store) !== -1) return params.store;
      try {
        var saved = localStorage.getItem(LAST_STORE_KEY);
        if (saved && codes.indexOf(saved) !== -1) return saved;
      } catch (e) { /* 儲存空間不可用時忽略 */ }
      return codes[0] || '';
    }
    var defaultStore = pickDefaultStore();

    // 不是從總覽點格子進來時，若這家店有未送出的草稿，就直接落在那份草稿的月份與模式上。
    var resumeDraftTarget = params.month ? null : latestDraftForStore(defaultStore);

    var year = (app.state && app.state.year) || realYear;
    var yearSource = params.month || (resumeDraftTarget && resumeDraftTarget.month);
    if (yearSource) {
      var parsedYear = Number(String(yearSource).split('-')[0]);
      if (parsedYear) year = parsedYear;
    }

    var months = buildMonthList(year);

    var defaultMonth = params.month
      ? params.month
      : (resumeDraftTarget
          ? resumeDraftTarget.month
          : (String(year) === String(realYear) ? realMonthStr : months[0]));

    // ---- 畫面狀態（closure，每次 render 重置）----
    var SAMPLE_SIZE = sampleSize(root);
    var mode = resumeDraftTarget ? resumeDraftTarget.mode : loadMode();
    var currentStore = defaultStore;
    var currentMonth = defaultMonth;
    var items = []; // [{name, unit, lastDrawn, book_qty, recount_qty, verdict, reason, note}]
    var vaultState = { change_fund: '', petty_cash: '', tip_amount: '', tip_match: '', note: '' };

    function syncAuditState() {
      root.AuditState = {
        store: currentStore,
        month: currentMonth,
        mode: mode,
        sampleSize: SAMPLE_SIZE,
        items: items.slice()
      };
      // 報告頁沿用這家店當預設，省得每次進報告都要再選一次
      try {
        if (currentStore) localStorage.setItem(LAST_STORE_KEY, currentStore);
      } catch (e) { /* 儲存空間不可用時忽略 */ }
    }

    function isAnomalyMode() {
      return mode === MODE_ANOMALY;
    }

    // ---- 品項填值正規化：確保每項都有 T5 的欄位（預設空）----
    // 只填異常項模式下，清單裡的每一項本來就是異常項，判定直接固定成「異常」——
    // 畫面不再顯示正確／異常按鈕，也就沒有「忘了核定」這種狀態。
    function normalizeItem(it) {
      return {
        name: it.name,
        unit: it.unit || '',   // 品項庫可能沒填單位（58 項留空），統一成空字串好判斷
        lastDrawn: it.lastDrawn || null,
        book_qty: it.book_qty !== undefined && it.book_qty !== null ? it.book_qty : '',
        recount_qty: it.recount_qty !== undefined && it.recount_qty !== null ? it.recount_qty : '',
        verdict: isAnomalyMode() ? '異常' : (it.verdict || ''),
        reason: it.reason || '',
        note: it.note || ''
      };
    }

    // ---- 草稿：localStorage key=`draft_{record_key}`（每次變動即存；選同店月自動還原）----
    // 兩種填寫方式各存各的（只填異常項多後綴 `_anomaly`）：切模式不會蓋掉另一邊已填的內容。
    // 完整模式沿用原本的 key，舊草稿不會因為這次改版失效。
    function draftKeyFor(m) {
      return 'draft_' + Format.recordKey(currentStore, currentMonth) +
        (m === MODE_ANOMALY ? '_anomaly' : '');
    }

    function draftKey() {
      return draftKeyFor(mode);
    }

    function saveDraft() {
      if (!currentStore || !currentMonth) return;
      try {
        var payload = {
          store: currentStore,
          month: currentMonth,
          items: items.map(function (it) {
            return {
              name: it.name, unit: it.unit, lastDrawn: it.lastDrawn,
              book_qty: it.book_qty, recount_qty: it.recount_qty,
              verdict: it.verdict, reason: it.reason, note: it.note
            };
          }),
          vault: vaultState
        };
        localStorage.setItem(draftKey(), JSON.stringify(payload));
      } catch (e) { /* 儲存空間不可用時忽略，不擋操作 */ }
    }

    function loadDraft() {
      try {
        var raw = localStorage.getItem(draftKey());
        if (!raw) return null;
        return JSON.parse(raw);
      } catch (e) {
        return null;
      }
    }

    // 送出成功時兩種模式的草稿一起清：只清當前模式的話，
    // 另一把舊 key 會在切模式時被還原成「這個月還沒送出」的樣子。
    function clearDraft() {
      try {
        localStorage.removeItem(draftKeyFor(MODE_FULL));
        localStorage.removeItem(draftKeyFor(MODE_ANOMALY));
      } catch (e) { /* 忽略 */ }
    }

    // ---- 模板 ----
    el.innerHTML =
      STYLE +
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
      '<div class="card" id="audit-drafts-card" hidden>' +
        '<h3 style="margin:0 0 8px;font-size:1rem;">未送出的草稿</h3>' +
        '<p style="margin:0 0 8px;font-size:0.85rem;color:var(--color-text-muted);">' +
          '填到一半離開的內容都還在，點一下就接著填。</p>' +
        '<ul id="audit-drafts-list" style="list-style:none;padding:0;margin:0;"></ul>' +
      '</div>' +
      '<div class="card">' +
        '<label>填寫方式</label>' +
        '<div class="audit-choice-group" id="audit-mode-group">' +
          '<button type="button" class="audit-mode-btn" data-mode="' + MODE_FULL + '">完整 ' + SAMPLE_SIZE + ' 項</button>' +
          '<button type="button" class="audit-mode-btn" data-mode="' + MODE_ANOMALY + '">只填異常項</button>' +
        '</div>' +
        '<p id="audit-mode-hint"></p>' +
      '</div>' +
      '<div class="card">' +
        '<button type="button" id="audit-draw" class="btn">隨機抽 ' + SAMPLE_SIZE + ' 項</button>' +
        '<div id="audit-add-row" style="margin-top:var(--gap);">' +
          '<input type="text" id="audit-add-input" list="audit-item-datalist" placeholder="輸入品項名稱加入">' +
          '<datalist id="audit-item-datalist"></datalist>' +
          '<div style="display:flex;gap:8px;margin-top:8px;align-items:flex-start;">' +
            '<input type="text" id="audit-add-unit" placeholder="單位" style="width:88px;flex:none;">' +
            '<button type="button" id="audit-add-btn" class="btn btn-secondary" style="flex:1;white-space:nowrap;">加入品項</button>' +
          '</div>' +
          '<p id="audit-add-hint"></p>' +
        '</div>' +
        '<p id="audit-add-error" class="status-danger" hidden style="margin:8px 0 0;"></p>' +
        '<p id="audit-count-warning" hidden></p>' +
        '<ul id="audit-items" style="list-style:none;padding:0;margin:var(--gap) 0 0;"></ul>' +
      '</div>' +
      '<div class="card" id="audit-vault-card">' +
        '<h3 style="margin-top:0;">金庫抽查</h3>' +
        '<div id="audit-vault-body"></div>' +
        '<label for="audit-note" style="margin-top:12px;">整單備註</label>' +
        '<textarea id="audit-note" rows="3" placeholder="（選填）"></textarea>' +
      '</div>' +
      '<p id="audit-submit-error" class="status-danger" hidden></p>' +
      '<div id="audit-overwrite-dialog" class="card" hidden>' +
        '<p id="audit-overwrite-text"></p>' +
        '<div style="display:flex;gap:8px;">' +
          '<button type="button" id="audit-overwrite-confirm" class="btn">確認覆蓋送出</button>' +
          '<button type="button" id="audit-overwrite-cancel" class="btn btn-secondary">取消</button>' +
        '</div>' +
      '</div>' +
      '<button type="button" id="audit-submit-btn" class="btn" style="margin-top:var(--gap);">送出稽核</button>' +
      '<button type="button" id="audit-retry-btn" class="btn" style="margin-top:8px;" hidden>重試送出</button>';

    var storeSelect = el.querySelector('#audit-store');
    var monthSelect = el.querySelector('#audit-month');
    var draftsCard = el.querySelector('#audit-drafts-card');
    var draftsList = el.querySelector('#audit-drafts-list');
    var modeGroup = el.querySelector('#audit-mode-group');
    var modeHint = el.querySelector('#audit-mode-hint');
    var drawBtn = el.querySelector('#audit-draw');
    var addInput = el.querySelector('#audit-add-input');
    var addUnitInput = el.querySelector('#audit-add-unit');
    var addBtn = el.querySelector('#audit-add-btn');
    var addErrorEl = el.querySelector('#audit-add-error');
    var addHintEl = el.querySelector('#audit-add-hint');
    var datalist = el.querySelector('#audit-item-datalist');
    var itemsEl = el.querySelector('#audit-items');
    var warningEl = el.querySelector('#audit-count-warning');
    var vaultBodyEl = el.querySelector('#audit-vault-body');
    var noteEl = el.querySelector('#audit-note');
    var submitErrorEl = el.querySelector('#audit-submit-error');
    var overwriteDialog = el.querySelector('#audit-overwrite-dialog');
    var overwriteText = el.querySelector('#audit-overwrite-text');
    var overwriteConfirmBtn = el.querySelector('#audit-overwrite-confirm');
    var overwriteCancelBtn = el.querySelector('#audit-overwrite-cancel');
    var submitBtn = el.querySelector('#audit-submit-btn');
    var retryBtn = el.querySelector('#audit-retry-btn');

    if (defaultStore) storeSelect.value = defaultStore;
    monthSelect.value = defaultMonth;

    function currentStoreItems() {
      return getStoreItems(app, currentStore);
    }
    function currentStoreDetails() {
      return getStoreDetails(app, currentStore);
    }

    function findIndexByName(name) {
      for (var i = 0; i < items.length; i++) {
        if (items[i].name === name) return i;
      }
      return -1;
    }

    function renderDatalist() {
      var storeItems = currentStoreItems();
      datalist.innerHTML = storeItems.map(function (it) {
        return '<option value="' + escapeHtml(it.name) + '">';
      }).join('');
    }

    function setWarning(text, kind) {
      warningEl.className = kind || '';
      warningEl.textContent = text || '';
      warningEl.hidden = !text;
    }

    // 只填異常項模式：異常數超過標準項數就沒有意義（正確項會變負數），擋下並提示。
    function tooManyAnomalies() {
      return isAnomalyMode() && items.length > SAMPLE_SIZE;
    }

    function renderWarning() {
      if (isAnomalyMode()) {
        if (tooManyAnomalies()) {
          setWarning('異常 ' + items.length + ' 項，已超過標準 ' + SAMPLE_SIZE +
            ' 項，請刪除多餘項目後再送出', 'bad');
          return;
        }
        var counts = Format.anomalyOnlyCounts(items.length, SAMPLE_SIZE);
        setWarning('異常 ' + items.length + ' 項，其餘視同正確 → 正確率 ' +
          counts.correct_rate + '%（' + counts.correct_count + '／' + SAMPLE_SIZE + '，分母固定 ' +
          SAMPLE_SIZE + ' 項）', 'info');
        return;
      }
      if (items.length === SAMPLE_SIZE) {
        setWarning('', '');
      } else {
        setWarning('目前 ' + items.length + ' 項（標準 ' + SAMPLE_SIZE + ' 項）', 'warn');
      }
    }

    function hideAddError() {
      addErrorEl.hidden = true;
      addErrorEl.textContent = '';
    }

    function showAddError(msg) {
      addErrorEl.textContent = msg;
      addErrorEl.hidden = false;
    }

    // 依模式切換抽樣區的樣貌：只填異常項時沒有「抽樣」這件事，隱藏抽樣鈕、
    // 輸入框改成登記異常品項。
    function renderMode() {
      var btns = modeGroup.querySelectorAll('.audit-mode-btn');
      for (var i = 0; i < btns.length; i++) {
        var m = btns[i].getAttribute('data-mode');
        if (m === mode) {
          btns[i].classList.add('active');
        } else {
          btns[i].classList.remove('active');
        }
      }
      if (isAnomalyMode()) {
        modeHint.textContent = '只輸入異常的品項，其餘視同正確；正確率固定以 ' +
          SAMPLE_SIZE + ' 項為分母計算。';
        drawBtn.hidden = true;
        addInput.placeholder = '輸入異常品項名稱加入';
        addBtn.textContent = '加入異常品項';
      } else {
        modeHint.textContent = '抽滿 ' + SAMPLE_SIZE + ' 項逐項核定，正確率以實際清單項數為分母。';
        drawBtn.hidden = false;
        addInput.placeholder = '輸入品項名稱加入';
        addBtn.textContent = '加入品項';
      }
      hideAddError();
      addHintEl.textContent = '';
      addUnitInput.value = '';
      if (addUnitInput.dataset) addUnitInput.dataset.fromLibrary = '0';
    }

    function reasonOptionsHtml(selectedReason) {
      var reasons = config.reasons || [];
      return '<option value="">請選擇</option>' + reasons.map(function (r) {
        return '<option value="' + escapeHtml(r) + '"' + (selectedReason === r ? ' selected' : '') + '>' +
          escapeHtml(r) + '</option>';
      }).join('');
    }

    function renderItems() {
      var anomalyMode = isAnomalyMode();
      itemsEl.innerHTML = items.map(function (it) {
        var flag = it.lastDrawn
          ? '<span class="audit-item-flag" style="color:#a3352a;margin-left:8px;">⚠ ' +
            escapeHtml(it.lastDrawn) + ' 抽過</span>'
          : '';
        var isAnomaly = anomalyMode || it.verdict === '異常';
        var notePlaceholder = it.reason === '其他' ? '必填：請說明原因' : '選填';
        return (
          '<li class="audit-item-row" data-item="' + escapeHtml(it.name) + '" data-unit="' + escapeHtml(it.unit) + '" ' +
          'style="padding:10px 0;border-bottom:1px solid var(--color-border);">' +
            '<div style="display:flex;align-items:center;justify-content:space-between;gap:8px;">' +
              '<span>' +
                '<span class="audit-item-name">' + escapeHtml(it.name) + '</span>' +
                (it.unit
                  ? '<span class="audit-item-unit" style="color:var(--color-text-muted);margin-left:4px;">(' + escapeHtml(it.unit) + ')</span>'
                  : '<span class="audit-item-unit" style="color:#a3352a;margin-left:4px;">(缺單位)</span>') +
                flag +
              '</span>' +
              '<span style="white-space:nowrap;">' +
                (anomalyMode ? '' :
                  '<button type="button" class="audit-item-redraw" data-name="' + escapeHtml(it.name) + '">換一項</button>') +
                '<button type="button" class="audit-item-remove" data-name="' + escapeHtml(it.name) + '" style="margin-left:6px;">刪除</button>' +
              '</span>' +
            '</div>' +
            '<div class="audit-item-fill">' +
              '<div class="audit-item-qty-row">' +
                '<label>門市盤點數<input type="number" step="any" inputmode="decimal" class="audit-book-qty" value="' + qtyAttr(it.book_qty) + '"></label>' +
                '<label>會計複盤數<input type="number" step="any" inputmode="decimal" class="audit-recount-qty" value="' + qtyAttr(it.recount_qty) + '"></label>' +
                // 品項庫有 58 項當初從 PDF 解析時沒印單位、留空，抽到這種項目異常說明會少一塊
                // （2026-08-07 實查：sxl-gf 八月的台灣白芝麻粒就印成「盤點2.8，覆盤2」）。
                // 缺單位的當場補，不用回試算表改。
                (it.unit ? '' :
                  '<label class="audit-unit-fix">單位<input type="text" class="audit-item-unit-input" value="" placeholder="例：包"></label>') +
              '</div>' +
              // 只填異常項模式下每一項都是異常，不需要（也不該）再核定一次
              (anomalyMode ? '' :
                '<div class="audit-choice-group">' +
                  '<button type="button" class="audit-verdict-btn' + (it.verdict === '正確' ? ' active' : '') + '" data-verdict="正確">正確</button>' +
                  '<button type="button" class="audit-verdict-btn' + (isAnomaly ? ' active' : '') + '" data-verdict="異常">異常</button>' +
                '</div>') +
              '<div class="audit-anomaly-detail"' + (isAnomaly ? '' : ' hidden') + '>' +
                '<label>異常原因<select class="audit-reason">' + reasonOptionsHtml(it.reason) + '</select></label>' +
                '<label>備註<input type="text" class="audit-item-note" value="' + escapeHtml(it.note || '') + '" placeholder="' + notePlaceholder + '"></label>' +
              '</div>' +
            '</div>' +
          '</li>'
        );
      }).join('');
      renderWarning();
      syncAuditState();
      saveDraft();
    }

    function setItems(newItems) {
      items = newItems;
      renderItems();
    }

    // 找該店品項庫裡同名的項目；找不到回 null（＝自訂品項）
    function libraryItem(name) {
      return currentStoreItems().filter(function (it) { return it.name === name; })[0] || null;
    }

    // 名稱框有動就更新單位：打到品項庫有的名稱自動帶單位，
    // 打庫裡沒有的就把欄位讓出來自己填（Eason 2026-08-07：品項建立不綁定品項庫）。
    function syncUnitField() {
      var name = addInput.value.trim();
      var hit = name ? libraryItem(name) : null;
      if (hit) {
        addUnitInput.value = hit.unit || '';
        addHintEl.textContent = '品項庫裡有這一項，單位自動帶入（可改）';
      } else if (name) {
        if (addUnitInput.dataset && addUnitInput.dataset.fromLibrary === '1') {
          addUnitInput.value = '';
        }
        addHintEl.textContent = '品項庫沒有這一項，可以直接加入，請填單位（例：包、盒、公斤）';
      } else {
        addHintEl.textContent = '';
      }
      if (addUnitInput.dataset) addUnitInput.dataset.fromLibrary = hit ? '1' : '0';
    }

    // 加入一項：品項庫有沒有都能加，差別只在單位是自動帶還是自己填。
    function addItemByName(name) {
      hideAddError();
      if (!name) {
        showAddError('請先輸入品項名稱');
        return;
      }
      var currentNames = items.map(function (it) { return it.name; });
      if (currentNames.indexOf(name) !== -1) {
        showAddError('「' + name + '」已在清單中');
        return;
      }
      var hit = libraryItem(name);
      var unit = hit ? (addUnitInput.value.trim() || hit.unit || '') : addUnitInput.value.trim();
      // 單位不能省：異常說明要組「盤點27盒」這種字，沒單位那行會缺一塊。
      // 兩種缺法要分開講——品項庫根本沒這項，跟品項庫有但當初單位就留空（58 項是這樣），
      // 講錯會讓人以為自己打錯字。
      if (!unit) {
        showAddError(hit
          ? '品項庫沒有填「' + name + '」的單位，請補一個（例：包、盒、公斤）'
          : '「' + name + '」不在品項庫，請一併填單位（例：包、盒、公斤）');
        addUnitInput.focus();
        return;
      }
      items = items.concat([normalizeItem({
        name: name,
        unit: unit,
        lastDrawn: Sampling.lastDrawnOf(name, currentStoreDetails())
      })]);
      renderItems();
      addInput.value = '';
      addUnitInput.value = '';
      if (addUnitInput.dataset) addUnitInput.dataset.fromLibrary = '0';
      addHintEl.textContent = '';
    }

    // ---- 金庫區 ----
    function vaultChoiceGroup(group, options, current) {
      return '<div class="audit-choice-group" data-group="' + group + '">' +
        options.map(function (v) {
          return '<button type="button" class="audit-vault-btn' + (current === v ? ' active' : '') + '" ' +
            'data-group="' + group + '" data-value="' + v + '">' + escapeHtml(v) + '</button>';
        }).join('') +
      '</div>';
    }

    function renderVaultBody() {
      vaultBodyEl.innerHTML =
        '<div class="audit-vault-row">' +
          '<label>零找金（標準 ' + escapeHtml(stdLabel(config.change_fund_std)) + '）</label>' +
          vaultChoiceGroup('change_fund', ['正確', '不正確'], vaultState.change_fund) +
        '</div>' +
        '<div class="audit-vault-row">' +
          '<label>零用金（標準 ' + escapeHtml(stdLabel(config.petty_cash_std)) + '）</label>' +
          vaultChoiceGroup('petty_cash', ['正確', '不正確'], vaultState.petty_cash) +
        '</div>' +
        '<div class="audit-vault-row">' +
          '<label for="audit-tip-amount">小費金額</label>' +
          '<input type="number" step="any" inputmode="decimal" id="audit-tip-amount" value="' + qtyAttr(vaultState.tip_amount) + '">' +
          vaultChoiceGroup('tip_match', ['相符', '不相符'], vaultState.tip_match) +
        '</div>';
    }

    function renderVault() {
      renderVaultBody();
      noteEl.value = vaultState.note || '';
    }

    // ---- 驗證（spec §7；枚舉逐字元）----
    function isBlankNumber(v) {
      return v === '' || v === null || v === undefined || isNaN(Number(v));
    }

    function validate() {
      var errors = [];
      var anomalyMode = isAnomalyMode();
      // 只填異常項模式：0 項異常是合法的（＝全部正確，正確率 100%），不能擋。
      if (!anomalyMode && items.length === 0) {
        errors.push('尚未抽樣，清單是空的');
      }
      if (tooManyAnomalies()) {
        errors.push('異常 ' + items.length + ' 項，已超過標準 ' + SAMPLE_SIZE + ' 項，請刪除多餘項目');
      }
      items.forEach(function (it, idx) {
        var label = (idx + 1) + '.' + it.name;
        // 單位不分來源都要有：品項庫本身就有 58 項單位留空，抽到那些項目
        // 異常說明會印成「盤點2.8，覆盤2」少一塊（2026-08-07 實查到真實案例）
        if (!it.unit || !String(it.unit).trim()) errors.push(label + '：缺單位，請在該列補上');
        if (isBlankNumber(it.book_qty)) errors.push(label + '：門市盤點數未填');
        if (isBlankNumber(it.recount_qty)) errors.push(label + '：會計複盤數未填');
        if (anomalyMode) {
          if (!it.reason) {
            errors.push(label + '：異常需選擇原因');
          } else if (it.reason === '其他' && !(it.note && it.note.trim())) {
            errors.push(label + '：原因為「其他」需填寫備註');
          }
          return;
        }
        if (it.verdict !== '正確' && it.verdict !== '異常') {
          errors.push(label + '：尚未核定正確／異常');
        } else if (it.verdict === '異常') {
          if (!it.reason) {
            errors.push(label + '：異常需選擇原因');
          } else if (it.reason === '其他' && !(it.note && it.note.trim())) {
            errors.push(label + '：原因為「其他」需填寫備註');
          }
        }
      });
      if (vaultState.change_fund !== '正確' && vaultState.change_fund !== '不正確') {
        errors.push('零找金尚未核定');
      }
      if (vaultState.petty_cash !== '正確' && vaultState.petty_cash !== '不正確') {
        errors.push('零用金尚未核定');
      }
      if (isBlankNumber(vaultState.tip_amount)) {
        errors.push('小費金額未填');
      }
      if (vaultState.tip_match !== '相符' && vaultState.tip_match !== '不相符') {
        errors.push('小費是否相符尚未核定');
      }
      return errors;
    }

    function todayStr() {
      var d = new Date();
      return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
    }

    function nowIso() {
      var d = new Date();
      var tzOffsetMin = -d.getTimezoneOffset();
      var sign = tzOffsetMin >= 0 ? '+' : '-';
      var abs = Math.abs(tzOffsetMin);
      var oh = pad2(Math.floor(abs / 60));
      var om = pad2(abs % 60);
      return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate()) +
        'T' + pad2(d.getHours()) + ':' + pad2(d.getMinutes()) + ':' + pad2(d.getSeconds()) +
        sign + oh + ':' + om;
    }

    function buildRecord() {
      // 完整模式：分母＝實際清單項數，正確數＝核定為正確的項數。
      // 只填異常項模式：分母固定 SAMPLE_SIZE，正確數＝SAMPLE_SIZE − 異常項數
      //                （顯示分頁的 D 欄是公式 =C/B，所以填 19/20 出來就是 95%）。
      var counts = isAnomalyMode()
        ? Format.anomalyOnlyCounts(items.length, SAMPLE_SIZE)
        : (function () {
            var total = items.length;
            var correctCount = items.filter(function (it) { return it.verdict === '正確'; }).length;
            return {
              sample_count: total,
              correct_count: correctCount,
              correct_rate: Format.correctRate(correctCount, total)
            };
          })();
      var anomalyForText = items.filter(function (it) {
        return isAnomalyMode() || it.verdict === '異常';
      }).map(function (it) {
        return { item: it.name, unit: it.unit, book_qty: it.book_qty, recount_qty: it.recount_qty, verdict: '異常' };
      });
      return {
        record_key: Format.recordKey(currentStore, currentMonth),
        store: currentStore,
        month: currentMonth,
        status: '已稽核',
        audit_date: todayStr(),
        sample_count: counts.sample_count,
        correct_count: counts.correct_count,
        correct_rate: counts.correct_rate,
        change_fund: vaultState.change_fund,
        petty_cash: vaultState.petty_cash,
        tip_amount: Number(vaultState.tip_amount),
        tip_match: vaultState.tip_match,
        anomaly_text: Format.buildAnomalyText(anomalyForText),
        note: vaultState.note || '',
        submitted_at: nowIso()
      };
    }

    function buildDetails() {
      var key = Format.recordKey(currentStore, currentMonth);
      return items.map(function (it) {
        // 只填異常項模式下清單裡就只有異常項；明細只會寫這幾列，
        // 沒被輸入的品項不進「抽查明細」分頁（它們沒有被逐項記錄，只計入分母）。
        var isAnomaly = isAnomalyMode() || it.verdict === '異常';
        return {
          record_key: key,
          store: currentStore,
          month: currentMonth,
          item: it.name,
          unit: it.unit,
          book_qty: Number(it.book_qty),
          recount_qty: Number(it.recount_qty),
          verdict: isAnomaly ? '異常' : it.verdict,
          reason: isAnomaly ? (it.reason || '') : '',
          note: isAnomaly ? (it.note || '') : ''
        };
      });
    }

    function hideSubmitError() {
      submitErrorEl.hidden = true;
      submitErrorEl.textContent = '';
    }
    function showSubmitError(msg) {
      submitErrorEl.textContent = msg;
      submitErrorEl.hidden = false;
    }
    function showSubmitFailure() {
      showSubmitError('送出失敗，草稿已保留，請按下方「重試送出」再試一次');
      retryBtn.hidden = false;
    }
    function hideOverwriteDialog() {
      overwriteDialog.hidden = true;
    }
    function showOverwriteDialog(existing) {
      overwriteText.textContent = '將覆蓋 ' + (existing.audit_date || '') + ' 的紀錄，確定送出？';
      overwriteDialog.hidden = false;
    }

    function performSubmit() {
      hideOverwriteDialog();
      hideSubmitError();
      retryBtn.hidden = true;
      submitBtn.disabled = true;
      submitBtn.textContent = '送出中…';
      var record = buildRecord();
      var details = buildDetails();
      root.Api.submitAudit(app.state.code, record, details).then(function (res) {
        submitBtn.disabled = false;
        submitBtn.textContent = '送出稽核';
        if (res && res.ok) {
          clearDraft();
          app.reload().then(function () {
            app.navigate('report', { store: currentStore, month: currentMonth });
          });
        } else {
          showSubmitFailure();
        }
      }).catch(function () {
        submitBtn.disabled = false;
        submitBtn.textContent = '送出稽核';
        showSubmitFailure();
      });
    }

    function doSubmit() {
      hideSubmitError();
      var errors = validate();
      if (errors.length) {
        showSubmitError(errors.join('\n'));
        return;
      }
      var key = Format.recordKey(currentStore, currentMonth);
      var records = (app.state.data && app.state.data.records) || [];
      var existing = records.filter(function (r) { return r.record_key === key; })[0];
      if (existing) {
        showOverwriteDialog(existing);
      } else {
        performSubmit();
      }
    }

    // ---- 草稿還原／重置：切店／切月／初次進畫面都會呼叫 ----
    function applyDraft(draft) {
      items = (draft.items || []).map(normalizeItem);
      var v = draft.vault || {};
      vaultState = {
        change_fund: v.change_fund || '',
        petty_cash: v.petty_cash || '',
        tip_amount: v.tip_amount !== undefined && v.tip_amount !== null ? v.tip_amount : '',
        tip_match: v.tip_match || '',
        note: v.note || ''
      };
    }

    function resetState() {
      items = [];
      vaultState = { change_fund: '', petty_cash: '', tip_amount: '', tip_match: '', note: '' };
    }

    function tryRestoreOrReset() {
      var draft = loadDraft();
      if (draft) {
        applyDraft(draft);
      } else {
        resetState();
      }
      renderMode();
      renderItems();
      renderVault();
      renderDrafts();
      hideSubmitError();
      hideOverwriteDialog();
      retryBtn.hidden = true;
    }

    // ---- 事件：切換填寫方式 ----
    // 切模式＝換一份草稿（兩邊各存各的），不會動到另一邊已填的內容。
    modeGroup.addEventListener('click', function (e) {
      var btn = e.target.closest ? e.target.closest('.audit-mode-btn') : null;
      if (!btn) return;
      var next = btn.getAttribute('data-mode');
      if (next === mode) return;
      saveDraft();          // 先把目前模式的內容存起來，再換過去
      mode = next;
      persistMode(mode);
      tryRestoreOrReset();
    });

    // ---- 未送出草稿一覽（2026-08-07 新增）----
    // 草稿一直都有存，但重開時只會還原「當下選的店月」那一份，其他份看不到，
    // 用起來就像「填一半跳出去內容不見了」。這裡把所有還沒送出的草稿列出來，點一下跳回去。

    function draftHasContent(payload) {
      if (!payload) return false;
      var items = payload.items || [];
      if (items.length) return true;
      var v = payload.vault || {};
      return !!(v.change_fund || v.petty_cash || v.tip_amount || v.tip_match || v.note);
    }

    function listDrafts() {
      var out = [];
      try {
        for (var i = 0; i < localStorage.length; i++) {
          var k = localStorage.key(i);
          if (!k || k.indexOf('draft_') !== 0) continue;
          var payload = null;
          try { payload = JSON.parse(localStorage.getItem(k)); } catch (e) { payload = null; }
          if (!payload || !payload.store || !payload.month) continue;
          if (!draftHasContent(payload)) continue;
          out.push({
            key: k,
            store: payload.store,
            month: payload.month,
            mode: /_anomaly$/.test(k) ? MODE_ANOMALY : MODE_FULL,
            count: (payload.items || []).length
          });
        }
      } catch (e) { /* 儲存空間不可用時當作沒有草稿 */ }
      out.sort(function (a, b) {
        if (a.month !== b.month) return a.month < b.month ? 1 : -1; // 新的月份排前面
        return a.store < b.store ? -1 : 1;
      });
      return out;
    }

    function storeLabel(code) {
      var hit = stores.filter(function (s) { return s.code === code; })[0];
      return hit ? hit.name : code;
    }

    function renderDrafts() {
      // 目前正在填的這一份不列（它就在畫面上），只列「其他還沒送出的」
      var others = listDrafts().filter(function (d) {
        return !(d.store === currentStore && d.month === currentMonth && d.mode === mode);
      });
      if (!others.length) {
        draftsCard.hidden = true;
        draftsList.innerHTML = '';
        return;
      }
      draftsCard.hidden = false;
      draftsList.innerHTML = others.map(function (d) {
        var modeTxt = d.mode === MODE_ANOMALY ? '只填異常項' : '完整 ' + SAMPLE_SIZE + ' 項';
        return '<li class="audit-draft-row">' +
          '<button type="button" class="audit-draft-resume" data-key="' + escapeHtml(d.key) + '">' +
            escapeHtml(storeLabel(d.store)) + '　' + escapeHtml(Format.monthLabel(d.month)) +
            '<span class="audit-draft-meta">' + escapeHtml(modeTxt) + '·已填 ' + d.count + ' 項</span>' +
          '</button>' +
          '<button type="button" class="audit-draft-drop" data-key="' + escapeHtml(d.key) + '">丟棄</button>' +
        '</li>';
      }).join('');
    }

    function resumeDraft(key) {
      var payload = null;
      try { payload = JSON.parse(localStorage.getItem(key)); } catch (e) { payload = null; }
      if (!payload) return;
      saveDraft();                       // 先保住目前這一份
      currentStore = payload.store;
      currentMonth = payload.month;
      mode = /_anomaly$/.test(key) ? MODE_ANOMALY : MODE_FULL;
      persistMode(mode);
      storeSelect.value = currentStore;
      // 跨年份的草稿：本畫面只列當年的月份，選不到就不動月份下拉（清單仍會正確還原）
      monthSelect.value = currentMonth;
      renderDatalist();
      tryRestoreOrReset();
      el.scrollIntoView ? el.scrollIntoView({ block: 'start' }) : null;
    }

    draftsList.addEventListener('click', function (e) {
      var resumeBtn = e.target.closest ? e.target.closest('.audit-draft-resume') : null;
      var dropBtn = e.target.closest ? e.target.closest('.audit-draft-drop') : null;
      if (resumeBtn) {
        resumeDraft(resumeBtn.getAttribute('data-key'));
      } else if (dropBtn) {
        try { localStorage.removeItem(dropBtn.getAttribute('data-key')); } catch (err) { /* 忽略 */ }
        renderDrafts();
      }
    });

    // ---- 事件：選店／選月 ----
    storeSelect.addEventListener('change', function () {
      currentStore = storeSelect.value;
      renderDatalist();
      tryRestoreOrReset();
    });

    monthSelect.addEventListener('change', function () {
      currentMonth = monthSelect.value;
      tryRestoreOrReset();
    });

    // ---- 事件：抽樣區（既有行為不變，僅補上 normalizeItem）----
    drawBtn.addEventListener('click', function () {
      var storeItems = currentStoreItems();
      var storeDetails = currentStoreDetails();
      setItems(Sampling.drawSample(storeItems, storeDetails, SAMPLE_SIZE).map(normalizeItem));
    });

    addBtn.addEventListener('click', function () {
      addItemByName(addInput.value.trim());
    });

    addInput.addEventListener('input', syncUnitField);
    addInput.addEventListener('change', syncUnitField);

    addInput.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') {
        e.preventDefault();
        // 名稱打完直接按 Enter：庫裡有的就直接加，庫裡沒有的先把游標送去單位欄
        syncUnitField();
        if (!addUnitInput.value.trim()) {
          hideAddError();
          addUnitInput.focus();
          return;
        }
        addItemByName(addInput.value.trim());
      }
    });

    addUnitInput.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') {
        e.preventDefault();
        addItemByName(addInput.value.trim());
      }
    });

    itemsEl.addEventListener('click', function (e) {
      var target = e.target;
      var redrawBtn = target.closest ? target.closest('.audit-item-redraw') : null;
      var removeBtn = target.closest ? target.closest('.audit-item-remove') : null;
      var verdictBtn = target.closest ? target.closest('.audit-verdict-btn') : null;

      if (redrawBtn) {
        var name = redrawBtn.getAttribute('data-name');
        var idx = -1;
        items.forEach(function (it, i) { if (it.name === name) idx = i; });
        if (idx === -1) return;
        var currentNames = items.map(function (it) { return it.name; });
        var replacement = Sampling.redrawOne(currentNames, currentStoreItems(), currentStoreDetails());
        if (replacement) {
          items = items.slice();
          items[idx] = normalizeItem(replacement);
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
      } else if (verdictBtn) {
        var li = target.closest('.audit-item-row');
        if (!li) return;
        var itemName = li.getAttribute('data-item');
        var itemIdx = findIndexByName(itemName);
        if (itemIdx === -1) return;
        var verdict = verdictBtn.getAttribute('data-verdict');
        items[itemIdx].verdict = verdict;
        if (verdict !== '異常') {
          items[itemIdx].reason = '';
          items[itemIdx].note = '';
        }
        renderItems();
      }
    });

    // ---- 事件：每列盤點數／複盤數／異常備註（即時同步，不整列重繪，避免輸入中失焦）----
    itemsEl.addEventListener('input', function (e) {
      var target = e.target;
      var li = target.closest ? target.closest('.audit-item-row') : null;
      if (!li) return;
      var idx = findIndexByName(li.getAttribute('data-item'));
      if (idx === -1) return;
      if (target.classList.contains('audit-book-qty')) {
        items[idx].book_qty = target.value;
        saveDraft();
      } else if (target.classList.contains('audit-recount-qty')) {
        items[idx].recount_qty = target.value;
        saveDraft();
      } else if (target.classList.contains('audit-item-note')) {
        items[idx].note = target.value;
        saveDraft();
      } else if (target.classList.contains('audit-item-unit-input')) {
        // 不整列重繪，否則打一個字就失焦；單位顯示等下次重繪再跟上
        items[idx].unit = target.value;
        saveDraft();
        syncAuditState();
      }
    });

    // ---- 事件：異常原因下拉 ----
    itemsEl.addEventListener('change', function (e) {
      var target = e.target;
      if (!target.classList.contains('audit-reason')) return;
      var li = target.closest ? target.closest('.audit-item-row') : null;
      if (!li) return;
      var idx = findIndexByName(li.getAttribute('data-item'));
      if (idx === -1) return;
      items[idx].reason = target.value;
      var noteInput = li.querySelector('.audit-item-note');
      if (noteInput) {
        noteInput.placeholder = target.value === '其他' ? '必填：請說明原因' : '選填';
      }
      saveDraft();
    });

    // ---- 事件：金庫區塊 ----
    vaultBodyEl.addEventListener('click', function (e) {
      var btn = e.target.closest ? e.target.closest('.audit-vault-btn') : null;
      if (!btn) return;
      vaultState[btn.getAttribute('data-group')] = btn.getAttribute('data-value');
      renderVaultBody();
      saveDraft();
    });

    vaultBodyEl.addEventListener('input', function (e) {
      if (e.target && e.target.id === 'audit-tip-amount') {
        vaultState.tip_amount = e.target.value;
        saveDraft();
      }
    });

    noteEl.addEventListener('input', function () {
      vaultState.note = noteEl.value;
      saveDraft();
    });

    // ---- 事件：送出／覆蓋確認／失敗重試 ----
    submitBtn.addEventListener('click', function () {
      doSubmit();
    });

    retryBtn.addEventListener('click', function () {
      performSubmit();
    });

    overwriteConfirmBtn.addEventListener('click', function () {
      performSubmit();
    });

    overwriteCancelBtn.addEventListener('click', function () {
      hideOverwriteDialog();
    });

    // ---- 初始化：datalist 先建，再嘗試還原草稿（找不到就從空清單開始）----
    renderDatalist();
    tryRestoreOrReset();
  }

  root.Views = root.Views || {};
  root.Views.audit = { render: render };
})(typeof window !== 'undefined' ? window : this);
