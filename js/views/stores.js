// 門市管理（2026-09-28）——選單頁「門市管理」進來，會計限定
// window.Views.stores = { render(el, app) }
// 新增：只填店名，店代碼由後端自動給（st-01、st-02…），同時在試算表建一個同名的顯示分頁。
// 停用：只是不再出現在兩張表的店別選單與總覽，歷史紀錄、顯示分頁都保留，可隨時重新啟用。
// 改名：店代碼不變（歷史紀錄不受影響）；試算表分頁原本跟店名同名才會跟著改（後端 handleRenameStore）。

(function (root) {
  'use strict';

  function esc(v) {
    return String(v === undefined || v === null ? '' : v)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function allStores(app) {
    var cfg = (app.state.data && app.state.data.config) || {};
    if (cfg.all_stores && cfg.all_stores.length) return cfg.all_stores;
    // 後端還沒更新到有 all_stores 的版本時，至少把啟用中的列出來
    return (cfg.stores || []).map(function (s) {
      return { code: s.code, name: s.name, active: true, order: s.order };
    });
  }

  function render(el, app) {
    var isAccountant = app.state.role === 'accountant';
    var stores = allStores(app);

    var rows = stores.map(function (s) {
      var btn = isAccountant
        ? '<button type="button" class="store-toggle ' + (s.active ? 'store-toggle-off' : '') + '"' +
            ' data-store="' + esc(s.code) + '" data-status="' + (s.active ? '停用' : '啟用') + '">' +
            (s.active ? '停用' : '重新啟用') + '</button>'
        : '';
      var renameBtn = isAccountant
        ? '<button type="button" class="store-rename" data-store="' + esc(s.code) + '">改名</button>'
        : '';
      return '<li class="store-row' + (s.active ? '' : ' store-row-inactive') + '" data-store="' + esc(s.code) + '">' +
        '<span class="store-name">' + esc(s.name) +
          (s.active ? '' : '<span class="store-badge">停用中</span>') + '</span>' +
        '<span class="store-actions">' + renameBtn + btn + '</span>' +
      '</li>';
    }).join('');

    var addForm = isAccountant
      ? '<div class="card">' +
          '<h3>新增門市</h3>' +
          '<label for="store-new-name">門市名稱</label>' +
          '<input id="store-new-name" type="text" maxlength="20" placeholder="例：一悟燒肉竹北">' +
          '<p class="store-hint">新增後兩張表的店別選單都會出現，試算表會自動多一個同名分頁。</p>' +
          '<button type="button" id="store-add-btn" class="btn">新增門市</button>' +
        '</div>'
      : '<p class="store-hint">僅會計可新增或停用門市。</p>';

    el.innerHTML =
      '<button type="button" id="store-back" class="btn btn-secondary store-back">← 回選單</button>' +
      '<h2>門市管理</h2>' +
      '<p id="store-msg" class="store-msg" role="status"></p>' +
      addForm +
      '<div class="card"><h3>門市清單</h3><ul class="store-list">' + rows + '</ul>' +
      '<p class="store-hint">停用＝不再出現在店別選單與總覽，歷史紀錄與試算表分頁都保留。</p></div>';

    var msg = el.querySelector('#store-msg');
    function show(text, ok) {
      msg.textContent = text;
      msg.className = 'store-msg ' + (ok ? 'status-ok' : 'status-danger');
    }

    el.querySelector('#store-back').addEventListener('click', function () {
      app.navigate('home');
    });

    // 送出後重抓資料；app.reload() 會重畫目前這頁，訊息要在重畫之後再補上去
    function afterWrite(res, okText) {
      if (!res || !res.ok) {
        show((res && res.error) || '沒有成功，請再試一次', false);
        setBusy(false);
        return;
      }
      return app.reload().then(function () {
        var m = document.querySelector('#view-stores #store-msg');
        if (m) { m.textContent = okText; m.className = 'store-msg status-ok'; }
      });
    }

    var buttons = el.querySelectorAll('button.store-toggle, button.store-rename, #store-add-btn');
    function storeOf(code) {
      return stores.filter(function (x) { return x.code === code; })[0];
    }

    var renames = el.querySelectorAll('button.store-rename');
    for (var r = 0; r < renames.length; r++) {
      renames[r].addEventListener('click', function (e) {
        var code = e.currentTarget.getAttribute('data-store');
        var s = storeOf(code);
        var oldName = s ? s.name : code;
        var input = root.prompt('把「' + oldName + '」改成什麼名稱？\n（歷史紀錄不受影響）', oldName);
        if (input === null) return;
        var name = String(input).trim();
        if (!name || name === oldName) return;
        setBusy(true);
        root.Api.renameStore(app.state.code, code, name).then(function (res) {
          var extra = res && res.tab_renamed ? '，試算表分頁也一起改名' : '';
          return afterWrite(res, '已把「' + oldName + '」改名為「' + name + '」' + extra);
        }, function () {
          show('網路不穩，這次沒有送出，請再試一次', false);
          setBusy(false);
        });
      });
    }
    function setBusy(busy) {
      for (var i = 0; i < buttons.length; i++) buttons[i].disabled = busy;
    }

    var addBtn = el.querySelector('#store-add-btn');
    if (addBtn) {
      addBtn.addEventListener('click', function () {
        var input = el.querySelector('#store-new-name');
        var name = String(input.value || '').trim();
        if (!name) { show('請填門市名稱', false); return; }
        if (!root.confirm('確定新增門市「' + name + '」？')) return;
        setBusy(true);
        show('新增中…', true);
        root.Api.addStore(app.state.code, name).then(function (res) {
          return afterWrite(res, '已新增「' + name + '」');
        }, function () {
          show('網路不穩，這次沒有送出，請再試一次', false);
          setBusy(false);
        });
      });
    }

    var toggles = el.querySelectorAll('button.store-toggle');
    for (var i = 0; i < toggles.length; i++) {
      toggles[i].addEventListener('click', function (e) {
        var code = e.currentTarget.getAttribute('data-store');
        var status = e.currentTarget.getAttribute('data-status');
        var s = stores.filter(function (x) { return x.code === code; })[0];
        var name = s ? s.name : code;
        var ask = status === '停用'
          ? '確定停用「' + name + '」？\n停用後不會出現在店別選單與總覽，歷史紀錄保留，之後可重新啟用。'
          : '確定重新啟用「' + name + '」？';
        if (!root.confirm(ask)) return;
        setBusy(true);
        root.Api.setStoreStatus(app.state.code, code, status).then(function (res) {
          return afterWrite(res, (status === '停用' ? '已停用「' : '已重新啟用「') + name + '」');
        }, function () {
          show('網路不穩，這次沒有送出，請再試一次', false);
          setBusy(false);
        });
      });
    }
  }

  root.Views = root.Views || {};
  root.Views.stores = { render: render };
})(typeof window !== 'undefined' ? window : this);
