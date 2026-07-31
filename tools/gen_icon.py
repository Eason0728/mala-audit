#!/usr/bin/env python3
"""
產生稽核系統的主畫面圖示（apple-touch-icon 180 + favicon-32）。

    python3 tools/gen_icon.py

版型完全照「宿舍合約系統」那顆（~/mala-dorm-contract/assets/icon-180.png）：
上方墨竹亭竹葉 emblem、下方兩個字，只換底色與文字。
emblem 直接從宿舍那顆抽出來（同一組鼎兆元系統要長得像一家人），
所以幾何位置逐 px 相同，不是重畫一顆近似的。

favicon-32 = 180 的 LANCZOS 縮圖（宿舍那顆實測就是這樣做的，32px 保留文字）。

產完會把兩顆以 base64 data URI **內嵌**進 src/index.html 與 src/report.html 的 <head>
（有 `<!-- 稽核 icon -->` 標記防重複插入）。內嵌是因為單機版／審閱版／Artifact 都是
單一 HTML 檔在外面流通，外部 assets 路徑會失效；內嵌則所有產物自動跟著有圖示。
"""

import base64
import os

import numpy as np
from PIL import Image, ImageDraw, ImageFont

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DORM_ICON = os.path.expanduser('~/mala-dorm-contract/assets/icon-180.png')
OUT_DIR = os.path.join(ROOT, 'assets')

BG = (0x1F, 0x3A, 0x5F)          # 藏藍：宿舍薄荷綠 #86CBBF、調撥深墨綠 #2F6E63 之外的第三色，桌面上一眼分得出
FG = (0xFF, 0xFF, 0xFF)          # emblem 與文字都用白
TEXT = '稽核'

# 宿舍那顆量出來的幾何（180 畫布）
DORM_MINT = np.array([134, 203, 191])   # 底色
DORM_NAVY = np.array([19, 23, 91])      # emblem 線色
EMBLEM_SPLIT_Y = 105                    # 105 以上是 emblem，以下是文字
TEXT_TOP = 113                          # 文字 bbox 上緣
TEXT_HEIGHT = 53                        # 文字 bbox 高（≈ 畫布 29%）
FONT_PATH = '/System/Library/Fonts/Hiragino Sans GB.ttc'
FONT_INDEX = 2                          # W6，跟打卡／排班／宿舍同一支


def emblem_alpha():
    """從宿舍那顆抽出 emblem 的 alpha 遮罩（含反鋸齒）。"""
    src = np.array(Image.open(DORM_ICON).convert('RGB')).astype(float)
    # 線色與底色的曼哈頓距離當分母，中間的反鋸齒像素會線性落在 0–1
    den = np.abs(DORM_NAVY - DORM_MINT).sum()
    alpha = np.clip(np.abs(src - DORM_MINT).sum(axis=2) / den, 0, 1)
    alpha[EMBLEM_SPLIT_Y:, :] = 0        # 切掉「宿舍」兩個字，只留 emblem
    return Image.fromarray((alpha * 255).astype(np.uint8))


def fit_font():
    """找出讓 TEXT 的 bbox 高度＝TEXT_HEIGHT 的字級。"""
    for size in range(30, 90):
        font = ImageFont.truetype(FONT_PATH, size, index=FONT_INDEX)
        box = font.getbbox(TEXT, stroke_width=1)
        if box[3] - box[1] >= TEXT_HEIGHT:
            return font, box
    raise SystemExit('找不到合適字級')


def build_180():
    icon = Image.new('RGB', (180, 180), BG)
    icon.paste(Image.new('RGB', (180, 180), FG), (0, 0), emblem_alpha())

    font, box = fit_font()
    draw = ImageDraw.Draw(icon)
    # getbbox 是相對 (0,0) 的位移，扣掉才能讓實際墨跡對齊指定位置
    x = (180 - (box[2] - box[0])) / 2 - box[0]
    y = TEXT_TOP - box[1]
    draw.text((x, y), TEXT, font=font, fill=FG, stroke_width=1, stroke_fill=FG)
    return icon


MARK = '<!-- 稽核 icon -->'
ANCHOR = '<meta name="viewport"'


def data_uri(path):
    return 'data:image/png;base64,' + base64.b64encode(open(path, 'rb').read()).decode()


def inject(html_path, uri180, uri32):
    html = open(html_path, encoding='utf-8').read()
    if MARK in html:                     # 已經嵌過：換掉整段，不要疊第二份
        head, rest = html.split(MARK, 1)
        html = head + rest.split(MARK, 1)[1]
    block = (f'{MARK}\n'
             f'<link rel="icon" type="image/png" sizes="32x32" href="{uri32}">\n'
             f'<link rel="apple-touch-icon" href="{uri180}">\n'
             f'<meta name="apple-mobile-web-app-title" content="稽核">\n'
             f'{MARK}\n')
    line_end = html.index('\n', html.index(ANCHOR)) + 1
    html = html[:line_end] + block + html[line_end:]
    open(html_path, 'w', encoding='utf-8').write(html)
    print('  內嵌 → ' + os.path.relpath(html_path, ROOT))


def main():
    os.makedirs(OUT_DIR, exist_ok=True)
    icon = build_180()
    p180 = os.path.join(OUT_DIR, 'icon-180.png')
    p32 = os.path.join(OUT_DIR, 'favicon-32.png')
    icon.save(p180)
    icon.resize((32, 32), Image.LANCZOS).save(p32)

    for path in (p180, p32):
        print(f'{os.path.relpath(path, ROOT)}  {os.path.getsize(path)} bytes')

    uri180, uri32 = data_uri(p180), data_uri(p32)
    for name in ('index.html',):
        inject(os.path.join(ROOT, name), uri180, uri32)


if __name__ == '__main__':
    main()
