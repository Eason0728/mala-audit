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
    overview: 'view-overview',
    audit: 'view-audit',
    report: 'view-report',
    analysis: 'view-analysis'
  };

  var NAV_TABS = ['overview', 'audit', 'report', 'analysis'];

  var App = {
    state: {
      role: null,
      code: null,
      data: null,
      year: '2026',
      params: {},
      tab: null
    },

    // ---- 登入：Api.auth → 成功存 role/code → Api.getAll → 顯示 nav → navigate('overview') ----
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
          self.showNav();
          self.navigate('overview');
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
    navigate: function (tab, params) {
      if (NAV_TABS.indexOf(tab) === -1) return;
      // 未登入不得離開登入畫面（導覽列本來就藏著，這是第二道保險）
      if (!this.state.role) return;
      this.state.tab = tab;
      this.state.params = params || {};
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

    showNav: function () {
      var nav = document.getElementById('main-nav');
      if (nav) nav.hidden = false;
    },

    bindNav: function () {
      var self = this;
      var buttons = document.querySelectorAll('#main-nav .nav-btn');
      for (var i = 0; i < buttons.length; i++) {
        buttons[i].addEventListener('click', function (e) {
          var tab = e.currentTarget.getAttribute('data-view');
          self.navigate(tab);
        });
      }
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
