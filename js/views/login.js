// 登入畫面 —— T3 實作
// window.Views.login = { render(el, app) }
// 通行碼輸入 → app.login(code)；錯 3 次前端冷卻 30 秒（spec §7）。

(function (root) {
  'use strict';

  var MAX_ATTEMPTS = 3;
  var COOLDOWN_SECONDS = 30;

  function render(el, app) {
    var failCount = 0;
    var cooldownTimer = null;
    var cooldownRemaining = 0;

    el.innerHTML =
      '<div class="card login-card">' +
        '<h2>登入</h2>' +
        '<label for="login-code">通行碼</label>' +
        '<input type="password" id="login-code" inputmode="numeric" autocomplete="off" placeholder="輸入通行碼">' +
        '<p id="login-error" class="status-danger" hidden></p>' +
        '<button type="button" id="login-submit" class="btn" style="margin-top:8px;">登入</button>' +
      '</div>';

    var codeInput = el.querySelector('#login-code');
    var errorEl = el.querySelector('#login-error');
    var submitBtn = el.querySelector('#login-submit');

    function showError(msg) {
      errorEl.textContent = msg;
      errorEl.hidden = false;
    }

    function clearError() {
      errorEl.hidden = true;
      errorEl.textContent = '';
    }

    function tickCooldown() {
      cooldownRemaining--;
      if (cooldownRemaining <= 0) {
        clearInterval(cooldownTimer);
        cooldownTimer = null;
        submitBtn.disabled = false;
        codeInput.disabled = false;
        submitBtn.textContent = '登入';
        failCount = 0;
        clearError();
      } else {
        showError('通行碼錯誤次數過多，請等待 ' + cooldownRemaining + ' 秒後再試');
        submitBtn.textContent = '請稍候（' + cooldownRemaining + ' 秒）';
      }
    }

    function startCooldown() {
      cooldownRemaining = COOLDOWN_SECONDS;
      submitBtn.disabled = true;
      codeInput.disabled = true;
      showError('通行碼錯誤次數過多，請等待 ' + cooldownRemaining + ' 秒後再試');
      submitBtn.textContent = '請稍候（' + cooldownRemaining + ' 秒）';
      cooldownTimer = setInterval(tickCooldown, 1000);
    }

    function submit() {
      if (submitBtn.disabled) return;
      var code = (codeInput.value || '').trim();
      if (!code) {
        showError('請輸入通行碼');
        return;
      }
      clearError();
      submitBtn.disabled = true;
      submitBtn.textContent = '登入中…';
      app.login(code).then(function (res) {
        if (!res || !res.ok) {
          submitBtn.disabled = false;
          submitBtn.textContent = '登入';
          failCount++;
          if (failCount >= MAX_ATTEMPTS) {
            startCooldown();
          } else {
            showError('通行碼錯誤（' + failCount + '/' + MAX_ATTEMPTS + '）');
          }
        }
        // 成功時 app.login 內部已 navigate('overview')，此畫面即被替換，無需復原按鈕狀態。
      }).catch(function () {
        submitBtn.disabled = false;
        submitBtn.textContent = '登入';
        showError('登入失敗，請稍後再試');
      });
    }

    submitBtn.addEventListener('click', submit);
    codeInput.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') submit();
    });
  }

  root.Views = root.Views || {};
  root.Views.login = { render: render };
})(typeof window !== 'undefined' ? window : this);
