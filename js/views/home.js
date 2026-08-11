// 選單畫面（2026-08-11）——登入後的第一頁，兩個區塊擇一進入
// window.Views.home = { render(el, app) }
// 區塊清單讀 app.MODULES／app.MODULE_ORDER（app.js 是唯一正本），這裡不另外寫死一份。
// 每張卡片順帶顯示「本月狀態」：那個區塊本月已經有幾家店送出了，會計一眼知道還缺誰。

(function (root) {
  'use strict';

  function pad2(n) {
    return (n < 10 ? '0' : '') + n;
  }

  // 本月（依裝置時間；跨月當下就會跟著換，跟兩張填寫頁的預設月份同一套邏輯）
  function currentMonth() {
    var d = new Date();
    return d.getFullYear() + '-' + pad2(d.getMonth() + 1);
  }

  // 該區塊本月已送出的店數 / 總店數
  function monthProgress(moduleKey, app) {
    var data = app.state.data || {};
    var stores = (data.config && data.config.stores) || [];
    var records = moduleKey === 'ops' ? (data.ops_records || []) : (data.records || []);
    var month = currentMonth();
    var done = 0;
    stores.forEach(function (s) {
      var key = s.code + '_' + month;
      for (var i = 0; i < records.length; i++) {
        if (records[i].record_key === key && records[i].status) { done++; return; }
      }
    });
    return { done: done, total: stores.length, month: month };
  }

  function render(el, app) {
    var order = app.MODULE_ORDER || [];
    var modules = app.MODULES || {};

    var cardsHtml = order.map(function (key) {
      var m = modules[key];
      var p = monthProgress(key, app);
      var monthLabel = root.Format ? root.Format.monthLabel(p.month) : p.month;
      return '' +
        '<button type="button" class="module-card" data-module="' + key + '">' +
          '<span class="module-card-title">' + m.label + '</span>' +
          '<span class="module-card-desc">' + m.desc + '</span>' +
          '<span class="module-card-meta">' + monthLabel + '：' + p.done + ' / ' + p.total + ' 家已送出</span>' +
        '</button>';
    }).join('');

    el.innerHTML =
      '<h2>請選擇要做哪一張表</h2>' +
      '<div class="module-list">' + cardsHtml + '</div>';

    var cards = el.querySelectorAll('.module-card');
    for (var i = 0; i < cards.length; i++) {
      cards[i].addEventListener('click', function (e) {
        var key = e.currentTarget.getAttribute('data-module');
        var m = modules[key];
        if (m && m.tabs && m.tabs.length) app.navigate(m.tabs[0].tab);
      });
    }
  }

  root.Views = root.Views || {};
  root.Views.home = { render: render };
})(typeof window !== 'undefined' ? window : this);
