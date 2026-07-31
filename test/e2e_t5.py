#!/usr/bin/env python3
# T5 填寫＋金庫＋草稿＋送出 Playwright 驗收（python sync API）
# 跑法：python3 test/e2e_t5.py
# 涵蓋：(1) 全流程送出 (2) 草稿還原 (3) 送出失敗保留草稿＋重試成功
#       (4) 覆蓋確認含原日期 (5) 驗證擋下缺項 (6) console 無 error
import http.server
import socketserver
import sys
import threading
import os

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PORT = 8795
BASE_URL = 'http://127.0.0.1:%d/index.html' % PORT

failures = []


def check(cond, label):
    if cond:
        print('PASS: ' + label)
    else:
        print('FAIL: ' + label)
        failures.append(label)


def login_and_open_audit(page, store='sxl-gf', month='2026-08'):
    """登入（會計碼 1234）→ 稽核頁 → 選店選月。"""
    page.wait_for_selector('#login-code', timeout=5000)
    page.fill('#login-code', '1234')
    page.click('#login-submit')
    page.wait_for_selector('#main-nav:not([hidden])', timeout=5000)
    page.evaluate("window.App.navigate('audit')")
    page.wait_for_selector('#audit-draw', timeout=5000)
    page.select_option('#audit-store', store)
    page.select_option('#audit-month', month)
    page.wait_for_timeout(150)


def fill_all_items(page, anomaly_count=2):
    """每列填盤點/複盤數並核定；前 anomaly_count 列判異常並選原因。
    注意：核定會整段重繪列表，DOM handle 會失效——每個動作都用 nth-child 重新定位。"""
    total = len(page.query_selector_all('#audit-items li.audit-item-row'))
    for idx in range(total):
        row_sel = '#audit-items li.audit-item-row:nth-of-type(%d) ' % (idx + 1)
        page.fill(row_sel + '.audit-book-qty', '10')
        if idx < anomaly_count:
            page.fill(row_sel + '.audit-recount-qty', '12')
            page.click(row_sel + '.audit-verdict-btn[data-verdict="異常"]')
            page.wait_for_timeout(60)
            page.select_option(row_sel + '.audit-reason', '損耗未記')
        else:
            page.fill(row_sel + '.audit-recount-qty', '10')
            page.click(row_sel + '.audit-verdict-btn[data-verdict="正確"]')
        page.wait_for_timeout(30)
    return total


def fill_vault(page, tip='800'):
    page.click('.audit-vault-btn[data-group="change_fund"][data-value="正確"]')
    page.click('.audit-vault-btn[data-group="petty_cash"][data-value="正確"]')
    page.fill('#audit-tip-amount', tip)
    page.click('.audit-vault-btn[data-group="tip_match"][data-value="相符"]')
    page.wait_for_timeout(100)


