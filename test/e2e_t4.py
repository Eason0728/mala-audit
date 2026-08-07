#!/usr/bin/env python3
# T4 抽樣模組 Playwright 驗收（python sync API）
# 跑法：python3 test/e2e_t4.py
# 流程：起 python3 -m http.server 起本機靜態伺服，登入(會計碼 1234)，
#       app.navigate('audit')（app.js/login.js/overview.js 已由其他任務完成，非 harness），
#       隨機抽 20 項 → #audit-items 應有 20 列；點「換一項」該列品項變更且總數不變；
#       刪除一列後提醒文字出現「19」；全程 console 無 error。
import http.server
import socketserver
import subprocess
import sys
import threading
import time
import os

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PORT = 8793
BASE_URL = 'http://127.0.0.1:%d/index.html?mode=local' % PORT  # 假資料模式：不碰真試算表、用 mock 通行碼

failures = []


def check(cond, label):
    if cond:
        print('PASS: ' + label)
    else:
        print('FAIL: ' + label)
        failures.append(label)


def main():
    os.chdir(ROOT)
    handler = http.server.SimpleHTTPRequestHandler
    httpd = socketserver.TCPServer(('127.0.0.1', PORT), handler)
    server_thread = threading.Thread(target=httpd.serve_forever, daemon=True)
    server_thread.start()

    try:
        from playwright.sync_api import sync_playwright
    except ImportError:
        print('FAIL: playwright 未安裝（pip install playwright && playwright install chromium）')
        httpd.shutdown()
        sys.exit(1)

    console_errors = []
    page_errors = []

    with sync_playwright() as p:
        browser = p.chromium.launch()
        page = browser.new_page()

        def on_console(msg):
            if msg.type == 'error':
                console_errors.append(msg.text)

        page.on('console', on_console)
        page.on('pageerror', lambda exc: page_errors.append(str(exc)))

        page.goto(BASE_URL)

        # ---- 登入（mock 會計碼 1234；正式密碼在試算表，不進 repo）----
        page.wait_for_selector('#login-code', timeout=8000)
        page.fill('#login-code', '1234')
        page.click('#login-submit')
        page.wait_for_selector('#main-nav:not([hidden])', timeout=8000)
        check(True, '登入成功，nav 顯示')

        # ---- navigate('audit')（app.js 已由 T3 完成，非 harness；window.App 是 app 實例）----
        page.evaluate("window.App.navigate('audit')")
        page.wait_for_selector('#view-audit:not([hidden])', timeout=5000)
        page.wait_for_selector('#audit-draw', timeout=5000)
        check(True, 'navigate(audit) 後 #audit-draw 出現')

        # ---- 隨機抽 20 項 ----
        page.click('#audit-draw')
        page.wait_for_selector('#audit-items li', timeout=5000)
        rows = page.query_selector_all('#audit-items li.audit-item-row')
        check(len(rows) == 20, '隨機抽 20 → #audit-items 有 20 列（實際 %d）' % len(rows))

        # data-item / data-unit 屬性存在。
        # data-unit 允許是空字串——品項庫本來就有單位留空的項目（真實庫裡 58 項），
        # 那種列會在畫面上標「(缺單位)」並要求當場補，送出前才擋。屬性本身仍要在。
        has_attrs = all(
            r.get_attribute('data-item') and r.get_attribute('data-unit') is not None
            for r in rows
        )
        check(has_attrs, '每列皆有 data-item / data-unit 屬性（data-unit 可為空）')
        blank_units = [r.get_attribute('data-item') for r in rows
                       if r.get_attribute('data-unit') == '']
        if blank_units:
            print('  （本次抽到 %d 項品項庫沒填單位的：%s）' % (len(blank_units), '、'.join(blank_units)))

        # ---- 點「換一項」該列品項變更且總數不變 ----
        first_row = rows[0]
        before_name = first_row.get_attribute('data-item')
        first_row.query_selector('.audit-item-redraw').click()
        page.wait_for_timeout(200)
        rows_after = page.query_selector_all('#audit-items li.audit-item-row')
        after_name = rows_after[0].get_attribute('data-item')
        check(len(rows_after) == 20, '換一項後總數仍是 20（實際 %d）' % len(rows_after))
        check(before_name != after_name, '換一項後第一列品項變更（%s → %s）' % (before_name, after_name))

        # ---- 刪除一列後提醒文字出現「19」----
        rows_after[0].query_selector('.audit-item-remove').click()
        page.wait_for_timeout(200)
        rows_final = page.query_selector_all('#audit-items li.audit-item-row')
        check(len(rows_final) == 19, '刪除一列後剩 19 列（實際 %d）' % len(rows_final))
        warning_text = page.inner_text('#audit-count-warning')
        check('19' in warning_text, '提醒文字出現「19」（實際："%s"）' % warning_text)
        warning_hidden = page.get_attribute('#audit-count-warning', 'hidden')
        check(warning_hidden is None, '提醒區塊在 19 項時可見（未 hidden）')

        # ---- window.AuditState 同步檢查（給 T5 用的擴充點）----
        audit_state = page.evaluate('window.AuditState')
        check(
            isinstance(audit_state, dict) and len(audit_state.get('items', [])) == 19,
            'window.AuditState.items 與畫面同步（19 項）'
        )

        # ---- 加入品項（手動輸入 datalist 中的品項名）----
        datalist_first_value = page.evaluate(
            "document.querySelector('#audit-item-datalist option') && "
            "document.querySelector('#audit-item-datalist option').value"
        )
        if datalist_first_value:
            # 挑一個目前不在清單中的品項名稱加入
            existing_names = set(r.get_attribute('data-item') for r in
                                  page.query_selector_all('#audit-items li.audit-item-row'))
            all_options = page.evaluate(
                "Array.from(document.querySelectorAll('#audit-item-datalist option')).map(o => o.value)"
            )
            candidate = next((n for n in all_options if n not in existing_names), None)
            if candidate:
                page.fill('#audit-add-input', candidate)
                page.click('#audit-add-btn')
                page.wait_for_timeout(200)
                rows_add = page.query_selector_all('#audit-items li.audit-item-row')
                check(len(rows_add) == 20, '加入品項後回到 20 列（實際 %d）' % len(rows_add))
                added_names = [r.get_attribute('data-item') for r in rows_add]
                check(candidate in added_names, '加入的品項「%s」出現在清單中' % candidate)

        # ---- console 無 error ----
        check(len(console_errors) == 0, 'console 無 error（實際 %d 筆：%s）' % (len(console_errors), console_errors))
        check(len(page_errors) == 0, '頁面無未捕捉例外（實際 %d 筆：%s）' % (len(page_errors), page_errors))

        browser.close()

    httpd.shutdown()

    if failures:
        print('\n%d 項測試失敗：' % len(failures))
        for f in failures:
            print('  - ' + f)
        sys.exit(1)
    else:
        print('\n全部測試通過')


if __name__ == '__main__':
    main()
