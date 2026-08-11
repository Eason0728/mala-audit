#!/usr/bin/env python3
"""拍操作說明書要用的截圖 → docs/guide-shots/

    python3 tools/shots-guide.py

一律用 `?mode=local` 假資料模式拍：不會碰到真試算表，也**不需要正式密碼**。
登入畫面的密碼欄一律留空拍（手冊不寫密碼，文案寫「請洽 Eason」）。
"""
import http.server
import socketserver
import threading
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SHOTS = os.path.join(ROOT, 'docs', 'guide-shots')
PORT = 8811
URL = 'http://127.0.0.1:%d/index.html?mode=local' % PORT
MOCK_CODE = '1234'   # 假資料模式專用，不是正式密碼

os.makedirs(SHOTS, exist_ok=True)
os.chdir(ROOT)
httpd = socketserver.TCPServer(('127.0.0.1', PORT), http.server.SimpleHTTPRequestHandler)
threading.Thread(target=httpd.serve_forever, daemon=True).start()

from playwright.sync_api import sync_playwright

saved = []


CONTENT_H = """() => {
  let max = 0;
  document.querySelectorAll('body *').forEach(e => {
    const r = e.getBoundingClientRect();
    if (r.width > 0 && r.height > 0) max = Math.max(max, r.bottom + window.scrollY);
  });
  return Math.ceil(max);
}"""


def shot(page, name, selector=None, full=False):
    """頁面級截圖依實際內容高度裁切——登入頁這種內容少的，整頁截會拖一大片空白，
    貼進手冊很難看。內容填滿時裁切等於沒作用。"""
    path = os.path.join(SHOTS, name + '.png')
    if selector:
        page.locator(selector).screenshot(path=path)
    else:
        # 先捲回最上面：頁面若停在捲動位置，sticky 的導覽列會壓在裁切區中間
        # （2026-08-11 拍營運稽核報告時實際踩到，圖從表格中段開始）
        page.evaluate('window.scrollTo(0, 0)')
        page.wait_for_timeout(150)
        h = page.evaluate(CONTENT_H) + 16
        vw = page.viewport_size['width']
        page.screenshot(path=path, clip={'x': 0, 'y': 0, 'width': vw, 'height': h})
    saved.append(name)
    print('  ✓', name)


def login(page, module='stock'):
    """登入到選單頁，再進指定區塊。

    2026-08-11 起登入後停在「選單」（營運稽核表／月初盤點抽查兩張卡片），
    導覽列要進了區塊才出現——所以不能再直接等 #main-nav。
    """
    page.goto(URL)
    page.wait_for_selector('#login-code', timeout=15000)
    page.fill('#login-code', MOCK_CODE)
    page.click('#login-submit')
    page.wait_for_selector('#view-home:not([hidden])', timeout=15000)
    if module:
        page.click('.module-card[data-module="%s"]' % module)
        page.wait_for_selector('#main-nav:not([hidden])', timeout=15000)


def fill_rows(page, count, anomaly_idx=(0,)):
    total = len(page.query_selector_all('#audit-items li.audit-item-row'))
    for idx in range(min(count, total)):
        sel = '#audit-items li.audit-item-row:nth-of-type(%d) ' % (idx + 1)
        # 抽到品項庫沒填單位的項目時，該列會多一個單位欄，不補就送不出去
        unit_box = page.query_selector(sel + '.audit-item-unit-input')
        if unit_box:
            unit_box.fill('包')
        page.fill(sel + '.audit-book-qty', '12')
        if idx in anomaly_idx:
            page.fill(sel + '.audit-recount-qty', '10')
            page.click(sel + '.audit-verdict-btn[data-verdict="異常"]')
            page.wait_for_timeout(120)
            page.select_option(sel + '.audit-reason', '損耗未記')
        else:
            page.fill(sel + '.audit-recount-qty', '12')
            page.click(sel + '.audit-verdict-btn[data-verdict="正確"]')
        page.wait_for_timeout(40)
    return total


