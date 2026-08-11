// App 殼：session/角色狀態、分頁切換、Views 分派 —— T3 實作
// 跨任務契約（task.md 共用介面契約）：
//   app.state = {role, code, data, year, params}
//   app.navigate(tab, params) / app.reload() / app.login(code)
// Views 檔可能尚未載入內容（stub 未掛 window.Views.<name>）：navigate 時該 Views
// 不存在就顯示「畫面建置中」占位，不 crash。

(function (root) {
  'use strict';

  var VIEW_IDS = {
    login: 'view-login',
    home: 'view-home',
    // 月初盤點抽查
    overview: 'view-overview',
    audit: 'view-audit',
    report: 'view-report',
    analysis: 'view-analysis',
    // 營運稽核表（2026-08-11）
    opsoverview: 'view-opsoverview',
    ops: 'view-ops',
    opsreport: 'view-opsreport'
  };

  // 登入後先進「選單」（home），選了區塊才進該區塊的分頁。
  // 導覽列因此是「跟著區塊換的」——不是 index.html 寫死的四顆，是這張表算出來的。
  var MODULES = {
    ops: {
      label: '營運稽核表',
      desc: '營運管理＋品牌形象，19 項逐項核定',
      tabs: [
        { tab: 'opsoverview', label: '總覽' },
        { tab: 'ops', label: '稽核填寫' },
        { tab: 'opsreport', label: '報告' }
      ]
    },
    stock: {
      label: '月初盤點抽查',
      desc: '品項抽查 20 項＋金庫抽查',
      tabs: [
        { tab: 'overview', label: '總覽' },
        { tab: 'audit', label: '稽核填寫' },
        { tab: 'report', label: '報告' },
        { tab: 'analysis', label: '異常分析' }
      ]
    }
  };

  var MODULE_ORDER = ['ops', 'stock'];

  // 分頁 → 所屬區塊的反查表。navigate('overview') 這種「直接指定分頁」的呼叫
  // （e2e 測試與舊程式都這樣用）會靠它自動把區塊切對，不必先選選單。
  var TAB_MODULE = {};
  MODULE_ORDER.forEach(function (key) {
    MODULES[key].tabs.forEach(function (t) { TAB_MODULE[t.tab] = key; });
  });

  var NAV_TABS = Object.keys(TAB_MODULE).concat(['home']);

  var App = {
    MODULES: MODULES,
    MODULE_ORDER: MODULE_ORDER,

    state: {
      role: null,
      code: null,
      data: null,
      year: '2026',
      params: {},
      tab: null,
      module: null   // 'ops' | 'stock' | null（null＝在選單頁）
    },

    // ---- 登入：Api.auth → 成功存 role/code → Api.getAll → navigate('home')（選單）----
    login: function (code) {
      var self = this;
      return root.Api.auth(code).then(function (authRes) {
        if (!authRes || !authRes.ok) {
          return { ok: false };
        }
        return root.Api.getAll(code).then(function (allRes) {
          if (!allRes || !allRes.ok) {
            return { ok: false };
          }
          self.state.role = authRes.role;
          self.state.code = code;
          self.state.data = allRes;
          // 登入後進選單（兩個區塊），不再直接落在盤點總覽（Eason 2026-08-11 指定）
          self.navigate('home');
          return { ok: true, role: authRes.role };
        });
      });
    },

    // ---- 重新 Api.getAll(app.state.code) 更新 data 後 re-render 目前 tab ----
    reload: function () {
      var self = this;
      // 判「還沒載入」要看 role 不能看 code：免通行碼時 code 是空字串，
      // 用 !code 會讓 reload 永遠短路，送出後畫面拿不到新資料。
      if (!self.state.role) {
        return Promise.resolve({ ok: false });
      }
      return root.Api.getAll(self.state.code).then(function (res) {
        if (res && res.ok) {
          self.state.data = res;
          if (self.state.tab) {
            self.renderView(self.state.tab);
          }
        }
        return res;
      });
    },

    // ---- 存 params 後只顯示該 section 並呼叫對應 Views.<tab>.render ----
    // tab 屬於哪個區塊由 TAB_MODULE 決定，導覽列跟著重畫；'home' 回選單並收起導覽列。
    navigate: function (tab, params) {
      if (NAV_TABS.indexOf(tab) === -1) return;
      // 未登入不得離開登入畫面（導覽列本來就藏著，這是第二道保險）
      if (!this.state.role) return;
      this.state.tab = tab;
      this.state.params = params || {};
      this.state.module = tab === 'home' ? null : TAB_MODULE[tab];
      this.renderNav();
      this.showSection(tab);
      this.setActiveNav(tab);
      this.renderView(tab);
    },

    showSection: function (activeTab) {
      Object.keys(VIEW_IDS).forEach(function (key) {
        var el = document.getElementById(VIEW_IDS[key]);
        if (!el) return;
        el.hidden = (key !== activeTab);
      });
    },

    setActiveNav: function (activeTab) {
      var buttons = document.querySelectorAll('#main-nav .nav-btn');
      for (var i = 0; i < buttons.length; i++) {
        var btn = buttons[i];
        if (btn.getAttribute('data-view') === activeTab) {
          btn.classList.add('active');
        } else {
          btn.classList.remove('active');
        }
      }
    },

    renderView: function (tab) {
      var el = document.getElementById(VIEW_IDS[tab]);
      if (!el) return;
      var view = root.Views && root.Views[tab];
      if (view && typeof view.render === 'function') {
        view.render(el, this);
      } else {
        el.innerHTML = '<p class="status-danger">畫面建置中</p>';
      }
    },

    // ---- 導覽列：依目前區塊重畫（第一顆固定是回選單）----
    // 按鈕是動態產生的，所以事件用委派綁在 #main-nav 上一次（見 bindNav），
    // 不要在這裡逐顆 addEventListener——重畫一次就會多疊一層監聽。
    renderNav: function () {
      var nav = document.getElementById('main-nav');
      if (!nav) return;
      var moduleKey = this.state.module;
      var subtitle = document.getElementById('app-subtitle');
      if (subtitle) {
        subtitle.textContent = moduleKey ? MODULES[moduleKey].label : '';
        subtitle.hidden = !moduleKey;
      }
      if (!moduleKey) {
        nav.innerHTML = '';
        nav.hidden = true;
        return;
      }
      var tabs = MODULES[moduleKey].tabs;
      nav.innerHTML =
        '<button type="button" class="nav-btn nav-home" data-view="home" aria-label="回選單">⌂</button>' +
        tabs.map(function (t) {
          return '<button type="button" class="nav-btn" data-view="' + t.tab + '">' + t.label + '</button>';
        }).join('');
      nav.hidden = false;
    },

    bindNav: function () {
      var self = this;
      var nav = document.getElementById('main-nav');
      if (!nav) return;
      nav.addEventListener('click', function (e) {
        var btn = e.target.closest ? e.target.closest('.nav-btn') : null;
        if (!btn || !nav.contains(btn)) return;
        self.navigate(btn.getAttribute('data-view'));
      });
    },

    // ---- 初始化：REQUIRE_PASSCODE=true（目前）走登入畫面；false 則開頁直接載入總覽 ----
    // 兩邊的開關（本檔讀 Config、後端讀 Code.gs 同名常數）必須一致。
    init: function () {
      this.bindNav();
      if (root.Config && root.Config.REQUIRE_PASSCODE) {
        var loginEl = document.getElementById(VIEW_IDS.login);
        var loginView = root.Views && root.Views.login;
        if (loginEl && loginView && typeof loginView.render === 'function') {
          loginView.render(loginEl, this);
        }
        return;
      }
      return this.login('');
    }
  };

  root.App = App;
  App.init();
})(typeof window !== 'undefined' ? window : this);
