#!/usr/bin/env python3
# T8「只填異常項」模式 Playwright 驗收（python sync API）
# 跑法：python3 test/e2e_t8.py
# 涵蓋：(1) 切模式後畫面樣貌（抽樣鈕隱藏、每列不再要求核定）
#       (2) 1 項異常 → 即時顯示正確率 95%
#       (3) 送出後資料層 sample_count=20 / correct_count=19 / correct_rate=95
#       (4) 0 項異常 → 100%（不被「尚未抽樣」擋下）
#       (5) 超過 20 項異常 → 擋下送出
#       (6) 兩模式草稿互不覆蓋、模式選擇跨重載記住
#       (7) 品項庫沒有的名稱 → 明講加不進來
#       (8) console 無 error
import http.server
import socketserver
import sys
import threading
import os

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PORT = 8798
BASE_URL = 'http://127.0.0.1:%d/index.html?mode=local' % PORT  # 假資料模式：不碰真試算表、用 mock 通行碼

failures = []


def check(cond, label):
    if cond:
        print('PASS: ' + label)
    else:
        print('FAIL: ' + label)
        failures.append(label)


def login_and_open_audit(page, store='sxl-gf', month='2026-10'):
    """登入（mock 會計碼 1234）→ 稽核頁 → 選店選月。"""
    page.wait_for_selector('#login-code', timeout=8000)
    page.fill('#login-code', '1234')
    page.click('#login-submit')
    page.wait_for_selector('#main-nav:not([hidden])', timeout=8000)
    page.evaluate("window.App.navigate('audit')")
    page.wait_for_selector('#audit-mode-group', timeout=5000)
    page.select_option('#audit-store', store)
    page.select_option('#audit-month', month)
    page.wait_for_timeout(150)


def set_mode(page, mode):
    page.click('#audit-mode-group .audit-mode-btn[data-mode="%s"]' % mode)
    page.wait_for_timeout(150)


def store_item_names(page, store='sxl-gf', n=25):
    """從資料層取該店品項庫名稱，避免把 mock 品項名寫死在測試裡。"""
    return page.evaluate("""
        (args) => (window.App.state.data.items || [])
            .filter(i => i.store === args.store && i.active !== false)
            .slice(0, args.n)
            .map(i => i.name)
    """, {'store': store, 'n': n})


def add_anomaly(page, name, book='10', recount='12', reason='損耗未記'):
    """在只填異常項模式下加入一項並填完：加入會整段重繪，用 nth-of-type 重新定位。"""
    page.fill('#audit-add-input', name)
    page.click('#audit-add-btn')
    page.wait_for_timeout(80)
    idx = len(page.query_selector_all('#audit-items li.audit-item-row'))
    row = '#audit-items li.audit-item-row:nth-of-type(%d) ' % idx
    page.fill(row + '.audit-book-qty', book)
    page.fill(row + '.audit-recount-qty', recount)
    page.select_option(row + '.audit-reason', reason)
    page.wait_for_timeout(50)


def fill_vault(page, tip='800'):
    page.click('.audit-vault-btn[data-group="change_fund"][data-value="正確"]')
    page.click('.audit-vault-btn[data-group="petty_cash"][data-value="正確"]')
    page.fill('#audit-tip-amount', tip)
    page.click('.audit-vault-btn[data-group="tip_match"][data-value="相符"]')
    page.wait_for_timeout(100)


