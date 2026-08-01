#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""T3 Playwright headless 驗收腳本（App 殼／登入／總覽）。

用法：python3 test/e2e_t3.py
會自己在專案根目錄起 `python3 -m http.server`，開 headless Chromium 跑完整流程，
驗收 index.html + js/app.js + js/views/login.js + js/views/overview.js。
"""
import os
import subprocess
import sys
import time
import urllib.request

from playwright.sync_api import sync_playwright

PORT = 8793
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))  # mala-audit/
BASE_URL = "http://localhost:%d/index.html?mode=local" % PORT  # 假資料模式：不碰真試算表

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
            page.on("console", lambda msg: console_errors.append(msg.text) if msg.type == "error" else None)
            page.on("pageerror", lambda exc: console_errors.append(str(exc)))

            # ---- (1) 已上鎖：先出現登入畫面；主管碼（mock 5678）只能看 ----
            #      正式密碼存在試算表「設定」分頁，不寫進測試也不進 repo；
            #      測試一律走 ?mode=local 用 mock 通行碼。
            page.goto(BASE_URL)
            page.wait_for_selector("#login-code", timeout=8000)
            check(page.is_visible("#login-code"), "(1) 開頁要求輸入通行碼（已上鎖）")
            check(not page.is_visible("#main-nav"), "(1) 登入前導覽列不露出")
            # 未登入時就算硬點分頁也不能跳過登入
            page.evaluate("window.App.navigate('overview')")
            page.wait_for_timeout(300)
            check(page.is_visible("#login-code"), "(1) 未登入時 navigate 無效，仍停在登入畫面")
            page.fill("#login-code", "5678")
            page.click("#login-submit")
            page.wait_for_selector("#main-nav:not([hidden])", timeout=8000)
            check(page.is_visible("#view-overview"), "(1) 主管碼登入後總覽渲染")
            check(page.query_selector("#btn-start-audit") is None, "(1) 主管碼看不到「開始稽核」")

            # ---- (2) 會計碼（mock 1234）可填寫 ----
            page.goto(BASE_URL)
            page.wait_for_selector("#login-code", timeout=8000)
            page.fill("#login-code", "1234")
            page.click("#login-submit")
            page.wait_for_selector("#main-nav:not([hidden])", timeout=8000)
            check(page.query_selector("#btn-start-audit") is not None, "(2)「開始稽核」按鈕存在")
            check(page.query_selector("#btn-mark-rest") is not None, "(2)「標記輪休」按鈕存在")
            check(page.evaluate("window.App.state.role") == "accountant",
                  "(2) 角色為 accountant（實際 %s）" % page.evaluate("window.App.state.role"))

            # ---- (3) 總覽格 ----
            cell_sxl_jan = page.query_selector('.grid-cell[data-store="sxl-gf"][data-month="2026-01"]')
            txt_sxl_jan = cell_sxl_jan.inner_text().strip() if cell_sxl_jan else None
            check(txt_sxl_jan == "80%", "(3) sxl-gf 一月 = 80%（實際 {!r}）".format(txt_sxl_jan))

            cell_ck_apr = page.query_selector('.grid-cell[data-store="ck"][data-month="2026-04"]')
            txt_ck_apr = cell_ck_apr.inner_text().strip() if cell_ck_apr else None
            check(txt_ck_apr == "輪休", "(3) ck 四月 = 輪休（實際 {!r}）".format(txt_ck_apr))

            cell_lzl_jul = page.query_selector('.grid-cell[data-store="mzt-lzl"][data-month="2026-07"]')
            txt_lzl_jul = cell_lzl_jul.inner_text().strip() if cell_lzl_jul else None
            check(txt_lzl_jul == "—", "(3) mzt-lzl 七月 = —（實際 {!r}）".format(txt_lzl_jul))

            # ---- 額外：點已稽核格 → navigate('report', {store, month}) ----
            cell_sxl_jan.click()
            page.wait_for_timeout(200)
            check(page.is_visible("#view-report"), "點已稽核格切到 report section")
            page.click('.nav-btn[data-view="overview"]')
            page.wait_for_timeout(200)

            # ---- 額外：標記輪休對話框開關 ----
            page.click("#btn-mark-rest")
            check(page.is_visible("#rest-dialog"), "標記輪休：點擊後對話框顯示")
            page.click("#rest-cancel")
            check(not page.is_visible("#rest-dialog"), "標記輪休：取消後對話框隱藏")

            # ---- (4) console 無 error ----
            check(len(console_errors) == 0,
                  "(4) console 無 error（實際 {} 筆：{}）".format(len(console_errors), console_errors[:5]))

            browser.close()
    finally:
        server.terminate()
        server.wait(timeout=5)

    print("")
    if failures:
        print("%d 項失敗" % len(failures))
        sys.exit(1)
    else:
        print("全部驗收項目通過")


if __name__ == "__main__":
    main()
