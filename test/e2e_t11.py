#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""T11 Playwright headless 驗收腳本（門市管理：新增／停用門市，2026-09-28）。

用法：python3 test/e2e_t11.py
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


def store_options(page, sel):
    return [o.inner_text().strip() for o in page.query_selector_all(sel + " option")]


def main():
    server = start_server()
    try:
        if not wait_for_server(BASE_URL):
            print("FAIL: http server 未在時限內啟動")
            sys.exit(1)

        with sync_playwright() as p:
            browser = p.chromium.launch()
            page = browser.new_page()
            page.on("dialog", lambda d: d.accept())
            console_errors = []
            page.on("console", lambda m: console_errors.append(m.text) if m.type == "error" else None)
            page.on("pageerror", lambda exc: console_errors.append(str(exc)))

            page.goto(BASE_URL)
            page.evaluate("localStorage.clear()")
            page.goto(BASE_URL)
            login(page)

            # ---- (1) 選單頁有門市管理入口，點進去列出五店 ----
            check(page.is_visible("#home-stores"), "(1) 會計在選單頁看得到「門市管理」")
            page.click("#home-stores")
            page.wait_for_selector("#view-stores:not([hidden])", timeout=8000)
            check(not page.is_visible("#main-nav"), "(1) 門市管理頁不顯示導覽列")
            rows = page.query_selector_all(".store-row")
            check(len(rows) == 5, "(1) 列出五家門市（實際 %d）" % len(rows))

            # ---- (2) 空名稱擋 ----
            page.click("#store-add-btn")
            check("請填門市名稱" in page.inner_text("#store-msg"), "(2) 空名稱擋下")

            # ---- (3) 新增門市 ----
            page.fill("#store-new-name", "測試新店")
            page.click("#store-add-btn")
            page.wait_for_selector('.store-row[data-store="st-01"]', timeout=8000)
            check("已新增" in page.inner_text("#store-msg"), "(3) 新增成功訊息")
            check(len(page.query_selector_all(".store-row")) == 6, "(3) 清單變六家")

            # ---- (4) 同名擋 ----
            page.fill("#store-new-name", "測試新店")
            page.click("#store-add-btn")
            page.wait_for_timeout(300)
            check("已經有" in page.inner_text("#store-msg"), "(4) 同名門市擋下")

            # ---- (5) 新店出現在兩張表的店別選單、選單頁分母變 6 ----
            page.click("#store-back")
            page.wait_for_selector("#view-home:not([hidden])", timeout=8000)
            metas = [m.inner_text() for m in page.query_selector_all(".module-card-meta")]
            check(all("/ 6 家" in m for m in metas), "(5) 選單頁分母變 6（實際 %r）" % metas)
            page.evaluate("window.App.navigate('ops')")
            page.wait_for_selector("#ops-store", timeout=8000)
            check("測試新店" in store_options(page, "#ops-store"), "(5) 營運稽核店別選單有新店")
            page.evaluate("window.App.navigate('audit')")
            page.wait_for_selector("#audit-store", timeout=8000)
            check("測試新店" in store_options(page, "#audit-store"), "(5) 盤點店別選單有新店")

            # ---- (6) 停用央廚 → 選單消失、清單標停用中；重新啟用回來 ----
            page.evaluate("window.App.navigate('stores')")
            page.wait_for_selector("#view-stores:not([hidden])", timeout=8000)
            page.click('.store-row[data-store="ck"] .store-toggle')
            page.wait_for_selector('.store-row-inactive[data-store="ck"]', timeout=8000)
            check("停用中" in page.inner_text('.store-row[data-store="ck"]'), "(6) 央廚標示停用中")
            page.evaluate("window.App.navigate('audit')")
            page.wait_for_selector("#audit-store", timeout=8000)
            check("央廚" not in store_options(page, "#audit-store"), "(6) 停用後盤點選單沒有央廚")
            page.evaluate("window.App.navigate('stores')")
            page.wait_for_selector("#view-stores:not([hidden])", timeout=8000)
            page.click('.store-row[data-store="ck"] .store-toggle')
            page.wait_for_selector('.store-row[data-store="ck"]:not(.store-row-inactive)', timeout=8000)
            page.evaluate("window.App.navigate('overview')")
            page.wait_for_timeout(300)
            check("央廚" in page.inner_text("#view-overview"), "(6) 重新啟用後總覽回來")

            # ---- (7) 主管碼看不到入口、硬進也不能操作 ----
            page.goto(BASE_URL)
            page.wait_for_selector("#login-code", timeout=10000)
            page.fill("#login-code", "5678")
            page.click("#login-submit")
            page.wait_for_selector("#view-home:not([hidden])", timeout=10000)
            check(page.query_selector("#home-stores") is None, "(7) 主管碼看不到門市管理入口")
            page.evaluate("window.App.navigate('stores')")
            page.wait_for_timeout(300)
            check(page.query_selector("#store-add-btn") is None and page.query_selector(".store-toggle") is None,
                  "(7) 主管碼硬進門市管理沒有操作按鈕")

            # ---- (8) console 無 error ----
            check(len(console_errors) == 0,
                  "(8) console 無 error（實際 {} 筆：{}）".format(len(console_errors), console_errors[:5]))

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
