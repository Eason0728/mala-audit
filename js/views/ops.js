// 營運稽核填寫（2026-08-11，會計限定）
// window.Views.ops = { render(el, app) }
//
// 一次稽核＝一家店一個月，19 項逐項核定「合格／未完成」，可加☆追蹤與文字說明。
// 判「未完成」一定要填說明（前後端各擋一次）——說不出哪裡不合格的缺失，下個月沒人追得動。
//
// 缺失只留文字、不存照片（Eason 2026-08-11 決定）：存照片要用 DriveApp，
// 而 Apps Script 是靠靜態掃描程式碼決定 OAuth 範圍的，專案裡只要出現 DriveApp
// 就得請 Eason 重新授權一次，還多一個會壞的環節。要加照片再一併排那個步驟。
//
// 草稿：每次輸入即存 localStorage（key＝ops_draft_{record_key}），並記住上次那家店
// （ops_last_store）。這是照月初盤點那邊 2026-08-07 的教訓做的：草稿一直都有，
// 但重開時畫面若固定跳回第一家店，別家店的草稿看不到，使用者會以為「內容不見了」。
// 所以：① 重開回到上次那家店 ② 頁面上方列出所有未送出草稿可直接點回去。

(function (root) {
  'use strict';

  var DRAFT_PREFIX = 'ops_draft_';
  var LAST_STORE_KEY = 'ops_last_store';

  var FILTERS = [
    { key: 'all', label: '全部' },
    { key: 'pass', label: '合格' },
    { key: 'fail', label: '未完成' },
    { key: 'track', label: '追蹤' },
    { key: 'pending', label: '未檢查' }
  ];

  // 畫面狀態留在模組層：app.navigate 每次都會重跑 render，
  // 存在區域變數裡會被沖掉（會計填到一半切去總覽再回來就白填了）。
  var st = null;

  // ---- localStorage 薄包裝（file:// 或隱私模式存取會丟例外，一律吞掉當作沒有草稿）----
  function lsGet(key) {
    try { return localStorage.getItem(key); } catch (e) { return null; }
  }
  function lsSet(key, value) {
    try { localStorage.setItem(key, value); } catch (e) { /* 存不了就算了，畫面照跑 */ }
  }
  function lsDel(key) {
    try { localStorage.removeItem(key); } catch (e) { /* 同上 */ }
  }

  function pad2(n) { return (n < 10 ? '0' : '') + n; }

  function currentMonth() {
    var d = new Date();
    return d.getFullYear() + '-' + pad2(d.getMonth() + 1);
  }

  function recordKeyOf(store, month) { return store + '_' + month; }
  function draftKeyOf(recordKey) { return DRAFT_PREFIX + recordKey; }

  function emptyEntry() {
    return { verdict: '未檢查', track: false, note: '' };
  }

  function blankEntries() {
    var entries = {};
    root.OpsChecklist.flat.forEach(function (it) { entries[it.id] = emptyEntry(); });
    return entries;
  }

  // ---- 草稿 ----
  function loadDraft(recordKey) {
    var raw = lsGet(draftKeyOf(recordKey));
    if (!raw) return null;
    try { return JSON.parse(raw); } catch (e) { return null; }
  }

  function saveDraft() {
    if (!st || !st.store || !st.month) return;
    lsSet(draftKeyOf(recordKeyOf(st.store, st.month)), JSON.stringify({
      store: st.store, month: st.month, auditor: st.auditor, entries: st.entries
    }));
  }

  function clearDraft(recordKey) {
    lsDel(draftKeyOf(recordKey));
  }

  // listDrafts() → [{record_key, store, month}]（掃 localStorage 找所有未送出的營運稽核草稿）
  function listDrafts() {
    var out = [];
    try {
      for (var i = 0; i < localStorage.length; i++) {
        var k = localStorage.key(i);
        if (k && k.indexOf(DRAFT_PREFIX) === 0) {
          var d = loadDraft(k.slice(DRAFT_PREFIX.length));
          if (d && d.store && d.month) {
            out.push({ record_key: k.slice(DRAFT_PREFIX.length), store: d.store, month: d.month });
          }
        }
      }
    } catch (e) { /* 存取不到就當沒有草稿 */ }
    return out;
  }

  // ---- 載入某店某月的內容：草稿優先，其次已送出的紀錄（可修正重送），都沒有就空白 ----
  function loadEntriesFor(app, store, month) {
    var key = recordKeyOf(store, month);
    var draft = loadDraft(key);
    if (draft && draft.entries) {
      var merged = blankEntries();
      Object.keys(merged).forEach(function (id) {
        if (draft.entries[id]) merged[id] = draft.entries[id];
      });
      return { entries: merged, auditor: draft.auditor || '', from: 'draft' };
    }

    var data = app.state.data || {};
    var details = (data.ops_details || []).filter(function (d) { return d.record_key === key; });
    if (details.length) {
      var e = blankEntries();
      details.forEach(function (d) {
        if (!e[d.item_id]) return;
        e[d.item_id] = { verdict: d.verdict, track: !!d.track, note: d.note || '' };
      });
      var rec = (data.ops_records || []).filter(function (r) { return r.record_key === key; })[0];
      return { entries: e, auditor: (rec && rec.auditor) || '', from: 'submitted' };
    }
    return { entries: blankEntries(), auditor: '', from: 'new' };
  }

  function initState(app, store, month) {
    var loaded = loadEntriesFor(app, store, month);
    st = {
      store: store,
      month: month,
      auditor: loaded.auditor,
      entries: loaded.entries,
      filter: (st && st.filter) || 'all',
      source: loaded.from,
      message: '',
      submitting: false
    };
    lsSet(LAST_STORE_KEY, store);
  }

  // ---- 統計 ----
  function detailList() {
    return root.OpsChecklist.flat.map(function (it) {
      var e = st.entries[it.id] || emptyEntry();
      return {
        item_id: it.id, cat: it.cat, group: it.group, text: it.text,
        verdict: e.verdict, track: !!e.track, note: e.note || ''
      };
    });
  }

  function counts() {
    return root.Format.opsCounts(detailList(), root.OpsChecklist.total);
  }

  // ---- HTML 組裝 ----
  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function matchesFilter(entry) {
    if (st.filter === 'all') return true;
    if (st.filter === 'pass') return entry.verdict === '合格';
    if (st.filter === 'fail') return entry.verdict === '未完成';
    if (st.filter === 'pending') return entry.verdict === '未檢查';
    if (st.filter === 'track') return !!entry.track || entry.verdict === '未完成';
    return true;
  }

  function itemHtml(it) {
    var e = st.entries[it.id] || emptyEntry();
    return '' +
      '<div class="ops-item' + (e.verdict === '未完成' ? ' is-fail' : '') +
        (e.verdict === '合格' ? ' is-pass' : '') + '" data-item="' + it.id + '">' +
        '<p class="ops-item-text">' + esc(it.text) +
          (e.track ? '<span class="ops-tag-track">追蹤</span>' : '') + '</p>' +
        '<div class="ops-item-btns">' +
          '<button type="button" class="ops-vbtn' + (e.verdict === '合格' ? ' sel-pass' : '') +
            '" data-verdict="合格" data-item="' + it.id + '">合格</button>' +
          '<button type="button" class="ops-vbtn' + (e.verdict === '未完成' ? ' sel-fail' : '') +
            '" data-verdict="未完成" data-item="' + it.id + '">未完成</button>' +
          '<button type="button" class="ops-tbtn' + (e.track ? ' sel' : '') +
            '" data-track="1" data-item="' + it.id + '">' + (e.track ? '★ 追蹤中' : '☆ 追蹤') + '</button>' +
        '</div>' +
        '<textarea class="ops-note" data-item="' + it.id + '" rows="2"' +
          ' placeholder="說明 / 缺失描述（判未完成必填）">' + esc(e.note) + '</textarea>' +
      '</div>';
  }

  function listHtml() {
    var html = '';
    var lastGroup = null;
    var shown = 0;
    root.OpsChecklist.flat.forEach(function (it) {
      var e = st.entries[it.id] || emptyEntry();
      if (!matchesFilter(e)) return;
      if (it.group !== lastGroup) {
        html += '<h3 class="ops-group">' + esc(it.cat) + '｜' + esc(it.group) + '</h3>';
        lastGroup = it.group;
      }
      html += itemHtml(it);
      shown++;
    });
    if (!shown) html = '<p class="ops-empty">這個篩選沒有項目。</p>';
    return html;
  }

  function render(el, app) {
    var data = app.state.data || {};
    var stores = ((data.config && data.config.stores) || []).slice().sort(function (a, b) {
      return a.order - b.order;
    });

    if (app.state.role !== 'accountant') {
      el.innerHTML = '<h2>營運稽核填寫</h2><p class="status-danger">此頁僅會計可使用。</p>';
      return;
    }
    if (!stores.length) {
      el.innerHTML = '<h2>營運稽核填寫</h2><p class="status-danger">讀不到店別清單，請重新登入。</p>';
      return;
    }

    // 進頁時決定要填哪一筆：navigate 帶的 params ＞ 目前狀態 ＞ 上次那家店 ＞ 第一家
    var params = app.state.params || {};
    var wantStore = params.store || (st && st.store) || lsGet(LAST_STORE_KEY) || stores[0].code;
    if (!stores.some(function (s) { return s.code === wantStore; })) wantStore = stores[0].code;
    var wantMonth = params.month || (st && st.month) || currentMonth();
    if (!st || st.store !== wantStore || st.month !== wantMonth) {
      initState(app, wantStore, wantMonth);
    }
    // params 只在進頁那一次有效，留著會讓「換店」下拉被下一次 render 打回原狀
    app.state.params = {};

    var c = counts();
    var year = String(st.month).split('-')[0];

    var storeOptions = stores.map(function (s) {
      return '<option value="' + s.code + '"' + (s.code === st.store ? ' selected' : '') + '>' +
        esc(s.name) + '</option>';
    }).join('');
    var monthOptions = [];
    for (var m = 1; m <= 12; m++) {
      var mm = year + '-' + pad2(m);
      monthOptions.push('<option value="' + mm + '"' + (mm === st.month ? ' selected' : '') + '>' +
        root.Format.monthLabel(mm) + '</option>');
    }

    // 其他店月的未送出草稿（不含正在填的這筆）
    var others = listDrafts().filter(function (d) {
      return d.record_key !== recordKeyOf(st.store, st.month);
    });
    var draftsHtml = '';
    if (others.length) {
      draftsHtml = '<div class="ops-drafts"><span>未送出草稿：</span>' +
        others.map(function (d) {
          var s = stores.filter(function (x) { return x.code === d.store; })[0];
          return '<button type="button" class="ops-draft-link" data-store="' + d.store +
            '" data-month="' + d.month + '">' + esc(s ? s.name : d.store) + ' ' +
            root.Format.monthLabel(d.month) + '</button>';
        }).join('') + '</div>';
    }

    var filtersHtml = FILTERS.map(function (f) {
      return '<button type="button" class="ops-filter' + (st.filter === f.key ? ' sel' : '') +
        '" data-filter="' + f.key + '">' + f.label + '</button>';
    }).join('');

    el.innerHTML =
      '<h2>營運稽核填寫</h2>' +
      draftsHtml +
      '<div class="card">' +
        '<label for="ops-store">店別</label>' +
        '<select id="ops-store">' + storeOptions + '</select>' +
        '<label for="ops-month" style="margin-top:8px;">月份</label>' +
        '<select id="ops-month">' + monthOptions.join('') + '</select>' +
        '<label for="ops-auditor" style="margin-top:8px;">稽核人員</label>' +
        '<input type="text" id="ops-auditor" value="' + esc(st.auditor) + '" placeholder="填寫人姓名">' +
        (st.source === 'submitted'
          ? '<p class="status-danger" style="margin-bottom:0;">這個月已經送出過，現在是修改模式；再送出一次會整筆覆蓋。</p>'
          : '') +
      '</div>' +
      '<div class="ops-stats">' +
        '<span>細項 <b>' + c.total + '</b></span>' +
        '<span class="ok">合格 <b id="ops-s-pass">' + c.pass + '</b></span>' +
        '<span class="bad">未完成 <b id="ops-s-fail">' + c.fail + '</b></span>' +
        '<span>追蹤 <b>' + c.track + '</b></span>' +
        '<span>未檢查 <b id="ops-s-pending">' + c.pending + '</b></span>' +
        '<span>合格率 <b>' + c.pass_rate + '%</b></span>' +
      '</div>' +
      '<div class="ops-filters">' + filtersHtml + '</div>' +
      '<div class="ops-list">' + listHtml() + '</div>' +
      (st.message ? '<p id="ops-message" class="status-danger">' + esc(st.message) + '</p>' : '') +
      // 送出中要保持 disabled：送出流程會 refresh（整頁重畫），
      // 只在舊按鈕上設 disabled 的話重畫完就解鎖了，連點兩下會送兩次。
      '<button type="button" id="ops-submit" class="btn"' + (st.submitting ? ' disabled' : '') +
        '>送出營運稽核</button>';

    bind(el, app);
  }

  // 整頁重畫。說明欄的 input 事件刻意**不呼叫**它（只 saveDraft）——
  // 每打一個字就重畫會把輸入游標搶走，打到一半跳掉。
  function refresh(el, app) {
    render(el, app);
  }

  function bind(el, app) {
    // ---- 店別／月份／稽核人員 ----
    el.querySelector('#ops-store').addEventListener('change', function (e) {
      initState(app, e.target.value, st.month);
      render(el, app);
    });
    el.querySelector('#ops-month').addEventListener('change', function (e) {
      initState(app, st.store, e.target.value);
      render(el, app);
    });
    var auditorEl = el.querySelector('#ops-auditor');
    auditorEl.addEventListener('input', function () {
      st.auditor = auditorEl.value;
      saveDraft();
    });

    // ---- 草稿跳轉 ----
    var draftLinks = el.querySelectorAll('.ops-draft-link');
    for (var i = 0; i < draftLinks.length; i++) {
      draftLinks[i].addEventListener('click', function (e) {
        initState(app, e.currentTarget.getAttribute('data-store'),
          e.currentTarget.getAttribute('data-month'));
        render(el, app);
      });
    }

    // ---- 篩選 ----
    var fbtns = el.querySelectorAll('.ops-filter');
    for (var j = 0; j < fbtns.length; j++) {
      fbtns[j].addEventListener('click', function (e) {
        st.filter = e.currentTarget.getAttribute('data-filter');
        render(el, app);
      });
    }

    // ---- 合格／未完成（再點一次取消，回未檢查）----
    var vbtns = el.querySelectorAll('.ops-vbtn');
    for (var k = 0; k < vbtns.length; k++) {
      vbtns[k].addEventListener('click', function (e) {
        var id = e.currentTarget.getAttribute('data-item');
        var v = e.currentTarget.getAttribute('data-verdict');
        var entry = st.entries[id];
        entry.verdict = (entry.verdict === v) ? '未檢查' : v;
        saveDraft();
        refresh(el, app);
      });
    }

    // ---- 追蹤 ----
    var tbtns = el.querySelectorAll('.ops-tbtn');
    for (var t = 0; t < tbtns.length; t++) {
      tbtns[t].addEventListener('click', function (e) {
        var id = e.currentTarget.getAttribute('data-item');
        st.entries[id].track = !st.entries[id].track;
        saveDraft();
        refresh(el, app);
      });
    }

    // ---- 說明：input 只存不重畫（重畫會讓輸入中的游標跳掉）----
    var notes = el.querySelectorAll('.ops-note');
    for (var n = 0; n < notes.length; n++) {
      notes[n].addEventListener('input', function (e) {
        st.entries[e.target.getAttribute('data-item')].note = e.target.value;
        saveDraft();
      });
    }

    // ---- 送出 ----
    el.querySelector('#ops-submit').addEventListener('click', function () {
      if (st.submitting) return;
      submit(el, app);
    });
  }

  function submit(el, app) {
    var details = detailList();
    var c = root.Format.opsCounts(details, root.OpsChecklist.total);

    if (!String(st.auditor || '').trim()) {
      st.message = '請填稽核人員。';
      refresh(el, app);
      return;
    }
    var missingNote = details.filter(function (d) {
      return d.verdict === '未完成' && !String(d.note || '').trim();
    });
    if (missingNote.length) {
      st.message = '有 ' + missingNote.length + ' 項判「未完成」但沒填說明：' +
        missingNote.map(function (d) { return d.text; }).slice(0, 3).join('、') +
        (missingNote.length > 3 ? ' 等' : '');
      st.filter = 'fail';
      refresh(el, app);
      return;
    }

    var now = new Date();
    var record = {
      record_key: recordKeyOf(st.store, st.month),
      store: st.store,
      month: st.month,
      status: '已稽核',
      audit_date: now.getFullYear() + '-' + pad2(now.getMonth() + 1) + '-' + pad2(now.getDate()),
      auditor: String(st.auditor).trim(),
      total_count: c.total,
      pass_count: c.pass,
      fail_count: c.fail,
      pending_count: c.pending,
      track_count: c.track,
      pass_rate: c.pass_rate,
      summary: root.Format.buildOpsSummary(details),
      note: '',
      submitted_at: now.toISOString()
    };

    var payloadDetails = details.map(function (d) {
      return {
        record_key: record.record_key, store: st.store, month: st.month,
        item_id: d.item_id, cat: d.cat, group: d.group, text: d.text,
        verdict: d.verdict, track: d.track, note: d.note
      };
    });

    st.submitting = true;
    st.message = '送出中…';
    refresh(el, app);
    root.Api.submitOpsAudit(app.state.code, record, payloadDetails).then(function (res) {
      if (res && res.ok) {
        clearDraft(record.record_key);
        var store = st.store, month = st.month;
        st = null;
        app.reload().then(function () {
          app.navigate('opsreport', { store: store, month: month });
        });
      } else {
        st.submitting = false;
        st.message = '送出失敗：' + ((res && res.error) || '請重試');
        refresh(el, app);
      }
    }).catch(function (err) {
      st.submitting = false;
      st.message = '送出失敗：' + err;
      refresh(el, app);
    });
  }

  root.Views = root.Views || {};
  root.Views.ops = { render: render };
})(typeof window !== 'undefined' ? window : this);