def main():
    os.chdir(ROOT)
    httpd = socketserver.TCPServer(('127.0.0.1', PORT), http.server.SimpleHTTPRequestHandler)
    threading.Thread(target=httpd.serve_forever, daemon=True).start()

    try:
        from playwright.sync_api import sync_playwright
    except ImportError:
        print('FAIL: playwright 未安裝')
        httpd.shutdown()
        sys.exit(1)

    console_errors = []
    page_errors = []

    with sync_playwright() as p:
        browser = p.chromium.launch()
        page = browser.new_page()
        page.on('console', lambda m: console_errors.append(m.text) if m.type == 'error' else None)
        page.on('pageerror', lambda exc: page_errors.append(str(exc)))
        page.goto(BASE_URL)

        # ================= (5) 驗證擋下（先測，避免污染資料）=================
        login_and_open_audit(page, 'sxl-gf', '2026-09')
        page.click('#audit-draw')
        page.wait_for_selector('#audit-items li.audit-item-row', timeout=5000)
        page.click('#audit-submit-btn')
        page.wait_for_timeout(200)
        err_hidden = page.get_attribute('#audit-submit-error', 'hidden')
        err_text = page.inner_text('#audit-submit-error')
        check(err_hidden is None and len(err_text) > 0, '(5) 未填就送出被擋下並顯示提示')
        check('金庫' in err_text or '零找金' in err_text or '未填' in err_text,
              '(5) 提示內容指出缺項（實際開頭："%s"）' % err_text.split('\n')[0][:40])

        # 只填品項、不填金庫 → 仍被擋
        fill_all_items(page, anomaly_count=1)
        page.click('#audit-submit-btn')
        page.wait_for_timeout(200)
        err_text2 = page.inner_text('#audit-submit-error')
        check('零找金' in err_text2 or '零用金' in err_text2 or '小費' in err_text2,
              '(5) 缺金庫時仍被擋（實際含金庫欄提示）')

        # ================= (2) 草稿還原 =================
        draft_key_exists = page.evaluate(
            "!!localStorage.getItem('draft_sxl-gf_2026-09')")
        check(draft_key_exists, '(2) 輸入後 localStorage 已存 draft_sxl-gf_2026-09')
        first_item_before = page.evaluate(
            "window.AuditState.items[0].name")
        qty_before = page.eval_on_selector('#audit-items li.audit-item-row .audit-book-qty', 'e => e.value')

        page.reload()
        login_and_open_audit(page, 'sxl-gf', '2026-09')
        page.wait_for_timeout(300)
        rows_restored = page.query_selector_all('#audit-items li.audit-item-row')
        first_item_after = page.evaluate("window.AuditState.items[0] && window.AuditState.items[0].name")
        qty_after = page.eval_on_selector('#audit-items li.audit-item-row .audit-book-qty', 'e => e.value') \
            if rows_restored else None
        check(len(rows_restored) == 20, '(2) 重載後清單還原 20 列（實際 %d）' % len(rows_restored))
        check(first_item_after == first_item_before,
              '(2) 第一列品項一致（%s）' % first_item_after)
        check(qty_after == qty_before and qty_after == '10', '(2) 已填數字還原（%s）' % qty_after)

        # ================= (3) 送出失敗 → 草稿保留 → 重試成功 =================
        fill_vault(page, '800')
        # 包成箭頭函式：直接回傳函式會被 Playwright 當結果再呼叫一次，旗標會被誤消耗
        page.evaluate("""() => {
            window.__realSubmit = window.Api.submitAudit;
            window.__failOnce = true;
            window.Api.submitAudit = function (code, record, details) {
                if (window.__failOnce) {
                    window.__failOnce = false;
                    return Promise.reject(new Error('模擬斷網'));
                }
                return window.__realSubmit(code, record, details);
            };
        }""")
        page.click('#audit-submit-btn')
        page.wait_for_timeout(400)
        retry_hidden = page.get_attribute('#audit-retry-btn', 'hidden')
        fail_text = page.inner_text('#audit-submit-error')
        draft_kept = page.evaluate("!!localStorage.getItem('draft_sxl-gf_2026-09')")
        check(retry_hidden is None, '(3) 送出失敗後「重試送出」按鈕出現')
        check('失敗' in fail_text, '(3) 顯示送出失敗訊息')
        check(draft_kept, '(3) 失敗後草稿仍保留')

        page.click('#audit-retry-btn')
        page.wait_for_timeout(600)
        draft_cleared = page.evaluate("!localStorage.getItem('draft_sxl-gf_2026-09')")
        check(draft_cleared, '(3) 重試成功後草稿已清除')

        # ================= (1) 全流程：報告頁與總覽同步 =================
        page.wait_for_selector('#view-report:not([hidden])', timeout=5000)
        report_text = page.inner_text('#view-report')
        check('95%' in report_text,
              '(1) 送出後跳報告頁且顯示正確率 95%（19正確/20，1 項異常）')
        check('800' in report_text, '(1) 報告頁顯示小費金額 800')
        page.evaluate("window.App.navigate('overview')")
        page.wait_for_timeout(300)
        overview_text = page.inner_text('#view-overview')
        check('%' in overview_text, '(1) 總覽顯示百分比格')
        cell_val = page.evaluate("""
            (() => {
              const r = (window.App.state.data.records || [])
                .find(x => x.record_key === 'sxl-gf_2026-09');
              return r ? String(r.correct_rate) + '|' + String(r.tip_amount) + '|' + r.status : null;
            })()
        """)
        check(cell_val is not None and cell_val.endswith('|已稽核') and '800' in cell_val,
              '(1) 資料層有 sxl-gf_2026-09 已稽核紀錄（%s）' % cell_val)

        # ================= (4) 覆蓋確認（對已有紀錄的月份）=================
        page.evaluate("window.App.navigate('audit')")
        page.wait_for_selector('#audit-draw', timeout=5000)
        page.select_option('#audit-store', 'sxl-gf')
        page.select_option('#audit-month', '2026-01')
        page.wait_for_timeout(200)
        page.click('#audit-draw')
        page.wait_for_selector('#audit-items li.audit-item-row', timeout=5000)
        fill_all_items(page, anomaly_count=0)
        fill_vault(page, '457')
        page.click('#audit-submit-btn')
        page.wait_for_timeout(300)
        dlg_hidden = page.get_attribute('#audit-overwrite-dialog', 'hidden')
        dlg_text = page.inner_text('#audit-overwrite-text')
        check(dlg_hidden is None, '(4) 已有紀錄月份送出 → 覆蓋確認對話出現')
        check('2026-01' in dlg_text or '覆蓋' in dlg_text,
              '(4) 對話含原紀錄日期／覆蓋字樣（實際："%s"）' % dlg_text)

        page.click('#audit-overwrite-cancel')
        page.wait_for_timeout(150)
        check(page.get_attribute('#audit-overwrite-dialog', 'hidden') is not None,
              '(4) 取消後對話關閉、未送出')

        # ================= (6) console =================
        check(not console_errors and not page_errors,
              '(6) 全程 console 無 error（console=%d, page=%d）' % (len(console_errors), len(page_errors)))
        if console_errors or page_errors:
            print('  console:', console_errors[:3])
            print('  page:', page_errors[:3])

        browser.close()

    httpd.shutdown()
    print()
    if failures:
        print('失敗項目：')
        for f in failures:
            print(' - ' + f)
        sys.exit(1)
    print('全部測試通過')


if __name__ == '__main__':
    main()
