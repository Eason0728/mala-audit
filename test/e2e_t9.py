#!/usr/bin/env python3
# T9 草稿看得見／回得去＋缺單位擋下 Playwright 驗收（python sync API）
# 跑法：python3 test/e2e_t9.py
# 涵蓋：(1) 重開稽核填寫會回到上次那家店（不再固定跳回第一家）
#       (2) 未送出草稿一覽：列出其他店月的草稿、點一下接著填、內容完整還原
#       (3) 丟棄草稿
#       (4) 品項庫單位留空的項目：該列出現單位欄，沒補就擋下送出，補了才過
#       (5) console 無 error
import http.server
import socketserver
import sys
import threading
import os

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PORT = 8799
BASE_URL = 'http://127.0.0.1:%d/index.html?mode=local' % PORT  # 假資料模式：不碰真試算表

BLANK_UNIT_ITEM = '台灣白芝麻粒（1斤/包）'   # 假資料裡刻意留空單位的品項（照真實品項庫）

failures = []


def check(cond, label):
    if cond:
        print('PASS: ' + label)
    else:
        print('FAIL: ' + label)
        failures.append(label)


def login(page):
    page.wait_for_selector('#login-code', timeout=10000)
    page.fill('#login-code', '1234')
    page.click('#login-submit')
    page.wait_for_selector('#main-nav:not([hidden])', timeout=10000)


def open_audit(page):
    page.evaluate("window.App.navigate('audit')")
    page.wait_for_selector('#audit-mode-group', timeout=8000)
    page.wait_for_timeout(150)


def add_item(page, name, unit=None):
    page.fill('#audit-add-input', name)
    page.wait_for_timeout(80)
    if unit is not None:
        page.fill('#audit-add-unit', unit)
    page.click('#audit-add-btn')
    page.wait_for_timeout(120)


