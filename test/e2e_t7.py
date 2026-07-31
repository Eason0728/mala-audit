#!/usr/bin/env python3
# T7 異常分析＋Phase 1 全流程整驗（Playwright python sync）
# 跑法：python3 test/e2e_t7.py
# 前半：異常分析三張表（數值以 node 從 mock 資料實算為準：異常 27 筆、
#       各店 sxl-gf 12／mzt-js 5／mzt-gf 5／mzt-lzl 5／ck 0、
#       累犯前三＝鴨血/米血/打拋醬 各 2 次、原因全為「未分類」）＋區間篩選。
# 後半：Phase 1 全流程走查（開頁→總覽→稽核送出→報告→分析→列印樣式），console 必須無 error。
import http.server
import socketserver
import sys
import threading
import os

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PORT = 8797
BASE_URL = 'http://127.0.0.1:%d/index.html?mode=local' % PORT  # 假資料模式：不碰真試算表、用 mock 通行碼

failures = []


def check(cond, label):
    if cond:
        print('PASS: ' + label)
    else:
        print('FAIL: ' + label)
        failures.append(label)


def open_app(page):
    """已上鎖：用 mock 會計碼 1234 登入（正式密碼在試算表，不進 repo）。"""
    page.wait_for_selector('#login-code', timeout=8000)
    page.fill('#login-code', '1234')
    page.click('#login-submit')
    page.wait_for_selector('#main-nav:not([hidden])', timeout=8000)


