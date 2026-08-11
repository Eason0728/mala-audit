#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""T10 Playwright headless 驗收腳本（營運稽核表＋登入後兩區塊選單）。

用法：python3 test/e2e_t10.py
會自己在專案根目錄起 `python3 -m http.server`，開 headless Chromium 跑完整流程。
一律走 ?mode=local 假資料模式，不碰真試算表、不需要正式通行碼。

⚠ 與其他 e2e 一次跑一支、間隔 20 秒以上（port TIME_WAIT 會衝突，
  噴 Errno 48 是 port 沒釋放不是測試失敗）。
"""
import os
import subprocess
import sys
import time
import urllib.request

from playwright.sync_api import sync_playwright

PORT = 8800
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BASE_URL = "http://localhost:%d/index.html?mode=local" % PORT

failures = []


def check(cond, label):
    if cond:
        print("PASS: " + label)
    else:
        failures.append(label)
        print("FAIL: " + label)


def start_server():
    return subprocess.Popen(
        [sys.executable, "-m", "http.server", str(PORT)],
        cwd=ROOT,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )


def wait_for_server(url, timeout=10):
    start = time.time()
    while time.time() - start < timeout:
        try:
            urllib.request.urlopen(url, timeout=1)
            return True
        except Exception:
            time.sleep(0.3)
    return False


def login(page):
    page.wait_for_selector("#login-code", timeout=10000)
    page.fill("#login-code", "1234")
    page.click("#login-submit")
    page.wait_for_selector("#view-home:not([hidden])", timeout=10000)


def open_ops_fill(page):
    """從選單進到營運稽核填寫頁。"""
    page.click('.module-card[data-module="ops"]')
    page.wait_for_selector("#view-opsoverview:not([hidden])", timeout=8000)
    page.click("#btn-start-ops")
    page.wait_for_selector("#ops-submit", timeout=8000)


def main():
    server = start_server()
    try:
        if not wait_for_server(BASE_URL):
            print("FAIL: http server 未在時限內啟動")
            sys.exit(1)

        with sync_playwright() as p:
            browser = p.chromium.launch()
            page = browser.new_page()
            console_errors = []
            page.on("console", lambda m: console_errors.append(m.text) if m.type == "error" else None)
            page.on("pageerror", lambda exc: console_errors.append(str(exc)))

            # ---- (1) 登入後是選單，兩個區塊都在，導覽列收起 ----
            page.goto(BASE_URL)
            login(page)
            cards = page.query_selector_all(".module-card")
            check(len(cards) == 2, "(1) 選單有兩個區塊（實際 %d）" % len(cards))
            titles = [c.query_selector(".module-card-title").inner_text().strip() for c in cards]
            check(titles == ["營運稽核表", "月初盤點抽查"],
                  "(1) 兩個區塊名稱正確（實際 %r）" % titles)
            check(not page.is_visible("#main-nav"), "(1) 選單頁不顯示導覽列")

            # ---- (2) 進營運稽核表：導覽列換成該區塊的分頁 ----
            page.click('.module-card[data-module="ops"]')
            page.wait_for_selector("#view-opsoverview:not([hidden])", timeout=8000)
            navs = [b.inner_text().strip() for b in page.query_selector_all("#main-nav .nav-btn")]
            check(navs == ["⌂", "總覽", "稽核填寫", "報告"],
                  "(2) 營運稽核的導覽列（實際 %r）" % navs)
            check(page.query_selector("#main-nav .nav-btn[data-view=\"analysis\"]") is None,
                  "(2) 營運稽核區塊看不到盤點專屬的「異常分析」")
            subtitle = page.inner_text("#app-subtitle").strip()
            check(subtitle == "營運稽核表", "(2) 標題列顯示目前區塊（實際 %r）" % subtitle)

            # ---- (3) 填寫頁：19 項、四個分類標題、統計列 ----
            page.click("#btn-start-ops")
            page.wait_for_selector("#ops-submit", timeout=8000)
            items = page.query_selector_all(".ops-item")
            check(len(items) == 19, "(3) 列出 19 項細項（實際 %d）" % len(items))
            groups = [g.inner_text().strip() for g in page.query_selector_all(".ops-group")]
            check(groups == ["營運管理｜消防安全", "營運管理｜營運",
                             "品牌形象｜環境清潔", "品牌形象｜食安"],
                  "(3) 四個分類標題（實際 %r）" % groups)
            check(page.inner_text("#ops-s-pending").strip() == "19", "(3) 一開始未檢查 19 項")

            # ---- (4) 未填稽核人員 → 擋下 ----
            page.click("#ops-submit")
            page.wait_for_timeout(300)
            msg = page.inner_text("#ops-message") if page.query_selector("#ops-message") else ""
            check("稽核人員" in msg, "(4) 沒填稽核人員被擋（訊息：%r）" % msg)

            page.fill("#ops-auditor", "王會計")

            # ---- (5) 判未完成但沒填說明 → 擋下 ----
            first_id = page.get_attribute(".ops-item", "data-item")
            page.click('.ops-vbtn[data-verdict="未完成"][data-item="%s"]' % first_id)
            page.wait_for_timeout(200)
            check(page.inner_text("#ops-s-fail").strip() == "1", "(5) 未完成數變 1")
            page.click("#ops-submit")
            page.wait_for_timeout(300)
            msg = page.inner_text("#ops-message") if page.query_selector("#ops-message") else ""
            check("沒填說明" in msg, "(5) 未完成沒填說明被擋（訊息：%r）" % msg)

            # 擋下時自動切到「未完成」篩選，會計不必自己找是哪一項
            shown = page.query_selector_all(".ops-item")
            check(len(shown) == 1, "(5) 自動篩出那 1 項未完成（實際 %d）" % len(shown))

            # ---- (6) 補說明後其餘全點合格 → 送出成功 ----
            page.fill('.ops-note[data-item="%s"]' % first_id, "後門那桶沒鏈條")
            page.click('.ops-filter[data-filter="all"]')
            page.wait_for_timeout(200)
            page.evaluate("""() => {
              document.querySelectorAll('.ops-item').forEach(it => {
                const id = it.getAttribute('data-item');
                const btn = it.querySelector('.ops-vbtn[data-verdict="合格"]');
                if (btn && !btn.classList.contains('sel-pass') &&
                    !it.querySelector('.ops-vbtn.sel-fail')) btn.click();
              });
            }""")
            page.wait_for_timeout(400)
            check(page.inner_text("#ops-s-pass").strip() == "18", "(6) 合格 18 項")
            check(page.inner_text("#ops-s-pending").strip() == "0", "(6) 未檢查 0 項")

            page.click("#ops-submit")
            page.wait_for_selector("#view-opsreport:not([hidden])", timeout=8000)

            # ---- (7) 報告頁 ----
            report = page.inner_text("#view-opsreport")
            check("合格率 95%" in report, "(7) 報告顯示合格率 95%（18/19）")
            check("王會計" in report, "(7) 報告顯示稽核人員")
            check("後門那桶沒鏈條" in report, "(7) 報告列出未完成項目的說明")
            check("未完成項目（1）" in report, "(7) 未完成項目計數正確")

            # ---- (8) 送出後：總覽格出現合格率、草稿已清 ----
            page.click('#main-nav .nav-btn[data-view="opsoverview"]')
            page.wait_for_selector("#view-opsoverview:not([hidden])", timeout=8000)
            cell = page.query_selector('#view-opsoverview .grid-cell[data-clickable="1"]')
            check(cell is not None and cell.inner_text().strip() == "95%",
                  "(8) 營運稽核總覽出現 95% 格")
            leftover = page.evaluate(
                "() => Object.keys(localStorage).filter(k => k.indexOf('ops_draft_') === 0).length")
            check(leftover == 0, "(8) 送出成功後草稿已清（殘留 %d 筆）" % leftover)

            # ---- (9) 兩個區塊互不干擾：盤點那邊照舊 ----
            page.click('#main-nav .nav-btn[data-view="home"]')
            page.wait_for_selector("#view-home:not([hidden])", timeout=8000)
            page.click('.module-card[data-module="stock"]')
            page.wait_for_selector("#view-overview:not([hidden])", timeout=8000)
            navs = [b.inner_text().strip() for b in page.query_selector_all("#main-nav .nav-btn")]
            check(navs == ["⌂", "總覽", "稽核填寫", "報告", "異常分析"],
                  "(9) 切回盤點區塊導覽列變回四分頁（實際 %r）" % navs)
            jan = page.query_selector('#view-overview .grid-cell[data-store="sxl-gf"][data-month="2026-01"]')
            check(jan is not None and jan.inner_text().strip() == "80%",
                  "(9) 盤點總覽的既有資料沒被影響（sxl-gf 一月 80%）")

            # ---- (10) 草稿：填一半重整，回到同一店且內容還在 ----
            page.click('#main-nav .nav-btn[data-view="home"]')
            page.wait_for_selector("#view-home:not([hidden])", timeout=8000)
            open_ops_fill(page)
            page.select_option("#ops-store", "mzt-js")
            page.wait_for_timeout(300)
            page.fill("#ops-auditor", "李會計")
            draft_id = page.get_attribute(".ops-item", "data-item")
            page.fill('.ops-note[data-item="%s"]' % draft_id, "草稿測試內容")
            page.wait_for_timeout(300)

            page.goto(BASE_URL)
            login(page)
            open_ops_fill(page)
            check(page.input_value("#ops-store") == "mzt-js",
                  "(10) 重開回到上次那家店（實際 %r）" % page.input_value("#ops-store"))
            check(page.input_value("#ops-auditor") == "李會計", "(10) 稽核人員草稿還在")
            check(page.input_value('.ops-note[data-item="%s"]' % draft_id) == "草稿測試內容",
                  "(10) 說明草稿還在")

            # 換到別家店，上方要列得出這筆未送出草稿
            page.select_option("#ops-store", "ck")
            page.wait_for_timeout(300)
            drafts = [d.inner_text().strip() for d in page.query_selector_all(".ops-draft-link")]
            check(any("墨竹亭金山" in d for d in drafts),
                  "(10) 換店後上方列出金山那筆未送出草稿（實際 %r）" % drafts)

            # ---- (11) 主管碼看不到填寫頁 ----
            page.goto(BASE_URL)
            page.wait_for_selector("#login-code", timeout=10000)
            page.fill("#login-code", "5678")
            page.click("#login-submit")
            page.wait_for_selector("#view-home:not([hidden])", timeout=10000)
            page.click('.module-card[data-module="ops"]')
            page.wait_for_selector("#view-opsoverview:not([hidden])", timeout=8000)
            check(page.query_selector("#btn-start-ops") is None, "(11) 主管碼看不到「開始稽核」")
            page.evaluate("window.App.navigate('ops')")
            page.wait_for_timeout(300)
            check("僅會計可使用" in page.inner_text("#view-ops"),
                  "(11) 主管碼硬進填寫頁會被擋")

            # ---- (12) console 無 error ----
            check(len(console_errors) == 0,
                  "(12) console 無 error（實際 {} 筆：{}）".format(len(console_errors), console_errors[:5]))

            browser.close()
    finally:
        server.terminate()
        server.wait(timeout=5)

    print("")
    if failures:
        print("%d 項失敗：" % len(failures))
        for f in failures:
            print("  - " + f)
        sys.exit(1)
    print("全部測試通過")


if __name__ == "__main__":
    main()
