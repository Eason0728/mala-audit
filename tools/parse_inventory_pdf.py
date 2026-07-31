#!/usr/bin/env python3
"""從門市「庫存管理」PDF 抽出品項清單，供稽核系統品項庫使用。

    python3 tools/parse_inventory_pdf.py <某店的庫存管理.pdf>

產出 items.json（[{name, unit, category}]）。要寫進試算表時，把 [[品項,單位]] 貼進
「品項庫」分頁，欄位＝店代碼／品項／單位／狀態（啟用）。
規則（Eason 2026-08-01）：抓 PDF 上所有品項名稱，**未盤點的不列入**。

單位在 PDF 有兩種寫法，都要吃：
  1. 名稱後接全形括號：高麗菜（箱）、豆芽菜（斤）
  2. 名稱後接斜線段：  鴨血／盒（大大行）、麻辣炒醬／包／1kg（央廚）、Poki（芒果）／桶
品項名保留廠牌與規格（米血（洪牌）要跟其他米血區分），只把「單位」那一段拿掉。
抓不到單位的就留空——不臆造，交由會計在試算表補。
"""
import re, json, sys
import pypdf

PDF = '/Users/guoeason/Desktop/新竹光復_庫存管理20260801.pdf'
UNITS = ['箱', '斤', '袋', '包', '條', '盒', '罐', '捲', '瓶', '桶', '組', '支', '片',
         '份', '公斤', '台斤', '打', '串', '個', '本', '碗', '杯', '克', '桿', '把', '顆']


def squash(s):
    """PDF 在 CJK 之間插了空白，先還原（ASCII 詞內的空白保留）"""
    s = s.replace('　', ' ')
    s = re.sub(r'\s+', ' ', s).strip()
    out = []
    for i, ch in enumerate(s):
        if ch == ' ':
            prev = out[-1] if out else ''
            nxt = s[i + 1] if i + 1 < len(s) else ''
            wide = lambda c: bool(c) and (ord(c) > 0x2E80 or c in '（）／')
            if wide(prev) or wide(nxt):
                continue
        out.append(ch)
    return ''.join(out).strip()


def split_unit(label):
    """回傳 (品項名, 單位)。單位取自 ／單位 段或結尾的（單位）。"""
    # 1) ／單位 段（可能有多段，如 ／包／1kg）
    parts = label.split('／')
    if len(parts) > 1:
        for idx in range(1, len(parts)):
            seg = parts[idx]
            # 該段可能後面還黏著（廠牌），例：'盒（大大行）'
            m = re.match(r'^([^（）]+)(（.*）)?$', seg)
            if not m:
                continue
            head = m.group(1).strip()
            if head in UNITS:
                rest = m.group(2) or ''
                new_parts = parts[:idx] + ([rest] if rest else []) + parts[idx + 1:]
                # 把括號段直接接回前一段，不要留成獨立的 ／（廠牌）
                if rest:
                    new_parts = parts[:idx]
                    new_parts[-1] = new_parts[-1] + rest
                    new_parts += parts[idx + 1:]
                name = '／'.join([p for p in new_parts if p]).strip('／')
                return name, head
    # 2) 結尾（單位）
    m = re.search(r'（([^（）]+)）$', label)
    if m and m.group(1) in UNITS:
        return label[:m.start()].strip(), m.group(1)
    return label, ''


reader = pypdf.PdfReader(PDF)
text = '\n'.join(p.extract_text() for p in reader.pages)

items, unpicked = [], []
current_cat = ''
in_unpicked = False

for raw in text.split('\n'):
    line = squash(raw)
    if line.startswith('【'):
        m = re.match(r'【(.+?)】', line)
        if m:
            current_cat = m.group(1)
        in_unpicked = False
        continue
    if '未盤點品項' in line:
        in_unpicked = True
        continue
    if '▸' not in line:
        continue
    body = line.split('▸', 1)[1].strip()
    if '未盤點' in body:
        unpicked.append(body.split('未盤點')[0].strip())
        continue
    if in_unpicked or '攤車' not in body:
        continue
    label = body.split('攤車', 1)[0].strip()
    if not label:
        continue
    name, unit = split_unit(label)
    items.append({'name': name, 'unit': unit, 'category': current_cat, 'label': label})

# 未盤點排除（比對原始 label 與拆過單位的名稱兩種形式）
unpicked_names = set()
for u in unpicked:
    unpicked_names.add(u)
    unpicked_names.add(split_unit(u)[0])
kept = [i for i in items if i['label'] not in unpicked_names and i['name'] not in unpicked_names]

seen, dedup = set(), []
for i in kept:
    if i['name'] in seen:
        continue
    seen.add(i['name'])
    dedup.append(i)

json.dump({'items': dedup, 'unpicked': unpicked},
          open('items.json', 'w'), ensure_ascii=False, indent=1)

from collections import Counter
no_unit = [i['name'] for i in dedup if not i['unit']]
print('保留品項:', len(dedup), '｜排除未盤點:', len(unpicked), '｜重複去除:', len(kept) - len(dedup))
print('有單位:', len(dedup) - len(no_unit), '｜無單位:', len(no_unit))
print('單位分佈:', dict(Counter(i['unit'] for i in dedup if i['unit'])))
print('分類:', dict(Counter(i['category'] for i in dedup)))
print('\n有單位範例:', [(i['name'], i['unit']) for i in dedup if i['unit']][:8])
print('\n無單位範例:', no_unit[:12])