def table_rows(page, container_sel):
    """回傳 [[cell_text,...],...]（不含表頭）"""
    return page.evaluate("""(sel) => {
        const t = document.querySelector(sel + ' table');
        if (!t) return [];
        return Array.from(t.querySelectorAll('tbody tr')).map(
            tr => Array.from(tr.querySelectorAll('td')).map(td => td.innerText.trim()));
    }""", container_sel)


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
        page = browser.new_page(viewport={'width': 390, 'height': 844})  # 手機尺寸
        page.on('console', lambda m: console_errors.append(m.text) if m.type == 'error' else None)
        page.on('pageerror', lambda exc: page_errors.append(str(exc)))
        page.goto(BASE_URL)

        # ============ 異常分析 ============
        open_app(page)
        page.evaluate("window.App.navigate('analysis')")
        page.wait_for_selector('#an-repeat table', timeout=5000)

        # (a) 累犯品項排行
        repeat = table_rows(page, '#an-repeat')
        check(len(repeat) == 24, '累犯表列出 24 個不同品項（實際 %d）' % len(repeat))
        top3 = [(r[0], r[1]) for r in repeat[:3]]
        top3_items = sorted(x[0] for x in top3)
        check(top3_items == sorted(['鴨血', '米血', '打拋醬']),
              '前三名＝鴨血/米血/打拋醬（實際 %s）' % top3_items)
        check(all(x[1] == '2' for x in top3), '前三名次數皆為 2（實際 %s）' % [x[1] for x in top3])
        total_count = sum(int(r[1]) for r in repeat)
        check(total_count == 27, '累犯表次數總和＝異常明細總數 27（實際 %d）' % total_count)

        # 跨店累犯要標出兩家店
        yaxue = [r for r in repeat if r[0] == '鴨血'][0]
        check('小辛辣光復' in yaxue[2] and '六張犁' in yaxue[2],
              '鴨血列出兩家店（實際："%s"）' % yaxue[2].replace('\n', ' / '))

        # (b) 原因分類
        reasons = table_rows(page, '#an-reasons')
        check(len(reasons) == 1 and reasons[0][0] == '未分類' and reasons[0][1] == '27',
              '原因分類：未分類 27 筆（歷史匯入無分類；實際 %s）' % reasons)

        # (c) 各店異常數
        stores = table_rows(page, '#an-stores')
        store_map = {r[0]: r[1] for r in stores}
        check(store_map.get('小辛辣光復') == '12', '小辛辣光復 12 項異常（實際 %s）' % store_map.get('小辛辣光復'))
        check(store_map.get('央廚') == '0', '央廚 0 項異常（實際 %s）' % store_map.get('央廚'))
        check(len(stores) == 5, '各店表五列（實際 %d）' % len(stores))
        sxl_row = [r for r in stores if r[0] == '小辛辣光復'][0]
        check(sxl_row[2] == '7', '小辛辣光復稽核 7 次（實際 %s）' % sxl_row[2])
        check(sxl_row[3] == '9%', '小辛辣光復異常率 9%%（12/140；實際 %s）' % sxl_row[3])

        # 區間篩選：只看 2026-02
        page.select_option('#an-from', '2026-02')
        page.select_option('#an-to', '2026-02')
        page.wait_for_timeout(200)
        repeat_feb = table_rows(page, '#an-repeat')
        feb_total = sum(int(r[1]) for r in repeat_feb)
        check(feb_total == 6, '篩 2026-02 後異常總數 6（實際 %d）' % feb_total)
        feb_items = sorted(r[0] for r in repeat_feb)
        check('打拋醬' in feb_items and '雞豚高湯' in feb_items,
              '2 月清單含打拋醬與雞豚高湯（實際 %s）' % feb_items)

        # 起訖顛倒：剛動的那欄說了算、另一欄讓位（此時 起=02 迄=02）
        page.select_option('#an-from', '2026-07')   # 起 > 迄 → 迄 跟上到 07
        page.wait_for_timeout(200)
        check(page.input_value('#an-to') == '2026-07',
              '把「起」拉到 07（大於迄）→ 迄自動跟上為 07（實際 %s）' % page.input_value('#an-to'))
        jul_total = sum(int(r[1]) for r in table_rows(page, '#an-repeat'))
        check(jul_total == 4, '此時區間＝七月，異常 4 筆（sxl-gf 肉燥 1＋mzt-js 3；實際 %d）' % jul_total)

        page.select_option('#an-to', '2026-01')     # 迄 < 起 → 起 讓位到 01
        page.wait_for_timeout(200)
        check(page.input_value('#an-from') == '2026-01',
              '把「迄」拉到 01（小於起）→ 起自動讓位為 01（實際 %s）' % page.input_value('#an-from'))
        jan_total = sum(int(r[1]) for r in table_rows(page, '#an-repeat'))
        check(jan_total == 4, '此時區間＝一月，異常 4 筆（實際 %d）' % jan_total)

        # ============ Phase 1 全流程走查 ============
        page.select_option('#an-from', '')
        page.select_option('#an-to', '')
        page.wait_for_timeout(150)

        # 總覽
        page.evaluate("window.App.navigate('overview')")
        page.wait_for_timeout(250)
        ov = page.inner_text('#view-overview')
        check('80%' in ov and '輪休' in ov, '總覽同時顯示正確率與輪休')

        # 稽核：抽樣→填→送出（走完整送出路徑，驗全流程串接）
        page.evaluate("window.App.navigate('audit')")
        page.wait_for_selector('#audit-draw', timeout=5000)
        page.select_option('#audit-store', 'mzt-gf')
        page.select_option('#audit-month', '2026-08')
        page.wait_for_timeout(150)
        page.click('#audit-draw')
        page.wait_for_selector('#audit-items li.audit-item-row', timeout=5000)
        total = len(page.query_selector_all('#audit-items li.audit-item-row'))
        for idx in range(total):
            sel = '#audit-items li.audit-item-row:nth-of-type(%d) ' % (idx + 1)
            page.fill(sel + '.audit-book-qty', '5')
            if idx == 0:
                page.fill(sel + '.audit-recount-qty', '6')
                page.click(sel + '.audit-verdict-btn[data-verdict="異常"]')
                page.wait_for_timeout(60)
                page.select_option(sel + '.audit-reason', '單位混淆')
            else:
                page.fill(sel + '.audit-recount-qty', '5')
                page.click(sel + '.audit-verdict-btn[data-verdict="正確"]')
            page.wait_for_timeout(25)
        page.click('.audit-vault-btn[data-group="change_fund"][data-value="正確"]')
        page.click('.audit-vault-btn[data-group="petty_cash"][data-value="不正確"]')
        page.fill('#audit-tip-amount', '300')
        page.click('.audit-vault-btn[data-group="tip_match"][data-value="不相符"]')
        page.wait_for_timeout(150)
        page.click('#audit-submit-btn')
        page.wait_for_selector('#view-report:not([hidden])', timeout=8000)
        rep = page.inner_text('#view-report')
        check('95%' in rep, '送出後報告顯示 95%（19/20）')
        check('不正確' in rep and '不相符' in rep, '報告顯示零用金不正確與小費不相符')

        # 新送出的異常原因要進分析（未分類以外的第二種原因出現）
        page.evaluate("window.App.navigate('analysis')")
        page.wait_for_selector('#an-reasons table', timeout=5000)
        reasons2 = {r[0]: r[1] for r in table_rows(page, '#an-reasons')}
        check(reasons2.get('單位混淆') == '1', '分析新增「單位混淆」1 筆（實際 %s）' % reasons2)
        check(reasons2.get('未分類') == '27', '未分類仍為 27（實際 %s）' % reasons2.get('未分類'))

        # 年度總表 + 列印樣式
        page.evaluate("window.App.navigate('report')")
        page.wait_for_timeout(300)
        page.emulate_media(media='print')
        page.wait_for_timeout(150)
        nav_display = page.evaluate(
            "getComputedStyle(document.querySelector('#main-nav')).display")
        check(nav_display == 'none', '列印模式 nav 隱藏（實際 %s）' % nav_display)
        page.emulate_media(media='screen')

        # 免登入：重新開頁仍直接可用（不需通行碼）
        page.reload()
        open_app(page)
        page.wait_for_timeout(250)
        ov2 = page.inner_text('#view-overview')
        check('開始稽核' in ov2, '重新開頁仍看得到「開始稽核」（免登入、全員可填寫）')
        page.evaluate("window.App.navigate('analysis')")
        page.wait_for_selector('#an-repeat table', timeout=5000)
        check(len(table_rows(page, '#an-repeat')) > 0, '重新開頁仍看得到異常分析')

        check(not console_errors and not page_errors,
              '全程 console 無 error（console=%d, page=%d）' % (len(console_errors), len(page_errors)))
        if console_errors or page_errors:
            print('  console:', console_errors[:3])
            print('  page:', page_errors[:3])

        page.screenshot(path=os.path.join(ROOT, 'test', 't7-analysis.png'), full_page=True)
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
