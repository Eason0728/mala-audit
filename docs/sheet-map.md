# sheet-map.md — 稽核系統既有分頁結構盤點（人讀版）

來源：`reference/sheet.xlsx`（+ `reference/sheet-tab1.csv` 交叉核對），
由 `reference/parse_sheet.py` 自動產生，機器版見 `apps-script/sheet-map.json`。
重跑：`python3 reference/parse_sheet.py`

## 分頁 → 店代碼 對照（spec.md §5）

| 分頁名稱 | 店代碼 | header_row | 月份列範圍 | 欄位 |
|---|---|---|---|---|
| 小辛辣光復店 | `sxl-gf` | 1 | 2–13 | month=A、sample_count=B、correct_count=C、correct_rate=D、cash_change_correct=E、petty_cash_correct=F、tip_correct=G、tip_amount=H、anomaly_note=I |
| 央廚 | `ck` | 1 | 2–13 | month=A、sample_count=B、correct_count=C、correct_rate=D、anomaly_note=E |
| 光復店 | `mzt-gf` | 1 | 2–13 | month=A、sample_count=B、correct_count=C、correct_rate=D、anomaly_note=E |
| 金山店 | `mzt-js` | 1 | 2–13 | month=A、sample_count=B、correct_count=C、correct_rate=D、anomaly_note=E |
| 六張犁店 | `mzt-lzl` | 1 | 2–13 | month=A、sample_count=B、correct_count=C、correct_rate=D、anomaly_note=E |

## 正確率（correct_rate）是否公式

**結論：True**（五個分頁一致）

- 公式規則：`=C{row}/B{row}（複盤正確數量 / 盤點抽查數量），第一個有資料的月列是明式公式，其餘月列是 Excel shared formula 沿用同一相對位置公式`
- 例外：該月「輪休」（複盤正確數量欄寫`輪休`）時，正確率欄整格空白（無公式也無值），不同於已稽核算出 0% 的情況。

公式原文範例（節錄，完整清單見 JSON 的 `rate_is_formula_detail.sample_formulas`）：

| 分頁 | 月 | 儲存格 | 公式 | 是否 shared formula | 算出值 |
|---|---|---|---|---|---|
| 小辛辣光復店 | 1 | D2 | `C2/B2` | 是 | 0.8 |
| 央廚 | 1 | D2 | `C2/B2` | 是 | 1 |
| 光復店 | 1 | D2 | `C2/B2` | 否（明式公式，master） | 1 |
| 光復店 | 3 | D4 | `C4/B4` | 否（明式公式，master） | 0.8 |
| 光復店 | 5 | D6 | `C6/B6` | 否（明式公式，master） | 0.95 |
| 金山店 | 2 | D3 | `C3/B3` | 否（明式公式，master） | 0.9 |
| 六張犁店 | 2 | D3 | `C3/B3` | 否（明式公式，master） | 0.9 |

## 雜訊清單

1. reference/sheet-tab1.csv 第 9 行（對應第 8 個月列）月份欄寫的是「六月」，但 xlsx 小辛辣光復店分頁同一列（第 9 列）月份欄是「八月」——CSV 與 xlsx 不一致，以 xlsx 為準（CSV 視為匯出雜訊）。
2. 金山店 分頁儲存格 D15 是資料表範圍外的游離內容：「金山店」，不屬於任何月份列，疑似誤貼/殘留。
3. 央廚 分頁目前只有 A, B, C, D, E 共 5 欄（month, sample_count, correct_count, correct_rate, anomaly_note），沒有零找金/零用金/小費是否正確/小費金額四欄——需依 spec.md §2.1 由 setup() 腳本補上（欄序、標題比照小辛辣光復店分頁）。
4. 光復店 分頁目前只有 A, B, C, D, E 共 5 欄（month, sample_count, correct_count, correct_rate, anomaly_note），沒有零找金/零用金/小費是否正確/小費金額四欄——需依 spec.md §2.1 由 setup() 腳本補上（欄序、標題比照小辛辣光復店分頁）。
5. 金山店 分頁目前只有 A, B, C, D, E 共 5 欄（month, sample_count, correct_count, correct_rate, anomaly_note），沒有零找金/零用金/小費是否正確/小費金額四欄——需依 spec.md §2.1 由 setup() 腳本補上（欄序、標題比照小辛辣光復店分頁）。
6. 六張犁店 分頁目前只有 A, B, C, D, E 共 5 欄（month, sample_count, correct_count, correct_rate, anomaly_note），沒有零找金/零用金/小費是否正確/小費金額四欄——需依 spec.md §2.1 由 setup() 腳本補上（欄序、標題比照小辛辣光復店分頁）。
7. 央廚 正確率(correct_rate)欄在第 [4, 5, 6, 7] 個月列是完全空白（通常對應「輪休」月份或尚未輸入複盤正確數量），不是公式也不是 0——與『已稽核但算出 0%』的公式結果不同，回寫/匯入邏輯需分開處理。
8. 光復店 正確率(correct_rate)欄在第 [2, 4, 6, 7] 個月列是完全空白（通常對應「輪休」月份或尚未輸入複盤正確數量），不是公式也不是 0——與『已稽核但算出 0%』的公式結果不同，回寫/匯入邏輯需分開處理。
9. 金山店 正確率(correct_rate)欄在第 [1, 3, 4, 5, 6] 個月列是完全空白（通常對應「輪休」月份或尚未輸入複盤正確數量），不是公式也不是 0——與『已稽核但算出 0%』的公式結果不同，回寫/匯入邏輯需分開處理。
10. 六張犁店 正確率(correct_rate)欄在第 [1, 3, 4, 5] 個月列是完全空白（通常對應「輪休」月份或尚未輸入複盤正確數量），不是公式也不是 0——與『已稽核但算出 0%』的公式結果不同，回寫/匯入邏輯需分開處理。
11. 抽查不一致：「金山店 3月 正確率=80%（任務指示的預期值）」——xlsx 實際值是「None」，不是預期的「80」。以 xlsx 實際內容為準（例如「金山店 3月」實際狀態是「輪休」，正確率 80% 的實際位置是「光復店 3月」D4=C4/B4=0.8）。

## 歷史異常字串測資摘要（共 12 筆，完整內容見 test/fixtures/anomaly-strings.json）

| 分頁 | 月 |
|---|---|
| 小辛辣光復店 | 1 |
| 小辛辣光復店 | 2 |
| 小辛辣光復店 | 4 |
| 小辛辣光復店 | 5 |
| 小辛辣光復店 | 6 |
| 小辛辣光復店 | 7 |
| 光復店 | 3 |
| 光復店 | 5 |
| 金山店 | 2 |
| 金山店 | 7 |
| 六張犁店 | 2 |
| 六張犁店 | 6 |