def record_of(page, key):
    return page.evaluate("""
        (k) => {
          const r = (window.App.state.data.records || []).find(x => x.record_key === k);
          return r ? {
            sample: Number(r.sample_count),
            correct: Number(r.correct_count),
            rate: Number(r.correct_rate),
            status: r.status,
            anomaly: r.anomaly_text
          } : null;
        }
    """, key)


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

        login_and_open_audit(page, 'sxl-gf', '2026-10')
        names = store_item_names(page)
        check(len(names) >= 21, '前置：sxl-gf 品項庫至少 21 項（實際 %d）' % len(names))

        # ================= (1) 切模式後的畫面樣貌 =================
        check(page.get_attribute('#audit-draw', 'hidden') is None,
              '(1) 完整模式下抽樣鈕可見')
        set_mode(page, 'anomaly')
        check(page.get_attribute('#audit-draw', 'hidden') is not None,
              '(1) 切到只填異常項後抽樣鈕隱藏')
        hint = page.inner_text('#audit-mode-hint')
        check('20' in hint and '異常' in hint, '(1) 模式說明提到只填異常＋分母 20（"%s"）' % hint)
        check(page.evaluate("window.AuditState.mode") == 'anomaly',
              '(1) AuditState.mode 同步為 anomaly')

        # ================= (7) 品項庫沒有的名稱 =================
        page.fill('#audit-add-input', '這個品項不存在XYZ')
        page.click('#audit-add-btn')
        page.wait_for_timeout(120)
        check(page.get_attribute('#audit-add-error', 'hidden') is None,
              '(7) 品項庫沒有的名稱會顯示錯誤，不是靜靜沒反應')
        check(len(page.query_selector_all('#audit-items li.audit-item-row')) == 0,
              '(7) 錯誤名稱沒有被加進清單')

        # ================= (2) 1 項異常 → 95% =================
        add_anomaly(page, names[0])
        rows = page.query_selector_all('#audit-items li.audit-item-row')
        check(len(rows) == 1, '(2) 加入 1 項異常（實際 %d 列）' % len(rows))
        check(len(page.query_selector_all('#audit-items .audit-verdict-btn')) == 0,
              '(2) 只填異常項模式不顯示正確／異常核定鈕')
        check(len(page.query_selector_all('#audit-items .audit-item-redraw')) == 0,
              '(2) 只填異常項模式不顯示「換一項」')
        check(page.evaluate("window.AuditState.items[0].verdict") == '異常',
              '(2) 加入的項目判定自動為「異常」')
        warn_text = page.inner_text('#audit-count-warning')
        check('95%' in warn_text, '(2) 即時顯示正確率 95%%（實際："%s"）' % warn_text)

        # ================= (6a) 切回完整模式：兩份草稿互不覆蓋 =================
        set_mode(page, 'full')
        check(len(page.query_selector_all('#audit-items li.audit-item-row')) == 0,
              '(6) 切回完整模式時是該模式自己的空草稿，沒被異常清單汙染')
        set_mode(page, 'anomaly')
        check(page.evaluate("(window.AuditState.items[0] || {}).name") == names[0],
              '(6) 切回只填異常項，剛才那一項還在（草稿分開存）')
        check(page.eval_on_selector('#audit-items li.audit-item-row .audit-book-qty', 'e => e.value') == '10',
              '(6) 已填的盤點數也還在')

        # ================= (3) 送出 → 19/20 = 95% =================
        fill_vault(page, '800')
        page.click('#audit-submit-btn')
        page.wait_for_timeout(600)
        page.wait_for_selector('#view-report:not([hidden])', timeout=5000)
        rec = record_of(page, 'sxl-gf_2026-10')
        check(rec is not None and rec['sample'] == 20,
              '(3) sample_count 固定 20（實際 %s）' % (rec and rec['sample']))
        check(rec is not None and rec['correct'] == 19,
              '(3) correct_count＝20−1＝19（實際 %s）' % (rec and rec['correct']))
        check(rec is not None and rec['rate'] == 95,
              '(3) correct_rate＝95（實際 %s）' % (rec and rec['rate']))
        check(rec is not None and rec['anomaly'].startswith('1.' + names[0] + ':盤點10'),
              '(3) 異常說明照原格式組字（實際："%s"）' % (rec and rec['anomaly']))
        check('95%' in page.inner_text('#view-report'), '(3) 報告頁顯示 95%')
        check(page.evaluate("!localStorage.getItem('draft_sxl-gf_2026-10_anomaly')") and
              page.evaluate("!localStorage.getItem('draft_sxl-gf_2026-10')"),
              '(3) 送出成功後兩種模式的草稿都清掉')

        # ================= (6b) 模式選擇跨重載記住 =================
        page.reload()
        login_and_open_audit(page, 'sxl-gf', '2026-11')
        check(page.evaluate("window.AuditState.mode") == 'anomaly',
              '(6) 重載後仍停在只填異常項模式')

        # ================= (4) 0 項異常 → 100% =================
        fill_vault(page, '500')
        page.click('#audit-submit-btn')
        page.wait_for_timeout(600)
        rec0 = record_of(page, 'sxl-gf_2026-11')
        check(rec0 is not None and rec0['rate'] == 100 and rec0['correct'] == 20,
              '(4) 0 項異常＝20/20＝100%%（實際 %s）' % (rec0,))
        check(rec0 is not None and rec0['anomaly'] == '',
              '(4) 0 項異常時異常說明為空字串')

        # ================= (5) 超過 20 項 → 擋下 =================
        page.evaluate("window.App.navigate('audit')")
        page.wait_for_selector('#audit-mode-group', timeout=5000)
        page.select_option('#audit-store', 'sxl-gf')
        page.select_option('#audit-month', '2026-12')
        page.wait_for_timeout(200)
        for nm in names[:21]:
            add_anomaly(page, nm)
        check(len(page.query_selector_all('#audit-items li.audit-item-row')) == 21,
              '(5) 已加入 21 項異常')
        warn21 = page.inner_text('#audit-count-warning')
        check('超過' in warn21, '(5) 超量時提示「超過」（實際："%s"）' % warn21)
        fill_vault(page, '300')
        page.click('#audit-submit-btn')
        page.wait_for_timeout(300)
        err21 = page.inner_text('#audit-submit-error')
        check(page.get_attribute('#audit-submit-error', 'hidden') is None and '超過' in err21,
              '(5) 超過 20 項時送出被擋下（實際："%s"）' % err21.split('\n')[0][:40])
        check(record_of(page, 'sxl-gf_2026-12') is None,
              '(5) 被擋下時資料層沒有寫入 2026-12 紀錄')

        # ================= (8) console =================
        check(not console_errors and not page_errors,
              '(8) 全程 console 無 error（console=%d, page=%d）' % (len(console_errors), len(page_errors)))
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
