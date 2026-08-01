#!/usr/bin/env python3
"""
T6 報告畫面驗收腳本（Playwright, python sync）。
起 python3 -m http.server 在 repo 根目錄，餵 test/t6-harness.html 假 app 物件（app.js 尚未完成）。

驗收：
 (1) 單月報告 sxl-gf 2026-01 → 頁面含「80%」「小費」「457」與明細 4 列異常
     （牛肉片/鴨血/煙燻豬頭皮/感熱貼紙）
 (2) ck 2026-04 → 含「本月輪休」
 (3) 年度總表 sxl-gf → 表格 12 列、一月列含 457
 (4) emulate_media(media='print') 後 DOM 驗證 nav 隱藏；全程 console 無 error
"""
import http.server
import socketserver
import subprocess
import sys
import threading
import time

from playwright.sync_api import sync_playwright

PORT = 8934
BASE = f"http://127.0.0.1:{PORT}"

failures = []
console_errors = []


def check(cond, label):
    status = "PASS" if cond else "FAIL"
    print(f"{status}: {label}")
    if not cond:
        failures.append(label)


def start_server(repo_root):
    handler = lambda *a, **kw: http.server.SimpleHTTPRequestHandler(*a, directory=repo_root, **kw)
    httpd = socketserver.TCPServer(("127.0.0.1", PORT), handler)
    t = threading.Thread(target=httpd.serve_forever, daemon=True)
    t.start()
    return httpd


def main():
    import os
    repo_root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    httpd = start_server(repo_root)
    time.sleep(0.3)

    with sync_playwright() as p:
        browser = p.chromium.launch()

        # ---- scenario (1): 單月報告 sxl-gf 2026-01 ----
        page = browser.new_page()
        page.on("console", lambda msg: console_errors.append(msg.text) if msg.type == "error" else None)
        page.goto(f"{BASE}/test/t6-harness.html?mode=local&store=sxl-gf&month=2026-01")
        page.wait_for_function("window.__t6Ready === true")
        page.wait_for_selector(".report-print-area")

        body_text = page.inner_text("body")
        check("80%" in body_text, "單月報告 sxl-gf 2026-01 含「80%」")
        check("小費" in body_text, "單月報告 sxl-gf 2026-01 含「小費」")
        check("457" in body_text, "單月報告 sxl-gf 2026-01 含「457」")

        detail_rows = page.locator(".report-detail-table tbody tr")
        check(detail_rows.count() == 4, f"抽查明細表 4 列異常（實際 {detail_rows.count()} 列）")
        detail_text = page.inner_text(".report-detail-table")
        for item in ["牛肉片", "鴨血", "煙燻豬頭皮", "感熱貼紙"]:
            check(item in detail_text, f"明細表含品項「{item}」")

        # ---- scenario (2): ck 2026-04 輪休 ----
        page2 = browser.new_page()
        page2.on("console", lambda msg: console_errors.append(msg.text) if msg.type == "error" else None)
        page2.goto(f"{BASE}/test/t6-harness.html?mode=local&store=ck&month=2026-04")
        page2.wait_for_function("window.__t6Ready === true")
        page2.wait_for_selector(".report-print-area")
        body2 = page2.inner_text("body")
        check("本月輪休" in body2, "ck 2026-04 含「本月輪休」")

        # ---- scenario (3): 年度總表 sxl-gf ----
        page3 = browser.new_page()
        page3.on("console", lambda msg: console_errors.append(msg.text) if msg.type == "error" else None)
        page3.goto(f"{BASE}/test/t6-harness.html?mode=local")
        page3.wait_for_function("window.__t6Ready === true")
        # 切到年度總表、選 sxl-gf
        page3.click(".mode-btn[data-mode='annual']")
        page3.wait_for_selector(".report-annual-table")
        page3.select_option("#report-annual-store-select", "sxl-gf")
        page3.wait_for_timeout(100)

        annual_rows = page3.locator(".report-annual-table tbody tr")
        check(annual_rows.count() == 12, f"年度總表 12 列（實際 {annual_rows.count()} 列）")
        jan_row_text = page3.locator(".report-annual-table tbody tr").nth(0).inner_text()
        check("一月" in jan_row_text, "年度總表第 1 列為一月")
        check("457" in jan_row_text, "年度總表一月列含 457")

        # ---- scenario (4): emulate_media print → nav 隱藏；console 無 error ----
        page4 = browser.new_page()
        page4.on("console", lambda msg: console_errors.append(msg.text) if msg.type == "error" else None)
        page4.goto(f"{BASE}/test/t6-harness.html?mode=local&store=sxl-gf&month=2026-01")
        page4.wait_for_function("window.__t6Ready === true")
        page4.wait_for_selector(".report-print-area")
        page4.emulate_media(media="print")
        nav_display = page4.eval_on_selector("#main-nav", "el => getComputedStyle(el).display")
        header_display = page4.eval_on_selector("#app-header", "el => getComputedStyle(el).display")
        check(nav_display == "none", f"print 媒體下 #main-nav display=none（實際 {nav_display}）")
        check(header_display == "none", f"print 媒體下 #app-header display=none（實際 {header_display}）")
        no_print_btn_display = page4.eval_on_selector(
            "#report-print-btn", "el => getComputedStyle(el).display"
        )
        check(no_print_btn_display == "none", f"print 媒體下列印按鈕 display=none（實際 {no_print_btn_display}）")
        page4.screenshot(path=f"{repo_root}/test/t6-print-preview.png")

        browser.close()

    httpd.shutdown()

    check(len(console_errors) == 0, f"全程 console 無 error（實際 {len(console_errors)} 筆：{console_errors[:5]}）")

    print()
    if failures:
        print(f"{len(failures)} 項測試失敗：")
        for f in failures:
            print(f"  - {f}")
        sys.exit(1)
    else:
        print("全部測試通過")


if __name__ == "__main__":
    main()
