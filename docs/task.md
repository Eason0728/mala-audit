# 稽核系統 — task.md（任務清單；每任務 100–200 行、輸入輸出明確、驗收可打勾）
版本：v1 / 2026-08-01。全域約束見 plan.md；格式契約見 spec.md §5（每個派工 prompt 都附上該節全文）。

## 共用介面契約（先定死，各任務照抄）

```js
// js/api.js —— mock 與 cloud 同介面，回傳皆 Promise
Api.auth(code)                    // → {ok, role}  role: 'accountant'|'viewer'
Api.getAll(code)                  // → {ok, config, items, records, details}（全年份全量）
Api.submitAudit(code, record, details) // → {ok, record_key}（覆蓋語意）
Api.markRest(code, store, month)  // → {ok}

// 資料形狀（欄位對應 spec §2.2，值用中文枚舉）
record  = {record_key, store, month, status, audit_date, sample_count, correct_count,
           correct_rate, change_fund, petty_cash, tip_amount, tip_match,
           anomaly_text, note, submitted_at}
detail  = {record_key, store, month, item, unit, book_qty, recount_qty, verdict, reason, note}
item    = {store, name, unit, active}          // active: true/false
config  = {reasons:[...], change_fund_std:10000, petty_cash_std:10000,
           stores:[{code,name,order}], accountant_ok:true}   // 通行碼不落前端

// js/format.js（純函式）
recordKey(store, month)           // → 'sxl-gf_2026-08'
monthLabel(month)                 // → '2026-08' → '八月'
correctRate(correct, total)       // → 90（整數，四捨五入）
buildAnomalyText(details)         // → '1.鴨血:盤點27盒，覆盤32盒 2.…'（spec §5 逐字元）

// js/sampling.js（純函式）
drawSample(items, details, n)     // → [{name, unit, lastDrawn}] lastDrawn:'YYYY-MM'|null；純隨機不排除
redrawOne(current, items, details)// → 換一項（不與 current 重複）
```

---

## Phase 1｜前端全流程＋mock（里程碑：Eason 本機可玩）

**T1 骨架＋format 純函式**
建：index.html（五分頁殼）、css/base.css、js/config.js、js/format.js、test/format.test.js；`git init`＋首 commit。
產出介面：format 四函式（上表）。
驗收：`node test/format.test.js` 全過——buildAnomalyText 以 spec §5 範例逐字元比對；
monthLabel 12 個月全對；correctRate(19,20)=95。

**T2 mock 資料＋api 層**
建：js/mock-data.js（五店品項庫各≥30項含單位；1–7 月歷史 records＋異常 details，取自真 sheet 內容摘錄）、
js/api.js（mock 完整實作＋cloud 分支呼叫 GAS_URL，同介面）、test/api.mock.test.js。
消費：format.recordKey。產出：Api 四方法（上表形狀）。
驗收：node 測試過——getAll 形狀齊全；submitAudit 同 key 重送 records 不增列（覆蓋）；markRest 後該月 status=`輪休`。

**T3 登入＋總覽**
建：js/app.js、js/views/login.js、js/views/overview.js。
消費：Api.auth/getAll、format.monthLabel。
驗收（Playwright）：會計碼/主管碼登入角色正確；總覽 5 店×12 月格顯示 已稽核(正確率)/輪休/未記錄
與 mock 歷史一致；viewer 看不到「開始稽核」「標記輪休」。

**T4 抽樣模組**
建：js/sampling.js、test/sampling.test.js、js/views/audit.js（抽樣區段）。
消費：Api.getAll 的 items/details。產出：sampling 兩函式；audit 畫面選定的 20 項清單。
驗收：node 測試——drawSample 不重複、lastDrawn 標記正確（有歷史的項帶月份）；
Playwright——隨機抽 20、⚠標記可見、換一項/搜尋加項/刪項可用、少於 20 送出前有提醒不阻擋。

**T5 填寫＋金庫＋草稿＋送出**
改：js/views/audit.js（完成）。
消費：Api.submitAudit、format.buildAnomalyText/correctRate。
驗收（Playwright）：填寫→送出後總覽即更新；輸入中重整頁面草稿還原（localStorage `draft_{record_key}`）；
模擬送出失敗草稿保留＋可重試；同月已有紀錄時出現覆蓋確認（含原日期）；異常項強制選原因、「其他」強制備註。