def fill_vault(page, tip='700'):
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
        login(page)
        open_audit(page)

        # ================= 前置：在墨竹亭光復 2026-10 用只填異常項模式填一半 =================
        page.click('.audit-mode-btn[data-mode="anomaly"]')
        page.wait_for_timeout(150)
        page.select_option('#audit-store', 'mzt-gf')
        page.select_option('#audit-month', '2026-10')
        page.wait_for_timeout(200)
        add_item(page, '柚子醬')                       # mzt-gf 品項庫有，單位自動帶
        row1 = '#audit-items li.audit-item-row:nth-of-type(1) '
        page.fill(row1 + '.audit-book-qty', '5')
        page.fill(row1 + '.audit-recount-qty', '3')
        page.select_option(row1 + '.audit-reason', '損耗未記')
        page.wait_for_timeout(200)
        check(page.evaluate("!!localStorage.getItem('draft_mzt-gf_2026-10_anomaly')"),
              '前置：墨竹亭光復 2026-10 草稿已存')

        # ================= (1) 關掉重開 → 回到上次那家店 =================
        page.reload()
        login(page)
        open_audit(page)
        cur_store = page.eval_on_selector('#audit-store', 'e => e.value')
        check(cur_store == 'mzt-gf',
              '(1) 重開稽核填寫回到上次那家店 mzt-gf（實際 %s）' % cur_store)

        # ================= (2) 草稿一覽：切到別的店月後，前面那份要被列出來 =================
        page.select_option('#audit-store', 'sxl-gf')
        page.select_option('#audit-month', '2026-11')
        page.wait_for_timeout(250)
        check(page.get_attribute('#audit-drafts-card', 'hidden') is None,
              '(2) 切到別的店月後出現「未送出的草稿」區塊')
        rows = page.query_selector_all('#audit-drafts-list .audit-draft-row')
        txt = page.inner_text('#audit-drafts-list')
        check(len(rows) == 1, '(2) 草稿一覽只列一筆（實際 %d）' % len(rows))
        check('墨竹亭光復' in txt and '十月' in txt,
              '(2) 列出店名與月份（實際："%s"）' % txt.replace('\n', ' / '))
        check('只填異常項' in txt and '已填 1 項' in txt,
              '(2) 標示填寫方式與已填項數')

        # 點一下接著填 → 店月模式與內容全部還原
        page.click('#audit-drafts-list .audit-draft-resume')
        page.wait_for_timeout(300)
        back = page.evaluate("""() => ({
            store: window.AuditState.store, month: window.AuditState.month,
            mode: window.AuditState.mode, first: (window.AuditState.items[0] || {}).name })""")
        check(back == {'store': 'mzt-gf', 'month': '2026-10', 'mode': 'anomaly', 'first': '柚子醬'},
              '(2) 點「接著填」跳回原店月與模式、品項還在（%s）' % back)
        qty = page.eval_on_selector(
            '#audit-items li.audit-item-row:nth-of-type(1) .audit-book-qty', 'e => e.value')
        check(qty == '5', '(2) 已填的數字也還在（%s）' % qty)
        check(page.get_attribute('#audit-drafts-card', 'hidden') is not None,
              '(2) 回到該草稿後，一覽不再列自己（已無其他草稿）')

        # ================= (4a) 手動加入品項庫裡單位留空的項目 → 要求當場補單位 =================
        page.select_option('#audit-store', 'sxl-gf')
        page.select_option('#audit-month', '2026-11')
        page.wait_for_timeout(250)
        add_item(page, BLANK_UNIT_ITEM)          # 品項庫有這項，但單位是空的
        err_add = page.inner_text('#audit-add-error')
        check(page.get_attribute('#audit-add-error', 'hidden') is None and '品項庫沒有填' in err_add,
              '(4a) 品項庫沒填單位時，訊息講的是「庫裡沒填單位」不是「品項不存在」（"%s"）' % err_add)
        check(len(page.query_selector_all('#audit-items li.audit-item-row')) == 0,
              '(4a) 沒補單位前不加進清單')
        page.fill('#audit-add-unit', '包')
        page.click('#audit-add-btn')
        page.wait_for_timeout(200)
        added = page.evaluate("window.AuditState.items.map(i => i.name + '|' + i.unit)")
        check(added == [BLANK_UNIT_ITEM + '|包'], '(4a) 補了單位就加得進去（%s）' % added)

        # ================= (4b) 清單裡已經有缺單位的品項（抽樣抽到／舊草稿）=================
        # 抽樣是隨機的，測不出穩定結果；直接種一份含缺單位品項的草稿，
        # 這就是 2026-08-07 實際發生的狀態（sxl-gf 八月的台灣白芝麻粒單位是空的）。
        page.evaluate("""(name) => {
            localStorage.setItem('draft_sxl-gf_2026-12', JSON.stringify({
              store: 'sxl-gf', month: '2026-12',
              items: [{ name: name, unit: '', lastDrawn: null,
                        book_qty: '2.8', recount_qty: '2', verdict: '異常',
                        reason: '盤點錯誤（門市盤錯）', note: '' }],
              vault: { change_fund: '正確', petty_cash: '正確',
                       tip_amount: '1830', tip_match: '相符', note: '' }
            }));
        }""", BLANK_UNIT_ITEM)
        page.click('.audit-mode-btn[data-mode="full"]')
        page.wait_for_timeout(150)
        page.select_option('#audit-store', 'sxl-gf')
        page.select_option('#audit-month', '2026-12')
        page.wait_for_timeout(300)
        rowsel = '#audit-items li.audit-item-row:nth-of-type(1) '
        check(page.query_selector(rowsel + '.audit-item-unit-input') is not None,
              '(4b) 缺單位的那列出現可補的單位欄')
        check('缺單位' in page.inner_text(rowsel + '.audit-item-unit'),
              '(4b) 品項名稱旁標「(缺單位)」')

        page.click('#audit-submit-btn')
        page.wait_for_timeout(300)
        err = page.inner_text('#audit-submit-error')
        check(page.get_attribute('#audit-submit-error', 'hidden') is None and '缺單位' in err,
              '(4b) 沒補單位時擋下送出（實際："%s"）' % err.split('\n')[0][:40])

        page.fill(rowsel + '.audit-item-unit-input', '包')
        page.wait_for_timeout(200)
        page.click('#audit-submit-btn')
        page.wait_for_timeout(900)
        rec = page.evaluate("""() => {
            const r = (window.App.state.data.records || []).find(x => x.record_key === 'sxl-gf_2026-12');
            return r ? r.anomaly_text : null; }""")
        check(rec == '1.' + BLANK_UNIT_ITEM + ':盤點2.8包，覆盤2包',
              '(4b) 補了單位後送得出去，異常說明帶單位（實際："%s"）' % rec)

        # ================= (3) 丟棄草稿 =================
        open_audit(page)
        page.select_option('#audit-store', 'mzt-gf')
        page.select_option('#audit-month', '2026-09')
        page.wait_for_timeout(250)
        add_item(page, '芽菜')
        page.wait_for_timeout(150)
        page.select_option('#audit-store', 'sxl-gf')
        page.wait_for_timeout(250)
        before = len(page.query_selector_all('#audit-drafts-list .audit-draft-row'))
        check(before >= 1, '(3) 丟棄前草稿一覽有 %d 筆' % before)
        page.click('#audit-drafts-list .audit-draft-drop')
        page.wait_for_timeout(250)
        after = len(page.query_selector_all('#audit-drafts-list .audit-draft-row'))
        check(after == before - 1, '(3) 丟棄後少一筆（%d → %d）' % (before, after))

        # ================= (5) console =================
        check(not console_errors and not page_errors,
              '(5) 全程 console 無 error（console=%d, page=%d）' % (len(console_errors), len(page_errors)))
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