with sync_playwright() as p:
    b = p.chromium.launch()
    page = b.new_page(viewport={'width': 390, 'height': 780}, device_scale_factor=2)

    # ── 01 登入（密碼欄留空）──
    page.goto(URL)
    page.wait_for_selector('#login-code', timeout=15000)
    page.wait_for_timeout(400)
    shot(page, '01-login')

    # ── 01b 選單：登入後的兩個區塊 ──
    page.fill('#login-code', MOCK_CODE)
    page.click('#login-submit')
    page.wait_for_selector('#view-home:not([hidden])', timeout=15000)
    page.wait_for_timeout(400)
    shot(page, '01b-home')

    # ── 02 總覽（月初盤點抽查）──
    login(page)
    page.wait_for_timeout(500)
    shot(page, '02-overview', full=True)

    # ── 03 稽核：選店選月 ──
    page.evaluate("window.App.navigate('audit')")
    page.wait_for_selector('#audit-draw', timeout=15000)
    page.select_option('#audit-store', 'sxl-gf')
    page.select_option('#audit-month', '2026-08')
    page.wait_for_timeout(300)
    shot(page, '03-pick-store')

    # ── 03b 只填異常項模式（切過去填一項，拍完切回完整模式；兩模式草稿分開存，不互相汙染）──
    page.click('.audit-mode-btn[data-mode="anomaly"]')
    page.wait_for_timeout(200)
    page.fill('#audit-add-input', '牛肉片')
    page.click('#audit-add-btn')
    page.wait_for_timeout(200)
    row1 = '#audit-items li.audit-item-row:nth-of-type(1) '
    page.fill(row1 + '.audit-book-qty', '26.5')
    page.fill(row1 + '.audit-recount-qty', '29.4')
    page.select_option(row1 + '.audit-reason', '損耗未記')
    page.wait_for_timeout(300)
    shot(page, '03b-anomaly-mode', full=True)
    page.click('.audit-mode-btn[data-mode="full"]')
    page.wait_for_timeout(250)

    # ── 04 抽出 20 項 ──
    page.click('#audit-draw')
    page.wait_for_selector('#audit-items li.audit-item-row', timeout=15000)
    page.wait_for_timeout(400)
    shot(page, '04-drawn')

    # ── 05 單項：填數字＋核定（拍前兩列）──
    fill_rows(page, 2, anomaly_idx=(1,))
    page.wait_for_timeout(300)
    first_two = '#audit-items'
    page.locator('#audit-items li.audit-item-row').first.screenshot(
        path=os.path.join(SHOTS, '05-row-correct.png'))
    saved.append('05-row-correct')
    print('  ✓ 05-row-correct')
    page.locator('#audit-items li.audit-item-row').nth(1).screenshot(
        path=os.path.join(SHOTS, '06-row-anomaly.png'))
    saved.append('06-row-anomaly')
    print('  ✓ 06-row-anomaly')

    # ── 07 金庫區 ──
    page.click('.audit-vault-btn[data-group="change_fund"][data-value="正確"]')
    page.click('.audit-vault-btn[data-group="petty_cash"][data-value="正確"]')
    page.fill('#audit-tip-amount', '850')
    page.click('.audit-vault-btn[data-group="tip_match"][data-value="相符"]')
    page.wait_for_timeout(300)
    shot(page, '07-vault', selector='#audit-vault-card')

    # ── 08 驗證擋下（沒填完就送出）──
    page.click('#audit-submit-btn')
    page.wait_for_timeout(500)
    shot(page, '08-validation', selector='#audit-submit-error')

    # ── 09 全部填完 → 送出 → 報告 ──
    fill_rows(page, 20, anomaly_idx=(1,))
    page.wait_for_timeout(400)
    page.click('#audit-submit-btn')
    page.wait_for_selector('#view-report:not([hidden])', timeout=20000)
    page.wait_for_timeout(600)
    shot(page, '09-report-month', full=True)

    # ── 10 覆蓋確認（對已有紀錄的月份再送一次）──
    page.evaluate("window.App.navigate('audit')")
    page.wait_for_selector('#audit-draw', timeout=15000)
    page.select_option('#audit-store', 'sxl-gf')
    page.select_option('#audit-month', '2026-01')
    page.wait_for_timeout(300)
    page.click('#audit-draw')
    page.wait_for_selector('#audit-items li.audit-item-row', timeout=15000)
    fill_rows(page, 20, anomaly_idx=())
    page.click('.audit-vault-btn[data-group="change_fund"][data-value="正確"]')
    page.click('.audit-vault-btn[data-group="petty_cash"][data-value="正確"]')
    page.fill('#audit-tip-amount', '457')
    page.click('.audit-vault-btn[data-group="tip_match"][data-value="相符"]')
    page.wait_for_timeout(300)
    page.click('#audit-submit-btn')
    page.wait_for_timeout(700)
    shot(page, '10-overwrite', selector='#audit-overwrite-dialog')
    page.click('#audit-overwrite-cancel')

    # ── 11 送出失敗＋重試（模擬斷網）──
    page.evaluate("""() => {
        window.__real = window.Api.submitAudit;
        window.Api.submitAudit = function () { return Promise.reject(new Error('模擬斷網')); };
    }""")
    page.click('#audit-submit-btn')
    page.wait_for_timeout(400)
    page.click('#audit-overwrite-confirm')
    page.wait_for_timeout(900)
    shot(page, '11-retry', selector='#audit-submit-error')
    page.evaluate("() => { window.Api.submitAudit = window.__real; }")

    # ── 12 標記輪休 ──
    login(page)
    page.click('#btn-mark-rest')
    page.wait_for_timeout(400)
    shot(page, '12-mark-rest', selector='#rest-dialog')
    page.click('#rest-cancel')

    # ── 13 年度總表（桌面寬度比較好讀）──
    wide = b.new_page(viewport={'width': 1100, 'height': 900}, device_scale_factor=2)
    login(wide)
    wide.evaluate("window.App.navigate('report', {store:'sxl-gf', month:'2026-01'})")
    wide.wait_for_timeout(800)
    shot(wide, '13-report-wide', full=True)
    # 切到年度總表
    btns = wide.query_selector_all('#view-report button')
    for bt in btns:
        if bt.inner_text().strip() == '年度總表':
            bt.click()
            break
    wide.wait_for_timeout(700)
    shot(wide, '14-annual', full=True)

    # ── 15 異常分析 ──
    page.evaluate("window.App.navigate('analysis')")
    page.wait_for_selector('#an-repeat table', timeout=15000)
    page.wait_for_timeout(500)
    shot(page, '15-analysis', full=True)
    shot(page, '16-analysis-repeat', selector='#an-repeat')

    # ── 17–20 營運稽核表（2026-08-11）──
    # 換一頁乾淨的 context 拍：上面那頁的 localStorage 已經被盤點的草稿塞滿，
    # 直接沿用會讓營運稽核填寫頁一開就跳出一堆不相干的東西。
    ops = b.new_page(viewport={'width': 390, 'height': 780}, device_scale_factor=2)
    login(ops, module='ops')
    ops.wait_for_timeout(500)
    shot(ops, '17-ops-overview', full=True)

    ops.click('#btn-start-ops')
    ops.wait_for_selector('#ops-submit', timeout=15000)
    ops.select_option('#ops-store', 'mzt-gf')
    ops.wait_for_timeout(300)
    ops.fill('#ops-auditor', '王會計')
    # 前兩項示範：一項合格、一項未完成＋說明＋追蹤
    rows = ops.query_selector_all('.ops-item')
    id0 = rows[0].get_attribute('data-item')
    id4 = rows[4].get_attribute('data-item')
    ops.click('.ops-vbtn[data-verdict="合格"][data-item="%s"]' % id0)
    ops.wait_for_timeout(150)
    ops.click('.ops-vbtn[data-verdict="未完成"][data-item="%s"]' % id4)
    ops.wait_for_timeout(150)
    ops.click('.ops-tbtn[data-item="%s"]' % id4)
    ops.wait_for_timeout(150)
    ops.fill('.ops-note[data-item="%s"]' % id4, '後門那桶沒鏈條固定')
    ops.wait_for_timeout(400)
    shot(ops, '18-ops-fill', full=True)
    ops.locator('.ops-item[data-item="%s"]' % id4).screenshot(
        path=os.path.join(SHOTS, '19-ops-item.png'))
    saved.append('19-ops-item')
    print('  ✓', '19-ops-item')

    # 其餘全部點合格後送出，拍報告
    ops.evaluate("""() => {
      document.querySelectorAll('.ops-item').forEach(it => {
        if (it.querySelector('.ops-vbtn.sel-fail') || it.querySelector('.ops-vbtn.sel-pass')) return;
        const b = it.querySelector('.ops-vbtn[data-verdict="合格"]');
        if (b) b.click();
      });
    }""")
    ops.wait_for_timeout(500)
    ops.click('#ops-submit')
    ops.wait_for_selector('#view-opsreport:not([hidden])', timeout=15000)
    ops.wait_for_timeout(600)
    shot(ops, '20-ops-report', full=True)

    b.close()

httpd.shutdown()
print('\n共 %d 張 → %s' % (len(saved), os.path.relpath(SHOTS, ROOT)))
