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
      if (!self.state.code) {
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

    // ---- 初始化：顯示登入畫面，綁定 nav 點擊 ----
    init: function () {
      this.bindNav();
      var loginEl = document.getElementById(VIEW_IDS.login);
      var loginView = root.Views && root.Views.login;
      if (loginEl && loginView && typeof loginView.render === 'function') {
        loginView.render(loginEl, this);
      }
    }
  };

  root.App = App;
  App.init();
})(typeof window !== 'undefined' ? window : this);