**T6 報告＋列印**
建：js/views/report.js、css/print.css。
消費：Api.getAll、format 全部。
驗收（Playwright）：單店單月報告含 20 項明細＋金庫＋異常原因；年度總表 12 月×各欄與 mock 一致；
@media print 樣式存在（單月報告目標一頁）。真瀏覽器印 PDF 由 Eason 停點 A 一併驗（庫存 app 教訓）。

**T7 異常分析＋Phase 1 整驗**
建：js/views/analysis.js、開啟稽核App.command。
驗收：累犯排行（品項×次數×店×月）、原因統計、各店異常數與 mock 資料人工對算一致；
Playwright 全流程走查無 console error；**交 Eason 本機玩＝停點 A**。

## Phase 2｜Apps Script 後端＋本機整測（可與停點 A 並行）

**T8 sheet 結構盤點**
用 Drive 匯出 xlsx 解析五張分表實際列/欄座標、正確率是否公式 → 建 docs/sheet-map.md＋Code.gs 用的常數表（JSON）。
驗收：sheet-map.md 列出每店分表 12 個月列號＋各欄欄號；抽 3 筆與已讀內容一致；正確率公式與否有明確結論。

**T9 Code.gs 核心（doPost＋auth＋getAll）**
建：apps-script/Code.gs（doPost 分流、通行碼驗證、輸入驗證：record_key 格式/店代碼/枚舉）、test/gas-runner.js
（node 假環境載入 Code.gs 純邏輯，仿 payroll 的 mock 做法）。
驗收：node 跑 auth 兩角色、getAll 形狀與 Api 契約一致、非法輸入整筆拒收有錯誤訊息。

**T10 Code.gs submitAudit＋markRest＋分表回寫**
改：Code.gs。消費：T8 常數表。
驗收：node 假環境——同 key 重送紀錄不重複、明細先刪後寫、分表該月各欄寫入值正確（含金庫欄）、markRest 寫 `輪休`。

**T11 Code.gs setup＋importHistory**
改：Code.gs。測資：真 sheet 1–7 月異常字串全集（含「蟹黃醬:19.4包」缺字變體）。
驗收：setup 建四分頁＋補 2–5 分表金庫欄；解析測資全過或落備註 fallback（列出筆數）；
匯入後逐月正確數/正確率與原表一致（node 假環境）；歷史品項自動補進品項庫。

## Phase 3｜部署與真資料（動真 sheet 前＝停點 B）

**T12 部署準備＋備份**：Drive 複製整表備份、.clasp.json、docs/部署步驟.md（madesiaosinla@gmail.com 授權流程
＋品項庫首批貼入指引——會計把各店盤點表品項＋單位貼進品項庫分頁）。
驗收：備份存在且可開；步驟文件 Eason 看得懂。**問過才進 T13。**
**T13 雲端初始化＋匯入對帳**：跑 setup()＋importHistory()；對帳表：五店×7 個月正確數/正確率/異常說明逐格比對備份。
驗收：對帳全綠貼出；fallback 筆數（若有）Eason 裁決。
**T14 cloud 實測**：config 切 cloud、真送出一筆＋覆蓋＋輪休＋主管碼唯讀。
驗收：sheet 分表回寫肉眼可對；getAll 即時反映；巡檢 app 已知的 302/curl 陷阱不誤判（信瀏覽器不信 curl）。

## Phase 4｜正式上線收尾

**T15 正式部署＋圖示**（push 前＝停點 C）：GitHub Pages（repo `mala-audit`）、竹葉系圖示
（做前查 [[mala-webapp-icon-convention]] 避開已用底色）、正式通行碼寫入設定分頁（不進 repo）。
驗收：手機開線上網址全流程可用；圖示加入主畫面顯示正常。
**T16 收尾補登**：記憶庫寫專案記憶（上線當下就寫——2026-07-31 教訓）、建 mala-audit 維護 skill
（含「收尾：自我改進」區塊）、CLAUDE.md 路由表＋dispatch-rules.md 第 2 節補列、四份文件補終版狀態。
驗收：路由表有「稽核」關鍵詞條目；skill 檔存在；記憶索引有新行。
